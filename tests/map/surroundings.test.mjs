import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWorldFor } from '../../src/map/surroundings.js';
const polygon = (x, z) => ({ rings: [[[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]]] });

test('disabled surroundings omit distant 3D data while the full map data stays intact', () => {
  const world = { quarter: [[[0, 0], [10, 0], [10, 10], [0, 10]]], buildings: [polygon(2, 2), polygon(20, 20)], areas: [polygon(3, 3), polygon(30, 30)], roads: [{ pts: [[2, 2], [8, 8]], internal: true }, { pts: [[20, 20], [30, 30]] }], barriers: [], treeRows: [], waterways: [], points: [{ x: 2, z: 2 }, { x: 20, z: 20 }] };
  const rendered = renderWorldFor(world);
  assert.equal(rendered.buildings.length, 1); assert.equal(rendered.areas.length, 1); assert.equal(rendered.roads.length, 1); assert.equal(rendered.points.length, 1);
  assert.equal(world.buildings.length, 2); assert.equal(world.roads.length, 2);
  assert.equal(renderWorldFor(world, 'fog'), world); assert.equal(renderWorldFor(world, 'on'), world);
});
