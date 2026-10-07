import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { openRing, pointInPolygon, pointInRing, ringArea, ringCentroid, SpatialGrid, distToSegment } from './geo.js';
import { createBuildingBuilder } from './buildings.js';
import { pixelRoof, helipadTexture, stripeTexture, pixelSign, labelTexture } from './textures.js';
import { makeTreeMeshes, makePalmMeshes } from './vegetation.js';
import { mulberry32 } from './rng.js';
import { campusFacade, gateSignTexture, bradescoBannerTexture, buildCampusDetails } from './campus-details.js';
import { facadeProfile, removeDuplicateCampusBarriers } from './campus-reference.js';
import { createSidewalkTrees } from './nature.js';
import { campusWallGeometry } from './campus-wall.js';

// Núcleo Cidade de Deus (matriz do Bradesco), em estilo cartoon/pixel.
// Dados: public/data/campus-cidade-de-deus.geojson (ver scripts/build-campus.mjs).
//
// prepareCampus() roda ANTES de pintar o chão: calcula em 2D o muro, as portarias, as vagas,
// os carros e as árvores, e injeta pisos (gramados, estacionamentos, pista...) no `world`.
// buildCampus() monta o 3D.

const RED = '#c8102e';
const INTERNAL_NAME = /^Rua (Um|Dois|Três|Quatro|Cinco|Seis|Sete|Oito)$/;
const CAR = { len: 4.4, wid: 1.85 };
const WALL_H = 2.6;

// ================================================================ utilidades 2D
const centroidOf = (ring) => ringCentroid([...ring, ring[0]]);
function bboxOf(ring, m = 0) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX: minX - m, minZ: minZ - m, maxX: maxX + m, maxZ: maxZ + m };
}
/** eixo principal (aresta mais longa), orientado para o "sudeste" (+x +z) */
function principalAxis(ring) {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L > best) { best = L; ux = (bx - ax) / L; uz = (bz - az) / L; }
  }
  if (ux + uz < 0) { ux = -ux; uz = -uz; }
  const [cx, cz] = centroidOf(ring);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [x, z] of ring) {
    const u = (x - cx) * ux + (z - cz) * uz, v = -(x - cx) * uz + (z - cz) * ux;
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  const at = (u, v) => [cx + ux * u - uz * v, cz + uz * u + ux * v];
  return { cx, cz, ux, uz, uMin, uMax, vMin, vMax, at, L: uMax - uMin, W: vMax - vMin };
}
const rectRing = (cx, cz, ux, uz, len, wid) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + ux * a * len / 2 - uz * b * wid / 2, cz + uz * a * len / 2 + ux * b * wid / 2]);
function obbOverlap(A, B) {
  // A, B: 4 cantos (retângulos orientados) — teste de eixos separadores
  for (const P of [A, B])
    for (let i = 0; i < 2; i++) {
      const [x1, z1] = P[i], [x2, z2] = P[i + 1];
      const nx = -(z2 - z1), nz = x2 - x1;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [x, z] of A) { const d = x * nx + z * nz; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
      for (const [x, z] of B) { const d = x * nx + z * nz; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (aMax < bMin || bMax < aMin) return false;
    }
  return true;
}
function segIntersect(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
  const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u, x: a[0] + t * (b[0] - a[0]), z: a[1] + t * (b[1] - a[1]) } : null;
}
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function bufferConvex(ring, d) {
  const [cx, cz] = centroidOf(ring);
  return ring.map(([x, z]) => { const L = Math.hypot(x - cx, z - cz) || 1; return [x + ((x - cx) / L) * d, z + ((z - cz) / L) * d]; });
}
function scaleRing(ring, k) {
  const [cx, cz] = centroidOf(ring);
  return ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
}

/** índice de segmentos de vias (para consultas de distância) */
function roadIndex(roads) {
  const grid = new SpatialGrid(24);
  for (const r of roads)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const m = r.w / 2 + 4;
      grid.insertBox({ r, ax, az, bx, bz }, Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m);
    }
  return {
    /** menor folga (distância à borda da pista) entre (x,z) e as vias */
    clearance(x, z, filter) {
      let best = Infinity, seg = null;
      for (const s of grid.query(x, z, 6)) {
        if (filter && !filter(s.r)) continue;
        const d = distToSegment(x, z, s.ax, s.az, s.bx, s.bz).d - s.r.w / 2;
        if (d < best) { best = d; seg = s; }
      }
      return { d: best, seg };
    },
    query: (x, z, r) => grid.query(x, z, r),
    /** ponto mais próximo sobre o eixo de qualquer via (até maxD) */
    nearestPoint(x, z, maxD = 30) {
      let best = null, bd = maxD;
      for (const s of grid.query(x, z, maxD)) {
        const q = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
        if (q.d < bd) { bd = q.d; best = [q.cx, q.cz]; }
      }
      return best;
    },
  };
}

