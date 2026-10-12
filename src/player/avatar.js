import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sweepHairTips } from './hair.js';
import { GAITS, gaitForSpeed } from './locomotion.js';
import { createPoseConfig } from './pose-config.js';
import { fillThumbWebs } from './hand-shape.js';
import { aimBone, poseArm } from './arm-pose.js';
import { createFirstPersonFists } from './first-person-fists.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createAppearance } from './appearance.js';

const upperTrack = /spine|neck|head|shoulder|upper_arm|forearm|hand|f_index|f_middle|f_ring|f_pinky|thumb|support_elbow/;
const namedClip = (clips, name) => clips.find(clip => clip.name.split('|').at(-1) === name);
const vector = () => new THREE.Vector3();
const quaternion = () => new THREE.Quaternion();
const kindOf = weapon => weapon?.kind || (['fists', 'unarmed'].includes(weapon?.id || weapon) ? 'unarmed'
  : /knife|axe|bat|sword/.test(weapon?.id || weapon || '') ? 'melee' : 'firearm');
const MELEE_VIEW_SCALE = .76;
const weaponProfiles = new WeakMap();

// Measure the active model, including its iron sights and stock. A shared ADS
// height cannot keep differently shaped GLBs below the screen's reticle.
function weaponTopInView(gun, cameraRotation) {
  const meshes = [];
  for (const child of gun.children) if (child.visible) child.traverseVisible(object => { if (object.isMesh) meshes.push(object); });
  let profile = weaponProfiles.get(gun);
  if (!profile || meshes.length !== profile.meshes.length || meshes.some((mesh, i) => mesh !== profile.meshes[i])) {
    gun.updateWorldMatrix(true, true);
    const inverse = gun.matrixWorld.clone().invert(), bounds = new THREE.Box3();
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
    }
    profile = { meshes, bounds }; weaponProfiles.set(gun, profile);
  }
  if (profile.bounds.isEmpty()) return 0;
  const rotation = cameraRotation.clone().invert().multiply(gun.quaternion), bounds = profile.bounds;
  let top = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    top = Math.max(top, vector().set(x, y, z).multiply(gun.scale).applyQuaternion(rotation).y);
  }
  return top;
}

/** Keep the supplied GLB intact. Both views share its meshes, materials and
 * skeleton; authored pistol animations drive the arms, wrists and fingers. */
