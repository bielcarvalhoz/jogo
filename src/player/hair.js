import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, MathUtils, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

/** Fit the covering shell to the actual rest skull, including its tapered nape. */
export function createScalpGeometry(meshes, napeOnly = false) {
  const skull = new Group(), material = new MeshBasicMaterial({ side: DoubleSide });
  for (const source of meshes) if (source.name.startsWith('Sato_clean_face')) skull.add(new Mesh(source.geometry, material));
  skull.updateMatrixWorld(true);
  const center = new Vector3(0, .858, -.009), direction = new Vector3(), ray = new Raycaster();
  const vertices = [], indices = [], columns = 32, rows = 12;
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const phi = col / columns * Math.PI * 2, back = (1 - Math.cos(phi)) / 2;
    const end = 1.12 + 1.24 * back, start = napeOnly ? 1.52 : 0;
    const theta = start + (Math.max(start, end) - start) * row / rows;
    direction.set(Math.sin(phi) * Math.sin(theta), Math.cos(theta), Math.cos(phi) * Math.sin(theta)).normalize();
    const origin = center.clone();
    // Below the ears keep the hairline height while following the narrowing skull.
    if (theta > Math.PI / 2) { origin.y += Math.cos(theta) * .104; direction.y = 0; direction.normalize(); }
    ray.set(origin.clone().addScaledVector(direction, .3), direction.clone().negate());
    const hit = ray.intersectObjects(skull.children, false)[0];
    // A thin offset prevents z-fighting without building a second head silhouette.
    const point = hit ? hit.point.addScaledVector(direction, .0015) : origin.addScaledVector(direction, .10);
    vertices.push(...point.toArray());
    if (row < rows && col < columns) {
      const a = row * (columns + 1) + col, b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  material.dispose();
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
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
