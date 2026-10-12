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
    const [a, b] = f.sources.slice(-2); assert.match(a.buffer.file, new RegExp(`portal2/player/footsteps/${surface}`)); assert.notEqual(a.buffer, b.buffer);
  }
  f.audio.dispose(); assert.equal(f.audio.state.voices, 0);
});

test('shots apply paintball lowpass, HRTF positioning and progressive air absorption as the listener moves', async () => {
  const f = fixture(); await f.audio.preload();
  f.audio.setListener({ x: 0, y: 1.7, z: 0 }); f.audio.shot('pistol', { position: { x: -3, y: 1.7, z: 0 } });
  const p = f.panners[0], filter = f.filters[0], near = filter.frequency.value;
  assert.equal(p.panningModel, 'HRTF'); assert.equal(p.positionX.value, -3); assert.equal(p.distanceModel, 'inverse'); assert.ok(p.maxDistance > 1000); assert.ok(near < 2000);
  f.audio.setListener({ x: 30, y: 1.7, z: 0 }, { x: 1, y: 0, z: 0 }); const middle = filter.frequency.value;
  f.audio.setListener({ x: 90, y: 1.7, z: 0 }); assert.ok(near > middle && middle > filter.frequency.value);
  assert.equal(f.context.listener.positionX.value, 90);
  f.audio.reload('pistol', { tag: 'reload:local' }); f.audio.reload('automatic', { tag: 'reload:remote' });
  f.audio.stopReload('reload:remote'); assert.ok(!f.sources.at(-2).stopped); assert.ok(f.sources.at(-1).stopped);
  f.audio.dispose();
});
