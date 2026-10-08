import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { exteriorEdges, pairedEntrances } from './campus-reference.js';
import { triangleHeightAt } from './road-geometry.js';
import { createWaterMaterial } from './nature.js';
import { SpatialGrid, ringArea } from './geo.js';

// Civil/architectural surfaces use the same triangles for rendering and walking.
function assembly(name, terrain) {
  const root = new THREE.Group(); root.name = name;
  const parts = new Map(), floors = [], exclusions = [];
  const add = (color, geo) => { if (!parts.has(color)) parts.set(color, []); parts.get(color).push(geo); };
  const box = (color, x,y,z,w,h,d,yaw=0) => {
    const geo = new THREE.BoxGeometry(w,h,d); geo.rotateY(yaw); geo.translate(x,y,z); add(color,geo);
  };
  const rail = (a,b,r=.035,color='#505c60') => {
    const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),delta=bv.clone().sub(av);
    const geo=new THREE.CylinderGeometry(r,r,delta.length(),6);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    geo.translate(...av.add(bv).multiplyScalar(.5).toArray()); add(color,geo);
  };
  const slab = (color, ring, top, base, walk=true) => {
    const triangles=THREE.ShapeUtils.triangulateShape(ring.map(p=>new THREE.Vector2(...p)),[]),pos=[];
    for (const [i,j,k] of triangles) {
      const tri=[ring[i],ring[j],ring[k]].map(p=>[p[0],top,p[1]]);
      if (new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(new THREE.Vector3(...tri[1]),new THREE.Vector3(...tri[0])),new THREE.Vector3().subVectors(new THREE.Vector3(...tri[2]),new THREE.Vector3(...tri[0]))).y < 0) [tri[1],tri[2]]=[tri[2],tri[1]];
      pos.push(...tri.flat()); if(walk) floors.push(tri);
    }
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      const tri=[[a[0],base,a[1]],[b[0],top,b[1]],[a[0],top,a[1]],[a[0],base,a[1]],[b[0],base,b[1]],[b[0],top,b[1]]];
      if(ringArea(ring)>0){[tri[1],tri[2]]=[tri[2],tri[1]];[tri[4],tri[5]]=[tri[5],tri[4]];}
      pos.push(...tri.flat());
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.computeVertexNormals();add(color,geo);
  };
  const finish = () => {
    for(const [color,geometries] of parts){
      const mesh=new THREE.Mesh(mergeGeometries(geometries.map(g=>{const n=g.index?g.toNonIndexed():g;n.deleteAttribute('uv');return n;}),false),new THREE.MeshStandardMaterial({color,roughness:.82}));
      mesh.castShadow=mesh.receiveShadow=true; root.add(mesh);
    }
    const grid=new SpatialGrid(12);
    for(const t of floors)grid.insertBox(t,Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[2])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[2])));
    return {root,floors,exclusions,surfaceHeightAt:(x,z,maxY=Infinity)=>{
      let best=-Infinity;for(const t of grid.query(x,z,.001)){const y=triangleHeightAt(x,z,...t);if(y!==null && y!==undefined && y<=maxY)best=Math.max(best,y);}return best;
    }};
  };
  return {root,add,box,rail,slab,finish,exclusions,H:(x,z)=>terrain.heightAt(x,z)};
}

