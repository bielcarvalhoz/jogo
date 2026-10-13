import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudio} from '../../src/core/audio.js';

function fixture(preferences={}) {
  const parameter = () => ({value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;}});
  const sources=[], panners=[], gains=[];
  const node=()=>({gain:parameter(),frequency:parameter(),Q:parameter(),playbackRate:parameter(),connect(){},disconnect(){},start(t){this.startTime=t;},stop(t){this.stopTime=t;}});
  const context={state:'suspended',currentTime:0,sampleRate:44100,destination:{},createGain(){const n=node();gains.push(n);return n;},
    createOscillator(){const n=node();sources.push(n);return n;},createBufferSource(){const n=node();sources.push(n);return n;},createBiquadFilter:node,
    createPanner(){const n={...node(),positionX:parameter(),positionY:parameter(),positionZ:parameter()};panners.push(n);return n;},
    createBuffer:(_,length)=>({getChannelData:()=>new Float32Array(length)}),
    async decodeAudioData(file){return {duration:.25,file};},async resume(){this.state='running';},async suspend(){this.state='suspended';},async close(){this.state='closed';}};
  let creations=0;
  const audio=createAudio({...preferences,fetcher:async file=>({ok:true,arrayBuffer:async()=>file}),contextFactory:()=>{creations++;return context;}});
  return {audio,context,sources,panners,gains,get creations(){return creations;}};
}

test('audio remains lazy until gesture unlock and reuses one context',async()=>{
  const f=fixture();f.audio.ui();f.audio.shot();assert.equal(f.creations,0);
  await f.audio.unlock();await f.audio.preload();assert.equal(f.creations,1);assert.equal(f.audio.state.musicPlaying,true);
  await f.audio.unlock();await f.audio.preload();assert.equal(f.creations,1);
  f.audio.setMenu(false);assert.equal(f.audio.state.musicPlaying,false);assert.equal(f.audio.state.voices,0);
  f.audio.shot();assert.equal(f.audio.state.voices,1);
  f.audio.dispose();assert.equal(f.audio.state.voices,0);assert.equal(f.context.state,'closed');
});

test('reaction chime uses the world position, HRTF and continuous distance attenuation', async () => {
  const f = fixture({ music: false }); await f.audio.unlock();
  f.audio.notification({ x: -8, y: 2, z: 4 });
  const p = f.panners.at(-1); assert.equal(p.panningModel, 'HRTF'); assert.equal(p.distanceModel, 'inverse');
  assert.equal(p.positionX.value, -8); assert.equal(p.positionY.value, 2); assert.equal(p.positionZ.value, 4);
  assert.ok(p.rolloffFactor > 1 && p.maxDistance > 100); assert.equal(f.audio.state.voices, 1);
  f.audio.setPreferences({ effects: false }); const count = f.panners.length; f.audio.notification({ x: 0, y: 2, z: 0 }); assert.equal(f.panners.length, count);
  f.audio.dispose(); assert.equal(f.audio.state.voices, 0);
});
test('music and effects are independent; muted shots allocate no sources',async()=>{
  const f=fixture({music:false});await f.audio.unlock();await f.audio.preload();assert.equal(f.audio.state.musicPlaying,false);
  f.audio.ui();assert.ok(f.sources.length>0);f.audio.setPreferences({effects:false});
  const count=f.sources.length;f.audio.shot('automatic');f.audio.ui();assert.equal(f.sources.length,count);
  f.audio.setPreferences({music:true});assert.ok(f.audio.state.musicPlaying);assert.ok(f.sources.length>count);
  f.audio.setPreferences({music:false});assert.equal(f.audio.state.voices,0);f.audio.dispose();
});
test('rapid shots have bounded voices and natural completion releases nodes',async()=>{
  const f=fixture({music:false});await f.audio.unlock();await f.audio.preload();
  for(let i=0;i<100;i++)f.audio.shot('automatic');
  assert.equal(f.audio.state.voices,32);
  for(const source of f.sources) source.onended?.();
  assert.equal(f.audio.state.voices,0);f.audio.dispose();
});
test('backgrounding stops sounds and returning starts one recorded music loop without accumulated beats',async()=>{
  const f=fixture();await f.audio.unlock();await f.audio.preload();f.audio.shot();
  await f.audio.setHidden(true);assert.equal(f.audio.state.voices,0);assert.equal(f.context.state,'suspended');assert.equal(f.audio.state.musicPlaying,false);
  f.context.currentTime=100;await f.audio.setHidden(false);assert.equal(f.context.state,'running');
  assert.equal(f.audio.state.voices,1);assert.equal(f.audio.state.musicTrack,'menu');f.audio.dispose();
});

test('master, music/ambience and effects volumes are independent and music follows the mode',async()=>{
  const f=fixture();await f.audio.unlock();await f.audio.preload();
  f.audio.setPreferences({masterVolume:.5,musicVolume:.4,effectsVolume:.2});
  assert.equal(f.gains[0].gain.value,.55*.5);assert.equal(f.gains[1].gain.value,.34*.4);assert.equal(f.gains[2].gain.value,.7*.2);
  assert.match(f.sources.find(s=>s.loop).buffer.file,/portal2_background01/);
  f.audio.setMenu(false);f.audio.setMode('training');assert.equal(f.audio.state.musicTrack,'training');
  assert.match(f.sources.at(-1).buffer.file,/sp_a2_bts1_b1/);
  f.audio.setPreferences({effectsVolume:0});assert.equal(f.audio.state.musicTrack,'training');
  const count=f.sources.length;f.audio.shot('pistol',{local:true});assert.equal(f.sources.length,count);
  f.audio.setPreferences({musicVolume:0});assert.equal(f.audio.state.musicPlaying,false);
  f.audio.setMode('campaign');f.audio.setPreferences({musicVolume:1});assert.equal(f.audio.state.musicPlaying,false);
  f.audio.setMode(null);f.audio.setMenu(true);assert.equal(f.audio.state.musicTrack,'menu');
  f.audio.dispose();
});
test('unsupported audio is a harmless fallback',async()=>{
  const audio=createAudio({contextFactory:()=>null});assert.equal(await audio.unlock(),false);
  audio.ui();audio.shot();audio.setPreferences({effects:false});await audio.setHidden(true);audio.dispose();
});

test('movement and melee effects obey mute and keep voice allocations bounded', async () => {
  const f = fixture({ music: false }); await f.audio.unlock();await f.audio.preload();
  f.audio.footstep('grass', { speed: 2 }); f.audio.footstep('concrete', { speed: 8 });
  f.audio.jump('grass'); f.audio.land('concrete', 7); f.audio.melee({ id: 'fists' }); f.audio.impact('wood', 12);
  assert.ok(f.sources.length >= 6); assert.ok(f.audio.state.voices <= 32);
  f.audio.setPreferences({ effects: false }); const count = f.sources.length;
  f.audio.footstep(); f.audio.jump(); f.audio.land(); f.audio.melee(); f.audio.impact();
  assert.equal(f.sources.length, count); assert.equal(f.audio.state.voices, 0); f.audio.dispose();
});