export function createAvatarFromGLTF(gltf, { scene, camera, player }) {
  const root = new THREE.Group(); root.name = 'sato-player'; root.userData.paintballIgnore = true;
  const model = gltf.scene; root.add(model); scene.add(root);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const scale = 1.8 / Math.max(.1, box.max.y - box.min.y);
  model.scale.setScalar(scale); model.position.y = -box.min.y * scale;
  model.rotation.y = Math.PI; // Sato faces +Z; the game faces -Z.
  const bones = {}, meshes = [];
  model.traverse(object => {
    if (object.isBone) bones[object.name] = object;
    if (object.isMesh) {
      meshes.push(object); object.frustumCulled = false;
      object.receiveShadow = object.castShadow = true; object.userData.paintballIgnore = true;
    }
  });
  root.updateMatrixWorld(true);
  const bindPose = Object.fromEntries(Object.values(bones).map(bone => [bone.name, bone.quaternion.clone()]));
  fillThumbWebs(meshes);
  sweepHairTips(meshes);
  const appearance = createAppearance(model, bones, meshes);
  const poseConfig = createPoseConfig();
  const head = bones['DEF-head'];
  const uprightHead = head?.getWorldQuaternion(quaternion());
  const clips = gltf.animations, mixer = new THREE.AnimationMixer(model);
  const rightHand = bones['DEF-handR'], leftHand = bones['DEF-handL'];
  const neutral = namedClip(clips, 'Pistol_Aim_Neutral');
  if (!rightHand || !leftHand || !neutral) throw new Error('Sato precisa do esqueleto e da pose original de pistola.');

  // Calibrate the existing gun against the ORIGINAL neutral hand frame. The
  // weapon follows this socket; no guessed wrist rotations overwrite the GLB.
  const sampler = new THREE.AnimationMixer(model);
  sampler.clipAction(neutral).play(); sampler.setTime(0); root.updateMatrixWorld(true);
  const socketRotation = rightHand.getWorldQuaternion(quaternion()).invert();
  const spine = bones['DEF-spine001'], hips = spine.parent;
  const hipsReference = model.getWorldQuaternion(quaternion()).invert().multiply(hips.getWorldQuaternion(quaternion()));
  const standingHipPosition = root.worldToLocal(hips.getWorldPosition(vector()));
  sampler.stopAllAction(); sampler.uncacheRoot(model);
  const aimLimits = ['Pistol_Aim_Up', 'Pistol_Aim_Down'].map(name => {
    sampler.clipAction(namedClip(clips, name) || neutral).play(); sampler.setTime(0); root.updateMatrixWorld(true);
    const forward = vector().set(0, 0, -1).applyQuaternion(rightHand.getWorldQuaternion(quaternion()).multiply(socketRotation));
    const limit = Math.max(.1, Math.abs(Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1))));
    sampler.stopAllAction(); sampler.uncacheRoot(model); return limit;
  });
  const swordClip = namedClip(clips, 'Sword_Idle') || neutral;
  const punchClip = namedClip(clips, 'Punch_Enter') || neutral;
  function samplePose(clip, time = 0) {
    sampler.clipAction(clip).play(); sampler.setTime(time); root.updateMatrixWorld(true);
    const rotation = rightHand.getWorldQuaternion(quaternion()).invert();
    const palm = root.worldToLocal(rightHand.localToWorld(vector().set(-.014, .044, -.004)));
    const center = rightHand.getWorldPosition(vector()).add(leftHand.getWorldPosition(vector())).multiplyScalar(.5);
    root.worldToLocal(center);
    const hands = { L: root.worldToLocal(leftHand.getWorldPosition(vector())), R: root.worldToLocal(rightHand.getWorldPosition(vector())) };
    sampler.stopAllAction(); sampler.uncacheRoot(model);
    return { rotation, palm, center, hands };
  }
  const neutralPose = samplePose(neutral);
  const swordPose = samplePose(swordClip);
  const punchPose = samplePose(punchClip, Math.max(0, punchClip.duration - .001));
  // Prepared melee shafts point -Z. The original sword pose holds the blade up;
  // its hand frame then carries the entire authored slash without correction.
  const swordSocket = swordPose.rotation.multiply(quaternion().setFromAxisAngle(vector().set(1, 0, 0), Math.PI / 2));
  const firstSwordSocket = socketRotation.clone().multiply(quaternion().setFromAxisAngle(vector().set(1, 0, 0), .35));

  const lowerActions = new Map(); let motion = null, motionFullBody = false, preview = null;
  function layer(clip, upper) {
    return mixer.clipAction(new THREE.AnimationClip(`${upper === null ? 'body' : upper ? 'upper' : 'lower'}-${clip.name}`, clip.duration,
      clip.tracks.filter(track => upper === null || upperTrack.test(track.name) === upper), clip.blendMode));
  }
  const aimActions = ['Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down'].map(name => {
    const action = layer(namedClip(clips, name) || neutral, true);
    action.setEffectiveWeight(0).play(); return action;
  });
  const shootClip = namedClip(clips, 'Pistol_Shoot');
  // Keep the selected aim pose while applying the authored shot's recoil delta.
  const shootAction = shootClip ? layer(THREE.AnimationUtils.makeClipAdditive(shootClip.clone(), 0, neutral), true)
    .setLoop(THREE.LoopOnce, 1) : null;
  const reloadClip = namedClip(clips, 'Pistol_Reload');
  const reloadAction = reloadClip ? layer(reloadClip, true).setLoop(THREE.LoopOnce, 1).setEffectiveWeight(0) : null;
  let reloadState = null;
  const swordIdle = layer(swordClip, true).setEffectiveWeight(0).play();
  const punchIdleClip = punchClip.clone(); punchIdleClip.name = 'Punch_Ready';
  punchIdleClip.tracks = punchIdleClip.tracks.map(track => {
    const frozen = track.clone(), values = track.createInterpolant().evaluate(Math.max(0, punchClip.duration - .001));
    frozen.times = new Float32Array([0]); frozen.values = new Float32Array(values); return frozen;
  });
  punchIdleClip.duration = 1;
  const punchIdle = layer(punchIdleClip, true).setEffectiveWeight(0).play();
  const attackActions = new Map();
  let heldKind = 'firearm', heldWeapon = 'pistol', attack = null, punchSequence = 0, currentAimBlend = 0, scopedView = false;
  const animationState = { motion: 'Idle_Loop', attack: null, reload: null, kind: heldKind };
  const poseAnchor = vector();
  const authoredSpine = spine.quaternion.clone();
  const evaluatedCamera = quaternion(), evaluatedEye = vector();
  const firstPersonFists = createFirstPersonFists(root, bones, bindPose);
  function setMotion(name, speed, fullBody = false) {
    const key = `${fullBody ? 'body' : 'lower'}-${name}`;
    if (!lowerActions.has(key)) {
      const clip = namedClip(clips, name) || namedClip(clips, 'Idle_Loop');
      lowerActions.set(key, layer(clip, fullBody ? null : false));
    }
    const next = lowerActions.get(key);
    if (motion !== next) {
      next.reset().setEffectiveWeight(1).play();
      // When ownership of the upper body changes, the weapon layer switches
      // immediately too. Avoid fading from an absent upper layer into bind pose.
      if (motion) {
        if (motionFullBody === fullBody) motion.crossFadeTo(next, .16, false);
        else motion.stop();
      }
      motion = next; motionFullBody = fullBody;
    }
    next.setEffectiveTimeScale(speed);
    animationState.motion = name;
  }
  function visibility() {
    for (const mesh of meshes) {
      mesh.visible = !mesh.userData.characterHidden && (!!preview || player.cameraMode === 'third' || (heldKind !== 'relaxed' && !scopedView && /Sato_arm_hand_[LR]/.test(mesh.name)));
      mesh.castShadow = player.cameraMode === 'third';
    }
    appearance.setHeadVisible(!!preview || player.cameraMode === 'third', heldKind !== 'relaxed' && !scopedView);
  }
  let greeting = 0, dancing = 0;
  const greetingBones = Object.values(bones).filter(bone => /DEF-(upper_arm|forearm|hand|f_|thumb).*R$/.test(bone.name));
  const greetingBase = new Map();
  function restoreGreeting() {
    for (const [bone, rotation] of greetingBase) bone.quaternion.copy(rotation);
    greetingBase.clear();
  }
  function update(dt) {
    firstPersonFists.restore();
    restoreGreeting();
    root.scale.setScalar(!preview && !player.fly && player.cameraMode === 'first' && heldKind === 'melee' ? MELEE_VIEW_SCALE : 1);
    root.position.copy(player.feet);
    if (player.cameraMode === 'first' && !preview) {
      root.quaternion.copy(camera.quaternion);
      const eyeOffset = player.eyePosition.clone().sub(player.feet);
      root.position.copy(player.eyePosition).sub(eyeOffset.applyQuaternion(root.quaternion));
      root.position.add(vector().set(0, .18, -.10).applyQuaternion(root.quaternion));
    } else root.rotation.set(0, player.yaw, 0);
    poseAnchor.copy(root.position);
    root.visible = player.active || !!preview; visibility();
    if (preview) mixer.setTime(preview.time);
    else {
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      if (speed > .15 || player.fly || !player.active) dancing = greeting = 0;
      dancing = Math.max(0, dancing - Math.max(0, dt));
      greeting = Math.max(0, greeting - Math.max(0, dt));
      animationState.emote = dancing > 0 ? 'dance' : greeting > 0 ? 'wave' : null;
      const flying = !!player.fly, fullBody = flying || heldKind === 'relaxed' || dancing > 0 || greeting > 0;
      const airborne = !player.grounded && player.active;
      const gait = GAITS[gaitForSpeed(speed, player.crouched && !flying)];
      setMotion(dancing > 0 ? 'Dance_Loop' : flying ? 'Swim_Fwd_Loop' : airborne ? 'Jump_Loop' : gait.clip, dancing > 0 ? 1 : flying ? 1.2 : airborne || !gait.speed ? 1 : speed / gait.speed, fullBody);
      // Reload timing must match the ammo clock even below 20 fps.
      const frameDt = Math.min(reloadState ? .1 : .05, Math.max(0, dt));
      const firstMelee = !fullBody && heldKind === 'melee' && player.cameraMode === 'first';
      const firstAttack = firstMelee;
      if (fullBody) { stopAttack(); stopReload(); shootAction?.stop(); }
      if (reloadState) {
        reloadState.elapsed += frameDt;
        reloadAction.setEffectiveWeight(Math.max(0, Math.min(1, reloadState.elapsed / .08, (reloadState.duration - reloadState.elapsed) / .12)));
        if (reloadState.elapsed >= reloadState.duration) stopReload();
      }
      if (attack) {
        attack.elapsed += frameDt;
        if (attack.elapsed >= attack.duration) stopAttack();
      }
      const attackWeight = attack ? Math.min(1, attack.elapsed / .045, (attack.duration - attack.elapsed) / .10) : 0;
      if (attack) {
        attack.action.setEffectiveWeight(firstAttack ? 0 : Math.max(0, attackWeight));
        attack.firstAction?.setEffectiveWeight(firstAttack ? Math.max(0, attackWeight) * .65 : 0);
      }
      swordIdle.play().setEffectiveWeight(!fullBody && heldKind === 'melee' && !firstMelee ? 1 - attackWeight : 0);
      punchIdle.play().setEffectiveWeight(!fullBody && heldKind === 'unarmed' ? 1 - attackWeight : 0);
      // First-person shoulders already rotate with the eyes. Third person uses
      // the supplied up/down aim poses without twisting the bones by hand.
      const pitch = player.cameraMode === 'third' ? new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').x : 0;
      const amount = THREE.MathUtils.clamp(Math.abs(pitch) / aimLimits[pitch > 0 ? 0 : 1], 0, 1);
      const weights = [1 - amount, pitch > 0 ? amount : 0, pitch < 0 ? amount : 0];
      aimActions.forEach((action, i) => { action.play(); action.setEffectiveWeight(!fullBody && (heldKind === 'firearm' || firstMelee) ? weights[i] * (1 - (reloadAction?.getEffectiveWeight() || 0)) : 0); });
      if (heldKind !== 'firearm') shootAction?.stop();
      spine.quaternion.copy(authoredSpine);
      // Controller advances this phase by actual displacement. Sound events and
      // the two planted feet therefore share a cycle even when changing speed.
      if (!flying && !airborne && gait.speed && player.locomotion) {
        motion.time = (player.locomotion.phase % 1) * motion.getClip().duration - frameDt * motion.getEffectiveTimeScale();
      }
      mixer.update(frameDt);
      authoredSpine.copy(spine.quaternion);
      // Legs retain their gait, while the aiming torso cancels inherited hip
      // rotation. Stabilize the whole arm chain, never the wrists/fingers alone.
      if (!fullBody) {
        root.updateMatrixWorld(true);
        const hipsWorld = hips.getWorldQuaternion(quaternion());
        spine.quaternion.premultiply(hipsWorld.clone().invert().multiply(model.getWorldQuaternion(quaternion())).multiply(hipsReference));
        root.updateMatrixWorld(true);
        if (heldKind === 'firearm' && !reloadState) {
          const gunRotation = rightHand.getWorldQuaternion(quaternion()).multiply(socketRotation);
          const aimFrame = player.cameraMode === 'first' ? camera.quaternion.clone() : quaternion().setFromAxisAngle(vector().set(0, 1, 0), player.yaw);
          const relative = aimFrame.clone().invert().multiply(gunRotation);
          const kickPitch = new THREE.Euler().setFromQuaternion(relative, 'YXZ').x;
          const phase = player.locomotion ? player.locomotion.phase * Math.PI * 2 : mixer.time * speed / 7.015 / GAITS.run.duration * Math.PI * 2;
          const runSway = THREE.MathUtils.smoothstep(speed, 3.5, 9.5);
          const aimedSway = currentAimBlend * .25 * THREE.MathUtils.smoothstep(speed, .15, 3.1);
          const sway = !airborne ? Math.max(runSway, aimedSway) * (1 - .35 * currentAimBlend) * (player.cameraMode === 'first' ? .35 : 1) : 0;
          const desired = aimFrame.multiply(quaternion().setFromEuler(new THREE.Euler(kickPitch + Math.sin(phase * 2) * .011 * sway,
            Math.sin(phase) * .009 * sway, Math.cos(phase) * .014 * sway, 'YXZ')));
          const correction = hipsWorld.clone().invert().multiply(desired).multiply(gunRotation.invert()).multiply(hipsWorld);
          spine.quaternion.premultiply(correction);
        }
      }
      // Boxing/sword clips tilt the neck with the crouched guard. Preserve the
      // attack below it, while keeping the face at the upright rest orientation.
      if (!fullBody && heldKind !== 'firearm' && player.cameraMode === 'third' && head && uprightHead) {
        root.updateMatrixWorld(true);
        head.quaternion.copy(head.parent.getWorldQuaternion(quaternion()).invert()
          .multiply(root.quaternion).multiply(uprightHead));
      }
    }
    if (greeting > 0 && !preview && !player.fly) {
      const weight = Math.min(1, greeting / .25, (2.5 - greeting) / .2);
      for (const bone of greetingBones) greetingBase.set(bone, bone.quaternion.clone());
      root.updateMatrixWorld(true);
      const upper = bones['DEF-upper_armR'], fore = bones['DEF-forearmR'], hand = bones['DEF-handR'], middle = bones['DEF-f_middle01R'];
      const shoulder = root.worldToLocal(upper.getWorldPosition(vector())), sign = Math.sign(shoulder.x) || 1;
      const target = root.localToWorld(shoulder.clone().add(vector().set(sign * (.08 + Math.sin(greeting * 12) * .055), .40, -.06)));
      poseArm(upper, fore, hand, target, vector().set(sign, -.15, .2).applyQuaternion(root.quaternion));
      for (const bone of greetingBones) if (/f_|thumb/.test(bone.name)) bone.quaternion.copy(bindPose[bone.name]);
      hand.updateWorldMatrix(false, true);
      aimBone(hand, middle, hand.getWorldPosition(vector()).add(vector().set(Math.sin(greeting * 12) * .10, .25, 0).applyQuaternion(root.quaternion)));
      for (const [bone, base] of greetingBase) bone.quaternion.slerpQuaternions(base, bone.quaternion.clone(), weight);
    }
    evaluatedCamera.copy(camera.quaternion); evaluatedEye.copy(player.eyePosition);
    root.updateMatrixWorld(true);
  }
  function playShot(strength = 1) {
    dancing = greeting = 0;
    if (!preview && !player.fly && heldKind === 'firearm' && shootAction) {
      const amount = Math.max(0, Number(strength) || 1);
      shootAction.reset().setEffectiveWeight(player.cameraMode === 'first' ? Math.min(.55, .18 * amount) : Math.min(1.8, .8 * amount)).play();
    }
  }
  function stopReload() {
    reloadAction?.stop(); reloadAction?.setEffectiveWeight(0); reloadState = null; animationState.reload = null;
  }
  function playReload(duration = 2.3) {
    dancing = greeting = 0;
    if (!reloadAction || preview || player.fly || heldKind !== 'firearm') return false;
    stopAttack(); shootAction?.stop();
    reloadState = { elapsed: 0, duration }; animationState.reload = 'Pistol_Reload';
    reloadAction.reset().setEffectiveTimeScale(reloadClip.duration / duration).setEffectiveWeight(0).play();
    reloadAction.clampWhenFinished = true; return true;
  }
  function setWeapon(weapon) {
    const nextKind = weapon?.holstered ? 'relaxed' : kindOf(weapon), nextId = weapon?.id || weapon || 'pistol';
    if (nextId !== heldWeapon || nextKind !== heldKind) { stopAttack(); stopReload(); }
    heldKind = nextKind; heldWeapon = nextId; animationState.kind = heldKind;
  }
  function stopAttack() {
    attack?.action.stop(); attack?.firstAction?.stop(); attack = null; animationState.attack = null;
  }
  function playAttack(weapon, { sequence } = {}) {
    dancing = greeting = 0;
    if (preview || player.fly) return null;
    setWeapon(weapon);
    if (heldKind === 'firearm') { playShot(); return null; }
    const name = heldKind === 'melee' ? 'Sword_Attack' : (sequence ?? punchSequence++) % 2 ? 'Punch_Cross' : 'Punch_Jab';
    const clip = namedClip(clips, name);
    if (!clip) return null;
    stopAttack();
    if (!attackActions.has(name)) attackActions.set(name, layer(clip, true).setLoop(THREE.LoopOnce, 1));
    const action = attackActions.get(name), duration = Math.max(.2, Number(weapon?.interval) || clip.duration);
    action.reset().setEffectiveTimeScale(clip.duration / duration).setEffectiveWeight(0).play();
    action.clampWhenFinished = true;
    let firstAction = null;
    if (heldKind === 'melee') {
      const key = `${name}-first`;
      if (!attackActions.has(key)) {
        // The sword rest pose puts the hand behind the torso. In first person,
        // use its authored arm delta over a forward guard; keep shoulders/spine
        // fixed so severed upper-arm starts stay behind the camera near plane.
        const delta = THREE.AnimationUtils.makeClipAdditive(clip.clone(), 0, heldKind === 'melee' ? swordClip : punchIdleClip);
        delta.tracks = delta.tracks.filter(track => /upper_arm|forearm|hand|f_index|f_middle|f_ring|f_pinky|thumb|support_elbow/.test(track.name));
        firstAction = layer(delta, true).setLoop(THREE.LoopOnce, 1);
        attackActions.set(key, firstAction);
      } else firstAction = attackActions.get(key);
      firstAction.reset().setEffectiveTimeScale(clip.duration / duration).setEffectiveWeight(0).play();
      firstAction.clampWhenFinished = true;
    }
    attack = { action, firstAction, duration, elapsed: 0 }; animationState.attack = name;
    return { clip: name, duration };
  }

  const palm = vector(), gripLocal = vector(), weaponDiagnostics = { gripError: 0 };
  function updateWeapon(gun, { weapon = 'pistol', kind = kindOf(weapon), holstered = false, active = true, aimBlend = 0, recoil = 0, scoped = false } = {}) {
    gun.userData.characterEmote = dancing > 0 || greeting > 0;
    if (preview) return false;
    const changedKind = heldKind !== (holstered ? 'relaxed' : kind);
    setWeapon({ id: weapon?.id || weapon, kind, holstered }); currentAimBlend = aimBlend; scopedView = !!scoped;
    // Input can move the camera and fire between render frames. Re-evaluate the
    // rig at the same camera transform before sampling its socket (no time step).
    if (changedKind || evaluatedCamera.angleTo(camera.quaternion) > 1e-7 || evaluatedEye.distanceToSquared(player.eyePosition) > 1e-12) update(0);
    firstPersonFists.restore();
    if (gun.parent !== scene) scene.add(gun);
    root.visible = !!active;
    const fullBody = player.fly || heldKind === 'relaxed';
    root.scale.setScalar(!fullBody && player.cameraMode === 'first' && heldKind === 'melee' ? MELEE_VIEW_SCALE : 1);
    if (player.cameraMode === 'first') root.quaternion.copy(camera.quaternion);
    root.position.copy(poseAnchor); visibility(); root.updateMatrixWorld(true);
    const armConfig = poseConfig.get(heldWeapon, 'first', 'arms');
    // The camera already lowers with crouch. Keep its guard independent of the
    // authored hip drop/backward shift, while the world model keeps that motion.
    const stanceOffset = player.crouched ? root.worldToLocal(hips.getWorldPosition(vector())).sub(standingHipPosition) : vector();
    const firstPunch = !fullBody && heldKind === 'unarmed' && player.cameraMode === 'first';
    if (firstPunch) firstPersonFists.frame(camera, player.eyePosition, punchPose.center.clone().add(stanceOffset), armConfig, {
      hands: punchPose.hands, stanceOffset, side: animationState.attack === 'Punch_Jab' ? 'L' : 'R', phase: attack ? attack.elapsed / attack.duration : null,
    });
    else if (!fullBody && player.cameraMode === 'first') {
      // Apply camera-local framing to the complete rig, keeping both arms and
      // the weapon socket together, including during the authored punches.
      const delta = quaternion().setFromEuler(new THREE.Euler(...['x', 'y', 'z'].map(axis => THREE.MathUtils.degToRad(armConfig.rotation[axis]))));
      root.quaternion.copy(camera.quaternion).multiply(delta);
      root.scale.multiply(vector().set(armConfig.scale.x, armConfig.scale.y, armConfig.scale.z));
      root.updateMatrixWorld(true);
    }
    const handRotation = rightHand.getWorldQuaternion(quaternion());
    const firstMelee = !fullBody && heldKind === 'melee' && player.cameraMode === 'first';
    gun.quaternion.copy(handRotation).multiply(heldKind === 'melee' ? firstMelee ? firstSwordSocket : swordSocket : socketRotation);
    const gripRotation = gun.userData.weaponGripRotation;
    if (gripRotation?.isQuaternion) gun.quaternion.multiply(gripRotation);
    else if (Array.isArray(gripRotation)) gun.quaternion.multiply(quaternion().setFromEuler(new THREE.Euler(...gripRotation)));
    const socketConfig = poseConfig.get(heldWeapon, player.cameraMode);
    gun.scale.copy(root.scale).multiplyScalar(.65);
    // Grip centre lies inside the curled fingers, left/forward of the wrist.
    palm.copy(rightHand.localToWorld(vector().set(-.014, .044, -.004)));
    if (gun.userData.weaponGrip) gripLocal.copy(gun.userData.weaponGrip);
    else gripLocal.set(0, weapon === 'automatic' ? -.15 : -.13, weapon === 'automatic' ? .065 : .08);
    const socketOffset = vector().set(socketConfig.position.x, socketConfig.position.y, socketConfig.position.z).applyQuaternion(handRotation);
    gun.position.copy(palm).sub(gripLocal.clone().multiply(gun.scale).applyQuaternion(gun.quaternion));
    if (!fullBody && player.cameraMode === 'first' && !firstPunch) {
      // Frame the original animated arms as a unit. Moving their common root
      // preserves every authored joint and keeps ADS readable on narrow screens.
      const firearm = heldKind === 'firearm';
      const baseY = -.24 + (weapon === 'automatic' ? .06 : .10) * aimBlend - recoil * .02;
      const clearY = firearm ? Math.min(baseY, -weaponTopInView(gun, camera.quaternion) - .012) : -.35;
      const desired = vector().set(firstMelee ? Math.min(.185, camera.aspect * .15) : firearm ? Math.min(.14, camera.aspect * .11) * (1 - aimBlend) : 0, firearm ? clearY : firstMelee ? -.35 : -.14,
        firearm ? -.34 - .04 * aimBlend + recoil * .045 : firstMelee ? -.48 : -.41)
        .applyQuaternion(camera.quaternion).add(player.eyePosition);
      // Center only the idle hand anchor for sword/punches. Re-centering the
      // animated weapon each frame would erase the visible first-person swing.
      const anchor = (firstMelee ? neutralPose.palm : firearm ? neutralPose.center : punchPose.center).clone().add(stanceOffset);
      // Frame the hands independently of debug socket offsets, so editing a
      // firearm's offset cannot be cancelled by automatic camera framing.
      const shift = desired.sub(firearm && !reloadState ? gun.position : root.localToWorld(anchor.clone()));
      shift.add(vector().set(armConfig.position.x, armConfig.position.y, armConfig.position.z).applyQuaternion(camera.quaternion));
      root.position.add(shift); gun.position.add(shift); palm.add(shift);
      root.updateMatrixWorld(true);
    }
    // Socket edits happen after default arm framing. Offsets/rotation/scale are
    // truly relative to the hand and can be calibrated without moving the rig.
    gun.quaternion.multiply(quaternion().setFromEuler(new THREE.Euler(...['x', 'y', 'z'].map(axis => THREE.MathUtils.degToRad(socketConfig.rotation[axis])))));
    gun.scale.multiply(vector().set(socketConfig.scale.x, socketConfig.scale.y, socketConfig.scale.z));
    gun.position.copy(palm).add(socketOffset).sub(gripLocal.clone().multiply(gun.scale).applyQuaternion(gun.quaternion));
    gun.updateWorldMatrix(true, true);
    weaponDiagnostics.gripError = gun.localToWorld(gripLocal.clone()).distanceTo(palm.clone().add(socketOffset));
    return true;
  }
  function setPreviewAnimation(name, time = 0) {
    mixer.stopAllAction(); motion = null;
    authoredSpine.copy(spine.quaternion);
    if (!name) { preview = null; update(0); return; }
    const clip = clips.find(clip => clip.name === name) || namedClip(clips, name);
    if (!clip) throw new Error(`Animação Sato desconhecida: ${name}`);
    preview = { name: clip.name, time }; mixer.clipAction(clip).play(); update(0);
  }
  update(0);
  return { root, model, bones, meshes, mixer, clips, scale, update, updateWeapon, playShot, playAttack, playReload, stopReload, setWeapon,
    setPreviewAnimation, weaponDiagnostics, animationState, poseConfig, appearance, playGreeting() { dancing = 0; greeting = 2.5; },
    stopEmote() { dancing = greeting = 0; animationState.emote = null; },
    playEmote(id) { if (id === 'dance') { stopAttack(); stopReload(); greeting = 0; dancing = 5; } else if (id === 'wave') { dancing = 0; greeting = 2.5; } } };
}

