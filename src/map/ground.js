import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';

// Pinta o "chão" (uso do solo, calçadas, rios, praças...) numa textura grande que é
// drapeada sobre o terreno. Também gera máscaras de ocupação (1 px = 1 m) usadas para
// posicionar árvores e o preenchimento procedural sem invadir ruas, prédios ou água.

const AREA_STYLE = {
  residential: '#a29d8f',
  campus: '#6f9a4b',
  lawn: '#7cab55',
  deck: '#d6c4a0',
  tennis: '#3f8a5c',
  retail: '#a8a29a',
  industrial: '#9a958d',
  school: '#b2a88e',
  plaza: '#bdb7aa',
  parking: '#6b6c6f',
  grass: '#6f9a45',
  scrub: '#6a7a3d',
  park: '#5e963c',
  golf: '#6fa547',
  sports: '#8da078',
  playground: '#c6aa7a',
  pitch: '#4b8a38',
  track: '#b4533a',
  court: '#b8643c',
  wood: '#3f6a2b',
  water: '#2f6d9b',
  pool: '#39a3cf',
};
// ordem de pintura (o último fica por cima)
const AREA_ORDER = ['campus', 'residential', 'retail', 'industrial', 'school', 'sports', 'grass', 'scrub', 'park', 'golf', 'lawn', 'wood', 'plaza', 'deck', 'parking', 'playground', 'track', 'pitch', 'court', 'tennis', 'water', 'pool'];

// áreas onde NÃO se inventa casa
const NO_BUILD = new Set(['lawn', 'deck', 'tennis', 'track', 'court', 'school', 'industrial', 'plaza', 'parking', 'grass', 'scrub', 'park', 'golf', 'sports', 'playground', 'pitch', 'wood', 'water', 'pool']);
// áreas onde NÃO nasce árvore espontânea
const NO_TREE = new Set(['deck', 'tennis', 'track', 'court', 'plaza', 'parking', 'playground', 'pitch', 'water', 'pool']);

/**
 * Pinta o retângulo `bounds` ({x0, z0, width, depth}, em metros) numa textura de até
 * `maxPx` px no lado maior. Usado para o mapa inteiro e, em alta resolução, só para o campus.
 */
export function paintGround(world, bounds, renderer, maxPx = 4096) {
  const { x0, z0, width, depth } = bounds;
  const s = Math.min(maxPx / width, maxPx / depth); // px por metro
  const W = Math.round(width * s), H = Math.round(depth * s);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const P = (p) => [(p[0] - x0) * s, (p[1] - z0) * s];

  const pathRings = (ctx, rings, sc, px) => {
    ctx.beginPath();
    for (const r of rings) {
      r.forEach((p, i) => { const [a, b] = px(p); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.closePath();
    }
  };
  const pathLine = (ctx, pts, px) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const [a, b] = px(p); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
  };

  // base: terreno urbano (terra/concreto/grama seca)
  g.fillStyle = '#948f78';
  g.fillRect(0, 0, W, H);
  // variação de larga escala
  for (const b of worldBlobs(world)) {
    const [x, y] = P([b.x, b.z]);
    if (x < -b.r * s || y < -b.r * s || x > W + b.r * s || y > H + b.r * s) continue;
    g.fillStyle = b.color;
    g.beginPath(); g.arc(x, y, b.r * s, 0, Math.PI * 2); g.fill();
  }

  g.lineJoin = 'round';
  g.lineCap = 'round';

  // áreas de uso do solo
  for (const kind of AREA_ORDER)
    for (const a of world.areas) {
      if (a.kind !== kind) continue;
      g.fillStyle = a.color || AREA_STYLE[kind];
      pathRings(g, a.rings, s, P);
      g.fill('evenodd');
      if (kind === 'tennis') {
        // quadra de tênis: piso verde com faixa externa vermelha
        g.strokeStyle = '#b8573a';
        g.lineWidth = 3.2 * s;
        g.stroke();
      }
      if (kind === 'golf') {
        // faixas de corte da grama
        g.save(); g.clip('evenodd');
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let x = -H; x < W; x += 14 * s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 7 * s, 0); g.lineTo(x + 7 * s + H, H); g.lineTo(x + H, H); g.fill(); }
        g.restore();
      }
      if (a.lanes) {
        // raias da pista de atletismo
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = Math.max(1, 0.08 * s);
        for (const lane of a.lanes) { pathRings(g, [lane], s, P); g.stroke(); }
      }
      if (kind === 'pitch' || kind === 'court' || kind === 'tennis') {
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1, 0.15 * s);
        pathRings(g, [a.rings[0]], s, P);
        g.stroke();
      }
      if (kind === 'pool' || kind === 'water') {
        g.strokeStyle = kind === 'pool' ? '#e8e4da' : '#5b6e45';
        g.lineWidth = (kind === 'pool' ? 0.8 : 2) * s;
        pathRings(g, a.rings, s, P);
        g.stroke();
      }
      if (kind === 'parking') {
        g.strokeStyle = '#8c8d90';
        g.lineWidth = 0.5 * s;
        pathRings(g, a.rings, s, P);
        g.stroke();
      }
    }

  // linhas extras pintadas no chão (vagas de estacionamento, marcações)
  for (const e of world.paintExtras || []) {
    g.strokeStyle = e.color;
    g.lineWidth = Math.max(1, e.width * s);
    g.lineCap = 'butt';
    g.beginPath();
    for (const [a, b] of e.segments) { const [x1, y1] = P(a), [x2, y2] = P(b); g.moveTo(x1, y1); g.lineTo(x2, y2); }
    g.stroke();
    g.lineCap = 'round';
  }

  // rios e córregos a céu aberto
  for (const w of world.waterways) {
    g.strokeStyle = '#4d6538'; g.lineWidth = (w.w + 4) * s; pathLine(g, w.pts, P); g.stroke();
    g.strokeStyle = '#2b5c80'; g.lineWidth = w.w * s; pathLine(g, w.pts, P); g.stroke();
  }

  // calçadas sob as vias de carro (a pista em si é uma malha 3D por cima)
  const carRoads = world.roads.filter((r) => r.kind !== 'foot');
  g.strokeStyle = '#7c7a73';
  for (const r of carRoads) {
    if (r.kind === 'service' || r.bridge) continue;
    g.lineWidth = (r.w + 5.2) * s; pathLine(g, r.pts, P); g.stroke();
  }
  g.strokeStyle = '#b8b3a7';
  for (const r of carRoads) {
    if (r.kind === 'service' || r.bridge) continue;
    g.lineWidth = (r.w + 4.6) * s; pathLine(g, r.pts, P); g.stroke();
  }
  // asfalto também no chão (evita frestas nas bordas das malhas)
  g.strokeStyle = '#4c4e52';
  for (const r of carRoads) { if (r.bridge) continue; g.lineWidth = r.w * s; pathLine(g, r.pts, P); g.stroke(); }

  // caminhos de pedestre
  for (const r of world.roads) {
    if (r.kind !== 'foot' || r.bridge) continue;
    g.strokeStyle = r.highway === 'steps' ? '#a59f92' : r.highway === 'path' ? '#b19c78' : '#c3bdb0';
    g.lineWidth = r.w * s; pathLine(g, r.pts, P); g.stroke();
  }

  // granulado fino
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const nr = mulberry32(77);
  for (let i = 0; i < d.length; i += 4) {
    const n = (nr() - 0.5) * 18;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  return { texture: tex, canvas: c, pxPerM: s };
}

