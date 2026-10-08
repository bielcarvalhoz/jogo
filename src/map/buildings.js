import * as THREE from 'three';
import { facadeTexture, roofTexture } from '../shared/textures.js';
import { mulberry32, hashString, pick } from '../shared/rng.js';
import { ringArea, ringCentroid, isConvex, SpatialGrid, pointInPolygon } from '../shared/geo.js';

// Extrusão de plantas de prédios (reais do OSM ou procedurais) em malhas mescladas.

export const PALETTE = {
  house: ['#f1e6cf', '#e9d8b4', '#f3efe6', '#d9b38c', '#e8c39e', '#c9d6c2', '#f0d5c9', '#e3c7a0', '#b7cbd8', '#f2e0a0', '#d8a48f', '#ece3d8', '#c4d9a8', '#f5c6a5'],
  tower: ['#e8e2d6', '#d6cfc2', '#cfd3d6', '#efe9df', '#c9b8a0', '#b9c0c8', '#ddd5c5'],
  glass: ['#ffffff', '#dfe8ee', '#c8d6df', '#e6efe9'],
  roofFlat: ['#9b9a96', '#8e8b85', '#a9a49b', '#7f7d78', '#b0aca4'],
  roofTile: ['#b5562f', '#a84a2a', '#c0663a', '#9c4a2e', '#b86b45'],
};
const BAY = { house: 3.2, tower: 3.0, glass: 3.0 };
const FLOOR = { house: 3.0, tower: 2.9, glass: 3.6 };

function parseLength(v) {
  if (!v) return NaN;
  const n = parseFloat(String(v).replace(',', '.'));
  return /ft|'/.test(v) ? n * 0.3048 : n;
}

function safeColor(str, fallback) {
  const c = new THREE.Color(fallback);
  if (!str) return c;
  try { c.setStyle(str.replace(/_/g, '')); } catch { /* cor inválida no OSM */ }
  return c;
}

/** Traduz as tags OSM de um prédio real numa especificação de volume. */
export function specFromOsm(b) {
  const t = b.tags;
  const area = Math.abs(ringArea(b.rings[0]));
  const rnd = mulberry32(hashString(b.id));
  const type = t.building || t['building:part'] || 'yes';
  const name = t.name || '';
  let levels = parseInt(t['building:levels'], 10);
  let height = parseLength(t.height);
  let style = 'house';
  let floorH = 3.0;

  if (type === 'roof') {
    return { rings: b.rings, canopy: true, height: isNaN(height) ? 5.5 : height, wall: '#bfbfbf', roof: t['roof:colour'] || '#d9d9d9', id: b.id, name, tags: t };
  }

  if (isNaN(levels) && isNaN(height)) {
    if (type === 'house' || type === 'detached' || type === 'semidetached_house' || type === 'terrace') levels = rnd() < 0.55 ? 1 : 2;
    else if (type === 'apartments' || type === 'residential') levels = /^edif|residencial|torre/i.test(name) || area > 300 ? 8 + Math.floor(rnd() * 7) : 2 + Math.floor(rnd() * 2);
    else if (type === 'commercial' || type === 'office') levels = area > 800 ? 3 + Math.floor(rnd() * 4) : 2 + Math.floor(rnd() * 2);
    else if (type === 'retail') { levels = area > 3000 ? 3 : area > 600 ? 2 : 1; floorH = 5; }
    else if (type === 'church') { height = 12; }
    else if (type === 'school') levels = 2;
    else if (type === 'transportation' || type === 'train_station') height = 9;
    else if (type === 'industrial' || type === 'warehouse') height = 9;
    else levels = area < 120 ? 1 + Math.floor(rnd() * 2) : area < 450 ? 2 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3);
  }
  if (isNaN(height)) height = levels * floorH + 0.6;
  if (isNaN(levels)) levels = Math.max(1, Math.round(height / 3));

  if ((type === 'apartments' || type === 'residential') && levels >= 4) style = 'tower';
  else if ((['commercial', 'office', 'retail'].includes(type) && levels >= 3) || (levels >= 4 && type === 'yes')) style = height > 40 && type === 'yes' ? 'tower' : 'glass';
  if (levels >= 12 && style === 'house') style = 'tower';

  const minH = parseLength(t.min_height) || (parseInt(t['building:min_level'], 10) || 0) * 3;
  const smallHouse = style === 'house' && levels <= 2 && area < 250;
  const roofShape = t['roof:shape'] && t['roof:shape'] !== 'flat' ? 'pyramid' : smallHouse && rnd() < 0.45 ? 'pyramid' : 'flat';

  return {
    id: b.id, name, tags: t, rings: b.rings, height, minHeight: minH, style, levels,
    floorH: style === 'glass' ? FLOOR.glass : floorH,
    wall: t['building:colour'] || pick(rnd, PALETTE[style]),
    roof: t['roof:colour'] || (roofShape === 'pyramid' ? pick(rnd, PALETTE.roofTile) : pick(rnd, PALETTE.roofFlat)),
    roofShape,
    waterTank: smallHouse && roofShape === 'flat' && rnd() < 0.7,
  };
}

