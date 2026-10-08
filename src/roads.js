import * as THREE from 'three';
import { roadTexture, pavementTexture, ROAD_TILE_M } from './textures.js';
import { SpatialGrid, distToSegment } from './geo.js';
import { resampleRoad, roadFrames, offsetPoint, stripQuad, subtractConvex, triangleHeightAt } from './road-geometry.js';

// Vias de carro viram fitas 3D apoiadas no relevo (3 vértices por seção: borda, eixo, borda).
// Pontes/viadutos ganham tabuleiro reto entre as cabeceiras, guarda-corpo e pilares.

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

function textureKey(r) {
  if (r.internal && !r.bridge) return 'service:0'; // physical centre paint is emitted for every campus street below
  if (r.kind === 'twoway') return `twoway:${r.lanes >= 4 ? 4 : 2}`;
  if (r.kind === 'oneway') return `oneway:${Math.min(5, Math.max(1, r.lanes))}`;
  return `${r.kind}:0`;
}

// Pontes no OSM costumam vir quebradas em vários trechos. Encadeia os trechos ligados
// para o tabuleiro ir reto de uma cabeceira real à outra (sem "afundar" nas emendas).
function bridgeChains(roads, terrain) {
  const key = (p) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);
  const len = (r) => { let L = 0; for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); return L; };
  const bridges = roads.filter((r) => r.bridge);
  const byEnd = new Map();
  for (const r of bridges)
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
      const k = key(p);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push(r);
    }
  const info = new Map();
  for (const r of bridges) {
    if (info.has(r)) continue;
    const used = new Set([r]);
    const chain = [{ r, rev: false }];
    // estende para frente (a partir do fim) e para trás (a partir do início)
    for (const dir of ['fwd', 'back']) {
      let k = dir === 'fwd' ? key(r.pts[r.pts.length - 1]) : key(r.pts[0]);
      for (;;) {
        const next = (byEnd.get(k) || []).find((o) => !used.has(o) && o.layer === r.layer);
        if (!next) break;
        used.add(next);
        const startsHere = key(next.pts[0]) === k;
        const otherEnd = startsHere ? next.pts[next.pts.length - 1] : next.pts[0];
        if (dir === 'fwd') chain.push({ r: next, rev: !startsHere });
        else chain.unshift({ r: next, rev: startsHere });
        k = key(otherEnd);
      }
    }
    const first = chain[0], last = chain[chain.length - 1];
    const p0 = first.rev ? first.r.pts[first.r.pts.length - 1] : first.r.pts[0];
    const p1 = last.rev ? last.r.pts[0] : last.r.pts[last.r.pts.length - 1];
    const H0 = terrain.heightAt(p0[0], p0[1]), H1 = terrain.heightAt(p1[0], p1[1]);
    const total = chain.reduce((s, c) => s + len(c.r), 0);
    let off = 0;
    for (const c of chain) {
      const L = len(c.r);
      info.set(c.r, { off, L, total, H0, H1, rev: c.rev });
      off += L;
    }
  }
  return info;
}

