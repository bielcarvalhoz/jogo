import { ringArea, distToSegment } from './geo.js';

// Características observadas nas fotos fornecidas pelo usuário. As plantas continuam
// georreferenciadas; detalhes sem levantamento métrico usam dimensões aproximadas.
export const FACADE_PROFILES = {
  b1: { type: 'framed', frame: '#414951', color: '#bfc5c9', sign: '#88939b' },
  b6: { type: 'silver', frame: '#bbc3c8', color: '#e8e9e5', sign: '#b9c2c7' },
  b3: { type: 'recessed', frame: '#aeb5bc', color: '#e5e8e9', sign: '#c8102e' },
  b5: { type: 'recessed', frame: '#b6babe', color: '#eeeae4', sign: '#8c2638' },
  b21: { type: 'framed', frame: '#424b55', color: '#eee0ae', sign: '#e4bd49' },
  b17: { type: 'louver', frame: '#e3dbd2', color: '#f1e5d9', sign: '#2879b6' },
  b0: { type: 'metal', frame: '#737e87', color: '#e5e8e8', sign: '#8e9da8' },
};

export function facadeProfile(building) {
  return FACADE_PROFILES[building.planId] || {
    type: building.style === 'pavilion' ? 'pavilion' : building.style === 'school' ? 'school' : building.style === 'garage' ? 'garage' : 'office',
    frame: '#737c82', color: building.wall || '#e9e8e3', sign: building.accentColor || '#c8102e',
  };
}

export function exteriorEdges(ring) {
  const sign = Math.sign(ringArea(ring)) || 1;
  return ring.flatMap(([ax, az], i) => {
    const [bx, bz] = ring[(i + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < .1) return [];
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    return [{ ax, az, bx, bz, L, dx, dz, nx: sign * dz, nz: -sign * dx }];
  });
}

export function frontageEdges(ring) {
  let simplified = ring.slice();
  for (let pass = 0; pass < 3 && simplified.length > 3; pass++) {
    const next = simplified.filter((b, i) => {
      const a = simplified[(i - 1 + simplified.length) % simplified.length], c = simplified[(i + 1) % simplified.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], length = Math.hypot(dx, dz);
      const t = ((b[0] - a[0]) * dx + (b[1] - a[1]) * dz) / Math.max(length * length, .001);
      return t <= 0 || t >= 1 || Math.abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / Math.max(length, .001) > .15;
    });
    if (next.length < 3 || next.length === simplified.length) break;
    simplified = next;
  }
  return exteriorEdges(simplified);
}

/** Chooses a real frontage facing a nearby internal street, including concave plans. */
export function referenceEntrance(building, roads, allowed = () => true) {
  let best = null, score = Infinity;
  const edges = frontageEdges(building.rings[0]), longest = Math.max(...edges.map(e => e.L));
  for (const edge of edges) {
    if (edge.L < 7) continue;
    const x = (edge.ax + edge.bx) / 2, z = (edge.az + edge.bz) / 2;
    if (!allowed(x + edge.nx * 3, z + edge.nz * 3)) continue;
    for (const road of roads) {
      if (!road.internal || road.kind === 'foot' || road.bridge) continue;
      for (let i = 1; i < road.pts.length; i++) {
        const q = distToSegment(x, z, ...road.pts[i - 1], ...road.pts[i]);
        const facing = ((q.cx - x) * edge.nx + (q.cz - z) * edge.nz) / Math.max(q.d, .01);
        const clearance = q.d - road.w / 2;
        if (facing < .65 || clearance < 4 || clearance > 55) continue;
        const candidate = clearance + (1 - facing) * 16 + (1 - Math.min(1, edge.L / longest)) * 22
          + (building.planId === 'b6' ? (1 - edge.nz) * 14 : 0)
          // The Blue entrance includes a broad fountain forecourt, which cannot
          // fit on the narrow southwest pavement. Prefer its northeast frontage.
          + (building.planId === 'b17' ? Math.max(0, 14 - clearance) * 8 + Math.max(0, edge.nz) * 25 : 0);
        if (candidate < score) {
          score = candidate;
          best = { ...edge, x, z, road, roadX: q.cx, roadZ: q.cz, clearance };
        }
      }
    }
  }
  return best;
}

/** Roof tracing noise must not bend the photographed straight office facades. */
export function rectifyReferenceFootprint(building) {
  if (!['b3','b5','b17'].includes(building.planId) || building.rings.length!==1) return building;
  const ring=building.rings[0];
  let best=null;
  for(const e of exteriorEdges(ring)){
    if(e.L<7)continue;
    let ux=e.dx,uz=e.dz;
    if(ux+uz<0){ux=-ux;uz=-uz;}
    const us=ring.map(p=>p[0]*ux+p[1]*uz),vs=ring.map(p=>-p[0]*uz+p[1]*ux);
    const u0=Math.min(...us),u1=Math.max(...us),v0=Math.min(...vs),v1=Math.max(...vs),area=(u1-u0)*(v1-v0);
    if(!best||area<best.area)best={ux,uz,u0,u1,v0,v1,area};
  }
  if(!best)return building;
  const {ux,uz,u0,u1,v0,v1}=best;
  const outline=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>[ux*u-uz*v,uz*u+ux*v]);
  return {...building,rings:[outline],referenceRectified:true};
}

