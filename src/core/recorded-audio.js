const portal = file => `audio/portal2/${file}.wav`;
const variations = (folder, name, count = 2) => Array.from({ length: count }, (_, i) => portal(`${folder}/${name}${i + 1}`));
export const FOOTSTEPS = Object.freeze({
  concrete: Array.from({ length: 4 }, (_, i) => `audio/foley/concrete${i + 1}.wav`),
  dirt: Array.from({ length: 4 }, (_, i) => `audio/foley/dirt${i + 1}.wav`),
  grass: variations('player/footsteps', 'grass', 4),
});
const shotFile = id => `audio/snakef8/${id === 'pistol' ? 'pistol-clean.wav' : `${id}.mp3`}`;
export const SHOT_PROFILES = Object.freeze({
  pistol: { volume: .27, rate: 1.04, attack: .0015 }, automatic: { volume: .24, rate: 1.25 },
  revolver: { volume: .31, rate: .93 }, shotgun: { volume: .34, rate: 1.05 },
  sniper: { volume: .32, rate: .88 }, smg: { volume: .19, rate: 1.35 },
});
const IMPACTS = {
  concrete: variations('physics/concrete', 'concrete_impact_bullet'), wood: variations('physics/wood', 'wood_box_impact_bullet'),
  metal: variations('physics/metal', 'metal_box_impact_bullet'), dirt: variations('physics/surfaces', 'sand_impact_bullet'),
  grass: variations('physics/surfaces', 'sand_impact_bullet'), flesh: variations('physics/flesh', 'flesh_impact_bullet'),
  punch: variations('physics/flesh', 'flesh_impact_hard'),
};
const PAINT_HITS = ['01', '02'].map(id => portal(`physics/paint/paint_blob_splat_${id}`));
const WHOOSH = portal('physics/nearmiss/whoosh_large4');
const WIND = portal('ambient/levels/forest/treewind1'), INSECTS = portal('ambient/nature/insects/amb_insects_lp_01'), BIRDS = portal('ambient/levels/forest/dist_birds1');
export const RECORDED_SOUNDS = Object.freeze([...new Set([
  ...Object.values(FOOTSTEPS).flat(), ...Object.values(IMPACTS).flat(), ...PAINT_HITS, WHOOSH, WIND, INSECTS, BIRDS,
  ...Object.keys(SHOT_PROFILES).flatMap(id => [shotFile(id), `audio/snakef8/reload-${id}.mp3`]),
])]);

export function impactSurface(hit) {
  if (hit.surface) return hit.surface;
  if (hit.entity) return 'flesh';
  for (let object = hit.object; object; object = object.parent) {
    if (object.userData?.crate) return object.userData.crate.type;
    if (object.userData?.audioSurface) return object.userData.audioSurface;
  }
  if (hit.object?.material?.metalness > .5) return 'metal';
  return /terrain|ground|grama|chao|grass/i.test(hit.object?.name || '') ? 'dirt' : 'concrete';
}

/** Recorded foley with native HRTF and continuous inverse-distance attenuation.
 * No generated footstep/weapon fallback. */
