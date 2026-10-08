import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudio} from '../../src/core/audio.js';

function fixture(preferences={}) {
  const parameter = () => ({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}});
  const sources=[];
  const node=()=>({gain:parameter(),frequency:parameter(),Q:parameter(),connect(){},disconnect(){},start(t){this.startTime=t;},stop(t){this.stopTime=t;}});
  const context={state:'suspended',currentTime:0,sampleRate:44100,destination:{},createGain:node,
    createOscillator(){const n=node();sources.push(n);return n;},createBufferSource(){const n=node();sources.push(n);return n;},createBiquadFilter:node,
    createBuffer:(_,length)=>({getChannelData:()=>new Float32Array(length)}),
    async resume(){this.state='running';},async suspend(){this.state='suspended';},async close(){this.state='closed';}};
  let creations=0, tick=null;
  const audio=createAudio({...preferences,contextFactory:()=>{creations++;return context;},schedule:fn=>{tick=fn;return 1;},unschedule:()=>{tick=null;}});
  return {audio,context,sources,get creations(){return creations;},get tick(){return tick;}};
}

test('audio remains lazy until gesture unlock and reuses one context',async()=>{
  const f=fixture();f.audio.ui();f.audio.shot();assert.equal(f.creations,0);
  await f.audio.unlock();assert.equal(f.creations,1);assert.equal(f.audio.state.musicPlaying,true);
  await f.audio.unlock();assert.equal(f.creations,1);
  f.audio.setMenu(false);assert.equal(f.tick,null);assert.equal(f.audio.state.voices,0);
  f.audio.shot();assert.equal(f.audio.state.voices,2);
  f.audio.dispose();assert.equal(f.audio.state.voices,0);assert.equal(f.context.state,'closed');
});
test('music and effects are independent; muted shots allocate no sources',async()=>{
  const f=fixture({music:false});await f.audio.unlock();assert.equal(f.tick,null);
  f.audio.ui();assert.ok(f.sources.length>0);f.audio.setPreferences({effects:false});
  const count=f.sources.length;f.audio.shot('automatic');f.audio.ui();assert.equal(f.sources.length,count);
  f.audio.setPreferences({music:true});assert.ok(f.audio.state.musicPlaying);assert.ok(f.sources.length>count);
  f.audio.setPreferences({music:false});assert.equal(f.audio.state.voices,0);f.audio.dispose();
});
test('rapid shots have bounded voices and natural completion releases nodes',async()=>{
  const f=fixture({music:false});await f.audio.unlock();
  for(let i=0;i<100;i++)f.audio.shot('automatic');
  assert.equal(f.audio.state.voices,12);
  for(const source of f.sources) source.onended?.();
  assert.equal(f.audio.state.voices,0);f.audio.dispose();
});
test('backgrounding stops sounds and stalled music skips expired beats',async()=>{
  const f=fixture();await f.audio.unlock();f.audio.shot();
  await f.audio.setHidden(true);assert.equal(f.audio.state.voices,0);assert.equal(f.context.state,'suspended');assert.equal(f.tick,null);
  f.context.currentTime=100;await f.audio.setHidden(false);assert.equal(f.context.state,'running');
  f.context.currentTime=200;const count=f.sources.length;f.tick();
  assert.ok(f.sources.length-count<12,'no accumulated beat burst');
  assert.ok(f.sources.slice(count).every(s=>s.startTime>=200));f.audio.dispose();
});
test('unsupported audio is a harmless fallback',async()=>{
  const audio=createAudio({contextFactory:()=>null});assert.equal(await audio.unlock(),false);
  audio.ui();audio.shot();audio.setPreferences({effects:false});await audio.setHidden(true);audio.dispose();
});