// ================================================================ 1) preparar
export function prepareCampus(geo, world, proj) {
  if (!world.quarter) return null;
  const quarter = world.quarter;
  const toLocal = (ring) => openRing(ring.map(([lon, lat]) => proj.toLocal(lon, lat)));
  const inQuarter = (x, z) => pointInPolygon(x, z, quarter);
  const rnd = mulberry32(31337);
  const C = {
    quarter, buildings: [], gates: [], parkings: [], points: [], canopies: [], helideck: null, track: null,
    trees: [], palms: [], cars: [], walls: [], busStops: [], monkeys: [], floodlights: [], warnings: [],
  };

  // -- prédios do OSM dentro do campus: substituídos pela planta oficial
  world.buildings = world.buildings.filter((b) => { const [cx, cz] = centroidOf(b.rings[0]); return !inQuarter(cx, cz); });

  // -- áreas do OSM dentro do campus
  let pitch = null;
  const pools = [];
  world.areas = world.areas.filter((a) => {
    const [cx, cz] = centroidOf(a.rings[0]);
    if (!inQuarter(cx, cz)) return true;
    if (a.kind === 'water') return false; // o lago vem da planta oficial
    if (a.kind === 'pitch') {
      const area = Math.abs(ringArea(a.rings[0]));
      if (area > 3000) { pitch = a; return true; }
      a.kind = 'tennis'; // quadras de tênis ao norte do campo
      return true;
    }
    if (a.kind === 'pool') pools.push(a);
    return true;
  });
  world.areas.unshift({ id: 'cdd/campus', tags: {}, kind: 'campus', rings: quarter });

  // -- feições do campus
  for (const f of geo.features) {
    const p = f.properties, g = f.geometry;
    if (g.type === 'Polygon') {
      const rings = g.coordinates.map(toLocal).filter((r) => r.length >= 3);
      if (!rings.length) continue;
      if (p.kind === 'building') C.buildings.push({ ...p, rings });
      else if (p.kind === 'helideck') C.helideck = { ...p, rings };
      else if (p.kind === 'canopy') C.canopies.push({ ...p, rings });
      else if (p.kind === 'lake') world.areas.push({ id: 'cdd/lago', tags: { name: 'Lago' }, kind: 'water', rings, color: '#47712f', waterColor: 0x4f7a35, lake: true });
      else if (p.kind === 'lawn') world.areas.push({ id: 'cdd/gramado', tags: {}, kind: 'lawn', rings });
      else if (p.kind === 'court') world.areas.push({ id: 'cdd/quadra', tags: {}, kind: 'court', rings });
      else if (p.kind === 'parking') C.parkings.push({ ...p, rings });
      else if (p.kind === 'monkeyPark') C.monkeyPark = rings;
    } else if (g.type === 'Point') {
      const [x, z] = proj.toLocal(g.coordinates[0], g.coordinates[1]);
      if (p.kind === 'gate') C.gates.push({ ...p, x, z });
      else C.points.push({ ...p, x, z });
    } else if (g.type === 'MultiPoint' && p.kind === 'trees') {
      C.treePts = g.coordinates.map(([lon, lat]) => proj.toLocal(lon, lat));
    }
  }

  // -- pista de atletismo em volta do campo de futebol
  if (pitch) {
    C.track = makeTrack(pitch.rings[0]);
    world.areas.push({ id: 'cdd/pista', tags: {}, kind: 'track', rings: [C.track.outer], lanes: C.track.lanes });
  }
  // -- deck das piscinas (piso bege em volta)
  if (pools.length) {
    const hull = convexHull(pools.flatMap((p) => p.rings[0]));
    world.areas.push({ id: 'cdd/deck', tags: {}, kind: 'deck', rings: [bufferConvex(hull, 5)] });
  }
  for (const p of C.parkings) world.areas.push({ id: 'cdd/estacionamento', tags: {}, kind: 'parking', rings: p.rings, color: p.slab ? '#77797b' : undefined });

  // -- vias: internas (do campus) x públicas
  for (const r of world.roads) {
    if (r.kind === 'foot') continue;
    const mid = r.pts[Math.floor(r.pts.length / 2)];
    r.internal = (r.highway === 'service' || INTERNAL_NAME.test(r.name || '')) && inQuarter(mid[0], mid[1]);
  }
  const carRoads = world.roads.filter((r) => r.kind !== 'foot');
  const RI = roadIndex(carRoads);
  C.RI = RI;

  // -- obstáculos (plantas no chão) para checagens
  const solids = [];
  for (const b of C.buildings) if (b.structure !== 'pergola') solids.push({ rings: b.rings, bb: bboxOf(b.rings[0], 0.5), name: b.name });
  if (C.helideck) solids.push({ rings: C.helideck.rings, bb: bboxOf(C.helideck.rings[0], 0.5) });
  for (const pt of C.points) {
    const r = pt.kind === 'silo' ? pt.radius + 0.4 : pt.kind === 'totem' ? 3.2 : pt.kind === 'dish' ? 3 : pt.kind === 'playground' ? 6 : 1;
    const ring = Array.from({ length: 10 }, (_, i) => [pt.x + Math.cos((i / 10) * Math.PI * 2) * r, pt.z + Math.sin((i / 10) * Math.PI * 2) * r]);
    solids.push({ rings: [ring], bb: bboxOf(ring, 0.5) });
  }
  const solidGrid = new SpatialGrid(30);
  for (const s of solids) solidGrid.insertBox(s, s.bb.minX, s.bb.minZ, s.bb.maxX, s.bb.maxZ);
  const insideSolid = (x, z, m = 0) => {
    for (const s of solidGrid.query(x, z, m + 1)) {
      if (x < s.bb.minX - m || x > s.bb.maxX + m || z < s.bb.minZ - m || z > s.bb.maxZ + m) continue;
      if (pointInPolygon(x, z, s.rings)) return true;
      if (m > 0) for (const r of s.rings) for (let i = 0; i < r.length; i++) { const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length]; if (distToSegment(x, z, ax, az, bx, bz).d < m) return true; }
    }
    return false;
  };
  C.insideSolid = insideSolid;

  // -- muro + portarias
  computeWalls(C, quarter[0], carRoads, RI, insideSolid);

  // -- árvores reais (copas do satélite), sem tronco em rua, prédio, muro, água...
  const noTree = [];
  for (const a of world.areas) if (['water', 'pool', 'track', 'court', 'tennis', 'deck', 'parking', 'pitch'].includes(a.kind) && inQuarter(...centroidOf(a.rings[0]))) noTree.push(a.rings);
  const wallGrid = C.wallGrid;
  const nearWall = (x, z, d) => { for (const s of wallGrid.query(x, z, d + 1)) if (distToSegment(x, z, s[0], s[1], s[2], s[3]).d < d) return true; return false; };
  C.nearWall = nearWall;
  world.barriers = removeDuplicateCampusBarriers(world.barriers, nearWall);
  for (const [x, z] of C.treePts || []) {
    if (!inQuarter(x, z)) continue;
    if (RI.clearance(x, z).d < 1.0) continue;
    if (insideSolid(x, z, 1.4) || nearWall(x, z, 1.6)) continue;
    if (noTree.some((r) => pointInPolygon(x, z, r))) continue;
    const v = rnd();
    C.trees.push({ x, z, s: 0.95 + rnd() * 0.55, r: rnd() * Math.PI * 2, v, pink: rnd() < 0.045 });
  }
  const streetTrees = createSidewalkTrees(world.roads, {
    eligible: r => r.internal,
    existing: C.trees, spacing: 11,
    allowed: (x, z) => inQuarter(x, z) && C.inRegion(x, z, .4),
    clearance: (x, z) => !insideSolid(x, z, 2.2) && !nearWall(x, z, 1.3)
      && !noTree.some(rings => pointInPolygon(x, z, rings))
      && !C.gates.some(g => Math.hypot(g.x - x, g.z - z) < 13),
  });
  C.trees.push(...streetTrees);
  C.streetTreeCount = streetTrees.length;
  const treeGrid = new SpatialGrid(10);
  for (const t of C.trees) treeGrid.insertBox(t, t.x, t.z, t.x, t.z);

  // -- estacionamentos: vagas + carros
  const stallSegs = [];
  computeParking(C, carRoads, RI, insideSolid, nearWall, treeGrid, stallSegs, rnd);
  world.paintExtras = [{ color: 'rgba(240,240,232,0.9)', width: 0.14, segments: stallSegs }];

  // -- palmeiras ao longo do estacionamento sul (vistas nas imagens 3D)
  for (const p of C.parkings) {
    if (p.palms !== 'sul') continue;
    const ring = p.rings[0];
    // aresta mais ao sul (maior z médio)
    let best = -Infinity, ei = 0;
    for (let i = 0; i < ring.length; i++) { const zm = (ring[i][1] + ring[(i + 1) % ring.length][1]) / 2; if (zm > best) { best = zm; ei = i; } }
    const [ax, az] = ring[ei], [bx, bz] = ring[(ei + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
    const [cx, cz] = centroidOf(ring);
    let nx = -tz, nz = tx;
    if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; } // aponta para dentro
    for (let s = 4; s < L - 3; s += 9) {
      const x = ax + tx * s + nx * 1.6, z = az + tz * s + nz * 1.6;
      if (insideSolid(x, z, 1) || RI.clearance(x, z).d < 0.8 || nearWall(x, z, 0.9) || !C.inRegion(x, z, 1)) continue;
      if (C.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 2.6)) continue;
      C.palms.push({ x, z, h: 11 + rnd() * 3, r: rnd() * 6 });
    }
  }

  // -- pontos do ônibus elétrico Move (10, perto dos prédios principais)
  const stopNear = ['Prédio Prata', 'Espaço Bem Estar — Café e Serviços', 'Prédio Rubi', 'Agência Prime CdD', 'CGE — Central de Geração de Energia', 'Espaço Saúde CdD — Clínica', 'Prédio Amarelo', 'Museu Histórico Bradesco', 'Prédio Marfim', 'Prédio Azul'];
  const mainInternal = carRoads.filter((r) => r.internal && r.tags.service !== 'parking_aisle' && r.tags.service !== 'driveway');
  const RIi = roadIndex(mainInternal);
  for (const name of stopNear) {
    const b = C.buildings.find((x) => x.name === name);
    if (!b) continue;
    const [bx, bz] = centroidOf(b.rings[0]);
    let best = null, bd = Infinity;
    for (const r of mainInternal)
      for (let i = 0; i < r.pts.length - 1; i++) {
        const q = distToSegment(bx, bz, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]);
        if (q.d < bd) { bd = q.d; best = { r, i, ...q }; }
      }
    if (!best || bd > 90) continue;
    const [ax, az] = best.r.pts[best.i], [ex, ez] = best.r.pts[best.i + 1];
    const L = Math.hypot(ex - ax, ez - az) || 1, tx = (ex - ax) / L, tz = (ez - az) / L;
    let nx = -tz, nz = tx;
    if ((bx - best.cx) * nx + (bz - best.cz) * nz < 0) { nx = -nx; nz = -nz; }
    for (const off of [best.r.w / 2 + 1.8, best.r.w / 2 + 2.6]) {
      const x = best.cx + nx * off, z = best.cz + nz * off;
      if (insideSolid(x, z, 1.5) || nearWall(x, z, 1.5) || RIi.clearance(x, z).d < 0.8 || !C.inRegion(x, z, 1.5)) continue;
      if (C.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 3.5)) continue;
      C.busStops.push({ x, z, yaw: Math.atan2(-nx, -nz) + Math.PI, near: name });
      break;
    }
  }

  // -- macacos-prego no Parque dos Macacos
  const park = C.monkeyPark;
  const monkeyTrees = C.trees.filter((t) => !park || pointInPolygon(t.x, t.z, park));
  for (let i = 0; i < Math.min(16, monkeyTrees.length); i++) {
    const t = monkeyTrees[Math.floor(rnd() * monkeyTrees.length)];
    const onTree = rnd() < 0.55;
    const a = rnd() * Math.PI * 2;
    C.monkeys.push({ tree: t, onTree, x: t.x + Math.cos(a) * (onTree ? 0.7 : 1.6), z: t.z + Math.sin(a) * (onTree ? 0.7 : 1.6), yaw: rnd() * Math.PI * 2, phase: rnd() * 10 });
  }

  // -- torres de iluminação da pista
  if (C.track) {
    const T = C.track;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const u = su * T.straight * 0.8, v = sv * (T.rOut + 3.5);
      C.floodlights.push({ x: T.cx + T.ux * u - T.uz * v, z: T.cz + T.uz * u + T.ux * v, face: [T.cx, T.cz] });
    }
  }
  return C;
}

/** pista de 8 raias (400 m) em volta do campo (planta do OSM) */
function makeTrack(field) {
  const ax = principalAxis(field);
  const straight = 42.2;
  const rIn = Math.max(36.5, ax.W / 2 + 1.5);
  const oval = (r, n = 36) => {
    const pts = [];
    for (const side of [1, -1])
      for (let i = 0; i <= n; i++) {
        const t = -Math.PI / 2 + (Math.PI * i) / n;
        pts.push(ax.at(side * (straight + Math.cos(t) * r), side * Math.sin(t) * r));
      }
    return pts;
  };
  const lanes = [];
  for (let k = 0; k <= 8; k++) lanes.push(oval(rIn + k * 1.22));
  return { cx: ax.cx, cz: ax.cz, ux: ax.ux, uz: ax.uz, straight, rIn, rOut: rIn + 9.76, outer: oval(rIn + 9.76 + 0.6), lanes };
}

