import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const output = path.resolve(process.env.QA_OUTPUT || 'artifacts/settings-layout');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
await context.addInitScript(() => localStorage.setItem('cdd-settings-v1', JSON.stringify({ quality: 'low', surroundings: 'off', music: false, effects: false })));
const page = await context.newPage(), errors = [], layouts = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const locked = () => page.waitForFunction(() => document.pointerLockElement === __cdd.renderer.domElement);
const menu = page.locator('#game-menu');
try {
  await page.goto(process.env.QA_URL || 'http://127.0.0.1:5176/?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cdd && !document.querySelector('#training').disabled, null, { timeout: 150000 });
  await page.locator('#training').click(); await page.locator('#character-list button').first().click(); await page.locator('#character-confirm').click();
  await locked();
  for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const game = __cdd.game;
      game.events.emit('combatdeath', { source: game.combat.player, victim: { id: 'zombie-1', kind: 'zombie' }, weapon: game.paintball.weapons[0], region: 'head' });
    });
    const layout = await page.evaluate(() => {
      const map = document.getElementById('minimap').getBoundingClientRect(), feed = document.getElementById('death-feed').getBoundingClientRect();
      return { width: innerWidth, mapWidth: map.width, mapBottom: map.bottom, feedTop: feed.top, mapRight: map.right, feedRight: feed.right };
    });
    assert.ok(layout.feedTop >= layout.mapBottom + 10, JSON.stringify(layout));
    assert.equal(layout.feedRight, layout.mapRight); layouts.push(layout);
    if (width === 1280) await page.screenshot({ path: path.join(output, 'kills-abaixo-minimapa.png') });
  }
  checks.push('kill feed remains below and aligned with the responsive minimap');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.exitPointerLock()); await menu.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#game-menu-title').textContent(), 'Configurações');
  assert.equal(await page.locator('#combat-lab-panel, #combat-lab-toggle, #session-mode-actions').count(), 0);
  assert.ok(await page.evaluate(() => __cdd.game.combat.trainingLab.buttons.length > 0));
  await page.locator('#game-menu-title').click(); assert.equal(await menu.isVisible(), true);
  const slider = await page.locator('#session-effectsVolume').boundingBox();
  await page.mouse.move(slider.x + slider.width / 2, slider.y + slider.height / 2); await page.mouse.down();
  await page.mouse.move(8, 400); await page.mouse.up(); assert.equal(await menu.isVisible(), true);
  await page.screenshot({ path: path.join(output, 'configuracoes.png') });
  checks.push('plain title, physical training console retained, inside clicks and slider drags do not dismiss');
  await page.mouse.click(8, 400); await locked(); assert.equal(await menu.isVisible(), false);
  checks.push('page backdrop click resumes and recaptures the cursor');
  // Headless Chrome can report both tabs focused. Exercise the blur/focus
  // events and the focus guard explicitly, keeping real pointer-lock clicks.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await menu.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.pointerLockElement);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
  });
  await page.mouse.click(8, 400); assert.equal(await menu.isVisible(), true);
  assert.equal(await page.evaluate(() => !!document.pointerLockElement), false);
  await page.evaluate(() => { delete document.hasFocus; });
  await page.mouse.click(8, 400); await locked();
  checks.push('blur pauses, focus alone does not resume, unfocused clicks are ignored');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ layouts, checks, errors }, null, 2));
  console.log(JSON.stringify({ layouts, checks, errors }));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error;
} finally { await browser.close(); }
