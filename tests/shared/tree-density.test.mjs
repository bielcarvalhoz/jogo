import test from 'node:test';
import assert from 'node:assert/strict';
import {halveTrees} from '../../src/shared/tree-density.js';

test('halving is deterministic, keeps both street sides and protects monkey trees', () => {
  const trees=Array.from({length:120},(_,i)=>({x:Math.floor(i/2)*11,z:i%2?6:-6}));
  const protectedTrees=new Set(trees.slice(100,105));
  const reduced=halveTrees(trees,protectedTrees);
  assert.equal(reduced.length,60);assert.deepEqual(halveTrees(trees,protectedTrees),reduced);
  assert.ok(reduced.filter(t=>t.z<0).length>=20);assert.ok(reduced.filter(t=>t.z>0).length>=20);
  for(const tree of protectedTrees)assert.ok(reduced.includes(tree));
  assert.equal(halveTrees(trees.slice(0,11)).length,6);assert.deepEqual(halveTrees([]),[]);
});
