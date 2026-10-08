import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { partitionStaticInstances } from '../../src/core/instances.js';

test('static instance chunks preserve world transforms, colors, shadows and shared resources', () => {
  const scene = new THREE.Scene(), mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 160);
  mesh.position.set(3, 5, 7); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.noPaintball = true;
  const matrix = new THREE.Matrix4(), color = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) { mesh.setMatrixAt(i, matrix.makeTranslation(i * 4, 2, 0)); mesh.setColorAt(i, color.setRGB(i / 160, 0, 1)); }
  scene.add(mesh); scene.updateMatrixWorld(true);
  const original = Array.from({ length: mesh.count }, (_, i) => { mesh.getMatrixAt(i, matrix); return matrix.clone().premultiply(mesh.matrixWorld).toArray(); });
  const geometry = mesh.geometry, material = mesh.material;
  const stats = partitionStaticInstances(scene); scene.updateMatrixWorld(true);
  assert.equal(stats.original, 1); assert.ok(stats.batches > 1); assert.equal(mesh.parent, null);
  const actual = []; let colors = 0;
  scene.traverse(o => {
    if (!o.isInstancedMesh) return;
    assert.equal(o.geometry, geometry); assert.equal(o.material, material); assert.equal(o.userData.noPaintball, true);
    assert.equal(o.castShadow, true); assert.equal(o.receiveShadow, true); assert.ok(o.boundingSphere.radius < 70);
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, matrix); actual.push(matrix.clone().premultiply(o.matrixWorld).toArray()); o.getColorAt(i, color); colors += color.r; }
  });
  assert.deepEqual(actual, original); assert.ok(Math.abs(colors - 79.5) < .001);
});

test('animated instance buffers are never repartitioned', () => {
  const scene = new THREE.Scene(), mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 200);
  mesh.userData.dynamicInstances = true; scene.add(mesh);
  assert.deepEqual(partitionStaticInstances(scene), { original: 0, batches: 0 }); assert.equal(mesh.parent, scene);
});
