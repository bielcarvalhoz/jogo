import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProjection, openRing, pointInPolygon, distToSegment } from '../src/geo.js';
import { parseWorld } from '../src/world.js';
import { planCampusAmenities, buildCampusAmenities } from '../src/campus-amenities.js';

function actualCampus() {
  const geo = JSON.parse(readFileSync(new URL('../public/data/cidade-de-deus.geojson', import.meta.url)));
  const q = geo.features.find((feature) => feature.properties.place === 'quarter').geometry.coordinates[0];
  const lon0 = (Math.min(...q.map((p) => p[0])) + Math.max(...q.map((p) => p[0]))) / 2;
  const lat0 = (Math.min(...q.map((p) => p[1])) + Math.max(...q.map((p) => p[1]))) / 2;
  const proj = createProjection(lon0, lat0), world = parseWorld(geo, proj);
  for (const road of world.roads) {
    const middle = road.pts[Math.floor(road.pts.length / 2)];
    road.internal = road.highway === 'service' && pointInPolygon(...middle, world.quarter);
  }
  const data = JSON.parse(readFileSync(new URL('../public/data/campus-cidade-de-deus.geojson', import.meta.url)));
  const buildings = data.features.filter((feature) => feature.properties.kind === 'building').map((feature) => ({ ...feature.properties,
    rings: feature.geometry.coordinates.map((ring) => openRing(ring.map((point) => proj.toLocal(...point)))) }));
  const gates = data.features.filter((feature) => feature.properties.kind === 'gate').map((feature) => {
    const [x, z] = proj.toLocal(...feature.geometry.coordinates); return { ...feature.properties, x, z };
  });
  const C = { quarter: world.quarter, buildings, gates, busStops: [],
    insideSolid: (x, z) => buildings.some((building) => pointInPolygon(x, z, building.rings)) };
  return { C, world };
}

test('official gates each receive an entry and exit, including pedestrian gates; Bussocaba mouth is deduplicated', () => {
  const { C, world } = actualCampus();
  const plan = planCampusAmenities(C, world);
  assert.equal(plan.gates.length, 5);
  assert.deepEqual(plan.gates.map((gate) => gate.gate.num).sort((a, b) => a - b), [6, 7, 8, 9, 10]);
  for (const gate of plan.gates) {
    assert.deepEqual(gate.lanes.map((lane) => lane.direction), ['entrada', 'saída']);
    const separation = Math.hypot(gate.lanes[0].x - gate.lanes[1].x, gate.lanes[0].z - gate.lanes[1].z);
    assert.ok(separation >= 1.7 - 1e-8);
    assert.ok(gate.lanes.every((lane) => Number.isFinite(lane.x + lane.z + lane.yaw)));
  }
});

test('MOVE reuses existing stop coordinates and has no duplicate shelter at an overlapping point', () => {
  const { C, world } = actualCampus();
  C.busStops = [{ x: 14, z: 28, yaw: 1, near: 'Prédio Azul' }, { x: 15, z: 29, yaw: 1.2, near: 'Prédio Azul' }, { x: 40, z: 50, yaw: -.5, near: 'Prédio Amarelo' }];
  const plan = planCampusAmenities(C, world);
  assert.equal(plan.stops.length, 2);
  assert.deepEqual(plan.stops.map(({ x, z }) => [x, z]), [[14, 28], [40, 50]]);
  assert.ok(plan.stops.every((stop) => stop.approximate && stop.source.includes('existente')));
  assert.equal(plan.exclusions.filter((exclusion) => exclusion.kind === 'move').length, 2);
});

test('the exhibition locomotive is beside CTI, clear of footprints and carriageways', () => {
  const { C, world } = actualCampus();
  const train = planCampusAmenities(C, world).train;
  assert.ok(train, 'a free garden position must be found beside the existing CTI entrance');
  assert.equal(train.near, 'Prédio CTI');
  assert.equal(train.approximate, true);
  for (const [x, z] of [...train.ring, [train.x, train.z]]) {
    assert.ok(pointInPolygon(x, z, C.quarter));
    assert.ok(!C.insideSolid(x, z));
    for (const road of world.roads) if (!road.bridge) for (let i = 1; i < road.pts.length; i++) {
      assert.ok(distToSegment(x, z, ...road.pts[i - 1], ...road.pts[i]).d - road.w / 2 >= 2.6 - 1e-6);
    }
  }
});

test('amenity meshes are finite and bounded, pads clear the highest terrain and give walking support', () => {
  const { C, world } = actualCampus();
  C.busStops = [{ x: 14, z: 28, yaw: 1, near: 'Prédio Azul' }];
  const terrain = { heightAt: (x, z) => x * .025 + z * .017 };
  const amenities = buildCampusAmenities(C, { terrain, world });
  assert.equal(amenities.stats.moveStops, 1);
  assert.equal(amenities.stats.turnstiles, 10);
  assert.equal(amenities.stats.locomotives, 1);
  assert.ok(amenities.stats.meshes <= 20 && amenities.stats.triangles < 16000, JSON.stringify({ meshes: amenities.stats.meshes, triangles: amenities.stats.triangles }));
  amenities.root.traverse((object) => {
    if (!object.isMesh) return;
    assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
  });
  for (const surface of amenities.surfaces) for (const [x, z] of surface.rings[0]) {
    assert.ok(surface.y > terrain.heightAt(x, z));
    assert.ok(amenities.surfaceHeightAt(x, z, surface.y - .001) < surface.y);
  }
  for (const gate of amenities.plan.gates) for (const lane of gate.lanes) {
    assert.ok(amenities.surfaceHeightAt(lane.x, lane.z) >= lane.padHeight);
    assert.ok(amenities.solids.filter((solid) => solid.kind === 'gabinete-catraca').every((solid) => !pointInPolygon(lane.x, lane.z, solid.rings)));
  }
  const train = amenities.plan.train;
  assert.ok(train.padHeight > Math.max(...train.ring.map(([x, z]) => terrain.heightAt(x, z))));
  const rotor = amenities.root.getObjectByName('catracas-tripodes');
  assert.ok(rotor);
  const before = [...rotor.instanceMatrix.array];
  const lane = amenities.plan.gates.find((gate) => gate.gate.num === 10).lanes[0];
  amenities.update(.05, lane);
  assert.ok(rotor.instanceMatrix.array.some((value, i) => value !== before[i]));
});
