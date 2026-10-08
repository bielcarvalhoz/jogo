import test from 'node:test';
import assert from 'node:assert/strict';
import { MapView } from '../../src/ui/map-view.js';
const bounds = { x0: -1000, z0: -800, width: 2000, depth: 1600 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('map selection remains accurate after resizing, zooming and dragging', () => {
  const view = new MapView(bounds); view.resize(1200, 700);
  view.fit({ x0: -250, z0: -300, width: 500, depth: 600 });
  view.zoomAt(2, 500, 200); view.pan(74, -85); view.resize(700, 350);
  const screen = view.toScreen(150, -200), world = view.toWorld(...screen);
  close(world[0], 150); close(world[1], -200);
});

test('wheel/pinch zoom preserves the world under the pointer and keeps finite limits', () => {
  const view = new MapView(bounds); view.resize(1200, 700);
  const before = view.toWorld(480, 220); view.zoomAt(1.4, 480, 220); const after = view.toWorld(480, 220);
  close(before[0], after[0]); close(before[1], after[1]);
  view.zoomAt(1e10); assert.equal(view.zoom, 16); view.zoomAt(1e-10); assert.equal(view.zoom, 1);
  view.pan(1e8, -1e8); assert.equal(view.x, -1000); assert.equal(view.z, 800);
});