// ---------------------------------------------------------------- muro
// Região murada = polígono do bairro MENOS as ruas públicas com calçada (2,2 m). A região é
// rasterizada (0,5 m) e o contorno é extraído com marching squares: os laços saem sempre
// FECHADOS (inclusive dos dois lados de ruas públicas que atravessam o terreno). Depois
// abrem-se vãos só onde passam vias de acesso (portarias/portões) e portarias de pedestres.
function computeWalls(C, ring, carRoads, RI, insideSolid) {
  const SIDEWALK = 2.2, RES = 0.5;
  const isAccessType = (r) => r.highway === 'service' || r.internal || INTERNAL_NAME.test(r.name || '');
  // vias de acesso: cruzam o limite do bairro e são de serviço / internas
  for (const r of carRoads) {
    r.access = false;
    if (!isAccessType(r)) continue;
    for (let i = 0; i < r.pts.length - 1 && !r.access; i++)
      for (let e = 0; e < ring.length; e++) if (segIntersect(r.pts[i], r.pts[i + 1], ring[e], ring[(e + 1) % ring.length])) { r.access = true; break; }
  }
  const isPublic = (r) => !r.internal && !r.access;

  // 1) raster da região murada
  const bb = bboxOf(ring, 30);
  const W = Math.ceil((bb.maxX - bb.minX) / RES), H = Math.ceil((bb.maxZ - bb.minZ) / RES);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g2 = cv.getContext('2d', { willReadFrequently: true });
  const P = ([x, z]) => [(x - bb.minX) / RES, (z - bb.minZ) / RES];
  g2.fillStyle = '#000'; g2.fillRect(0, 0, W, H);
  g2.fillStyle = '#fff';
  g2.beginPath(); ring.forEach((p, i) => { const [a, b] = P(p); i ? g2.lineTo(a, b) : g2.moveTo(a, b); }); g2.closePath(); g2.fill();
  g2.lineCap = 'round'; g2.lineJoin = 'round';
  g2.strokeStyle = '#fff';
  for (const r of carRoads) {
    if (!r.internal || r.access) continue;
    g2.lineWidth = (r.w + 2 * 1.0) / RES;
    g2.beginPath(); r.pts.forEach((p, i) => { const [a, b] = P(p); i ? g2.lineTo(a, b) : g2.moveTo(a, b); }); g2.stroke();
  }
  g2.strokeStyle = '#000';
  for (const r of carRoads) {
    if (!isPublic(r)) continue;
    g2.lineWidth = (r.w + 2 * SIDEWALK) / RES;
    g2.beginPath(); r.pts.forEach((p, i) => { const [a, b] = P(p); i ? g2.lineTo(a, b) : g2.moveTo(a, b); }); g2.stroke();
  }
  const img = g2.getImageData(0, 0, W, H).data;
  const inside = (i, j) => i >= 0 && j >= 0 && i < W && j < H && img[(j * W + i) * 4] > 127;

  // 2) marching squares (amostras nos centros dos pixels; pontos nos meios das arestas)
  const segs = [];
  const key = (x2, z2) => x2 * 65536 + z2; // coordenadas em meio-pixel (inteiras)
  for (let j = -1; j < H; j++)
    for (let i = -1; i < W; i++) {
      const a = inside(i, j), b = inside(i + 1, j), c = inside(i + 1, j + 1), d = inside(i, j + 1);
      const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // meios das arestas em meio-pixels: topo, direita, base, esquerda
      const T = [2 * i + 2, 2 * j + 1], R = [2 * i + 3, 2 * j + 2], B = [2 * i + 2, 2 * j + 3], L = [2 * i + 1, 2 * j + 2];
      const add = (p, q) => segs.push([p, q]);
      switch (code) {
        case 1: add(B, L); break; case 2: add(R, B); break; case 3: add(R, L); break;
        case 4: add(T, R); break; case 5: add(T, L); add(R, B); break; case 6: add(T, B); break;
        case 7: add(T, L); break; case 8: add(L, T); break; case 9: add(B, T); break;
        case 10: add(L, B); add(R, T); break; case 11: add(R, T); break; case 12: add(L, R); break;
        case 13: add(B, R); break; case 14: add(L, B); break;
      }
    }
  // encadeia segmentos em laços
  const adj = new Map();
  segs.forEach((s, k) => { for (const p of s) { const kk = key(p[0], p[1]); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(k); } });
  const used = new Uint8Array(segs.length);
  const toWorld = ([x2, z2]) => [bb.minX + (x2 / 2) * RES, bb.minZ + (z2 / 2) * RES];
  const loops = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const pts = [segs[s0][0], segs[s0][1]];
    for (;;) {
      const last = pts[pts.length - 1];
      const nxt = (adj.get(key(last[0], last[1])) || []).find((k) => !used[k]);
      if (nxt === undefined) break;
      used[nxt] = 1;
      const [p, q] = segs[nxt];
      pts.push(p[0] === last[0] && p[1] === last[1] ? q : p);
    }
    const w = pts.map(toWorld);
    if (Math.abs(ringArea(w)) < 300) continue; // sobras pequenas (canteiros entre calçadas)
    loops.push(rdpClosed(w, 0.4));
  }

  // 3) portarias: cruzamentos das vias de acesso com os laços
  const crossings = [];
  for (const r of carRoads) {
    if (!r.access) continue;
    for (let i = 0; i < r.pts.length - 1; i++)
      for (const lp of loops)
        for (let e = 0; e < lp.length; e++) {
          const hit = segIntersect(r.pts[i], r.pts[i + 1], lp[e], lp[(e + 1) % lp.length]);
          if (hit) crossings.push({ x: hit.x, z: hit.z, r, seg: i });
        }
  }
  const gates = C.gates.map((g) => ({ ...g, crossing: null }));
  for (const cr of crossings) {
    if (gates.some((g) => g.crossing && g.crossing.r === cr.r && Math.hypot(g.crossing.x - cr.x, g.crossing.z - cr.z) < 8)) continue;
    let best = null, bd = 25;
    for (const g of gates) { if (g.type === 'pedestre' || g.crossing) continue; const d = Math.hypot(g.x - cr.x, g.z - cr.z); if (d < bd) { bd = d; best = g; } }
    if (best) best.crossing = cr;
    else gates.push({ type: 'portao', x: cr.x, z: cr.z, crossing: cr, auto: true });
  }
  for (const g of gates) {
    if (!g.crossing) continue;
    const { r, x, z } = g.crossing;
    g.segs = [];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      if (distToSegment(x, z, ax, az, bx, bz).d < 30) g.segs.push([ax, az, bx, bz]);
    }
    g.halfGap = r.w / 2 + 0.8;
  }
  C.gateList = gates;
  const cutBy = (x, z) => {
    for (const g of gates) {
      if (g.segs) {
        if (Math.hypot(x - g.crossing.x, z - g.crossing.z) > 32) continue;
        for (const [ax, az, bx, bz] of g.segs) if (distToSegment(x, z, ax, az, bx, bz).d < g.halfGap) return g;
      } else if (g.type === 'pedestre' && g.snap && Math.hypot(x - g.snap[0], z - g.snap[1]) < 1.8) return g;
    }
    return null;
  };
  // portarias de pedestres: projeta o ponto oficial no muro mais próximo
  for (const g of gates) {
    if (g.type !== 'pedestre') continue;
    let bd = 15;
    for (const lp of loops) for (let e = 0; e < lp.length; e++) {
      const [ax, az] = lp[e], [bx, bz] = lp[(e + 1) % lp.length];
      const q = distToSegment(g.x, g.z, ax, az, bx, bz);
      if (q.d < bd) { bd = q.d; g.snap = [q.cx, q.cz]; }
    }
  }

  // 4) laços -> trechos de muro, abrindo os vãos
  C.walls = [];
  C.wallGaps = [];
  for (const lp of loops) {
    const dense = [];
    for (let e = 0; e < lp.length; e++) {
      const [ax, az] = lp[e], [bx, bz] = lp[(e + 1) % lp.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let k = 0; k < n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    const cut = dense.map(([x, z]) => cutBy(x, z));
    const N = dense.length;
    const first = cut.findIndex((c) => c);
    if (first < 0) { C.walls.push(rdpOpen([...dense, dense[0]], 0.25)); continue; }
    let run = [];
    for (let k = 1; k <= N; k++) {
      const i = (first + k) % N;
      if (cut[i]) {
        if (run.length > 1) C.walls.push(rdpOpen(run, 0.25));
        run = [];
        C.wallGaps.push({ x: dense[i][0], z: dense[i][1], reason: 'gate' });
        continue;
      }
      run.push(dense[i]);
    }
    if (run.length > 1) C.walls.push(rdpOpen(run, 0.25));
  }
  C.wallGrid = new SpatialGrid(16);
  for (const w of C.walls) for (let i = 0; i < w.length - 1; i++) {
    const [ax, az] = w[i], [bx, bz] = w[i + 1];
    C.wallGrid.insertBox([ax, az, bx, bz], Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
  }

  // 5) posição de cada portaria: entre as duas pontas do muro, sobre a via de acesso
  for (const g of gates) {
    if (!g.crossing) continue;
    const ends = [];
    for (const w of C.walls) for (const e of [w[0], w[w.length - 1]]) {
      let near = Infinity;
      for (const [ax, az, bx, bz] of g.segs) near = Math.min(near, distToSegment(e[0], e[1], ax, az, bx, bz).d);
      if (near < g.halfGap + 1.5 && Math.hypot(e[0] - g.crossing.x, e[1] - g.crossing.z) < 32) ends.push(e);
    }
    let cx = g.crossing.x, cz = g.crossing.z;
    if (ends.length >= 2) {
      let best = null, bd = Infinity;
      for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
        const d = Math.hypot(ends[a][0] - ends[b][0], ends[a][1] - ends[b][1]);
        if (d > 1 && d < bd) { bd = d; best = [ends[a], ends[b]]; }
      }
      if (best) { cx = (best[0][0] + best[1][0]) / 2; cz = (best[0][1] + best[1][1]) / 2; g.ends = best; }
    }
    let bd = Infinity, proj = null;
    for (const [ax, az, bx, bz] of g.segs) {
      const q = distToSegment(cx, cz, ax, az, bx, bz);
      if (q.d < bd) { bd = q.d; const L = Math.hypot(bx - ax, bz - az) || 1; proj = { x: q.cx, z: q.cz, tx: (bx - ax) / L, tz: (bz - az) / L }; }
    }
    g.center = proj;
  }
  C.wallRegion = { bb, RES, W, H };
  /** (x,z) dentro da área murada, com folga `m` metros do muro */
  C.inRegion = (x, z, m = 0) => {
    const at = (px, pz) => inside(Math.floor((px - bb.minX) / RES), Math.floor((pz - bb.minZ) / RES));
    if (!at(x, z)) return false;
    if (m > 0) for (const [dx, dz] of [[m, 0], [-m, 0], [0, m], [0, -m], [m * 0.7, m * 0.7], [-m * 0.7, m * 0.7], [m * 0.7, -m * 0.7], [-m * 0.7, -m * 0.7]]) if (!at(x + dx, z + dz)) return false;
    return true;
  };
}

function rdpOpen(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]).d;
    if (d > best) { best = d; bi = i; }
  }
  if (best > eps) return [...rdpOpen(pts.slice(0, bi + 1), eps).slice(0, -1), ...rdpOpen(pts.slice(bi), eps)];
  return [a, b];
}
function rdpClosed(pts, eps) {
  // fecha num anel aberto (sem repetir o primeiro ponto)
  const h = Math.floor(pts.length / 2);
  const a = rdpOpen(pts.slice(0, h + 1), eps), b = rdpOpen([...pts.slice(h), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// ---------------------------------------------------------------- vagas e carros
function computeParking(C, carRoads, RI, insideSolid, nearWall, treeGrid, stallSegs, rnd) {
  const placed = [];
  const carGrid = new SpatialGrid(8);
  const palette = [['#f4f4f4', 34], ['#b9bdc2', 24], ['#1d1f22', 20], ['#6b7076', 10], ['#b3202a', 6], ['#2a4f8f', 6]];
  const pickColor = () => { let r = rnd() * 100; for (const [c, w] of palette) { if ((r -= w) <= 0) return c; } return palette[0][0]; };
  for (const P of C.parkings) {
    const ring = P.rings[0];
    const bb = bboxOf(ring);
    // corredores: vias internas cujo trecho cai dentro do estacionamento; senão, corredores sintéticos
    let aisles = [];
    for (const r of carRoads) {
      if (!r.internal) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (mx < bb.minX - 2 || mx > bb.maxX + 2 || mz < bb.minZ - 2 || mz > bb.maxZ + 2) continue;
        if (pointInPolygon(mx, mz, P.rings) || pointInPolygon(ax, az, P.rings) || pointInPolygon(bx, bz, P.rings)) aisles.push({ a: [ax, az], b: [bx, bz], hw: Math.max(2.8, r.w / 2) });
      }
    }
    if (!aisles.length) {
      const ax = principalAxis(ring);
      for (let v = ax.vMin + 7.6; v < ax.vMax - 2; v += 15.6) aisles.push({ a: ax.at(ax.uMin - 2, v), b: ax.at(ax.uMax + 2, v), hw: 3, synthetic: true });
    }
    for (const A of aisles) {
      const L = Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]);
      if (L < 2) continue;
      const tx = (A.b[0] - A.a[0]) / L, tz = (A.b[1] - A.a[1]) / L;
      for (const side of [1, -1]) {
        const nx = -tz * side, nz = tx * side;
        for (let s = 1.6; s < L - 1.2; s += 2.6) {
          const off = A.hw + CAR.len / 2 + 0.25;
          const cx = A.a[0] + tx * s + nx * off, cz = A.a[1] + tz * s + nz * off;
          // carro com o comprimento perpendicular ao corredor
          const car = rectRing(cx, cz, nx, nz, CAR.len, CAR.wid);
          const zone = rectRing(cx, cz, nx, nz, CAR.len + 0.5, CAR.wid + 0.35);
          if (!zone.every(([x, z]) => pointInPolygon(x, z, P.rings))) continue;
          const samples = [];
          for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 1) samples.push([cx + nx * a * (CAR.len / 2 + 0.2) - nz * b * (CAR.wid / 2 + 0.15), cz + nz * a * (CAR.len / 2 + 0.2) + nx * b * (CAR.wid / 2 + 0.15)]);
          if (samples.some(([x, z]) => insideSolid(x, z, 0.3))) continue;
          if (samples.some(([x, z]) => !C.inRegion(x, z, 0.4))) continue;
          if (samples.some(([x, z]) => nearWall(x, z, 0.6))) continue;
          // fora de qualquer pista (a do próprio corredor inclusive)
          if (samples.some(([x, z]) => RI.clearance(x, z).d < 0.15)) continue;
          if (A.synthetic && samples.some(([x, z]) => Math.abs((x - A.a[0]) * -tz + (z - A.a[1]) * tx) < A.hw)) continue;
          let blocked = false;
          for (const t of treeGrid.query(cx, cz, 4)) if (samples.some(([x, z]) => Math.hypot(x - t.x, z - t.z) < 1.2) || Math.hypot(cx - t.x, cz - t.z) < 2.2) { blocked = true; break; }
          if (blocked) continue;
          for (const o of carGrid.query(cx, cz, 6)) if (obbOverlap(car.concat([car[0]]), o.ring.concat([o.ring[0]]))) { blocked = true; break; }
          if (blocked) continue;
          const slot = { x: cx, z: cz, nx, nz, ring: zone };
          carGrid.insertBox(slot, cx - 3, cz - 3, cx + 3, cz + 3);
          // faixas da vaga (laterais)
          for (const sgn of [-1, 1]) {
            const ex = -nz * sgn * (CAR.wid / 2 + 0.35), ez = nx * sgn * (CAR.wid / 2 + 0.35);
            stallSegs.push([[cx + ex - nx * (CAR.len / 2 + 0.2), cz + ez - nz * (CAR.len / 2 + 0.2)], [cx + ex + nx * (CAR.len / 2 + 0.2), cz + ez + nz * (CAR.len / 2 + 0.2)]]);
          }
          if (rnd() < 0.66) placed.push({ x: cx, z: cz, yaw: Math.atan2(nx, nz) + (rnd() < 0.5 ? Math.PI : 0), color: pickColor(), ring: car });
        }
      }
    }
  }
  C.cars = placed;
}

