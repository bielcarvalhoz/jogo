import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFoliageCloud, createSidewalkTrees, buildCampusGrass, createWaterMaterial, updateNature } from '../src/nature.js';
import { makeTreeMeshes } from '../src/vegetation.js';
import { distToSegment } from '../src/geo.js';

test('leaf crowns have open card topology, finite unit normals and bounded instances', () => {
  for (const count of [24, 40, 64]) {
    const geometry = createFoliageCloud(count);
    assert.equal(geometry.attributes.position.count, count * 4);
    assert.equal(geometry.index.count, count * 6);
    const normal = geometry.attributes.normal;
    for (let i = 0; i < normal.count; i++) assert.ok(Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < 1e-6);
    assert.ok(geometry.boundingSphere.radius < 1.7);
  }
  const trees = makeTreeMeshes([{ x: 0, z: 0, s: 1, r: 0, v: 1 }, { x: 260, z: 0, s: 1.2, r: 1, v: 0.3 }], { heightAt: () => 3 }, { detail: true, quality: 'low' });
  assert.equal(trees.children.length, 4);
  for (const mesh of trees.children) {
    assert.ok(mesh.boundingSphere.radius > 0);
    assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
  }
  assert.equal(trees.getObjectByName('copas').geometry.attributes.position.count, 40 * 4);
  assert.equal(trees.getObjectByName('copas').castShadow, false);
  const background = makeTreeMeshes([{ x: 0, z: 0, s: 1, r: 0, v: 0.5 }], { heightAt: () => 0 });
  const backgroundTriangles = background.children.reduce((total, mesh) => total + mesh.geometry.index.count / 3, 0);
  assert.ok(backgroundTriangles <= 56, 'background forests must stay within their compact geometry budget');
  assert.ok(background.children.every((mesh) => !mesh.castShadow), 'background forests must not repeat their geometry in a shadow pass');
});

test('sidewalk rows retain their spacing across segments and leave intersections/footprints clear', () => {
  const road = { pts: [[0, 0], [10, 0], [90, 0]], w: 7, kind: 'local' };
  const rows = createSidewalkTrees([road]);
  const north = rows.filter((tree) => tree.z < 0);
  for (let i = 1; i < north.length; i++) assert.ok(Math.abs(north[i].x - north[i - 1].x - 11) < 1e-8);
  const crossing = { pts: [[40, -30], [40, 30]], w: 7, kind: 'local' };
  const footpath = { pts: [[70, -30], [70, 30]], w: 2, kind: 'foot' };
  const trees = createSidewalkTrees([road, crossing, footpath], { allowed: (x, z) => !(x < 25 && z > 0) });
  assert.ok(trees.length > 8);
  for (const tree of trees) {
    assert.ok(!(tree.x < 25 && tree.z > 0));
    for (const candidate of [road, crossing, footpath]) for (let i = 0; i < candidate.pts.length - 1; i++) {
      const a = candidate.pts[i], b = candidate.pts[i + 1];
      assert.ok(distToSegment(tree.x, tree.z, ...a, ...b).d >= candidate.w / 2 + 0.8);
    }
  }
});

test('GPU grass preserves roads, sidewalks and buildings and fits its quality budget', () => {
  const ring = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
  const world = { quarter: [ring], areas: [{ kind: 'lawn', rings: [ring] }], roads: [{ pts: [[-100, 0], [100, 0]], w: 7, kind: 'local' }] };
  const masks = { tree: { get: (x, z) => x > 20 && x < 40 && z > 20 && z < 40 } };
  const grass = buildCampusGrass(world, masks, { heightAt: (x) => x * 0.01 }, { quality: 'low' });
  assert.ok(grass.count > 1000 && grass.count <= 35000);
  let blades = 0;
  for (const mesh of grass.root.children) {
    assert.ok(mesh.geometry.boundingSphere.radius < 48);
    blades += mesh.geometry.instanceCount;
    const positions = mesh.geometry.attributes.bladeCenter;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      assert.ok(Math.abs(z) > 6.15 - 1e-5);
      assert.ok(!masks.tree.get(x, z));
      assert.ok(Math.abs(y - x * 0.01 - 0.04) < 1e-6);
    }
  }
  assert.equal(blades, grass.count);
});

test('water shoreline distance respects islands and time freezes for reduced motion', () => {
  const rings = [[[0, 0], [40, 0], [40, 40], [0, 40]], [[15, 15], [25, 15], [25, 25], [15, 25]]];
  const material = createWaterMaterial(rings, { color: '#657746' });
  const map = material.userData.shoreMap.image;
  const sample = (x, z) => map.data[Math.floor(z / 40 * map.height) * map.width + Math.floor(x / 40 * map.width)] / 255 * 12;
  assert.ok(sample(0.5, 8) < 1);
  assert.ok(sample(8, 8) > 6);
  assert.ok(sample(14.5, 20) < 1);
  assert.equal(material.transparent, false);
  updateNature(15);
  assert.equal(material.userData.natureTime.value, 15);
  updateNature(25, true);
  assert.equal(material.userData.natureTime.value, 0);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.natureTime, material.userData.natureTime);
});
