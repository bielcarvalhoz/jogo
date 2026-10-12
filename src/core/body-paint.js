import * as THREE from 'three';

/** Small surface splats follow the dominant skin bone and clone with a corpse.
 * Geometry/materials are shared; respawning a rig never changes another rig. */
export function createBodyPaint() {
  const shapes = Array.from({ length: 4 }, (_, variant) => {
    const geometry = new THREE.CircleGeometry(1, 24), p = geometry.attributes.position;
    for (let i = 1; i < p.count; i++) {
      const radius = .64 + .36 * Math.abs(Math.sin(i * 17.31 + variant * 2.7));
      p.setXY(i, p.getX(i) * radius, p.getY(i) * radius);
    }
    p.needsUpdate = true; return geometry;
  });
  const materials = new Map(), ray = new THREE.Raycaster(); let serial = 0;
  function clear(root) {
    const marks = []; root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); });
    for (const mark of marks) mark.removeFromParent();
  }
  function stamp(root, point, normal, color = '#d91e44') {
    if (!root || !point) return null;
    const meshes = []; root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isSkinnedMesh && !o.userData.characterHidden) { o.skeleton.update(); o.computeBoundingSphere(); meshes.push(o); } });
    const outward = new THREE.Vector3().copy(normal || { x: 0, y: 0, z: 1 }).normalize();
    ray.set(new THREE.Vector3().copy(point).addScaledVector(outward, .45), outward.clone().negate()); ray.near = 0; ray.far = 1;
    const hit = ray.intersectObjects(meshes, false)[0]; if (!hit?.face) return null;
    const mesh = hit.object, ids = [hit.face.a, hit.face.b, hit.face.c], weights = new Map();
    for (const index of ids) for (let j = 0; j < 4; j++) {
      const bone = mesh.geometry.attributes.skinIndex.getComponent(index, j), weight = mesh.geometry.attributes.skinWeight.getComponent(index, j);
      weights.set(bone, (weights.get(bone) || 0) + weight);
    }
    const bone = mesh.skeleton.bones[[...weights].sort((a, b) => b[1] - a[1])[0]?.[0]]; if (!bone) return null;
    const [a, b, c] = ids.map(i => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    const surfaceNormal = b.sub(a).cross(c.sub(a)).normalize();
    if (surfaceNormal.dot(outward) < 0) surfaceNormal.negate();
    if (!materials.has(color)) materials.set(color, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, toneMapped: false }));
    const mark = new THREE.Mesh(shapes[serial++ % shapes.length], materials.get(color));
    mark.name = 'body-paint-splat'; mark.userData.bodyPaint = true; mark.userData.paintballIgnore = true; mark.renderOrder = 5;
    const marks = []; root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); }); if (marks.length >= 24) marks[0].removeFromParent();
    bone.add(mark); bone.updateWorldMatrix(true, false);
    mark.position.copy(bone.worldToLocal(hit.point.clone().addScaledVector(surfaceNormal, .006)));
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
    mark.quaternion.copy(bone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation));
    const scale = bone.getWorldScale(new THREE.Vector3()), radius = /head|hand|forearm|shin/i.test(bone.name) ? .065 : .11;
    mark.scale.set(radius / scale.x, radius / scale.y, radius / scale.z);
    return mark;
  }
  return { stamp, clear, dispose() { for (const geometry of shapes) geometry.dispose(); for (const material of materials.values()) material.dispose(); materials.clear(); } };
}
