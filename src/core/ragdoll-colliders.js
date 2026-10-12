import * as THREE from 'three';

const EXTENT = 8;

/** Local scenery only: use actual triangles for stairs, overhangs and walls,
 * rather than joining their different heights into a fictitious sloping floor. */
export function createCorpseColliders(game, world, R, center, groups) {
  const colliders = [], moving = [];
  const region = new THREE.Box3(new THREE.Vector3(center.x - EXTENT, center.y - 8, center.z - EXTENT), new THREE.Vector3(center.x + EXTENT, center.y + 8, center.z + EXTENT));
  const vertices = [], indices = [], grid = 16;
  for (let z = 0; z <= grid; z++) for (let x = 0; x <= grid; x++) {
    const wx = center.x + x - EXTENT, wz = center.z + z - EXTENT;
    vertices.push(wx, game.training?.active ? 0 : game.map.terrain.heightAt(wx, wz), wz);
  }
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    const a = z * (grid + 1) + x, b = a + grid + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const addMesh = (positions, triangles) => colliders.push(world.createCollider(R.ColliderDesc.trimesh(new Float32Array(positions), new Uint32Array(triangles)).setFriction(.8).setCollisionGroups(groups)));
  addMesh(vertices, indices);
  const matrix = new THREE.Matrix4(), instance = new THREE.Matrix4(), bounds = new THREE.Box3(), local = new THREE.Box3(), triangle = new THREE.Triangle();
  const positions = [], triangles = [];
  function extract(geometry, transform) {
    bounds.copy(geometry.boundingBox).applyMatrix4(transform);
    if (!bounds.intersectsBox(region)) return;
    local.copy(region).applyMatrix4(matrix.copy(transform).invert());
    function append(t) {
      if (!local.intersectsTriangle(t)) return;
      const index = positions.length / 3;
      for (const v of [t.a, t.b, t.c]) positions.push(...v.clone().applyMatrix4(transform).toArray());
      triangles.push(index, index + 1, index + 2);
    }
    if (geometry.boundsTree) geometry.boundsTree.shapecast({ intersectsBounds: box => box.intersectsBox(local), intersectsTriangle: t => { append(t); return false; } });
    else {
      const attribute = geometry.attributes.position, index = geometry.index;
      for (let i = 0, count = index?.count || attribute.count; i < count; i += 3) {
        for (const [offset, v] of [[0, triangle.a], [1, triangle.b], [2, triangle.c]]) v.fromBufferAttribute(attribute, index ? index.getX(i + offset) : i + offset);
        append(triangle);
      }
    }
  }
  function visit(object) {
    if (!object.visible || object.userData.paintballIgnore || object.userData.noPaintball || object.isCamera) return;
    if (object.isMesh && !object.isSkinnedMesh && !object.userData.dynamicBody && !/terreno|Training checker floor/.test(object.name)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material], geometry = object.geometry;
      if (geometry?.attributes.position && materials.some(m => m && !m.isShaderMaterial && m.depthWrite !== false && (!m.transparent || m.opacity >= .5))) {
        object.updateWorldMatrix(true, false); if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (object.isInstancedMesh) {
          if (!object.boundingBox) object.computeBoundingBox();
          if (bounds.copy(object.boundingBox).applyMatrix4(object.matrixWorld).intersectsBox(region)) for (let i = 0; i < object.count; i++) {
            object.getMatrixAt(i, instance); extract(geometry, instance.clone().premultiply(object.matrixWorld));
          }
        } else extract(geometry, object.matrixWorld);
      }
    }
    for (const child of object.children) visit(child);
  }
  visit(game.engine.scene);
  if (triangles.length) addMesh(positions, triangles);
  for (const crate of game.dynamicProps?.crates || []) {
    if (!crate.mesh.visible || !crate.bounds.intersectsBox(region)) continue;
    const geometry = crate.mesh.geometry; if (!geometry.boundingBox) geometry.computeBoundingBox();
    const half = geometry.boundingBox.getSize(new THREE.Vector3()).multiply(crate.mesh.scale).multiplyScalar(.5);
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...crate.mesh.position.toArray()).setRotation(crate.mesh.quaternion));
    world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(.8).setCollisionGroups(groups), body);
    moving.push({ body, mesh: crate.mesh });
  }
  return { center: new THREE.Vector3().copy(center), colliders, moving,
    needsRefresh(position) { return Math.hypot(position.x - center.x, position.z - center.z) > EXTENT - 3; },
    sync() { for (const { body, mesh } of moving) { body.setNextKinematicTranslation(mesh.getWorldPosition(new THREE.Vector3())); body.setNextKinematicRotation(mesh.getWorldQuaternion(new THREE.Quaternion())); } },
    dispose() { for (const { body } of moving) world.removeRigidBody(body); for (const collider of colliders) world.removeCollider(collider, true); },
  };
}
