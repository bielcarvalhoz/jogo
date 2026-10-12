import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createCorpseColliders } from './ragdoll-colliders.js';
import { createBodyPaint } from './body-paint.js';

const STEP = 1 / 60, MAX_CORPSES = 16, LOOSE_SECONDS = 10, SINK_SECONDS = 2.5;
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
  const bodyPaint = game.bodyPaint = createBodyPaint();
  function releasePhysics(corpse) {
    if (corpse.frozen) return; corpse.frozen = true;
    for (const joint of corpse.joints) world.removeImpulseJoint(joint, true);
    for (const part of corpse.parts) world.removeRigidBody(part.body);
    corpse.environment.dispose();
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
    // Each corpse owns one of Rapier's 16 groups, avoiding duplicate floor
    // contacts when several bodies fall together. Dynamic self contacts stay off.
    let slot = 0; while ([...corpses].some(c => c.slot === slot)) slot++;
    const bit = 1 << slot, groups = ((bit << 16) | bit) >>> 0;
    const corpse = { root, parts: [], joints: [], age: 0, frozen: false, baseY: root.position.y, cleanup, slot, groups };
    corpse.environment = createCorpseColliders(game, world, R, root.getWorldPosition(new THREE.Vector3()), groups);
    for (const def of definitions) {
      const start = def.bone.getWorldPosition(new THREE.Vector3()), end = def.end.getWorldPosition(new THREE.Vector3());
      const delta = end.clone().sub(start), length = delta.length(), center = start.clone().add(end).multiplyScalar(.5);
      if (def.bone === def.end) center.add(new THREE.Vector3(0, .12, 0).applyQuaternion(def.bone.getWorldQuaternion(new THREE.Quaternion())));
      const rotation = length > .001 ? new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()) : def.bone.getWorldQuaternion(new THREE.Quaternion());
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setRotation(rotation).setLinearDamping(.7).setAngularDamping(1.4).setCcdEnabled(true).setAdditionalSolverIterations(4));
      world.createCollider(R.ColliderDesc.capsule(Math.max(0, length * .5 - def.radius), def.radius).setMass(def.mass).setFriction(.75).setRestitution(.02).setCollisionGroups(groups).setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT & ~R.ActiveCollisionTypes.DYNAMIC_DYNAMIC), body);
      const bodyMatrix = new THREE.Matrix4().compose(center, rotation, new THREE.Vector3(1, 1, 1));
      corpse.parts.push({ ...def, body, offset: bodyMatrix.clone().invert().multiply(def.bone.matrixWorld), bodyMatrix });
    }
    const byBone = new Map(corpse.parts.map(part => [part.bone, part]));
    for (const part of corpse.parts) {
      let ancestor = part.bone.parent; while (ancestor && !byBone.has(ancestor)) ancestor = ancestor.parent;
      const parent = byBone.get(ancestor); if (!parent) continue;
      const pivot = part.bone.getWorldPosition(new THREE.Vector3());
      const a = pivot.clone().applyMatrix4(parent.bodyMatrix.clone().invert()), b = pivot.clone().applyMatrix4(part.bodyMatrix.clone().invert());
      // Keep the pelvis, chest and neck as a coherent core. Free spherical
      // joints here let the head fold through the chest even at rest.
      const core = /head|spine|abdomen|torso/i.test(part.bone.name);
      const relative = new THREE.Quaternion().copy(parent.body.rotation()).invert().multiply(new THREE.Quaternion().copy(part.body.rotation()));
      const data = core ? R.JointData.fixed(a, relative, b, { x: 0, y: 0, z: 0, w: 1 }) : R.JointData.spherical(a, b);
      const joint = world.createImpulseJoint(data, parent.body, part.body, true);
      joint.setContactsEnabled(false); corpse.joints.push(joint);
    }
    for (const part of corpse.parts) {
      part.body.setLinvel({ x: impulse.x || 0, y: Math.max(.2, impulse.y || 0), z: impulse.z || 0 }, true);
      part.body.setAngvel({ x: .8, y: .3, z: -.45 }, true);
    }
    corpses.add(corpse); return corpse;
  }
  function update(dt) {
    if (disposed || !game.player?.active || !game.mode || game.ui?.mapOpen || game.ui?.paused && game.mode !== 'multiplayer') { accumulator = 0; return; }
    const elapsed = Math.min(.1, Math.max(0, dt)); accumulator += elapsed;
    for (const corpse of corpses) if (!corpse.frozen) {
      const position = corpse.parts[0].body.translation();
      if (corpse.environment.needsRefresh(position)) {
        corpse.environment.dispose(); corpse.environment = createCorpseColliders(game, world, R, position, corpse.groups);
      }
      corpse.environment.sync();
    }
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
        if (corpse.age >= LOOSE_SECONDS) {
          const bounds = new THREE.Box3().setFromObject(corpse.root, true);
          const floor = game.training?.active ? 0 : game.map.terrain.heightAt(bounds.getCenter(new THREE.Vector3()).x, bounds.getCenter(new THREE.Vector3()).z);
          corpse.sinkDepth = Math.max(2.3, bounds.max.y - floor + .3);
          releasePhysics(corpse);
        }
      }
      if (corpse.frozen) {
        const progress = Math.min(1, (corpse.age - LOOSE_SECONDS) / SINK_SECONDS), eased = progress * progress * (3 - 2 * progress);
        corpse.root.position.y = corpse.baseY - eased * corpse.sinkDepth;
      }
      if (corpse.age >= LOOSE_SECONDS + SINK_SECONDS) remove(corpse);
    }
  }
  function raycast(from, to) {
    const direction = new THREE.Vector3().copy(to).sub(from), length = direction.length(); if (!length || disposed) return null;
    direction.divideScalar(length); const ray = new R.Ray(from, direction); let closest = null;
    for (const corpse of corpses) if (!corpse.frozen) for (const part of corpse.parts) {
      const hit = part.body.collider(0).castRayAndGetNormal(ray, length, true);
      if (!hit || hit.timeOfImpact < 0 || closest && hit.timeOfImpact >= closest.distance) continue;
      closest = { corpse, part, object: part.bone, surface: 'flesh', distance: hit.timeOfImpact,
        point: new THREE.Vector3().copy(from).addScaledVector(direction, hit.timeOfImpact), normal: new THREE.Vector3().copy(hit.normal) };
    }
    return closest;
  }
  function impact(hit, info) {
    const corpse = hit.corpse, part = hit.part; if (!corpses.has(corpse) || corpse.frozen || !part) return false;
    const impulse = new THREE.Vector3().copy(info.direction).normalize().multiplyScalar((info.impulse ?? 6) * (info.kind === 'firearm' ? 4 : 4.5));
    if (info.kind !== 'firearm') impulse.y += impulse.length() * .16;
    const mass = corpse.parts.reduce((sum, p) => sum + p.mass, 0);
    for (const p of corpse.parts) p.body.applyImpulse(impulse.clone().multiplyScalar(.35 * p.mass / mass), true);
    part.body.applyImpulseAtPoint(impulse.multiplyScalar(.65), hit.point, true);
    if (info.kind === 'firearm') bodyPaint.stamp(corpse.root, hit.point, hit.normal, info.paintColor);
    return true;
  }
  const clear = () => { for (const corpse of corpses) remove(corpse); accumulator = 0; };
  let activeMode = game.mode;
  const unbind = game.events.on('modechange', mode => { if (mode !== activeMode) clear(); activeMode = mode; }), unbindReset = game.events.on('combatreset', clear);
  game.engine.addSystem(update, 'world');
  return { capture, update, raycast, impact, clear, corpses, world, dispose() { if (disposed) return; clear(); disposed = true; unbind(); unbindReset(); bodyPaint.dispose(); world.free(); } };
}
