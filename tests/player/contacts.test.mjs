import test from 'node:test';
import assert from 'node:assert/strict';
import { moveWithContacts } from '../../src/shared/movement.js';

test('conflicting contacts cannot create endless uncontrolled motion; input can escape', () => {
  const collide = (x, z) => z > .03 ? [x, z] : [x > 0 ? -.1 : .1, z];
  let p = { x: 0, z: 0 };
  for (let i = 0; i < 300; i++) { const [x, z] = moveWithContacts(p, p, .35, 0, collide); assert.equal(x, 0); assert.equal(z, 0); p = { x, z }; }
  const [x, z] = moveWithContacts(p, { x: 0, z: .15 }, .35, 0, collide);
  assert.equal(x, 0); assert.equal(z, .15);
});

test('sweep prevents tunnelling through a thin structure even on a long frame', () => {
  const collide = (x, z, r) => x > -r && x < .03 + r ? [-r, z] : [x, z];
  const [x] = moveWithContacts({ x: -1, z: 0 }, { x: 1, z: 0 }, .35, 0, collide, { push: false });
  assert.ok(x <= -.35 + 1e-6);
});
