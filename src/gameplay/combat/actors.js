import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const clipName = clip => clip.name.split('|').at(-1);
const upperTrack = /spine|neck|head|shoulder|upper_arm|forearm|hand|f_index|f_middle|f_ring|f_pinky|thumb|support_elbow/;
export async function loadCombatModels(base = '/') {
  const loader = new GLTFLoader();
  const [human, zombie] = await Promise.all([loader.loadAsync(`${base}models/sato.glb`), loader.loadAsync(`${base}models/enemies/zombie-quaternius.glb`)]);
  return { human, zombie };
}

/** SkeletonUtils clones bones and skeletons while sharing immutable geometry,
 * textures and materials. Each actor has its own mixer and collision pose. */
export function createActorView(entity, asset, { parent, weaponModel, ragdolls } = {}) {
  const zombie = entity.kind === 'zombie', root = new THREE.Group(), model = clone(asset.scene);
  root.name = entity.id; root.userData.paintballIgnore = true; root.add(model); parent?.add(root);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), scale = (zombie ? 1.95 : 1.8) / Math.max(.1, box.max.y - box.min.y);
  model.scale.setScalar(scale); model.position.y = -box.min.y * scale; model.rotation.y = Math.PI;
  const bones = {};
  model.traverse(object => {
    if (object.isBone) bones[object.name.replace(/[.:]/g, '')] = object;
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = true; object.frustumCulled = false;
    object.userData.keepStandard = true; object.userData.paintballIgnore = true;
  });
  const mixer = new THREE.AnimationMixer(model), clips = asset.animations;
  const find = name => clips.find(c => clipName(c) === name);
  const lowerClips = new Map();
  function lowerClip(name) {
    if (!lowerClips.has(name)) {
      const original = find(name); if (!original) return null;
      lowerClips.set(name, new THREE.AnimationClip(`npc-lower-${name}`, original.duration, original.tracks.filter(t => !upperTrack.test(t.name))));
    }
    return lowerClips.get(name);
  }
  let motion = null, special = null, specialUntil = 0, dead = false, lastSerial = -1;
  function play(name, once = false, lower = false) {
    const clip = lower ? lowerClip(name) : find(name); if (!clip) return null;
    const action = mixer.clipAction(clip);
    action.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once; action.setEffectiveWeight(1).play(); return action;
  }
  const armed = !zombie && !entity.ai.stationary && weaponModel;
  let aim = null, gun = null, socket = null;
  const hand = bones['DEF-handR'];
  if (armed && hand && find('Pistol_Aim_Neutral')) {
    const clip = find('Pistol_Aim_Neutral');
    aim = mixer.clipAction(new THREE.AnimationClip('npc-aim', clip.duration, clip.tracks.filter(t => upperTrack.test(t.name)))).play();
    mixer.update(0); root.updateMatrixWorld(true);
    socket = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    gun = weaponModel.model.clone(true); gun.name = 'npc-weapon'; gun.scale.setScalar(.65); root.add(gun);
  }
  const shotClip = armed && find('Pistol_Shoot');
  const recoilClip = shotClip ? shotClip.clone() : null;
  if (recoilClip) recoilClip.tracks = recoilClip.tracks.filter(t => upperTrack.test(t.name));
  const recoil = recoilClip ? mixer.clipAction(THREE.AnimationUtils.makeClipAdditive(recoilClip, 0, find('Pistol_Aim_Neutral'))).setLoop(THREE.LoopOnce, 1) : null;
  const recipe = [];
  function capsule(region, start, end, radius, lift = 0, liftEnd = lift) {
    const a = bones[start], b = bones[end] || a;
    if (a) recipe.push({ region, start: a, end: b, lift, liftEnd, radius, a: new THREE.Vector3(), b: new THREE.Vector3() });
  }
  if (zombie) {
    capsule('head', 'Head', 'Head', .25, -.1, .1);
    capsule('thorax', 'Abdomen', 'Torso', .31);
    capsule('thorax', 'Body', 'Abdomen', .28);
    for (const side of ['L', 'R']) {
      capsule('limb', `UpperArm${side}`, `LowerArm${side}`, .12);
      capsule('limb', `LowerArm${side}`, `Index1${side}`, .1);
      capsule('limb', `UpperLeg${side}`, `LowerLeg${side}`, .15);
      capsule('limb', `LowerLeg${side}`, `Foot${side}`, .11);
    }
  } else {
    capsule('head', 'DEF-head', 'DEF-head', .17, .08, .27);
    capsule('thorax', 'DEF-spine001', 'DEF-spine003', .2);
    capsule('thorax', 'DEF-spine', 'DEF-spine001', .19);
    for (const side of ['L', 'R']) {
      capsule('limb', `DEF-upper_arm${side}`, `DEF-forearm${side}`, .085);
      capsule('limb', `DEF-forearm${side}`, `DEF-hand${side}`, .075);
      capsule('limb', `DEF-hand${side}`, `DEF-f_middle01${side}`, .07);
      capsule('limb', `DEF-thigh${side}`, `DEF-shin${side}`, .115);
      capsule('limb', `DEF-shin${side}`, `DEF-foot${side}`, .095);
      capsule('limb', `DEF-foot${side}`, `DEF-toe${side}`, .1);
    }
  }
  if (!recipe.some(r => r.region === 'head') || !recipe.some(r => r.region === 'thorax')) throw new Error(`Esqueleto incompatível: ${entity.kind}`);
  entity.poseDriven = true; entity.hitboxes = recipe.map(r => ({ region: r.region, a: r.a, b: r.b, radius: r.radius }));
  const debugRoot = new THREE.Group(); debugRoot.name = `${entity.id}-hitboxes`; debugRoot.userData.paintballIgnore = true; parent?.add(debugRoot);
  const debugMaterials = Object.fromEntries(Object.entries({ head: 0xffca62, thorax: 0xff6875, limb: 0x61bfff }).map(([region, color]) => [region, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .65, depthTest: false, depthWrite: false, toneMapped: false })]));
  const debugMeshes = [];
  const bar = new THREE.Group(), barGeometry = new THREE.PlaneGeometry(1, .075);
  const backingMaterial = new THREE.MeshBasicMaterial({ color: 0x15252d, toneMapped: false });
  const fillMaterial = new THREE.MeshBasicMaterial({ color: 0x89d887, toneMapped: false });
  const backing = new THREE.Mesh(barGeometry, backingMaterial), fill = new THREE.Mesh(barGeometry, fillMaterial);
  fill.position.z = .003; bar.add(backing, fill); bar.name = 'zombie-health'; root.add(bar); bar.visible = false;
  // A team ring distinguishes the cooperative Sato without revealing human HP.
  const ringGeometry = new THREE.RingGeometry(.34, .4, 24), ringMaterial = new THREE.MeshBasicMaterial({ color: entity.role === 'ally' ? 0x62d6e8 : 0xe86a65, side: THREE.DoubleSide, transparent: true, opacity: .75, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = .025; ring.visible = !zombie; root.add(ring);

  function specialAnimation(name, seconds, time) {
    if (dead) return;
    special?.stop(); motion?.stop(); aim?.stop(); special = play(name, true); specialUntil = time + seconds;
  }
  function update(dt, time, camera, showHitboxes = false) {
    root.position.copy(entity.position); root.rotation.y = entity.yaw;
    if (entity.dead && !dead) {
      ring.visible = bar.visible = false; if (gun) gun.visible = false;
      if (ragdolls) ragdolls.capture(root, { impulse: entity.dead.impulse || entity.deathImpulse });
      dead = true; mixer.stopAllAction(); special = play(zombie ? 'Death' : 'Death01', true); ring.visible = false;
    }
    if (dead && ragdolls) { root.visible = false; debugRoot.visible = false; return; }
    if (!dead) {
      if (entity.actionSerial !== lastSerial && entity.action === 'melee') specialAnimation(zombie ? 'Idle_Attack' : 'Punch_Jab', .65, time);
      lastSerial = entity.actionSerial;
      if (special && time >= specialUntil) { special.stop(); special = null; motion = null; }
      if (!special) {
        const name = entity.action === 'walk' ? (zombie ? 'Walk' : 'Walk_Loop') : (zombie ? 'Idle' : 'Idle_Loop');
        const next = armed ? lowerClip(name) : find(name);
        if (next && motion?.getClip() !== next) { motion?.stop(); motion = play(name, false, !!armed); }
        aim?.play();
      }
    }
    mixer.update(Math.max(0, dt)); root.updateMatrixWorld(true);
    if (gun && hand && socket) {
      const palm = hand.localToWorld(new THREE.Vector3(-.014, .044, -.004));
      const rotation = hand.getWorldQuaternion(new THREE.Quaternion()).multiply(socket);
      const world = root.getWorldQuaternion(new THREE.Quaternion());
      gun.quaternion.copy(world.invert().multiply(rotation));
      gun.position.copy(root.worldToLocal(palm)).sub(weaponModel.grip.clone().multiplyScalar(.65).applyQuaternion(gun.quaternion));
      root.updateMatrixWorld(true);
      entity.muzzle = gun.localToWorld(weaponModel.muzzle.clone());
    }
    for (const r of recipe) {
      r.start.getWorldPosition(r.a); r.end.getWorldPosition(r.b);
      if (r.lift) r.a.add(new THREE.Vector3(0, r.lift, 0).applyQuaternion(r.start.getWorldQuaternion(new THREE.Quaternion())));
      if (r.liftEnd) r.b.add(new THREE.Vector3(0, r.liftEnd, 0).applyQuaternion(r.end.getWorldQuaternion(new THREE.Quaternion())));
    }
    debugRoot.visible = showHitboxes && !dead;
    if (debugRoot.visible) recipe.forEach((r, i) => {
      if (!debugMeshes[i]) {
        const geometry = new THREE.CapsuleGeometry(r.radius, r.a.distanceTo(r.b), 4, 8);
        debugMeshes[i] = new THREE.Mesh(geometry, debugMaterials[r.region]); debugRoot.add(debugMeshes[i]);
      }
      const mesh = debugMeshes[i]; mesh.position.copy(r.a).add(r.b).multiplyScalar(.5);
      const direction = r.b.clone().sub(r.a);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.lengthSq() > 1e-9 ? direction.normalize() : new THREE.Vector3(0, 1, 0));
    });
    bar.visible = zombie && !dead && time - entity.health.lastHitAt < 3;
    if (bar.visible && camera) {
      const head = recipe.find(r => r.region === 'head');
      bar.position.copy(root.worldToLocal(head.a.clone().add(new THREE.Vector3(0, .45, 0))));
      bar.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(camera.quaternion));
      const fraction = entity.health.current / entity.health.max; fill.scale.x = fraction; fill.position.x = -(1 - fraction) / 2;
    }
  }
  update(0, 0, null);
  return { root, model, bones, mixer, update, healthBar: bar, debugRoot,
    shoot() { if (!dead) recoil?.reset().setEffectiveWeight(1).play(); },
    reload(seconds, time) {
      specialAnimation('Pistol_Reload', seconds, time);
      if (special) special.setEffectiveTimeScale(special.getClip().duration / seconds);
    },
    react(region, time) { specialAnimation(zombie ? 'HitReact' : region === 'head' ? 'Hit_Head' : 'Hit_Chest', .25, time); },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model); root.removeFromParent(); debugRoot.removeFromParent();
      const skeletons = new Set(); model.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); }); for (const skeleton of skeletons) skeleton.dispose();
      for (const mesh of debugMeshes) mesh.geometry.dispose();
      for (const material of Object.values(debugMaterials)) material.dispose();
      barGeometry.dispose(); backingMaterial.dispose(); fillMaterial.dispose(); ringGeometry.dispose(); ringMaterial.dispose();
    },
  };
}
