import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const output = path.resolve(process.env.QA_OUTPUT || 'artifacts/desktop-focus');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await context.addInitScript(() => localStorage.setItem('cdd-settings-v1', JSON.stringify({ quality: 'low', surroundings: 'off', music: false, effects: false })));
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const locked = () => page.waitForFunction(() => document.pointerLockElement === __cdd.renderer.domElement);
const check = name => checks.push(name);
try {
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:5176/?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cdd && !document.querySelector('#training').disabled, null, { timeout: 150000 });
  await page.locator('#training').click(); await page.locator('#character-list button').first().click(); await page.locator('#character-confirm').click();
  await locked(); check('desktop starts with real pointer lock');
  await page.keyboard.down('Tab'); await page.keyboard.up('Tab');
  assert.equal(await page.evaluate(() => document.activeElement === __cdd.renderer.domElement), true);
  const yaw = await page.evaluate(() => __cdd.player.yaw);
  for (let i = 0; i < 20; i++) await page.mouse.move(2000 + i * 70, 450);
  assert.equal(await page.evaluate(() => document.pointerLockElement === __cdd.renderer.domElement), true);
  assert.notEqual(await page.evaluate(() => __cdd.player.yaw), yaw); check('Tab and mouse movement beyond viewport retain capture');
  await page.keyboard.down('KeyT'); assert.equal(await page.locator('#reaction-wheel').isVisible(), true);
  assert.equal(await page.evaluate(() => document.pointerLockElement === __cdd.renderer.domElement), true);
  assert.equal(await page.locator('#reaction-wheel button').count(), 6);
  await page.screenshot({ path: path.join(output, 'interacoes-desktop.png') });
  await page.keyboard.press('ArrowRight'); await page.keyboard.up('KeyT'); await locked();
  assert.equal(await page.locator('#reaction-wheel').isVisible(), false); check('T opens all interactions and release restores aiming');
  await page.keyboard.down('KeyQ'); await page.keyboard.up('KeyQ'); await locked(); check('weapon wheel retains capture');
  await page.keyboard.press('KeyM'); assert.equal(await page.locator('#map-panel').evaluate(el => el.classList.contains('open')), true);
  await page.keyboard.press('KeyM'); await locked(); check('map closes with capture restored');
  await page.keyboard.press('KeyJ'); assert.equal(await page.locator('#combat-lab-panel').count(), 0);
  await locked(); check('training controls remain exclusively on the physical console');
  const sizes = [];
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    sizes.push(await page.locator('#minimap').evaluate(el => el.getBoundingClientRect().width));
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
  for (const id of ['btn-menu', 'actions-toggle', 'btn-reload', 'btn-camera', 'btn-jump']) assert.equal(await page.locator('#' + id).isVisible(), false, id);
  for (const id of ['ammo-hud', 'btn-weapon', 'minimap']) assert.equal(await page.locator('#' + id).isVisible(), true, id);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(output, 'hud-desktop.png') }); check('desktop HUD only shows weapon, ammunition and responsive minimap');
  await page.evaluate(() => document.exitPointerLock());
  await page.locator('#game-menu').waitFor({ state: 'visible' });
  await page.locator('#game-menu-resume').click(); await locked(); check('unexpected loss pauses and explicit resume recaptures');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.locator('#game-menu').waitFor({ state: 'visible' });
  await page.locator('#game-menu-resume').click(); await locked(); check('window blur pauses and clears capture');
  await page.keyboard.press('Escape'); await page.locator('#game-menu').waitFor({ state: 'visible' });
  await page.evaluate(() => { __cdd.renderer.domElement.requestPointerLock = () => Promise.reject(new DOMException('QA rejection', 'NotAllowedError')); });
  await page.locator('#game-menu-resume').click(); await page.locator('#game-menu').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => __cdd.player.dragMode && !__cdd.game.ui.paused), false);
  const before = await page.evaluate(() => __cdd.player.feet.toArray());
  await page.keyboard.down('KeyW'); await page.waitForTimeout(120); await page.keyboard.up('KeyW');
  assert.deepEqual(await page.evaluate(() => __cdd.player.feet.toArray()), before); check('denied capture cannot fall back to unlocked gameplay');
  await page.evaluate(() => { delete __cdd.renderer.domElement.requestPointerLock; });
  await page.locator('#game-menu-resume').click(); await locked();
  // Reuse the live avatar/weapon in a small neutral stage for fast silhouette QA.
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const a = __cdd; a.renderer.setAnimationLoop(null); a.player.avatar.stopEmote();
    a.player.placeAt(0, 0, 0);
    a.paintball.pickupWeapon('pistol'); a.paintball.setHolstered(true); a.player.setCameraMode('third');
    a.player.avatar.appearance.apply({ hairStyle: 'buns', gender: 'female', shirtStyle: 'stripes', headAccessory: 'none', faceAccessory: 'none' });
    for (let i = 0; i < 16; i++) { a.player.avatar.update(.05); a.paintball.update(.05); }
    const stage = new THREE.Scene(); stage.background = new THREE.Color('#c7d3df');
    stage.add(new THREE.HemisphereLight('#ffffff', '#73818c', 2.6));
    const light = new THREE.DirectionalLight('#ffffff', 2.5); light.position.set(-3, 6, -4); stage.add(light);
    const gun = a.scene.children.find(o => o.userData.stowSlot === 'hip');
    if (!gun) throw new Error('No holstered pistol in live scene');
    stage.add(a.player.avatar.root, gun); window.__qaStage = stage;
    stage.updateMatrixWorld(true); a.player.avatar.update(0);
    a.camera.position.copy(a.player.feet).add(new THREE.Vector3(1.75, 1.18, .2));
    a.camera.lookAt(a.player.feet.x, a.player.feet.y + 1.0, a.player.feet.z); a.camera.updateMatrixWorld(true);
    // The renderer may have cached this skeleton in the last world frame.
    a.renderer.render(stage, a.camera); a.renderer.render(stage, a.camera);
  });
  await page.locator('#hud').evaluate(el => el.style.display = 'none');
  await page.screenshot({ path: path.join(output, 'coldre-lateral.png') });
  for (const style of ['original', 'crop', 'long', 'buns', 'sidecut']) {
    await page.evaluate(async style => {
      const THREE = await import('/node_modules/three/build/three.module.js'), a = __cdd;
      a.player.avatar.appearance.apply({ hairStyle: style, headAccessory: 'none', faceAccessory: 'none', hairColor: '#303034' });
      a.player.avatar.update(0);
      a.camera.position.copy(a.player.feet).add(new THREE.Vector3(.43, 1.73, .57));
      a.camera.lookAt(a.player.feet.x, a.player.feet.y + 1.62, a.player.feet.z); a.camera.updateMatrixWorld(true); a.renderer.render(__qaStage, a.camera);
    }, style);
    await page.screenshot({ path: path.join(output, `cabelo-${style}.png`) });
    if (style === 'original') {
      await page.evaluate(async () => {
        const THREE = await import('/node_modules/three/build/three.module.js'), a = __cdd;
        a.camera.position.copy(a.player.feet).add(new THREE.Vector3(.30, 1.74, -.67));
        a.camera.lookAt(a.player.feet.x, a.player.feet.y + 1.62, a.player.feet.z); a.camera.updateMatrixWorld(true); a.renderer.render(__qaStage, a.camera);
      });
      await page.screenshot({ path: path.join(output, 'cabelo-frente.png') });
    }
  }
  check('live pistol holster and all five hair meshes rendered'); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, sizes, errors }, null, 2));
  console.log(JSON.stringify({ checks, sizes, errors, output }));
} catch (error) {
  console.error(await page.evaluate(() => window.__cdd && ({ active: __cdd.player.active, drag: __cdd.player.dragMode, locked: !!document.pointerLockElement, paused: __cdd.game.ui.paused, map: __cdd.game.ui.mapOpen, wheel: __cdd.game.ui.weaponWheelOpen, focus: document.hasFocus(), toast: document.getElementById('toast').textContent })));
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.error(JSON.stringify({ checks, errors, error: error.message })); throw error;
} finally { await browser.close(); }
