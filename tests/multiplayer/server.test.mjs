import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createMultiplayerServer, originAllowed } from '../../server/index.js';
import { loadServerWorld } from '../../server/world.js';
import { createRoomSimulation } from '../../server/simulation.js';
import { updateHumanoidHitboxes } from '../../src/gameplay/combat/hitboxes.js';
import { NET, EV, separatedSpawn, interpolatePose, cleanName } from '../../src/shared/multiplayer.js';

let surveyed, field, flat;
before(async () => {
  surveyed = await loadServerWorld(); field = surveyed.landmarks.field;
  flat = { terrain: { heightAt: () => field.y }, landmarks: { ...surveyed.landmarks, spawn: { x: field.x, y: field.y, z: field.z + 20 }, inward: { x: 0, z: -1 }, defense: { x: field.x + 12, y: field.y, z: field.z }, portals: [{ x: field.x + 25, y: field.y, z: field.z + 15 }] },
    bounds: { x0: field.x - 70, x1: field.x + 70, z0: field.z - 70, z1: field.z + 70 }, obstacles: [], free: () => true, segmentClear: () => true, trace: () => null, createCrates: surveyed.createCrates };
});
const advance = (s, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) s.step(); };
const fixture = t => { const events = [], s = createRoomSimulation(flat, { random: () => .5, onEvent: e => events.push(e) }); t.after(() => s.dispose()); return { s, events }; };
const place = (p, position) => { p.entity.position = { ...position }; p.entity.protectedUntil = 0; updateHumanoidHitboxes(p.entity); };

test('ten safe spawns are distinct and cannot be forced into a solid', () => {
  const occupied = [];
  for (let i = 0; i < 10; i++) { const p = separatedSpawn(surveyed.landmarks, occupied, surveyed.free); assert.ok(occupied.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= 1.4)); assert.ok(surveyed.free(p.x, p.z)); occupied.push(p); }
  assert.throws(() => separatedSpawn(surveyed.landmarks, [], () => false));
  assert.equal(cleanName('\u0000 Sala\n'), 'Sala');
});

test('server bounds movement budget, rejects old/nonfinite poses and prevents wall tunnelling', t => {
  const { s } = fixture(t), p = s.addPlayer('a', { name: 'Biel' }), before = { ...p.entity.position };
  assert.equal(s.setPose('a', { seq: 1, ...before, x: before.x + 100, yaw: 0 }), true);
  assert.ok(p.entity.position.x - before.x < 1);
  assert.equal(s.setPose('a', { seq: 1, ...before, yaw: 0 }), false);
  assert.equal(s.setPose('a', { seq: 2, ...before, x: NaN, yaw: 0 }), false);
  const budgeted = p.entity.position.x;
  for (let seq = 2; seq < 100; seq++) s.setPose('a', { seq, ...before, x: before.x + 100, yaw: 0 });
  assert.ok(p.entity.position.x - budgeted < .0001, 'packet spam cannot create movement time');
  const wall = { ...flat, segmentClear: (a, b) => b.x <= a.x + .01 };
  const blocked = createRoomSimulation(wall); t.after(() => blocked.dispose()); const q = blocked.addPlayer('q', {});
  const start = { ...q.entity.position }; blocked.setPose('q', { ...start, x: start.x + .6, seq: 1, yaw: 0 }); assert.equal(q.entity.position.x, start.x);
});

test('friendly fire uses server projectile hits, weapon damage and cooldown; death respawns at a separate gate position', t => {
  const { s, events } = fixture(t), a = s.addPlayer('a', {}), b = s.addPlayer('b', {});
  // Stand beside the wood crate, rather than firing from inside its collider.
  place(a, { ...field, x: field.x - 4 }); place(b, { ...field, x: field.x - 4, z: field.z - 5 });
  const action = { type: 'attack', weapon: 'pistol', origin: { x: field.x - 4, y: field.y + 1, z: field.z }, direction: { x: 0, y: 0, z: -1 }, damage: 99999, target: 'b' };
  assert.equal(s.handleAction('a', action), true); assert.equal(s.handleAction('a', action), false);
  advance(s, .2); assert.equal(b.entity.health.current, 70, 'client-supplied damage is ignored');
  for (let i = 0; i < 3; i++) { assert.equal(s.handleAction('a', action), true); advance(s, .2); }
  assert.ok(b.entity.dead); assert.equal(a.entity.stats.kills, 1); assert.equal(b.entity.stats.deaths, 1);
  assert.equal(s.handleAction('b', action), false);
  advance(s, 3.2); assert.equal(!!b.entity.dead, false); assert.equal(b.entity.health.current, 100); assert.equal(b.life, 2);
  assert.ok(Math.hypot(b.entity.position.x - flat.landmarks.spawn.x, b.entity.position.z - flat.landmarks.spawn.z) < 10);
  assert.equal(events.filter(e => e.type === 'death').length, 1);
});

