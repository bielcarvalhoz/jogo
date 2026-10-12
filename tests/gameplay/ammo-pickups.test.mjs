import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createAmmoPickups } from '../../src/gameplay/paintball/ammo-pickups.js';
import { createAmmoStore } from '../../src/gameplay/paintball/ammo.js';
import { createEvents } from '../../src/core/events.js';

test('training and football ammo crates collect on proximity, refill reserves, and return after active play time', t => {
  const ammunition = createAmmoStore();
  const game = { engine: { scene: new THREE.Scene(), addSystem() {} }, dynamicProps: { training: { x: 10000, z: 9996 }, campaign: { x: 0, z: 0 } },
    training: { active: true }, player: { active: true, feet: new THREE.Vector3() }, map: { terrain: { heightAt: () => 12 } },
    events: createEvents(), ui: {}, paintball: { refillAmmo: () => ammunition.refill() }, toast() {} };
  const loot = createAmmoPickups(game); t.after(() => loot.dispose());
  const training = loot.records.find(r => r.mode === 'training'), football = loot.records.find(r => r.mode === 'campaign');
  assert.equal(loot.pickup(), false); assert.equal(training.group.visible, true); assert.equal(football.group.visible, false);
  game.player.feet.copy(training.group.position); loot.update(); assert.equal(loot.nearby, training);
  assert.equal(loot.pickup(), true); assert.equal(ammunition.state('pistol').reserve, 160); assert.equal(training.group.visible, false);
  game.ui.paused = true; loot.update(20); assert.equal(training.group.visible, false, 'settings must pause the loot clock');
  game.ui.paused = false; loot.update(15.1); assert.equal(training.group.visible, true);
  game.training.active = false; game.player.feet.copy(football.group.position); loot.update();
  assert.equal(training.group.visible, false); assert.equal(football.group.position.y, 12); assert.equal(loot.nearby, football);
  game.ui.weaponWheelOpen = true; assert.equal(loot.pickup(), false);
  game.ui.weaponWheelOpen = false; assert.equal(loot.pickup(), true);
});
