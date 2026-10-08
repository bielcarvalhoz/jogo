import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../../src/map/terrain.js';
import { gradeCampusTerrain } from '../../src/campus/grading.js';
import { buildRoads } from '../../src/map/roads.js';
import { resampleRoad, roadFrames, subtractConvex, triangleHeightAt } from '../../src/shared/road-geometry.js';
import { referenceEntrance, pairedEntrances } from '../../src/campus/reference.js';

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
  const report = a.gradeCorridors(roads, { maxAdjustment: .9 });
  b.gradeCorridors([...roads].reverse(), { maxAdjustment: .9 });
  assert.ok(report.changed > 0);
  assert.ok(report.cutFill <= 0.9);
  for (let z = 5; z < 100; z += 5) for (let x = 5; x < 100; x += 5) assert.ok(Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) < 1e-6);
});

test('engineered road sections remove steep lateral SRTM slope and keep longitudinal ramps viable', () => {
  const terrain = createTerrain({ nx: 41, ny: 41, min: 0, max: 60, bbox: [0, 0, 100, 100], heights: Array.from({ length: 1681 }, (_, k) => (k % 41) * .75 + Math.floor(k / 41) * .6) }, proj);
  const road = { w: 5, pts: [[15, 50], [50, 50], [85, 50]], internal: true };
  const report = terrain.gradeCorridors([road]);
  assert.ok(report.cutFill > .9, 'real cut/fill corrects the steep cross slope rather than stopping at the old cosmetic cap');
  assert.ok(report.maxGrade <= .1201);
  for (let x = 22; x <= 78; x += 3) {
    assert.ok(Math.abs(terrain.heightAt(x, 47.5) - terrain.heightAt(x, 52.5)) < .001);
    assert.ok(Math.abs(terrain.roadHeightAt(road, x, 47.5) - terrain.roadHeightAt(road, x, 52.5)) < 1e-8);
  }
});

test('street engineering datum is established before foundation cut/fill and is stable afterwards', () => {
  const terrain = makeTerrain(), road = { id: 'approach', w: 5, pts: [[15, 50], [85, 50]], internal: true };
  const before = terrain.heightAt(50, 50);
  const profile = terrain.gradeCorridors([road], { profileOnly: true });
  const datum = terrain.roadHeightAt(road, 50, 50);
  assert.equal(profile.changed, 0);
  assert.equal(terrain.heightAt(50, 50), before, 'profile preparation does not modify the elevation grid');
  terrain.gradePlatform([rect(30, 30, 70, 70)], { level: 12 });
  const report = terrain.gradeCorridors([road], { reuseProfiles: true });
  assert.equal(terrain.roadHeightAt(road, 50, 50), datum, 'raised construction cannot feed its height back into the road');
  assert.ok(report.maxGrade <= .1201);
});

test('an entrance forecourt selects its building datum from the nearby engineered approach street', () => {
  const terrain = createTerrain({ nx: 41, ny: 41, min: 0, max: 60, bbox: [0, 0, 100, 100], heights: Array.from({ length: 1681 }, (_, k) => (k % 41) * .75 + Math.floor(k / 41) * .6) }, proj);
  const road = { id: 'frontage', w: 5, pts: [[15, 50], [85, 50]], internal: true }, sample = [70, 46];
  const building = { planId: 'b17', rings: [rect(60, 22, 80, 37)] }, apron = { buildingId: 'b17', rings: [rect(60, 37.1, 80, 46)], sample, band: 5 };
  gradeCampusTerrain({ roads: [road], areas: [] }, terrain, { buildings: [building], platformAprons: [apron] });
  const street = terrain.roadHeightAt(road, ...sample);
  assert.ok(Math.abs(building.groundY - street - .85) < 1e-8);
  assert.ok(Math.abs(apron.height - street - .15) < 1e-8);
  assert.ok(terrain.platformFor(building).cutFill > .9, 'entrance datum entails actual local construction grading');
  assert.ok(terrain.heightAt(70, 46) < building.groundY, 'street approach stays below the building first floor');
});

test('low Yellow, cafe and Conviver first floors follow their approach street instead of the uphill footprint median', () => {
  for (const [planId, offset] of [['b21', .2], ['m2', .15], ['m0', .15]]) {
    const terrain = createTerrain({ nx: 41, ny: 41, min: 0, max: 60, bbox: [0, 0, 100, 100], heights: Array.from({ length: 1681 }, (_, k) => (k % 41) * .3 + (40 - Math.floor(k / 41)) * .75) }, proj);
    const road = { id: 'approach', w: 5, pts: [[15, 50], [85, 50]], internal: true }, building = { planId, rings: [rect(35, 22, 65, 37)] };
    gradeCampusTerrain({ roads: [road] }, terrain, { buildings: [building] });
    const e = referenceEntrance(building, [road]), platform = terrain.platformFor(building);
    assert.ok(Math.abs(building.groundY - terrain.roadHeightAt(road, e.roadX, e.roadZ) - offset) < 1e-8);
    assert.ok(platform.height < platform.min, 'the complete foundation is cut to its low entrance datum');
    assert.ok(terrain.heightAt(50, 29) <= building.groundY + .001, 'first floor is not left under the hillside');
  }
});