test('scenery and disconnected ghosts cannot be used as targets or shot through', t => {
  const { s } = fixture(t), a = s.addPlayer('a', {}), b = s.addPlayer('b', {});
  place(a, field); place(b, { ...field, z: field.z - 3 }); b.entity.networkGhost = true;
  s.handleAction('a', { type: 'attack', weapon: 'pistol', origin: { ...field, y: field.y + 1 }, direction: { x: 0, y: 0, z: -1 } }); advance(s, .3);
  assert.equal(b.entity.health.current, 100);
  assert.equal(s.handleAction('a', { type: 'attack', weapon: 'fake', origin: field, direction: { x: 0, y: 0, z: -1 } }), false);
  assert.equal(s.handleAction('a', { type: 'attack', weapon: '__proto__', origin: field, direction: { x: 0, y: 0, z: -1 } }), false);
  assert.equal(s.handleAction('a', { type: 'attack', weapon: 'sniper', origin: { ...field, x: field.x + 100 }, direction: { x: 0, y: 0, z: -1 } }), false);
});

test('authority enforces finite magazines, reload time, cancellation and independent weapon ammo', t => {
  const { s, events } = fixture(t), p = s.addPlayer('a', {}); place(p, { ...field, x: field.x - 4 });
  const shot = { type: 'attack', weapon: 'pistol', origin: { ...p.entity.position, y: field.y + 1.4 }, direction: { x: 0, y: 0, z: 1 } };
  for (let i = 0; i < 20; i++) { assert.equal(s.handleAction('a', shot), true); advance(s, .2); }
  assert.equal(s.handleAction('a', shot), false); assert.equal(s.snapshot().players[0].ammo.loaded, 0);
  assert.equal(s.handleAction('a', { type: 'reload', weapon: 'automatic' }), false);
  assert.equal(s.handleAction('a', { type: 'reload', weapon: 'pistol' }), true);
  advance(s, 1); assert.equal(s.handleAction('a', shot), false);
  assert.equal(s.handleAction('a', { type: 'cancelReload' }), true); advance(s, 2);
  assert.equal(p.ammunition.state('pistol').loaded, 0); assert.equal(p.ammunition.state('pistol').reserve, 120);
  s.handleAction('a', { type: 'reload', weapon: 'pistol' }); advance(s, 2.3);
  assert.equal(p.ammunition.state('pistol').loaded, 20); assert.equal(p.ammunition.state('pistol').reserve, 100);
  assert.equal(s.handleAction('a', shot), true); advance(s, .2);
  assert.equal(s.handleAction('a', { ...shot, weapon: 'automatic' }), true);
  assert.equal(p.ammunition.state('automatic').loaded, 29); assert.equal(p.ammunition.state('pistol').loaded, 19);
  assert.ok(events.some(event => event.type === 'reload' && event.active));
});

test('defense requires proximity, creates portal waves, advances after kills and finishes after five waves', t => {
  const { s, events } = fixture(t), p = s.addPlayer('p', {});
  assert.equal(s.handleAction('p', { type: 'interact', game: 'defense' }), false);
  place(p, flat.landmarks.defense); assert.equal(s.handleAction('p', { type: 'interact', game: 'defense' }), true);
  s.step(); assert.equal(s.defense.wave, 1); assert.ok(s.defense.remaining >= 7);
  assert.equal(s.handleAction('p', { type: 'interact', game: 'defense' }), false);
  for (let wave = 1; wave <= 5; wave++) {
    for (const z of [...s.sim.agents]) s.sim.damage(z, { source: p.entity, weapon: { kind: 'melee', damage: 10000 } });
    s.step(); if (wave < 5) advance(s, 5.1);
  }
  assert.equal(s.defense.status, 'won'); assert.equal(s.defense.wave, 5); assert.ok(events.some(e => /Vitória/.test(e.message)));
});

test('surveyed portal zombies navigate around real campus buildings and reach the Prata entrance', t => {
  const s = createRoomSimulation(surveyed); t.after(() => s.dispose()); const p = s.addPlayer('p', {}); place(p, surveyed.landmarks.defense);
  const goal = s.sim.navigation.nearestFree(surveyed.landmarks.defense);
  assert.ok(Math.hypot(goal.x - surveyed.landmarks.defense.x, goal.z - surveyed.landmarks.defense.z) < 2);
  s.handleAction('p', { type: 'interact', game: 'defense' });
  advance(s, 100);
  assert.ok(s.objective.health.current < 1200, 'at least one zombie must reach and attack the actual building');
});