/**
 * options.styles: estilos extras de fachada { nome: { texture, bay, floor, mat } }
 * options.roofTextures: { roofFlat, roofTile } para trocar as texturas de cobertura
 */
export function createBuildingBuilder(renderer, terrain, options = {}) {
  const extra = options.styles || {};
  const bayOf = (style) => extra[style]?.bay ?? BAY[style] ?? 3;
  const floorOf = (style) => extra[style]?.floor ?? FLOOR[style] ?? 3;
  // geometria agrupada por material E por bloco de 250 m, para o frustum culling
  // (câmera e sombra) descartar o que não está à vista
  const CHUNK = 250;
  const groups = new Map();
  let chunk = '0,0';
  const G = (style) => {
    const k = style + '|' + chunk;
    if (!groups.has(k)) groups.set(k, { style, pos: [], nrm: [], uv: [], col: [] });
    return groups.get(k);
  };
  const tanks = [];
  const columns = [];
  const colliders = new SpatialGrid(20);
  const footprints = []; // para o minimapa
  const v3a = new THREE.Vector3(), v3b = new THREE.Vector3(), v3c = new THREE.Vector3();

  function pushTri(g, A, B, C, uvA, uvB, uvC, color, outward) {
    // garante que a face aponte para "outward" (normal da face na convenção do three)
    v3a.set(C[0] - B[0], C[1] - B[1], C[2] - B[2]);
    v3b.set(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    v3c.crossVectors(v3a, v3b);
    if (v3c.dot(outward) < 0) { [B, C] = [C, B]; [uvB, uvC] = [uvC, uvB]; }
    v3c.copy(outward).normalize();
    for (const [P, U] of [[A, uvA], [B, uvB], [C, uvC]]) {
      g.pos.push(P[0], P[1], P[2]);
      g.nrm.push(v3c.x, v3c.y, v3c.z);
      g.uv.push(U[0], U[1]);
      g.col.push(color.r, color.g, color.b);
    }
  }

  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);

  function addWalls(g, ring, outerSign, y0, y1, vBase, bay, floorH, color) {
    const n = ring.length;
    let u = 0;
    const out = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      const dx = bx - ax, dz = bz - az;
      const L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      // normal externa: depende da orientação do anel (furos têm orientação invertida)
      if (outerSign > 0) out.set(dz, 0, -dx); else out.set(-dz, 0, dx);
      const u0 = u / bay, u1 = (u + L) / bay;
      const v0 = (y0 - vBase) / floorH, v1 = (y1 - vBase) / floorH;
      const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, y1, bz], D = [ax, y1, az];
      pushTri(g, A, B, C, [u0, v0], [u1, v0], [u1, v1], color, out);
      pushTri(g, A, C, D, [u0, v0], [u1, v1], [u0, v1], color, out);
      u += L;
    }
  }

  function addFlatRoof(g, rings, y, color, normal = UP) {
    const contour = rings[0].map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { return; }
    const all = rings.flat();
    for (const [i, j, k] of tris) {
      const A = all[i], B = all[j], C = all[k];
      pushTri(g, [A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], [A[0] / 2, A[1] / 2], [B[0] / 2, B[1] / 2], [C[0] / 2, C[1] / 2], color, normal);
    }
  }

  function addPyramidRoof(g, ring, y, rise, color) {
    const [cx, cz] = ringCentroid([...ring, ring[0]]);
    const apex = [cx, y + rise, cz];
    const n = ring.length;
    const nrm = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez) || 1;
      const A = [ax, y, az], B = [bx, y, bz];
      // normal da água: cross das arestas, forçada para cima
      v3a.set(bx - ax, 0, bz - az);
      v3b.set(apex[0] - ax, apex[1] - y, apex[2] - az);
      nrm.crossVectors(v3a, v3b);
      if (nrm.y < 0) nrm.negate();
      // uv: ao longo do beiral / distância até a cumeeira
      const dApex = Math.abs((apex[0] - ax) * (-ez / L) + (apex[2] - az) * (ex / L));
      const slope = Math.hypot(dApex, rise);
      const uApex = ((apex[0] - ax) * ex + (apex[2] - az) * ez) / L;
      pushTri(g, A, B, apex, [0, 0], [L / 2, 0], [uApex / 2, slope / 2], color, nrm);
    }
  }

  /** desloca um anel para dentro (d > 0) ou para fora (d < 0) do seu próprio interior */
  function offsetRing(ring, d) {
    const n = ring.length, sign = Math.sign(ringArea(ring)) || 1;
    const inN = (a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1; return sign > 0 ? [-ez / L, ex / L] : [ez / L, -ex / L]; };
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
      const n1 = inN(p0, p1), n2 = inN(p1, p2);
      let bx = n1[0] + n2[0], bz = n1[1] + n2[1];
      const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const k = d / Math.max(0.35, bx * n1[0] + bz * n1[1]);
      out.push([p1[0] + bx * k, p1[1] + bz * k]);
    }
    return out;
  }
  function simpleRing(ring) {
    const n = ring.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const [a, b] = [ring[i], ring[(i + 1) % n]], [c, d] = [ring[j], ring[(j + 1) % n]];
        const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
        const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
        if (t > 0 && t < 1 && u > 0 && u < 1) return false;
      }
    return true;
  }
  /** retângulo orientado (eixo da aresta mais longa) e quanto da área ele ocupa */
  function obbOf(ring) {
    let best = 0, ux = 1, uz = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L > best) { best = L; ux = (bx - ax) / L; uz = (bz - az) / L; }
    }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) { const u = x * ux + z * uz, v = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const at = (u, v) => [u * ux - v * uz, u * uz + v * ux];
    return { ux, uz, u0, u1, v0, v1, at, fill: Math.abs(ringArea(ring)) / ((u1 - u0) * (v1 - v0) || 1) };
  }
  /** telhado de 4 águas sobre o retângulo orientado (cerâmica) + forro por baixo */
  function addHipRoofOBB(g, ring, y, color) {
    const o = obbOf(ring);
    let L = o.u1 - o.u0, W = o.v1 - o.v0, uc = (o.u0 + o.u1) / 2, vc = (o.v0 + o.v1) / 2;
    let along = true;
    if (W > L) { along = false; }
    const half = Math.min(L, W) / 2, rise = Math.min(4.5, half * 0.58);
    const P = (u, v, h = 0) => { const [x, z] = o.at(u, v); return [x, y + h, z]; };
    const A = P(o.u0, o.v0), B = P(o.u1, o.v0), Cc = P(o.u1, o.v1), D = P(o.u0, o.v1);
    let R1, R2;
    if (along) { R1 = P(o.u0 + half, vc, rise); R2 = P(o.u1 - half, vc, rise); }
    else { R1 = P(uc, o.v0 + half, rise); R2 = P(uc, o.v1 - half, rise); }
    const face = (pts) => {
      // normal média para cima
      const [p0, p1, p2] = pts;
      v3a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      v3b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
      const nrm = new THREE.Vector3().crossVectors(v3a, v3b);
      if (nrm.y < 0) nrm.negate();
      for (let i = 1; i < pts.length - 1; i++) pushTri(g, pts[0], pts[i], pts[i + 1], [pts[0][0] / 2, pts[0][2] / 2], [pts[i][0] / 2, pts[i][2] / 2], [pts[i + 1][0] / 2, pts[i + 1][2] / 2], color, nrm);
    };
    if (along) { face([A, B, R2, R1]); face([Cc, D, R1, R2]); face([B, Cc, R2]); face([D, A, R1]); }
    else { face([B, Cc, R2, R1]); face([D, A, R1, R2]); face([A, B, R1]); face([Cc, D, R2]); }
    // forro (visto de baixo, onde o telhado avança além das paredes)
    pushTri(g, A, Cc, B, [0, 0], [0, 0], [0, 0], color, DOWN);
    pushTri(g, A, D, Cc, [0, 0], [0, 0], [0, 0], color, DOWN);
    return rise;
  }
  /** telhado de 4 águas que acompanha a planta (inclusive pátio interno) */
  function addHipRoofInset(g, rings, y, color) {
    const outer = rings[0];
    // largura útil: menor distância entre bordas opostas (aprox. pelo retângulo e pelo pátio)
    let width = Math.min(obbOf(outer).u1 - obbOf(outer).u0, obbOf(outer).v1 - obbOf(outer).v0);
    if (rings.length > 1) {
      let dmin = Infinity;
      for (const [x, z] of rings[1]) for (let i = 0; i < outer.length; i++) {
        const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
        dmin = Math.min(dmin, Math.hypot(x - ax - ex * t, z - az - ez * t));
      }
      width = Math.min(width, dmin);
    }
    for (let s = width * 0.46; s > 0.8; s *= 0.6) {
      const inner = offsetRing(outer, s);
      const holes = rings.slice(1).map((h) => offsetRing(h, -s));
      if (!simpleRing(inner) || holes.some((h) => !simpleRing(h))) continue;
      if (Math.sign(ringArea(inner)) !== Math.sign(ringArea(outer))) continue;
      const rise = Math.min(4.5, s * 0.58);
      const strip = (a, b, upward) => {
        for (let i = 0; i < a.length; i++) {
          const j = (i + 1) % a.length;
          const p0 = [a[i][0], y, a[i][1]], p1 = [a[j][0], y, a[j][1]], q0 = [b[i][0], y + rise, b[i][1]], q1 = [b[j][0], y + rise, b[j][1]];
          v3a.set(p1[0] - p0[0], 0, p1[2] - p0[2]);
          v3b.set(q0[0] - p0[0], rise, q0[2] - p0[2]);
          const nrm = new THREE.Vector3().crossVectors(v3a, v3b);
          if (nrm.y < 0) nrm.negate();
          pushTri(g, p0, p1, q1, [p0[0] / 2, p0[2] / 2], [p1[0] / 2, p1[2] / 2], [q1[0] / 2, q1[2] / 2], color, nrm);
          pushTri(g, p0, q1, q0, [p0[0] / 2, p0[2] / 2], [q1[0] / 2, q1[2] / 2], [q0[0] / 2, q0[2] / 2], color, nrm);
        }
      };
      strip(outer, inner);
      rings.slice(1).forEach((h, k) => strip(h, holes[k]));
      addFlatRoof(g, [inner, ...holes], y + rise, color);
      return rise;
    }
    addFlatRoof(g, rings, y, color);
    return 0;
  }

  function add(spec) {
    const outer = spec.rings[0];
    if (outer.length < 3) return;
    // chão sob a planta
    let gMin = Infinity, gMax = -Infinity;
    const sample = (x, z) => { const h = terrain.heightAt(x, z); if (h < gMin) gMin = h; if (h > gMax) gMax = h; };
    for (const [x, z] of outer) sample(x, z);
    const [cx, cz] = ringCentroid([...outer, outer[0]]);
    sample(cx, cz);
    // volume apoiado sobre outro (ex.: torre sobre embasamento): chão fixo
    if (spec.groundY !== undefined) { gMin = gMax = spec.groundY; }

    chunk = Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
    const outerSign = Math.sign(ringArea(outer)) || 1;
    const color = safeColor(spec.wall, '#dddddd');
    const roofColor = safeColor(spec.roof, '#999999');

    if (spec.canopy) {
      // cobertura (posto de gasolina etc.): laje fina sobre pilares, sem colisão
      const top = gMax + spec.height, bot = top - 0.6;
      addWalls(G('roofFlat'), outer, outerSign, bot, top, bot, 10, 10, color);
      addFlatRoof(G('roofFlat'), spec.rings, top, roofColor, UP);
      addFlatRoof(G('roofFlat'), spec.rings, bot, color, DOWN);
      outer.forEach(([x, z], i) => { if (i % 2 === 0) columns.push({ x: x * 0.85 + cx * 0.15, z: z * 0.85 + cz * 0.15, y0: terrain.heightAt(x, z) - 0.3, y1: bot }); });
      return;
    }

    const style = spec.style || 'house';
    const y0 = gMin - 0.6 + (spec.minHeight || 0);
    let top = gMin + spec.height;
    if (top < gMax + 2.6) top = gMax + 2.6; // terreno muito inclinado
    const g = G(style);
    addWalls(g, outer, outerSign, y0, top, gMin, bayOf(style), spec.floorH || floorOf(style), color);
    // pátios internos: a parede "externa" aponta para dentro do furo
    for (let h = 1; h < spec.rings.length; h++) addWalls(g, spec.rings[h], -(Math.sign(ringArea(spec.rings[h])) || 1), y0, top, gMin, bayOf(style), spec.floorH || floorOf(style), color);

    if (spec.noRoof) {
      // cobertura feita fora do builder (ex.: tenda do ginásio)
    } else if (spec.roofShape === 'hip') {
      const o = obbOf(outer);
      if (spec.rings.length === 1 && o.fill > 0.72) addHipRoofOBB(G('roofTile'), outer, top, roofColor);
      else addHipRoofInset(G('roofTile'), spec.rings, top, roofColor);
    } else if (spec.roofShape === 'pyramid' && spec.rings.length === 1 && outer.length <= 10 && isConvex(outer)) {
      let minDim = Infinity;
      for (const [x, z] of outer) minDim = Math.min(minDim, Math.hypot(x - cx, z - cz));
      addPyramidRoof(G('roofTile'), outer, top, Math.min(2.4, Math.max(0.8, minDim * 0.55)), roofColor);
    } else {
      addFlatRoof(G(spec.roofShape === 'tileFlat' ? 'roofTile' : 'roofFlat'), spec.rings, top, roofColor);
      // platibanda (mureta) em volta da laje
      if (style !== 'glass' && !spec.noParapet) addWalls(G('roofFlat'), outer, outerSign, top, top + 0.5, top, 10, 10, roofColor);
      if (spec.waterTank) tanks.push({ x: cx + (spec.tankOff?.[0] || 0), z: cz + (spec.tankOff?.[1] || 0), y: top });
    }

    // colisão (segmentos da planta) e minimapa
    const segs = [];
    for (const ring of spec.rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        segs.push([a[0], a[1], b[0], b[1]]);
      }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const col = { segs, top, rings: spec.rings, minX, minZ, maxX, maxZ };
    colliders.insertBox(col, minX, minZ, maxX, maxZ);
    footprints.push({ rings: spec.rings, procedural: !!spec.procedural, color: style });
    return { gMin, gMax, top, cx, cz };
  }

  /** colisão (e planta no minimapa) para um volume qualquer feito fora do builder */
  function addSolid(rings, top, footprintStyle = null) {
    const segs = [];
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        segs.push([a[0], a[1], b[0], b[1]]);
      }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    colliders.insertBox({ segs, top, rings, minX, minZ, maxX, maxZ }, minX, minZ, maxX, maxZ);
    if (footprintStyle) footprints.push({ rings, procedural: false, color: footprintStyle });
  }

  function finish(scene) {
    const tex = {
      house: facadeTexture(renderer, 'house'),
      tower: facadeTexture(renderer, 'tower'),
      glass: facadeTexture(renderer, 'glass'),
      roofTile: options.roofTextures?.roofTile || roofTexture(renderer, 'tile'),
      roofFlat: options.roofTextures?.roofFlat || roofTexture(renderer, 'flat'),
    };
    for (const [k, st] of Object.entries(extra)) tex[k] = st.texture;
    const matOpts = {
      house: { roughness: 0.9, metalness: 0 },
      tower: { roughness: 0.75, metalness: 0.05 },
      glass: { roughness: 0.25, metalness: 0.35, envMapIntensity: 1.2 },
      roofTile: { roughness: 0.85, metalness: 0 },
      roofFlat: { roughness: 0.95, metalness: 0 },
    };
    for (const [k, st] of Object.entries(extra)) matOpts[k] = st.mat || { roughness: 0.85, metalness: 0 };
    const mats = {};
    const root = new THREE.Group();
    root.name = 'predios';
    for (const g of groups.values()) {
      if (!g.pos.length) continue;
      const k = g.style;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      geo.computeBoundingSphere();
      mats[k] ||= new THREE.MeshStandardMaterial({ map: tex[k], vertexColors: true, ...matOpts[k] });
      const mat = mats[k];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = k;
      root.add(mesh);
    }
    if (tanks.length) {
      const tg = new THREE.CylinderGeometry(0.75, 0.65, 1.1, 14);
      tg.translate(0, 0.55, 0);
      const im = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x2c6bb8, roughness: 0.5 }), tanks.length);
      const m = new THREE.Matrix4();
      tanks.forEach((t, i) => im.setMatrixAt(i, m.makeTranslation(t.x, t.y, t.z)));
      im.castShadow = true;
      im.name = 'caixas-dagua';
      root.add(im);
    }
    if (columns.length) {
      const cg = new THREE.CylinderGeometry(0.22, 0.22, 1, 8);
      cg.translate(0, 0.5, 0);
      const im = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.6 }), columns.length);
      const m = new THREE.Matrix4();
      columns.forEach((c, i) => im.setMatrixAt(i, m.makeScale(1, c.y1 - c.y0, 1).setPosition(c.x, c.y0, c.z)));
      im.castShadow = true;
      root.add(im);
    }
    scene.add(root);
    return root;
  }

  /** muro/grade: só colisão (a malha é feita em props.js) */
  function addBarrier(pts, h) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const top = Math.max(terrain.heightAt(ax, az), terrain.heightAt(bx, bz)) + h;
      colliders.insertBox({ segs: [[ax, az, bx, bz]], top, rings: null, minX: Math.min(ax, bx), minZ: Math.min(az, bz), maxX: Math.max(ax, bx), maxZ: Math.max(az, bz) },
        Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    }
  }

  /** Empurra um círculo (x,z,raio) para fora das paredes. Retorna [x,z]. */
  function collide(x, z, radius, feetY) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of colliders.query(x, z, radius + 1)) {
        if (feetY > c.top - 0.3) continue; // em cima do telhado
        if (x < c.minX - radius || x > c.maxX + radius || z < c.minZ - radius || z > c.maxZ + radius) continue;
        // dentro da planta (ex.: nasceu lá dentro) -> empurra pela parede mais próxima
        const inside = c.rings ? pointInPolygon(x, z, c.rings) : false;
        let bestD = Infinity, bx = 0, bz = 0;
        for (const [ax, az, ex, ez] of c.segs) {
          const dx = ex - ax, dz = ez - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const px = ax + dx * t, pz = az + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < bestD) { bestD = d; bx = px; bz = pz; }
        }
        if (inside || bestD < radius) {
          let nx = x - bx, nz = z - bz;
          const l = Math.hypot(nx, nz) || 1;
          nx /= l; nz /= l;
          if (inside) { nx = -nx; nz = -nz; }
          const push = inside ? bestD + radius : radius - bestD;
          x += nx * push; z += nz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  /** topo do prédio sob (x,z) — para andar em telhados quando estiver em cima */
  function roofAt(x, z, feetY) {
    let best = -Infinity;
    for (const c of colliders.query(x, z, 0)) {
      if (c.top > feetY + 0.6) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.rings && pointInPolygon(x, z, c.rings) && c.top > best) best = c.top;
    }
    return best;
  }

  return { add, addSolid, addBarrier, finish, collide, roofAt, footprints, count: () => footprints.length };
}
