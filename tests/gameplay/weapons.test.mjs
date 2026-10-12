import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { WEAPONS, createWeaponInventory } from '../../src/gameplay/paintball/weapons.js';
import { createPaintball } from '../../src/gameplay/paintball/paintball.js';

function setup(distance = 1) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
  wall.position.z = -distance; scene.add(wall); scene.updateMatrixWorld(true);
  return { scene, camera, wall };
}
function tick(paint, duration, dt = .02) { for (let time = 0; time < duration - 1e-8; time += dt) paint.update(dt); }

test('inventory replaces selected firearms first, preserves two firearm slots and swaps melee directly', () => {
  const inventory = createWeaponInventory();
  assert.deepEqual(inventory.state.slots, ['automatic', 'pistol', 'knife']);
  assert.deepEqual(inventory.available.map(w => w.id), ['automatic', 'pistol', 'knife', 'fists']);
  assert.throws(() => inventory.select('sniper'), RangeError);
  inventory.select('automatic');
  assert.deepEqual(inventory.pickup('shotgun'), { picked: 'shotgun', dropped: 'automatic', slot: 0 });
  inventory.select('fists');
  assert.deepEqual(inventory.pickup('sniper'), { picked: 'sniper', dropped: 'shotgun', slot: 0 });
  inventory.select('pistol');
  assert.deepEqual(inventory.pickup('axe'), { picked: 'axe', dropped: 'knife', slot: 2 });
  assert.deepEqual(inventory.pickup('smg'), { picked: 'smg', dropped: 'pistol', slot: 1 });
  const snapshot = inventory.state; snapshot.slots[0] = 'fists';
  assert.deepEqual(inventory.state.slots, ['sniper', 'smg', 'axe'], 'snapshot cannot mutate inventory');
  assert.equal(inventory.state.selected, 'smg');
  assert.equal(inventory.pickup('smg').duplicate, true);
  assert.throws(() => inventory.pickup('fists'), RangeError);
});

test('firearm base damage, cadence, pellet count and spread agree with the captured Valve game data', async () => {
  const reference = JSON.parse(await fs.readFile(new URL('../../data/cs2-weapon-reference.json', import.meta.url), 'utf8'));
  for (const weapon of WEAPONS.filter(w => w.kind === 'firearm')) {
    const source = reference.weapons[weapon.csWeapon];
    assert.equal(weapon.damage, source.m_nDamage);
    assert.equal(weapon.interval, Array.isArray(source.m_flCycleTime) ? source.m_flCycleTime[0] : source.m_flCycleTime);
    assert.equal(weapon.pellets, source.m_nNumBullets);
    assert.equal(weapon.spread, source.m_flSpread[0]);
    assert.equal(weapon.automatic, source.m_bIsFullAuto);
  }
});

test('holstering preserves the selected weapon and slots, clears attacks and scope, and keeps existing paint moving', () => {
  const { scene, camera } = setup(), poses = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [],
    updateWeaponPose(gun, state) { poses.push(state); return true; } });
  paint.pickupWeapon('sniper'); paint.setAiming(true); paint.update(.05); paint.setTrigger(true);
  assert.equal(paint.stats.projectiles, 1); assert.equal(paint.scoped, true);
  const inventory = paint.inventory, shots = paint.stats.shots;
  const ball = paint.root.children.find(child => child.name === 'bolinha-tinta' && child.visible), before = ball.position.clone();
  paint.setHolstered(true);
  assert.deepEqual(paint.inventory, inventory); assert.equal(paint.weapon.id, 'sniper');
  assert.equal(paint.gun.visible, false); assert.equal(paint.firing, false); assert.equal(paint.aiming, false);
  assert.equal(paint.scoped, false); assert.equal(camera.fov, 70); assert.equal(poses.at(-1).holstered, true);
  paint.setAiming(true); paint.setTrigger(true); assert.equal(paint.shoot(), false);
  tick(paint, .2); assert.equal(paint.stats.shots, shots); assert.equal(paint.aiming, false); assert.ok(ball.position.distanceTo(before) > 1);
  paint.setHolstered(false); assert.equal(paint.gun.visible, true); assert.deepEqual(paint.inventory, inventory);
  paint.setHolstered(true); paint.setWeapon('fists'); assert.equal(paint.holstered, false, 'selecting a weapon explicitly equips it');
  paint.dispose();
});

