import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

/** Build triangle acceleration during loading, keeping original triangle/group order. */
export function preparePaintColliders(meshes) {
  const prepared = new Set();
  let triangles = 0, accelerated = 0;
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    if (!geo?.attributes.position) continue;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (mesh.isInstancedMesh && !mesh.boundingBox) mesh.computeBoundingBox();
    const count = (geo.index?.count || geo.attributes.position.count) / 3;
    triangles += count * (mesh.isInstancedMesh ? mesh.count : 1);
    if (count < 128 || mesh.isInstancedMesh || mesh.isSkinnedMesh) continue;
    if (!prepared.has(geo) && !geo.boundsTree) geo.boundsTree = new MeshBVH(geo, { indirect: true, targetLeafSize: 12 });
    prepared.add(geo);
    // Preserve custom raycast implementations. Normal Mesh instances use BVH only here.
    if (mesh.raycast === THREE.Mesh.prototype.raycast || mesh.raycast === acceleratedRaycast) {
      mesh.raycast = acceleratedRaycast; accelerated++;
    }
  }
  return { meshes: meshes.length, accelerated, triangles };
}

const box = new THREE.Box3(), intersection = new THREE.Vector3();
/** Conservative broad phase before any triangle/instance iteration. Works with moving roots. */
export function intersectsPaintBounds(mesh, raycaster) {
  if (mesh.userData.dynamicInstances || mesh.isSkinnedMesh) return true;
  const bounds = mesh.isInstancedMesh ? mesh.boundingBox : mesh.geometry?.boundingBox;
  if (!bounds) return true;
  box.copy(bounds).applyMatrix4(mesh.matrixWorld);
  if (box.containsPoint(raycaster.ray.origin)) return true;
  if (!raycaster.ray.intersectBox(box, intersection)) return false;
  return intersection.distanceToSquared(raycaster.ray.origin) <= raycaster.far * raycaster.far + 1e-6;
}
