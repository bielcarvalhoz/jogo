import { pointInPolygon, SpatialGrid, distToSegment } from '../shared/geo.js';
import { mulberry32 } from '../shared/rng.js';
import { createKit, frameAt, yawOf, toWorld, rectRing } from './landmark-kit.js';
import { standVolumes } from '../shared/stands.js';

// Área de convivência (lago, quiosques, estátua, campo, pista, quadras, arquibancada, vestiários,
// clube e piscinas). Medidas em scripts/campus/convivencia.json (vistas de topo do Google Earth);
// nenhuma imagem entra no jogo. Fluxo: prepareLeisure (planta) -> gradeLeisure (relevo) -> buildLeisure.

const LANE = 1.22, ROW_DEPTH = .8, WALK = .41, SIDEWALK = 2.5;
const C_CONCRETE = '#cfc6b2', C_SALMON = '#d9a47e', C_RED = '#b5553d', C_GREEN = '#4f9a6c', C_WHITE = '#f1efe8', C_STEEL = '#8d959b';
const C_DARK = '#33383d', C_WOOD = '#6b4a33', C_ROOF = '#96492f', C_STONE = '#9b9a94', C_BRONZE = '#5a4a39', C_STAND = '#efeee9', C_STAND2 = '#e0dfd8', C_AISLE = '#8b9096';
const C_FENCE = '#2f5f4b', C_NET = '#22262a', C_HEDGE = '#3f7d3a', C_TAN = '#c9a56b', C_BRICK = '#8f4f3a', C_BLUE = '#2f6fb5';

const isPair = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
/** converte recursivamente todo par [lat, lon] do levantamento em [x, z] locais */
const localize = (value, proj) => isPair(value) && Math.abs(value[0]) <= 90 && Math.abs(value[1]) > 30 ? proj.toLocal(value[1], value[0])
  : Array.isArray(value) ? value.map((v) => localize(v, proj)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localize(v, proj)])) : value;
const centroid = (ring) => ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
const unit = (a, b) => { const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d) || 1; return [d[0] / L, d[1] / L, L]; };
const circle = (c, r, n = 20) => Array.from({ length: n }, (_, i) => [c[0] + Math.cos(i / n * Math.PI * 2) * r, c[1] + Math.sin(i / n * Math.PI * 2) * r]);

/** pista: duas retas e duas curvas em volta do campo e das quadras (tênis ao norte, poliesportivas ao sul) */
export function trackShape(pitch, { centro, meiaReta, raioInterno, raias }) {
  const [ux, uz] = unit(pitch[0], pitch[3]), vx = uz, vz = -ux, S = meiaReta;
  const at = (u, v) => [centro[0] + ux * u + vx * v, centro[1] + uz * u + vz * v];
  const oval = (r, n = 30) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = -Math.PI / 2 + Math.PI * i / n; pts.push(at(S + Math.cos(t) * r, Math.sin(t) * r)); }
    for (let i = 0; i <= n; i++) { const t = Math.PI / 2 + Math.PI * i / n; pts.push(at(-S + Math.cos(t) * r, Math.sin(t) * r)); }
    return pts;
  };
  const rOut = raioInterno + raias * LANE;
  return { cx: centro[0], cz: centro[1], ux, uz, vx, vz, straight: S, rIn: raioInterno, rOut, at, oval, surveyed: true,
    outer: oval(rOut + .3), inner: oval(raioInterno - .3), lanes: Array.from({ length: raias + 1 }, (_, k) => oval(raioInterno + k * LANE)),
    /** distância (com sinal) até o eixo da pista: < rIn dentro do miolo, > rOut fora */
    radiusAt(x, z) { const u = (x - centro[0]) * ux + (z - centro[1]) * uz, v = (x - centro[0]) * vx + (z - centro[1]) * vz; return Math.hypot(Math.max(0, Math.abs(u) - S), v); } };
}