// ---------------------------------------------------------------- máscaras de ocupação
// manchas de variação do chão, em coordenadas do mundo (as mesmas em qualquer textura)
let blobCache = null;
function worldBlobs(world) {
  if (blobCache) return blobCache;
  const rnd = mulberry32(2024);
  const b = world.bounds;
  blobCache = [];
  for (let i = 0; i < 900; i++) {
    const green = rnd() < 0.55;
    blobCache.push({
      x: b.x0 + rnd() * b.width, z: b.z0 + rnd() * b.depth, r: 8 + rnd() * 40,
      color: green ? `rgba(95,130,60,${0.10 + rnd() * 0.15})` : `rgba(150,135,110,${0.10 + rnd() * 0.15})`,
    });
  }
  return blobCache;
}

export function buildMasks(world, bounds) {
  const { x0, z0, width, depth } = bounds;
  const W = Math.ceil(width), H = Math.ceil(depth);
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    g.lineJoin = 'round'; g.lineCap = 'round';
    return { c, g };
  };
  const P = (p) => [p[0] - x0, p[1] - z0];
  const poly = (g, rings) => {
    g.beginPath();
    for (const r of rings) { r.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); }
  };
  const line = (g, pts) => { g.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); };

  const build = mk(), tree = mk();

  for (const a of world.areas) {
    if (NO_BUILD.has(a.kind)) { poly(build.g, a.rings); build.g.fill('evenodd'); }
    if (NO_TREE.has(a.kind)) { poly(tree.g, a.rings); tree.g.fill('evenodd'); }
  }
  for (const r of world.roads) {
    build.g.lineWidth = r.w + (r.kind === 'foot' ? 1 : r.kind === 'service' ? 2 : 5);
    line(build.g, r.pts); build.g.stroke();
    tree.g.lineWidth = r.w + 0.6;
    line(tree.g, r.pts); tree.g.stroke();
  }
  for (const w of world.waterways) {
    build.g.lineWidth = w.w + 8; line(build.g, w.pts); build.g.stroke();
    tree.g.lineWidth = w.w + 1; line(tree.g, w.pts); tree.g.stroke();
  }
  for (const b of world.buildings) {
    poly(build.g, b.rings); build.g.fill('evenodd');
    build.g.lineWidth = 3; build.g.stroke();
    poly(tree.g, b.rings); tree.g.fill('evenodd');
    tree.g.lineWidth = 3; tree.g.stroke();
  }
  // margem de borda
  build.g.lineWidth = 16; build.g.strokeRect(0, 0, W, H);

  const read = ({ g }) => {
    const d = g.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
    return m;
  };

  const mask = (data) => ({
    data,
    get(x, z) {
      const i = Math.floor(x - x0), j = Math.floor(z - z0);
      if (i < 0 || j < 0 || i >= W || j >= H) return 1;
      return data[j * W + i];
    },
    set(x, z) {
      const i = Math.floor(x - x0), j = Math.floor(z - z0);
      if (i >= 0 && j >= 0 && i < W && j < H) data[j * W + i] = 1;
    },
  });
  return { build: mask(read(build)), tree: mask(read(tree)), W, H };
}