// ================================================================ 2) construir
export function buildCampus(C, { scene, renderer, terrain, world, roads, quality = 'high' }) {
  const root = new THREE.Group();
  root.name = 'campus-cidade-de-deus';
  const rnd = mulberry32(777);
  const H = (x, z) => terrain.heightAt(x, z);

  // Caixilhos, brises e vidro das referências, agrupados por perfil.
  const styles = {};
  const styleFor = (b) => {
    const kind = b.style === 'school' ? 'school' : b.style === 'garage' ? 'garage' : b.style === 'pavilion' ? 'pavilion' : 'office';
    const profile = facadeProfile(b);
    const key = `cdd_${kind}_${profile.type}_${profile.frame}_${b.windows || '#2b3f55'}`;
    if (!styles[key]) styles[key] = { texture: campusFacade(renderer, b), bay: profile.type === 'louver' ? 3.2 : kind === 'pavilion' ? 2.4 : 3.2, floor: 3.4, mat: { roughness: 0.72, metalness: 0.03 } };
    return key;
  };
  // o mesmo objeto `styles` é preenchido sob demanda por styleFor() antes de cada add()
  const builder = createBuildingBuilder(renderer, terrain, { styles, roofTextures: { roofFlat: pixelRoof(renderer, 'flat'), roofTile: pixelRoof(renderer, 'tile') } });

  const parts = new Map();
  const addPart = (color, geom) => { if (!parts.has(color)) parts.set(color, []); parts.get(color).push(geom); };
  const box = (color, cx, cy, cz, sx, sy, sz, yaw = 0) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateY(yaw); g.translate(cx, cy, cz); addPart(color, g); };
  const cyl = (color, cx, cy, cz, r0, r1, h, seg = 12) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(cx, cy + h / 2, cz); addPart(color, g); };
  const glass = [];
  const outline = [];
  const labels = [];
  const label = (text, x, y, z, icon = '🏦') => labels.push({ text: `${icon} ${text}`, x, y, z });
  const yawOf = (dx, dz) => Math.atan2(-dz, dx); // eixo x local alinhado a (dx, dz)

  const specs = [];
  const roofShapeFor = (b) => {
    if (b.roofShape === 'hip' || b.roofShape === 'tile') return 'hip';
    return 'flat';
  };

  // ---------------------------------------------------- prédios
  for (const b of C.buildings) {
    if (b.structure === 'pergola') { buildPergola(b); continue; }
    const outer = b.rings[0];
    const style = styleFor(b);
    const info = builder.add({
      id: b.planId || b.name, rings: b.rings, height: b.height, style, floorH: b.height / (b.levels || 2),
      wall: facadeProfile(b).color, roof: b.roof, roofShape: roofShapeFor(b), noRoof: b.roofShape === 'tent',
      noParapet: b.roofShape === 'ribbed' || b.roofShape === 'green' || b.style === 'pavilion',
    });
    if (!info) continue;
    const A = principalAxis(outer);
    const vols = [{ ring: outer, groundY: info.gMin, top: info.top, rings: b.rings }];
    // volumes superiores (ex.: bloco central do Vermelho, torre do Azul)
    for (const v of b.volumes || []) {
      const u0 = A.uMin + v.from * A.L, u1 = A.uMin + v.to * A.L;
      const half = (A.W * (v.w || 1)) / 2, vc = (A.vMin + A.vMax) / 2;
      const ring = [A.at(u0, vc - half), A.at(u1, vc - half), A.at(u1, vc + half), A.at(u0, vc + half)];
      const vs = { ...b, ...v };
      const vi = builder.add({ id: (b.planId || '') + 'v', rings: [ring], groundY: info.gMin, height: v.height, minHeight: info.top - info.gMin - 0.3, style: styleFor(vs), floorH: v.height / Math.max(1, Math.round(v.height / 3.3)), wall: vs.wall, roof: vs.roof, roofShape: 'flat' });
      if (vi) vols.push({ ring, groundY: info.gMin, top: vi.top, rings: [ring], A: principalAxis(ring) });
    }
    const topVol = (k) => vols[k === undefined ? 0 : k + 1] || vols[0];

    // contorno cartoon (cantos + beiral de cada volume)
    for (const vo of vols) {
      for (const [x, z] of vo.ring) outline.push(x, Math.max(vo.groundY, H(x, z)), z, x, vo.top + 0.5, z);
      for (let i = 0; i < vo.ring.length; i++) { const [ax, az] = vo.ring[i], [bx, bz] = vo.ring[(i + 1) % vo.ring.length]; outline.push(ax, vo.top + 0.5, az, bx, vo.top + 0.5, bz); }
    }
    const edges = ringEdges(outer);
    const accent = b.accentColor || RED;

    // destaques de fachada
    if (b.accent === 'frisos') {
      for (const vo of vols) for (const e of ringEdges(vo.ring)) {
        box(accent, (e.ax + e.bx) / 2 + e.nx * 0.18, vo.top + 0.15, (e.az + e.bz) / 2 + e.nz * 0.18, e.L + 0.4, 1.1, 0.35, yawOf(e.dx, e.dz));
        box(accent, (e.ax + e.bx) / 2 + e.nx * 0.12, vo.groundY + (vo.top - vo.groundY) * 0.5, (e.az + e.bz) / 2 + e.nz * 0.12, e.L + 0.25, b.planId === 'b3' ? 1.25 : .45, 0.25, yawOf(e.dx, e.dz));
      }
    }
    if (b.accent === 'banner') {
      // banner vertical vermelho no centro da fachada sul mais longa
      const e = edges.filter((x) => x.L > A.L * 0.6).sort((p, q) => q.nz - p.nz)[0];
      if (e) {
        const mx = (e.ax + e.bx) / 2 + e.nx * 0.25, mz = (e.az + e.bz) / 2 + e.nz * 0.25;
        const h0 = info.gMin + 6, h1 = info.top - 1.2;
        box(accent, mx, (h0 + h1) / 2, mz, 8, h1 - h0, 0.3, yawOf(e.dx, e.dz));
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(7.9, h1 - h0 - .12), new THREE.MeshBasicMaterial({ map: bradescoBannerTexture(renderer) }));
        banner.name = 'banner-predio-prata';
        banner.position.set(mx + e.nx * .165, (h0 + h1) / 2, mz + e.nz * .165);
        banner.rotation.y = Math.atan2(e.nx, e.nz); root.add(banner);
      }
    }
    if (b.accent === 'faixa') {
      const lv = b.levels || 2, fh = b.height / lv;
      for (let k = 1; k <= lv; k++) for (const e of edges) box(accent, (e.ax + e.bx) / 2 + e.nx * 0.14, info.gMin + fh * k - 0.35, (e.az + e.bz) / 2 + e.nz * 0.14, e.L + 0.25, 0.5, 0.25, yawOf(e.dx, e.dz));
    }
    if (b.accent === 'faixaVertical' || b.accent === 'quina') {
      // painel vermelho numa quina (Agência / portaria) ou faixa vertical na ponta
      const e = edges.slice().sort((p, q) => p.ax - q.ax)[0];
      const w = b.accent === 'quina' ? 3.2 : 2.2;
      box(accent, e.ax + e.nx * 0.2 + e.dx * w / 2, (info.gMin + info.top) / 2, e.az + e.nz * 0.2 + e.dz * w / 2, w, info.top - info.gMin, 0.35, yawOf(e.dx, e.dz));
    }
    if (b.glassSide) {
      // galeria envidraçada ao longo da fachada sudoeste (vista nas imagens 3D)
      const e = edges.filter((x) => x.L > A.L * 0.6).sort((p, q) => (q.nz - q.nx) - (p.nz - p.nx))[0];
      if (e) {
        const g = new THREE.BoxGeometry(e.L * 0.82, 7, 3.2);
        g.rotateY(yawOf(e.dx, e.dz));
        g.translate((e.ax + e.bx) / 2 + e.nx * 1.8, info.gMin + 3.3, (e.az + e.bz) / 2 + e.nz * 1.8);
        glass.push(g);
      }
    }

    // cobertura
    const tv = topVol(b.helipad ? b.helipad.vol : undefined);
    if (b.roofShape === 'tent') tentRoof(outer, info.top, b.roof, A);
    if (b.roofShape === 'ribbed') ribs(outer, info.top, b.roof, A);
    if (b.roofShape === 'green') greenRoof(outer, info.top);
    if (b.roofShape === 'terraced') {
      // CTI: cobertura em terraços (dois níveis recuados)
      for (const [k, dh] of [[0.78, 2.6], [0.55, 5.2]]) {
        const r = scaleRing(outer, k);
        builder.add({ id: 'cti-terraco', rings: [r], groundY: info.gMin, height: b.height + dh, minHeight: b.height + dh - 3.2, style, wall: b.wall, roof: b.roof, roofShape: 'flat' });
        for (const [x, z] of r) outline.push(x, info.top + dh - 2.6, z, x, info.top + dh + 0.5, z);
      }
    }
    if (b.helipad) {
      const vo = topVol(b.helipad.vol);
      const VA = vo.A || A;
      const u = VA.uMin + (b.helipad.at - (b.volumes ? b.volumes[b.helipad.vol].from : 0)) / ((b.volumes ? b.volumes[b.helipad.vol].to - b.volumes[b.helipad.vol].from : 1)) * VA.L;
      const [px, pz] = VA.at(Math.min(VA.uMax - 8, Math.max(VA.uMin + 8, u)), (VA.vMin + VA.vMax) / 2);
      helipad(px, vo.top + 0.06, pz, Math.min(16, VA.W * 0.9), yawOf(VA.ux, VA.uz));
    }
    if (b.towerBox) {
      const vo = topVol(b.towerBox.vol);
      const VA = vo.A || A;
      const [px, pz] = VA.at(VA.uMin + b.towerBox.at * VA.L + 3, (VA.vMin + VA.vMax) / 2);
      box(b.wall, px, vo.top + 1.8, pz, 6, 3.6, 5, yawOf(VA.ux, VA.uz));
    }
    if (b.sign) {
      const vo = topVol(b.sign.vol);
      const VA = vo.A || A;
      rooftopSign(b.sign.text, VA, vo.top);
    }
    if (b.antenna) {
      const vo = topVol(b.antenna.vol);
      const VA = vo.A || A;
      const [px, pz] = VA.at(VA.uMax - 4, (VA.vMin + VA.vMax) / 2);
      cyl('#9aa0a6', px, vo.top, pz, 0.12, 0.18, 9, 6);
      for (const h of [3.5, 6, 8]) box('#9aa0a6', px, vo.top + h, pz, 2.2, 0.08, 0.08, yawOf(VA.ux, VA.uz));
    }
    if (b.roofText) roofBand(b.roofText, outer, info.top, A);
    if (b.flag) flagpole(b, A, info);
    roofItems(b, outer, info.top, A);

    // rótulo
    if (b.name && !b.gateBuilding) label(`${b.num ? String(b.num).padStart(2, '0') + ' · ' : ''}${b.name}`, A.cx, vols[vols.length - 1].top + 3, A.cz, b.name.startsWith('Fundação') ? '🎓' : b.name.startsWith('Espaço') ? '🌿' : b.name.startsWith('Museu') ? '🏛' : b.name.startsWith('Ginásio') ? '🏀' : b.name.includes('Heliponto') ? '🚁' : b.name.startsWith('Estacionamento') ? '🅿' : b.name.startsWith('Portaria') ? '🚧' : '🏦');
    specs.push({ b, info, A });
  }

  // ---------------------------------------------------- laje do heliponto (Prédio Hangar)
  if (C.helideck) {
    const ring = C.helideck.rings[0];
    let gMax = -Infinity, gMin = Infinity;
    for (const [x, z] of ring) { gMax = Math.max(gMax, H(x, z)); gMin = Math.min(gMin, H(x, z)); }
    const top = gMax + 0.6;
    builder.add({ id: 'heliponto', rings: [ring], groundY: gMin, height: top - gMin, style: styleFor({ windows: '#3a4a5a', style: 'garage' }), floorH: 3.2, wall: '#cfcfca', roof: '#e3e5e6', roofShape: 'flat' });
    const A = principalAxis(ring);
    helipad(A.cx - A.ux * 6, top + 0.06, A.cz - A.uz * 6, 24, yawOf(A.ux, A.uz));
    eCircle(A.cx + A.ux * 16, top + 0.07, A.cz + A.uz * 16);
    for (const [x, z] of ring) outline.push(x, gMin, z, x, top + 0.5, z);
    label('11 · Heliponto Bradesco', A.cx, top + 4, A.cz, '🚁');
  }

  // ---------------------------------------------------- estruturas pontuais
  for (const p of C.points) {
    const y = H(p.x, p.z);
    if (p.kind === 'totem') {
      cyl('#e9e7e2', p.x, y - 0.2, p.z, 3.2, 3.4, 0.7, 20);
      cyl('#f5f5f3', p.x, y + 0.5, p.z, p.radius, p.radius * 1.1, p.height, 16);
      box(RED, p.x, y + 0.5 + p.height + 1.4, p.z, 2.9, 2.9, 2.9);
      for (const yaw of [0, Math.PI / 2]) box('#ffffff', p.x, y + 0.5 + p.height + 1.4, p.z, 3.0, 1.6, 0.3, yaw);
      outline.push(p.x, y, p.z, p.x, y + p.height + 3, p.z);
      label('Coluna Bradesco', p.x, y + p.height + 4.5, p.z, '📍');
    } else if (p.kind === 'dish') {
      const prof = [];
      for (let i = 0; i <= 10; i++) { const r = (i / 10) * (p.diameter / 2); prof.push(new THREE.Vector2(Math.max(0.05, r), (r * r) / (p.diameter * 0.9))); }
      const g = new THREE.LatheGeometry(prof, 24);
      g.rotateX(-0.95); // aponta para o norte (satélites geoestacionários)
      g.rotateY(Math.PI);
      g.translate(p.x, y + 4.2, p.z);
      addPart('#f3f3f1', g);
      cyl('#bfc3c6', p.x, y, p.z, 0.45, 0.6, 4.2, 10);
      box('#d6d8da', p.x, y + 0.4, p.z, 3, 0.8, 3);
    } else if (p.kind === 'silo') {
      cyl('#eeeeec', p.x, y - 0.2, p.z, p.radius, p.radius, p.height, 16);
      const cone = new THREE.ConeGeometry(p.radius * 1.02, 1.2, 16);
      cone.translate(p.x, y - 0.2 + p.height + 0.6, p.z);
      addPart('#e2e2df', cone);
    } else if (p.kind === 'playground') {
      box('#ffd600', p.x, y + 1.2, p.z, 3, 0.25, 3);
      for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) cyl('#1e88e5', p.x + dx, y, p.z + dz, 0.1, 0.1, 2.6, 6);
      const roof = new THREE.ConeGeometry(2.3, 1.4, 4); roof.rotateY(Math.PI / 4); roof.translate(p.x, y + 3.3, p.z); addPart('#8e24aa', roof);
      const slide = new THREE.BoxGeometry(0.9, 0.12, 4); slide.rotateX(0.55); slide.translate(p.x + 2.6, y + 0.65, p.z); addPart('#e53935', slide);
      box('#43a047', p.x - 3, y + 1.0, p.z + 1.5, 0.2, 2, 3);
    }
  }

  // ---------------------------------------------------- coberturas tensionadas (lona sobre vagas)
  for (const cnp of C.canopies) {
    const A = principalAxis(cnp.rings[0]);
    const n = Math.max(2, Math.round(A.L / 9.5));
    const seg = A.L / n;
    let gy = -Infinity;
    for (const [x, z] of cnp.rings[0]) gy = Math.max(gy, H(x, z));
    const y0 = gy + cnp.height;
    for (let i = 0; i < n; i++) {
      const u = A.uMin + seg * (i + 0.5);
      const [px, pz] = A.at(u, (A.vMin + A.vMax) / 2);
      const g = new THREE.ConeGeometry(Math.hypot(seg, A.W) / 2, 1.6, 4, 1, true);
      g.rotateY(Math.PI / 4 + yawOf(A.ux, A.uz));
      g.scale(seg / Math.hypot(seg, A.W), 1, A.W / Math.hypot(seg, A.W));
      g.translate(px, y0 + 0.8, pz);
      addPart('#fbfbfa', g);
      for (const v of [A.vMin, A.vMax]) { const [qx, qz] = A.at(A.uMin + seg * i, v); cyl('#9aa0a6', qx, H(qx, qz), qz, 0.09, 0.11, y0 - H(qx, qz), 6); }
    }
  }

  // ---------------------------------------------------- pista: arquibancada (sem cobertura) + torres de luz
  if (C.track) {
    const T = C.track;
    const vx = -T.uz, vz = T.ux;
    const side = vx >= 0 ? 1 : -1;
    const sx = vx * side, sz = vz * side;
    const yaw = yawOf(T.ux, T.uz);
    const len = T.straight * 2 - 6;
    for (let k = 0; k < 10; k++) {
      const off = T.rOut + 1.5 + k * 1.3 + 0.65;
      const px = T.cx + sx * off, pz = T.cz + sz * off;
      const gy = H(px, pz), h = 0.6 + k * 0.62;
      box(k % 2 ? '#e3e5e6' : '#d2d5d7', px, gy - 0.5 + (h + 0.5) / 2, pz, len, h + 0.5, 1.3, yaw);
    }
    const c0 = T.rOut + 1.5, c1 = T.rOut + 1.5 + 13;
    const foot = [[-1, c0], [1, c0], [1, c1], [-1, c1]].map(([s, o]) => [T.cx + T.ux * s * len / 2 + sx * o, T.cz + T.uz * s * len / 2 + sz * o]);
    builder.addSolid([foot], H(T.cx + sx * c1, T.cz + sz * c1) + 6, 'campus');
    for (const f of C.floodlights) {
      const gy = H(f.x, f.z);
      cyl('#8f959a', f.x, gy, f.z, 0.25, 0.4, 20, 8);
      const dir = Math.atan2(f.face[0] - f.x, f.face[1] - f.z);
      const g = new THREE.BoxGeometry(3.2, 1.6, 0.5); g.rotateX(0.5); g.rotateY(dir); g.translate(f.x, gy + 20.5, f.z); addPart('#c9ced2', g);
    }
    label('Pista de atletismo e campo de futebol', T.cx, H(T.cx, T.cz) + 4, T.cz, '🏃');
  }

  // ---------------------------------------------------- muro
  {
    for (const w of C.walls) {
      builder.addBarrier(w, WALL_H);
    }
    const wg = campusWallGeometry(C.walls, H, WALL_H);
    const wall = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    wall.castShadow = wall.receiveShadow = true;
    wall.name = 'muro-campus';
    root.add(wall);
  }

  // ---------------------------------------------------- portarias e portões
  const arms = [];
  const spawnPoints = [];
  const armMat = new THREE.MeshStandardMaterial({ map: stripeTexture(renderer), roughness: 0.6 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 });
  const freeSpot = (ring) => ring.every(([x, z]) => !C.insideSolid(x, z, 0.6) && C.RI.clearance(x, z).d > 0.6 && !C.nearWall(x, z, 0.6));
  for (const g of C.gateList || []) {
    if (g.type === 'pedestre') { pedestrianGate(g); continue; }
    if (!g.crossing || !g.center) continue;
    const r = g.crossing.r;
    let { x: px, z: pz, tx, tz } = g.center;
    // t aponta para dentro do campus
    if (!pointInPolygon(px + tx * 10, pz + tz * 10, C.quarter)) { tx = -tx; tz = -tz; }
    const nx = -tz, nz = tx;
    const w = r.w, gy = H(px, pz);
    const across = yawOf(nx, nz);
    const span = 2 * g.halfGap; // encosta nas pontas do muro
    if (g.type === 'portao') {
      const h = 2.4;
      for (let o = -span / 2; o <= span / 2 + 0.01; o += 0.16) box('#3d4248', px + nx * o, gy + h / 2, pz + nz * o, 0.06, h, 0.06);
      box('#3d4248', px, gy + h - 0.1, pz, span, 0.14, 0.12, across);
      box('#3d4248', px, gy + 0.3, pz, span, 0.14, 0.12, across);
      for (const s of [-1, 1]) box('#b3ada2', px + nx * s * span / 2, gy + 1.4, pz + nz * s * span / 2, 0.45, 2.8, 0.45);
      builder.addBarrier([[px - nx * span / 2, pz - nz * span / 2], [px + nx * span / 2, pz + nz * span / 2]], h);
      continue;
    }
    // portaria de veículos: marquise com pórticos vermelhos, placa, guarita e cancelas
    const mspan = Math.max(span + 2, w + 4), my = gy + 5.4;
    box('#ffffff', px + tx * 2, my, pz + tz * 2, mspan, 0.55, 8, across);
    for (const a of [-1, 1]) {
      box('#eeeee9', px + tx * (2 + a * 4.2), my - 0.45, pz + tz * (2 + a * 4.2), mspan, 1.1, 0.35, across);
      for (const s of [-1, 1]) {
        const qx = px + nx * s * (mspan / 2 - 0.4) + tx * (2 + a * 3.6), qz = pz + nz * s * (mspan / 2 - 0.4) + tz * (2 + a * 3.6);
        const qy = H(qx, qz);
        box(RED, qx, (qy + my + .8) / 2, qz, 1.0, my + .8 - qy, 0.85, across);
      }
    }
    for (const a of [-1, 1]) {
      const texture = gateSignTexture(renderer, g.name || 'Portaria');
      const sh = 1.0, sw = mspan - 1.5;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: texture }));
      sign.name = `letreiro-${g.name}`;
      sign.position.set(px + tx * (2 + a * 4.42), my - 0.45, pz + tz * (2 + a * 4.42));
      sign.rotation.y = Math.atan2(tx * a, tz * a);
      root.add(sign);
    }
    if (g.booth !== false && !g.building) {
      let placed = false;
      for (const along of [5, 8, 11]) for (const s of [1, -1]) {
        if (placed) break;
        const bxp = px + tx * along + nx * s * (w / 2 + 2.6), bzp = pz + tz * along + nz * s * (w / 2 + 2.6);
        const ring = rectRing(bxp, bzp, tx, tz, 4.2, 3.0);
        if (!freeSpot(ring)) continue;
        const info = builder.add({ id: 'guarita', rings: [ring], height: 3.2, style: styleFor({ windows: '#2b3f55' }), floorH: 3.2, wall: '#ffffff', roof: RED, roofShape: 'flat' });
        if (info) { box(RED, bxp, info.gMin + 1.1, bzp, 4.4, 0.35, 3.2, yawOf(tx, tz)); for (const [x, z] of ring) outline.push(x, info.gMin, z, x, info.top + 0.5, z); }
        placed = true;
      }
    }
    // cancelas (uma por sentido), um pouco para dentro — sobem quando o jogador chega perto
    for (const s of [1, -1]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(px + nx * s * (w / 2 + 0.25) + tx * (3 + s * 1.5), gy + 1.0, pz + nz * s * (w / 2 + 0.25) + tz * (3 + s * 1.5));
      pivot.rotation.y = Math.atan2(nz * s, -nx * s);
      const armLen = w / 2 + 0.2;
      const geo = new THREE.BoxGeometry(armLen, 0.12, 0.12);
      geo.translate(armLen / 2, 0, 0);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * armLen * 0.8);
      const arm = new THREE.Mesh(geo, armMat);
      arm.castShadow = true;
      pivot.add(arm);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.45), postMat);
      post.position.y = -0.45;
      pivot.add(post);
      root.add(pivot);
      arms.push({ arm, x: pivot.position.x, z: pivot.position.z, angle: 0 });
    }
    if (g.name && g.booth !== false) {
      label(`${g.num ? String(g.num).padStart(2, '0') + ' · ' : ''}${g.name}`, px + tx * 2, gy + 8.5, pz + tz * 2, '🚧');
      // chegada: na rua, 18 m para fora, olhando para a portaria
      let sx = px - tx * 18, sz = pz - tz * 18;
      const near = C.RI.nearestPoint(sx, sz, 30);
      if (near) { sx = near[0]; sz = near[1]; }
      spawnPoints.push({ name: g.name, x: sx, z: sz, yaw: Math.atan2(-(px - sx), -(pz - sz)) });
    }
  }

  const details = buildCampusDetails(C, specs, { renderer, terrain, world, quality });
  root.add(details.root);
  function pedestrianGate(g) {
    // guarita de pedestres junto ao vão do muro (lado de dentro)
    const ends = [];
    for (const w of C.walls) for (const p of [w[0], w[w.length - 1]]) if (Math.hypot(p[0] - g.x, p[1] - g.z) < 14) ends.push(p);
    ends.sort((a, b) => Math.hypot(a[0] - g.x, a[1] - g.z) - Math.hypot(b[0] - g.x, b[1] - g.z));
    let gx = g.x, gz = g.z;
    if (ends.length >= 2) { gx = (ends[0][0] + ends[1][0]) / 2; gz = (ends[0][1] + ends[1][1]) / 2; }
    else if (ends.length === 1) { gx = ends[0][0]; gz = ends[0][1]; }
    const [qx, qz] = centroidOf(C.quarter[0]);
    const L = Math.hypot(qx - gx, qz - gz) || 1, ix = (qx - gx) / L, iz = (qz - gz) / L;
    for (const side of [1, -1]) for (const off of [2.4, 3.4]) {
      const bx0 = gx + ix * off - iz * side * 2.6, bz0 = gz + iz * off + ix * side * 2.6;
      const ring = rectRing(bx0, bz0, ix, iz, 2, 2);
      if (!freeSpot(ring)) continue;
      const gy = H(bx0, bz0);
      box('#ffffff', bx0, gy + 1.25, bz0, 2, 2.5, 2, yawOf(ix, iz));
      box(RED, bx0, gy + 2.6, bz0, 2.4, 0.3, 2.4, yawOf(ix, iz));
      builder.addSolid([ring], gy + 2.5, null);
      label(`${g.num ? String(g.num).padStart(2, '0') + ' · ' : ''}${g.name}`, bx0, gy + 5, bz0, '🚶');
      return;
    }
    label(`${g.num ? String(g.num).padStart(2, '0') + ' · ' : ''}${g.name}`, gx, H(gx, gz) + 5, gz, '🚶');
  }

  // ---------------------------------------------------- carros
  if (C.cars.length) {
    const body = new THREE.BoxGeometry(CAR.wid, 0.75, CAR.len); body.translate(0, 0.62, 0);
    const cabin = new THREE.BoxGeometry(CAR.wid * 0.86, 0.6, 2.2); cabin.translate(0, 1.28, -0.2);
    const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), C.cars.length);
    const cabins = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial({ color: 0x24303b, roughness: 0.3 }), C.cars.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    C.cars.forEach((c, i) => {
      const y = H(c.x, c.z);
      m.compose(v.set(c.x, y, c.z), q.setFromAxisAngle(up, c.yaw), s1);
      bodies.setMatrixAt(i, m);
      cabins.setMatrixAt(i, m);
      bodies.setColorAt(i, col.set(c.color));
      builder.addSolid([c.ring], y + 1.55, null);
    });
    bodies.castShadow = cabins.castShadow = true;
    bodies.computeBoundingSphere(); cabins.computeBoundingSphere();
    bodies.name = 'carros';
    root.add(bodies, cabins);
  }

  // ---------------------------------------------------- pontos do ônibus Move
  for (const st of C.busStops) {
    const y = H(st.x, st.z), c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    box('#2e7d32', st.x, y + 2.7, st.z, 3.2, 0.18, 1.8, st.yaw);
    for (const o of [-1.4, 1.4]) cyl('#9aa0a6', st.x + c * o, y, st.z - s * o, 0.06, 0.06, 2.65, 6);
    const back = new THREE.BoxGeometry(3, 1.8, 0.06); back.rotateY(st.yaw); back.translate(st.x - s * 0.8, y + 1.5, st.z - c * 0.8); glass.push(back);
    box('#8d6e63', st.x - s * 0.5, y + 0.5, st.z - c * 0.5, 2.6, 0.12, 0.45, st.yaw);
    const { texture, aspect } = pixelSign(renderer, 'MOVE', '#2e7d32', '#ffffff');
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.42 * aspect, 0.42), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    sg.position.set(st.x + c * 1.4, y + 3.1, st.z - s * 1.4);
    sg.rotation.y = st.yaw;
    root.add(sg);
  }

  // ---------------------------------------------------- árvores, palmeiras, macacos
  const trees = makeTreeMeshes(C.trees, terrain, { quality, detail: true, sidewalkHeightAt: roads?.sidewalkHeightAt });
  trees.name = 'arvores-campus';
  root.add(trees);
  if (C.palms.length) root.add(makePalmMeshes(C.palms, terrain));
  const monkeys = buildMonkeys(C.monkeys, terrain);
  if (monkeys) root.add(monkeys.mesh);

  // ---------------------------------------------------- malhas finais
  for (const [color, geoms] of parts) {
    const merged = mergeGeometries(geoms.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }), false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (glass.length) {
    const merged = mergeGeometries(glass.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x9fd0ff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55 }));
    root.add(mesh);
  }
  if (outline.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x17191c, transparent: true, opacity: 0.7 }));
    lines.name = 'contornos';
    root.add(lines);
  }
  const buildingsRoot = builder.finish(root);
  buildingsRoot.name = 'predios-campus';
  scene.add(root);

  const sprites = labels.map((l) => {
    const { texture, width, height } = labelTexture(l.text, null, RED);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sp.scale.set(width * 0.032, height * 0.032, 1);
    sp.center.set(0.5, 0);
    sp.position.set(l.x, l.y, l.z);
    sp.visible = false;
    return sp;
  });

  function update(dt, playerPos, t) {
    for (const a of arms) {
      const near = Math.hypot(playerPos.x - a.x, playerPos.z - a.z) < 12;
      const target = near ? 1.35 : 0;
      a.angle += (target - a.angle) * Math.min(1, dt * 3);
      a.arm.rotation.z = a.angle;
    }
    monkeys?.update(t);
    flags.forEach((f) => { f.rotation.y = f.userData.base + Math.sin(t * 2.2 + f.userData.ph) * 0.25; });
  }

  return { root, builder, sprites, update, spawnPoints, details, surfaceHeightAt: details.surfaceHeightAt, count: C.buildings.length, cars: C.cars.length, trees: C.trees.length };

  // ================================================================ peças
  function ringEdges(ring) {
    const sign = Math.sign(ringArea(ring)) || 1;
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      out.push({ ax, az, bx, bz, L, dx, dz, nx: sign > 0 ? dz : -dz, nz: sign > 0 ? -dx : dx });
    }
    return out;
  }
  function tentRoof(ring, top, color, A) {
    const apex = [A.cx, top + Math.min(7, Math.max(3, A.W * 0.16)), A.cz];
    const pos = [];
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      pos.push(ax, top, az, apex[0], apex[1], apex[2], bx, top, bz);
      outline.push(ax, top, az, apex[0], apex[1], apex[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  function ribs(ring, top, roofColor, A) {
    const col = '#' + new THREE.Color(roofColor || '#dddddd').multiplyScalar(0.84).getHexString();
    for (let v = A.vMin + 1.4; v < A.vMax - 1; v += 3) {
      const seg = lineThroughPolygon(ring, ...A.at(0, v), A.ux, A.uz);
      if (!seg) continue;
      const [s0, s1] = seg, len = s1 - s0 - 1;
      if (len < 2) continue;
      const [px, pz] = A.at(0, v);
      box(col, px + A.ux * (s0 + s1) / 2, top + 0.3, pz + A.uz * (s0 + s1) / 2, len, 0.6, 1.0, yawOf(A.ux, A.uz));
    }
  }
  function greenRoof(ring, top) {
    // grama do telhado verde + bordas metálicas
    const r2 = scaleRing(ring, 0.94);
    const shape = new THREE.Shape(r2.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, top + 0.12, 0);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6f9a3c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true;
    root.add(m);
    for (const e of ringEdges(ring)) box('#5f6a73', (e.ax + e.bx) / 2, top + 0.25, (e.az + e.bz) / 2, e.L, 0.4, 0.25, yawOf(e.dx, e.dz));
  }
  function helipad(x, y, z, size, yaw) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: helipadTexture(renderer), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.rotation.set(-Math.PI / 2, 0, yaw);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  }
  function eCircle(x, y, z) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#2f5f9e'; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.fillRect(11, 8, 10, 2); g.fillRect(11, 15, 8, 2); g.fillRect(11, 22, 10, 2); g.fillRect(11, 8, 2, 16);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: t, transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    root.add(m);
  }
  function roofBand(text, ring, top, A) {
    const { texture, aspect } = pixelSign(renderer, text, '#f2c94c', '#1b1b1b');
    const w = Math.min(A.L * 0.9, 22), h = w / aspect;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.rotation.set(-Math.PI / 2, 0, yawOf(A.ux, A.uz));
    m.position.set(A.cx, top + 0.08, A.cz);
    root.add(m);
  }
  function rooftopSign(text, A, top) {
    const { texture, aspect } = pixelSign(renderer, text, RED, '#ffffff');
    const h = 3.2, w = h * aspect;
    const [px, pz] = A.at((A.uMin + A.uMax) / 2, A.vMin + 2);
    for (const flip of [0, Math.PI]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture }));
      m.position.set(px, top + 1.2 + h / 2, pz);
      // plano paralelo ao eixo longo, virado para os dois lados
      m.rotation.y = Math.atan2(A.ux, A.uz) + Math.PI / 2 + flip;
      root.add(m);
    }
    for (const o of [-w / 2 + 0.5, w / 2 - 0.5]) cyl('#6f757a', px + A.ux * o, top, pz + A.uz * o, 0.12, 0.12, 1.3, 6);
  }
  function flagpole(b, A, info) {
    const [px, pz] = A.at(A.uMin - 6, A.vMax + 4);
    const gy = H(px, pz);
    cyl('#c9ced2', px, gy, pz, 0.07, 0.1, 10, 8);
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshStandardMaterial({ color: RED, side: THREE.DoubleSide }));
    fg.geometry.translate(1.2, 0, 0);
    fg.position.set(px, gy + 9, pz);
    fg.userData.base = rnd() * Math.PI * 2;
    fg.userData.ph = rnd() * 10;
    root.add(fg);
    flags.push(fg);
  }
  function roofItems(b, ring, top, A) {
    if (!b.roofItems) return;
    const n = b.roofItems === 'solar' ? 0 : 3 + Math.floor(rnd() * 4);
    if (b.roofItems === 'solar') {
      for (let v = A.vMin + 2.5; v < A.vMax - 2.5; v += 3.2)
        for (let u = A.uMin + A.L * 0.32; u < A.uMax - A.L * 0.32; u += 4.4) {
          const [x, z] = A.at(u, v);
          if (!pointInPolygon(x, z, b.rings)) continue;
          const g = new THREE.BoxGeometry(4, 0.1, 2.2); g.rotateX(-0.18); g.rotateY(yawOf(A.ux, A.uz)); g.translate(x, top + 0.45, z);
          addPart('#1f3c6e', g);
        }
      return;
    }
    for (let k = 0, tries = 0; k < n && tries < 40; tries++) {
      const u = A.uMin + 3 + rnd() * (A.L - 6), v = A.vMin + 3 + rnd() * (A.W - 6);
      const [x, z] = A.at(u, v);
      if (!pointInPolygon(x, z, b.rings)) continue;
      if (b.roofItems === 'exhaust') cyl('#8a8f94', x, top, z, 0.5, 0.55, 4.5, 10);
      else if (b.roofItems === 'skylights') box('#dfe8ee', x, top + 0.4, z, 6, 0.8, 3, yawOf(A.ux, A.uz));
      else box('#b9bdc1', x, top + 0.8, z, 3.2, 1.6, 2.2, yawOf(A.ux, A.uz));
      k++;
    }
  }
  function buildPergola(b) {
    const ring = b.rings[0];
    const A = principalAxis(ring);
    let gy = -Infinity;
    for (const [x, z] of ring) gy = Math.max(gy, H(x, z));
    const top = gy + (b.height || 3.6);
    for (let u = A.uMin + 1; u <= A.uMax - 1; u += 2.2) {
      const seg = lineThroughPolygon(ring, ...A.at(u, 0), -A.uz, A.ux);
      if (!seg) continue;
      const [x, z] = A.at(u, (seg[0] + seg[1]) / 2);
      box('#8d949a', x, top, z, 0.12, 0.22, seg[1] - seg[0] - 0.6, yawOf(A.ux, A.uz));
    }
    for (let v = A.vMin + 1; v <= A.vMax - 1; v += 5.5) {
      const seg = lineThroughPolygon(ring, ...A.at(0, v), A.ux, A.uz);
      if (!seg) continue;
      const [x, z] = A.at((seg[0] + seg[1]) / 2, v);
      box('#6f767c', x, top - 0.25, z, seg[1] - seg[0] - 0.4, 0.3, 0.25, yawOf(A.ux, A.uz));
      for (let u = seg[0] + 1; u < seg[1] - 0.5; u += 7.5) {
        const [cx, cz] = A.at(u, v);
        cyl('#6f767c', cx, H(cx, cz), cz, 0.12, 0.12, top - H(cx, cz), 6);
      }
    }
    label(`${String(b.num || '').padStart(2, '0')} · ${b.name}`, A.cx, top + 3, A.cz, '🅿');
  }
}