test('Red and Ruby share the approach datum across their bridge and grade both complete foundations', () => {
  const terrain = createTerrain({ nx: 41, ny: 41, min: 0, max: 60, bbox: [0, 0, 100, 100], heights: Array.from({ length: 1681 }, (_, k) => (k % 41) * .3 + (40 - Math.floor(k / 41)) * .75) }, proj);
  const road = { id: 'under-bridge', w: 5, pts: [[15, 50], [85, 50]], internal: true };
  const red = { planId: 'b3', rings: [rect(35, 25, 65, 40)] }, ruby = { planId: 'b5', rings: [rect(35, 60, 65, 75)] };
  gradeCampusTerrain({ roads: [road] }, terrain, { buildings: [red, ruby] });
  const pair = pairedEntrances(red, ruby, [road]), datum = terrain.roadHeightAt(road, pair.red.x, pair.red.z);
  assert.equal(red.groundY, ruby.groundY);
  assert.ok(Math.abs(red.groundY - datum - .05) < 1e-8);
  assert.ok(terrain.platformFor(red).height < terrain.platformFor(red).min, 'uphill Red foundation is cut');
  assert.ok(terrain.platformFor(ruby).height > terrain.platformFor(ruby).max, 'downhill Ruby foundation is filled');
  for (const b of [red, ruby]) for (const [x, z] of [...b.rings[0], [50, (b.rings[0][0][1] + b.rings[0][2][1]) / 2]])
    assert.ok(terrain.heightAt(x, z) <= b.groundY + .001, 'terrain cannot cover either first floor');
});

test('forecourt platform resolves its building level and preserves carved lake and sports ground', () => {
  const terrain = makeTerrain(), lake = [rect(80, 70, 90, 90)], track = { cx: 25, cz: 75, outer: rect(15, 65, 35, 85) };
  const building = { planId: 'b17', rings: [rect(45, 25, 65, 45)] }, apron = { buildingId: 'b17', rings: [rect(45, 45.1, 65, 58)], band: 5 };
  terrain.carveWater(lake);
  const lakeBefore = terrain.heightAt(85, 80);
  const report = gradeCampusTerrain({ roads: [], areas: [{ kind: 'water', rings: lake }] }, terrain, { buildings: [building], platformAprons: [apron], track });
  assert.ok(Math.abs(apron.height - (building.groundY - .7)) < 1e-7);
  assert.equal(report.aprons[0].buildingId, 'b17');
  assert.equal(terrain.heightAt(85, 80), lakeBefore);
  assert.ok(Math.abs(terrain.heightAt(track.cx, track.cz) - track.groundLevel) < 1e-6);
});

test('building platforms sample the interior SRTM peak and expose one coherent foundation height', () => {
  const heights = Array.from({ length: 441 }, (_, k) => 10 + (k % 21) * .2 + Math.floor(k / 21) * .3);
  heights[10 * 21 + 10] += 6; // peak invisible to a vertex-only footprint check
  const terrain = createTerrain({ nx: 21, ny: 21, min: 10, max: 20, bbox: [0, 0, 100, 100], heights }, proj);
  const building = { rings: [rect(35, 35, 65, 65)] };
  const platform = terrain.prepareBuildingPlatform(building);
  assert.ok(platform.max > 10, 'interior elevation peak was measured');
  assert.equal(terrain.platformFor(building), platform);
  assert.equal(building.groundY, platform.height);
  for (let z = 35; z <= 65; z += 1) for (let x = 35; x <= 65; x += 1) assert.ok(Math.abs(terrain.heightAt(x, z) - platform.height) < 1e-6);
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
  assert.equal(terrain.heightAt(65, 50), 4, 'a vertex touching only the outside shore boundary remains available for grading');
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

test('unnamed internal service street gets two-way centre paint, flat road sections and exact player support', () => {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, putImageData() {}, getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) }) };
  try {
    const r = { pts: [[15, 50], [85, 50]], name: null, w: 4.5, order: 3, kind: 'service', lanes: 1, tags: { service: 'driveway' }, internal: true, bridge: false };
    const terrain = makeTerrain(), world = { roads: [r] };
    gradeCampusTerrain(world, terrain, { buildings: [] });
    assert.equal(r.kind, 'twoway'); assert.equal(r.lanes, 2);
    const roads = buildRoads(world, terrain, { capabilities: { getMaxAnisotropy: () => 1 } });
    const paint = roads.root.getObjectByName('eixos-amarelos-campus');
    assert.ok(paint?.geometry.index.count > 0, 'unnamed driveway does not lose its centre line');
    const carriageway = roads.root.children.find(mesh => mesh.isMesh && mesh.geometry.attributes.uv);
    const position = carriageway.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 3) {
      assert.equal(position.getY(i), position.getY(i + 1));
      assert.equal(position.getY(i), position.getY(i + 2));
    }
    for (let i = 0; i < carriageway.geometry.index.count; i += 3) {
      const ids = [0, 1, 2].map(j => carriageway.geometry.index.getX(i + j));
      const x = ids.reduce((sum, j) => sum + position.getX(j), 0) / 3, z = ids.reduce((sum, j) => sum + position.getZ(j), 0) / 3;
      const visible = ids.reduce((sum, j) => sum + position.getY(j), 0) / 3;
      assert.ok(Math.abs(roads.surfaceHeightAt(x, z) - visible) < 1e-5);
      assert.ok(terrain.heightAt(x, z) <= visible + .001, 'terrain does not protrude through the road');
    }
    const retaining = roads.root.getObjectByName('contencao-vias-campus');
    assert.ok(retaining?.geometry.index.count > 0, 'engineered side edges meet the ground');
    assert.ok(Array.from(retaining.geometry.attributes.normal.array).every(Number.isFinite));
    assert.equal(roads.surfaceHeightAt(50, 50, 0), -Infinity);
  } finally { delete globalThis.document; }
});
