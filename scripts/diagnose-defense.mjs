import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { loadServerWorld } from '../server/world.js';
import { createFlowField } from '../src/gameplay/combat/flow-field.js';
import { EV, NET } from '../src/shared/multiplayer.js';

const endpoint = process.argv[2];
if (!endpoint) throw new Error('Uso: node scripts/diagnose-defense.mjs https://SERVIDOR.onrender.com');
const world = await loadServerWorld();
const navigation = createFlowField({ bounds: world.bounds, cellSize: 1.25, radius: .4, guardGrid: true,
  isBlocked: (x, z, r) => !world.free(x, z, r),
  isSegmentClear: (a, b, r) => world.segmentClear({ ...a, y: world.terrain.heightAt(a.x, a.z) }, { ...b, y: world.terrain.heightAt(b.x, b.z) }, r),
});
navigation.setObstacles(world.obstacles);
const socket = io(new URL(endpoint).origin, { transports: ['websocket'], timeout: 15000 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { at: new Date().toISOString(), url: new URL(endpoint).origin, samples: [], snapshots: [] };
let welcome, latest, self, local, seq = 0, phase = 'travel', previous, pingTimer, pingPending = false;
const pending = new Map();
socket.on(EV.snapshot, snapshot => {
  latest = snapshot; const at = performance.now(); self = snapshot.players.find(p => p.id === welcome?.selfId);
  if (phase === 'defense') {
    report.snapshots.push({ at, simTime: snapshot.time, zombies: snapshot.zombies.filter(z => !z.dead).length,
      intervalMs: previous ? at - previous : null }); previous = at;
  }
  if (self && local && pending.has(self.seq)) {
    const accepted = pending.get(self.seq), dx = self.x - accepted.x, dz = self.z - accepted.z;
    local.x += dx; local.z += dz;
    for (const [id, pose] of pending) if (id <= self.seq) pending.delete(id); else { pose.x += dx; pose.z += dz; }
  }
});
try {
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const receiving = new Promise(resolve => socket.once(EV.welcome, resolve));
  const reply = await socket.timeout(10000).emitWithAck(EV.create, { name: 'Diagnóstico defesa Prata', character: { name: 'Diagnóstico' }, protocol: NET.protocol });
  if (!reply.ok) throw new Error(reply.message);
  welcome = await receiving;
  const start = welcome.snapshot.players.find(p => p.id === welcome.selfId);
  local = { x: start.x, y: start.y, z: start.z };
  socket.emit(EV.action, { type: 'ready', ready: true });
  while (latest?.phase !== 'running') await sleep(30);
  pingTimer = setInterval(async () => {
    if (pingPending) return; pingPending = true; const at = performance.now(), current = phase;
    try { await socket.timeout(3000).emitWithAck('latency:ping', {}); report.samples.push({ phase: current, rttMs: performance.now() - at }); }
    catch { report.samples.push({ phase: current, timeout: true }); } finally { pingPending = false; }
  }, 500);
  const goal = navigation.nearestFree(world.landmarks.defense), began = performance.now(); let last = began, nextLog = began;
  while (Math.hypot(local.x - goal.x, local.z - goal.z) > 2) {
    const at = performance.now(), dt = Math.min(.1, (at - last) / 1000); last = at;
    if (at - began > 100000) throw new Error('Navigation did not reach the Prata within 100 seconds');
    const to = navigation.waypoint(local, goal); if (!to) throw new Error('No surveyed route to the Prata');
    const dx = to.x - local.x, dz = to.z - local.z, size = Math.hypot(dx, dz), step = Math.min(size, dt * 7);
    if (size > 1e-6) { local.x += dx / size * step; local.z += dz / size * step; }
    local.y = world.groundAt?.(local.x, local.z, local.y + .7) ?? world.terrain.heightAt(local.x, local.z);
    const pose = { ...local, seq: ++seq, yaw: Math.atan2(-dx, -dz), weapon: 'pistol' };
    pending.set(seq, { ...pose }); socket.volatile.emit(EV.pose, pose);
    if (at >= nextLog) { console.log(JSON.stringify({ phase: 'travel', remainingMeters: Math.round(Math.hypot(local.x - goal.x, local.z - goal.z)) })); nextLog = at + 10000; }
    await sleep(33);
  }
  await sleep(700); socket.emit(EV.action, { type: 'interact', game: 'defense' });
  const deadline = performance.now() + 5000;
  while (latest.defense.status !== 'running') { if (performance.now() > deadline) throw new Error('The authority did not start the defense'); await sleep(50); }
  phase = 'defense'; report.travelSeconds = (performance.now() - began) / 1000;
  console.log(JSON.stringify({ phase: 'defense', wave: latest.defense.wave, zombies: latest.zombies.length }));
  await sleep(25000); report.defense = latest.defense;
  const summarize = values => { const a = values.sort((a, b) => a - b); return { count: a.length, p50: a[Math.floor(a.length * .5)], p95: a[Math.floor(a.length * .95)], max: a.at(-1) }; };
  report.summary = { pingDuringDefenseMs: summarize(report.samples.filter(s => s.phase === 'defense' && !s.timeout).map(s => s.rttMs)),
    snapshotIntervalMs: summarize(report.snapshots.map(s => s.intervalMs).filter(Number.isFinite)),
    maxZombies: Math.max(...report.snapshots.map(s => s.zombies)), timeouts: report.samples.filter(s => s.timeout).length };
  const directory = path.resolve('artifacts/network'); await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, `defense-${report.at.replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ok: true, ...report.summary, report: output }));
} finally {
  clearInterval(pingTimer);
  if (welcome && socket.connected) await socket.timeout(3000).emitWithAck(EV.leave, {}).catch(() => {});
  socket.disconnect();
}