test('football only scores a wood crate crossing inside a goal below the crossbar, and resets it', t => {
  const { s } = fixture(t), p = s.addPlayer('p', {}); place(p, field);
  assert.equal(s.handleAction('p', { type: 'interact', game: 'football' }), true);
  const wood = s.physics.crates[0];
  function shot(side, across = 0, height = .63) {
    const u = side * (field.halfLength + wood.half - .12);
    wood.body.setTranslation({ x: field.x + field.ux * u - field.uz * across, y: field.y + height, z: field.z + field.uz * u + field.ux * across }, true);
    wood.body.setLinvel({ x: field.ux * side * 20, y: 0, z: field.uz * side * 20 }, true); wood.lastTouch = 'p'; s.step();
  }
  shot(-1, 8); assert.deepEqual(s.football.score, [0, 0]);
  shot(-1, 0, 4); assert.deepEqual(s.football.score, [0, 0]);
  shot(-1); assert.deepEqual(s.football.score, [1, 0]); assert.equal(s.football.lastScorer, 'p');
  advance(s, 2.1); assert.ok(Math.hypot(wood.body.translation().x - field.x, wood.body.translation().z - field.z) < 1);
  shot(1); assert.deepEqual(s.football.score, [1, 1]);
});

test('emotes are allowlisted, cooldown-limited and expire', t => {
  const { s, events } = fixture(t); s.addPlayer('p', {});
  assert.equal(s.handleAction('p', { type: 'emote', emote: 'wave' }), true);
  assert.equal(s.handleAction('p', { type: 'emote', emote: 'fire' }), false);
  advance(s, 1.1); assert.equal(s.handleAction('p', { type: 'emote', emote: '<script>' }), false);
  advance(s, 1.5); assert.equal(s.snapshot().players[0].emote, null); assert.equal(events.filter(e => e.type === 'emote').length, 1);
});

test('HTTP/Socket.IO: directory, ten-player cap, room isolation, token reconnect, signalling and cleanup', async t => {
  const app = await createMultiplayerServer({ world: flat, graceMs: 250, emptyMs: 400 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const url = `http://127.0.0.1:${app.server.address().port}`;
  const sockets = [];
  t.after(async () => { for (const s of sockets) s.disconnect(); await app.close(); });
  const client = async () => { const s = connect(url, { transports: ['websocket'], reconnection: false }); sockets.push(s); await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); }); return s; };
  const request = (s, event, data = {}) => new Promise((resolve, reject) => s.timeout(3000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));
  const enter = async (s, event, data = {}) => { const welcome = new Promise(resolve => s.once(EV.welcome, resolve)); const reply = await request(s, event, { protocol: NET.protocol, ...data }); assert.ok(reply.ok); return welcome; };
  const health = await (await fetch(`${url}/health`)).json(); assert.equal(health.ok, true); assert.equal(health.maxPlayers, 10);
  const a = await client(), info = await enter(a, EV.create, { name: 'Sala pública' });
  const duplicate = await enter(a, EV.join, { code: info.code }); assert.equal(duplicate.selfId, info.selfId); assert.equal(app.hub.rooms.size, 1);
  for (let i = 1; i < 10; i++) await enter(await client(), EV.join, { code: info.code });
  const extra = await client(), full = await request(extra, EV.join, { code: info.code, protocol: NET.protocol }); assert.equal(full.ok, false);
  const list = await request(extra, EV.list); assert.equal(list.rooms[0].players, 10); assert.equal(list.rooms[0].full, true);
  const another = await enter(extra, EV.create, { name: 'Outra sala' });
  let leaked = false; extra.on(EV.signal, () => { leaked = true; }); a.emit(EV.signal, { to: another.selfId, data: { sdp: { type: 'offer', sdp: 'test' } } });
  await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(leaked, false);
  const target = sockets[1], targetId = [...app.hub.rooms.get(info.code).members.values()].find(m => m.socketId === target.id).id;
  const signal = new Promise(resolve => target.once(EV.signal, resolve)); a.emit(EV.signal, { to: targetId, from: 'forged', data: { ice: { candidate: 'test' } } }); assert.equal((await signal).from, info.selfId);
  a.disconnect();
  const replacement = await client(), restored = await enter(replacement, EV.join, { code: info.code, token: info.token });
  assert.equal(restored.selfId, info.selfId); assert.equal(restored.snapshot.players.length, 10);
  await request(replacement, EV.leave); assert.equal(app.hub.rooms.get(info.code).members.size, 9);
  const invalid = await request(extra, EV.create, null); assert.equal(invalid.ok, false);
  for (const s of sockets) s.disconnect(); await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(app.hub.rooms.size, 0);
});

test('server origins and interpolation handle secure deployments and respawn discontinuities', () => {
  assert.ok(originAllowed('https://jogo-git-preview.vercel.app')); assert.ok(originAllowed('http://localhost:5173')); assert.ok(originAllowed('https://jogo.example', 'https://jogo.example'));
  assert.equal(originAllowed('https://vercel.app.evil.example'), false); assert.equal(originAllowed('null'), false);
  const a = { x: 0, y: 0, z: 0, yaw: Math.PI - .1, dead: false }, b = { ...a, x: 2, yaw: -Math.PI + .1 };
  assert.equal(interpolatePose(a, b, .5).x, 1); assert.ok(Math.abs(interpolatePose(a, b, .5).yaw - Math.PI) < .001);
  assert.equal(interpolatePose(a, { ...b, x: 100 }, .1).x, 100);
});
