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
  removeAttribute(k) { delete this.attrs[k]; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  querySelector() { return this.child; }
}

test('game modes wait for readiness; settings are usable and restart requires confirmation', async () => {
  const originals = Object.fromEntries(['window', 'document', 'matchMedia', 'setTimeout', 'location', 'localStorage'].map(k => [k, globalThis[k]]));
  const els = new Map(), el = id => { if (!els.has(id)) els.set(id, new Element()); return els.get(id); };
  const body = new Element(), bar = new Element(), label = new Element();
  globalThis.window = new EventTarget(); globalThis.matchMedia = () => ({matches: false});
  globalThis.setTimeout = () => 0;
  let reloads = 0; const saved = [];
  globalThis.location = {reload: () => reloads++};
  globalThis.localStorage = {getItem: () => null, setItem: (key, value) => saved.push(JSON.parse(value))};
  globalThis.document = {body, getElementById: el, querySelector: () => el('options'), querySelectorAll: s => s === '[data-load-progress]' ? [bar] : [label]};
  try {
    const {createFrontMenu} = await import('../../src/ui/front-menu.js');
    const menu = createFrontMenu(), modes = [];
    const send = type => { const e = new Event(type); Object.assign(e, {pointerType: 'touch', detail: 1}); el('tour').dispatchEvent(e); };
    assert.equal(el('play').disabled,true); assert.equal(el('tour').disabled,true);
    assert.notEqual(el('settings-open').disabled,true);
    send('click'); assert.equal(el('overlay').classList.contains('hidden'),false);
    el('settings-open').dispatchEvent(new Event('click'));
    assert.equal(el('settings-panel').classList.contains('hidden'),false);
    el('graphics').value='low';
    el('music').checked=false; el('music').dispatchEvent(new Event('change'));
    assert.equal(reloads,0);
    assert.deepEqual(saved,[{quality:'med',surroundings:'off',music:false,effects:true}], 'audio saves without applying pending graphics');
    assert.equal(menu.audio.preferences.music,false); saved.length=0;
    el('settings-apply').dispatchEvent(new Event('click'));
    assert.equal(el('settings-restart').open,true); assert.equal(reloads,0); assert.deepEqual(saved,[]);
    assert.match(el('restart-description').textContent,/interrompe/);
    el('settings-cancel-restart').dispatchEvent(new Event('click'));
    assert.equal(el('settings-restart').open,false); assert.equal(reloads,0); assert.deepEqual(saved,[]);
    el('settings-back').dispatchEvent(new Event('click'));
    send('pointerdown'); send('pointerup');
    assert.equal(el('overlay').classList.contains('hidden'), false, 'menu must remain until compatibility click');
    send('click'); assert.equal(el('overlay').classList.contains('hidden'), false);
    menu.ready({ui: {startMode: (mode, touch) => modes.push({mode, touch})}});
    assert.equal(el('play').disabled,false); assert.equal(el('tour').disabled,false);
    assert.deepEqual(modes, []);
    send('pointerdown'); send('pointerup'); assert.deepEqual(modes, []);
    send('click'); assert.deepEqual(modes, [{mode: 'tour', touch: true}]);
    assert.equal(bar.attrs['aria-valuenow'], 100); assert.equal(label.textContent, '100%'); assert.equal(bar.child.style.transform, 'scaleX(1)');
    el('settings-apply').dispatchEvent(new Event('click'));
    assert.match(el('restart-description').textContent,/voltará ao menu/);
    el('settings-confirm-restart').dispatchEvent(new Event('click'));
    assert.equal(reloads,1); assert.deepEqual(saved,[{quality:'low',surroundings:'off',music:false,effects:true}]);
  } finally {
    for (const [k, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; }
  }
});
