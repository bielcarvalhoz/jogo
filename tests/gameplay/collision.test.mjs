import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { preparePaintColliders, intersectsPaintBounds } from '../../src/gameplay/paintball/collision.js';
import { raycastPaintSegment } from '../../src/gameplay/paintball/paintball.js';

test('accelerated hits preserve transformed position, face normal and original triangles', () => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4, 64, 32), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, -12); mesh.rotation.y = .7; mesh.scale.set(1.1, 2, 1); mesh.updateMatrixWorld(true);
  const originalIndices = mesh.geometry.index.array.slice(), ray = new THREE.Raycaster();
  const from = new THREE.Vector3(), to = new THREE.Vector3(0, 0, -30);
  const native = raycastPaintSegment(ray, from, to, [mesh]);
  assert.equal(preparePaintColliders([mesh]).accelerated, 1);
  const hit = raycastPaintSegment(ray, from, to, [mesh]);
  assert.ok(hit.point.distanceTo(native.point) < 1e-8); assert.ok(hit.normal.distanceTo(native.normal) < 1e-8);
  assert.equal(hit.faceIndex, native.faceIndex); assert.deepEqual(mesh.geometry.index.array, originalIndices);
  assert.equal(raycastPaintSegment(ray, from, new THREE.Vector3(0, 0, -2), [mesh]), null);
});

test('broad phase rejects thousands of distant instances without invoking instance raycasts', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 20000), matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, matrix.makeTranslation(300 + i % 50, 0, -50));
  preparePaintColliders([mesh]); mesh.raycast = () => assert.fail('far instance batch must not enter narrow phase');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, 100);
  assert.equal(intersectsPaintBounds(mesh, ray), false);
  assert.equal(raycastPaintSegment(ray, new THREE.Vector3(), new THREE.Vector3(0, 0, -100), [mesh]), null);
  mesh.position.x = -325; mesh.updateMatrixWorld(true); assert.equal(intersectsPaintBounds(mesh, ray), true);
});

test('a transparent material group cannot hide the solid paintable face behind it', async () => {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const glass = new THREE.PlaneGeometry(8, 8, 16, 16).translate(0, 0, -4);
  const wall = new THREE.PlaneGeometry(8, 8, 16, 16).translate(0, 0, -8);
  const mesh = new THREE.Mesh(mergeGeometries([glass, wall], true), [new THREE.MeshBasicMaterial({ transparent: true, opacity: .3 }), new THREE.MeshBasicMaterial()]);
  mesh.updateMatrixWorld(true); preparePaintColliders([mesh]);
  const hit = raycastPaintSegment(new THREE.Raycaster(), new THREE.Vector3(), new THREE.Vector3(0, 0, -15), [mesh]);
  assert.equal(hit.face.materialIndex, 1); assert.ok(Math.abs(hit.point.z + 8) < 1e-8);
});
