import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickVector, createTouchControls } from '../../src/player/touch-controls.js';

test('analog stick has a dead zone, proportional speed and bounded diagonal reach', () => {
  assert.equal(joystickVector(2, 3).x, 0);
  assert.equal(joystickVector(2, 3).y, 0);
  const half = joystickVector(0, -26), full = joystickVector(0, -52);
  assert.ok(half.y > 0 && half.y < full.y); assert.equal(full.y, 1);
  const diagonal = joystickVector(300, -400);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
  assert.ok(Math.abs(Math.hypot(diagonal.dx, diagonal.dy) - 52) < 1e-10);
});

test('movement and look pointers retain independent roles; cancel, resize and pause stop movement', () => {
  const original = Object.fromEntries(['window', 'document', 'innerWidth', 'innerHeight'].map(k => [k, globalThis[k]]));
  globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
  globalThis.innerWidth = 390; globalThis.innerHeight = 844;
  try {
    const dom = new EventTarget(), fireButton = new EventTarget(), sticks = [], looks = [], firing = [];
    const captured = new Set(); let active = true, doubles = 0;
    dom.getBoundingClientRect = () => ({left: 0, width: 390});
    dom.setPointerCapture = id => captured.add(id); dom.hasPointerCapture = id => captured.has(id);
    dom.releasePointerCapture = id => captured.delete(id);
    const fireCaptured = new Set();
    fireButton.setPointerCapture = id => fireCaptured.add(id); fireButton.hasPointerCapture = id => fireCaptured.has(id);
    fireButton.releasePointerCapture = id => fireCaptured.delete(id);
    const touch = createTouchControls(dom, {isActive: () => active, onLook: (...p) => looks.push(p), onStick: s => sticks.push(s), onDoubleTap: () => doubles++});
    touch.bindFireButton(fireButton, held => firing.push(held));
    const send = (type, id, x, y, target = dom) => { const e = new Event(type, {cancelable: true}); Object.assign(e, {pointerType: 'touch', pointerId: id, clientX: x, clientY: y}); target.dispatchEvent(e); };
    send('pointerdown', 1, 60, 600); send('pointerdown', 2, 280, 400);
    send('pointermove', 1, 200, 548); // even across the centre this remains movement
    assert.ok(sticks.at(-1).x > 0); assert.ok(sticks.at(-1).y > 0); assert.equal(looks.length, 0);
    send('pointermove', 2, 310, 380); assert.deepEqual(looks[0].slice(0, 2), [30, -20]);
    send('pointerdown', 9, 330, 600, fireButton); assert.equal(firing.at(-1),true);
    send('pointermove', 9, 310, 610, fireButton); assert.deepEqual(looks[1].slice(0,2),[-20,10]);
    send('pointerup', 2, 310, 380); assert.equal(sticks.at(-1).active, true);
    assert.equal(firing.at(-1),true);
    send('pointercancel', 9, 310, 610, fireButton); assert.equal(firing.at(-1),false); assert.equal(fireCaptured.size,0);
    send('pointercancel', 1, 200, 548); assert.equal(sticks.at(-1).active, false); assert.equal(sticks.at(-1).x, 0);
    send('pointerdown', 3, 60, 600); send('pointermove', 3, 60, 548);
    send('pointerdown', 10, 330, 600, fireButton);
    window.dispatchEvent(new Event('resize')); assert.equal(sticks.at(-1).active, false); assert.equal(sticks.at(-1).y, 0); assert.equal(captured.size, 0);
    assert.equal(firing.at(-1),false); assert.equal(fireCaptured.size,0);
    send('pointerdown', 4, 60, 600); active = false; touch.reset();
    send('pointermove', 4, 60, 548); assert.equal(sticks.at(-1).active, false);
    assert.equal(doubles, 0);
  } finally {
    for (const [k, value] of Object.entries(original)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; }
  }
});
