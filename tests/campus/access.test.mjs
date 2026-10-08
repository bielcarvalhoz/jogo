import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createProjection,openRing,pointInPolygon,distToSegment} from '../../src/shared/geo.js';
import {parseWorld} from '../../src/map/world.js';
import {pairedEntrances,referenceEntrance,exteriorEdges,rectifyReferenceFootprint} from '../../src/campus/reference.js';
import {buildBlueForecourt,buildRedRubyBridge,buildCampusFoundations} from '../../src/campus/access.js';

const geo=JSON.parse(fs.readFileSync(new URL('../../public/data/cidade-de-deus.geojson',import.meta.url)));
const plans=JSON.parse(fs.readFileSync(new URL('../../public/data/campus-cidade-de-deus.geojson',import.meta.url)));
const proj=createProjection(-46.77,-23.55),world=parseWorld(geo,proj);
const quarter=world.quarter;
for(const r of world.roads)r.internal=r.highway==='service'&&pointInPolygon(...r.pts[Math.floor(r.pts.length/2)],quarter);
const buildings=plans.features.filter(f=>f.properties.kind==='building').map(f=>rectifyReferenceFootprint({...f.properties,rings:f.geometry.coordinates.map(r=>openRing(r.map(p=>proj.toLocal(...p))))}));
const byId=id=>buildings.find(b=>b.planId===id);

test('photographed Red, Ruby and Blue retain their location with four straight orthogonal facades',()=>{
  for(const id of ['b3','b5','b17']){
    const b=byId(id),edges=exteriorEdges(b.rings[0]);
    assert.equal(edges.length,4);
    for(let i=0;i<4;i++)assert.ok(Math.abs(edges[i].dx*edges[(i+1)%4].dx+edges[i].dz*edges[(i+1)%4].dz)<1e-8);
    assert.ok(Math.abs(edges[0].L-edges[2].L)<1e-6&&Math.abs(edges[1].L-edges[3].L)<1e-6);
    const original=plans.features.find(f=>f.properties.planId===id || f.properties.id===id);
    assert.ok(original);
    for(const p of original.geometry.coordinates[0].slice(0,-1).map(p=>proj.toLocal(...p)))assert.ok(pointInPolygon(...p,b.rings)||Math.min(...edges.map(e=>distToSegment(...p,e.ax,e.az,e.bx,e.bz).d))<1e-5,'roof trace stays inside the straight envelope');
  }
});

test('real Red/Ruby bridge joins opposing facades across their shared street and clears pedestrian space',()=>{
  const red=byId('b3'),ruby=byId('b5'),pair=pairedEntrances(red,ruby,world.roads);
  assert.ok(pair.length>16&&pair.length<28,`actual gap ${pair.length}`);
  assert.ok(pair.red.nx*pair.ruby.nx+pair.red.nz*pair.ruby.nz<-.999);
  for(const [b,e] of [[red,pair.red],[ruby,pair.ruby]]){
    assert.ok(Math.min(...exteriorEdges(b.rings[0]).map(s=>distToSegment(e.x,e.z,s.ax,s.az,s.bx,s.bz).d))<1e-6);
    assert.ok(!pointInPolygon(e.x+e.nx*.3,e.z+e.nz*.3,b.rings),'door faces the passage');
  }
  assert.ok(world.roads.some(r=>r.internal&&r.pts.slice(1).some((p,i)=>distToSegment((pair.red.x+pair.ruby.x)/2,(pair.red.z+pair.ruby.z)/2,...r.pts[i],...p).d<r.w/2+1)));
  const bridge=buildRedRubyBridge([{b:red,info:{gMin:2}},{b:ruby,info:{gMin:4}}],{terrain:{heightAt:()=>3},world});
  assert.ok(bridge.layout.clearance>=6);
  assert.equal(bridge.surfaceHeightAt((pair.red.x+pair.ruby.x)/2,(pair.red.z+pair.ruby.z)/2),-Infinity,'a pedestrian below the bridge is never lifted onto it');
  assert.ok(bridge.root.getObjectByName('vidros-passarela-vermelho-rubi'));
});

test('Blue northeast forecourt has two continuous rising stair routes around the fountain to the rear landing',()=>{
  const b=byId('b17'),e=referenceEntrance(b,world.roads);
  assert.ok(e.clearance>14&&e.nz<-.8,'broad photographed setback replaces cramped southwest entrance');
  const plaza=buildBlueForecourt(b,{gMin:4},e,{terrain:{heightAt:()=>3},quality:'low'});
  assert.equal(plaza.layout.paths.length,2);
  assert.ok(plaza.layout.depth>=12&&plaza.layout.width>=20);
  for(const path of plaza.layout.paths){
    let previous=plaza.layout.bottom;
    for(const p of path){
      assert.ok(p.y-previous<=.170001&&p.y>=previous);
      assert.ok(Math.hypot(p.x-plaza.layout.fountain.x,p.z-plaza.layout.fountain.z)>3,'stairs never cross the fountain');
      assert.ok(Math.abs(plaza.surfaceHeightAt(p.x,p.z)-p.y)<1e-6,'walking height is the visible tread');
      assert.equal(plaza.surfaceHeightAt(p.x,p.z,2.9),-Infinity);
      previous=p.y;
    }
    assert.ok(Math.abs(previous-plaza.layout.entry)<1e-6);
  }
  const rear=[e.x+e.nx*1.5,e.z+e.nz*1.5];
  assert.ok(Math.abs(plaza.surfaceHeightAt(...rear)-plaza.layout.entry)<1e-6);
  assert.ok(plaza.root.getObjectByName('chafariz-predio-azul'));
  plaza.root.traverse(o=>{if(o.isMesh)assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});
});

test('retaining bases expose a flat apron and short side stairs with safe risers and coherent supports',()=>{
  const b={name:'Prédio em encosta',rings:[[[0,0],[20,0],[20,12],[0,12]]]};
  const C={inRegion:()=>true,insideSolid:()=>false,RI:{clearance:()=>({d:12})}};
  const foundations=buildCampusFoundations(C,[{b,info:{gMin:1.36}}],{terrain:{heightAt:()=>0}});
  assert.ok(foundations.stairs.length>=1);
  assert.ok(foundations.stairs.every(s=>s.drop/s.steps<=.17));
  assert.ok(Math.abs(foundations.surfaceHeightAt(10,-.5)-1.44)<1e-6);
  assert.equal(foundations.surfaceHeightAt(10,-.5,1),-Infinity);
  for(const tri of foundations.floors){
    const x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[2],0)/3;
    assert.ok(foundations.surfaceHeightAt(x,z)>=tri[0][1]-1e-6,'no missing walking support on retaining slab or stair');
  }
});
