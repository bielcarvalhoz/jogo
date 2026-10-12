import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeaponWheel, weaponWheelIndex } from '../../src/ui/weapon-wheel.js';
import { createEvents } from '../../src/core/events.js';

class Element extends EventTarget {
  constructor() {
    super(); this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this.hidden = false;
    this.classList = { toggle: (name, value) => { this[name] = value; } }; this.captures = new Set();
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function setup(run) {
  const original = { window: globalThis.window, document: globalThis.document };
  const elements = new Map(), bindings = new Map(), systems = [];
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { getElementById: element, createElement: () => new Element(), createElementNS: () => new Element(), body: element('body') });
  const weapons = [
    { id: 'pistol', label: 'Glock-18', kind: 'firearm', damage: 30 },
    { id: 'automatic', label: 'AK-47', kind: 'firearm', damage: 36, automatic: true },
    { id: 'knife', label: 'Faca', kind: 'melee' },
    { id: 'fists', label: 'Socos', kind: 'unarmed' },
    { id: 'shotgun', label: 'Nova', kind: 'firearm', damage: 26 },
    { id: 'axe', label: 'Machado', kind: 'melee' },
  ];
  const inventory = { slots: ['pistol', 'automatic', 'knife'], lastFirearmSlot: 0 };
  let selected = weapons[0], holstered = false, resetCount = 0, wheelPlayer = false, pickups = 0;
  const paintball = {
    weapons, get weapon() { return selected; }, get inventory() { return { ...inventory, selected: selected.id }; },
    get availableWeapons() { return inventory.slots.map(id => weapons.find(w => w.id === id)).concat(weapons[3]); },
    get holstered() { return holstered; }, setHolstered(value) { holstered = value; },
    setWeapon(id) { selected = weapons.find(w => w.id === id); holstered = false; }, resetInput() { resetCount++; }, setTrigger() {}, aiming: false,
  };
  const player = { active: true, events: new EventTarget(), setWeaponWheelOpen: value => { wheelPlayer = value; }, setFocusedAim() {} };
  const game = { mode: 'training', paintball, player, events: createEvents(), input: { bind: (code, handler) => bindings.set(code, handler) },
    engine: { addSystem: fn => systems.push(fn) }, toast() {}, weaponPickups: { nearby: null, pickup() { pickups++; return false; } } };
  const wheel = createWeaponWheel(game); game.ui = { get weaponWheelOpen() { return wheel.open; }, mapOpen: false };
  const send = (target, type, values = {}) => { const event = new Event(type, { cancelable: true }); Object.assign(event, values); target.dispatchEvent(event); return event; };
  const key = code => bindings.get(code)({ code, preventDefault() {} });
  try { run({ wheel, game, paintball, player, element, send, key, systems, inventory, get resets() { return resetCount; }, get playerOpen() { return wheelPlayer; }, get pickups() { return pickups; } }); }
  finally { for (const [name, value] of Object.entries(original)) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } }
}

test('wheel directions match the four slots and a neutral gesture selects nothing', () => {
  assert.equal(weaponWheelIndex(0, -100), 0); assert.equal(weaponWheelIndex(100, 0), 1);
  assert.equal(weaponWheelIndex(0, 100), 2); assert.equal(weaponWheelIndex(-100, 0), 3);
  assert.equal(weaponWheelIndex(10, 5), null); assert.equal(weaponWheelIndex(0, 0), null);
});

test('holstering updates the HUD and controls; selecting the retained weapon equips it again', () => setup(s => {
  s.paintball.setHolstered(true);s.systems.forEach(fn=>fn());
  assert.equal(s.element('weapon-label').textContent,'DESARMADO');
  assert.equal(s.element('btn-holster').attributes['aria-pressed'],'true');
  assert.equal(s.element('btn-fire').disabled,true);assert.equal(s.element('btn-aim').disabled,true);
  assert.equal(s.element('body').holstered,true);
  s.key('KeyQ');s.send(window,'mousemove',{movementX:0,movementY:-80});s.send(window,'keyup',{code:'KeyQ'});
  s.systems.forEach(fn=>fn());
  assert.equal(s.paintball.weapon.id,'pistol');assert.equal(s.paintball.holstered,false);
  assert.equal(s.element('weapon-label').textContent,'GLOCK-18');
  assert.equal(s.element('btn-holster').attributes['aria-pressed'],'false');assert.equal(s.element('btn-fire').disabled,false);
}));

