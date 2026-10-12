import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSurfacePaintGeometry, projectSurfacePaint, PAINT_VERTICES } from '../../src/gameplay/paintball/surface-paint.js';
import { preparePaintColliders } from '../../src/gameplay/paintball/collision.js';
import { createPaintball, PAINTBALL_LIMITS } from '../../src/gameplay/paintball/paintball.js';

const points = (geometry, origin) => Array.from({ length: geometry.drawRange.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).add(origin));

test('paint at a box edge conforms to both faces and stays attached to the actual surface', () => {
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshBasicMaterial()); box.updateMatrixWorld(true);
  const geometry = createSurfacePaintGeometry();
  const result = projectSurfacePaint({ object: box, point: new THREE.Vector3(.58, 0, .6), normal: new THREE.Vector3(0, 0, 1) }, [box], geometry);
  const vertices = points(geometry, result.origin);
  assert.ok(vertices.some(p => p.x > .6 && p.z < .55), 'ink wraps onto the right face');
  assert.ok(vertices.some(p => p.z > .6 && p.x < .55), 'ink remains on the front face');
  assert.ok(vertices.every(p => Math.min(Math.abs(p.x - .6), Math.abs(p.z - .6)) < .003), 'paint floats away from the model');
  assert.ok(result.vertices <= PAINT_VERTICES); geometry.dispose();
});

test('curved surfaces and separate adjoining scenery meshes receive the same 3D brush', () => {
  const curved = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 128), new THREE.MeshBasicMaterial()); curved.updateMatrixWorld(true);
  preparePaintColliders([curved]); const geometry = createSurfacePaintGeometry();
  let result = projectSurfacePaint({ object: curved, point: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(0, 0, 1) }, [curved], geometry);
  const vertices = points(geometry, result.origin);
  assert.ok(vertices.some(p => p.z < .98), 'paint must follow the cylinder, not its tangent plane');
  assert.ok(vertices.every(p => Math.abs(Math.hypot(p.x, p.z) - 1) < .004));
  assert.ok(result.visitedTriangles < 160, 'BVH must restrict dense geometry to a local patch');
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const side = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  side.rotation.y = Math.PI / 2; side.position.set(.5, 0, -.5); front.updateMatrixWorld(true); side.updateMatrixWorld(true);
  result = projectSurfacePaint({ object: front, point: new THREE.Vector3(.49, 0, 0), normal: new THREE.Vector3(0, 0, 1) }, [front, side], geometry);
  assert.ok(points(geometry, result.origin).some(p => p.x > .5 && p.z < -.05), 'paint crosses a seam between scene meshes'); geometry.dispose();
});

test('instanced scene objects use the hit instance transform and do not paint another instance', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(100, 0, 0)); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5, 0, 0));
  mesh.computeBoundingBox(); mesh.updateMatrixWorld(true); const geometry = createSurfacePaintGeometry();
  const result = projectSurfacePaint({ object: mesh, instanceId: 1, point: new THREE.Vector3(5.48, 0, .5), normal: new THREE.Vector3(0, 0, 1) }, [mesh], geometry);
  const vertices = points(geometry, result.origin); assert.ok(vertices.length > 0);
  assert.ok(vertices.every(p => p.x > 5 && p.x < 5.51)); geometry.dispose();
});

test('back-sided model faces accept paint and hidden source triangles are excluded', () => {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  plane.updateMatrixWorld(true); const geometry = createSurfacePaintGeometry();
  const hit = { object: plane, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, -1) };
  let result = projectSurfacePaint(hit, [plane], geometry); assert.ok(result.vertices > 0);
  assert.ok(points(geometry, result.origin).every(p => p.z < 0), 'paint offset follows the visible back face');
  plane.geometry.setDrawRange(0, 0); result = projectSurfacePaint(hit, [plane], geometry);
  assert.equal(result.vertices, 0); geometry.dispose();
});

test('new paint draws over old paint even after recycling every pooled geometry', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial()); wall.position.z = -2; scene.add(wall);
  const paint = createPaintball({ scene, camera, colliderRoots: [wall] });
  const pool = paint.root.children.filter(o => o.name === 'marca-tinta'), geometries = pool.map(o => o.geometry);
  for (let i = 0; i < PAINTBALL_LIMITS.marks + 2; i++) {
    if (!paint.ammo.loaded) { paint.reload(); for (let frame = 0; frame < 24; frame++) paint.update(.1); }
    paint.setColor(i % paint.palette.length); paint.shoot(); paint.update(.1); paint.update(.1);
  }
  const sorted = [...pool].sort((a, b) => a.renderOrder - b.renderOrder);
  assert.equal(sorted.at(-1), pool[1]); assert.equal(sorted.at(-1).renderOrder, 3 + PAINTBALL_LIMITS.marks + 2);
  assert.ok(sorted.every(m => m.material.depthTest && !m.material.depthWrite && m.material.polygonOffset));
  assert.deepEqual(pool.map(o => o.geometry), geometries); paint.dispose();
});

test('paint follows the rigid object through translation and rotation without reprojection', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  box.position.set(.3, -.3, -2); box.userData.dynamicPaint = true; scene.add(box);
  const paint = createPaintball({ scene, camera, colliderRoots: [box] });
  paint.shoot(); paint.update(.1); paint.update(.1);
  const mark = paint.root.children.find(o => o.name === 'marca-tinta' && o.visible);
  assert.ok(mark); const geometry = mark.geometry, before = mark.position.clone();
  const local = box.worldToLocal(before.clone()); box.position.x += 2; box.rotation.y = .7; box.updateMatrixWorld(true);
  paint.update(.016); const expected = box.localToWorld(local);
  assert.ok(mark.position.distanceTo(expected) < 1e-6); assert.equal(mark.geometry, geometry);
  assert.ok(mark.position.distanceTo(before) > 1); paint.dispose();
});