const flags = [];

/** intervalo [s0, s1] onde a reta p + s·u cruza o polígono */
function lineThroughPolygon(ring, px, pz, ux, uz) {
  const ss = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ez = bz - az;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((ax - px) * ez - (az - pz) * ex) / den;
    const t = ((ax - px) * uz - (az - pz) * ux) / den;
    if (t >= 0 && t <= 1) ss.push(s);
  }
  if (ss.length < 2) return null;
  return [Math.min(...ss), Math.max(...ss)];
}

// ---------------------------------------------------------------- macacos-prego (cartoon)
function buildMonkeys(list, terrain) {
  if (!list.length) return null;
  const parts = [];
  const add = (g, color) => {
    const c = new THREE.Color(color);
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    const n = ng.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    parts.push(ng);
  };
  const body = new THREE.SphereGeometry(0.22, 8, 6); body.scale(1, 1.25, 0.9); body.translate(0, 0.35, 0); add(body, '#5d4030');
  const head = new THREE.SphereGeometry(0.15, 8, 6); head.translate(0, 0.72, 0.05); add(head, '#5d4030');
  const face = new THREE.SphereGeometry(0.1, 8, 6); face.scale(1, 0.9, 0.5); face.translate(0, 0.7, 0.16); add(face, '#e2c4a0');
  const cap = new THREE.SphereGeometry(0.13, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.4); cap.translate(0, 0.76, 0.03); add(cap, '#2b1d14');
  for (const s of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.045, 0.04, 0.38, 5); arm.rotateZ(s * 0.5); arm.translate(s * 0.22, 0.38, 0.06); add(arm, '#4a3226');
    const leg = new THREE.CylinderGeometry(0.05, 0.045, 0.3, 5); leg.rotateX(1.2); leg.translate(s * 0.1, 0.12, 0.12); add(leg, '#4a3226');
  }
  const tail = new THREE.TorusGeometry(0.25, 0.035, 5, 10, Math.PI * 1.3); tail.rotateY(Math.PI / 2); tail.translate(0, 0.3, -0.28); add(tail, '#4a3226');
  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), list.length);
  mesh.castShadow = true;
  mesh.name = 'macacos';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1.6, 1.6, 1.6), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const base = list.map((k) => {
    const gy = terrain.heightAt(k.x, k.z);
    // nos galhos baixos (abaixo da copa) ou no chão
    const y = k.onTree ? gy + 1.3 * k.tree.s : gy;
    return { ...k, y };
  });
  function update(t) {
    base.forEach((k, i) => {
      const bob = Math.abs(Math.sin(t * 1.7 + k.phase)) * (k.onTree ? 0.04 : 0.12);
      m.compose(p.set(k.x, k.y + bob, k.z), q.setFromAxisAngle(up, k.yaw + Math.sin(t * 0.4 + k.phase) * 0.6), s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);
  mesh.computeBoundingSphere();
  return { mesh, update };
}

// ---------------------------------------------------------------- verificação (depuração / QA)
export function campusQA(C) {
  const issues = { carWall: 0, carCar: 0, carSolid: 0, carRoad: 0, treeSolid: 0, wallGapsByReason: {} };
  const nearWall = (x, z, d) => { for (const s of C.wallGrid.query(x, z, d + 1)) if (distToSegment(x, z, s[0], s[1], s[2], s[3]).d < d) return true; return false; };
  for (let i = 0; i < C.cars.length; i++) {
    const c = C.cars[i];
    if (c.ring.some(([x, z]) => nearWall(x, z, 0.3))) issues.carWall++;
    if (c.ring.some(([x, z]) => C.insideSolid(x, z))) issues.carSolid++;
    if (c.ring.some(([x, z]) => !C.inRegion(x, z))) issues.carOutside = (issues.carOutside || 0) + 1;
    for (let j = i + 1; j < C.cars.length; j++) { const o = C.cars[j]; if (Math.hypot(o.x - c.x, o.z - c.z) < 5 && obbOverlap(c.ring.concat([c.ring[0]]), o.ring.concat([o.ring[0]]))) issues.carCar++; }
  }
  for (const t of C.trees) if (C.insideSolid(t.x, t.z)) issues.treeSolid++;
  // trechos de muro em cima de pista (qualquer via de carro)
  issues.wallOnRoad = 0;
  for (const w of C.walls) for (let i = 0; i < w.length - 1; i++) {
    const mx = (w[i][0] + w[i + 1][0]) / 2, mz = (w[i][1] + w[i + 1][1]) / 2;
    const cl = C.RI.clearance(mx, mz);
    if (cl.d < 0.2) { issues.wallOnRoad++; (issues.wallOnRoadAt ||= []).push([+mx.toFixed(1), +mz.toFixed(1), cl.seg.r.highway, cl.seg.r.name || '', cl.seg.r.internal ? 'interna' : cl.seg.r.access ? 'acesso' : 'publica', +cl.d.toFixed(2)]); }
  }
  // frestas: extremos de muro a menos de 1,2 m de outro muro ou prédio, mas sem encostar
  issues.slits = 0;
  for (const w of C.walls) for (const e of [w[0], w[w.length - 1]]) {
    if (C.insideSolid(e[0], e[1])) continue; // entra no prédio: fechado
    for (const o of C.walls) { if (o === w) continue; for (const f of [o[0], o[o.length - 1]]) { const d = Math.hypot(e[0] - f[0], e[1] - f[1]); if (d > 0.05 && d < 1.2) issues.slits++; } }
  }
  for (const g of C.wallGaps) issues.wallGapsByReason[g.reason] = (issues.wallGapsByReason[g.reason] || 0) + 1;
  issues.seal = sealTest(C);
  issues.walls = C.walls.length;
  issues.wallLength = Math.round(C.walls.reduce((s, w) => s + w.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - w[i][0], p[1] - w[i][1]), 0), 0));
  issues.gates = (C.gateList || []).map((g) => `${g.type}${g.auto ? '(auto)' : ''}:${g.name || ''}:${g.crossing ? (g.center ? 'ok' : 'sem centro') : g.type === 'pedestre' ? 'pedestres' : 'SEM VIA'}`);
  return issues;
}

