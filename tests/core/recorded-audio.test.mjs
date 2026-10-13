import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRecordedAudio, RECORDED_SOUNDS } from '../../src/core/recorded-audio.js';

function fixture() {
  const parameter = () => ({ value: 0, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} });
  const sources = [], filters = [], panners = [], files = [];
  const node = () => ({ connect() {}, disconnect() {} });
  const context = { currentTime: 0, listener: Object.fromEntries(['position', 'forward', 'up'].flatMap(name => ['X', 'Y', 'Z'].map(axis => [name + axis, parameter()]))),
    createGain: () => ({ ...node(), gain: parameter() }),
    createBiquadFilter() { const n = { ...node(), frequency: parameter(), Q: parameter() }; filters.push(n); return n; },
    createPanner() { const n = { ...node(), positionX: parameter(), positionY: parameter(), positionZ: parameter() }; panners.push(n); return n; },
    createBufferSource() { const n = { ...node(), playbackRate: parameter(), start() {}, stop(time) { if (time <= context.currentTime) this.stopped = true; } }; sources.push(n); return n; },
    async decodeAudioData(data) { return { duration: 1, file: data }; },
  };
  const audio = createRecordedAudio({ context, bus: node(), audible: () => true, random: () => .2,
    fetcher: async file => { files.push(file); return { ok: true, arrayBuffer: async () => file }; } });
  return { audio, context, sources, filters, panners, files };
}

test('every gameplay sample ships locally; firearm and footstep recordings are distinct real media', async () => {
  const hashes = new Set();
  for (const file of RECORDED_SOUNDS) {
    const bytes = await fs.readFile(new URL(`../../public/${file}`, import.meta.url));
    assert.ok(bytes.length > 1000, file); if (file.endsWith('.wav')) assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, RECORDED_SOUNDS.length);
});

test('footsteps use loaded surface recordings without synthesized fallback or repeated variants', async () => {
  const f = fixture(); f.audio.footstep('grass'); assert.equal(f.sources.length, 0);
  await f.audio.preload(); await f.audio.preload(); assert.equal(f.files.length, RECORDED_SOUNDS.length);
  for (const surface of ['concrete', 'dirt', 'grass']) {
    f.audio.footstep(surface); f.audio.footstep(surface);
    const [a, b] = f.sources.slice(-2); assert.match(a.buffer.file, new RegExp(`${surface === 'grass' ? 'portal2/player/footsteps' : 'foley'}/${surface}`)); assert.notEqual(a.buffer, b.buffer);
  }
  f.audio.dispose(); assert.equal(f.audio.state.voices, 0);
});

test('shots keep their original spectrum and HRTF distance positioning as the listener moves', async () => {
  const f = fixture(); await f.audio.preload();
  f.audio.setListener({ x: 0, y: 1.7, z: 0 }); f.audio.shot('pistol', { position: { x: -3, y: 1.7, z: 0 } });
  const p = f.panners[0]; assert.equal(f.filters.length, 0);
  assert.match(f.sources[0].buffer.file, /pistol-clean\.wav$/);
  assert.equal(p.panningModel, 'HRTF'); assert.equal(p.positionX.value, -3); assert.equal(p.distanceModel, 'inverse'); assert.ok(p.maxDistance > 1000);
  f.audio.setListener({ x: 30, y: 1.7, z: 0 }, { x: 1, y: 0, z: 0 });
  f.audio.setListener({ x: 90, y: 1.7, z: 0 }); assert.equal(f.filters.length, 0);
  assert.equal(f.context.listener.positionX.value, 90);
  f.audio.reload('pistol', { tag: 'reload:local' }); f.audio.reload('automatic', { tag: 'reload:remote' });
  f.audio.stopReload('reload:remote'); assert.ok(!f.sources.at(-2).stopped); assert.ok(f.sources.at(-1).stopped);
  f.audio.dispose();
});

test('all surfaces, reloads, impacts, melee, ambience and whizzes bypass muffling at every distance', async () => {
  const f = fixture(); await f.audio.preload(); const position = { x: 0, y: 0, z: -3 };
  f.audio.setListener({ x: 0, y: 1.7, z: 0 });
  f.audio.footstep('concrete', { position }); f.audio.footstep('dirt', { position });
  f.audio.jump('concrete', position); f.audio.land('dirt', 5, position);
  assert.equal(f.filters.length, 0, 'hard-ground foley must connect directly to gain');
  assert.equal(f.panners.length, 4); assert.ok(f.panners.every(p => p.panningModel === 'HRTF' && p.distanceModel === 'inverse'));
  f.audio.setListener({ x: 90, y: 1.7, z: 0 }); assert.equal(f.filters.length, 0);
  f.audio.footstep('grass', { position }); assert.equal(f.filters.length, 0);
  assert.match(f.sources.at(-1).buffer.file, /portal2\/player\/footsteps\/grass/);
  for (const weapon of ['pistol', 'automatic', 'revolver', 'shotgun', 'sniper', 'smg']) {
    f.audio.shot(weapon, { position }); f.audio.reload(weapon, { position });
  }
  f.audio.melee({ id: 'axe' }, { position }); f.audio.impact('metal', 6, { position });
  f.audio.hit({ surface: 'metal', point: position }, { kind: 'firearm' }); f.audio.setAmbience(true);
  assert.equal(f.audio.whiz({ x: 85, y: 1.7, z: -1 }, { x: 95, y: 1.7, z: -1 }), true);
  assert.equal(f.filters.length, 0);
  f.audio.dispose();
});