/** Planta: troca campo/quadras/piscinas/lago do OSM e da planta pelas formas levantadas. */
export function prepareLeisure(C, world, proj, layout) {
  const G = localize(layout, proj), T = trackShape(G.campo, G.pista), mid = centroid(G.campo);
  const zone = (ring) => Math.hypot(centroid(ring)[0] - mid[0], centroid(ring)[1] - mid[1]) < 175;
  world.areas = world.areas.filter((a) => a.id !== 'cdd/lago' && !(['pitch', 'tennis', 'pool', 'court', 'deck', 'track'].includes(a.kind) && zone(a.rings[0])));
  C.buildings = C.buildings.filter((b) => !(G.quadraLago && pointInPolygon(...centroid(b.rings[0]), [G.quadraLago.map((p, i, r) => { const c = centroid(r); return [c[0] + (p[0] - c[0]) * 1.05, c[1] + (p[1] - c[1]) * 1.05]; })])));
  const area = (kind, rings, color, extra = {}) => world.areas.push({ id: `cdd/convivencia-${kind}`, tags: {}, kind, rings, color, plain: true, ...extra });
  area('lawn', [T.inner], '#5f9a48');
  const pitchEnd = (G.campo[3][0] - T.cx) * T.ux + (G.campo[3][1] - T.cz) * T.uz + .9, arc = T.inner.slice(0, 31);
  G.patio = [T.at(pitchEnd, -(T.rIn - .3)), ...arc, T.at(pitchEnd, T.rIn - .3)];
  area('deck', [G.patio], C_CONCRETE);
  area('track', [T.outer, T.inner], '#b4533a');
  world.areas.push({ id: 'cdd/campo', tags: {}, kind: 'pitch', rings: [G.campo] });
  area('court', [G.tenis.piso], C_RED);
  for (const q of G.tenis.quadras) area('tennis', [q], C_GREEN);
  for (const q of G.quadras) area('tennis', [q.anel], C_GREEN);
  area('tennis', [G.quadraLago], '#58a98a');
  // terraço e passeio entre a pista e a arquibancada
  // terraço: entre a borda da pista e a frente da arquibancada (que acompanha a curva norte)
  const front = G.arquibancada.frente, R = T.rOut + .9;
  const edge = (p) => { const u = (p[0] - T.cx) * T.ux + (p[1] - T.cz) * T.uz, v = (p[0] - T.cx) * T.vx + (p[1] - T.cz) * T.vz; if (Math.abs(u) <= T.straight) return T.at(u, Math.sign(v) * R); const c = T.at(Math.sign(u) * T.straight, 0), d = unit(c, p); return [c[0] + d[0] * R, c[1] + d[1] * R]; };
  const dense = front.flatMap((p, i) => i ? [[(p[0] + front[i - 1][0]) / 2, (p[1] + front[i - 1][1]) / 2], p] : [p]);
  G.terraco.anel = [...dense, ...dense.slice().reverse().map(edge)];
  area('deck', [G.terraco.anel], C_SALMON);
  area('deck', [G.piscina.deck], '#dba27c');
  world.areas.push({ id: 'cdd/piscina', tags: {}, kind: 'pool', rings: [G.piscina.raias] }, { id: 'cdd/piscina', tags: {}, kind: 'pool', rings: [G.piscina.oeste, circle(G.piscina.ilha, 1.8, 14)] }, { id: 'cdd/piscina', tags: {}, kind: 'pool', rings: [G.piscina.leste] });
  world.areas.push({ id: 'cdd/lago', tags: { name: 'Lago' }, kind: 'water', rings: [G.lago], color: '#2c5b56', waterColor: 0x4a9c8f, lake: true });
  // vestiários (três águas brancas) e clube (telhado palha) ao lado do campo
  C.buildings.push({ kind: 'building', leisure: 'vestiario', levels: 2, height: 6.2, wall: '#f2f2ee', roof: '#f3f3f0', roofShape: 'hip', windows: '#2b3f55', rings: [G.vestiario], referenceAccess: true },
    { kind: 'building', leisure: 'clube', levels: 1, height: 4.4, wall: '#f3f1ea', roof: C_TAN, windows: '#3a3226', rings: [G.clube], referenceAccess: true, deckRoof: true });
  // palmeiras na margem leste/sul do lago e mata fechada na margem noroeste
  const rnd = mulberry32(4711), lake = G.lago, n = lake.length, lc = centroid(lake);
  for (let i = 0; i < n; i++) {
    const a = lake[i], b = lake[(i + 1) % n], [dx, dz, L] = unit(a, b), east = i <= 9;
    for (let s = east ? 2 : 3; s < L; s += east ? 5.5 : 6.5) {
      const p = [a[0] + dx * s, a[1] + dz * s], out = unit(lc, p), off = 2.2 + rnd() * (east ? 1.4 : 5), x = p[0] + out[0] * off, z = p[1] + out[1] * off;
      if (T.radiusAt(x, z) < T.rOut + 2.5 || pointInPolygon(x, z, [G.quadraLago]) || G.quiosques.some((k) => Math.hypot(k[0] - x, k[1] - z) < 4.5)) continue;
      if (east || i <= 12) C.palms.push({ x, z, h: 8 + rnd() * 4, r: rnd() * 6 });
      else C.trees.push({ x, z, s: 1.1 + rnd() * .6, r: rnd() * Math.PI * 2, v: rnd(), pink: false });
    }
  }
  // mata alta (eucaliptos) atrás da arquibancada, fora das vias
  { const fr = G.arquibancada.frente, clear = (x, z) => world.roads.every((r) => r.kind === 'foot' || r.pts.every((q, i) => !i || distToSegment(x, z, ...r.pts[i - 1], ...q).d > r.w / 2 + 4));
    for (let i = 1; i < fr.length; i++) { const a = fr[i - 1], b = fr[i], [dx, dz, L] = unit(a, b); let n = [-dz, dx]; if ((a[0] - T.cx) * n[0] + (a[1] - T.cz) * n[1] < 0) n = [dz, -dx];
      for (let t = 1; t < L; t += 3) for (const off of [26, 31, 37, 44, 52]) { const x = a[0] + dx * t + n[0] * (off + rnd() * 4), z = a[1] + dz * t + n[1] * (off + rnd() * 4) + (rnd() - .5) * 4; if (clear(x, z)) C.trees.push({ x, z, s: 2.3 + rnd() * 1.1, r: rnd() * Math.PI * 2, v: rnd(), pink: false, grove: true }); } } }
  C.floodlights = G.refletores.map(([x, z]) => ({ x, z, face: [mid[0], mid[1]] }));
  C.track = T; C.leisure = G;
  return G;
}

/** fileiras da arquibancada: sobem da frente (nível do campo) até a rua de trás */
function standPlan(C, world, terrain) {
  const G = C.leisure, T = C.track, level = T.groundLevel, rows = G.arquibancada.fileiras, front = G.arquibancada.frente, tops = [];
  for (const p of front) {
    let best = null;
    for (const road of world.roads) {
      if (!road.internal || road.bridge || road.kind === 'foot') continue;
      for (let i = 1; i < road.pts.length; i++) { const q = distToSegment(p[0] + rows * ROW_DEPTH + 6, p[1], ...road.pts[i - 1], ...road.pts[i]); if (q.d < 30 && (!best || q.d < best.d)) best = { d: q.d, y: terrain.roadHeightAt(road, q.cx, q.cz) + WALK }; }
    }
    if (best) tops.push(best.y);
  }
  const top = tops.length ? tops.reduce((a, b) => a + b, 0) / tops.length : level + rows * .4;
  const rise = Math.max(.3, Math.min(.47, (top - level) / rows)), segments = [];
  for (let i = 1; i < front.length; i++) {
    const a = front[i - 1], b = front[i], [dx, dz, L] = unit(a, b);
    let n = [-dz, dx]; if ((a[0] - T.cx) * n[0] + (a[1] - T.cz) * n[1] < 0) n = [dz, -dx];
    // a parte esquerda (norte), que acompanha a curva da pista, é mais baixa
    const low = G.arquibancada.esquerda, few = low && i <= low.trechos ? low.fileiras : rows;
    segments.push({ rows: few, depth: few * ROW_DEPTH, a, b, d: [dx, dz], n, L, frame: frameAt(a[0], a[1], yawOf(dx, dz)), side: Math.sign(toWorld(frameAt(0, 0, yawOf(dx, dz)), 0, 1)[0] * n[0] + toWorld(frameAt(0, 0, yawOf(dx, dz)), 0, 1)[1] * n[1]) });
  }
  for (const seg of segments) seg.top = level + seg.rows * rise;
  return { level, rows, rise, top: level + rows * rise, segments, depth: rows * ROW_DEPTH };
}

