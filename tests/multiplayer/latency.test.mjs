import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSimulation } from '../../server/simulation.js';
import { updateHumanoidHitboxes } from '../../src/gameplay/combat/hitboxes.js';

function fixture(t, trace = () => null) {
  const at = { x: 50, y: 0, z: 50 }, events = [];
  const wood = { half: .6, spawn: at, body: { translation: () => at } };
  const world = {
    bounds: { x0: -100, x1: 100, z0: -100, z1: 100 }, obstacles: [],
    terrain: { heightAt: () => 0 }, free: () => true, segmentClear: () => true, trace,
    landmarks: { spawn: { x: 0, y: 0, z: 5 }, inward: { x: 0, z: -1 },
      defense: { x: 70, y: 0, z: 70 }, field: { x: 50, y: 0, z: 50 }, portals: [] },
    createCrates: () => ({ crates: [wood], trace: () => null, step() {}, snapshot: () => [], dispose() {} }),
  };
  const s = createRoomSimulation(world, { random: () => .5, onEvent: e => events.push(e) });
  const p = s.addPlayer('shooter', {}); s.handleAction('shooter', { type: 'ready', ready: true });
  p.entity.protectedUntil = 0;
  t.after(() => s.dispose()); return { s, p, events };
}
const advance = (s, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) s.step(); };
const fire = (s, origin, extra = {}) => s.handleAction('shooter', {
  type: 'attack', weapon: 'automatic', origin, direction: { x: 0, y: 0, z: -1 }, aiming: true, ...extra,
});

test('multiplayer headshots reach the visible Quaternius head above the human collider', t => {
  const { s } = fixture(t);
  const zombie = s.sim.spawn({ kind: 'zombie', stationary: true, position: { x: 0, y: 0, z: 0 } });
  assert.ok(fire(s, { x: 0, y: 1.93, z: 5 })); advance(s, .2);
  assert.ok(zombie.dead, 'a ray through the visible zombie head must be a lethal headshot');
});

for (const rtt of [0, .08, .16, .3]) test(`moving targets use the displayed timeline at ${rtt * 1000} ms RTT`, t => {
  const { s, p } = fixture(t);
  const zombie = s.sim.spawn({ kind: 'zombie', stationary: true, position: { x: 0, y: 0, z: 0 } });
  for (let i = 0; i < 60; i++) {
    zombie.position.x = (s.sim.time + 1 / 60) * 5;
    updateHumanoidHitboxes(zombie); s.step();
  }
  const shotTime = s.sim.time - rtt / 2, viewTime = shotTime - rtt / 2 - .08;
  p.entity.position.x = viewTime * 5; p.entity.position.z = 3;
  updateHumanoidHitboxes(p.entity);
  assert.ok(fire(s, { x: p.entity.position.x, y: 1.15, z: 3 }, { shotId: 1, shotTime, viewTime }));
  advance(s, .15);
  assert.ok(zombie.health.current < zombie.health.max, 'aiming at the displayed target must hit despite network/interpolation delay');
});

test('server paint follows the same gravity as the local projectile', t => {
  const { s, p } = fixture(t); p.entity.position.y = 1.3;
  assert.ok(fire(s, { x: 0, y: 3, z: 5 }, { weapon: 'pistol' }));
  advance(s, .5);
  assert.ok(Math.abs(s.projectiles[0].position.y - (3 - 3 * .5 ** 2 / 2)) < 1e-6);
});

test('stale, future and nonfinite shot timestamps cannot spend ammo or rewind targets', t => {
  const { s, p } = fixture(t); advance(s, 1);
  for (const timing of [
    { shotTime: 0, viewTime: 0 }, { shotTime: 2, viewTime: 1 },
    { shotTime: s.sim.time, viewTime: -10 }, { shotTime: NaN, viewTime: 1 },
  ]) assert.equal(fire(s, { x: 0, y: 1.7, z: 5 }, { shotId: 1, ...timing }), false);
  assert.equal(p.ammunition.state('automatic').loaded, 30);
});

test('command timestamps preserve legitimate cadence through jitter without accepting duplicates or faster fire', t => {
  const { s, p } = fixture(t); advance(s, 1);
  const origin = { x: 0, y: 1.7, z: 5 };
  assert.ok(fire(s, origin, { shotId: 1, shotTime: .8, viewTime: .7 }));
  assert.ok(fire(s, origin, { shotId: 2, shotTime: .89, viewTime: .79 }));
  assert.equal(fire(s, origin, { shotId: 3, shotTime: .9, viewTime: .8 }), false);
  advance(s, .15);
  assert.equal(fire(s, origin, { shotId: 2, shotTime: s.sim.time, viewTime: s.sim.time - .1 }), false);
  assert.equal(p.ammunition.state('automatic').loaded, 28);
});

test('rewound targets remain blocked by solid scenery', t => {
  const { s } = fixture(t, (a, b) => {
    if (a.z < 2 || b.z >= 2) return null;
    const fraction = (a.z - 2) / (a.z - b.z);
    return { distance: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * fraction,
      point: { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: 2 }, normal: { x: 0, y: 0, z: 1 } };
  });
  const zombie = s.sim.spawn({ kind: 'zombie', stationary: true, position: { x: 0, y: 0, z: 0 } });
  advance(s, 1);
  assert.ok(fire(s, { x: 0, y: 1.84, z: 5 }, { shotId: 1, shotTime: .9, viewTime: .8 }));
  advance(s, .2); assert.equal(zombie.health.current, zombie.health.max);
});
