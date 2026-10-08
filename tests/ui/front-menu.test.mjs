import test from 'node:test';
import assert from 'node:assert/strict';

// Small DOM fixture to reproduce navigation timing without starting a WebGL scene.
class Element extends EventTarget {
  constructor() {
    super(); this.hidden = false; this.style = {}; this.attrs = {};
    const classes = new Set();
    this.classList = { add: (...ns) => ns.forEach(n => classes.add(n)), remove: (...ns) => ns.forEach(n => classes.delete(n)), contains: n => classes.has(n), toggle: (n, force = !classes.has(n)) => force ? classes.add(n) : classes.delete(n) };
    this.child = {style: {}};
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  querySelector() { return this.child; }
}

test('touch navigation waits for click so the release cannot select a newly revealed tour marker', async () => {
  const originals = Object.fromEntries(['window', 'document', 'matchMedia', 'setTimeout'].map(k => [k, globalThis[k]]));
  const els = new Map(), el = id => { if (!els.has(id)) els.set(id, new Element()); return els.get(id); };
  const body = new Element(), bar = new Element(), label = new Element();
  globalThis.window = new EventTarget(); globalThis.matchMedia = () => ({matches: false});
  globalThis.setTimeout = () => 0;
  globalThis.document = {body, getElementById: el, querySelector: () => el('options'), querySelectorAll: s => s === '[data-load-progress]' ? [bar] : [label]};
  try {
    const {createFrontMenu} = await import('../../src/ui/front-menu.js');
    const menu = createFrontMenu(), modes = [];
    const send = type => { const e = new Event(type); Object.assign(e, {pointerType: 'touch', detail: 1}); el('tour').dispatchEvent(e); };
    send('pointerdown'); send('pointerup');
    assert.equal(el('overlay').classList.contains('hidden'), false, 'menu must remain until compatibility click');
    send('click'); assert.equal(el('overlay').classList.contains('hidden'), true);
    el('loading-back').dispatchEvent(new Event('click')); // cancel selection while scene is loading
    menu.ready({ui: {startMode: (mode, touch) => modes.push({mode, touch})}});
    assert.deepEqual(modes, []);
    send('pointerdown'); send('pointerup'); assert.deepEqual(modes, []);
    send('click'); assert.deepEqual(modes, [{mode: 'tour', touch: true}]);
    assert.equal(bar.attrs['aria-valuenow'], 100); assert.equal(label.textContent, '100%'); assert.equal(bar.child.style.transform, 'scaleX(1)');
  } finally {
    for (const [k, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; }
  }
});