export function buildBlueForecourt(b, info, e, {terrain,quality='high'}) {
  const A=assembly('praca-escadarias-predio-azul',terrain),{root,box,rail,slab,H,add}=A;
  const at=(u,v)=>[e.x+e.dx*u+e.nx*v,e.z+e.dz*u+e.nz*v];
  const rect=(u0,u1,v0,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(p=>at(...p));
  const width=Math.min(22,e.L-2), depth=Math.min(12.4,e.clearance-1.5);
  const bottom=H(...at(0,depth))+.15, entry=Math.max(info.gMin+.45,bottom+.68);
  const centerV=Math.min(7.2,depth-4.2), radius=2.3, inner=3.0,outer=4.6;
  slab('#b7b2a6',rect(-width/2,width/2,.05,depth),bottom,bottom-.32);
  const rear=[[ -width/2,.05],[width/2,.05],[width/2,centerV],[outer,centerV]];
  for(let j=1;j<=12;j++){const t=-Math.PI/4*j/12;rear.push([Math.cos(t)*outer,centerV+Math.sin(t)*outer]);}
  rear.push([inner*Math.SQRT1_2,centerV-inner*Math.SQRT1_2],[-inner*Math.SQRT1_2,centerV-inner*Math.SQRT1_2],[-outer*Math.SQRT1_2,centerV-outer*Math.SQRT1_2]);
  for(let j=1;j<=12;j++){const t=Math.PI*1.25-Math.PI/4*j/12;rear.push([Math.cos(t)*outer,centerV+Math.sin(t)*outer]);}
  rear.push([-width/2,centerV]);
  slab('#a19e97',rear.map(p=>at(...p)),entry,Math.min(bottom,info.gMin)-.2);
  // Broad forecourt paving joints, kept away from the fountain and stair treads.
  for(let u=-width/2+1.8;u<width/2;u+=1.8){const [x,z]=at(u,depth-1.3);box('#8f918b',x,bottom+.008,z,.016,.012,2.5,Math.atan2(-e.dz,e.dx));}
  const count=Math.max(4,Math.ceil((entry-bottom)/.17));
  const paths=[];
  for(const side of [-1,1]) {
    const path=[];
    for(let k=0;k<count;k++){
      const t0=Math.PI/2-side*k*Math.PI*.75/count,t1=Math.PI/2-side*(k+1)*Math.PI*.75/count;
      const top=bottom+(k+1)/count*(entry-bottom),ring=[];
      for(let j=0;j<=3;j++){const t=t0+(t1-t0)*j/3;ring.push(at(Math.cos(t)*outer,centerV+Math.sin(t)*outer));}
      for(let j=3;j>=0;j--){const t=t0+(t1-t0)*j/3;ring.push(at(Math.cos(t)*inner,centerV+Math.sin(t)*inner));}
      slab('#969c9e',ring,top,bottom-.12);
      const tm=(t0+t1)/2,p=at(Math.cos(tm)*(inner+outer)/2,centerV+Math.sin(tm)*(inner+outer)/2);
      path.push({x:p[0],z:p[1],y:top});
      const ends=[t0,t1].map(t=>at(Math.cos(t)*outer,centerV+Math.sin(t)*outer));
      rail([ends[0][0],top+.94,ends[0][1]],[ends[1][0],top+.94,ends[1][1]]);
      rail([ends[0][0],top,ends[0][1]],[ends[0][0],top+.97,ends[0][1]],.025);
    }
    paths.push(path);
  }
  // Landing continues behind the fountain, to the recessed glazed entrance.
  const yaw=Math.atan2(-e.dz,e.dx),door=at(0,.15),canopy=at(0,1.9);
  box('#294952',door[0],entry+1.5,door[1],5.2,3,.18,yaw);
  for(const u of [-2.6,0,2.6]){const p=at(u,.27);box('#9ca3a2',p[0],entry+1.5,p[1],.08,3,.12,yaw);}
  box('#596063',canopy[0],entry+3.3,canopy[1],width-.8,.26,3.8,yaw);
  for(const u of [-width/2+1,width/2-1]){const p=at(u,3.1);box('#b67c73',p[0],entry+1.5,p[1],.28,3.0,.28,yaw);}
  const [fx,fz]=at(0,centerV),fy=bottom+.20;
  const edge=new THREE.TorusGeometry(radius,.17,8,48);edge.rotateX(Math.PI/2);edge.translate(fx,fy+.13,fz);add('#ddd4bf',edge);
  const ring=Array.from({length:48},(_,i)=>[fx+Math.cos(i*Math.PI/24)*radius,fz+Math.sin(i*Math.PI/24)*radius]);
  const basin=new THREE.CircleGeometry(radius-.14,48);basin.rotateX(-Math.PI/2);basin.translate(fx,fy+.07,fz);
  const water=new THREE.Mesh(basin,createWaterMaterial([ring],{pool:true,quality}));water.name='chafariz-predio-azul';root.add(water);
  const nozzle=new THREE.CylinderGeometry(.08,.16,.38,8);nozzle.translate(fx,fy+.20,fz);add('#5a615b',nozzle);
  for(let i=0;i<5;i++){const angle=i*Math.PI*2/5;rail([fx,fy+.36,fz],[fx+Math.cos(angle)*.16,fy+.95,fz+Math.sin(angle)*.16],.022,'#b2d8d7');}
  A.exclusions.push({rings:[rect(-width/2-.7,width/2+.7,.01,depth+.5)]});
  const result=A.finish(); result.layout={frontage:e,width,depth,bottom,entry,fountain:{x:fx,z:fz,radius},paths};
  return result;
}

export function buildRedRubyBridge(specs,{terrain,world}) {
  const red=specs.find(s=>s.b.planId==='b3'),ruby=specs.find(s=>s.b.planId==='b5');
  const pair=pairedEntrances(red?.b,ruby?.b,world.roads);
  if(!pair)return null;
  const A=assembly('passarela-vermelho-rubi',terrain),{box,rail,H}=A;
  const a=pair.red,b=pair.ruby,ux=(b.x-a.x)/pair.length,uz=(b.z-a.z)/pair.length,yaw=Math.atan2(-uz,ux);
  const x=(a.x+b.x)/2,z=(a.z+b.z)/2,width=3.5;
  let streetMax=-Infinity;for(let s=0;s<=pair.length;s+=1)streetMax=Math.max(streetMax,H(a.x+ux*s,a.z+uz*s));
  const floor=Math.max(red.info.gMin+6.8,ruby.info.gMin+6.8,streetMax+6);
  box('#41484d',x,floor-.23,z,pair.length+.5,.46,width,yaw);
  box('#c8102e',x,floor+.50,z,pair.length+.55,1.0,width+.16,yaw);
  box('#c8102e',x,floor+2.7,z,pair.length+.55,.65,width+.16,yaw);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(pair.length+.4,1.37,width-.03),new THREE.MeshStandardMaterial({color:'#37616c',roughness:.23,metalness:.2,transparent:true,opacity:.70}));
  glass.name='vidros-passarela-vermelho-rubi';glass.position.set(x,floor+1.67,z);glass.rotation.y=yaw;glass.userData.keepStandard=true;A.root.add(glass);
  for(let s=0;s<=pair.length;s+=1.7){
    const px=a.x+ux*s,pz=a.z+uz*s;
    for(const side of [-1,1])box('#a5b2b4',px-uz*side*width/2,floor+1.67,pz+ux*side*width/2,.07,1.37,.07);
    rail([px-uz*width/2,floor-.49,pz+ux*width/2],[px+uz*width/2,floor-.49,pz-ux*width/2],.055,'#343b41');
  }
  const result=A.finish();result.layout={...pair,floor,clearance:floor-.49-streetMax,width};
  return result;
}

