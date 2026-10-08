import * as THREE from 'three';

/** Split large static batches into bounded cells; share geometry and materials. */
export function partitionStaticInstances(scene, cell = 125) {
  const meshes = [];
  scene.traverse(o => {
    if (o.isInstancedMesh && o.count >= 128 && !o.userData.dynamicInstances && !o.userData.spatiallyPartitioned && !o.morphTexture) meshes.push(o);
  });
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), color = new THREE.Color();
  let original = 0, batches = 0;
  for (const mesh of meshes) {
    const cells = new Map();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      const key = `${Math.floor(position.x / cell)},${Math.floor(position.z / cell)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(i);
    }
    if (cells.size <= 1) continue;
    const group = new THREE.Group(); group.name = mesh.name; group.userData = { ...mesh.userData };
    group.position.copy(mesh.position); group.quaternion.copy(mesh.quaternion); group.scale.copy(mesh.scale);
    group.visible = mesh.visible;
    for (const indices of cells.values()) {
      const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, indices.length);
      batch.name = mesh.name; batch.userData = { ...mesh.userData };
      batch.castShadow = mesh.castShadow; batch.receiveShadow = mesh.receiveShadow;
      batch.renderOrder = mesh.renderOrder; batch.layers.mask = mesh.layers.mask;
      batch.customDepthMaterial = mesh.customDepthMaterial; batch.customDistanceMaterial = mesh.customDistanceMaterial;
      indices.forEach((index, i) => {
        mesh.getMatrixAt(index, matrix); batch.setMatrixAt(i, matrix);
        if (mesh.instanceColor) { mesh.getColorAt(index, color); batch.setColorAt(i, color); }
      });
      batch.computeBoundingBox(); batch.computeBoundingSphere(); group.add(batch); batches++;
    }
    mesh.parent.add(group); mesh.removeFromParent(); mesh.dispose(); original++;
  }
  return { original, batches };
}
