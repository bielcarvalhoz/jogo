import { BufferGeometry, Float32BufferAttribute, MathUtils, Vector3 } from 'three';

/** Fit the covering shell to the actual rest skull, including its tapered nape. */
export function createScalpGeometry(meshes, napeOnly = false) {
  const center = new Vector3(0, .858, -.009), vertices = [];
  const hairline = point => {
    const back = (1 - (point.z - center.z) / Math.max(.001, Math.hypot(point.x, point.z - center.z))) / 2;
    // Keep the front shell high above the forehead; length belongs at the nape.
    return point.y - (.901 - .120 * back - .005 * back ** 4);
  };
  function clip(points, distance) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], da = distance(a), db = distance(b);
      if (da >= 0) result.push(a);
      if ((da >= 0) !== (db >= 0)) result.push(a.clone().lerp(b, da / (da - db)));
    }
    return result;
  }
  // Reuse the skull's own facets. An independently tessellated shell cuts
  // through those facets between samples and exposes thin strips of skin.
  for (const source of meshes) if (source.name.startsWith('Sato_clean_face')) {
    const { position } = source.geometry.attributes, index = source.geometry.index;
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      let points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j));
      points = clip(points, hairline);
      if (napeOnly) points = clip(points, point => .861 - point.y);
      // Radial clearance is tiny; below the ears it follows the taper instead
      // of extending down into the neck. Only the rear hairline reaches lower.
      points = points.map(point => {
        const outward = point.clone().sub(center); if (outward.y < 0) outward.y = 0;
        return point.clone().addScaledVector(outward.normalize(), .0025);
      });
      for (let j = 1; j < points.length - 1; j++) for (const point of [points[0], points[j], points[j + 1]]) vertices.push(...point.toArray());
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals(); return geometry;
}

/** Small runtime rest-shape adjustment; preserve the source GLB and its rig. */
export function sweepHairTips(meshes) {
  for (const mesh of meshes) {
    if (!mesh.name.startsWith('Sato_hair_cap')) continue;
    mesh.geometry = mesh.geometry.clone();
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      // +X is Sato's LEFT (the original DEF-handL is on +X). Leave the
      // lower/back hair at the nape intact, and comb crown/front tips together.
      const front = MathUtils.smoothstep(z, .015, .095);
      // The scalp reaches .936 and the covering shell is around .948. Bend
      // protruding tips only; moving that shell would uncover the character's
      // head, even if the new overall height looked correct.
      const top = MathUtils.smoothstep(y, .948, .996);
      const fringe = front * MathUtils.smoothstep(y, .785, .86) * (1 - MathUtils.smoothstep(y, .89, .96));
      // Every crown tip follows the fringe, while its shell/root stays put.
      const tousle = .95 + .05 * Math.sin(x * 93 + z * 47);
      const sweep = (.060 * top + .025 * fringe) * tousle;
      positions.setXYZ(i, x + sweep, y - .028 * top - .005 * fringe * tousle, z + .004 * fringe - .003 * top);
    }
    positions.needsUpdate = true;
    mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  }
}
