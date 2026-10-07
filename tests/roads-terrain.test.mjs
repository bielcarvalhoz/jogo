import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain, gradeCampusTerrain } from '../src/terrain.js';
import { buildRoads } from '../src/roads.js';
import { resampleRoad, roadFrames, subtractConvex, triangleHeightAt } from '../src/road-geometry.js';

const proj = { toLocal: (x, y) => [x, 100 - y] };
const makeTerrain = () => createTerrain({ nx: 21, ny: 21, min: 10, max: 20, bbox: [0, 0, 100, 100], heights: Array.from({ length: 441 }, (_, k) => 10 + (k % 21) * 0.2 + Math.floor(k / 21) * 0.3) }, proj);
const area = (p) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

test('platform is flat through its boundary and retains the distant SRTM terrain', () => {
  const t = makeTerrain(), before = t.heightAt(5, 5);
  const report = t.gradePlatform([rect(40, 40, 60, 60)], { level: 4.5, band: 12 });
  assert.ok(report.changed > 0);
  for (let z = 40; z <= 60; z += 0.7) for (let x = 40; x <= 60; x += 0.9) assert.ok(Math.abs(t.heightAt(x, z) - 4.5) < 1e-6);
  assert.equal(t.heightAt(5, 5), before);
  const { mesh } = t.buildMesh(null), pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
  for (let i = 0; i < idx.count; i += 39) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    assert.ok(Math.abs(t.heightAt(x, z) - (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3) < 1e-5, 'navigation agrees with graded mesh triangles');
  }
});

test('corridor cut/fill is bounded and intersections do not depend on road ordering', () => {
  const roads = [{ w: 5, pts: [[20, 50], [80, 50]] }, { w: 5, pts: [[50, 20], [50, 80]] }];
  const a = makeTerrain(), b = makeTerrain();
  const report = a.gradeCorridors(roads);
  b.gradeCorridors([...roads].reverse());
  assert.ok(report.changed > 0);
  assert.ok(report.cutFill <= 0.9);
  for (let z = 5; z < 100; z += 5) for (let x = 5; x < 100; x += 5) assert.ok(Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) < 1e-6);
});

test('campus field and running lanes share one engineered level', () => {
  const terrain = makeTerrain(), track = { cx: 50, cz: 50, outer: rect(35, 35, 65, 65) };
  const report = gradeCampusTerrain({ roads: [] }, terrain, { buildings: [], track });
  assert.equal(track.groundLevel, report.sports.level);
  for (const [x, z] of [[35, 35], [65, 65], [50, 50], [50, 65]]) assert.ok(Math.abs(terrain.heightAt(x, z) - track.groundLevel) < 1e-6);
});

test('local platform grading leaves neighbouring carved water and shore triangles intact', () => {
  const terrain = makeTerrain(), lake = [rect(70, 35, 90, 65)];
  terrain.carveWater(lake);
  const probes = [[70, 40], [70, 50], [71, 49], [80, 50], [90, 60]];
  const before = probes.map(([x, z]) => terrain.heightAt(x, z));
  terrain.gradePlatform([rect(35, 35, 60, 65)], { level: 4, band: 24, preserve: [lake] });
  assert.deepEqual(probes.map(([x, z]) => terrain.heightAt(x, z)), before);
  assert.equal(terrain.heightAt(50, 50), 4);
});

test('junction subtraction preserves touching edges and removes overlapping roadway', () => {
  const pavement = rect(0, 0, 10, 3);
  assert.equal(subtractConvex(pavement, rect(0, 3, 10, 8)).reduce((s, p) => s + area(p), 0), 30);
  const pieces = subtractConvex(pavement, rect(4, -1, 6, 5));
  assert.equal(pieces.reduce((s, p) => s + area(p), 0), 24);
  assert.equal(subtractConvex(pavement, rect(-1, -1, 11, 5)).length, 0);
});

test('polyline sampling handles duplicate OSM points and bounds corner miters', () => {
  const points = resampleRoad([[0, 0], [0, 0], [10, 0], [10, 10]], 1.2);
  for (const f of roadFrames(points)) assert.ok(Number.isFinite(f.nx) && Number.isFinite(f.nz) && Math.hypot(f.nx, f.nz) <= 1 / 0.65 + 1e-6);
  assert.deepEqual(points.at(-1), [10, 10]);
  assert.equal(triangleHeightAt(0.25, 0.25, [0, 0, 0], [1, 2, 0], [0, 4, 1]), 1.5);
  assert.equal(triangleHeightAt(2, 2, [0, 0, 0], [1, 2, 0], [0, 4, 1]), undefined);
});

test('visible sidewalk support stays clear of perpendicular carriageways', () => {
  // Canvas texture creation needs a 2D context, but this check exercises real Three
  // geometry and the navigation support triangles without needing a WebGL device.
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, putImageData() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) };
  const road = (pts, name) => ({ pts, name, w: 4.5, order: 3, kind: 'service', lanes: 2, tags: {}, internal: true, bridge: false });
  const roads = buildRoads({ roads: [road([[15, 50], [85, 50]], 'Rua Um'), road([[50, 15], [50, 85]], 'Rua Dois')] }, { heightAt: (x, z) => x * 0.02 + z * 0.01 }, { capabilities: { getMaxAnisotropy: () => 1 } });
  assert.equal(roads.sidewalkStats.roads, 2);
  assert.ok(roads.sidewalkStats.sidewalkArea > 200);
  assert.ok(Number.isFinite(roads.sidewalkHeightAt(25, 53.5)));
  assert.equal(roads.sidewalkHeightAt(50, 50), -Infinity);
  for (let q = 20; q < 80; q += 0.4) {
    assert.equal(roads.sidewalkHeightAt(q, 50), -Infinity);
    assert.equal(roads.sidewalkHeightAt(50, q), -Infinity);
  }
  assert.equal(roads.sidewalkHeightAt(25, 53.5, 0), -Infinity);
  for (const mesh of roads.root.getObjectByName('calcadas-cidade-de-deus').children) {
    const pos = mesh.geometry.attributes.position;
    assert.ok(Array.from(pos.array).every(Number.isFinite));
    assert.ok(mesh.geometry.index.count > 0);
  }
  delete globalThis.document;
});
