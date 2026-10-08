// CPU-only collision benchmark. It does not measure GPU rendering or player FPS.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { preparePaintColliders } from '../src/gameplay/paintball/collision.js';
import { raycastPaintSegment } from '../src/gameplay/paintball/paintball.js';

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000, 256, 256).rotateX(-Math.PI / 2), material);
const parts = Array.from({ length: 3000 }, (_, i) => new THREE.BoxGeometry(6, 8, 6).translate((i % 60 - 30) * 20, 4, (Math.floor(i / 60) - 25) * 20));
const buildings = new THREE.Mesh(mergeGeometries(parts), material);
parts.forEach(g => g.dispose());
const meshes = [ground, buildings]; meshes.forEach(m => m.updateMatrixWorld(true));
const rays = Array.from({ length: 240 }, (_, i) => {
  const from = new THREE.Vector3((i % 15 - 7) * 20 + 8, 3, (Math.floor(i / 15) - 7) * 20 + 8);
  return [from, from.clone().add(new THREE.Vector3(Math.sin(i) * 50, -5 - i % 6, -70))];
});
const raycaster = new THREE.Raycaster();
function native(from, to) {
  const direction = to.clone().sub(from); raycaster.set(from, direction.clone().normalize()); raycaster.far = direction.length();
  return raycaster.intersectObjects(meshes, false)[0] || null;
}
function measure(trace) {
  // Warm JIT and geometry bounds before timing.
  for (const [from, to] of rays.slice(0, 15)) trace(from, to);
  const started = performance.now(), hits = rays.map(([from, to]) => trace(from, to));
  return { elapsedMs: performance.now() - started, hits };
}
const before = measure(native);
const buildStarted = performance.now(), stats = preparePaintColliders(meshes), buildMs = performance.now() - buildStarted;
const after = measure((from, to) => raycastPaintSegment(raycaster, from, to, meshes));
for (let i = 0; i < rays.length; i++) {
  const a = before.hits[i], b = after.hits[i];
  if (!!a !== !!b || a && a.point.distanceTo(b.point) > 1e-6) throw new Error(`Collision changed at ray ${i}`);
}
console.log(JSON.stringify({ rays: rays.length, triangles: stats.triangles, bvhBuildMs: +buildMs.toFixed(2), nativeMs: +before.elapsedMs.toFixed(2), optimizedMs: +after.elapsedMs.toFixed(2), speedup: +(before.elapsedMs / after.elapsedMs).toFixed(2), matchingHits: true }, null, 2));
meshes.forEach(m => m.geometry.dispose()); material.dispose();
