import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponPickups } from '../../src/gameplay/paintball/pickups.js';
import { WEAPONS, createWeaponInventory } from '../../src/gameplay/paintball/weapons.js';

test('ground pickup swaps selected firearm in place, drops old melee, and separates worlds', () => {
  const inventory = createWeaponInventory(), models = Object.fromEntries(WEAPONS.filter(w => w.kind !== 'unarmed').map(w => [w.id, { model: new THREE.Mesh(new THREE.BoxGeometry(.1, .2, .4)) }]));
  const game = { engine: { scene: new THREE.Scene(), addSystem() {} }, events: { on() {} },
    player: { active: true, feet: new THREE.Vector3() }, training: { active: true, spawn: { x: 10000, z: 10000 } },
    dynamicProps: { campaign: { x: 0, z: 0 } }, map: { terrain: { heightAt: () => 10 } }, toast() {},
    paintball: { weapons: WEAPONS, get inventory() { return inventory.state; }, pickupWeapon: id => inventory.pickup(id) } };
  const pickups = createWeaponPickups(game, models);
  try {
    const count = pickups.records.length, record = pickups.records.find(r => r.weaponId === 'revolver' && r.mode === 'training');
    game.player.feet.copy(record.group.position); pickups.update(); assert.equal(pickups.nearby, record);
    inventory.select('automatic');
    const result = pickups.pickup();
    assert.equal(result.dropped, 'automatic'); assert.equal(record.weaponId, 'automatic');
    assert.deepEqual(inventory.state.slots, ['revolver', 'pistol', 'knife']);
    assert.equal(pickups.records.length, count);
    const axe = pickups.records.find(r => r.weaponId === 'axe' && r.mode === 'training');
    game.player.feet.copy(axe.group.position); pickups.pickup();
    assert.equal(axe.weaponId, 'knife'); assert.deepEqual(inventory.state.slots, ['revolver', 'pistol', 'axe']);
    game.training.active = false; game.player.feet.set(0, 10, 0); pickups.update();
    assert.ok(pickups.records.filter(r => r.mode === 'training').every(r => !r.group.visible));
    assert.ok(pickups.records.filter(r => r.mode === 'campaign').every(r => r.group.visible));
  } finally { pickups.dispose(); }
});
