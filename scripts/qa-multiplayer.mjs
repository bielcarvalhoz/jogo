import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';
import { createMultiplayerServer } from '../server/index.js';
import { updateHumanoidHitboxes } from '../src/gameplay/combat/hitboxes.js';

// Real browser clients, real Socket.IO, surveyed campus and Rapier server.
// CHROMIUM_PATH may point at an installed Chrome/Chromium executable.
const app = await createMultiplayerServer();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const serverUrl = `http://127.0.0.1:${app.server.address().port}`;
const vite = await createViteServer({ server: { host: '127.0.0.1', port: 5187, strictPort: false }, logLevel: 'warn' }); await vite.listen();
const webUrl = `${vite.resolvedUrls.local[0]}?server=${encodeURIComponent(serverUrl)}`;
const directory = path.resolve('artifacts/multiplayer'); await fs.mkdir(directory, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
let browser;
try {
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
  const clients = [], errors = [], reports = [];
  for (const [label, viewport, touch] of [['desktop', { width: 1280, height: 800 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('cdd-settings-v1', JSON.stringify({ quality: 'low', surroundings: 'off', music: false, effects: false })));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cdd && !document.querySelector('#play').disabled, null, { timeout: 150000 });
    await page.locator('#play').click(); await page.locator('#treta-multi').click();
    await page.waitForFunction(() => window.__cdd.game.multiplayer.network.status === 'connected');
    await page.screenshot({ path: path.join(directory, `${label}-rooms.png`) });
    if (!clients.length) { await page.locator('#mp-room-name').fill('Sala de teste'); await page.locator('#mp-create').click(); }
    else { await page.locator('#mp-room-list button').first().click(); }
    await page.locator('#character-list button').first().click(); await page.locator('#character-edit').click();
    await page.locator('#character-name').fill(touch ? 'Colega' : 'Biel');
    if (!touch) {
      const preview = await page.locator('#character-preview canvas').boundingBox();
      async function rotate(amount) { await page.mouse.move(preview.x + preview.width / 2, preview.y + preview.height / 2); await page.mouse.down(); await page.mouse.move(preview.x + preview.width / 2 + amount, preview.y + preview.height / 2, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(200); }
      for (const hairStyle of ['original', 'crop', 'long', 'buns', 'sidecut']) {
        await page.locator('#character-hairStyle').selectOption(hairStyle); await rotate(190);
        await page.screenshot({ path: path.join(directory, `hair-${hairStyle}-back.png`) }); await rotate(-190);
      }
      await page.locator('#character-hairColor').fill('#b8792b');
      for (const headAccessory of ['cap', 'beanie']) {
        await page.locator('#character-headAccessory').selectOption(headAccessory); await rotate(190);
        await page.screenshot({ path: path.join(directory, `hair-${headAccessory}-nape.png`) }); await rotate(-190);
      }
      await page.locator('#character-headAccessory').selectOption('none'); await page.locator('#character-hairColor').fill('#503b2d');
    }
    for (const [key, value] of Object.entries({ hairStyle: touch ? 'long' : 'buns', shirtStyle: touch ? 'socialTie' : 'suitTie', pantsStyle: 'dress', shoeStyle: 'dress' })) await page.locator(`#character-${key}`).selectOption(value);
    await page.waitForTimeout(200); await page.screenshot({ path: path.join(directory, `${label}-banker.png`) });
    await page.locator('#character-save').click(); await page.locator('#character-confirm').click();
    await page.waitForFunction(() => __cdd.game.mode === 'multiplayer' && __cdd.player.active && __cdd.game.multiplayer.network.ready, null, { timeout: 30000 });
    clients.push({ context, page, label });
  }
  const [a, b] = clients.map(c => c.page);
  await a.waitForFunction(() => __cdd.game.multiplayer.snapshot.players.length === 2 && __cdd.game.multiplayer.views.size === 1);
  await b.waitForFunction(() => __cdd.game.multiplayer.views.size === 1);
  const room = app.hub.rooms.values().next().value;
  const positions = [...room.sim.players.values()].map(p => p.entity.position);
  assert.ok(Math.hypot(positions[0].x - positions[1].x, positions[0].z - positions[1].z) >= 1.4);
  assert.equal(room.sim.snapshot().phase, 'waiting');
  await a.locator('#mp-ready').click(); await a.waitForTimeout(200); assert.equal(room.sim.snapshot().phase, 'waiting');
  await a.screenshot({ path: path.join(directory, 'desktop-approval.png') });
  await b.locator('#mp-ready').click(); await a.waitForFunction(() => __cdd.game.multiplayer.snapshot.phase === 'running');
  await b.waitForFunction(() => __cdd.game.multiplayer.canAct);
  await a.keyboard.down('Tab'); assert.equal(await a.locator('#mp-ranking').isVisible(), true);
  assert.equal(await a.locator('#mp-ranking tbody tr').count(), 2);
  await a.screenshot({ path: path.join(directory, 'desktop-ranking.png') }); await a.keyboard.up('Tab');
  assert.equal(await a.locator('#mp-ranking').isVisible(), false);
  await a.keyboard.down('KeyG'); await a.keyboard.press('ArrowRight');
  assert.equal(await a.locator('#reaction-wheel').isVisible(), true);
  await a.screenshot({ path: path.join(directory, 'desktop-reactions.png') });
  await a.keyboard.press('Escape'); await a.keyboard.up('KeyG');
  await b.locator('#actions-toggle').click(); await b.locator('#btn-reactions').click(); await b.getByRole('menuitem', { name: 'Dançar', exact: true }).click();
  await a.waitForFunction(() => [...__cdd.game.multiplayer.views.values()].some(v => v.avatar.animationState.motion === 'Dance_Loop'));
  assert.equal(await a.locator('.reaction-bubble').count(), 0);
  assert.equal(await a.evaluate(() => __cdd.game.engine.scene.children.some(o => o.name.startsWith('kenney-reaction-'))), false, 'dance has no extra emoji');
  await b.waitForTimeout(1100);
  await b.evaluate(() => __cdd.game.ui.reactions.react('smile'));
  await a.waitForFunction(() => __cdd.game.engine.scene.children.some(o => o.name === 'kenney-reaction-smile'));
  await a.screenshot({ path: path.join(directory, 'desktop-dance.png') });
  await a.keyboard.down('KeyW'); await a.waitForTimeout(500); await a.keyboard.up('KeyW');
  await a.waitForTimeout(250);
  const movement = await a.evaluate(() => ({ local: __cdd.player.feet.toArray(), authoritative: __cdd.game.multiplayer.self }));
  assert.ok(Math.hypot(movement.local[0] - movement.authoritative.x, movement.local[2] - movement.authoritative.z) < 1);
  await a.keyboard.press('KeyT');
  await b.waitForFunction(() => __cdd.game.multiplayer.snapshot.players.some(p => p.emote?.id === 'wave'));
  // Verify map open/close retains this multiplayer session and cannot teleport.
  await b.evaluate(() => __cdd.game.ui.openMap()); await b.locator('#map-close').click();
  assert.equal(await b.evaluate(() => __cdd.game.mode), 'multiplayer');
  assert.equal(room.members.size, 2);
  const oldId = await a.evaluate(() => __cdd.game.multiplayer.network.session.selfId);
  await a.evaluate(() => __cdd.game.multiplayer.network.socket.io.engine.close());
  await a.waitForFunction(id => __cdd.game.multiplayer.network.ready && __cdd.game.multiplayer.network.session.selfId === id, oldId, { timeout: 20000 });
  await a.waitForTimeout(500); assert.equal(room.members.size, 2);
  // WebRTC is optional, but Chromium on one machine should establish it.
  await a.waitForFunction(() => __cdd.game.multiplayer.peerCount === 1, null, { timeout: 20000 });
  await a.evaluate(() => __cdd.game.multiplayer.network.emit('disconnect'));
  assert.equal(await a.evaluate(() => __cdd.game.multiplayer.peerCount), 0);
  await a.waitForFunction(() => __cdd.game.multiplayer.views.size === 1);
  for (const client of clients) {
    await client.page.screenshot({ path: path.join(directory, `${client.label}-playing.png`) });
    reports.push(await client.page.evaluate(() => ({ mode: __cdd.game.mode, players: __cdd.game.multiplayer.snapshot.players.length, active: __cdd.player.active, peerCount: __cdd.game.multiplayer.peerCount, self: __cdd.game.multiplayer.self, overflow: document.documentElement.scrollWidth > innerWidth })));
  }
  // Fixture placement belongs to the authority, so the real clients exercise
  // respawn reconciliation, their existing gun trigger and the actual UI.
  const [pa, pb] = [...room.sim.players.values()], field = app.world.landmarks.field;
  function relocate(p, x, z) {
    p.entity.position = { x, y: app.world.terrain.heightAt(x, z), z }; p.entity.yaw = 0; p.entity.protectedUntil = 0;
    updateHumanoidHitboxes(p.entity); p.life++; p.budget = 0;
  }
  relocate(pa, field.x - 4, field.z + 5); relocate(pb, field.x - 4, field.z - 5);
  await a.waitForFunction(life => __cdd.game.multiplayer.self.life === life && Math.hypot(__cdd.player.feet.x - __cdd.game.multiplayer.self.x, __cdd.player.feet.z - __cdd.game.multiplayer.self.z) < .2, pa.life);
  await b.waitForFunction(life => __cdd.game.multiplayer.self.life === life, pb.life);
  await a.evaluate(id => {
    const target = __cdd.game.multiplayer.snapshot.players.find(p => p.id === id);
    __cdd.player.setCameraMode('first'); __cdd.game.engine.camera.lookAt(target.x, target.y + 1.15, target.z); __cdd.player.updateCamera();
    __cdd.game.paintball.setWeapon('automatic'); __cdd.game.paintball.setAiming(true); __cdd.game.paintball.setTrigger(true);
  }, pb.entity.id);
  await b.waitForFunction(() => __cdd.game.multiplayer.self.dead, null, { timeout: 10000 });
  await a.evaluate(() => { __cdd.game.paintball.setTrigger(false); __cdd.game.paintball.setAiming(false); });
  assert.equal(pa.entity.stats.kills, 1); assert.equal(pb.entity.stats.deaths, 1);
  await b.locator('#death-feed li').first().waitFor({ state: 'visible' });
  assert.match(await b.locator('#death-feed').innerText(), /Biel.*M4A4.*Colega/s);
  assert.ok(await b.locator('#death-feed').evaluate(el => el.getBoundingClientRect().height < 100));
  await b.screenshot({ path: path.join(directory, 'mobile-friendly-fire.png') });
  await b.waitForFunction(() => !__cdd.game.multiplayer.self.dead, null, { timeout: 6000 });
  relocate(pa, field.x - 4, field.z); relocate(pb, field.x + 4, field.z);
  await a.waitForFunction(() => __cdd.game.multiplayer.nearby?.id === 'football');
  await b.waitForFunction(() => __cdd.game.multiplayer.nearby?.id === 'football');
  await b.locator('#mp-interact').click();
  await b.waitForFunction(() => __cdd.game.multiplayer.snapshot.football.status === 'running');
  const wood = room.sim.physics.crates[0], u = -(field.halfLength + wood.half - .12);
  wood.body.setTranslation({ x: field.x + field.ux * u, y: field.y + .63, z: field.z + field.uz * u }, true);
  wood.body.setLinvel({ x: -field.ux * 20, y: 0, z: -field.uz * 20 }, true); wood.lastTouch = pa.entity.id;
  await b.waitForFunction(() => __cdd.game.multiplayer.snapshot.football.score[0] === 1);
  assert.equal(await b.locator('.mp-emotes').count(), 0, 'emoji choices only appear inside the reaction wheel');
  await b.screenshot({ path: path.join(directory, 'mobile-football.png') });
  const defense = app.world.landmarks.defense; relocate(pa, defense.x, defense.z);
  await a.waitForFunction(() => __cdd.game.multiplayer.nearby?.id === 'defense');
  await a.keyboard.press('KeyE');
  await a.waitForFunction(() => __cdd.game.multiplayer.zombies.size >= 8);
  await b.waitForFunction(() => __cdd.game.multiplayer.snapshot.defense.wave === 1 && __cdd.game.multiplayer.zombies.size >= 8);
  await a.screenshot({ path: path.join(directory, 'desktop-defense.png') });
  const activities = { friendlyFire: { kills: pa.entity.stats.kills, deaths: pb.entity.stats.deaths }, football: [...room.sim.football.score], defense: { ...room.sim.defense } };
  assert.deepEqual(errors, []);
  assert.ok(reports.every(r => !r.overflow));
  await b.locator('#btn-menu').click(); await a.evaluate(() => __cdd.game.ui.showMenu());
  await a.waitForFunction(() => __cdd.game.mode === null && !__cdd.game.multiplayer.network.session);
  assert.equal(app.hub.rooms.size, 0);
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ reports, errors, movement, activities }, null, 2));
  console.log(JSON.stringify({ ok: true, clients: reports.length, errors, screenshots: directory }));
} catch (error) {
  const state = [];
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    state.push(await page.evaluate(() => window.__cdd ? ({ self: __cdd.game.multiplayer.self, feet: __cdd.player.feet.toArray(), camera: __cdd.game.engine.camera.position.toArray(), rotation: __cdd.game.engine.camera.rotation.toArray(), canAct: __cdd.game.multiplayer.canAct, playerActive: __cdd.player.active, mode: __cdd.game.mode, shots: __cdd.game.paintball.shots }) : null).catch(() => null));
    await page.screenshot({ path: path.join(directory, `failure-${state.length}.png`) }).catch(() => {});
  }
  console.log(JSON.stringify({ failure: error.message, state })); throw error;
} finally { await browser?.close(); await vite.close(); await app.close(); }
