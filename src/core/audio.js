import { createRecordedAudio } from './recorded-audio.js';
import { normalizeVolume, VOLUME_KEYS } from './settings.js';

export const MUSIC_TRACKS = Object.freeze({
  menu: 'audio/portal2/music/mainmenu/portal2_background01.mp3',
  training: 'audio/portal2/music/sp_a2_bts1_b1.mp3',
});

/** Recorded music and gameplay audio; short synthesized UI tones. */
export function createAudio({ music = true, effects = true, masterVolume = 1, musicVolume = 1, effectsVolume = 1, base = '/', fetcher = globalThis.fetch, contextFactory = () => {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  return Audio ? new Audio({ latencyHint: 'interactive' }) : null;
} } = {}) {
  let recordings = null;
  let context = null, master, musicBus, effectsBus, musicVoice = null;
  let menu = true, mode = null, unlocked = false, disposed = false, hidden = false;
  const voices = new Set(), musicBuffers = new Map(), musicRequests = new Map();
  const preferences = { music, effects, masterVolume: normalizeVolume(masterVolume), musicVolume: normalizeVolume(musicVolume), effectsVolume: normalizeVolume(effectsVolume) };
  const retire = item => { voices.delete(item); item.source.onended = null; item.source.disconnect(); item.gain.disconnect(); item.filter?.disconnect(); };
  const stopVoice = item => { try { item.source.stop(); } catch { /* already ended */ } retire(item); };
  function voice(source, duration, volume, bus, when = context.currentTime, filter = null) {
    const active = [...voices].filter(v => v.bus === bus);
    if (active.length >= (bus === musicBus ? 32 : 12)) stopVoice(active[0]);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(volume, when + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    if (filter) { source.connect(filter); filter.connect(gain); } else source.connect(gain);
    gain.connect(bus);
    const item = {source, gain, filter, bus}; voices.add(item);
    source.onended = () => retire(item);
    source.start(when); source.stop(when + duration + .01);
  }
  const note = (frequency, duration, volume, bus, when, type = 'triangle', endFrequency = frequency) => {
    const oscillator = context.createOscillator(); oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration);
    voice(oscillator, duration, volume, bus, when);
  };
  function stopMusic() {
    if (!musicVoice) return;
    musicVoice.source.onended = null;
    musicVoice.source.stop(); musicVoice.source.disconnect(); musicVoice.gain.disconnect(); musicVoice = null;
  }
  function loadMusic(file) {
    if (musicRequests.has(file)) return musicRequests.get(file);
    const request = (async () => {
      try {
        const response = await fetcher(`${base}${file}`); if (!response.ok) throw new Error(response.status);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!disposed) musicBuffers.set(file, buffer);
      } catch { /* Audio unavailable: leave the scene silent, without synthetic fallback. */ }
    })();
    musicRequests.set(file, request); return request;
  }
  function sync() {
    if (!context || disposed) return;
    master.gain.setTargetAtTime(.55 * preferences.masterVolume, context.currentTime, .015);
    musicBus.gain.setTargetAtTime(preferences.music ? .34 * preferences.musicVolume : 0, context.currentTime, .015);
    effectsBus.gain.setTargetAtTime(preferences.effects ? .7 * preferences.effectsVolume : 0, context.currentTime, .015);
    const track = musicAudible() ? (mode === 'training' ? 'training' : menu && !mode ? 'menu' : null) : null;
    if (musicVoice?.track !== track) stopMusic();
    if (track && !musicVoice) {
      const file = MUSIC_TRACKS[track], buffer = musicBuffers.get(file);
      if (buffer) {
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer; source.loop = true;
        gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(track === 'training' ? .16 : .35, context.currentTime + .6);
        source.connect(gain); gain.connect(musicBus); source.start(); musicVoice = { source, gain, track };
      } else if (!musicRequests.has(file)) void loadMusic(file).then(sync);
    }
    if (!musicAudible()) recordings?.setAmbience(false);
    if (!audible()) { for (const v of voices) if (v.bus === effectsBus) stopVoice(v); recordings?.stopEffects(); }
  }
  async function unlock() {
    if (disposed || hidden) return false;
    try {
      if (!context) {
        context = contextFactory(); if (!context) return false;
        master = context.createGain(); master.gain.value = .55 * preferences.masterVolume; master.connect(context.destination);
        musicBus = context.createGain(); effectsBus = context.createGain(); musicBus.connect(master); effectsBus.connect(master);
        recordings = createRecordedAudio({ context, bus: effectsBus, audible, ambienceBus: musicBus, ambienceAudible: musicAudible, base, fetcher });
        void recordings.preload();
      }
      if (context.state !== 'running') await context.resume();
      unlocked = context.state === 'running'; sync(); return unlocked;
    } catch { return false; }
  }
  const active = () => !disposed && unlocked && !hidden && preferences.masterVolume > 0 && context?.state === 'running';
  const audible = () => active() && preferences.effects && preferences.effectsVolume > 0;
  const musicAudible = () => active() && preferences.music && preferences.musicVolume > 0;
  let lastUi = -Infinity;
  return {
    unlock,
    setPreferences(next) {
      for (const key of ['music','effects']) if (typeof next[key] === 'boolean') preferences[key] = next[key];
      for (const key of VOLUME_KEYS) if (key in next) preferences[key] = normalizeVolume(next[key], preferences[key]);
      sync();
    },
    setMenu(value) { menu = !!value; sync(); },
    setMode(value) { mode = value; sync(); },
    async setHidden(value) { hidden = !!value; sync(); if (hidden) { for (const v of voices) stopVoice(v); recordings?.stopAll(); } if (context) { if (hidden) await context.suspend().catch(()=>{}); else if (unlocked) await unlock(); } },
    ui(kind = 'select') {
      if (!audible() || context.currentTime - lastUi < .045) return;
      lastUi = context.currentTime; const now = context.currentTime;
      const base = kind === 'back' ? 260 : kind === 'start' ? 440 : 660;
      note(base,.085,.13,effectsBus,now,'triangle',kind === 'back' ? 180 : base*1.15);
      if (kind === 'start' || kind === 'confirm') note(base*1.5,.14,.085,effectsBus,now+.035,'sine');
    },
    notification(position) {
      if (!audible() || !position) return;
      const panner = context.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = 1; panner.rolloffFactor = 1.8; panner.maxDistance = 10000;
      for (const axis of ['x', 'y', 'z']) panner[`position${axis.toUpperCase()}`].value = position[axis];
      const tone = context.createOscillator(); tone.type = 'sine';
      tone.frequency.setValueAtTime(620, context.currentTime); tone.frequency.setTargetAtTime(880, context.currentTime + .06, .02);
      voice(tone, .18, .12, effectsBus, context.currentTime, panner);
    },
    async preload() { if (context) { await Promise.all([recordings?.preload(), ...Object.values(MUSIC_TRACKS).map(loadMusic)]); sync(); } },
    setListener(...args) { recordings?.setListener(...args); },
    setAmbience(value) { recordings?.setAmbience(value); },
    shot(...args) { recordings?.shot(...args); },
    footstep(...args) { recordings?.footstep(...args); },
    jump(...args) { recordings?.jump(...args); },
    land(...args) { recordings?.land(...args); },
    melee(...args) { recordings?.melee(...args); },
    impact(...args) { recordings?.impact(...args); },
    hit(...args) { recordings?.hit(...args); },
    whiz(...args) { return recordings?.whiz(...args) || false; },
    reload(...args) { recordings?.reload(...args); },
    stopReload(...args) { recordings?.stopReload(...args); },
    get preferences() { return {...preferences}; },
    get state() { return { unlocked, running: context?.state === 'running', musicPlaying: !!musicVoice, musicTrack: musicVoice?.track || null, voices: voices.size + (recordings?.state.voices || 0) + (musicVoice ? 1 : 0), recordings: recordings?.state }; },
    dispose() { if (disposed) return; disposed = true; recordings?.dispose(); stopMusic(); for (const v of voices) stopVoice(v); context?.close().catch(()=>{}); },
  };
}
