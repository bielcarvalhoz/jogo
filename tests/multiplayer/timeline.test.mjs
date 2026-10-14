import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotTimeline } from '../../src/gameplay/multiplayer/timeline.js';
import { createHitboxHistory } from '../../server/lag-compensation.js';
import { updateHumanoidHitboxes } from '../../src/gameplay/combat/hitboxes.js';
import { projectileDirections, advanceProjectile } from '../../src/shared/ballistics.js';
import { NET } from '../../src/shared/multiplayer.js';
import { WEAPON_BY_ID } from '../../src/gameplay/paintball/weapons.js';

test('snapshot timing rejects old packets and samples simulation time despite arrival jitter', () => {
  const timeline = new SnapshotTimeline();
  for (let i = 0; i < 10; i++) timeline.add({ time: i / 18 }, i / 18 + (i % 2 ? .12 : .08));
  const before = timeline.frames.length;
  assert.equal(timeline.add({ time: 1 / 18 }, 1), false);
  assert.equal(timeline.frames.length, before);
  const sample = timeline.sample(.62);
  assert.ok(sample.time >= sample.a.time && sample.time <= sample.b.time);
  assert.ok(timeline.delay > NET.minInterpolation && timeline.delay <= NET.maxInterpolation);
  assert.ok(timeline.sample(.65).time >= sample.time, 'a jitter spike cannot make actors run backwards');
  assert.equal(timeline.stale(2), true);
  timeline.clear(); assert.equal(timeline.sample(3), null);
});

test('a lost snapshot keeps a bounded timeline and never extrapolates an enemy into invented cover', () => {
  const timeline = new SnapshotTimeline();
  for (let i = 1; i < 100; i++) if (i % 5) timeline.add({ time: i / 18 }, i / 18 + .1);
  assert.ok(timeline.frames.length <= 32);
  const last = timeline.frames.at(-1).data.time;
  assert.equal(timeline.sample(10).time, last);
  assert.ok(Math.abs(timeline.serverNow(5.6, 200) - (last + 5.6 - timeline.frames.at(-1).at + .1)) < 1e-6);
});

test('rewind cannot hit a disconnected or respawned life, mutate live actors, or retain unlimited history', () => {
  const history = createHitboxHistory();
  const e = { id: 'target', kind: 'player', position: { x: 0, y: 0, z: 0 }, yaw: 0, networkLife: 1, health: { current: 100 }, dead: false };
  updateHumanoidHitboxes(e);
  for (let i = 0; i < 120; i++) history.record(i / 60, [e]);
  assert.ok(history.size <= Math.ceil(NET.maxRewind * 60) + 2);
  const from = { x: 0, y: 1.15, z: 3 }, to = { ...from, z: -3 };
  const before = JSON.stringify(e);
  assert.equal(history.trace(from, to, null, 1.8).entity, e);
  assert.equal(JSON.stringify(e), before);
  e.networkGhost = true; assert.equal(history.trace(from, to, null, 1.8), null);
  e.networkGhost = false; e.networkLife++; assert.equal(history.trace(from, to, null, 1.8), null);
  assert.equal(history.trace(from, to, null, 0), null);
  e.networkLife = 1; history.record(2, [e]); history.record(2.1, []);
  assert.equal(history.trace(from, to, null, 1.9), null, 'leaving a room cannot retain a historical ghost collider');
});

test('all seeded shotgun pellets and gravity agree across frame rates', () => {
  const direction = { x: .2, y: -.15, z: -Math.sqrt(1 - .2 ** 2 - .15 ** 2) };
  const local = projectileDirections(direction, WEAPON_BY_ID.shotgun, true, 42);
  assert.deepEqual(local, projectileDirections(direction, WEAPON_BY_ID.shotgun, true, 42));
  assert.notDeepEqual(local, projectileDirections(direction, WEAPON_BY_ID.shotgun, true, 43));
  assert.equal(local.length, 9);
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(local[0][axis] - direction[axis]) < 1e-15);
  for (const d of local) {
    const position = { x: 0, y: 3, z: 0 }, velocity = { x: d.x * 70, y: d.y * 70, z: d.z * 70 };
    const whole = advanceProjectile(position, velocity, .5);
    let split = { position, velocity };
    for (let i = 0; i < 30; i++) split = advanceProjectile(split.position, split.velocity, 1 / 60);
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(whole.position[axis] - split.position[axis]) < 1e-10);
  }
});