test('holstering cancels a committed melee impact and revolver preparation', () => {
  const { scene, camera, wall } = setup(), hits = [], attacks = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [wall], onImpact: hit => hits.push(hit), onAttack: weapon => attacks.push(weapon.id) });
  paint.setWeapon('fists'); assert.equal(paint.shoot(), true); assert.deepEqual(attacks, ['fists']);
  paint.setHolstered(true); tick(paint, .5); assert.equal(hits.length, 0);
  paint.setHolstered(false); assert.equal(paint.shoot(), true); tick(paint, .2); assert.equal(hits.length, 1);
  paint.pickupWeapon('revolver'); paint.clearEffects(); assert.equal(paint.shoot(), true);
  paint.setHolstered(true); tick(paint, .3); assert.equal(paint.stats.shots, 0);
  paint.setHolstered(false); paint.clearEffects(); assert.equal(paint.shoot(), true); tick(paint, .25);
  assert.equal(paint.stats.shots, 1); paint.dispose();
});

test('melee and unarmed attacks hit during the swing and never emit paint or gun audio', () => {
  const { scene, camera, wall } = setup(), hits = [], attacks = [], sounds = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [wall], onImpact: (hit, info) => hits.push(info), onAttack: (weapon, state) => attacks.push([weapon.id, state.sequence]), onShot: id => sounds.push(id) });
  for (const id of ['knife', 'fists']) {
    paint.clearEffects(); paint.setWeapon(id); paint.setAiming(true); assert.equal(paint.aiming, false);
    assert.equal(paint.shoot(), true); assert.equal(paint.shoot(), false);
    const before = hits.length; paint.update(.05); assert.equal(hits.length, before);
    tick(paint, .2); assert.equal(hits.length, before + 1);
    assert.equal(hits.at(-1).weapon.id, id); assert.ok(hits.at(-1).impulse > 0);
    assert.equal(paint.stats.projectiles, 0); assert.equal(paint.stats.marks, 0);
  }
  assert.deepEqual(attacks, [['knife', 0], ['fists', 1]]); assert.deepEqual(sounds, []);
  paint.dispose();
});

test('melee reach starts at the character in both camera modes and cannot hit beyond reach', () => {
  const { scene, camera, wall } = setup(1.2), hits = [];
  let source = new THREE.Vector3();
  const paint = createPaintball({ scene, camera, colliderRoots: [wall], getShotOrigin: target => target.copy(source), onImpact: hit => hits.push(hit) });
  paint.setWeapon('knife');
  for (const z of [0, 3]) { camera.position.z = z; paint.clearEffects(); paint.shoot(); tick(paint, .25); }
  assert.equal(hits.length, 2, 'camera behind character must not consume attack reach');
  wall.position.z = -3; wall.updateMatrixWorld(true); paint.clearEffects(); paint.shoot(); tick(paint, .25);
  assert.equal(hits.length, 2);
  paint.dispose();
});

test('shotgun emits nine damaging pellets per shell, with one sound and bounded cadence', () => {
  const { scene, camera, wall } = setup(8), hits = [], sounds = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [wall], onImpact: (hit, info) => hits.push(info), onShot: id => sounds.push(id), random: () => .5 });
  assert.throws(() => paint.setWeapon('shotgun'), RangeError);
  const swap = paint.pickupWeapon('shotgun'); assert.equal(swap.dropped, 'pistol');
  paint.shoot(); assert.equal(paint.stats.projectiles, 9); assert.deepEqual(sounds, ['shotgun']);
  tick(paint, .3); assert.equal(hits.length, 9); assert.equal(paint.stats.marks, 9);
  assert.ok(hits.every(hit => hit.damage === 26 && hit.weapon.id === 'shotgun'));
  assert.equal(paint.shoot(), false); tick(paint, .6); assert.equal(paint.shoot(), true);
  paint.dispose();
});

test('R8 accepts a quick mobile tap and completes its windup after normal release', () => {
  const { scene, camera } = setup(), sounds = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [], onShot: id => sounds.push(id) });
  paint.pickupWeapon('revolver'); paint.setTrigger(true); paint.update(.05); assert.equal(sounds.length, 0);
  paint.setTrigger(false); assert.equal(paint.firing, false);
  tick(paint, .12); assert.equal(sounds.length, 0, 'preserve the 200 ms trigger preparation');
  tick(paint, .04); assert.deepEqual(sounds, ['revolver'], 'pointerup must not discard an accepted tap');
  tick(paint, 1); assert.equal(sounds.length, 1, 'one tap schedules exactly one shot');
  paint.dispose();
});

