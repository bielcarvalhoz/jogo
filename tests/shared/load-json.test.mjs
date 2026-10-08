import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJSON} from '../../src/shared/load-json.js';

test('downloads the body during the opening, but parsing waits for its presentation barrier',async()=>{
  const original=globalThis.fetch;let finishIntro,downloaded=false;
  const beforeParse=new Promise(resolve=>finishIntro=resolve);
  globalThis.fetch=async()=>({ok:true,text:async()=>{downloaded=true;return '{invalid';}});
  try {
    let settled=false;const load=loadJSON('/terrain.json',{beforeParse});
    const failure=assert.rejects(load,SyntaxError).then(()=>settled=true);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(downloaded,true);assert.equal(settled,false);
    finishIntro();await failure;assert.equal(settled,true);
  }finally{globalThis.fetch=original;}
});
test('required HTTP errors are reported while optional campus files can fail safely',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:404});
  try{await assert.rejects(loadJSON('/map.json'),/HTTP 404/);assert.equal(await loadJSON('/campus.json',{optional:true}),null);}
  finally{globalThis.fetch=original;}
});
test('ordinary callers without an intro barrier still receive parsed JSON',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,text:async()=>'{"height":42}'});
  try{assert.deepEqual(await loadJSON('/terrain.json'),{height:42});}
  finally{globalThis.fetch=original;}
});