/** Relevo: terraço e deck planos, encosta da arquibancada. Roda depois da terraplenagem geral. */
export function gradeLeisure(world, terrain, C) {
  const G = C.leisure, T = C.track;
  if (!G) return null;
  // (sem margem explícita = preserva todo triângulo do relevo que toca a pista: ela fica 100% plana)
  const report = {}, keep = [[T.outer]], cell = 8.6;
  report.terrace = terrain.gradePlatform([G.terraco.anel], { level: T.groundLevel, band: 4, preserve: keep });
  // deck das piscinas: encostado na curva da pista, um degrau baixo acima dela
  G.piscina.level = Math.min(G.piscina.altitude + (C.controlOffset ?? 1.6) - terrain.base, T.groundLevel + .35);
  for (const k of G.quiosques) terrain.gradePlatform([circle(k, 3.6, 10)], { level: terrain.heightAt(...k), band: 5, preserve: keep });
  report.pool = terrain.gradePlatform([G.piscina.deck], { level: G.piscina.level, band: 6, preserve: keep });
  report.lakeCourt = terrain.gradePlatform([G.quadraLago], { band: 4, preserve: keep });
  const S = G.stand = standPlan(C, world, terrain), samples = [];
  for (const seg of S.segments) for (let k = 0; k <= seg.rows + 3; k++) {
    const y = S.level + Math.min(seg.rows, k + 1) * S.rise - .02;
    for (let s = -.5; s <= seg.L + .5; s += 1) samples.push([seg.a[0] + seg.d[0] * s + seg.n[0] * (k + .5) * ROW_DEPTH, seg.a[1] + seg.d[1] * s + seg.n[1] * (k + .5) * ROW_DEPTH, y]);
  }
  const bed = (x, z) => world.roads.some((r) => r.internal && r.kind !== 'foot' && r.pts.some((p, i) => i && distToSegment(x, z, ...r.pts[i - 1], ...p).d < r.w / 2 + SIDEWALK + .3));
  // talude uniforme entre o terraço e a rua de trás (o relevo de satélite deixava degraus e buracos)
  const slope = [], hub = [S.segments[0].a[0] + 6, S.segments[0].a[1] - 4], ring = G.terraco.anel;
  const street = (x, z) => { let best = null; for (const r of world.roads) { if (!r.internal || r.bridge || r.kind === 'foot') continue; for (let i = 1; i < r.pts.length; i++) { const q = distToSegment(x, z, ...r.pts[i - 1], ...r.pts[i]), d = q.d - r.w / 2 - SIDEWALK; if (!best || d < best.d) best = { d, y: terrain.roadHeightAt(r, q.cx, q.cz) + WALK }; } } return best; };
  const inStand = (x, z) => S.segments.some((g) => { const u = (x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], v = (x - g.a[0]) * g.n[0] + (z - g.a[1]) * g.n[1]; return u > -1 && u < g.L + 1 && v > -1 && v < g.depth + 4; });
  for (let x = hub[0] - 34; x <= hub[0] + 34; x += 2) for (let z = hub[1] - 34; z <= hub[1] + 34; z += 2) {
    if (T.radiusAt(x, z) < T.rOut + cell || pointInPolygon(x, z, [ring]) || inStand(x, z)) continue;
    const d1 = Math.min(...ring.map((p, i) => distToSegment(x, z, ...p, ...ring[(i + 1) % ring.length]).d)), st = street(x, z);
    if (!st || st.d <= 0 || d1 > 30 || st.d > 30) continue;
    slope.push([x, z, S.level + (st.y - S.level) * d1 / (d1 + st.d)]);
  }
  report.slope = terrain.gradeProfile(slope, { radius: 1.6, band: 3, clearance: 0, minClearance: -9, protect: (x, z) => bed(x, z) || T.radiusAt(x, z) < T.rOut + cell || pointInPolygon(x, z, [ring]) || inStand(x, z) });
  // (a arquibancada por último: garante que nenhum triângulo do talude fique acima das fileiras)
  report.stand = terrain.gradeProfile(samples, { radius: 1.2, band: 5, clearance: .35, minClearance: .05, protect: (x, z) => bed(x, z) || T.radiusAt(x, z) < T.rOut + cell || pointInPolygon(x, z, [G.terraco.anel]) });
  report.standRise = S.rise;
  return report;
}

