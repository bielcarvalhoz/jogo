import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';
import { createMultiplayerServer } from '../server/index.js';
import { updateHumanoidHitboxes } from '../src/gameplay/combat/hitboxes.js';
import { EV } from '../src/shared/multiplayer.js';

// Application-packet emulator: real browser, Socket.IO and authority on both
// sides. Snapshot drops emulate missing updates; they do not claim UDP loss.
const app = await createMultiplayerServer();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const proxyServer = http.createServer(), proxy = new Server(proxyServer);
const link = { rtt: 0, jitter: 0, dropEvery: 0 }, results = [], acknowledgements = [];
let serial = 0;
proxy.on('connection', downstream => {
  const upstream = connect(`http://127.0.0.1:${app.server.address().port}`, { transports: ['websocket'] });
  const timers = new Set();
  const later = fn => {
    const delay = Math.max(0, link.rtt / 2 + (serial++ % 3 - 1) * link.jitter);
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay); timers.add(timer);
  };
  let snapshots = 0;
  upstream.onAny((event, ...args) => {
    if (event === EV.snapshot && link.dropEvery && ++snapshots % link.dropEvery === 0) return;
    later(() => downstream.emit(event, ...args));
  });
  downstream.onAny((event, ...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
    later(() => upstream.emit(event, ...args, ...(ack ? [reply => {
      if (event === EV.action && args[0]?.type === 'attack') acknowledgements.push({ ...reply, timing: { shotTime: args[0].shotTime, viewTime: args[0].viewTime, receivedAt: app.hub.rooms.values().next().value?.sim.sim.time } });
      later(() => ack(reply));
    }] : [])));
  });
  downstream.on('disconnect', () => { for (const timer of timers) clearTimeout(timer); upstream.disconnect(); });
});
await new Promise(resolve => proxyServer.listen(0, '127.0.0.1', resolve));
const vite = await createViteServer({ server: { host: '127.0.0.1', port: 5189, strictPort: false }, logLevel: 'error' }); await vite.listen();
const directory = path.resolve('artifacts/latency'); await fs.mkdir(directory, { recursive: true });
let browser, page;
try {
  const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('cdd-settings-v1', JSON.stringify({ quality: 'low', surroundings: 'off', music: false, effects: false })));
  page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${vite.resolvedUrls.local[0]}?server=${encodeURIComponent(`http://127.0.0.1:${proxyServer.address().port}`)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cdd && !document.querySelector('#play').disabled, null, { timeout: 150000 });
  await page.locator('#play').click(); await page.locator('#treta-multi').click();
  await page.waitForFunction(() => __cdd.game.multiplayer.network.status === 'connected');
  await page.locator('#mp-create').click(); await page.locator('#character-list button').first().click(); await page.locator('#character-confirm').click();
  await page.waitForFunction(() => __cdd.game.mode === 'multiplayer' && __cdd.game.multiplayer.network.ready);
  await page.locator('#mp-ready').click(); await page.waitForFunction(() => __cdd.game.multiplayer.canAct);
  const room = app.hub.rooms.values().next().value, player = room.sim.players.values().next().value, field = app.world.landmarks.field;
  player.entity.position = { x: field.x - 10, y: app.world.terrain.heightAt(field.x - 10, field.z + 3), z: field.z + 3 };
  player.entity.protectedUntil = 0; player.life++; player.entity.networkLife = player.life; updateHumanoidHitboxes(player.entity);
  await page.waitForFunction(life => __cdd.game.multiplayer.self.life === life, player.life);
  await page.evaluate(() => {
    __cdd.player.setCameraMode('first'); __cdd.game.paintball.setWeapon('automatic'); __cdd.game.paintball.setAiming(true);
    window.__qaTarget = null; window.__qaLocalHits = [];
    const mp = __cdd.game.multiplayer, original = mp.predictImpact.bind(mp);
    mp.predictImpact = (hit, info) => { window.__qaLocalHits.push({ id: hit.entity?.id, shotId: info.shotId }); original(hit, info); };
    __cdd.game.engine.addSystem(() => {
      const target = mp.zombies.get(window.__qaTarget)?.entity;
      if (!target || target.dead) return;
      // Aim through the displayed model, with no velocity/latency lead.
      __cdd.game.engine.camera.lookAt(target.position.x, target.position.y + 1.84, target.position.z + .12);
      __cdd.player.updateCamera();
    }, 'late');
  });
  let target = null;
  const step = room.sim.step.bind(room.sim);
  room.sim.step = dt => {
    if (target && !target.dead) {
      target.position.x = field.x - 10 + Math.sin(room.sim.sim.time * 3) * 1.2;
      target.position.y = app.world.terrain.heightAt(target.position.x, target.position.z);
      updateHumanoidHitboxes(target);
    }
    step(dt);
    if (target && !target.dead) target.action = 'walk';
  };
  for (const scenario of [
    { rtt: 0, jitter: 0, dropEvery: 0 }, { rtt: 80, jitter: 0, dropEvery: 0 },
    { rtt: 160, jitter: 10, dropEvery: 0 }, { rtt: 300, jitter: 15, dropEvery: 20 },
  ]) {
    Object.assign(link, scenario);
    await page.evaluate(() => { __cdd.game.multiplayer.network.rttSamples = []; });
    await page.waitForTimeout(2300);
    let hits = 0;
    for (let trial = 0; trial < 5; trial++) {
      if (target) room.sim.sim.remove(target);
      target = room.sim.sim.spawn({ kind: 'zombie', stationary: true, position: { x: field.x - 10, y: field.y, z: field.z - 1 } });
      await page.evaluate(id => { window.__qaTarget = id; }, target.id);
      await page.waitForFunction(id => __cdd.game.multiplayer.zombies.has(id), target.id);
      await page.waitForTimeout(250);
      const shot = await page.evaluate(() => {
        const p = __cdd.game.paintball; p.setAiming(true); const fired = p.shoot();
        return { fired, shotId: p.stats.shots, pingMs: __cdd.game.multiplayer.network.latency, interpolationMs: __cdd.game.multiplayer.interpolationMs };
      });
      assert.equal(shot.fired, true);
      let confirmed = false;
      try { await page.waitForFunction(id => __cdd.game.multiplayer.snapshot.zombies.some(z => z.id === id && z.dead), target.id, { timeout: 2500 }); confirmed = true; } catch { /* keep the failed trial in the report */ }
      if (confirmed) hits++;
      results.push({ ...scenario, trial, ...shot, confirmed, serverHealth: target.health.current,
        acknowledgement: acknowledgements.find(a => a.shotId === shot.shotId) });
    }
    console.log(JSON.stringify({ scenario, hits, shots: 5 }));
  }
  await page.screenshot({ path: path.join(directory, 'moving-zombie-300ms.png') });
  const localHits = await page.evaluate(() => window.__qaLocalHits);
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ results, localHits, acknowledgements, errors }, null, 2));
  assert.deepEqual(errors, []); assert.ok(results.every(r => r.confirmed), 'all displayed-model headshots must be confirmed under the emulated link');
  // Snapshot blackout must disable fresh combat; updates restore it.
  Object.assign(link, { rtt: 0, jitter: 0, dropEvery: 1 });
  await page.waitForFunction(() => __cdd.game.multiplayer.connectionStale && !__cdd.game.multiplayer.canAct, null, { timeout: 3000 });
  link.dropEvery = 0; await page.waitForFunction(() => __cdd.game.multiplayer.canAct);
  console.log(JSON.stringify({ ok: true, headshots: results.length, staleRecovery: true, report: path.join(directory, 'report.json') }));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify({ error: error.message, results, acknowledgements }, null, 2)); throw error;
} finally {
  await browser?.close(); await vite.close(); await new Promise(resolve => proxy.close(resolve)); await app.close();
}
