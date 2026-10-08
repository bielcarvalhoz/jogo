import test from 'node:test';
import assert from 'node:assert/strict';
import { placeMarker } from '../../src/ui/marker-layout.js';

test('crowded numbers spread into separate hit targets inside the available viewport', () => {
  const placed = [];
  for (let i = 0; i < 20; i++) {
    const p = placeMarker(150 + i % 3, 150 + i % 2, placed, 390, 400);
    assert.ok(p, 'point should retain a label');
    assert.ok(p[0] >= 14.5 && p[0] <= 375.5 && p[1] >= 14.5 && p[1] <= 385.5);
    for (const q of placed) assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) >= 29);
    placed.push(p);
  }
  assert.deepEqual(placeMarker(100, 100, [], 390, 400), [100, 100]);
  assert.equal(placeMarker(10, 10, [], 20, 20), null);
});
