import * as THREE from 'three';

export function aimBone(bone, child, target) {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(), to = target.clone().sub(origin).normalize();
  const world = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

export function poseArm(upper, fore, hand, target, pole) {
  const start = upper.getWorldPosition(new THREE.Vector3());
  const a = start.distanceTo(fore.getWorldPosition(new THREE.Vector3())), b = fore.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
  const delta = target.clone().sub(start).clampLength(.01, (a + b) * .985), distance = delta.length(), direction = delta.normalize();
  const along = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * distance), 0, a);
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
  const elbow = start.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
  aimBone(upper, fore, elbow); aimBone(fore, hand, start.addScaledVector(direction, distance));
}
