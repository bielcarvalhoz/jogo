import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPaintballModule} from '../../src/gameplay/paintball/index.js';
import {createEvents} from '../../src/core/events.js';

test('right/left mouse button chords aim and fire independently, ignoring touch compatibility mouse events', () => {
  const originals=Object.fromEntries(['window','document'].map(k=>[k,globalThis[k]]));
  globalThis.window=new EventTarget();
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)){
      const el=new EventTarget();el.style={};el.classList={toggle(){}};el.setAttribute=()=>{};el.replaceChildren=()=>{};el.appendChild=()=>{};elements.set(id,el);
    }
    return elements.get(id);
  };
  const canvas=new EventTarget();
  globalThis.document=Object.assign(new EventTarget(),{getElementById:element,createElement:()=>({}),body:element('body'),pointerLockElement:canvas});
  let focused=false,system;const bindings=new Map(),shotAudio=[];
  const player={active:true,touchMode:false,events:new EventTarget(),bindFireButton(){},setFocusedAim:value=>focused=value};
  const game={engine:{scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(70),renderer:{domElement:canvas},addSystem:fn=>system=fn},player,debug:{},events:createEvents(),input:{bind:(code,handler)=>bindings.set(code,handler)},audio:{shot:(weapon,options)=>shotAudio.push({weapon,options})},toast(){}};
  try {
    const paint=createPaintballModule(game);paint.setWeapon('automatic');
    const send=(target,type,button)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{button,clientX:100,clientY:100});target.dispatchEvent(event);};
    send(canvas,'mousedown',2);assert.equal(paint.aiming,true);assert.equal(focused,true);
    send(canvas,'mousedown',0);assert.equal(paint.firing,true);
    for(let i=0;i<20;i++)system(.05);assert.ok(paint.stats.shots>1);
    assert.equal(shotAudio.length,paint.stats.shots);assert.ok(shotAudio.every(shot=>shot.options.local===true),'player gunfire always uses direct playback');
    send(window,'mouseup',0);assert.equal(paint.firing,false);assert.equal(paint.aiming,true);
    send(window,'mouseup',2);assert.equal(paint.aiming,false);assert.equal(focused,false);
    send(canvas,'mousedown',0);game.ui={weaponWheelOpen:true};game.events.emit('weaponwheel',true);
    const wheelShots=paint.stats.shots;assert.equal(paint.firing,false);
    send(canvas,'mousedown',0);send(canvas,'mousedown',2);for(let i=0;i<20;i++)system(.05);
    assert.equal(paint.stats.shots,wheelShots,'wheel blocks mouse attacks and cancels the previous hold');assert.equal(paint.aiming,false);
    game.ui.weaponWheelOpen=false;game.events.emit('weaponwheel',false);send(window,'mouseup',0);
    system(.1);assert.equal(paint.stats.shots,wheelShots,'release after closing the wheel never fires');
    document.pointerLockElement=null;send(canvas,'mousedown',0);assert.equal(paint.firing,true,'automatic hold also works without pointer lock');
    send(window,'mouseup',0);assert.equal(paint.firing,false);
    bindings.get('KeyZ')();assert.equal(paint.holstered,true);assert.equal(paint.weapon.id,'automatic');
    send(canvas,'mousedown',0);bindings.get('KeyZ')();system(.1);
    assert.equal(paint.holstered,false);assert.equal(paint.firing,false,'equipping never resumes a stale pointer hold');
    game.ui.mapOpen=true;bindings.get('KeyZ')();assert.equal(paint.holstered,false,'map blocks the holster shortcut');game.ui.mapOpen=false;
    const color=paint.colorIndex;bindings.get('KeyV')();assert.notEqual(paint.colorIndex,color);
    assert.equal(bindings.has('KeyC'),false,'paint leaves C available for crouching');
    send(element('btn-holster'),'click',0);assert.equal(paint.holstered,true);
    send(element('btn-holster'),'click',0);assert.equal(paint.holstered,false);
    const shots=paint.stats.shots;player.touchMode=true;
    send(canvas,'mousedown',2);send(canvas,'mousedown',0);system(.1);
    assert.equal(paint.stats.shots,shots);assert.equal(paint.aiming,false);
    player.touchMode=false;send(canvas,'mousedown',0);player.active=false;player.events.dispatchEvent(new Event('unlock'));
    assert.equal(paint.firing,false);assert.equal(game.engine.camera.fov,70);paint.dispose();
  } finally {for(const[k,v]of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
