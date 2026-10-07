import test from 'node:test';
import assert from 'node:assert/strict';
import { facadeProfile, exteriorEdges, frontageEdges, referenceEntrance, removeDuplicateCampusBarriers } from '../src/campus-reference.js';
import { campusWallGeometry } from '../src/campus-wall.js';
import { pointInRing } from '../src/geo.js';
import { buildCampusDetails } from '../src/campus-details.js';
import { triangleHeightAt } from '../src/road-geometry.js';

const square = [[0, 0], [20, 0], [20, 20], [0, 20]];
const road = (pts, extra = {}) => ({ pts, w: 5, internal: true, kind: 'service', bridge: false, ...extra });

test('mitered wall top shares its corner and has only two end caps', () => {
  const geometry = campusWallGeometry([[[0, 0], [10, 0], [10, 10]]], (x, z) => x * .02 + z * .04);
  const p = geometry.attributes.position;
  assert.equal(p.count, 48, 'two segments × three faces, plus two end caps');
  assert.ok(Array.from(p.array).every(Number.isFinite));
  const top = [Array.from(p.array.slice(36, 54)), Array.from(p.array.slice(90, 108))];
  const firstVertices = Array.from({ length: 6 }, (_, i) => top[0].slice(i * 3, i * 3 + 3));
  const secondVertices = Array.from({ length: 6 }, (_, i) => top[1].slice(i * 3, i * 3 + 3));
  const shared = firstVertices.filter(a => secondVertices.some(b => a.every((v, i) => Math.abs(v - b[i]) < 1e-6)));
  assert.ok(new Set(shared.map(v => v.join(','))).size >= 2, 'top strips meet on exactly the same pair of join vertices');
  assert.ok(firstVertices.some(v => Math.abs(v[0] - 9.88) < 1e-5 && Math.abs(v[2] - .12) < 1e-5));
});

test('closed walls have no duplicated cap faces and ignore consecutive OSM duplicates', () => {
  const ring = [[0, 0], [0, 0], [20, 0], [20, 20], [0, 20], [0, 0], [0, 0]];
  const geometry = campusWallGeometry([ring], () => 0);
  assert.equal(geometry.attributes.position.count, 72, 'four segments × three faces, no end caps');
  assert.equal(geometry.attributes.position.count, geometry.attributes.color.count);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1) - p.getX(i), ay = p.getY(i + 1) - p.getY(i), az = p.getZ(i + 1) - p.getZ(i);
    const bx = p.getX(i + 2) - p.getX(i), by = p.getY(i + 2) - p.getY(i), bz = p.getZ(i + 2) - p.getZ(i);
    assert.ok(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) > 1e-6, 'wall triangles have real area');
  }
});

test('partial duplicated OSM barriers lose only the run replaced by a campus wall', () => {
  const barrier = { id: 'boundary', kind: 'wall', height: 2.5, pts: [[0, 0], [20, 0]], tags: { source: 'OSM' } };
  const nearWall = (x, z) => Math.abs(z) < .1 && x >= 4 && x <= 12;
  const runs = removeDuplicateCampusBarriers([barrier], nearWall);
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0].pts[0], runs[0].pts.at(-1), runs[1].pts[0], runs[1].pts.at(-1)], [[0, 0], [4, 0], [12, 0], [20, 0]]);
  assert.ok(runs.every(r => r.id === barrier.id && r.height === barrier.height && r.tags === barrier.tags));
  assert.equal(removeDuplicateCampusBarriers([barrier], () => true).length, 0);
  const hedge = { ...barrier, kind: 'hedge' };
  assert.deepEqual(removeDuplicateCampusBarriers([hedge], () => true), [hedge]);
  const unrelated = { ...barrier, pts: [[0, 5], [20, 5]] };
  const kept = removeDuplicateCampusBarriers([unrelated], nearWall);
  assert.deepEqual([kept[0].pts[0], kept[0].pts.at(-1)], unrelated.pts);
});

test('facade normals face outside in both polygon orientations, including concave plans', () => {
  const concave = [[0, 0], [50, 0], [50, 20], [30, 20], [30, 40], [0, 40]];
  for (const ring of [concave, [...concave].reverse()]) for (const edge of exteriorEdges(ring)) {
    const x = (edge.ax + edge.bx) / 2, z = (edge.az + edge.bz) / 2;
    assert.equal(pointInRing(x + edge.nx * .5, z + edge.nz * .5, ring), false);
    assert.equal(pointInRing(x - edge.nx * .5, z - edge.nz * .5, ring), true);
  }
  const segmented = [[0, 0], [5, 0], [10, 0], [20, 0], [20, 20], [0, 20]];
  assert.equal(frontageEdges(segmented).length, 4, 'collinear map vertices do not hide a usable wide frontage');
});

