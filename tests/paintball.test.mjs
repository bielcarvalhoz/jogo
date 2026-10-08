import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { advancePaintball, raycastPaintSegment, collectPaintableMeshes, createPaintball, PAINTBALL_LIMITS, PAINTBALL_PALETTE } from '../src/paintball.js';

const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-8, `${a.toArray()} ≈ ${b.toArray()}`);
const wallAt = z => {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
  wall.position.z = z; wall.updateMatrixWorld(true); return wall;
};

test('ballistic flight preserves the same trajectory across frame subdivisions', () => {
  const position = new THREE.Vector3(1, 8, 4), velocity = new THREE.Vector3(3, 2, -34);
  const whole = advancePaintball(position, velocity, 1, 3);
  let split = { position, velocity };
  for (let i = 0; i < 10; i++) split = advancePaintball(split.position, split.velocity, .1, 3);
  close(whole.position, new THREE.Vector3(4, 8.5, -30)); close(whole.position, split.position); close(whole.velocity, split.velocity);
  close(position, new THREE.Vector3(1, 8, 4)); close(velocity, new THREE.Vector3(3, 2, -34));
});

test('segment tracing hits a thin wall crossed in one frame and cannot hit beyond the segment', () => {
  const raycaster = new THREE.Raycaster(), wall = wallAt(-3);
  assert.equal(raycastPaintSegment(raycaster, new THREE.Vector3(), new THREE.Vector3(0, 0, -2), [wall]), null);
  const hit = raycastPaintSegment(raycaster, new THREE.Vector3(), new THREE.Vector3(0, 0, -12), [wall]);
  assert.equal(hit.object, wall); close(hit.point, new THREE.Vector3(0, 0, -3)); close(hit.normal, new THREE.Vector3(0, 0, 1));
  assert.equal(raycastPaintSegment(raycaster, new THREE.Vector3(), new THREE.Vector3(), [wall]), null);
});

test('surface normals use world transforms, including tilted walls', () => {
  const wall = wallAt(0); wall.rotation.x = Math.PI / 2; wall.scale.set(2, 3, .5); wall.updateMatrixWorld(true);
  const hit = raycastPaintSegment(new THREE.Raycaster(), new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -5, 0), [wall]);
  // This back side of a double-sided floor must orient the paint toward the shot.
  assert.equal(hit, null);
  wall.material.side = THREE.DoubleSide;
  const floorHit = raycastPaintSegment(new THREE.Raycaster(), new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -5, 0), [wall]);
  close(floorHit.normal, new THREE.Vector3(0, 1, 0));
});

test('gun, effects, hidden objects and character exclusions never intercept scenery hits', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(camera);
  camera.add(wallAt(-1));
  const effects = new THREE.Group(); effects.userData.paintballIgnore = true; effects.add(wallAt(-2)); scene.add(effects);
  const hidden = new THREE.Group(); hidden.visible = false; hidden.add(wallAt(-3)); scene.add(hidden);
  const character = new THREE.Group(); character.userData.noPaintball = true; character.add(wallAt(-4)); scene.add(character);
  const water = wallAt(-5); water.material = new THREE.ShaderMaterial(); scene.add(water);
  const wall = wallAt(-6); scene.add(wall); scene.updateMatrixWorld(true);
  const hit = raycastPaintSegment(new THREE.Raycaster(), new THREE.Vector3(), new THREE.Vector3(0, 0, -10), [scene]);
  assert.equal(hit.object, wall);
});

test('instanced scenery contributes its own transformed surface normal', () => {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 1);
  const instance = new THREE.Matrix4().makeRotationY(Math.PI / 8); instance.setPosition(0, 0, -5); mesh.setMatrixAt(0, instance);
  mesh.rotation.y = Math.PI / 8; mesh.scale.y = 2; mesh.updateMatrixWorld(true);
  const hit = raycastPaintSegment(new THREE.Raycaster(), new THREE.Vector3(), new THREE.Vector3(0, 0, -10), [mesh]);
  assert.equal(hit.instanceId, 0); close(hit.normal, new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2));
});

test('foliage subtrees are excluded before any instance raycast, and nested roots do not duplicate surfaces', () => {
  const scene = new THREE.Scene(), foliage = new THREE.Group(); foliage.userData.noPaintball = true;
  const trees = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 20000);
  trees.raycast = () => assert.fail('the ignored tree instance buffer must never be raycast'); foliage.add(trees); scene.add(foliage);
  const wall = wallAt(-4); scene.add(wall);
  assert.deepEqual(collectPaintableMeshes([scene, wall]), [wall]);
  const hit = raycastPaintSegment(new THREE.Raycaster(), new THREE.Vector3(), new THREE.Vector3(0, 0, -10), [scene]);
  assert.equal(hit.object, wall);
});

