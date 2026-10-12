import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const directory = path.resolve(process.env.QA_OUTPUT || 'artifacts/mobile-controls');
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
const errors = [], reports = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
await context.addInitScript(() => localStorage.setItem('cdd-settings-v1', JSON.stringify({ quality: 'low', surroundings: 'off', music: false, effects: false })));
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const rects = () => page.evaluate(() => Object.fromEntries(['btn-reload', 'ammo-hud', 'ammo-loaded', 'ammo-reserve', 'reload-status', 'btn-aim', 'btn-fire', 'btn-weapon', 'btn-jump'].map(id => {
  const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, width: r.width, height: r.height }];
})));
const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
try {
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:5175', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cdd && !document.querySelector('#training').disabled, null, { timeout: 150000 });
  await page.screenshot({ path: path.join(directory, 'portrait-menu.png') });
  await page.locator('#training').click(); await page.locator('#character-list button').first().click(); await page.locator('#character-confirm').click();
  await page.waitForFunction(() => __cdd.player.active && __cdd.game.mode === 'training');
  for (const [label, viewport] of [['portrait', { width: 390, height: 844 }], ['narrow', { width: 320, height: 740 }], ['landscape', { width: 844, height: 390 }]]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { __cdd.player.setCameraMode('first'); __cdd.paintball.clearEffects(); __cdd.paintball.pickupWeapon('pistol'); __cdd.paintball.resetAmmo(); }); await frame();
    const before = await rects();
    const cx = r => r.x + r.width / 2;
    assert.ok(Math.abs(cx(before['btn-reload']) - cx(before['btn-aim'])) < .1, 'reload aligns with aim');
    assert.ok(Math.abs(cx(before['btn-reload']) - cx(before['btn-weapon'])) < .1, 'reload aligns with weapon');
    assert.ok(Math.abs(cx(before['ammo-hud']) - cx(before['btn-fire'])) < .1, 'ammo aligns with attack');
    assert.ok(Math.abs(cx(before['ammo-hud']) - cx(before['btn-jump'])) < .1, 'ammo aligns with jump');
    assert.ok(Math.abs(before['btn-reload'].y + before['btn-reload'].height / 2 - before['ammo-hud'].y - before['ammo-hud'].height / 2) < .1);
    await page.evaluate(() => __cdd.paintball.shoot()); await frame(); await page.locator('#btn-reload').click();
    await page.waitForFunction(() => __cdd.paintball.ammo.reloading && __cdd.paintball.ammo.progress > .1);
    assert.deepEqual(await rects(), before, 'reload text and progress cannot resize or move any controls');
    assert.match(await page.locator('#reload-status').innerText(), /\d\.\ds/);
    await page.screenshot({ path: path.join(directory, `${label}-reload.png`) });
    await page.waitForFunction(() => !__cdd.paintball.ammo.reloading, null, { timeout: 15000 });
    assert.deepEqual(await rects(), before, 'reload completion cannot move the controls');
    for (const weapon of ['automatic', 'sniper', 'revolver']) {
      await page.evaluate(weapon => __cdd.paintball.pickupWeapon(weapon), weapon); await frame();
      assert.deepEqual(await rects(), before, 'one/two digit magazines and two/three digit reserves keep identical boxes');
    }
    const inactive = await page.locator('#btn-crouch').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.locator('#btn-crouch').click();
    assert.equal(await page.locator('#btn-crouch').getAttribute('aria-pressed'), 'true');
    assert.notEqual(await page.locator('#btn-crouch').evaluate(el => getComputedStyle(el).backgroundColor), inactive);
    await page.screenshot({ path: path.join(directory, `${label}-crouched.png`) }); await page.locator('#btn-crouch').click();
    await page.locator('#actions-toggle').click();
    const colors = new Set();
    for (let i = 0; i < 3; i++) {
      await page.locator('#btn-color').click(); colors.add(await page.evaluate(() => __cdd.paintball.color.id));
      assert.equal(await page.locator('#more-actions').isVisible(), true);
    }
    assert.equal(colors.size, 3); assert.equal(await page.locator('#btn-orientation').count(), 0);
    await page.mouse.click(viewport.width - 12, viewport.height / 2);
    assert.equal(await page.locator('#more-actions').isVisible(), false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false); reports.push({ label, boxes: before, colors: [...colors], overflow });
  }
  await page.evaluate(() => { __cdd.player.setCameraMode('third'); __cdd.paintball.pickupWeapon('pistol'); __cdd.paintball.setHolstered(true); __cdd.player.avatar.appearance.apply({ hairStyle: 'original', hairColor: '#aa8a32', headAccessory: 'headphones', shirtStyle: 'suitTie' }); });
  await page.setViewportSize({ width: 780, height: 780 }); await frame();
  // Inspect both side/back silhouettes with the real avatar and holstered model.
  await page.evaluate(() => {
    const { player, camera, renderer, scene } = __cdd; renderer.setAnimationLoop(null);
    player.avatar.update(.05); __cdd.paintball.update(.05);
    camera.position.copy(player.feet).add({ x: 2, y: 1.35, z: 1.2 }); camera.lookAt(player.feet.x, player.feet.y + 1.2, player.feet.z); camera.updateMatrixWorld(true); renderer.render(scene, camera);
  });
  await page.screenshot({ path: path.join(directory, 'hair-holster-side.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ reports, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, viewports: reports.map(r => r.label), errors, directory }));
} catch (error) {
  await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  console.log(JSON.stringify({ error: error.message, errors })); throw error;
} finally { await browser.close(); }
