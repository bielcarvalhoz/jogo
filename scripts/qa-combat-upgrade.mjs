import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const directory = path.resolve(process.env.QA_OUTPUT || 'artifacts/combat-upgrade');
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-sandbox'] });
const errors = [], reports = [];
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: label === 'mobile', isMobile: label === 'mobile' });
    await context.addInitScript(() => localStorage.setItem('cdd-settings-v1', JSON.stringify({ quality: 'low', surroundings: 'off', music: false, effects: true })));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cdd && !document.querySelector('#training').disabled, null, { timeout: 150000 });
    await page.locator('#training').click(); await page.locator('#character-list button').first().click(); await page.locator('#character-confirm').click();
    await page.waitForFunction(() => __cdd.player.active && __cdd.game.mode === 'training');
    await page.evaluate(async () => { await __cdd.game.audio.unlock(); await __cdd.game.audio.preload(); });
    const audio = await page.evaluate(() => __cdd.game.audio.state.recordings);
    assert.deepEqual(audio.failed, []); assert.equal(audio.loaded, 41);
    await page.screenshot({ path: path.join(directory, `${label}-compact.png`) });
    if (label === 'desktop') await page.keyboard.press('KeyH'); else await page.locator('#help-toggle').click();
    assert.equal(await page.locator('#help-toggle').getAttribute('aria-expanded'), 'true');
    if (label === 'desktop') await page.keyboard.press('KeyH'); else await page.locator('#help-toggle').click();
    for (const [key, expected] of [['Digit1', 'automatic'], ['Digit2', 'pistol'], ['Digit3', 'knife'], ['Digit4', 'fists']]) {
      await page.keyboard.press(key); assert.equal(await page.evaluate(() => __cdd.paintball.weapon.id), expected);
    }
    await page.keyboard.press('Digit2');
    await page.evaluate(() => { __cdd.paintball.clearEffects(); __cdd.paintball.shoot(); }); await page.keyboard.press('KeyR');
    await page.waitForFunction(() => __cdd.paintball.ammo.progress > .3);
    assert.equal(await page.locator('#ammo-loaded').textContent(), '19');
    await page.screenshot({ path: path.join(directory, `${label}-reload.png`) });
    await page.waitForFunction(() => !__cdd.paintball.ammo.reloading);
    await page.evaluate(() => { __cdd.player.setCameraMode('first'); __cdd.paintball.setWeapon('fists'); });
    await page.waitForTimeout(200); // Allow a normal animation/render cycle before the still.
    await page.evaluate(() => __cdd.renderer.setAnimationLoop(null));
    await page.screenshot({ path: path.join(directory, `${label}-guard.png`) });
    await page.evaluate(() => { __cdd.paintball.shoot(); for (let i = 0; i < 4; i++) { __cdd.player.avatar.update(.03); __cdd.paintball.update(.03); } __cdd.renderer.render(__cdd.scene, __cdd.camera); });
    await page.screenshot({ path: path.join(directory, `${label}-jab.png`) });
    const ammo = await page.evaluate(() => {
      const p = __cdd.paintball; p.clearEffects(); p.setWeapon('pistol'); p.resetAmmo(); p.shoot(); p.update(.2);
      p.reload(); const starting = p.ammo;
      for (let i = 0; i < 24; i++) { __cdd.player.avatar.update(.1); p.update(.1); }
      return { starting, finished: p.ammo, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(ammo.starting.loaded, 19); assert.ok(ammo.starting.reloading); assert.equal(ammo.finished.loaded, 20); assert.equal(ammo.finished.reserve, 119); assert.ok(!ammo.overflow);
    const ragdoll = await page.evaluate(() => {
      const game = __cdd.game, entity = game.combat.spawn('human', 'enemy', 'normal', { x: __cdd.player.feet.x + 2, z: __cdd.player.feet.z - 3 }, true);
      entity.protectedUntil = 0;
      game.combat.simulation.damage(entity, { source: game.combat.player, weapon: { kind: 'melee', damage: 1000 } });
      game.combat.views.get(entity).update(.016, game.combat.simulation.time, __cdd.camera);
      const corpse = [...game.ragdolls.corpses][0], count = corpse?.parts.length;
      for (let i = 0; i < 120; i++) game.ragdolls.update(1 / 60);
      const sinking = corpse?.root.position.y < corpse?.baseY;
      for (let i = 0; i < 90; i++) game.ragdolls.update(1 / 60);
      return { count, sinking, remaining: game.ragdolls.corpses.size };
    });
    assert.equal(ragdoll.count, 11); assert.ok(ragdoll.sinking); assert.equal(ragdoll.remaining, 0);
    reports.push({ label, audio, ammo, ragdoll }); await context.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ reports, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, reports, directory }));
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    console.log(await page.evaluate(() => ({ mode: window.__cdd?.game.mode, text: document.body.innerText.slice(-1800) })).catch(() => null));
  }
  console.log({ errors }); throw error;
} finally { await browser.close(); }