export function buildRoads(world, terrain, renderer) {
  // A separate, deterministic surface elevation also separates equal-priority roads
  // at their overlapping OSM junctions (polygonOffset alone cannot do that).
  const roadLifts = new Map(world.roads.map((r, i) => [r, (r.internal ? .24 : 0.07 + r.order * 0.014) + i * 0.00004]));
  const chains = bridgeChains(world.roads, terrain);
  const texCache = new Map();
  const getTex = (key) => {
    if (!texCache.has(key)) {
      const [kind, lanes] = key.split(':');
      texCache.set(key, kind === 'foot' ? pavementTexture(renderer) : roadTexture(renderer, kind, +lanes));
    }
    return texCache.get(key);
  };

  const groups = new Map();
  const group = (key, order) => {
    const gk = `${key}|${order}`;
    if (!groups.has(gk)) groups.set(gk, { key, order, pos: [], uv: [], idx: [] });
    return groups.get(gk);
  };
  const concrete = { pos: [], idx: [] };
  const pillars = [];
  const bridges = []; // segmentos com altura do tabuleiro para o jogador andar por cima
  const streetIndex = new SpatialGrid(24);
  const roadSurfaces = new SpatialGrid(12);
  const roadGround = (r, x, z) => r.internal && terrain.roadHeightAt ? terrain.roadHeightAt(r, x, z) : terrain.heightAt(x, z);

  for (const r of world.roads) {
    // índice de nomes de rua (para o HUD)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      streetIndex.insertBox({ r, ax, az, bx, bz }, Math.min(ax, bx) - r.w, Math.min(az, bz) - r.w, Math.max(ax, bx) + r.w, Math.max(az, bz) + r.w);
    }
    if (r.kind === 'foot' && !r.bridge) continue;

    const pts = resample(r.pts, 2.5);
    const n = pts.length;
    const hw = r.w / 2;
    const lift = roadLifts.get(r);

    // comprimento acumulado
    const acc = [0];
    for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = acc[n - 1];

    // altura do tabuleiro (pontes): reta entre as cabeceiras da ponte inteira,
    // nunca abaixo do chão
    let deck = null;
    if (r.bridge) {
      const c = chains.get(r);
      deck = acc.map((a, i) => {
        const s = c.off + (c.rev ? total - a : a);
        const lin = c.H0 + (c.H1 - c.H0) * (c.total > 0 ? s / c.total : 0);
        return Math.max(lin, terrain.heightAt(pts[i][0], pts[i][1]) + 0.05) + 0.15;
      });
    }

    const g = group(textureKey(r), r.order);
    const base = g.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [px, pz] = pts[i];
      // tangente média + compensação de quina (miter)
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      let nx = -tz, nz = tx;
      let miter = 1;
      if (i > 0 && i < n - 1) {
        const sx = pts[i][0] - pts[i - 1][0], sz = pts[i][1] - pts[i - 1][1];
        const sl = Math.hypot(sx, sz) || 1;
        miter = 1 / Math.max(0.5, Math.abs(nx * (-sz / sl) + nz * (sx / sl)));
      }
      nx *= hw * miter; nz *= hw * miter;
      const v = acc[i] / ROAD_TILE_M;
      const L = [px + nx, pz + nz], C = [px, pz], R = [px - nx, pz - nz];
      for (const [k, q] of [[0, L], [0.5, C], [1, R]]) {
        const y = deck ? deck[i] : (r.internal ? roadGround(r, px, pz) : terrain.heightAt(q[0], q[1])) + lift;
        g.pos.push(q[0], y, q[1]);
        g.uv.push(k, v);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 3, b = a + 3;
      // faixas (L,C) e (C,R) — ordem anti-horária vista de cima (normal +y)
      g.idx.push(a + 1, a, b, a + 1, b, b + 1);
      g.idx.push(a + 2, a + 1, b + 1, a + 2, b + 1, b + 2);
      if (r.internal && !deck) for (const indices of [[a + 1, a, b], [a + 1, b, b + 1], [a + 2, a + 1, b + 1], [a + 2, b + 1, b + 2]]) {
        const triangle = indices.map(index => g.pos.slice(index * 3, index * 3 + 3));
        roadSurfaces.insertBox(triangle, Math.min(...triangle.map(v => v[0])), Math.min(...triangle.map(v => v[2])), Math.max(...triangle.map(v => v[0])), Math.max(...triangle.map(v => v[2])));
      }
    }

    if (deck) {
      // laterais do tabuleiro + guarda-corpo (concreto)
      const vb = concrete.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const gi = (base + i * 3) * 3;
        const Lx = g.pos[gi], Ly = g.pos[gi + 1], Lz = g.pos[gi + 2];
        const Rx = g.pos[gi + 6], Ry = g.pos[gi + 7], Rz = g.pos[gi + 8];
        concrete.pos.push(Lx, Ly - 1.0, Lz, Lx, Ly + 0.9, Lz, Rx, Ry - 1.0, Rz, Rx, Ry + 0.9, Rz);
      }
      for (let i = 0; i < n - 1; i++) {
        const a = vb + i * 4, b = a + 4;
        concrete.idx.push(a, b, a + 1, a + 1, b, b + 1); // lado esquerdo
        concrete.idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // lado direito
      }
      // pilares onde o vão é alto
      for (let i = 0; i < n; i += 6) {
        const [px, pz] = pts[i];
        const gnd = terrain.heightAt(px, pz);
        if (deck[i] - gnd > 2.8) pillars.push({ x: px, z: pz, y0: gnd - 0.5, y1: deck[i] - 0.8 });
      }
      for (let i = 0; i < n - 1; i++)
        bridges.push({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], ya: deck[i], yb: deck[i + 1], hw });
    }
  }

  const root = new THREE.Group();
  root.name = 'vias';
  for (const gr of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(gr.uv, 2));
    geo.setIndex(gr.idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: getTex(gr.key),
      roughness: 0.92,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2 - gr.order * 2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = gr.order;
    root.add(mesh);
  }
  if (concrete.idx.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(concrete.pos, 3));
    geo.setIndex(concrete.idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xa3a19b, roughness: 0.85, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (pillars.length) {
    const pg = new THREE.CylinderGeometry(0.7, 0.8, 1, 10);
    pg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.9 }), pillars.length);
    const m = new THREE.Matrix4();
    pillars.forEach((p, i) => {
      m.makeScale(1, p.y1 - p.y0, 1).setPosition(p.x, p.y0, p.z);
      im.setMatrixAt(i, m);
    });
    im.castShadow = im.receiveShadow = true;
    root.add(im);
  }

  const sidewalks = buildCampusSidewalks(world, terrain, renderer, roadLifts);
  root.add(sidewalks.root);

  const bridgeGrid = new SpatialGrid(16);
  for (const b of bridges)
    bridgeGrid.insertBox(b, Math.min(b.ax, b.bx) - b.hw, Math.min(b.az, b.bz) - b.hw, Math.max(b.ax, b.bx) + b.hw, Math.max(b.az, b.bz) + b.hw);

  /** altura do tabuleiro de ponte em (x,z), se houver uma abaixo de maxY */
  function bridgeHeightAt(x, z, maxY) {
    let best = -Infinity;
    for (const b of bridgeGrid.query(x, z)) {
      const q = distToSegment(x, z, b.ax, b.az, b.bx, b.bz);
      if (q.d > b.hw + 0.3) continue;
      const y = b.ya + (b.yb - b.ya) * q.t;
      if (y <= maxY && y > best) best = y;
    }
    return best;
  }

  /** via mais próxima com nome (para o HUD) */
  function streetAt(x, z) {
    let best = null, bd = Infinity;
    for (const s of streetIndex.query(x, z, 2)) {
      if (!s.r.name) continue;
      const { d } = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
      const dd = d - s.r.w / 2;
      if (dd < bd) { bd = dd; best = s.r; }
    }
    return bd < 18 ? best : null;
  }

  function surfaceHeightAt(x, z, maxY = Infinity) {
    let best = sidewalks.heightAt(x, z, maxY);
    for (const triangle of roadSurfaces.query(x, z)) {
      const y = triangleHeightAt(x, z, ...triangle);
      if (y !== undefined && y <= maxY) best = Math.max(best, y);
    }
    return best;
  }
  return { root, bridgeHeightAt, streetAt, surfaceHeightAt, sidewalkHeightAt: sidewalks.heightAt, sidewalkStats: sidewalks.stats };
}

