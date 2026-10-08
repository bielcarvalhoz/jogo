import test from 'node:test';
import assert from 'node:assert/strict';
import {pointInPolygon} from '../../src/shared/geo.js';
import {createRegionTest} from '../../src/shared/regions.js';

test('indexed exclusions retain exact circle/polygon boundaries and holes across cell edges', () => {
  const regions = [{rings: [[[0,0],[60,0],[60,60],[0,60]],[[20,20],[40,20],[40,40],[20,40]]]}, {x:-30,z:-30,radius:12}, {rings:[[[-70,30],[-10,30],[-40,65]]]}];
  const indexed=createRegionTest(regions);
  const native=(x,z)=>regions.some(r=>r.rings?pointInPolygon(x,z,r.rings):Math.hypot(x-r.x,z-r.z)<r.radius);
  for(let x=-100;x<=100;x+=2)for(let z=-100;z<=100;z+=2)assert.equal(indexed(x,z),native(x,z),`${x},${z}`);
  assert.equal(indexed(30,30),false);assert.equal(indexed(-18,-30),false);
});