/**
 * Teste de vedação: rasteriza muros + prédios + linhas das portarias (fechadas) numa grade de
 * 0,5 m e inunda a partir de fora. Se a água chegar ao miolo do campus, há furo no muro.
 */
function sealTest(C) {
  const ring = C.quarter[0];
  const bb = bboxOf(ring, 40);
  const S = 0.5;
  const W = Math.ceil((bb.maxX - bb.minX) / S), H = Math.ceil((bb.maxZ - bb.minZ) / S);
  const block = new Uint8Array(W * H);
  const cell = (x, z) => [Math.floor((x - bb.minX) / S), Math.floor((z - bb.minZ) / S)];
  const markSeg = (ax, az, bx, bz, r = 0.4) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (S / 2)));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      const [i0, j0] = cell(x - r, z - r), [i1, j1] = cell(x + r, z + r);
      for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) block[j * W + i] = 1;
    }
  };
  for (const w of C.walls) for (let i = 0; i < w.length - 1; i++) markSeg(w[i][0], w[i][1], w[i + 1][0], w[i + 1][1]);
  // portarias e portões fechados para o teste
  for (const g of C.gateList || []) {
    if (g.ends && g.ends.length === 2) markSeg(g.ends[0][0], g.ends[0][1], g.ends[1][0], g.ends[1][1]);
    else if (g.type === 'pedestre') {
      const ends = [];
      for (const w of C.walls) for (const p of [w[0], w[w.length - 1]]) if (Math.hypot(p[0] - g.x, p[1] - g.z) < 14) ends.push(p);
      ends.sort((a, b) => Math.hypot(a[0] - g.x, a[1] - g.z) - Math.hypot(b[0] - g.x, b[1] - g.z));
      if (ends.length >= 2) markSeg(ends[0][0], ends[0][1], ends[1][0], ends[1][1]);
    }
  }
  // prédios (sólidos)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (block[j * W + i]) continue;
    const x = bb.minX + (i + 0.5) * S, z = bb.minZ + (j + 0.5) * S;
    if (C.insideSolid(x, z)) block[j * W + i] = 1;
  }
  // inundação a partir da borda
  const seen = new Uint8Array(W * H), parent = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (let i = 0; i < W; i++) for (const j of [0, H - 1]) { const k = j * W + i; if (!block[k] && !seen[k]) { seen[k] = 1; q[qt++] = k; } }
  for (let j = 0; j < H; j++) for (const i of [0, W - 1]) { const k = j * W + i; if (!block[k] && !seen[k]) { seen[k] = 1; q[qt++] = k; } }
  while (qh < qt) {
    const k = q[qh++], i = k % W, j = (k / W) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (block[nk] || seen[nk]) continue;
      seen[nk] = 1; parent[nk] = k; q[qt++] = nk;
    }
  }
  // células do miolo (dentro do bairro e a mais de 25 m da divisa) alcançadas = vazamento
  const distRing = (x, z) => { let d = Infinity; for (let a = 0; a < ring.length; a++) { const [ax, az] = ring[a], [bx, bz] = ring[(a + 1) % ring.length]; d = Math.min(d, distToSegment(x, z, ax, az, bx, bz).d); } return d; };
  let leaks = 0, leakCell = -1;
  for (let j = 0; j < H; j += 4) for (let i = 0; i < W; i += 4) {
    const k = j * W + i;
    if (!seen[k]) continue;
    const x = bb.minX + (i + 0.5) * S, z = bb.minZ + (j + 0.5) * S;
    if (!pointInPolygon(x, z, C.quarter) || distRing(x, z) < 25) continue;
    leaks++;
    if (leakCell < 0) leakCell = k;
  }
  let entry = null;
  if (leakCell >= 0) {
    // volta pelo caminho até o ponto onde ele cruzou a divisa
    let k = leakCell, last = null;
    while (k >= 0) {
      const x = bb.minX + ((k % W) + 0.5) * S, z = bb.minZ + (((k / W) | 0) + 0.5) * S;
      if (!pointInPolygon(x, z, C.quarter)) { entry = last || [x, z]; break; }
      last = [x, z];
      k = parent[k];
    }
  }
  return { cells: W * H, leaks, entry };
}