// ---------------------------------------------------------------- pintura das quadras (decalques)
const courtFrame = (ring) => { const e1 = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]), e2 = Math.hypot(ring[3][0] - ring[0][0], ring[3][1] - ring[0][1]); return e1 >= e2 ? { L: e1, W: e2, corners: [ring[0], ring[1], ring[2], ring[3]] } : { L: e2, W: e1, corners: [ring[0], ring[3], ring[2], ring[1]] }; };
const stroke = (g, k, w = .07) => { g.strokeStyle = '#f4f2ea'; g.lineWidth = Math.max(2, w * k); };
function paintTennis(g, k, L, W, x0 = 0, y0 = 0) {
  g.fillStyle = C_GREEN; g.fillRect(x0, y0, L * k, W * k); stroke(g, k);
  const X = (m) => x0 + m * k, Y = (m) => y0 + m * k, line = (a, b, c, d) => { g.beginPath(); g.moveTo(X(a), Y(b)); g.lineTo(X(c), Y(d)); g.stroke(); };
  g.strokeRect(X(0), Y(0), L * k, W * k); line(0, 1.37, L, 1.37); line(0, W - 1.37, L, W - 1.37);
  line(L / 2 - 6.4, 1.37, L / 2 - 6.4, W - 1.37); line(L / 2 + 6.4, 1.37, L / 2 + 6.4, W - 1.37); line(L / 2 - 6.4, W / 2, L / 2 + 6.4, W / 2);
}
const paintCourt = (type, L, W) => (g, w, h) => {
  const k = w / L, m = .7 * k;
  g.fillStyle = '#7d3f30'; g.fillRect(0, 0, w, h); g.fillStyle = '#5c9f76'; g.fillRect(m, m, w - 2 * m, h - 2 * m);
  g.fillStyle = '#b9573f';
  for (const side of [0, 1]) { g.beginPath(); g.ellipse(side ? w - m : m, h / 2, 6 * k, (W / 2 - 1.6) * k, 0, 0, Math.PI * 2); g.save(); g.beginPath(); g.rect(m, m, w - 2 * m, h - 2 * m); g.clip(); g.beginPath(); g.ellipse(side ? w - m : m, h / 2, 6 * k, (W / 2 - 1.6) * k, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  stroke(g, k, .08); g.strokeRect(m, m, w - 2 * m, h - 2 * m);
  g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, h - m); g.stroke();
  g.fillStyle = type === 'basquete' ? '#d9a35c' : '#5c9f76'; g.beginPath(); g.arc(w / 2, h / 2, 3 * k, 0, Math.PI * 2); g.fill(); g.stroke();
  for (const side of [0, 1]) {
    g.beginPath(); g.ellipse(side ? w - m : m, h / 2, 6 * k, (W / 2 - 1.6) * k, 0, side ? Math.PI / 2 : -Math.PI / 2, side ? Math.PI * 1.5 : Math.PI / 2); g.stroke();
    if (type === 'basquete') { const x = side ? w - m - 5.8 * k : m; g.strokeRect(x, h / 2 - 2.45 * k, 5.8 * k, 4.9 * k); g.beginPath(); g.arc(side ? w - m - 5.8 * k : m + 5.8 * k, h / 2, 1.8 * k, 0, Math.PI * 2); g.stroke(); }
  }
};
const paintMedallion = (g, w, h) => {
  g.clearRect(0, 0, w, h); g.fillStyle = C_SALMON; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#f3ece2' : '#d5483e'; g.beginPath(); g.moveTo(w / 2, h / 2); g.arc(w / 2, h / 2, w * .48, i / 16 * Math.PI * 2, (i + 1) / 16 * Math.PI * 2); g.fill(); }
};

/** Malhas, pisos, colisão e áreas livres de árvores da convivência. */
export function buildLeisure(C, { renderer, terrain }) {
  const G = C.leisure;
  if (!G) return null;
  const T = C.track, S = G.stand, kit = createKit(renderer), solids = standVolumes(S), surfaces = [], exclusions = [];
  const y0 = T.groundLevel, ground = (x, z) => terrain.heightAt(x, z);
  const solid = (ring, top, kind) => solids.push({ rings: [ring], top, kind }), floor = (ring, y) => surfaces.push({ rings: [ring], y });
  const flat = (p, y) => [p[0], y, p[1]];
  /** alambrado: montantes e três tubos; `gap` = [aresta, largura] deixa um portão no meio dela */
  const fence = (ring, y, height, color = C_FENCE, gap = null) => ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length], [dx, dz, L] = unit(a, b), parts = gap && gap[0] === i ? [[0, L / 2 - gap[1] / 2], [L / 2 + gap[1] / 2, L]] : [[0, L]];
    for (const [s0, s1] of parts) {
      const p = [a[0] + dx * s0, a[1] + dz * s0], q = [a[0] + dx * s1, a[1] + dz * s1], posts = Math.max(1, Math.round((s1 - s0) / 3));
      for (const h of [.05, height / 2, height]) kit.rail(color, flat(p, y + h), flat(q, y + h), .03);
      for (let k = 0; k <= posts; k++) { const m = [p[0] + (q[0] - p[0]) * k / posts, p[1] + (q[1] - p[1]) * k / posts]; kit.rail(color, flat(m, y), flat(m, y + height), .04); }
      for (let k = 0; k < posts * 5; k++) { const m = [p[0] + (q[0] - p[0]) * (k + .5) / (posts * 5), p[1] + (q[1] - p[1]) * (k + .5) / (posts * 5)]; kit.rail(color, flat(m, y), flat(m, y + height), .012); }
      solid([[p[0] - dz * .06, p[1] + dx * .06], [q[0] - dz * .06, q[1] + dx * .06], [q[0] + dz * .06, q[1] - dx * .06], [p[0] + dz * .06, p[1] - dx * .06]], y + height, 'alambrado');
    }
  });
  const net = (a, b, y, h = .95) => { kit.wall(C_NET, a, b, .04, y + .15, y + h, y + .15, y + h); kit.wall(C_WHITE, a, b, .05, y + h, y + h + .05, y + h, y + h + .05); for (const p of [a, b]) kit.rail(C_STEEL, flat(p, y), flat(p, y + h + .12), .04); const [dx, dz] = unit(a, b); solid([[a[0] - dz * .05, a[1] + dx * .05], [b[0] - dz * .05, b[1] + dx * .05], [b[0] + dz * .05, b[1] - dx * .05], [a[0] + dz * .05, a[1] - dx * .05]], y + h, 'rede'); };
  const decal = (key, paint, ring, y, size) => kit.signCorners(key, paint, [flat(ring[0], y), flat(ring[1], y), flat(ring[2], y), flat(ring[3], y)], { size, lit: true });
  const bench = (x, z, yaw, y) => { const f = frameAt(x, z, yaw, y); kit.box(C_DARK, f, 0, .42, 0, 2.2, .07, .45); for (const s of [-.9, .9]) kit.box(C_DARK, f, s, .2, 0, .08, .4, .4); solid(rectRing(f, -1.1, -.23, 1.1, .23), y + .46, 'banco'); };

  // ---- pista: piso e linhas das raias em geometria (nítidas de perto, ao contrário da textura do chão)
  { const n = T.outer.length, P = (ring, i, y) => flat(ring[i % n], y);
    for (let i = 0; i < n; i++) kit.quad('#b4533a', P(T.inner, i, y0 + .02), P(T.inner, i + 1, y0 + .02), P(T.outer, i + 1, y0 + .02), P(T.outer, i, y0 + .02), [0, 1, 0]);
    const sc = T.oval;
    for (let k = 0; k < T.lanes.length; k++) { const r = T.rIn + k * LANE, a = sc(r - .05, 72), b = sc(r + .05, 72); for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; kit.quad(C_WHITE, flat(a[i], y0 + .032), flat(a[j], y0 + .032), flat(b[j], y0 + .032), flat(b[i], y0 + .032), [0, 1, 0]); } }
    // linha de chegada na reta do lado da arquibancada
    kit.quad(C_WHITE, flat(T.at(20, T.rIn), y0 + .034), flat(T.at(20.12, T.rIn), y0 + .034), flat(T.at(20.12, T.rOut), y0 + .034), flat(T.at(20, T.rOut), y0 + .034), [0, 1, 0]); }
  // ---- tênis: piso vermelho, duas quadras, redes e alambrado com portão do lado do campo
  {
    const ring = G.tenis.piso;
    kit.quad(C_RED, ...ring.map((p) => flat(p, y0 + .03)), [0, 1, 0]);
    G.tenis.quadras.forEach((q, i) => { const F = courtFrame(q); decal(`tenis-${i}`, (g, w, h) => paintTennis(g, w / F.L, F.L, F.W), F.corners, y0 + .045, [768, Math.round(768 * F.W / F.L)]); });
    for (const q of G.tenis.quadras) { const F = courtFrame(q), [a, b, c, d] = F.corners, mid = (p, r) => [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2], n = unit(a, d); net([mid(a, b)[0] - n[0] * .9, mid(a, b)[1] - n[1] * .9], [mid(d, c)[0] + n[0] * .9, mid(d, c)[1] + n[1] * .9], y0); }
    fence(ring, y0, 1.5, C_FENCE, [3, 2.2]);
    exclusions.push({ kind: 'tenis', rings: [ring], padding: 1 });
  }
  // ---- quadras poliesportivas do pátio sul: traves, tabelas de basquete e bancos
  G.quadras.forEach((q, i) => {
    const F = courtFrame(q.anel), [a, b, c, d] = F.corners, along = unit(a, b), f = frameAt((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, yawOf(along[0], along[1]), y0);
    decal(`quadra-${i}`, paintCourt(q.tipo, F.L, F.W), F.corners, y0 + .035, [768, Math.round(768 * F.W / F.L)]);
    for (const s of [-1, 1]) {
      const x = s * (F.L / 2 - .75);
      for (const z of [-1.5, 1.5]) kit.tube(C_WHITE, f, [x, 0, z], [x, 2, z], .05, 6);
      kit.tube(C_WHITE, f, [x, 2, -1.5], [x, 2, 1.5], .05, 6); for (const z of [-1.5, 1.5]) kit.tube(C_WHITE, f, [x, 2, z], [x + s * .9, 0, z], .03, 5);
      solid(rectRing(f, x - .08, -1.55, x + .08, -1.45), y0 + 2, 'trave'); solid(rectRing(f, x - .08, 1.45, x + .08, 1.55), y0 + 2, 'trave');
      if (q.tipo === 'basquete') {
        const px = s * (F.L / 2 + .5);
        kit.tube(C_STEEL, f, [px, 0, 0], [px, 3.1, 0], .09, 8); kit.tube(C_STEEL, f, [px, 3.1, 0], [px - s * 1.5, 3.4, 0], .07, 6);
        kit.box(C_WHITE, f, px - s * 1.5, 3.5, 0, .06, 1.05, 1.8); kit.cylinder('#d2552f', f, px - s * 1.85, 3.05, 0, .23, .03, 'y', 12);
        solid(rectRing(f, px - .12, -.12, px + .12, .12), y0 + 3.1, 'tabela');
      }
    }
    // alambrado alto em volta de cada quadra, com portão do lado do campo
    const cage = rectRing(f, -F.L / 2 - 1, -F.W / 2 - 1, F.L / 2 + 1, F.W / 2 + 1), mids = cage.map((p, k) => [(p[0] + cage[(k + 1) % 4][0]) / 2, (p[1] + cage[(k + 1) % 4][1]) / 2]);
    fence(cage, y0, 4, C_FENCE, [mids.reduce((best, m, k) => Math.hypot(m[0] - T.cx, m[1] - T.cz) < Math.hypot(mids[best][0] - T.cx, mids[best][1] - T.cz) ? k : best, 0), 1.8]);
    const side = toWorld(f, F.L / 2 + 2.3, 0); bench(side[0], side[1], f.yaw + Math.PI / 2, y0);
  });
  exclusions.push({ kind: 'patio', rings: [G.patio] });
  // ---- quadra pequena ao lado do lago
  { const F = courtFrame(G.quadraLago), [a, b, c, d] = F.corners; decal('quadra-lago', (g, w, h) => paintTennis(g, w / F.L, F.L, F.W), F.corners, ground(...centroid(G.quadraLago)) + .04, [512, Math.round(512 * F.W / F.L)]);
    const y = ground(...centroid(G.quadraLago)); net([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [(d[0] + c[0]) / 2, (d[1] + c[1]) / 2], y); fence(G.quadraLago, y, 3, C_FENCE, [0, 1.6]); exclusions.push({ kind: 'quadra-lago', rings: [G.quadraLago], padding: 1 }); }

  // ---- quiosques redondos (churrasqueira) e caminho de paver
  for (const [x, z] of G.quiosques) {
    const ring = circle([x, z], 2.8, 12), y = Math.max(ground(x, z), ...ring.map((p) => ground(...p))), f = frameAt(x, z, 0, y);
    kit.prism('#b9a88e', ring, Math.min(...ring.map((p) => ground(...p))) - .4, y + .14); floor(ring, y + .14);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; kit.cylinder(C_WOOD, f, Math.cos(a) * 2.45, 1.3, Math.sin(a) * 2.45, .09, 2.5, 'y', 6); }
    kit.cylinder(C_ROOF, f, 0, 3.35, 0, 3.5, 1.8, 'y', 12, 0); kit.cylinder(C_WOOD, f, 0, 2.52, 0, 3.45, .1, 'y', 12);
    kit.box(C_BRICK, f, -1.3, .6, 0, .7, .95, 1.2); kit.box(C_DARK, f, -1.3, 1.1, 0, .6, .06, 1.1); kit.box(C_BRICK, f, -1.45, 1.75, 0, .35, 1.35, .4);
    kit.cylinder(C_STONE, f, .7, .5, 0, .12, .72, 'y', 8); kit.cylinder(C_WOOD, f, .7, .9, 0, .75, .07, 'y', 12);
    for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + .4; kit.cylinder(C_WOOD, f, .7 + Math.cos(a) * 1.15, .38, Math.sin(a) * 1.15, .2, .48, 'y', 8); }
    solid(rectRing(f, -1.7, -.65, -.9, .65), y + 1.6, 'churrasqueira'); solid(circle([x + .7, z], .8, 8), y + 1, 'mesa');
    exclusions.push({ kind: 'quiosque', x, z, radius: 5 });
  }
  for (let i = 1; i < G.caminho.length; i++) { const a = G.caminho[i - 1], b = G.caminho[i], [dx, dz, L] = unit(a, b); for (let s = 0; s < L; s += 1.5) { const s1 = Math.min(L, s + 1.5), P = (t, w) => { const x = a[0] + dx * t - dz * w, z = a[1] + dz * t + dx * w; return [x, ground(x, z) + .05, z]; }; kit.quad('#c29a80', P(s, -.9), P(s1, -.9), P(s1, .9), P(s, .9), [0, 1, 0]); } }
  // ---- estátua no gramado entre a rua e a pista (forma genérica: o tema não aparece nas referências)
  { const [x, z] = G.estatua, y = ground(x, z), f = frameAt(x, z, yawOf(T.ux, T.uz), y);
    kit.box(C_STONE, f, 0, .2, 0, 2.2, .4, 2.2); kit.box('#b3b1aa', f, 0, 1, 0, 1.1, 1.2, 1.1); kit.box(C_DARK, f, 0, .95, .56, .7, .4, .03);
    kit.cylinder(C_BRONZE, f, 0, 2.35, 0, .3, 1.5, 'y', 8, .22); kit.sphere(C_BRONZE, f, 0, 3.3, 0, .24); kit.tube(C_BRONZE, f, [-.25, 2.9, 0], [-.75, 3.5, .1], .08, 6); kit.tube(C_BRONZE, f, [.25, 2.9, 0], [.6, 2.3, .15], .08, 6);
    solid(rectRing(f, -1.1, -1.1, 1.1, 1.1), y + 1.6, 'estatua'); exclusions.push({ kind: 'estatua', x, z, radius: 4.5 }); }
  // ---- lago: mureta curva da margem sul e dois aeradores
  for (let i = 1; i < G.muroLago.length; i++) { const a = G.muroLago[i - 1], b = G.muroLago[i], ya = ground(...a), yb = ground(...b), [dx, dz] = unit(a, b); kit.wall('#d8d5cb', a, b, .25, ya - .6, ya + .85, yb - .6, yb + .85); solid([[a[0] - dz * .14, a[1] + dx * .14], [b[0] - dz * .14, b[1] + dx * .14], [b[0] + dz * .14, b[1] - dx * .14], [a[0] + dz * .14, a[1] - dx * .14]], Math.max(ya, yb) + .85, 'mureta-lago'); }
  { const c = centroid(G.lago), lake = C.lakeLevel ?? ground(...c) + .9; for (const [dx, dz] of [[4, -6], [9, 14]]) { const f = frameAt(c[0] + dx, c[1] + dz, 0, lake); kit.cylinder(C_WHITE, f, 0, .5, 0, .5, 1, 'y', 8, .05); kit.cylinder(C_STEEL, f, 0, .05, 0, .35, .12, 'y', 8); } }

  // ---- abrigos (bancos de reservas) ao lado da reta oeste
  for (const [x, z] of G.abrigos) { const f = frameAt(x, z, yawOf(T.ux, T.uz), ground(x, z)); kit.box(C_DARK, f, 0, .45, -.5, 4.6, .08, .5); for (const s of [-2.3, 2.3]) { kit.tube(C_STEEL, f, [s, 0, -.9], [s, 2.1, -.9], .05, 6); kit.tube(C_STEEL, f, [s, 2.1, -.9], [s, 1.9, .7], .05, 6); } kit.box('glass', f, 0, 2.02, -.1, 4.8, .05, 1.7); kit.box('glass', f, 0, 1.05, -.92, 4.8, 2, .05); solid(rectRing(f, -2.4, -1, 2.4, -.84), f.y + 2.1, 'abrigo'); exclusions.push({ kind: 'abrigo', x, z, radius: 3.4 }); }
  // ---- vestiários: três águas brancas em pirâmide sobre o bloco
  { const b = C.buildings.find((q) => q.leisure === 'vestiario'), ring = b.rings[0], top = (terrain.platformFor(b)?.height ?? y0) + b.height, d = unit(ring[1], ring[2]), c = centroid(ring), f = frameAt(c[0], c[1], yawOf(d[0], d[1]) + Math.PI / 4, top);
    for (const s of [-1, 0, 1]) { const [x, z] = [c[0] + d[0] * s * d[2] / 3, c[1] + d[1] * s * d[2] / 3]; kit.cylinder('#f6f6f3', { ...f, x, z }, 0, .8, 0, 5.3, 1.6, 'y', 4, 0); } }
  // ---- lado oeste: grade preta baixa junto à pista e bancos de concreto curvos (foto do usuário)
  for (let u = -30; u < 44; u += 15) {
    const a = T.at(u, -(T.rOut + 1.1)), b = T.at(u + 12.6, -(T.rOut + 1.1)), posts = 9;
    for (const h of [.08, 1.05]) kit.rail('#1d1f22', flat(a, y0 + h), flat(b, y0 + h), .025);
    for (let k = 0; k <= posts * 4; k++) { const p = [a[0] + (b[0] - a[0]) * k / (posts * 4), a[1] + (b[1] - a[1]) * k / (posts * 4)]; kit.rail('#1d1f22', flat(p, y0), flat(p, y0 + (k % 4 ? 1.05 : 1.2)), k % 4 ? .012 : .03); }
    solid([T.at(u, -(T.rOut + 1.04)), T.at(u + 12.6, -(T.rOut + 1.04)), T.at(u + 12.6, -(T.rOut + 1.16)), T.at(u, -(T.rOut + 1.16))], y0 + 1.05, 'grade-pista');
    const c = T.at(u + 6.3, -(T.rOut + 2.6)), bf = frameAt(c[0], c[1], yawOf(T.ux, T.uz), ground(...c));
    kit.box(C_CONCRETE, bf, 0, .22, 0, 4.2, .44, .7); solid(rectRing(bf, -2.1, -.35, 2.1, .35), bf.y + .44, 'banco');
  }
  // ---- clube: aletas brancas na fachada voltada para a pista e claraboia em pirâmide
  { const b = C.buildings.find((q) => q.leisure === 'clube'), base = terrain.platformFor(b)?.height ?? y0, top = base + b.height, sc = T.at(T.straight, 0);
    b.rings[0].forEach((a, i, ring) => { const q = ring[(i + 1) % ring.length], [dx, dz, L] = unit(a, q), m = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2]; let n = [dz, -dx]; if ((m[0] - centroid(ring)[0]) * n[0] + (m[1] - centroid(ring)[1]) * n[1] < 0) n = [-n[0], -n[1]];
      if ((sc[0] - m[0]) * n[0] + (sc[1] - m[1]) * n[1] < 0 || L < 3) return;
      for (let s = .8; s < L - .4; s += 1.7) kit.box(C_WHITE, frameAt(a[0] + dx * s + n[0] * .3, a[1] + dz * s + n[1] * .3, yawOf(n[0], n[1]), base), 0, b.height / 2, 0, .7, b.height, .22); });
    const f = frameAt(G.claraboia[0], G.claraboia[1], yawOf(T.ux, T.uz) + Math.PI / 4, top); kit.cylinder('#e9edf0', f, 0, .9, 0, 3.2, 1.8, 'y', 4, 0); }
  // ---- piscinas: raias, blocos de partida, ilha, escadas, espreguiçadeiras, guarda-sóis e bar
  { const P = G.piscina, y = P.level, F = courtFrame(P.raias), [a, b] = F.corners, along = unit(a, b), f = frameAt((F.corners[0][0] + F.corners[2][0]) / 2, (F.corners[0][1] + F.corners[2][1]) / 2, yawOf(along[0], along[1]), y);
    for (let k = 1; k < 6; k++) { const z = -F.W / 2 + k * F.W / 6; for (let s = -F.L / 2 + .5; s < F.L / 2 - .5; s += 1) kit.box(Math.floor(s) % 2 ? C_BLUE : C_WHITE, f, s + .5, .12, z, .98, .07, .09); }
    for (let k = 0; k < 6; k++) { const z = -F.W / 2 + (k + .5) * F.W / 6; kit.box(C_WHITE, f, -F.L / 2 - .45, .3, z, .6, .5, .55); kit.box(C_BLUE, f, -F.L / 2 - .4, .58, z, .5, .06, .5); }
    for (const [sx, sz] of [[F.L / 2 - 1, F.W / 2], [-F.L / 2 + 1, -F.W / 2]]) for (const d of [-.25, .25]) { kit.tube(C_STEEL, f, [sx + d, -.3, sz], [sx + d, .9, sz], .03, 6); kit.tube(C_STEEL, f, [sx + d, .9, sz], [sx + d, .5, sz + Math.sign(sz) * .6], .03, 6); }
    kit.cylinder(C_WHITE, frameAt(P.ilha[0], P.ilha[1], 0, y), 0, .2, 0, 1.8, .45, 'y', 14);
    const rnd = mulberry32(99), deck = P.deck, dc = centroid(deck);
    deck.forEach((p, i) => { if (i < 6 || i > 12) return; const q = deck[i + 1], [dx, dz, L] = unit(p, q), inward = unit(p, dc);
      for (let s = 1.5; s < L - 1; s += 2.6) { const x = p[0] + dx * s + inward[0] * 1.9, z = p[1] + dz * s + inward[1] * 1.9, lf = frameAt(x, z, yawOf(inward[0], inward[1]), y); kit.box(C_WHITE, lf, 0, .28, 0, 1.9, .08, .62); kit.box(C_WHITE, lf, -.75, .5, 0, .08, .5, .62); for (const lx of [-.8, .8]) kit.box(C_STEEL, lf, lx, .13, 0, .05, .26, .55);
        if (rnd() < .4) { kit.tube(C_STEEL, lf, [-1.3, 0, .9], [-1.3, 2.3, .9], .03, 6); kit.cylinder(i % 2 ? '#f2efe6' : '#d85a45', lf, -1.3, 2.25, .9, 1.35, .5, 'y', 10, .05); } } });
    const bar = courtFrame(P.bar), [ba, bb] = bar.corners, bd = unit(ba, bb), bf = frameAt((bar.corners[0][0] + bar.corners[2][0]) / 2, (bar.corners[0][1] + bar.corners[2][1]) / 2, yawOf(bd[0], bd[1]), ground(...centroid(P.bar)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.tube(C_WOOD, bf, [sx * (bar.L / 2 - .3), 0, sz * (bar.W / 2 - .3)], [sx * (bar.L / 2 - .3), 2.7, sz * (bar.W / 2 - .3)], .09, 6);
    kit.box(C_DARK, bf, 0, 2.8, 0, bar.L + .8, .16, bar.W + .8); kit.box('#b9a88e', bf, 0, .55, .6, bar.L - 2, 1.1, .6); kit.box(C_WOOD, bf, 0, 1.12, .6, bar.L - 1.7, .06, .8);
    for (let s = -bar.L / 2 + 2; s < bar.L / 2 - 1.5; s += 1.3) kit.cylinder(C_STEEL, bf, s, .38, 1.5, .18, .76, 'y', 8);
    solid(rectRing(bf, -bar.L / 2 + 1, .3, bar.L / 2 - 1, .9), bf.y + 1.15, 'bar'); exclusions.push({ kind: 'piscina', rings: [deck], padding: 1.5 }, { kind: 'bar', rings: [P.bar], padding: 2 }); }

  // ---- arquibancada: fileiras, corredores, passeio alto com guarda-corpo (vista de cima do campo)
  S.segments.forEach((seg, si) => {
    const f = { ...seg.frame, y: 0 };
    for (let k = 0; k < seg.rows; k++) {
      const top = S.level + (k + 1) * S.rise, z = seg.side * (k + .5) * ROW_DEPTH, bottom = S.level + Math.max(0, k - 1) * S.rise - .4;
      // as fileiras de trás alongam-se para fechar o leque nas quinas (a arquibancada é curva)
      const ext = .25 + (k + .5) * ROW_DEPTH * .2;
      kit.box(k % 2 ? C_STAND : C_STAND2, f, seg.L / 2, (top + bottom) / 2, z, seg.L + 2 * ext, top - bottom, ROW_DEPTH + .01);
      floor([toWorld(f, -ext, seg.side * k * ROW_DEPTH), toWorld(f, seg.L + ext, seg.side * k * ROW_DEPTH), toWorld(f, seg.L + ext, seg.side * (k + 1) * ROW_DEPTH), toWorld(f, -ext, seg.side * (k + 1) * ROW_DEPTH)], top);
      // corredor: degrau intermediário mais escuro
      for (const s of [seg.L * .25, seg.L * .75]) kit.box(C_AISLE, f, s, top - S.rise * .25, seg.side * (k + .22) * ROW_DEPTH, 1.3, S.rise * .5, ROW_DEPTH * .44);
    }
    { const cuts = [0, seg.L * .25 - 1, seg.L * .25 + 1, seg.L * .75 - 1, seg.L * .75 + 1, seg.L];
      for (let c = 0; c < cuts.length; c += 2) { const a = toWorld(f, cuts[c], -seg.side * .2), b = toWorld(f, cuts[c + 1], -seg.side * .2);
        kit.wall(C_WHITE, a, b, .22, S.level - .2, S.level + 1.05, S.level - .2, S.level + 1.05);
        solid([toWorld(f, cuts[c], -seg.side * .32), toWorld(f, cuts[c + 1], -seg.side * .32), toWorld(f, cuts[c + 1], -seg.side * .08), toWorld(f, cuts[c], -seg.side * .08)], S.level + 1.05, 'mureta-arquibancada'); } }
    const back = seg.side * seg.depth, wide = 2.6, we = seg.depth * .2 + .6, top = seg.top, ring = [toWorld(f, -we, back), toWorld(f, seg.L + we, back), toWorld(f, seg.L + we, back + seg.side * wide), toWorld(f, -we, back + seg.side * wide)];
    kit.box(C_CONCRETE, f, seg.L / 2, top - .6, back + seg.side * wide / 2, seg.L + 2 * we, 1.2, wide); floor(ring, top);
    // guarda-corpo na borda do passeio voltada para o campo fica na última fileira; atrás, mureta
    const a = toWorld(f, 0, back + seg.side * (wide - .1)), b = toWorld(f, seg.L, back + seg.side * (wide - .1));
    kit.wall(C_STAND2, a, b, .2, top - .2, top + .9, top - .2, top + .9);
    if (si % 2 === 0) solid([toWorld(f, 0, back + seg.side * (wide - .2)), toWorld(f, seg.L, back + seg.side * (wide - .2)), toWorld(f, seg.L, back + seg.side * wide), toWorld(f, 0, back + seg.side * wide)], top + .9, 'mureta-arquibancada');
    else for (const [s0, s1] of [[0, seg.L / 2 - 1.5], [seg.L / 2 + 1.5, seg.L]]) solid([toWorld(f, s0, back + seg.side * (wide - .2)), toWorld(f, s1, back + seg.side * (wide - .2)), toWorld(f, s1, back + seg.side * wide), toWorld(f, s0, back + seg.side * wide)], top + .9, 'mureta-arquibancada');
    exclusions.push({ kind: 'arquibancada', rings: [[toWorld(f, -2, -seg.side), toWorld(f, seg.L + 2, -seg.side), toWorld(f, seg.L + 2, back + seg.side * (wide + 2)), toWorld(f, -2, back + seg.side * (wide + 2))]] });
  });
  // ---- terraço: tenda branca, medalhão no piso, bancos e canteiro
  { const [tx, tz] = G.terraco.tenda, tf = frameAt(tx, tz, yawOf(T.ux, T.uz), y0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { kit.tube(C_STEEL, tf, [sx * 4, 0, sz * 3.6], [sx * 4, 2.8, sz * 3.6], .08, 6); solid(rectRing(tf, sx * 4 - .12, sz * 3.6 - .12, sx * 4 + .12, sz * 3.6 + .12), y0 + 2.8, 'tenda'); }
    kit.cylinder(C_WHITE, { ...tf, yaw: tf.yaw + Math.PI / 4 }, 0, 3.6, 0, 6.2, 1.7, 'y', 4, 0);
    const [mx, mz] = G.terraco.medalhao; decal('medalhao', paintMedallion, [[mx - 4, mz + 4], [mx + 4, mz + 4], [mx + 4, mz - 4], [mx - 4, mz - 4]], y0 + .04, [256, 256]);
    kit.cylinder(C_DARK, frameAt(mx, mz, 0, y0), 0, .45, 0, .45, .9, 'y', 10); solid(circle([mx, mz], .5, 8), y0 + .9, 'medalhao');
    for (let u = -T.straight + 26; u < -T.straight + 62; u += 5.2) { const p = T.at(u, T.rOut + 2.2); bench(p[0], p[1], yawOf(T.ux, T.uz), y0); }
    const front = G.arquibancada.frente; for (let i = front.length - 3; i < front.length - 1; i++) { const a = front[i - 1], b = front[i], [dx, dz, L] = unit(a, b), hf = frameAt(a[0], a[1], yawOf(dx, dz), y0), side = S.segments[i - 1].side; kit.box(C_HEDGE, hf, L / 2, .35, -side * 1.1, L - 2, .7, 1.2); solid([toWorld(hf, 1, -side * .5), toWorld(hf, L - 1, -side * .5), toWorld(hf, L - 1, -side * 1.7), toWorld(hf, 1, -side * 1.7)], y0 + .7, 'canteiro'); }
    exclusions.push({ kind: 'terraco', rings: [G.terraco.anel] }); }

  const root = kit.finish('convivencia-cidade-de-deus');
  const index = new SpatialGrid(8);
  for (const surface of surfaces) {
    const ring = surface.rings[0], c = centroid(ring);
    surface.rings = [ring.map(([x, z]) => { const d = Math.hypot(x - c[0], z - c[1]) || 1; return [x + (x - c[0]) / d * .03, z + (z - c[1]) / d * .03]; })];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of surface.rings[0]) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    index.insertBox(surface, x0, z0, x1, z1);
  }
  const surfaceHeightAt = (x, z, maxY = Infinity) => { let h = -Infinity; for (const s of index.query(x, z)) if (s.y <= maxY && s.y > h && pointInPolygon(x, z, s.rings)) h = s.y; return h; };
  const stats = { ...root.userData.stats, rows: S.rows, rise: S.rise, standTop: S.top, kiosks: G.quiosques.length, courts: G.quadras.length + G.tenis.quadras.length + 1, surfaces: surfaces.length, solids: solids.length };
  root.userData.leisure = stats;
  return { root, stats, solids, surfaces, exclusions, surfaceHeightAt };
}
