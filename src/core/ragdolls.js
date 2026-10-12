import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const STEP = 1 / 60, MAX_CORPSES = 16, GROUPS = (2 << 16) | 1;
const normalized = name => name.replace(/[.:]/g, '');
const up = new THREE.Vector3(0, 1, 0);
export function ragdollSegments(bones) {
  const human = !!bones['DEF-head'], segments = [];
  const add = (start, end, radius, mass) => { if (bones[start] && bones[end]) segments.push({ bone: bones[start], end: bones[end], radius, mass }); };
  if (human) {
    add('DEF-hips', 'DEF-spine001', .16, 9); add('DEF-spine001', 'DEF-spine003', .18, 13); add('DEF-head', 'DEF-head', .16, 4);
    for (const side of ['L', 'R']) {
      add(`DEF-upper_arm${side}`, `DEF-forearm${side}`, .07, 2); add(`DEF-forearm${side}`, `DEF-hand${side}`, .065, 1.5);
      add(`DEF-thigh${side}`, `DEF-shin${side}`, .10, 5); add(`DEF-shin${side}`, `DEF-foot${side}`, .085, 3);
    }
  } else {
    add('Body', 'Abdomen', .19, 9); add('Abdomen', 'Torso', .22, 13); add('Head', 'Head', .21, 4);
    for (const side of ['L', 'R']) {
      add(`UpperArm${side}`, `LowerArm${side}`, .09, 2); add(`LowerArm${side}`, `Index1${side}`, .075, 1.5);
      add(`UpperLeg${side}`, `LowerLeg${side}`, .12, 5); add(`LowerLeg${side}`, `Foot${side}`, .09, 3);
    }
  }
  return segments;
}

/** Cosmetic, articulated corpses. Gameplay hitboxes stop at death. Every rig
 * gets real capsule bodies and spherical joints, then sinks and releases them. */
