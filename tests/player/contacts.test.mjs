import test from 'node:test';
import assert from 'node:assert/strict';
import { moveWithContacts, slideCharacterContacts } from '../../src/shared/movement.js';

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

test('characters block overlap but preserve tangential input and allow walking around them', () => {
  const other = { position: { x: 0, y: 0, z: 0 }, radius: .35 };
  const collide = (x, z, r, y, options) => slideCharacterContacts(x, z, r, y, [other], options);
  let p = { x: -.7, z: 0 };
  for (let i = 0; i < 24; i++) {
    const [x, z] = moveWithContacts(p, { x: p.x + .04, z: p.z + .04 }, .35, 0, collide);
    assert.ok(Math.hypot(x, z) >= .7 - 1e-6, 'walking cannot enter the other capsule'); p = { x, z };
  }
  assert.ok(p.x > 0 && p.z > .7, 'diagonal input must go around the body, not freeze at contact');
  const [blocked] = moveWithContacts({ x: -2, z: 0 }, { x: 2, z: 0 }, .35, 0, collide);
  assert.ok(blocked <= -.7 + 1e-6, 'a long frame cannot tunnel through another character');
  const from = { x: -.3, z: 0 };
  assert.deepEqual(moveWithContacts(from, from, .35, 0, collide), [from.x, from.z], 'an initial overlap cannot cause idle drift');
  const escaped = moveWithContacts(from, { x: -.4, z: .1 }, .35, 0, collide);
  assert.ok(escaped[0] < from.x && escaped[1] > 0, 'a pre-existing overlap must be escapable');
  for (const state of [{ dead: true }, { networkGhost: true }, { position: { x: 0, y: 3, z: 0 } }]) {
    assert.deepEqual(slideCharacterContacts(0, 0, .35, 0, [{ ...other, ...state }]), [0, 0]);
  }
});