export function createRecordedAudio({ context, bus, audible, base = '/', fetcher = globalThis.fetch, random = Math.random }) {
  const buffers = new Map(), requests = new Map(), failed = new Set(), voices = new Set(), lastVariants = new Map();
  const listener = { x: 0, y: 0, z: 0 };
  const recentPaintHits = [];
  let disposed = false, ambience = false, birdsAt = 0, lastWhiz = -Infinity;
  async function load(file) {
    if (buffers.has(file)) return buffers.get(file);
    if (requests.has(file)) return requests.get(file);
    const request = (async () => {
      try {
        const response = await fetcher(`${base}${file}`); if (!response.ok) throw new Error(response.status);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!disposed) buffers.set(file, buffer); return buffer;
      } catch { failed.add(file); return null; }
    })();
    requests.set(file, request); return request;
  }
  const preload = () => Promise.all(RECORDED_SOUNDS.map(load));
  function retire(item) {
    if (!voices.delete(item)) return;
    item.source.onended = null;
    for (const node of [item.source, item.gain, item.panner]) node?.disconnect();
  }
  function stop(item, fade = 0) {
    if (fade) { item.gain.gain.cancelScheduledValues(context.currentTime); item.gain.gain.setTargetAtTime(0, context.currentTime, fade / 4); }
    try { item.source.stop(context.currentTime + fade); } catch { /* finished */ }
    if (!fade) retire(item);
  }
  function spatial(item) {
    if (!item.position || !item.panner) return;
    const p = typeof item.position === 'function' ? item.position() : item.position;
    if (!p) return;
    const t = context.currentTime;
    for (const [axis, value] of Object.entries(p)) if (['x', 'y', 'z'].includes(axis)) item.panner[`position${axis.toUpperCase()}`].setTargetAtTime(value, t, .02);
  }
  function play(file, { position, volume = .2, rate = 1, attack = .008, release = .055, loop = false, duration, tag, when = context.currentTime } = {}) {
    if (disposed || !audible()) return null;
    const buffer = buffers.get(file); if (!buffer) return null;
    if (voices.size >= 32) stop([...voices].find(item => !item.loop) || voices.values().next().value);
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = loop; source.playbackRate.value = rate;
    source.connect(gain);
    const panner = position && context.createPanner ? context.createPanner() : null;
    if (panner) {
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 3; panner.rolloffFactor = 1.15; panner.maxDistance = 10000;
      gain.connect(panner); panner.connect(bus);
    } else gain.connect(bus);
    const length = duration || buffer.duration / rate;
    if (loop || attack) { gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(volume, when + (loop ? .4 : attack)); }
    else gain.gain.setValueAtTime(volume, when);
    if (!loop && release) { gain.gain.setValueAtTime(volume, when + Math.max(.009, length - release)); gain.gain.linearRampToValueAtTime(0, when + length); }
    const item = { source, gain, panner, position, tag, loop }; voices.add(item); spatial(item);
    source.onended = () => retire(item); source.start(when);
    if (!loop) source.stop(when + length + .01);
    return item;
  }
  function variant(files) {
    const previous = lastVariants.get(files), options = files.filter(file => file !== previous);
    const selected = options[Math.floor(random() * options.length)] || files[0]; lastVariants.set(files, selected); return selected;
  }
  const footstep = (surface = 'concrete', options = {}) => play(variant(FOOTSTEPS[surface] || FOOTSTEPS.concrete), {
    volume: Math.min(.24, .10 + (options.speed || 3) * .012), rate: .96 + random() * .08,
    ...(surface === 'grass' ? {} : { attack: .001 }), ...options,
  });
  function setListener(position, forward = { x: 0, y: 0, z: -1 }, up = { x: 0, y: 1, z: 0 }) {
    Object.assign(listener, position); const l = context.listener, t = context.currentTime;
    if (l?.positionX) for (const axis of ['x', 'y', 'z']) {
      const suffix = axis.toUpperCase(); l[`position${suffix}`].setTargetAtTime(position[axis], t, .015);
      l[`forward${suffix}`].setTargetAtTime(forward[axis], t, .015); l[`up${suffix}`].setTargetAtTime(up[axis], t, .015);
    } else { l?.setPosition?.(position.x, position.y, position.z); l?.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z); }
    for (const item of voices) spatial(item);
  }
  function setAmbience(value) {
    ambience = !!value;
    if (!ambience || !audible()) { for (const item of voices) if (item.tag === 'ambience' && !item.stopping) { item.stopping = true; stop(item, .4); } return; }
    for (const [file, volume] of [[WIND, .10], [INSECTS, .045]]) if (![...voices].some(item => item.source.buffer === buffers.get(file) && !item.stopping)) play(file, { volume, loop: true, tag: 'ambience' });
    if (context.currentTime >= birdsAt) {
      play(BIRDS, { position: { x: listener.x + 15, y: listener.y + 5, z: listener.z - 12 }, volume: .17, tag: 'ambience' });
      birdsAt = context.currentTime + 7 + random() * 9;
    }
  }
  function stopReload(tag = 'reload') { for (const item of voices) if (item.tag === tag) stop(item); }
  return {
    preload, setListener, setAmbience, footstep, stopReload,
    shot(weapon = 'pistol', { local = false, ...options } = {}) {
      const id = weapon.id || weapon;
      // Own gunfire must match the recording even in third person: the muzzle
      // relative to the chase camera must never colour or pitch-shift the shot.
      return play(shotFile(id), { ...SHOT_PROFILES[id], ...options, ...(local ? { position: undefined, rate: 1, attack: 0, release: 0 } : {}) });
    },
    reload(weapon, { duration = 2.3, position, tag = 'reload' } = {}) {
      stopReload(tag); const id = weapon.id || weapon, file = `audio/snakef8/reload-${id}.mp3`, buffer = buffers.get(file);
      if (!buffer) return;
      if (weapon.reloadStyle === 'shell') for (let at = 0; at < duration - .01; at += weapon.reloadDuration) play(file, { position, volume: .16, rate: buffer.duration / weapon.reloadDuration, duration: weapon.reloadDuration, when: context.currentTime + at, tag });
      else play(file, { position, volume: .16, rate: buffer.duration / duration, duration, tag });
    },
    jump(surface, position) { footstep(surface, { position, volume: .1, rate: 1.14 }); },
    land(surface, speed = 4, position) { footstep(surface, { position, volume: Math.min(.33, .12 + Math.abs(speed) * .018), rate: .88 }); },
    melee(weapon = {}, options = {}) { play(WHOOSH, { volume: weapon.id === 'fists' ? .10 : .15, rate: weapon.id === 'axe' ? 1.2 : weapon.id === 'bat' ? 1.5 : 1.9, duration: .18, ...options }); },
    impact(surface = 'wood', impulse = 6, options = {}) { play(variant(IMPACTS[surface] || IMPACTS.concrete), { volume: Math.min(.3, .10 + impulse * .007), ...options }); },
    hit(hit, info = {}) {
      if (info.kind === 'firearm') {
        const now = context.currentTime, point = hit.point, surface = impactSurface(hit);
        // Several shotgun pellets can hit one patch in the same frame. Keep
        // damage/paint events intact, but avoid stacking nine impact recordings.
        while (recentPaintHits.length && now - recentPaintHits[0].time >= .05) recentPaintHits.shift();
        if (point && recentPaintHits.some(previous => previous.surface === surface && Math.hypot(point.x - previous.point.x, point.y - previous.point.y, point.z - previous.point.z) < 1.5)) return;
        if (point) {
          if (recentPaintHits.length >= 32) recentPaintHits.shift();
          recentPaintHits.push({ time: now, surface, point: { x: point.x, y: point.y, z: point.z } });
        }
        if (surface === 'metal') play(variant(IMPACTS.metal), { position: point, volume: .045, attack: 0, release: 0 });
        play(variant(PAINT_HITS), { position: point, volume: .07, attack: 0, release: 0 });
        return;
      }
      const surface = impactSurface(hit), files = surface === 'flesh' ? IMPACTS.punch : IMPACTS[surface] || IMPACTS.concrete;
      play(variant(files), { position: hit.point, volume: .25 });
    },
    whiz(from, to) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, lengthSq = dx * dx + dy * dy + dz * dz;
      if (lengthSq < .001 || context.currentTime - lastWhiz < .12) return false;
      const fraction = Math.max(0, Math.min(1, ((listener.x - from.x) * dx + (listener.y - from.y) * dy + (listener.z - from.z) * dz) / lengthSq));
      const point = { x: from.x + dx * fraction, y: from.y + dy * fraction, z: from.z + dz * fraction };
      const distance = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);
      if (distance > 3 || Math.hypot(from.x - listener.x, from.y - listener.y, from.z - listener.z) < 1) return false;
      const item = play(WHOOSH, { position: point, volume: .12 * (1 - distance / 3), duration: .22, rate: 1.7 });
      if (item) lastWhiz = context.currentTime; return !!item;
    },
    stopAll() { for (const item of voices) stop(item); recentPaintHits.length = 0; },
    get state() { return { voices: voices.size, loaded: buffers.size, failed: [...failed], ambience }; },
    dispose() { disposed = true; for (const item of voices) stop(item); buffers.clear(); },
  };
}