/** The photographed bridge crosses the shared street, between opposing doors. */
export function pairedEntrances(red, ruby, roads) {
  if (!red || !ruby) return null;
  const edges = exteriorEdges(red.rings[0]);
  const axis = edges.reduce((a, e) => e.L > a.L ? e : a);
  let ux = axis.dx, uz = axis.dz;
  if (ux + uz < 0) { ux = -ux; uz = -uz; }
  const range = b => b.rings[0].map(([x, z]) => x * ux + z * uz);
  const ra = range(red), rb = range(ruby);
  const lo = Math.max(Math.min(...ra), Math.min(...rb)), hi = Math.min(Math.max(...ra), Math.max(...rb));
  if (hi - lo < 10) return null;
  const along = lo + (hi - lo) * .60;
  let nx = uz, nz = -ux;
  const mean = b => b.rings[0].reduce((s, [x,z]) => s + x * nx + z * nz, 0) / b.rings[0].length;
  if (mean(ruby) < mean(red)) { nx = -nx; nz = -nz; }
  const hit = (b, direction) => {
    const intersections = [];
    for (const e of exteriorEdges(b.rings[0])) {
      const a = e.ax * ux + e.az * uz, c = e.bx * ux + e.bz * uz;
      if (Math.abs(c-a) < 1e-8) continue;
      const t = (along-a)/(c-a);
      if (t >= 0 && t <= 1) intersections.push({x:e.ax+(e.bx-e.ax)*t,z:e.az+(e.bz-e.az)*t});
    }
    intersections.sort((a,b) => direction*((b.x-a.x)*nx+(b.z-a.z)*nz));
    return intersections[0];
  };
  const a = hit(red,1), b = hit(ruby,-1);
  if (!a || !b) return null;
  const length = Math.hypot(b.x-a.x,b.z-a.z);
  if (length < 8 || length > 55) return null;
  const frontage = (p,side) => {
    let nearest = null;
    for (const road of roads) {
      if (!road.internal || road.bridge || road.kind === 'foot') continue;
      for(let i=1;i<road.pts.length;i++) {
        const q=distToSegment(p.x,p.z,...road.pts[i-1],...road.pts[i]);
        if (!nearest || q.d < nearest.d) nearest={...q,road};
      }
    }
    return {...p,dx:ux,dz:uz,nx:nx*side,nz:nz*side,L:24,
      road:nearest?.road,roadX:nearest?.cx,roadZ:nearest?.cz,clearance:nearest ? nearest.d-nearest.road.w/2 : length/2-3};
  };
  return {red:frontage(a,1),ruby:frontage(b,-1),length,nx,nz};
}

/** OSM boundary barriers are superseded only where a campus wall actually exists. */
export function removeDuplicateCampusBarriers(barriers, nearWall) {
  return barriers.flatMap((barrier) => {
    if (!['wall', 'fence', 'retaining_wall'].includes(barrier.kind)) return [barrier];
    const runs = [];
    let run = [];
    for (let i = 1; i < barrier.pts.length; i++) {
      const start = barrier.pts[i - 1], end = barrier.pts[i];
      const count = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1])));
      for (let k = 0; k < count; k++) {
        const a = [start[0] + (end[0] - start[0]) * k / count, start[1] + (end[1] - start[1]) * k / count];
        const b = [start[0] + (end[0] - start[0]) * (k + 1) / count, start[1] + (end[1] - start[1]) * (k + 1) / count];
        // OSM may use one long segment for a boundary partly superseded by the
        // campus wall. Split comparison runs to preserve the unrelated remainder.
        const duplicate = [0, .5, 1].every(t => nearWall(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 1.4));
        if (duplicate) { if (run.length > 1) runs.push({ ...barrier, pts: run }); run = []; }
        else { if (!run.length) run.push(a); run.push(b); }
      }
    }
    if (run.length > 1) runs.push({ ...barrier, pts: run });
    return runs;
  });
}