/** Flat, visible structural bases, with short stairs toward nearby parking/roads. */
export function buildCampusFoundations(C,specs,{terrain}) {
  const A=assembly('bases-e-acessos-laterais-campus',terrain),{slab,rail,H}=A;
  const stairs=[];
  for(const {b,info} of specs){
    if(b.gateBuilding||b.structure==='pergola')continue;
    let count=0;
    for(const edge of exteriorEdges(b.rings[0])){
      const segments=Math.max(1,Math.ceil(edge.L/2));
      for(let k=0;k<segments;k++){
        const a=[edge.ax+edge.dx*edge.L*k/segments,edge.az+edge.dz*edge.L*k/segments],c=[edge.ax+edge.dx*edge.L*(k+1)/segments,edge.az+edge.dz*edge.L*(k+1)/segments];
        const ring=[a,c,[c[0]+edge.nx*1.15,c[1]+edge.nz*1.15],[a[0]+edge.nx*1.15,a[1]+edge.nz*1.15]];
        if(ring.slice(2).some(p=>C.RI.clearance(...p).d<.5||!C.inRegion(...p,.1)||C.insideSolid(...p,.02)))continue;
        slab('#999a91',ring,info.gMin+.08,Math.min(...ring.map(p=>H(...p)),info.gMin)-.18);
        A.exclusions.push({rings:[ring]});
      }
      if(edge.L<12||count>=2)continue;
      const e={...edge,x:(edge.ax+edge.bx)/2,z:(edge.az+edge.bz)/2},at=(u,v)=>[e.x+e.dx*u+e.nx*v,e.z+e.dz*u+e.nz*v];
      const top=info.gMin+.08,clear=C.RI.clearance(...at(0,1.2)).d;
      if(clear<2.5)continue;
      const far=Math.min(7.5,clear+.7),bottom=H(...at(0,far))+.12,drop=top-bottom;
      if(drop<.38||drop>3.0)continue;
      const steps=Math.ceil(drop/.17),run=steps*.30;
      if(run+1.15>far+.05)continue;
      const width=1.6,foot=1.15+run;
      if([-width/2,width/2].some(u=>[1.15,foot].some(v=>{const p=at(u,v);return C.RI.clearance(...p).d<.35||!C.inRegion(...p,.1)||C.insideSolid(...p,.05);})))continue;
      for(let k=0;k<steps;k++){
        const v0=1.15+k*.30,v1=v0+.301,y=top-k/steps*drop;
        slab('#969c9e',[at(-width/2,v0),at(width/2,v0),at(width/2,v1),at(-width/2,v1)],y,Math.min(bottom,H(...at(0,v1)))-.15);
      }
      for(const s of [-1,1]){const a=at(s*width/2,1.15),b=at(s*width/2,foot);rail([a[0],top+.95,a[1]],[b[0],bottom+.95,b[1]]);for(let k=0;k<=3;k++){const t=k/3,p=at(s*width/2,1.15+t*run),y=top-t*drop;rail([p[0],y,p[1]],[p[0],y+.95,p[1]]);}}
      stairs.push({building:b.name,x:e.x,z:e.z,steps,drop});count++;
      A.exclusions.push({rings:[[at(-1,1),at(1,1),at(1,foot+.3),at(-1,foot+.3)]]});
    }
  }
  const result=A.finish();result.stairs=stairs;return result;
}
