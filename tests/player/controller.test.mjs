import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPlayer} from '../../src/player/controller.js';

test('mobile movement stays analog, sprints at full forward, slows/focuses for aim and can jump', () => {
  const originals=Object.fromEntries(['window','document','innerWidth','innerHeight'].map(k=>[k,globalThis[k]]));
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();globalThis.innerWidth=390;globalThis.innerHeight=844;
  try {
    const dom=new EventTarget();dom.ownerDocument=document;dom.getBoundingClientRect=()=>({left:0,width:390});
    const camera=new THREE.PerspectiveCamera(70),player=createPlayer(camera,dom,{terrain:{heightAt:()=>0},bounds:{x0:-100,x1:100,z0:-100,z1:100},collide:(x,z)=>[x,z],bridgeHeightAt:()=>-Infinity,roofAt:()=>-Infinity});
    const send=(type,id,x,y)=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerType:'touch',pointerId:id,clientX:x,clientY:y});dom.dispatchEvent(e);};
    player.placeAt(0,0);player.start(true);player.update(.016);
    send('pointerdown',1,60,600);send('pointermove',1,60,574);player.update(.05);const analog=Math.abs(player.feet.z);
    player.placeAt(0,0);send('pointermove',1,60,548);player.update(.05);const sprint=Math.abs(player.feet.z);assert.ok(sprint>analog*2);
    player.placeAt(0,0);player.setFocusedAim(true);player.update(.05);const aimed=Math.abs(player.feet.z);assert.ok(aimed<sprint/2);
    send('pointerup',1,60,548);send('pointerdown',2,280,400);const yaw=player.yaw;
    send('pointermove',2,300,400);const focusedTurn=player.yaw-yaw;player.setFocusedAim(false);
    send('pointermove',2,320,400);const regularTurn=player.yaw-yaw-focusedTurn;assert.ok(Math.abs(focusedTurn/regularTurn-.52)<1e-8);
    assert.equal(player.jump(),true);player.update(.05);assert.ok(player.feet.y>0);assert.equal(player.jump(),false);
    player.stop();assert.equal(player.active,false);
  } finally {for(const[k,v]of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