test('holding Q suppresses input, pointer lock deltas select a weapon only on release', () => setup(s => {
  s.key('KeyQ'); assert.equal(s.wheel.open, true); assert.equal(s.playerOpen, true); assert.ok(s.resets);
  s.send(window, 'mousemove', { movementX: 80, movementY: 0 });
  assert.equal(s.paintball.weapon.id, 'pistol');
  s.send(window, 'keyup', { code: 'KeyQ' });
  assert.equal(s.paintball.weapon.id, 'automatic'); assert.equal(s.wheel.open, false); assert.equal(s.playerOpen, false);
  s.key('KeyQ'); s.send(window, 'keyup', { code: 'KeyQ' }); assert.equal(s.paintball.weapon.id, 'automatic', 'tap preserves selection');
}));

test('touch hold captures the owning finger, drag selects melee and compatibility clicks do not reopen', () => setup(s => {
  const button = s.element('btn-weapon');
  s.send(button, 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 250 });
  assert.equal(button.hasPointerCapture(7), true);
  s.send(button, 'pointermove', { pointerId: 8, clientX: 400, clientY: 250 });
  s.send(button, 'pointerup', { pointerId: 8 }); assert.equal(s.wheel.open, true);
  s.send(button, 'pointermove', { pointerId: 7, clientX: 500, clientY: 325 });
  s.send(button, 'pointerup', { pointerId: 7 });
  assert.equal(s.paintball.weapon.id, 'knife'); assert.equal(button.hasPointerCapture(7), false);
  s.send(button, 'click', { detail: 0 }); s.send(button, 'click', { detail: 1 }); assert.equal(s.wheel.open, false);
}));

test('outside releases and fresh primary touches recover a stranded mobile weapon wheel', () => setup(s => {
  const button = s.element('btn-weapon');
  s.send(button, 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 500, clientY: 250 });
  s.send(button, 'pointermove', { pointerId: 7, clientX: 580, clientY: 250 });
  s.send(window, 'pointerup', { pointerId: 7 });
  assert.equal(s.wheel.open, false); assert.equal(s.playerOpen, false); assert.equal(s.paintball.weapon.id, 'automatic');
  s.send(button, 'pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 500, clientY: 250 });
  s.send(window, 'pointercancel', { pointerId: 8 }); assert.equal(s.playerOpen, false);
  s.send(button, 'pointerdown', { pointerId: 9, pointerType: 'touch', clientX: 500, clientY: 250 });
  s.send(window, 'pointerdown', { pointerId: 10, pointerType: 'touch', isPrimary: true });
  assert.equal(s.wheel.open, false); assert.equal(s.playerOpen, false);
}));

test('analog selection includes fists; cancellation and mode or map loss never commit', () => setup(s => {
  s.key('KeyQ'); s.send(s.player.events, 'joystick', { detail: { active: true, x: -1, y: 0 } });
  s.send(window, 'keyup', { code: 'KeyQ' }); assert.equal(s.paintball.weapon.id, 'fists');
  s.key('KeyQ'); s.send(window, 'mousemove', { movementX: 90, movementY: 0 }); s.wheel.cancel();
  assert.equal(s.paintball.weapon.id, 'fists');
  s.key('KeyQ'); s.send(window, 'mousemove', { movementX: 90, movementY: 0 }); s.game.events.emit('modechange', null);
  s.send(window, 'keyup', { code: 'KeyQ' }); assert.equal(s.paintball.weapon.id, 'fists');
  s.key('KeyQ'); s.game.ui.mapOpen = true; s.systems.forEach(fn => fn()); assert.equal(s.wheel.open, false);
  s.game.ui.mapOpen = false; s.key('KeyQ'); s.send(window, 'blur'); assert.equal(s.wheel.open, false);
}));