test('entrance selection faces an internal street and respects blocked frontages', () => {
  const building = { rings: [square] };
  const publicRoad = road([[-5, -6], [25, -6]], { internal: false });
  const internalRoad = road([[-5, -12], [25, -12]]);
  const entrance = referenceEntrance(building, [publicRoad, internalRoad]);
  assert.equal(entrance.road, internalRoad);
  assert.deepEqual([entrance.x, entrance.z], [10, 0]);
  assert.ok(Math.abs(entrance.nx) < 1e-6 && entrance.nz === -1);
  assert.equal(entrance.clearance, 9.5);
  const reversed = referenceEntrance({ rings: [[...square].reverse()] }, [internalRoad]);
  assert.deepEqual([reversed.x, reversed.z], [10, 0]);
  assert.ok(Math.abs(reversed.nx) < 1e-6 && reversed.nz === -1);
  assert.equal(referenceEntrance(building, [internalRoad], () => false), null);
  assert.equal(referenceEntrance(building, [road([[-5, -3], [25, -3]])]), null, 'no entrance assembly placed in the carriageway');
});

test('reference building identities resolve to the photographed facade treatments', () => {
  assert.equal(facadeProfile({ planId: 'b17' }).type, 'louver');
  assert.equal(facadeProfile({ planId: 'b17' }).sign, '#2879b6');
  assert.equal(facadeProfile({ planId: 'b3' }).sign, '#c8102e');
  assert.equal(facadeProfile({ planId: 'b21' }).sign, '#e4bd49');
  assert.equal(facadeProfile({ planId: 'unknown', style: 'pavilion' }).type, 'pavilion');
  assert.equal(facadeProfile({ planId: 'unknown', style: 'garage' }).type, 'garage');
});

test('entrance floor rectangles and ramp triangles agree with navigation across all their vertices', () => {
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), measureText: text => ({ width: text.length * 18 }) }, { get: (target, key) => target[key] ?? (() => {}) });
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  try {
    for (const scenario of [
      { planId: 'b1', name: 'Prédio Cinza', angle: 0 },
      { planId: 'b6', name: 'Prédio Prata', angle: .4 },
      { planId: 'b21', name: 'Prédio Amarelo', angle: -.5 },
      { planId: 'b17', name: 'Prédio Azul', angle: .9 },
      { planId: 'm0', name: 'Espaço Conviver', style: 'pavilion', angle: -.7 },
    ]) {
    const rotate = ([x, z]) => [x * Math.cos(scenario.angle) - z * Math.sin(scenario.angle), x * Math.sin(scenario.angle) + z * Math.cos(scenario.angle)];
    const b = { ...scenario, num: 1, rings: [[[0, 0], [80, 0], [80, 20], [0, 20]].map(rotate)], height: scenario.style === 'pavilion' ? 5 : 16, levels: scenario.style === 'pavilion' ? 1 : 4, style: scenario.style || 'office' };
    const C = { inRegion: () => true, insideSolid: () => false, RI: { clearance: () => ({ d: 15 }) } };
    const details = buildCampusDetails(C, [{ b, info: { gMin: 0, top: b.height } }], { renderer: { capabilities: { getMaxAnisotropy: () => 1 } }, terrain: { heightAt: () => 0 }, world: { roads: [road([[-5, -15], [85, -15]].map(rotate))] }, quality: 'low' });
    const floorMeshes = details.root.children.filter(m => m.geometry && ['a19e97', '969c9e', 'd5d6d2', 'b2afa5'].includes(m.material.color?.getHexString()));
    const ramp = floorMeshes.find(m => m.material.color.getHexString() === 'b2afa5');
    assert.ok(ramp, 'wide facade has an accessible ramp');
    assert.ok(Array.from(ramp.geometry.attributes.normal.array).some((v, i) => i % 3 === 1 && v > .99), 'ramp faces upwards and renders from above');
    const triangles = [];
    for (const m of floorMeshes) {
      const p = m.geometry.attributes.position, n = m.geometry.attributes.normal;
      for (let i = 0; i < p.count; i += 3) if (n.getY(i) > .99) triangles.push(Array.from({ length: 3 }, (_, k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]));
    }
    assert.ok(triangles.length >= 12, 'landing, all treads/nosings and both ramp triangles are checked');
    for (const triangle of triangles) {
      const cx = triangle.reduce((s, p) => s + p[0], 0) / 3, cz = triangle.reduce((s, p) => s + p[2], 0) / 3;
      for (const point of [...triangle, [cx, 0, cz]]) {
        // Move a submillimetre inside the triangle to avoid decimal/Float32 edge
        // disagreement while still exercising the real overlapping tread corners.
        const x = point[0] + (cx - point[0]) * 1e-4, z = point[2] + (cz - point[2]) * 1e-4;
        const expected = Math.max(...triangles.map(t => triangleHeightAt(x, z, ...t) ?? -Infinity));
        const support = details.surfaceHeightAt(x, z);
        assert.ok(Math.abs(support - expected) < .001, `${b.name}: visible floor=${expected} and support=${support} at ${x},${z}`);
        assert.equal(details.surfaceHeightAt(x, z, -.1), -Infinity, 'a ceiling-height limit excludes entrance surfaces');
      }
    }
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
