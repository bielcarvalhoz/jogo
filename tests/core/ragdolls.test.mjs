import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRagdolls } from '../../src/core/ragdolls.js';
import { createEvents } from '../../src/core/events.js';
import { createActorView } from '../../src/gameplay/combat/actors.js';
import { createCombatSimulation } from '../../src/gameplay/combat/simulation.js';
import { loadAvatarGeometry } from '../player/load-avatar.mjs';

test('paint survives death; firearm and melee hits move a settled corpse while its neck stays outside the chest', async t => {
  const scene = new THREE.Scene(), game = { engine: { scene, addSystem() {} }, events: createEvents(), training: { active: true }, mode: 'training', player: { active: true } };
  const manager = await createRagdolls(game); t.after(() => manager.dispose());
  const simulation = createCombatSimulation({ bounds: { x0: -20, x1: 20, z0: -20, z1: 20 } }); t.after(() => simulation.dispose());
  const entity = simulation.spawn({ kind: 'human', position: { x: 0, y: 0, z: 0 } });
  const view = createActorView(entity, await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), { parent: scene }); t.after(() => view.dispose());
  view.update(.01, 0, null);
  const aim = view.bones['DEF-spine003'].getWorldPosition(new THREE.Vector3()), normal = new THREE.Vector3(0, 0, 1);
  const originalMark = game.bodyPaint.stamp(view.root, aim, normal, '#2879b6'); assert.ok(originalMark, 'a shot must paint the actual skin surface');
  const corpse = manager.capture(view.root, { impulse: { x: 0, y: .2, z: 0 } });
  let marks = []; corpse.root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); });
  assert.equal(marks.length, 1); assert.notEqual(marks[0], originalMark); assert.equal(marks[0].material.color.getHexString(), '2879b6');
  const head = corpse.parts.find(p => /head/i.test(p.bone.name)), chest = corpse.parts.find(p => /spine001/i.test(p.bone.name));
  const gap = new THREE.Vector3().copy(head.body.translation()).distanceTo(chest.body.translation());
  for (let i = 0; i < 120; i++) manager.update(1 / 60);
  for (const kind of ['firearm', 'unarmed']) {
    const center = new THREE.Vector3().copy(chest.body.translation()), from = center.clone().add(new THREE.Vector3(0, 2, 0));
    const hit = manager.raycast(from, center.clone().add(new THREE.Vector3(0, -2, 0))); assert.equal(hit?.corpse, corpse);
    const before = new THREE.Vector3().copy(corpse.parts[0].body.translation());
    assert.equal(manager.impact(hit, { kind, impulse: 18, direction: new THREE.Vector3(1, .3, 0), paintColor: '#c8102e' }), true);
    for (let i = 0; i < 20; i++) manager.update(1 / 60);
    assert.ok(new THREE.Vector3().copy(corpse.parts[0].body.translation()).distanceTo(before) > .08, `${kind}: body must be thrown by the hit`);
    assert.ok(Math.abs(new THREE.Vector3().copy(head.body.translation()).distanceTo(chest.body.translation()) - gap) < .02, 'head/chest distance must survive impacts');
  }
  marks = []; corpse.root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); }); assert.ok(marks.length >= 2, 'new shots must also paint the corpse');
  game.bodyPaint.clear(view.root); assert.ok(marks.every(mark => mark.parent), 'clearing live wounds must preserve corpse paint');
});

for (const kind of ['human', 'zombie']) test(`${kind}: articulated physical death falls, sinks and frees its bodies without changing the live rig`, async t => {
  const scene = new THREE.Scene(), game = { engine: { scene, addSystem() {} }, events: createEvents(), training: { active: true }, mode: 'training', player: { active: true } };
  const manager = await createRagdolls(game); t.after(() => manager.dispose());
  const simulation = createCombatSimulation({ bounds: { x0: -10, x1: 10, z0: -10, z1: 10 } }), entity = simulation.spawn({ kind, position: { x: 0, y: 0, z: 0 } }); t.after(() => simulation.dispose());
  const url = kind === 'human' ? '../../public/models/sato.glb' : '../../public/models/enemies/zombie-quaternius.glb';
  const view = createActorView(entity, await loadAvatarGeometry(new URL(url, import.meta.url)), { parent: scene }); t.after(() => view.dispose());
  view.update(.01, 0, null); const sourceHead = view.bones[kind === 'human' ? 'DEF-head' : 'Head'];
  const original = sourceHead.getWorldPosition(new THREE.Vector3());
  const corpse = manager.capture(view.root, { impulse: { x: 1.3, y: .5, z: -.8 } });
  assert.equal(corpse.parts.length, 11); assert.equal(corpse.joints.length, 10);
  const head = corpse.parts.find(part => /head/i.test(part.bone.name)).bone;
  for (let i = 0; i < 90; i++) manager.update(1 / 60);
  assert.ok(head.getWorldPosition(new THREE.Vector3()).y < original.y - .25, 'gravity must topple the actual head, not just translate a rigid mesh');
  assert.ok(sourceHead.getWorldPosition(new THREE.Vector3()).distanceTo(original) < 1e-6);
  corpse.root.traverse(object => {
    if (!object.isSkinnedMesh) return;
    object.skeleton.update(); object.computeBoundingBox();
    const box = object.boundingBox.clone().applyMatrix4(object.matrixWorld);
    assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite));
    assert.ok(box.getSize(new THREE.Vector3()).length() < 4, 'physical joints must not stretch the skinned geometry apart');
  });
  for (let i = 0; i < 480; i++) manager.update(1 / 60);
  assert.ok(!corpse.frozen, 'the body must remain physical at 9.5 seconds');
  assert.equal(corpse.root.position.y, corpse.baseY, 'no sinking before ten seconds');
  game.events.emit('modechange', 'training'); assert.ok(manager.corpses.has(corpse), 'returning to the same match must preserve its corpses');
  const pelvis = corpse.parts[0].body, before = { ...pelvis.translation() };
  pelvis.applyImpulse({ x: 80, y: 40, z: 0 }, true);
  for (let i = 0; i < 15; i++) manager.update(1 / 60);
  assert.ok(Math.hypot(pelvis.translation().x - before.x, pelvis.translation().y - before.y) > .05, 'settled bodies must still respond to an impulse');
  for (let i = 0; i < 75; i++) manager.update(1 / 60);
  assert.ok(corpse.frozen); assert.ok(corpse.root.position.y < corpse.baseY - .5);
  for (let i = 0; i < 100; i++) manager.update(1 / 60);
  assert.equal(manager.corpses.size, 0); assert.equal(manager.world.bodies.len(), 0); assert.equal(manager.world.colliders.len(), 0);
  manager.capture(view.root); game.events.emit('modechange', null); assert.equal(manager.corpses.size, 0);
});

