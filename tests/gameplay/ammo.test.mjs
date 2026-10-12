import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAmmoStore } from '../../src/gameplay/paintball/ammo.js';
import { WEAPONS } from '../../src/gameplay/paintball/weapons.js';
import { createPaintball } from '../../src/gameplay/paintball/paintball.js';
const tick = (paint, seconds) => { for (let t = 0; t < seconds; t += .02) paint.update(.02); };

test('ammo loot adds reserve magazines without loading the gun or cancelling a reload, and caps stock', () => {
  const ammo = createAmmoStore(); ammo.consume('pistol'); ammo.reload('pistol'); ammo.update(.5);
  const before = ammo.state('pistol'); assert.ok(ammo.refill() > 0);
  const after = ammo.state('pistol');
  assert.equal(after.loaded, before.loaded); assert.equal(after.reserve, before.reserve + before.capacity * 2);
  assert.equal(after.remaining, before.remaining); assert.equal(after.reloading, true);
  for (let i = 0; i < 20; i++) ammo.refill();
  for (const w of WEAPONS.filter(w => w.kind === 'firearm')) assert.equal(ammo.state(w.id).reserve, w.reserveAmmo * 2);
  assert.equal(ammo.refill(), 0); ammo.update(3); assert.equal(ammo.state('pistol').loaded, before.capacity);
});
test('each firearm has a finite independent magazine and reserve; cancelled reload transfers no rounds', () => {
  const ammo = createAmmoStore();
  for (const w of WEAPONS.filter(w => w.kind === 'firearm')) {
    assert.equal(ammo.state(w.id).loaded, w.magazineSize);
    assert.equal(ammo.reload(w.id), false);
    assert.equal(ammo.consume(w.id), true); assert.equal(ammo.reload(w.id), true);
    ammo.update(w.reloadDuration / 2); assert.equal(ammo.consume(w.id), w.reloadStyle === 'shell');
    ammo.cancel(); assert.equal(ammo.state(w.id).reserve, w.reserveAmmo);
  }
  assert.equal(ammo.state('fists'), null);
});
test('magazine reload conserves total rounds and cannot create ammunition after reserves run out', () => {
  const ammo = createAmmoStore();
  for (let i = 0; i < 20; i++) assert.equal(ammo.consume('pistol'), true);
  assert.equal(ammo.consume('pistol'), false); assert.equal(ammo.reload('pistol'), true);
  ammo.update(2.19); assert.equal(ammo.state('pistol').loaded, 0);
  ammo.update(.02); assert.equal(ammo.state('pistol').loaded, 20); assert.equal(ammo.state('pistol').reserve, 100);
  for (let magazine = 0; magazine < 6; magazine++) { for (let i = 0; i < 20; i++) ammo.consume('pistol'); ammo.reload('pistol'); ammo.update(3); }
  assert.equal(ammo.state('pistol').loaded, 0); assert.equal(ammo.reload('pistol'), false);
});
test('Nova loads one shell at a time and can interrupt without losing inserted shells', () => {
  const ammo = createAmmoStore(); for (let i = 0; i < 8; i++) ammo.consume('shotgun');
  ammo.reload('shotgun'); ammo.update(.59); assert.equal(ammo.consume('shotgun'), false);
  ammo.update(.02); assert.equal(ammo.state('shotgun').loaded, 1); assert.equal(ammo.state('shotgun').reserve, 31);
  assert.equal(ammo.consume('shotgun'), true); assert.equal(ammo.state('shotgun').reloading, false);
});
test('real firing consumes one shell for nine pellets, switches preserve ammo, and R blocks firing until completion', () => {
  const events = [], paint = createPaintball({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), colliderRoots: [], onReload: (_, state) => events.push(state) });
  paint.shoot(); tick(paint, .16); assert.equal(paint.ammo.loaded, 19);
  paint.setWeapon('automatic'); assert.equal(paint.ammo.loaded, 30); paint.setWeapon('pistol'); assert.equal(paint.ammo.loaded, 19);
  assert.equal(paint.reload(), true); assert.equal(paint.shoot(), false); tick(paint, 2.25);
  assert.equal(paint.ammo.loaded, 20); assert.equal(paint.ammo.reserve, 119); assert.equal(events.at(-1).active, false);
  paint.pickupWeapon('shotgun'); paint.clearEffects(); paint.shoot(); assert.equal(paint.ammo.loaded, 7); assert.equal(paint.stats.projectiles, 9);
  assert.equal(paint.stats.muzzleParticles, 10); tick(paint, .4); assert.equal(paint.stats.muzzleParticles, 0);
  paint.dispose();
});
test('empty magazine starts automatic reload; switch, pause and holster cancel it', () => {
  let active = true; const paint = createPaintball({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), colliderRoots: [], getActive: () => active });
  for (let i = 0; i < 20; i++) { paint.shoot(); tick(paint, .16); }
  assert.equal(paint.ammo.reloading, true); paint.setWeapon('automatic'); paint.setWeapon('pistol'); assert.equal(paint.ammo.loaded, 0);
  paint.reload(); active = false; paint.update(.02); assert.equal(paint.ammo.reloading, false);
  active = true; paint.reload(); paint.setHolstered(true); assert.equal(paint.ammo.reloading, false);
  paint.dispose();
});