test('dragging onto the visible wheel selects the sector under the finger', () => setup(s => {
  const button = s.element('btn-weapon');
  s.element('weapon-wheel-ring').getBoundingClientRect = () => ({ left: 300, top: 100, width: 300, height: 300 });
  s.send(button, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 750, clientY: 550 });
  s.send(button, 'pointermove', { pointerId: 2, clientX: 550, clientY: 250 });
  s.send(button, 'pointerup', { pointerId: 2 });
  assert.equal(s.paintball.weapon.id, 'automatic', 'right sector wins over the up-left motion from the button');
  s.send(button, 'pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 750, clientY: 550 });
  s.send(button, 'pointermove', { pointerId: 3, clientX: 450, clientY: 150 });
  s.send(button, 'pointermove', { pointerId: 3, clientX: 450, clientY: 250 });
  s.send(button, 'pointerup', { pointerId: 3 });
  assert.equal(s.paintball.weapon.id, 'automatic', 'returning to visible center preserves the equipped weapon');
}));

test('pointer cancellation and keyboard button releases preserve the selected weapon at the center', () => setup(s => {
  const button = s.element('btn-weapon');
  s.send(button, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 300 });
  s.send(button, 'pointermove', { pointerId: 1, clientX: 200, clientY: 300 });
  s.send(button, 'pointercancel', { pointerId: 1 }); assert.equal(s.paintball.weapon.id, 'pistol');
  s.send(button, 'keydown', { code: 'Space', repeat: false }); assert.equal(s.wheel.open, true);
  s.send(window, 'keyup', { code: 'Space' }); s.send(button, 'click', { detail: 0 });
  assert.equal(s.wheel.open, false); assert.equal(s.paintball.weapon.id, 'pistol');
}));

test('three slots and free fists appear in the held wheel; pickup identifies the replaced slot', () => setup(s => {
  assert.equal(s.wheel.open, false);
  assert.equal(s.element('weapon-wheel-options').children.length, 0);
  s.key('KeyQ');
  assert.deepEqual(s.element('weapon-wheel-options').children.map(option => option.children[1].textContent), ['Glock-18', 'AK-47', 'Faca', 'Socos']);
  assert.ok(s.element('weapon-wheel-options').children.every(option => option.children.length === 2), 'only SVG and weapon name');
  s.send(window, 'keyup', { code: 'KeyQ' }); assert.equal(s.element('weapon-wheel').hidden, true);
  s.game.weaponPickups.nearby = { id: 4, weaponId: 'shotgun', label: 'Nova' };
  s.paintball.setWeapon('automatic'); s.systems.forEach(fn => fn());
  assert.equal(s.element('btn-pickup').hidden, false); assert.match(s.element('pickup-detail').textContent, /Slot 2.*AK-47/);
  s.game.weaponPickups.nearby = { id: 5, weaponId: 'axe', label: 'Machado' }; s.systems.forEach(fn => fn());
  assert.match(s.element('pickup-detail').textContent, /Slot 3.*Faca/);
  s.game.weaponPickups.nearby = { id: 5, weaponId: 'shotgun', label: 'Nova' }; s.systems.forEach(fn => fn());
  assert.equal(s.element('pickup-label').textContent, 'Pegar Nova', 'swapped ground copies update even with the same record ID');
  s.key('KeyQ'); s.key('KeyE'); assert.equal(s.pickups, 0, 'pickup is blocked during wheel selection');
  s.wheel.cancel(); s.player.fly = true; s.key('KeyE'); assert.equal(s.pickups, 0, 'E remains ascent while flying');
  s.player.fly = false; s.key('KeyE'); assert.equal(s.pickups, 1);
}));