test('thrown corpses collide with thin walls, a raised floor and moving crates for the full loose lifetime', async t => {
  const scene = new THREE.Scene(), wall = new THREE.Mesh(new THREE.BoxGeometry(.12, 4, 6), new THREE.MeshStandardMaterial());
  wall.position.set(1.4, 2, 0); scene.add(wall);
  const platform = new THREE.Mesh(new THREE.BoxGeometry(12, 1, 12), wall.material);
  platform.position.y = .5; scene.add(platform);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wall.material); mesh.position.set(-2.5, 1.5, 0); mesh.userData.dynamicBody = true; scene.add(mesh); mesh.updateWorldMatrix(true, false);
  const crate = { mesh, bounds: new THREE.Box3().setFromObject(mesh) };
  const game = { engine: { scene, addSystem() {} }, dynamicProps: { crates: [crate] }, events: createEvents(), training: { active: true }, mode: 'training', player: { active: true } };
  const manager = await createRagdolls(game); t.after(() => { manager.dispose(); wall.geometry.dispose(); platform.geometry.dispose(); mesh.geometry.dispose(); wall.material.dispose(); });
  const simulation = createCombatSimulation({ bounds: { x0: -10, x1: 10, z0: -10, z1: 10 } }), entity = simulation.spawn({ kind: 'human', position: { x: 0, y: 1, z: 0 } }); t.after(() => simulation.dispose());
  const view = createActorView(entity, await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), { parent: scene }); t.after(() => view.dispose()); view.update(.01, 0, null);
  const corpse = manager.capture(view.root, { impulse: { x: 8, y: 1, z: 0 } });
  assert.equal(corpse.environment.moving.length, 1);
  for (let i = 0; i < 570; i++) {
    mesh.position.z = Math.min(2, i / 120);
    manager.update(1 / 60);
    for (const part of corpse.parts) {
      const p = part.body.translation();
      assert.ok(p.x < 1.46, `limb crossed the wall: ${part.bone.name} ${p.x}`);
      assert.ok(p.y >= .93, `limb penetrated the raised floor: ${part.bone.name} ${p.y}`);
      assert.ok(Number.isFinite(p.x + p.y + p.z));
    }
  }
  assert.ok(!corpse.frozen);
  assert.ok(Math.abs(corpse.environment.moving[0].body.translation().z - mesh.position.z) < .02);
  manager.clear(); assert.equal(manager.world.bodies.len(), 0); assert.equal(manager.world.colliders.len(), 0);
});

test('a thrown corpse keeps terrain support after leaving its original small floor patch', async t => {
  const scene = new THREE.Scene(), game = { engine: { scene, addSystem() {} }, events: createEvents(), training: { active: true }, mode: 'training', player: { active: true } };
  const manager = await createRagdolls(game); t.after(() => manager.dispose());
  const simulation = createCombatSimulation({ bounds: { x0: -100, x1: 100, z0: -100, z1: 100 } }), entity = simulation.spawn({ kind: 'human', position: { x: 0, y: 0, z: 0 } }); t.after(() => simulation.dispose());
  const view = createActorView(entity, await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), { parent: scene }); t.after(() => view.dispose()); view.update(.01, 0, null);
  const corpse = manager.capture(view.root, { impulse: { x: 16, y: 2, z: 0 } });
  for (let i = 0; i < 570; i++) manager.update(1 / 60);
  assert.ok(corpse.parts[0].body.translation().x > 3);
  assert.ok(corpse.parts.every(part => part.body.translation().y >= -.04));
  assert.ok(corpse.environment.center.x > 0, 'local colliders must follow a body that travels beyond the safe margin');
});