export async function loadPlayerAvatar(options, url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const source = cloneSkeleton(gltf.scene);
  const avatar = createAvatarFromGLTF(gltf, options);
  avatar.cloneForPreview = context => createAvatarFromGLTF({ scene: cloneSkeleton(source), animations: gltf.animations }, context);
  avatar.createCorpse = () => {
    const live = options.player;
    const state = { feet: live.feet.clone(), eyePosition: live.eyePosition.clone(), velocity: live.velocity.clone(),
      cameraMode: 'third', active: true, fly: false, grounded: true, crouched: live.crouched, yaw: live.yaw };
    const corpse = avatar.cloneForPreview({ scene: options.scene, camera: options.camera, player: state });
    corpse.appearance.apply(avatar.appearance.value);
    corpse.setWeapon({ id: 'fists', kind: avatar.animationState.kind }); corpse.update(0);
    // The first-person rig is reframed for the camera. Transfer its stains by
    // bone name into the independent full-body death rig.
    for (const bone of Object.values(avatar.bones)) for (const mark of bone.children) if (mark.userData.bodyPaint) corpse.bones[bone.name.replace(/[.:]/g, '')]?.add(mark.clone());
    return { root: corpse.root, cleanup() {
      corpse.appearance.dispose(); corpse.mixer.stopAllAction(); corpse.mixer.uncacheRoot(corpse.model);
      const skeletons = new Set(); corpse.model.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
      for (const skeleton of skeletons) skeleton.dispose(); corpse.root.removeFromParent();
    } };
  };
  return avatar;
}
