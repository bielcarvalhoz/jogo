import test from 'node:test';
import assert from 'node:assert/strict';
import { startIntro } from '../../src/ui/intro.js';

function environment({ reduced = false } = {}) {
  const keys = ['document','matchMedia','Image','requestAnimationFrame','setTimeout','clearTimeout'];
  const originals = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const classes = new Set(), frames = [], timers = new Map(), skip = new EventTarget();
  const body = { classList: { add: (...ns) => ns.forEach(n => classes.add(n)), remove: (...ns) => ns.forEach(n => classes.delete(n)) } };
  let readyArtwork, readyFont, id = 0;
  const artwork = new Promise(resolve => { readyArtwork = resolve; });
  const font = new Promise(resolve => { readyFont = resolve; });
  globalThis.document = {body, getElementById:()=>skip, baseURI:'https://example.test/', fonts:{load:()=>font}};
  globalThis.matchMedia = () => ({matches:reduced});
  globalThis.Image = class { decode() { return artwork; } };
  globalThis.requestAnimationFrame = callback => { frames.push(callback); };
  globalThis.setTimeout = (callback, delay) => { timers.set(++id, {callback,delay}); return id; };
  globalThis.clearTimeout = key => timers.delete(key);
  return {classes,frames,timers,skip,readyArtwork,readyFont,
    restore() { for(const [key,value] of Object.entries(originals)) { if(value===undefined)delete globalThis[key];else globalThis[key]=value; } }};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('heavy loading barrier waits for assets, complete intro and a presented final frame', async () => {
  const e=environment();try {
    const intro=startIntro();let released=false;intro.finished.then(()=>released=true);
    assert.ok(e.classes.has('intro-pending'));assert.equal(e.timers.size,0);
    e.readyArtwork();await flush();assert.ok(e.classes.has('intro-pending'),'font must be ready too');
    e.readyFont();await flush();assert.ok(e.classes.has('intro-pending'));
    e.frames.shift()();e.frames.shift()();assert.ok(e.classes.has('intro-playing'));
    const timer=[...e.timers.values()][0];assert.equal(timer.delay,6200);
    timer.callback();await flush();assert.equal(released,false);assert.equal(e.skip.hidden,true);
    assert.equal(e.classes.has('intro-playing'),false);
    e.frames.shift()();await flush();assert.equal(released,false,'first frame has not painted yet');
    e.frames.shift()();await flush();assert.equal(released,true);
  } finally { e.restore(); }
});
test('skipping during image download releases loading once and cannot restart the intro later', async () => {
  const e=environment();try {
    const intro=startIntro();e.skip.dispatchEvent(new Event('click'));intro.finish();
    assert.equal(e.frames.length,1);e.frames.shift()();e.frames.shift()();await intro.finished;
    e.readyArtwork();e.readyFont();await flush();e.frames.shift()();e.frames.shift()();
    assert.equal(e.classes.size,0);assert.equal(e.timers.size,0);
  } finally { e.restore(); }
});
test('reduced motion bypasses the animation without waiting for artwork or a timer', async () => {
  const e=environment({reduced:true});try {
    const intro=startIntro();assert.equal(e.classes.size,0);assert.equal(e.timers.size,0);
    e.frames.shift()();e.frames.shift()();await intro.finished;assert.equal(e.skip.hidden,true);
  } finally { e.restore(); }
});
