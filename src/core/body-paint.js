import * as THREE from 'three';

/** Copy overlays onto the corresponding independent skeleton. */
export function copyBodyPaint(source, target) {
  const marks = []; source.traverse(o => { if (o.userData.bodyPaint) marks.push(o); });
  for (const original of marks) {
    const skin = target.getObjectByName(original.parent.name);
    if (!skin?.isSkinnedMesh) continue;
    const mark = new THREE.SkinnedMesh(original.geometry.clone(), original.material);
    mark.name = original.name; mark.userData = { ...original.userData };
    mark.bind(skin.skeleton, skin.bindMatrix); mark.frustumCulled = false; mark.renderOrder = 5;
    skin.add(mark);
  }
}

/** Paint actual triangles with their original skin weights. Projection is
 * evaluated at impact; the UV mask then deforms with the skin. */
export function createBodyPaint() {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5) / size * 2 - 1, dy = (y + .5) / size * 2 - 1, angle = Math.atan2(dy, dx);
    const edge = .78 + .08 * Math.sin(angle * 7) + .06 * Math.cos(angle * 11), i = (y * size + x) * 4;
    bytes[i] = bytes[i + 1] = bytes[i + 2] = 255;
    bytes[i + 3] = Math.hypot(dx, dy) < edge ? 255 : 0;
  }
  const mask = new THREE.DataTexture(bytes, size, size); mask.needsUpdate = true;
  const materials = new Map(), roots = new Set(), ray = new THREE.Raycaster(); let serial = 0;
  function erase(mark) { mark.removeFromParent(); mark.geometry.dispose(); }
  function clear(root) {
    if (!root) return;
    const marks = []; root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); });
    for (const mark of marks) erase(mark);
    roots.delete(root);
  }
  function stamp(root, point, normal, color = '#d91e44') {
    if (!root || !point) return null;
    const meshes = []; root.updateMatrixWorld(true);
    root.traverseVisible(o => {
      if (o.isSkinnedMesh && !o.userData.bodyPaint && !o.userData.characterHidden) {
        o.skeleton.update(); o.computeBoundingSphere(); meshes.push(o);
      }
    });
    const outward = new THREE.Vector3().copy(normal || { x: 0, y: 0, z: 1 }).normalize();
    ray.set(new THREE.Vector3().copy(point).addScaledVector(outward, .45), outward.clone().negate()); ray.near = 0; ray.far = 1;
    const hit = ray.intersectObjects(meshes, false)[0]; if (!hit?.face) return null;
    const tangent = new THREE.Vector3().crossVectors(Math.abs(outward.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), outward).normalize();
    const up = new THREE.Vector3().crossVectors(outward, tangent), radius = .14, depth = .105;
    if (!materials.has(color)) materials.set(color, new THREE.MeshBasicMaterial({
      color, map: mask, transparent: true, alphaTest: .25, polygonOffset: true, polygonOffsetFactor: -4,
      polygonOffsetUnits: -4, depthWrite: false, toneMapped: false,
    }));
    const stampId = ++serial, result = [], vertex = new THREE.Vector3();
    for (const skin of meshes) {
      const source = skin.geometry, count = source.attributes.position.count, projected = [], uv = new Float32Array(count * 2), indices = [];
      for (let i = 0; i < count; i++) {
        skin.getVertexPosition(i, vertex).applyMatrix4(skin.matrixWorld).sub(hit.point);
        const x = vertex.dot(tangent), y = vertex.dot(up), z = vertex.dot(outward);
        projected.push(new THREE.Vector3(x, y, z)); uv[i * 2] = x / (radius * 2) + .5; uv[i * 2 + 1] = y / (radius * 2) + .5;
      }
      const n = source.index?.count || count;
      for (let i = 0; i < n; i += 3) {
        const ids = [0, 1, 2].map(j => source.index ? source.index.getX(i + j) : i + j), [a, b, c] = ids.map(j => projected[j]);
        if (Math.min(a.x, b.x, c.x) > radius || Math.max(a.x, b.x, c.x) < -radius
          || Math.min(a.y, b.y, c.y) > radius || Math.max(a.y, b.y, c.y) < -radius
          || Math.min(a.z, b.z, c.z) > depth || Math.max(a.z, b.z, c.z) < -depth) continue;
        if (b.clone().sub(a).cross(c.clone().sub(a)).z <= 0) continue;
        indices.push(...ids);
      }
      if (!indices.length) continue;
      const geometry = source.clone(); geometry.clearGroups(); geometry.setIndex(indices);
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mark = new THREE.SkinnedMesh(geometry, materials.get(color));
      mark.name = 'body-paint-surface'; mark.userData = { bodyPaint: true, paintballIgnore: true, stampId };
      mark.bind(skin.skeleton, skin.bindMatrix); mark.frustumCulled = false; mark.renderOrder = 5;
      skin.add(mark); result.push(mark);
    }
    if (!result.length) return null;
    const marks = []; root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); });
    const oldest = [...new Set(marks.map(m => m.userData.stampId))].sort((a, b) => a - b).slice(0, -24);
    for (const mark of marks) if (oldest.includes(mark.userData.stampId)) erase(mark);
    roots.add(root); return result[0];
  }
  return { stamp, clear, dispose() { for (const root of roots) clear(root); for (const material of materials.values()) material.dispose(); materials.clear(); mask.dispose(); } };
}