function buildCampusSidewalks(world, terrain, renderer, roadLifts) {
  const root = new THREE.Group();
  root.name = 'calcadas-cidade-de-deus';
  const roads = world.roads.filter((r) => r.kind !== 'foot' && !r.bridge);
  const footprints = new SpatialGrid(12), occupied = new SpatialGrid(8), surfaces = new SpatialGrid(8);
  const sidewalkPos = [], sidewalkUv = [], sidewalkIdx = [], curbPos = [], curbColors = [], curbIdx = [];
  const brickPos = [], brickUv = [], brickIdx = [], tactilePos = [], tactileIdx = [];
  const whitePos = [], whiteIdx = [], yellowPos = [], yellowIdx = [];
  const retainingPos = [], retainingIdx = [];
  const stats = { roads: 0, sidewalkArea: 0, curbMetres: 0, crossings: 0 };
  const roadGround = (r, x, z) => terrain.roadHeightAt ? terrain.roadHeightAt(r, x, z) : terrain.heightAt(x, z);
  const layout = new Map();
  const bounds = (polygon) => {
    const xs = polygon.map((p) => p[0]), zs = polygon.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  for (const r of roads) {
    const frames = roadFrames(resampleRoad(r.pts, 1.2));
    layout.set(r, frames);
    for (let i = 1; i < frames.length; i++) {
      const polygon = stripQuad(frames[i - 1], frames[i], -r.w / 2, r.w / 2);
      const bb = bounds(polygon);
      footprints.insertBox({ r, polygon, bb }, bb.x0, bb.z0, bb.x1, bb.z1);
    }
  }
  const signedArea = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
  const clipToRoads = (polygon, r, overlap = false) => {
    const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length, cz = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    let pieces = [polygon];
    const bb = bounds(polygon);
    const intersects = (other) => other.x1 > bb.x0 + 1e-7 && other.x0 < bb.x1 - 1e-7 && other.z1 > bb.z0 + 1e-7 && other.z0 < bb.z1 - 1e-7;
    for (const obstacle of footprints.query(cx, cz, 5)) {
      if (obstacle.r === r || !intersects(obstacle.bb)) continue;
      pieces = pieces.flatMap((p) => subtractConvex(p, obstacle.polygon));
      if (!pieces.length) break;
    }
    if (overlap) for (const obstacle of occupied.query(cx, cz, 5)) {
      if (obstacle.r === r || !intersects(obstacle.bb)) continue;
      pieces = pieces.flatMap((p) => subtractConvex(p, obstacle.polygon));
      if (!pieces.length) break;
    }
    return pieces;
  };
  const addPolygon = (polygon, yAt, pos, idx, uv, color, reference) => {
    if (polygon.length < 3 || Math.abs(signedArea(polygon)) < 1e-6) return;
    // Fan triangles face upwards regardless of the road's direction or sidewalk side.
    const p = signedArea(polygon) > 0 ? [...polygon].reverse() : polygon;
    const base = pos.length / 3, vertices = [];
    for (const [x, z] of p) {
      const y = yAt(x, z); pos.push(x, y, z); vertices.push([x, y, z]);
      if (uv) uv.push(x / 4, z / 4); // reference photo: roughly 1 m concrete slabs
      if (color) curbColors.push(color.r, color.g, color.b);
    }
    for (let i = 1; i < p.length - 1; i++) {
      idx.push(base, base + i, base + i + 1);
      if (reference) {
        const triangle = [vertices[0], vertices[i], vertices[i + 1]];
        surfaces.insertBox(triangle, Math.min(...triangle.map((v) => v[0])), Math.min(...triangle.map((v) => v[2])), Math.max(...triangle.map((v) => v[0])), Math.max(...triangle.map((v) => v[2])));
      }
    }
  };
  const markedCrossings = [];
  for (const r of roads.filter((r) => r.internal && r.name && !['parking_aisle', 'driveway'].includes(r.tags?.service))) {
    const frames = layout.get(r), total = frames.at(-1)?.distance || 0;
    if (total < 32) continue;
    const crossings = [];
    for (let at = Math.min(25, total / 2); at < total - 10; at += 85) {
      const f = frames.reduce((best, q) => Math.abs(q.distance - at) < Math.abs(best.distance - at) ? q : best, frames[0]);
      // Keep the crossing outside other carriageways, including a T junction.
      if ([...footprints.query(f.x, f.z, 4)].some((o) => o.r !== r && o.polygon.some((p) => Math.hypot(p[0] - f.x, p[1] - f.z) < 4.2))) continue;
      crossings.push(f.distance); markedCrossings.push({ r, f }); stats.crossings++;
    }
    r.sidewalkCrossings = crossings;
  }
  for (const r of roads.filter((r) => r.internal)) {
    const frames = layout.get(r);
    if (frames.length < 2) continue;
    stats.roads++;
    const width = r.tags?.service === 'parking_aisle' ? 1.4 : 2.5, hw = r.w / 2;
    const lift = roadLifts.get(r), crossings = r.sidewalkCrossings || [];
    const crossingFrames = crossings.map((at) => frames.reduce((best, q) => Math.abs(q.distance - at) < Math.abs(best.distance - at) ? q : best, frames[0]));
    const sidewalkY = (x, z) => {
      let distance = Infinity, lateral = Infinity;
      for (const f of crossingFrames) {
        const along = Math.abs((x - f.x) * f.tx + (z - f.z) * f.tz);
        if (along < distance) { distance = along; lateral = Math.abs(-(x - f.x) * f.tz + (z - f.z) * f.tx) - hw; }
      }
      // A dropped kerb and shallow 1.5 m ramp at each zebra crossing.
      const ramp = distance < 1.65 ? Math.min(1, Math.max(0, lateral / 1.5)) : 1;
      return roadGround(r, x, z) + lift + 0.025 + 0.145 * ramp;
    };
    for (let i = 1; i < frames.length; i++) for (const side of [-1, 1]) {
      const a = frames[i - 1], b = frames[i];
      const sidewalk = stripQuad(a, b, side * (hw + 0.2), side * (hw + width));
      for (const p of clipToRoads(sidewalk, r, true)) {
        addPolygon(p, sidewalkY, sidewalkPos, sidewalkIdx, sidewalkUv, null, true);
        stats.sidewalkArea += Math.abs(signedArea(p));
      }
      for (const p of clipToRoads(stripQuad(a, b, side * (hw + width - 0.16), side * (hw + width)), r, true))
        addPolygon(p, (x, z) => sidewalkY(x, z) + 0.012, brickPos, brickIdx, brickUv);
      const curb = stripQuad(a, b, side * hw, side * (hw + 0.2));
      const color = new THREE.Color(Math.floor((a.distance + b.distance) / 2 / 1.1) % 2 ? 0x4b4b48 : 0xe6e3d9);
      for (const p of clipToRoads(curb, r, true)) {
        addPolygon(p, (x, z) => sidewalkY(x, z) + 0.005, curbPos, curbIdx, null, color, true);
        // A physical kerb face, rather than a flat stripe painted into the ground.
        for (let e = 0; e < p.length; e++) {
          const pa = p[e], pb = p[(e + 1) % p.length], k = curbPos.length / 3;
          const edgeL = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          // Adjacent sections share their ends; emitting both caps causes flicker.
          if (edgeL < 1e-5 || Math.abs((pb[0] - pa[0]) * a.tx + (pb[1] - pa[1]) * a.tz) < edgeL * 0.5) continue;
          const ya = sidewalkY(...pa), yb = sidewalkY(...pb), bottomA = roadGround(r, ...pa) + lift, bottomB = roadGround(r, ...pb) + lift;
          curbPos.push(pa[0], ya, pa[1], pb[0], yb, pb[1], pb[0], bottomB, pb[1], pa[0], bottomA, pa[1]);
          for (let v = 0; v < 4; v++) curbColors.push(color.r, color.g, color.b);
          curbIdx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        }
        stats.curbMetres += Math.abs(signedArea(p)) / 0.2;
      }
      for (const polygon of clipToRoads(stripQuad(a, b, side * hw, side * (hw + width)), r, true)) {
        const bb = bounds(polygon);
        occupied.insertBox({ r, polygon, bb }, bb.x0, bb.z0, bb.x1, bb.z1);
      }
      // Close the engineered platform against the remaining natural hillside.
      // This is the real retained side of a graded road, not a floating ribbon.
      const edgeA = offsetPoint(a, side * (hw + width)), edgeB = offsetPoint(b, side * (hw + width));
      const vx = edgeB[0] - edgeA[0], vz = edgeB[1] - edgeA[1], edgeLength2 = vx * vx + vz * vz;
      for (const p of clipToRoads(stripQuad(a, b, side * (hw + width - .01), side * (hw + width)), r, true)) {
        const parameters = p.map(q => ((q[0] - edgeA[0]) * vx + (q[1] - edgeA[1]) * vz) / Math.max(.001, edgeLength2));
        const start = Math.max(0, Math.min(...parameters)), end = Math.min(1, Math.max(...parameters));
        if (end - start < .001) continue;
        const pa = [edgeA[0] + vx * start, edgeA[1] + vz * start], pb = [edgeA[0] + vx * end, edgeA[1] + vz * end];
        const ya = sidewalkY(...pa), yb = sidewalkY(...pb);
        const ga = Math.min(ya, terrain.heightAt(...pa) - .05), gb = Math.min(yb, terrain.heightAt(...pb) - .05);
        const k = retainingPos.length / 3;
        retainingPos.push(pa[0], ya, pa[1], pb[0], yb, pb[1], pb[0], gb, pb[1], pa[0], ga, pa[1]);
        retainingIdx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
    }
    {
      // Campus streets were all classified as service in OSM, losing their paint.
      for (let i = 1; i < frames.length; i++) for (const offset of [-0.13, 0.13]) {
        const a = frames[i - 1], b = frames[i];
        if (crossings.some((at) => Math.abs((a.distance + b.distance) / 2 - at) < 2.1)) continue;
        for (const p of clipToRoads(stripQuad(a, b, offset - 0.045, offset + 0.045), r))
          addPolygon(p, (x, z) => roadGround(r, x, z) + lift + 0.018, yellowPos, yellowIdx);
      }
    }
  }
  for (const { r, f } of markedCrossings) {
    const at = (along, across) => [f.x + f.tx * along - f.tz * across, f.z + f.tz * along + f.tx * across];
    for (let across = -r.w / 2 + 0.25; across < r.w / 2 - 0.3; across += 0.85) {
      addPolygon([at(-1.5, across), at(-1.5, across + 0.48), at(1.5, across + 0.48), at(1.5, across)], (x, z) => roadGround(r, x, z) + roadLifts.get(r) + 0.024, whitePos, whiteIdx);
    }
    for (const side of [-1, 1]) {
      const inner = side * (r.w / 2 + 0.25), outer = side * (r.w / 2 + 0.75);
      for (const p of clipToRoads([at(-0.55, inner), at(0.55, inner), at(0.55, outer), at(-0.55, outer)], r))
        addPolygon(p, (x, z) => roadGround(r, x, z) + roadLifts.get(r) + 0.025 + 0.145 * Math.abs(-(x - f.x) * f.tz + (z - f.z) * f.tx - side * r.w / 2) / 1.5 + 0.014, tactilePos, tactileIdx);
    }
  }
  const makeMesh = (name, pos, idx, mat, uv, colors) => {
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat); mesh.name = name; mesh.receiveShadow = true;
    root.add(mesh);
  };
  makeMesh('calcadas-lajes-concreto', sidewalkPos, sidewalkIdx, new THREE.MeshStandardMaterial({ map: pavementTexture(renderer), color: 0xe9dfc8, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), sidewalkUv);
  makeMesh('meios-fios-bicolor', curbPos, curbIdx, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), null, curbColors);
  makeMesh('contencao-vias-campus', retainingPos, retainingIdx, new THREE.MeshStandardMaterial({ color: 0x98958a, roughness: .97, side: THREE.DoubleSide }));
  makeMesh('bordas-tijolos-calcada', brickPos, brickIdx, new THREE.MeshStandardMaterial({ map: pavementTexture(renderer), color: 0xb89a82, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }), brickUv.map((u) => u * 4));
  makeMesh('piso-alerta-rampas', tactilePos, tactileIdx, new THREE.MeshStandardMaterial({ color: 0xdab74e, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
  makeMesh('faixas-pedestres', whitePos, whiteIdx, new THREE.MeshStandardMaterial({ color: 0xf1eee2, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  makeMesh('eixos-amarelos-campus', yellowPos, yellowIdx, new THREE.MeshStandardMaterial({ color: 0xe7c347, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 }));
  const heightAt = (x, z, maxY = Infinity) => {
    let best = -Infinity;
    for (const t of surfaces.query(x, z)) {
      const y = triangleHeightAt(x, z, ...t);
      if (y !== undefined && y <= maxY && y > best) best = y;
    }
    return best;
  };
  return { root, heightAt, stats };
}
