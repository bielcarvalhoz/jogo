import * as THREE from 'three';
import { poseArm } from './arm-pose.js';

const v = () => new THREE.Vector3();
const q = () => new THREE.Quaternion();

/** A bent boxing guard and full shoulder/elbow extension. Fingers retain their
 * authored bind axes; knuckles face forward and arm starts stay offscreen. */
export function createFirstPersonFists(root, bones, bindPose) {
  const arms = ['R', 'L'].map(side => ({
    sign: side === 'R' ? 1 : -1,
    upper: bones[`DEF-upper_arm${side}`], fore: bones[`DEF-forearm${side}`], hand: bones[`DEF-hand${side}`],
    position: v(), upperRotation: q(), foreRotation: q(), handRotation: q(),
    curls: ['index', 'middle', 'ring', 'pinky'].flatMap(finger => [1, 2, 3].map((joint, i) => ({
      bone: bones[`DEF-f_${finger}0${joint}${side}`], rotation: q(), angle: [1.5, 1.5, .8][i],
    }))),
  }));
  let applied = false;
  function restore() {
    if (!applied) return;
    for (const arm of arms) {
      arm.upper.position.copy(arm.position); arm.upper.quaternion.copy(arm.upperRotation);
      arm.fore.quaternion.copy(arm.foreRotation); arm.hand.quaternion.copy(arm.handRotation);
      for (const curl of arm.curls) curl.bone.quaternion.copy(curl.rotation);
    }
    applied = false;
  }
  function frame(camera, eye, anchor, config, punch = {}) {
    const center = v().set(0, -.14, -.41).applyQuaternion(camera.quaternion).add(eye);
    root.position.add(center.clone().sub(root.localToWorld(anchor.clone())));
    root.updateMatrixWorld(true);
    const toWorld = point => point.applyQuaternion(camera.quaternion).add(eye);
    const horizontal = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const phase = punch.phase;
    const progress = phase === null || phase === undefined ? 0 : phase < .16 ? 0 : phase < .44
      ? THREE.MathUtils.smoothstep(phase, .16, .44) : 1 - THREE.MathUtils.smoothstep(phase, .44, 1);
    const windup = phase === null || phase === undefined ? 0 : Math.sin(Math.PI * THREE.MathUtils.clamp(phase / .25, 0, 1));
    const width = Math.min(1, horizontal / .62);
    for (const arm of arms) {
      const { upper, fore, hand, sign } = arm;
      arm.position.copy(upper.position); arm.upperRotation.copy(upper.quaternion);
      arm.foreRotation.copy(fore.quaternion); arm.handRotation.copy(hand.quaternion);
      for (const curl of arm.curls) curl.rotation.copy(curl.bone.quaternion);
      // In this rig fingers extend along hand +Y and the index row is +Z.
      // Point knuckles forward and thumbs inward, with palms angled down.
      const wristRotation = camera.quaternion.clone()
        .multiply(q().setFromAxisAngle(v().set(0, 0, 1), sign * Math.PI * .4))
        .multiply(q().setFromAxisAngle(v().set(1, 0, 0), -Math.PI / 2));
      const striking = (sign === 1 ? 'R' : 'L') === punch.side ? progress : progress * .08;
      // Frame a bent boxing guard, then drive shoulder, elbow and fist through
      // a forward extension. Keep a stable wrist and anatomical finger curls;
      // do not leave a nearly straight arm with only the wrist moving.
      const pullback = (sign === 1 ? 'R' : 'L') === punch.side ? windup : 0;
      const wrist = v().set(sign * (.14 - striking * .07) * width * (1 - pullback * .2), -.12 + striking * .025, -.32 + pullback * .075 - striking * .36);
      const shoulder = v().set(sign * .28 * width, -.38 + striking * .02, .04 + pullback * .04 - striking * .22);
      const target = toWorld(wrist), start = toWorld(shoulder);
      upper.position.copy(upper.parent.worldToLocal(start.clone()));
      upper.updateWorldMatrix(false, true);
      const pole = v().set(sign, -1, 0).applyQuaternion(camera.quaternion);
      poseArm(upper, fore, hand, target, pole);
      hand.quaternion.copy(hand.parent.getWorldQuaternion(q()).invert().multiply(wristRotation));
      for (const curl of arm.curls) curl.bone.quaternion.copy(bindPose[curl.bone.name]).multiply(q().setFromAxisAngle(v().set(1, 0, 0), curl.angle));
      hand.updateWorldMatrix(false, true);
    }
    applied = true;
    // Apply training edits to the completed guard around its common camera-local
    // anchor, rather than feeding edits back into the framing constraints.
    const localCenter = root.worldToLocal(center.clone());
    root.quaternion.copy(camera.quaternion).multiply(q().setFromEuler(new THREE.Euler(
      ...['x', 'y', 'z'].map(axis => THREE.MathUtils.degToRad(config.rotation[axis])))));
    root.scale.multiply(v().set(config.scale.x, config.scale.y, config.scale.z));
    root.updateMatrixWorld(true);
    root.position.add(center.sub(root.localToWorld(localCenter)))
      .add(v().set(config.position.x, config.position.y, config.position.z).applyQuaternion(camera.quaternion));
    root.updateMatrixWorld(true);
  }
  return { restore, frame };
}
