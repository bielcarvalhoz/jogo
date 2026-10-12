import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRagdolls } from '../../src/core/ragdolls.js';
import { createEvents } from '../../src/core/events.js';
import { createActorView } from '../../src/gameplay/combat/actors.js';
import { createCombatSimulation } from '../../src/gameplay/combat/simulation.js';
import { loadAvatarGeometry } from '../player/load-avatar.mjs';

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
  for (let i = 0; i < 45; i++) manager.update(1 / 60);
  assert.ok(corpse.frozen); assert.ok(corpse.root.position.y < corpse.baseY - .5);
  for (let i = 0; i < 70; i++) manager.update(1 / 60);
  assert.equal(manager.corpses.size, 0); assert.equal(manager.world.bodies.len(), 0); assert.equal(manager.world.colliders.len(), 0);
  manager.capture(view.root); game.events.emit('modechange', null); assert.equal(manager.corpses.size, 0);
});
