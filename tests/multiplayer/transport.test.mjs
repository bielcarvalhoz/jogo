import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { createMultiplayerServer } from '../../server/index.js';
import { MultiplayerNetwork } from '../../src/gameplay/multiplayer/network.js';
import { EV } from '../../src/shared/multiplayer.js';

test('blocked WebSocket falls back to delayed HTTP, sends fresh snapshots under backpressure and resumes the same identity', async t => {
  const at = { x: 50, y: 0, z: 50 };
  const world = { terrain: { heightAt: () => 0 }, bounds: { x0: -80, x1: 80, z0: -80, z1: 80 }, obstacles: [],
    free: () => true, segmentClear: () => true, trace: () => null,
    landmarks: { spawn: { x: 0, y: 0, z: 5 }, inward: { x: 0, z: -1 }, defense: at, field: at, portals: [] },
    createCrates: () => ({ crates: [{ half: .6, spawn: at, body: { translation: () => at } }],
      trace: () => null, step() {}, snapshot: () => [], dispose() {} }),
  };
  const app = await createMultiplayerServer({ world });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const outgoing = new Set(), timers = new Set();
  const later = fn => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, 80); timers.add(timer); };
  const proxy = http.createServer((req, res) => later(() => {
    if (req.destroyed || res.destroyed) return;
    const upstream = http.request({ hostname: '127.0.0.1', port: app.server.address().port, path: req.url, method: req.method, headers: req.headers }, response => later(() => {
      if (res.destroyed) { response.destroy(); return; }
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    }));
    outgoing.add(upstream); upstream.on('close', () => outgoing.delete(upstream)); upstream.on('error', () => res.destroy()); req.pipe(upstream);
  }));
  proxy.on('upgrade', (_, socket) => socket.destroy());
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const network = new MultiplayerNetwork({ url: `http://127.0.0.1:${proxy.address().port}` });
  t.after(async () => { network.close(); for (const timer of timers) clearTimeout(timer); for (const request of outgoing) request.destroy(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); await app.close(); });
  await network.open(); assert.equal(network.transport, 'polling');
  await network.create('Delayed HTTP', { name: 'Test' });
  const id = network.session.selfId, snapshots = [];
  network.on(EV.snapshot, data => snapshots.push({ data, at: performance.now() }));
  network.action({ type: 'ready', ready: true });
  await new Promise(resolve => setTimeout(resolve, 4000));
  assert.ok(snapshots.length >= 12, `polling must keep delivering current state; got ${snapshots.length} snapshots`);
  const intervals = snapshots.slice(1).map((p, i) => p.at - snapshots[i].at).sort((a, b) => a - b);
  assert.ok(intervals[Math.floor(intervals.length * .95)] < 700, 'backpressure cannot starve updates for seconds');
  for (let i = 1; i < snapshots.length; i++) assert.ok(snapshots[i].data.time >= snapshots[i - 1].data.time);
  const room = app.hub.rooms.values().next().value;
  assert.ok(room.sim.sim.time - snapshots.at(-1).data.time < .4, 'a poll must carry the newest world, not a backlog');
  network.socket.io.engine.close(); assert.equal(network.ready, false);
  const deadline = performance.now() + 10000;
  while (!network.ready) { if (performance.now() > deadline) assert.fail('HTTP reconnection did not resume'); await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.equal(network.session.selfId, id); assert.equal(room.members.size, 1);
});
