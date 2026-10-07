import * as THREE from 'three';
import { roadTexture, pavementTexture, ROAD_TILE_M } from './textures.js';
import { SpatialGrid, distToSegment } from './geo.js';

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
    const lift = 0.07 + r.order * 0.014;

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
        const y = deck ? deck[i] : terrain.heightAt(q[0], q[1]) + lift;
        g.pos.push(q[0], y, q[1]);
        g.uv.push(k, v);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 3, b = a + 3;
      // faixas (L,C) e (C,R) — ordem anti-horária vista de cima (normal +y)
      g.idx.push(a + 1, a, b, a + 1, b, b + 1);
      g.idx.push(a + 2, a + 1, b + 1, a + 2, b + 1, b + 2);
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

  return { root, bridgeHeightAt, streetAt };
}