test('held R8 repeats at its primary cadence and release stops accepting further shots', () => {
  const { scene, camera } = setup(), sounds = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [], onShot: id => sounds.push(id) });
  paint.pickupWeapon('revolver'); paint.setTrigger(true); tick(paint, .22);
  assert.equal(sounds.length, 1); tick(paint, .5); assert.equal(sounds.length, 2);
  paint.setTrigger(false); tick(paint, 1.5); assert.equal(sounds.length, 2);
  paint.dispose();
});

test('R8 windup is cancelled by reset, weapon switch, effects clear and player inactivity', () => {
  const { scene, camera } = setup(), sounds = []; let active = true;
  const paint = createPaintball({ scene, camera, colliderRoots: [], getActive: () => active, onShot: id => sounds.push(id) });
  paint.pickupWeapon('revolver');
  for (const cancel of [() => paint.resetInput(), () => paint.setWeapon('fists'), () => paint.clearEffects(), () => { active = false; }]) {
    active = true; paint.clearEffects(); paint.setWeapon('revolver');
    paint.setTrigger(true); paint.update(.05); cancel(); tick(paint, .4);
    assert.equal(sounds.length, 0);
  }
  paint.dispose();
});

test('Nova sends a stronger, slower recoil envelope to the shared weapon pose and shot callback', () => {
  const { scene, camera } = setup(), states = [], shots = [];
  const paint = createPaintball({ scene, camera, colliderRoots: [], updateWeaponPose: (gun, state) => { states.push(state); return true; }, onShot: (id, info) => shots.push({ id, ...info }) });
  paint.shoot(); paint.update(0); const pistolPeak = states.at(-1).recoil;
  tick(paint, .1); const pistolTail = states.at(-1).recoil;
  paint.clearEffects(); paint.pickupWeapon('shotgun'); paint.shoot(); paint.update(0);
  const shotgunPeak = states.at(-1).recoil;
  assert.ok(shotgunPeak >= pistolPeak * 2.4, 'Nova should visibly kick harder than the pistol');
  tick(paint, .1);
  assert.ok(states.at(-1).recoil / shotgunPeak > pistolTail / pistolPeak, 'Nova recovers more slowly');
  assert.equal(shots.at(-1).recoilStrength, shotgunPeak);
  assert.equal(shots.at(-1).recoilDecay, paint.weapon.recoilDecay);
  assert.equal(shots.at(-1).id, 'shotgun');
  paint.dispose();
});

test('a projectile keeps its fired weapon damage and dynamic splats follow crate movement', () => {
  const { scene, camera, wall } = setup(3), hits = []; wall.userData.dynamicPaint = true;
  let roots = [];
  const paint = createPaintball({ scene, camera, colliderRoots: () => [...roots], onImpact: (hit, info) => hits.push(info), random: () => 0 });
  roots = [wall]; paint.shoot(); paint.setWeapon('knife'); tick(paint, .2);
  assert.equal(hits.length, 1); assert.equal(hits[0].weapon.id, 'pistol'); assert.equal(hits[0].damage, 30);
  const mark = paint.root.children.find(o => o.name === 'marca-tinta' && o.visible), before = mark.position.clone();
  wall.position.x += 2; wall.updateMatrixWorld(true); paint.update(.02);
  assert.ok(Math.abs(mark.position.x - before.x - 2) < 1e-8);
  wall.removeFromParent(); paint.update(.02); assert.equal(mark.visible, false);
  paint.dispose();
});

test('AWP scope changes its field of view and reduces its unscoped dispersion', () => {
  const { scene, camera } = setup(), paint = createPaintball({ scene, camera, colliderRoots: [], random: () => .5 });
  paint.pickupWeapon('sniper'); paint.shoot();
  const ball = paint.root.children.find(o => o.name === 'bolinha-tinta' && o.visible);
  const hipStart = ball.position.clone(); paint.update(.02);
  const hip = Math.abs(ball.position.x - hipStart.x);
  paint.clearEffects(); paint.setAiming(true); tick(paint, .8); assert.ok(camera.fov < 40 && camera.fov > 38);
  paint.shoot();
  const scopedBall = paint.root.children.find(o => o.name === 'bolinha-tinta' && o.visible), start = scopedBall.position.clone(); paint.update(.02);
  const scoped = Math.abs(scopedBall.position.x - start.x);
  assert.ok(scoped < hip * .1);
  paint.dispose();
});