export async function createRagdolls(game) {
  const { default: R } = await import('@dimforge/rapier3d-compat'); await R.init();
  const world = new R.World({ x: 0, y: -15, z: 0 }); world.timestep = STEP;
  const corpses = new Set(); let accumulator = 0, disposed = false;
  function releasePhysics(corpse) {
    if (corpse.frozen) return; corpse.frozen = true;
    for (const joint of corpse.joints) world.removeImpulseJoint(joint, true);
    for (const part of corpse.parts) world.removeRigidBody(part.body);
    for (const floor of corpse.floors) world.removeCollider(floor, true);
  }
  function remove(corpse) {
    if (!corpses.delete(corpse)) return;
    releasePhysics(corpse); corpse.root.removeFromParent();
    if (corpse.cleanup) corpse.cleanup();
    else {
      const skeletons = new Set(); corpse.root.traverse(object => { if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
      for (const skeleton of skeletons) skeleton.dispose();
    }
  }
  function capture(source, { owned = false, cleanup, impulse = { x: 0, y: .5, z: -1.5 } } = {}) {
    if (disposed) return null;
    if (corpses.size >= MAX_CORPSES) remove(corpses.values().next().value);
    const root = owned ? source : cloneSkeleton(source), bones = {};
    root.name = 'ragdoll-corpse'; root.visible = true; root.userData.paintballIgnore = true;
    root.traverse(object => { if (object.isBone) bones[normalized(object.name)] = object; if (object.isMesh) object.frustumCulled = false; });
    game.engine.scene.add(root); root.updateMatrixWorld(true);
    const definitions = ragdollSegments(bones);
    if (definitions.length < 8) { root.removeFromParent(); cleanup?.(); return null; }
    const corpse = { root, parts: [], joints: [], floors: [], age: 0, frozen: false, baseY: root.position.y, cleanup };
    const feet = root.getWorldPosition(new THREE.Vector3()), vertices = [], indices = [], grid = 6, extent = 3;
    for (let z = 0; z <= grid; z++) for (let x = 0; x <= grid; x++) {
      const wx = feet.x + (x / grid * 2 - 1) * extent, wz = feet.z + (z / grid * 2 - 1) * extent;
      const floor = game.training?.active ? 0 : Math.max(game.map.terrain.heightAt(wx, wz), game.physics.surfaceHeightAt(wx, wz, feet.y + .4), game.physics.roofAt(wx, wz, feet.y + .4));
      vertices.push(wx, floor, wz);
    }
    for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) { const a = z * (grid + 1) + x, b = a + grid + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
    corpse.floors.push(world.createCollider(R.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(.8).setCollisionGroups((1 << 16) | 2)));
    for (const def of definitions) {
      const start = def.bone.getWorldPosition(new THREE.Vector3()), end = def.end.getWorldPosition(new THREE.Vector3());
      const delta = end.clone().sub(start), length = delta.length(), center = start.clone().add(end).multiplyScalar(.5);
      const rotation = length > .001 ? new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()) : def.bone.getWorldQuaternion(new THREE.Quaternion());
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setRotation(rotation).setLinearDamping(.7).setAngularDamping(1.4).setCcdEnabled(true));
      world.createCollider(R.ColliderDesc.capsule(Math.max(0, length * .5 - def.radius), def.radius).setMass(def.mass).setFriction(.75).setRestitution(.02).setCollisionGroups(GROUPS), body);
      const bodyMatrix = new THREE.Matrix4().compose(center, rotation, new THREE.Vector3(1, 1, 1));
      corpse.parts.push({ ...def, body, offset: bodyMatrix.clone().invert().multiply(def.bone.matrixWorld), bodyMatrix });
    }
    const byBone = new Map(corpse.parts.map(part => [part.bone, part]));
    for (const part of corpse.parts) {
      let ancestor = part.bone.parent; while (ancestor && !byBone.has(ancestor)) ancestor = ancestor.parent;
      const parent = byBone.get(ancestor); if (!parent) continue;
      const pivot = part.bone.getWorldPosition(new THREE.Vector3());
      const a = pivot.clone().applyMatrix4(parent.bodyMatrix.clone().invert()), b = pivot.clone().applyMatrix4(part.bodyMatrix.clone().invert());
      const joint = world.createImpulseJoint(R.JointData.spherical(a, b), parent.body, part.body, true); joint.setContactsEnabled(false); corpse.joints.push(joint);
    }
    for (const part of corpse.parts) {
      part.body.setLinvel({ x: impulse.x || 0, y: Math.max(.2, impulse.y || 0), z: impulse.z || 0 }, true);
      part.body.setAngvel({ x: .8, y: .3, z: -.45 }, true);
    }
    corpses.add(corpse); return corpse;
  }
  function update(dt) {
    if (disposed || !game.player?.active || !game.mode || game.ui?.mapOpen) { accumulator = 0; return; }
    const elapsed = Math.min(.1, Math.max(0, dt)); accumulator += elapsed;
    while (accumulator >= STEP) { world.step(); accumulator -= STEP; }
    for (const corpse of corpses) {
      corpse.age += elapsed;
      if (!corpse.frozen) {
        // Parents first: convert each physical world pose through its current
        // skeletal parent, preserving the authored bone-to-body bind offset.
        for (const part of corpse.parts) {
          const worldPose = new THREE.Matrix4().compose(new THREE.Vector3().copy(part.body.translation()), new THREE.Quaternion().copy(part.body.rotation()), new THREE.Vector3(1, 1, 1)).multiply(part.offset);
          part.bone.parent.updateWorldMatrix(true, false);
          const local = part.bone.parent.matrixWorld.clone().invert().multiply(worldPose);
          local.decompose(part.bone.position, part.bone.quaternion, part.bone.scale); part.bone.updateMatrixWorld(true);
        }
        if (corpse.age >= 1.7) releasePhysics(corpse);
      }
      if (corpse.frozen) {
        const progress = Math.min(1, (corpse.age - 1.7) / 1.5), eased = progress * progress * (3 - 2 * progress);
        corpse.root.position.y = corpse.baseY - eased * 2.3;
      }
      if (corpse.age >= 3.3) remove(corpse);
    }
  }
  const clear = () => { for (const corpse of corpses) remove(corpse); accumulator = 0; };
  const unbind = game.events.on('modechange', clear), unbindReset = game.events.on('combatreset', clear);
  game.engine.addSystem(update, 'world');
  return { capture, update, clear, corpses, world, dispose() { if (disposed) return; clear(); disposed = true; unbind(); unbindReset(); world.free(); } };
}