test('projectiles cache one collider enumeration while fresh root arrays, visibility and source changes remain valid', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), cluster = new THREE.Group(), wall = wallAt(-3); cluster.add(wall); scene.add(cluster);
  let enumerations = 0, casts = 0;
  const children = cluster.children, originalRaycast = wall.raycast;
  Object.defineProperty(cluster, 'children', { get: () => { enumerations++; return children; } });
  wall.raycast = function (...args) { casts++; originalRaycast.apply(this, args); };
  let sources = [cluster];
  const paint = createPaintball({ scene, camera, colliderRoots: () => [...sources] });
  for (let i = 0; i < 8; i++) { paint.shoot(); paint.update(.1); paint.update(.1); }
  assert.equal(enumerations, 1, 'stable source roots are enumerated once, not once per ball/frame');
  const before = casts; cluster.visible = false; paint.shoot(); paint.update(.1); paint.update(.1);
  assert.equal(casts, before, 'hidden procedural surfaces are filtered before raycasting');
  cluster.visible = true; paint.shoot(); assert.ok(casts > before, 'showing the same procedural group reactivates cached surfaces');
  sources = []; paint.update(.1); paint.update(.1);
  assert.equal(enumerations, 1);
  sources = [cluster]; paint.shoot(); assert.equal(enumerations, 2, 'a changed root source refreshes the small mesh cache');
  paint.dispose();
});

test('the selected building color flies visibly and creates an offset surface splat', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), wall = wallAt(-8); scene.add(wall);
  let active = false;
  const paint = createPaintball({ scene, camera, getActive: () => active, colliderRoots: [wall] });
  assert.equal(paint.shoot(), false); active = true; paint.setColor('azul'); assert.equal(paint.shoot(), true);
  const ball = paint.root.children.find(o => o.name === 'bolinha-tinta' && o.visible), start = ball.position.clone();
  assert.equal(ball.material.color.getHexString(), '2879b6'); assert.equal(paint.shoot(), false, 'rate limit prevents overlapping click bursts');
  paint.update(.1); assert.ok(ball.position.distanceTo(start) > 3);
  paint.setColor('amarelo'); paint.update(.1); paint.update(.1);
  const mark = paint.root.children.find(o => o.name === 'marca-tinta' && o.visible);
  assert.equal(paint.stats.marks, 1); assert.equal(paint.stats.projectiles, 0);
  assert.equal(mark.material.color.getHexString(), '2879b6', 'changing selection cannot recolor a ball already fired');
  assert.ok(mark.position.z > -8 && mark.position.z < -7.97, 'splat is lifted away from the hit wall to avoid z-fighting');
  assert.equal(mark.material.polygonOffset, true); assert.equal(mark.material.depthWrite, false);
  assert.ok(PAINTBALL_PALETTE.some(p => p.id === 'rubi')); assert.notEqual(PAINTBALL_PALETTE.find(p => p.id === 'rubi').color, PAINTBALL_PALETTE.find(p => p.id === 'vermelho').color);
  assert.throws(() => paint.setColor('inexistente'), RangeError); paint.dispose();
});

test('long painting sessions reuse bounded meshes and dispose shared resources once', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), wall = wallAt(-2); scene.add(wall);
  const paint = createPaintball({ scene, camera, colliderRoots: [wall] });
  const meshes = paint.root.children.length;
  for (let i = 0; i < 220; i++) {
    paint.setColor(i % paint.palette.length); assert.equal(paint.shoot(), true); paint.update(.1); paint.update(.1);
  }
  assert.equal(paint.root.children.length, meshes); assert.equal(paint.stats.marks, PAINTBALL_LIMITS.marks); assert.equal(paint.stats.projectiles, 0);
  assert.equal(paint.root.children.filter(o => o.name === 'bolinha-tinta').length, PAINTBALL_LIMITS.projectiles);
  const resources = new Set(); paint.root.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); }); paint.gun.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); });
  const disposed = new Map(); for (const r of resources) r.addEventListener('dispose', () => disposed.set(r, (disposed.get(r) || 0) + 1));
  paint.dispose(); paint.dispose(); assert.equal(paint.root.parent, null); assert.equal(paint.gun.parent, null); assert.equal(paint.shoot(), false);
  assert.ok([...resources].every(r => disposed.get(r) === 1));
});

test('missed shots expire and first-person gun visibility follows player activation', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); let active = true;
  const paint = createPaintball({ scene, camera, getActive: () => active, colliderRoots: [] });
  paint.shoot(); for (let i = 0; i < 31; i++) paint.update(.1);
  assert.equal(paint.stats.projectiles, 0); assert.equal(paint.stats.marks, 0);
  active = false; paint.update(.1); assert.equal(paint.gun.visible, false); assert.equal(paint.shoot(), false);
  active = true; paint.update(.1); assert.equal(paint.gun.visible, true); paint.dispose();
});
