import { distToSegment, pointInPolygon } from '../shared/geo.js';
import { exteriorEdges } from './reference.js';
import { convexHull, frameAt, yawOf, toWorld, rectRing } from './landmark-kit.js';

// Acessos do Prata e do Balança conforme os vídeos de quem trabalha no campus (10/2026):
//  - beco com escada na ponta leste do Balança (do estacionamento à rua do Prata), entre o
//    prédio e o bloco de arrimo cego com grade em cima;
//  - entrada do -2 do Prata, ao pé da torre da fachada norte, do outro lado da faixa;
//  - entrada dos fundos do andar zero, na fachada sul: porta sob a marquise curva e, ao lado,
//    a escada de espelhos coloridos.
// O Balança é semienterrado: dois andares para o estacionamento e a laje quase no nível da rua.
// O Prata também acompanha a encosta: a rua do lado norte fica dois andares abaixo do andar zero.

const SIDEWALK = 2.5, RISER = .172;
/** altura do piso da calçada das vias internas acima do perfil da via (pista +0,24, guia +0,17) */
export const WALK = .41;
const C_STEP = '#5f5f5c', C_BEIGE = '#e6ded1', C_RAIL = '#30343a', C_SLAB = '#b9b3a6', C_WHITE = '#eeeeea', C_STEEL = '#a9b0b4';
const C_BROWN = '#8d4a3c', C_RED = '#c0262d', C_ZEBRA = '#f1eee2', C_YELLOW = '#e2b93b', C_MAT = '#1c1d1f', C_GREEN = '#1f4a3a';
const C_ASPHALT = '#4b4e52', C_PAINT = '#f1efe4', C_CABIN = '#24303b', CAR_COLORS = ['#d9d9d6', '#1d2025', '#7a1f24', '#2c4a7a', '#bdbdb8', '#3b3f44'];
const C_TOTEM = '#8f9497', C_COPPER = '#a0603f', C_TREAD = '#8d8d8a', C_POT = '#b9b4a8', C_LEAF = '#3d8a3f', C_BIN = '#6b7175', C_AWNING = '#3b4046', C_GREY = '#9aa0a3';

/** via interna mais próxima: ponto do eixo, direção e folga até o meio-fio */
export function nearestStreet(roads, x, z, reach = 40) {
  let best = null;
  for (const road of roads) {
    if (!road.internal || road.bridge || road.kind === 'foot') continue;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i], q = distToSegment(x, z, ax, az, bx, bz);
      if (q.d < reach && (!best || q.d < best.d)) { const L = Math.hypot(bx - ax, bz - az) || 1; best = { road, d: q.d, x: q.cx, z: q.cz, dx: (bx - ax) / L, dz: (bz - az) / L }; }
    }
  }
  return best;
}
const roadClearance = (roads, x, z) => { const s = nearestStreet(roads, x, z, 30); return s ? s.d - s.road.w / 2 : Infinity; };

function clipHalfPlane(ring, inside, cut) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cut(a, b));
  }
  return out;
}

/** Abre o beco: separa da planta do prédio a ponta, que vira um bloco de arrimo cego. */
export function prepareAlley(C, mark) {
  const index = C.buildings.findIndex((b) => b.planId === mark.building), toward = C.buildings.find((b) => b.planId === mark.toward);
  if (index < 0) return null;
  const b = C.buildings[index], ring = b.rings[0], n = ring.length;
  let cx = 0, cz = 0, sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of ring) { cx += x / n; cz += z / n; }
  for (const [x, z] of ring) { sxx += (x - cx) ** 2; sxz += (x - cx) * (z - cz); szz += (z - cz) ** 2; }
  const angle = .5 * Math.atan2(2 * sxz, sxx - szz);
  let ux = Math.cos(angle), uz = Math.sin(angle);
  // u cresce a partir da ponta de referência (leste) para dentro do prédio
  if ((mark.end === 'oeste') !== (ux > 0)) { ux = -ux; uz = -uz; }
  let nx = -uz, nz = ux;
  if (toward) { const t = toward.rings[0].reduce((s, p) => [s[0] + p[0] / toward.rings[0].length, s[1] + p[1] / toward.rings[0].length], [0, 0]); if ((t[0] - cx) * nx + (t[1] - cz) * nz < 0) { nx = -nx; nz = -nz; } }
  const U = ([x, z]) => (x - cx) * ux + (z - cz) * uz, V = ([x, z]) => (x - cx) * nx + (z - cz) * nz;
  const at = (u, v) => [cx + ux * u + nx * v, cz + uz * u + nz * v];
  const width = mark.width ?? 2.6, uA = Math.min(...ring.map(U)) + (mark.offset ?? 5.2);
  const cutAt = (u) => (a, c) => { const t = (u - U(a)) / (U(c) - U(a)); return [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t]; };
  const main = clipHalfPlane(ring, (p) => U(p) >= uA + width / 2, cutAt(uA + width / 2));
  const block = clipHalfPlane(ring, (p) => U(p) <= uA - width / 2, cutAt(uA - width / 2));
  if (main.length < 3 || block.length < 3) return null;
  const vs = [...main, ...block].filter((p) => Math.abs(U(p) - uA) < width / 2 + .01).map(V);
  C.buildings[index] = { ...b, rings: [main], referenceAccess: true, deckRoof: true };
  return { building: mark.building, pieces: [C.buildings[index]], block: convexHull(block), cx, cz, ux, uz, nx, nz, uA, width, v0: Math.min(...vs), v1: Math.max(...vs), at, U, V, uMax: Math.max(...ring.map(U)), uMin: Math.min(...ring.map(U)) };
}

/** [v mínimo, v máximo] onde a reta u = const (no sistema do beco) corta as plantas dadas */
export function spanAt(alley, u, rings) {
  let lo = Infinity, hi = -Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ua = alley.U(a), ub = alley.U(b);
    if ((ua - u) * (ub - u) > 0 || ua === ub) continue;
    const v = alley.V(a) + (alley.V(b) - alley.V(a)) * (u - ua) / (ub - ua);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return [lo, hi];
}

/** fachada (aresta externa longa) do prédio mais próxima de um ponto, olhando para `facing` */
export function facadeNear(building, x, z, facing, minLength = 6) {
  let best = null;
  for (const e of exteriorEdges(building.rings[0])) {
    if (e.L < minLength || e.nx * facing[0] + e.nz * facing[1] < .5) continue;
    const d = distToSegment(x, z, e.ax, e.az, e.bx, e.bz).d;
    if (!best || d < best.d) best = { ...e, d };
  }
  return best;
}

/** fachada dos fundos do Prata: porta do andar zero (no nível do chão) e o ponto em frente a ela */
export function backDoorFrame(building, mark) {
  const e = facadeNear(building, mark.x, mark.z, [0, 1], 30);
  if (!e) return null;
  const along = [e.nz, -e.nx], q = distToSegment(mark.x, mark.z, e.ax, e.az, e.bx, e.bz);
  return { e, along, door: [q.cx, q.cz], front: [q.cx + e.nx * 1.2, q.cz + e.nz * 1.2] };
}

/**
 * Faixa entre uma fachada e a rua em frente, no nível da calçada: pontos [x, z, y] para o relevo
 * encostar no prédio semienterrado (entra `inset` m na planta, onde o chão fica escondido).
 */
export function terraceSamples(roads, terrain, origin, along, out, length, { inset = 5, reach = 24, step = 1.5, depthAt = () => 0 } = {}) {
  const samples = [], strips = [];
  for (let s = 0; s <= length + 1e-6; s += step) {
    const base = [origin[0] + along[0] * s + out[0] * depthAt(s), origin[1] + along[1] * s + out[1] * depthAt(s)];
    let hit = null;
    for (let t = .5; t <= reach; t += .5) {
      const x = base[0] + out[0] * t, z = base[1] + out[1] * t, street = nearestStreet(roads, x, z, 12);
      if (street && street.d - street.road.w / 2 <= SIDEWALK) { hit = { t, y: terrain.roadHeightAt(street.road, street.x, street.z) + WALK }; break; }
    }
    if (!hit) continue;
    strips.push({ s, base, ...hit });
    for (let t = -inset; t <= hit.t + 1e-6; t += 1) samples.push([base[0] + out[0] * t, base[1] + out[1] * t, hit.y]);
  }
  return { samples, strips };
}

/** escada do beco: até três lances com patamares, do nível do estacionamento ao da rua */
export function planAlleyStair(alley, bottomY, topY, exitDepth) {
  const K = Math.max(8, Math.ceil((topY - bottomY) / RISER)), sTop = alley.v1 - .25, room = sTop - (alley.v0 + .6), landing = 1.2;
  let flights = 3, tread = .28;
  for (; flights > 1; flights--) { tread = Math.min(.29, (room - (flights - 1) * landing) / K); if (tread >= .255) break; }
  if (flights === 1) tread = Math.max(.24, Math.min(.29, room / K));
  const runs = [];
  let s = sTop - K * tread - (flights - 1) * landing, k = 0;
  for (let i = 0; i < flights; i++) {
    const count = Math.floor(K / flights) + (i < K % flights ? 1 : 0);
    runs.push({ s0: s, s1: s + count * tread, k0: k, k: count }); s += count * tread + landing; k += count;
  }
  const h = (topY - bottomY) / K;
  return { K, flights: runs, tread, landing, riser: h, bottomY, topY, sBottom: runs[0].s0, sTop, exit: alley.v1 + exitDepth,
    /** cota do piso a `s` metros ao longo do beco (a partir do eixo do prédio, no sentido da rua) */
    yAt(s) {
      for (const run of runs) {
        if (s <= run.s0) return bottomY + h * run.k0;
        if (s < run.s1) return bottomY + h * (run.k0 + Math.min(run.k, Math.floor((s - run.s0) / tread + 1e-6) + 1));
      }
      return topY;
    } };
}

export function alleySamples(alley, stair) {
  const samples = [];
  for (let s = alley.v0 - 2.5; s <= stair.exit + 1e-6; s += .28) {
    const half = s > stair.sTop ? 3.2 : alley.width / 2 + .9;
    for (let t = -half; t <= half + 1e-6; t += .5) { const [x, z] = alley.at(alley.uA + t, s); samples.push([x, z, Math.min(stair.yAt(s), stair.yAt(s + .28))]); }
  }
  return samples;
}

// ------------------------------------------------------------------ construção

const paintTotem = (name) => (g, w, h) => {
  g.fillStyle = '#8f9497'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#7f8588'; for (let y = 6; y < h; y += 14) for (let x = 6 + (y % 28 ? 7 : 0); x < w * .62; x += 14) g.fillRect(x, y, 5, 5);
  g.fillStyle = '#a0603f'; g.fillRect(w * .68, h * .34, w * .32, h * .66);
  g.save(); g.translate(w * .36, h * .5); g.rotate(-Math.PI / 2);
  g.fillStyle = '#ffffff'; g.font = 'bold 60px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 0, 0); g.restore();
};
// Dizeres legíveis no vídeo; os demais degraus ficam só com a cor (sem inventar texto).
const RISERS = [['#b3246f', 'Viva Bem'], ['#3f9a55', 'ZELE POR VOCÊ'], ['#2f7fc4', 'TRANSFORME SEU HÁBITO'], ['#6a2f8f', 'PERSISTÊNCIA'], ['#b3246f', 'Viva Bem'],
  ['#3f9a55', 'SUBA ESCADAS'], ['#2f7fc4', ''], ['#6a2f8f', 'SAIA DA ROTINA!'], ['#b3246f', 'Viva Bem'], ['#3f9a55', '']];
const paintRisers = (g, w, h) => {
  const band = h / RISERS.length;
  RISERS.forEach(([color, words], i) => {
    g.fillStyle = color; g.fillRect(0, i * band, w, band + 1);
    g.fillStyle = '#ffffff'; g.font = `bold ${Math.round(band * .5)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(words, w / 2, (i + .5) * band + 2);
  });
};

export function buildPrataAccess(kit, C, { ground, roads, surfaceAt, sidewalkAt }) {
  const solids = [], surfaces = [], exclusions = [], entrances = [], notes = {};
  const levelAt = (x, z) => Math.max(ground(x, z), Number.isFinite(sidewalkAt?.(x, z)) ? sidewalkAt(x, z) : -Infinity);
  const roadAt = (x, z) => { const y = surfaceAt?.(x, z); return Number.isFinite(y) ? y : ground(x, z); };
  const solid = (ring, top, kind) => solids.push({ rings: [ring], top, kind });
  const floor = (ring, y) => surfaces.push({ rings: [ring], y });

  /** faixa de pedestres (com faixa amarela zebrada dos lados) atravessando a via em (x, z) */
  const crosswalk = (x, z, { hatch = true } = {}) => {
    const street = nearestStreet(roads, x, z, 14);
    if (!street) return null;
    const f = frameAt(street.x, street.z, yawOf(street.dx, street.dz)), half = street.road.w / 2;
    const put = (color, lx, lz, w, d, turn = 0) => { const [wx, wz] = toWorld(f, lx, lz); kit.box(color, frameAt(wx, wz, f.yaw + turn, roadAt(wx, wz) + .014), 0, 0, 0, w, .028, d); };
    for (let t = -half + .45; t <= half - .4; t += .85) put(C_ZEBRA, 0, t, 3, .42);
    if (hatch) for (const side of [-1, 1]) for (let t = -half + .5; t <= half - .45; t += .8) put(C_YELLOW, side * 2.35, t, 1.25, .2, side * .78);
    return street;
  };
  const hydrant = (x, z) => {
    const f = frameAt(x, z, 0, levelAt(x, z));
    kit.cylinder(C_RED, f, 0, .36, 0, .13, .72, 'y', 8); kit.sphere(C_RED, f, 0, .76, 0, .14, .8);
    kit.cylinder(C_RED, f, 0, .5, 0, .07, .5, 'x', 6); kit.cylinder(C_RED, f, 0, .5, .12, .06, .14, 'z', 6);
    solid(rectRing(f, -.2, -.2, .2, .2), f.y + .85, 'hidrante');
  };
  const totem = (name, key, x, z, yaw) => {
    const f = frameAt(x, z, yaw, levelAt(x, z));
    kit.box(C_TOTEM, f, 0, 1.6, 0, .9, 3.2, .22);
    kit.box(C_COPPER, f, .31, 1.06, 0, .3, 2.12, .235);
    for (const side of [1, -1]) kit.sign(key, paintTotem(name), f, 0, 1.6, side * .121, .9, 3.2, { reverse: side < 0, size: [144, 512] });
    solid(rectRing(f, -.5, -.16, .5, .16), f.y + 3.2, 'totem');
  };
  /** marquise curva translúcida presa à fachada (frame: +z para fora) */
  const canopy = (f, x, y, width, reach) => {
    const steps = 6, P = (u, k) => { const a = k / steps * 1.15, [wx, wz] = toWorld(f, u, Math.sin(a) / Math.sin(1.15) * reach); return [wx, y - (1 - Math.cos(a)) / (1 - Math.cos(1.15)) * .85, wz]; };
    for (let k = 0; k < steps; k++) kit.quad('canopy', P(x - width / 2, k), P(x + width / 2, k), P(x + width / 2, k + 1), P(x - width / 2, k + 1), [0, 1, 0]);
    for (const u of [x - width / 2, x - width / 6, x + width / 6, x + width / 2]) for (let k = 0; k < steps; k++) kit.rail(C_WHITE, P(u, k), P(u, k + 1), .028);
    kit.rail(C_WHITE, P(x - width / 2, steps), P(x + width / 2, steps), .035); kit.rail(C_WHITE, P(x - width / 2, 0), P(x + width / 2, 0), .04);
  };
  const glassDoor = (f, x, y, width, height) => {
    kit.box('glass', f, x, y + height / 2, .06, width, height, .08);
    kit.box(C_STEEL, f, x, y + height + .04, .07, width + .12, .08, .1);
    for (const u of [-width / 2, 0, width / 2]) kit.box(C_STEEL, f, x + u, y + height / 2, .08, .06, height, .1);
  };

  const railing = (a, b, y, height = 1.0) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), posts = Math.max(1, Math.round(L / 1.6));
    for (const t of [.55, height]) kit.rail(C_STEEL, [a[0], y + t, a[1]], [b[0], y + t, b[1]], .025);
    for (let k = 0; k <= posts; k++) { const p = [a[0] + (b[0] - a[0]) * k / posts, a[1] + (b[1] - a[1]) * k / posts]; kit.rail(C_STEEL, [p[0], y, p[1]], [p[0], y + height, p[1]], .022); }
    const n = [-(b[1] - a[1]) / (L || 1) * .06, (b[0] - a[0]) / (L || 1) * .06];
    solid([[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]], y + height, 'grade');
  };
  const pottedPalm = (x, z) => {
    const p = frameAt(x, z, 0, levelAt(x, z));
    kit.cylinder(C_POT, p, 0, .35, 0, .34, .7, 'y', 8, .45);
    for (let k = 0; k < 7; k++) kit.tube(C_LEAF, p, [0, .7, 0], [Math.cos(k * .9) * .85, 1.5 + (k % 3) * .28, Math.sin(k * .9) * .85], .045, 4);
    solid(rectRing(p, -.4, -.4, .4, .4), p.y + .7, 'vaso');
  };

  // ---------------------------------------------------------------- beco do Balança
  const alley = C.alley, stair = alley?.stair;
  if (alley && stair) {
    // sistema local: +x sobe o beco (do estacionamento para a rua); origem no eixo do prédio.
    // `west` = lado do prédio no eixo z local (o bloco de arrimo da ponta fica do outro lado).
    const origin = alley.at(alley.uA, 0), f = frameAt(origin[0], origin[1], yawOf(alley.nx, alley.nz)), half = alley.width / 2;
    const west = Math.sign(-alley.nz * alley.ux + alley.nx * alley.uz) || 1;
    const exitPoint = alley.at(alley.uA, stair.exit + .6), actual = sidewalkAt?.(...exitPoint);
    const lot = (x, z) => Math.max(ground(x, z), roadAt(x, z));
    // cotas reais das calçadas nas duas pontas (a terraplenagem usou a estimativa do perfil das vias)
    const topY = Number.isFinite(actual) && Math.abs(actual - stair.topY) < .6 ? actual : stair.topY, entryY = lot(...alley.at(alley.uA, alley.v0 - .9)) + .02;
    const bottomY = Math.abs(entryY - stair.bottomY) < 1.1 ? entryY : stair.bottomY, h = (topY - bottomY) / stair.K, yOf = (k) => bottomY + h * k;
    const stepBox = (x0, x1, y) => {
      const ring = rectRing(f, x0, -half, x1, half), base = Math.min(y - .4, ...ring.map(([x, z]) => ground(x, z) - .3));
      kit.box(C_STEP, f, (x0 + x1) / 2, (y + base) / 2, 0, x1 - x0 + .004, y - base, alley.width); floor(ring, y);
    };
    stepBox(alley.v0 - 1.6, stair.sBottom, yOf(0));
    const handrail = [[stair.sBottom - .25, yOf(0)]];
    stair.flights.forEach((run, i) => {
      for (let k = 0; k < run.k; k++) stepBox(run.s0 + k * stair.tread, run.s0 + (k + 1) * stair.tread, yOf(run.k0 + k + 1));
      handrail.push([run.s0, yOf(run.k0)], [run.s1, yOf(run.k0 + run.k)]);
      const next = stair.flights[i + 1];
      if (next) stepBox(run.s1, next.s0, yOf(next.k0));
    });
    handrail.push([stair.sTop + .3, yOf(stair.K)]);
    // corrimão duplo dos dois lados, quebrando em cada patamar como no vídeo
    for (const side of [-1, 1]) for (const height of [.72, .95]) {
      const z = side * (half - .1);
      for (let i = 1; i < handrail.length; i++) kit.tube(C_RAIL, f, [handrail[i - 1][0], handrail[i - 1][1] + height, z], [handrail[i][0], handrail[i][1] + height, z], .024, 5);
      if (height > .9) for (const [x, y] of handrail) kit.tube(C_RAIL, f, [x, y + height, z], [x, y + height - .1, side * half], .016, 4);
    }
    // calçada de concreto do topo do beco até o meio-fio da rua do Prata
    const pad = rectRing(f, stair.sTop, -6, stair.exit, 6), padBase = Math.min(topY - .5, ...pad.map(([x, z]) => ground(x, z) - .3));
    kit.box(C_SLAB, f, (stair.sTop + stair.exit) / 2, (topY + padBase) / 2, 0, stair.exit - stair.sTop, topY - padBase, 12); floor(pad, topY);
    // bloco de arrimo da ponta: parede cega bege, piso no nível da rua, grade de aço e poste em cima
    const block = alley.block, centre = block.reduce((p, q) => [p[0] + q[0] / block.length, p[1] + q[1] / block.length], [0, 0]);
    kit.prism(C_BEIGE, block, (alley.lowLevel ?? bottomY) - .8, topY); floor(block, topY); solid(block, topY, 'arrimo-beco');
    block.forEach((a, i) => {
      const b = block[(i + 1) % block.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < .4) return;
      let n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
      if (((a[0] + b[0]) / 2 - centre[0]) * n[0] + ((a[1] + b[1]) / 2 - centre[1]) * n[1] < 0) n = [-n[0], -n[1]];
      if (n[0] * alley.nx + n[1] * alley.nz > .45) return;   // lado da rua: aberto
      const inset = (p) => [p[0] - n[0] * .1, p[1] - n[1] * .1];
      railing(inset(a), inset(b), topY, 1.05);
    });
    const lamp = frameAt(centre[0] - alley.nx * 1.5, centre[1] - alley.nz * 1.5, yawOf(-alley.nx, -alley.nz), topY);
    kit.cylinder(C_GREY, lamp, 0, 3, 0, .07, 6, 'y', 8); kit.tube(C_GREY, lamp, [0, 6, 0], [1.6, 6.5, 0], .05, 6); kit.box(C_GREY, lamp, 1.85, 6.48, 0, .6, .12, .26);
    solid(rectRing(lamp, -.12, -.12, .12, .12), topY + 6, 'poste');

    // Laje do Balança: é estacionamento, rente à calçada da rua de trás. Mureta onde ela fica
    // acima do chão (lado do estacionamento de baixo, pontas e trecho em que a rua desce).
    const piece = alley.pieces[0], deckY = piece.deckLevel;
    if (Number.isFinite(deckY)) {
      const ring = piece.rings[0], across = frameAt(0, 0, yawOf(alley.nx, alley.nz));   // +x local = atravessando a laje, rumo à rua
      for (const e of exteriorEdges(ring)) {
        if (e.L < .6) continue;
        const low = [.2, .5, .8].some((t) => ground(e.ax + (e.bx - e.ax) * t + e.nx * 1.6, e.az + (e.bz - e.az) * t + e.nz * 1.6) < deckY - .7);
        if (!low) continue;
        const a = [e.ax - e.nx * .12, e.az - e.nz * .12], b = [e.bx - e.nx * .12, e.bz - e.nz * .12];
        kit.wall(C_BEIGE, a, b, .22, deckY - .05, deckY + .95, deckY - .05, deckY + .95);
        solid([[e.ax, e.az], [e.bx, e.bz], [e.bx - e.nx * .24, e.bz - e.nz * .24], [e.ax - e.nx * .24, e.az - e.nz * .24]], deckY + .95, 'mureta-laje');
      }
      // vagas do lado do estacionamento de baixo e alguns carros
      let bay = 0;
      for (let u = alley.uA + half + 3; u < alley.uMax - 2.5; u += 2.5, bay++) {
        const [v0, v1] = spanAt(alley, u, [ring]);
        if (!(v1 - v0 > 9.5)) continue;
        const [lx, lz] = alley.at(u, v0 + 2.9);
        kit.box(C_PAINT, { ...across, x: lx, z: lz, y: deckY }, 0, .012, 0, 4.7, .024, .1);
        const [w0, w1] = spanAt(alley, u + 1.25, [ring]);
        if (bay % 3 !== 1 || !(w1 - w0 > 9.5)) continue;
        const [cx, cz] = alley.at(u + 1.25, w0 + 2.9), car = { ...across, x: cx, z: cz, y: deckY };
        kit.box(CAR_COLORS[(bay * 5 + 1) % CAR_COLORS.length], car, 0, .62, 0, 4.2, .75, 1.75);
        kit.box(C_CABIN, car, -.2, 1.28, 0, 2.2, .6, 1.5);
        solid(rectRing(car, -2.1, -.9, 2.1, .9), deckY + 1.55, 'carro-laje');
      }
      // A laje segue até a calçada da rua de trás (não há gramado por cima dela): piso de
      // concreto no recuo entre a planta e a calçada, com mureta baixa do lado da rua.
      const strip = [];
      for (let u = alley.uA + half + 6.2; u <= alley.uMax - .4; u += 1.5) {
        const v1 = spanAt(alley, u, [ring])[1];
        if (!Number.isFinite(v1)) continue;
        for (let t = .25; t <= 16; t += .25) if (roadClearance(roads, ...alley.at(u, v1 + t)) <= SIDEWALK + .05) { if (ground(...alley.at(u, v1 + t * .5)) > deckY - .6) strip.push({ u, v1, t }); break; }
      }
      const stripAt = (q, k) => { const [x, z] = alley.at(q.u, q.v1 - 1.6 + (q.t + 1.6) * k); return [x, Math.max(ground(x, z) + .06, k ? -Infinity : deckY + .012), z]; };
      for (let i = 1; i < strip.length; i++) if (strip[i].u - strip[i - 1].u < 1.6) for (let k = 0; k < 3; k++) kit.quad(piece.roof || C_BEIGE, stripAt(strip[i - 1], k / 3), stripAt(strip[i], k / 3), stripAt(strip[i], (k + 1) / 3), stripAt(strip[i - 1], (k + 1) / 3), [0, 1, 0]);
      if (strip.length > 1) exclusions.push({ kind: 'laje-recuo', rings: [[...strip.map((q) => alley.at(q.u, q.v1 - .4)), ...strip.slice().reverse().map((q) => alley.at(q.u, q.v1 + q.t + .3))]] });
      // entrada de veículos: asfalto ligando a rua à laje onde o recuo é menor
      let drive = null;
      for (let u = alley.uA + half + 9; u < alley.uMax - 9; u += 1) {
        const v1 = spanAt(alley, u, [ring])[1];
        if (!Number.isFinite(v1) || ground(...alley.at(u, v1 + 1)) < deckY - .35) continue;
        for (let t = .5; t <= 14; t += .5) if (roadClearance(roads, ...alley.at(u, v1 + t)) <= .1) { if (!drive || t < drive.t) drive = { u, v1, t }; break; }
      }
      if (drive) {
        const at = (du, t) => { const [x, z] = alley.at(drive.u + du, spanAt(alley, drive.u + du, [ring])[1] + t); return [x, levelAt(x, z) + .085, z]; };
        kit.drape(C_ASPHALT, (du, t) => at(du, t), -3.4, -.05, 3.4, drive.t + .3, .7);
        exclusions.push({ kind: 'entrada-laje', rings: [[alley.at(drive.u - 4.5, drive.v1 - .5), alley.at(drive.u + 4.5, drive.v1 - .5), alley.at(drive.u + 4.5, drive.v1 + drive.t + 1), alley.at(drive.u - 4.5, drive.v1 + drive.t + 1)]] });
      }
      // mureta baixa entre a laje e a calçada, aberta na entrada de veículos
      for (let i = 1; i < strip.length; i++) {
        const a = strip[i - 1], b = strip[i];
        if (b.u - a.u > 1.6 || (drive && Math.abs((a.u + b.u) / 2 - drive.u) < 4.3)) continue;
        const p = alley.at(a.u, a.v1 + a.t - .12), q = alley.at(b.u, b.v1 + b.t - .12), y = Math.min(ground(...p), ground(...q));
        kit.wall(C_BEIGE, p, q, .2, y - .1, y + .5, y - .1, y + .5);
        solid([alley.at(a.u, a.v1 + a.t - .22), alley.at(b.u, b.v1 + b.t - .22), alley.at(b.u, b.v1 + b.t - .02), alley.at(a.u, a.v1 + a.t - .02)], y + .5, 'mureta-laje');
      }
      notes.deck = { level: deckY, strip: strip.length, drive: drive && alley.at(drive.u, drive.v1 + drive.t / 2), walk: [alley.at(alley.uA + half + 14, alley.v1 + 2.5), alley.at(alley.uA + half + 14, 0)] };
    }

    // Lado do estacionamento. +x corre pela fachada com +z para o estacionamento; a calçada
    // acompanha a via de manobra.
    const mouth = alley.v0, north = frameAt(...alley.at(alley.uA, mouth), yawOf(-alley.nz, alley.nx));
    const walkY = (x) => lot(...toWorld(north, x, 1.4)) + .1;
    const walkAt = (x, z) => { const [wx, wz] = toWorld(north, x, z); return [wx, walkY(x), wz]; };
    // só o vão entre a fachada e a calçada da via (onde a via encosta, a calçada dela já serve)
    const gapAt = (x) => { const s = nearestStreet(roads, ...toWorld(north, x, 0), 20); return s ? Math.min(1.45, s.d - s.road.w / 2 - (s.road.tags?.service === 'parking_aisle' ? 1.4 : SIDEWALK) + .12) : 1.45; };
    for (const [a, b] of [[-(half + 4.4), -half], [half, half + 22]].map(([p, q]) => (west > 0 ? [p, q] : [-q, -p]))) for (let x = a; x < b - 1e-6; x += 1) {
      const x1 = Math.min(b, x + 1), w0 = gapAt(x), w1 = gapAt(x1);
      if (Math.min(w0, w1) < .2) continue;
      kit.quad(C_SLAB, walkAt(x, 0), walkAt(x1, 0), walkAt(x1, w1), walkAt(x, w0), [0, 1, 0]);
      floor([toWorld(north, x, 0), toWorld(north, x1, 0), toWorld(north, x1, w1), toWorld(north, x, w0)], Math.max(walkY(x), walkY(x1)));
    }
    // porta de vidro do Balança com marquise curva, logo depois do beco; adiante, o toldo escuro
    const doorX = west * (half + 3.6), doorY = walkY(doorX);
    glassDoor(north, doorX, doorY, 2.2, 2.35); canopy(north, doorX, doorY + 3.15, 3.2, 1.7);
    kit.box(C_MAT, north, doorX, doorY + .012, .75, 1.5, .024, .9);
    const awningX = west * (half + 18);
    kit.box(C_AWNING, north, awningX, walkY(awningX) + 2.9, .85, 4.6, .14, 1.7);
    const [dx, dz] = toWorld(north, doorX, 0);
    entrances.push({ name: 'Prédio Balança', x: dx - alley.nx * 3, z: dz - alley.nz * 3, yaw: Math.atan2(alley.nx, alley.nz), frontage: { x: dx, z: dz, nx: -alley.nx, nz: -alley.nz, dx: alley.ux, dz: alley.uz, L: 12, clearance: 6, road: { w: 4.5 } } });
    // faixa zebrada que vem do estacionamento rente à grade verde, até a quina do bloco
    const corner = toWorld(north, -west * (half + 4.6), 1.6), away = [-alley.ux * .97 - alley.nx * .24, -alley.uz * .97 - alley.nz * .24];
    const lane = frameAt(corner[0], corner[1], yawOf(...away));
    // (com o pátio levantado, a faixa e a grade vêm de estacionamento.js — aqui seriam uma segunda faixa por cima)
    if (!C.lot) for (let t = .6; t < 27; t += 1.05) { const [x, z] = toWorld(lane, t, 0); kit.box(C_ZEBRA, frameAt(x, z, lane.yaw, lot(x, z) + .02), 0, 0, 0, .5, .03, 2.1); }
    if (!C.lot) for (let t = 2; t < 27; t += .32) { const [x, z] = toWorld(lane, t, 1.35); kit.box(C_GREEN, frameAt(x, z, lane.yaw, lot(x, z)), 0, 1.1, 0, .05, 2.2, .05); }
    if (!C.lot) for (const y of [.25, 2.15]) for (let t = 2; t < 27; t += 5) { const a = toWorld(lane, t, 1.35), b = toWorld(lane, Math.min(27, t + 5), 1.35); kit.rail(C_GREEN, [a[0], lot(...a) + y, a[1]], [b[0], lot(...b) + y, b[1]], .035); }
    if (!C.lot) for (let t = 2; t < 27; t += 5) solid([toWorld(lane, t, 1.25), toWorld(lane, Math.min(27, t + 5), 1.25), toWorld(lane, Math.min(27, t + 5), 1.45), toWorld(lane, t, 1.45)], lot(...toWorld(lane, t + 2.5, 1.35)) + 2.2, 'grade-verde');
    exclusions.push({ kind: 'beco', rings: [rectRing(f, alley.v0 - 5, -half - 3, stair.exit + 1, half + 3)] }, { kind: 'arrimo', rings: [block], padding: 1 },
      { kind: 'faixa', rings: [[toWorld(lane, 0, -1.6), toWorld(lane, 28, -1.6), toWorld(lane, 28, 2), toWorld(lane, 0, 2)]] },
      { kind: 'calcada', rings: [rectRing(north, -(half + 23), -.2, half + 23, 2.2)] }, { kind: 'largo-beco', rings: [rectRing(f, stair.sTop - .5, -6.5, stair.exit + .3, 6.5)] });
    // faixa de pedestres em frente ao topo do beco, com o vaso de palmeira do outro lado
    const cross = crosswalk(...alley.at(alley.uA, stair.exit + 3));
    if (cross) { const side = [cross.x - exitPoint[0], cross.z - exitPoint[1]], L = Math.hypot(...side) || 1, far = cross.road.w / 2 + 1.2; pottedPalm(cross.x + side[0] / L * far - alley.ux * 3.4, cross.z + side[1] / L * far - alley.uz * 3.4); }
    notes.alley = { bottomY, topY, risers: stair.K, riser: h, flights: stair.flights.map((run) => run.k), crossing: cross && [cross.x, cross.z],
      path: [alley.at(alley.uA, alley.v0 - 1.2), alley.at(alley.uA, stair.exit + .8)] };
  }

  // ---------------------------------------------------------------- Prata
  const prata = C.buildings.find((b) => b.planId === 'b6');
  const lower = C.landmarks?.find((m) => m.type === 'entrada' && m.id === 'prata-menos2'), ground0 = C.landmarks?.find((m) => m.type === 'entrada' && m.id === 'prata-terreo');
  if (prata && lower) {
    // -2: ao pé da torre envidraçada da fachada norte. Degraus marrom-avermelhados sobem rente à
    // fachada (para oeste) até o patamar das portas, atrás da mureta branca com grade de aço.
    const e = facadeNear(prata, lower.x, lower.z, [0, -1], 6);
    if (e) {
      const along = [e.nz, -e.nx], east = (e.ax - e.bx) * along[0] + (e.az - e.bz) * along[1] < 0 ? [e.ax, e.az] : [e.bx, e.bz];
      const f = frameAt(east[0] + along[0] * .5, east[1] + along[1] * .5, yawOf(...along));   // +x = oeste pela fachada, +z = para a rua
      const clear = roadClearance(roads, ...toWorld(f, 3, 0)), depth = Math.max(1.15, Math.min(2.3, clear - SIDEWALK - .15));
      const steps = 6, tread = .3, rise = .165, end = Math.max(steps * tread + 3, Math.min(e.L - 1, steps * tread + 6.6));
      const baseY = levelAt(...toWorld(f, -.5, depth * .6)), top = baseY + steps * rise, under = Math.min(baseY, ground(...toWorld(f, end, depth))) - .5;
      for (let k = 0; k < steps; k++) { const y = baseY + (k + 1) * rise; kit.box(C_BROWN, f, (k + .5) * tread, (y + under) / 2, depth / 2, tread + .004, y - under, depth); floor(rectRing(f, k * tread, 0, (k + 1) * tread, depth), y); }
      kit.box(C_BROWN, f, (steps * tread + end) / 2, (top + under) / 2, depth / 2, end - steps * tread, top - under, depth); floor(rectRing(f, steps * tread, 0, end, depth), top);
      // mureta branca do lado da rua (inclinada no lance, reta no patamar) e grade por cima
      const A = toWorld(f, 0, depth + .08), B = toWorld(f, steps * tread, depth + .08), Cc = toWorld(f, end + .08, depth + .08), D = toWorld(f, end + .08, 0);
      kit.wall(C_WHITE, A, B, .16, under, baseY + .7, under, top + .7); kit.wall(C_WHITE, B, Cc, .16, under, top + .7, under, top + .7); kit.wall(C_WHITE, Cc, D, .16, under, top + .7, under, top + .7);
      kit.rail(C_STEEL, [A[0], baseY + 1.02, A[1]], [B[0], top + 1.02, B[1]], .025); kit.rail(C_STEEL, [B[0], top + 1.02, B[1]], [Cc[0], top + 1.02, Cc[1]], .025); kit.rail(C_STEEL, [Cc[0], top + 1.02, Cc[1]], [D[0], top + 1.02, D[1]], .025);
      for (let x = steps * tread; x <= end + .1; x += 1.65) { const p = toWorld(f, Math.min(end + .08, x), depth + .08); kit.rail(C_STEEL, [p[0], top + .7, p[1]], [p[0], top + 1.02, p[1]], .02); }
      kit.rail(C_STEEL, [A[0], baseY + .7, A[1]], [A[0], baseY + 1.02, A[1]], .02);
      solid([toWorld(f, 0, depth), toWorld(f, end + .16, depth), toWorld(f, end + .16, depth + .16), toWorld(f, 0, depth + .16)], top + .7, 'mureta-prata');
      solid([toWorld(f, end, 0), toWorld(f, end + .16, 0), toWorld(f, end + .16, depth), toWorld(f, end, depth)], top + .7, 'mureta-prata');
      // pano de vidro da torre, porta e marquise reta cinza sobre o patamar
      const mid = (steps * tread + end) / 2, span = end - steps * tread;
      kit.box('glass', f, mid, top + 1.3, .05, span - .3, 2.6, .08); kit.box('glass', f, mid, top + 4.55, .05, span - .3, 2.5, .08);
      for (let x = steps * tread + .15; x <= end - .1; x += (span - .3) / 4) kit.box(C_WHITE, f, x, top + 2.9, .09, .09, 5.8, .1);
      kit.box(C_WHITE, f, mid, top + 2.62, .09, span - .3, .08, .1);
      kit.box(C_MAT, f, mid, top + 1.1, .1, 1.7, 2.2, .06);
      kit.box(C_GREY, f, mid, top + 3.05, depth / 2 + .25, span + .5, .16, depth + .7);
      hydrant(...toWorld(f, mid - .5, depth + .9));
      const [ex, ez] = toWorld(f, mid, 0);
      notes.lower = { x: ex, z: ez, baseY, top, depth, clear, steps, path: [toWorld(f, -1.2, depth / 2), toWorld(f, mid, depth / 2)] };
      exclusions.push({ kind: 'entrada-2', rings: [rectRing(f, -2.4, -.2, end + 2.2, clear + .4)] });
    }
  }
  if (prata && ground0) {
    // Andar zero (fundos): porta de vidro no nível do chão sob a marquise curva translúcida; logo
    // depois dela a escada de espelhos coloridos sobe rente à fachada (para oeste) até a porta de
    // cima. Hidrante ao pé da escada, totem do prédio e faixa elevada com zebrado amarelo.
    const back = backDoorFrame(prata, ground0);
    if (back) {
      const { e, along } = back, q = { cx: back.door[0], cz: back.door[1] };
      const f = frameAt(q.cx, q.cz, yawOf(...along)), W = (x, z) => toWorld(f, x, z);   // +x = leste pela fachada, +z = para a rua
      let reach = 9; for (let t = 2; t <= 20; t += .25) { if (roadClearance(roads, ...W(0, t)) <= SIDEWALK) { reach = t; break; } }
      // piso do largo em frente (acompanha o relevo já nivelado com a rua)
      const P = (x, z) => { const [wx, wz] = W(x, z); return [wx, ground(wx, wz) + .085, wz]; };
      kit.drape(C_SLAB, P, -10, 0, 12, reach + .15, .6);
      const doorY = levelAt(...back.front) + .085;
      glassDoor(f, 0, doorY, 2.4, 2.4); canopy(f, 0, doorY + 3.3, 3.6, 2.5);
      kit.box(C_MAT, f, 0, doorY + .012, .9, 1.6, .024, 1);
      const n = RISERS.length, tread = .29, rise = .165, width = 1.5, x0 = -2.7, xTop = x0 - n * tread, endX = xTop - 2.6, out = width + .1;
      const sideY = levelAt(...W(x0 + .5, 1)) + .06, top = sideY + n * rise, under = Math.min(sideY, ...[x0, endX].map((x) => ground(...W(x, width)))) - .5;
      for (let k = 0; k < n; k++) {
        const y = sideY + (k + 1) * rise, xa = x0 - k * tread, xb = xa - tread;
        kit.box(C_TREAD, f, (xa + xb) / 2, (y + under) / 2, width / 2 + .04, tread + .004, y - under, width); floor(rectRing(f, xb, .04, xa, width + .04), y);
        const [rx, rz] = W(xa + .012, width / 2 + .04);
        kit.sign('degraus-coloridos', paintRisers, frameAt(rx, rz, f.yaw + Math.PI / 2, 0), 0, y - rise / 2, 0, width, rise, { uv: [0, 1 - (k + 1) / n, 1, 1 - k / n], size: [512, 640] });
      }
      kit.box(C_TREAD, f, (xTop + endX) / 2, (top + under) / 2, width / 2 + .04, xTop - endX, top - under, width); floor(rectRing(f, endX, .04, xTop, width + .04), top);
      glassDoor(f, (xTop + endX) / 2, top, 1.2, 2.2);
      // guarda-corpo de aço do lado da rua e corrimão na parede
      for (const height of [.55, 1.0]) { const a = W(x0, out), b = W(xTop, out), c = W(endX, out), d = W(endX, .1); kit.rail(C_STEEL, [a[0], sideY + height, a[1]], [b[0], top + height, b[1]], .025); kit.rail(C_STEEL, [b[0], top + height, b[1]], [c[0], top + height, c[1]], .025); kit.rail(C_STEEL, [c[0], top + height, c[1]], [d[0], top + height, d[1]], .025); }
      { const a = W(x0, .1), b = W(xTop, .1); kit.rail(C_STEEL, [a[0], sideY + .95, a[1]], [b[0], top + .95, b[1]], .025); }
      for (let k = 0; k <= n; k += 2) { const p = W(x0 - k * tread, out), y = sideY + k * rise; kit.rail(C_STEEL, [p[0], y, p[1]], [p[0], y + 1.0, p[1]], .022); }
      { const p = W(endX, out); kit.rail(C_STEEL, [p[0], top, p[1]], [p[0], top + 1.0, p[1]], .022); }
      solid(rectRing(f, endX - .06, width + .04, x0, width + .16), top + 1.0, 'guarda-corpo-colorido'); solid(rectRing(f, endX - .1, 0, endX, width + .16), top + 1.0, 'guarda-corpo-colorido');
      hydrant(...W(x0 + .35, width + .75));
      pottedPalm(...W(2.6, .8));
      // faixa elevada com zebrado amarelo; totem e placa de proibido estacionar no lado leste dela
      const curb = Math.max(2.2, reach - 1), crossX = 6.4;
      crosswalk(...W(crossX, reach + SIDEWALK + 1.5));
      totem('Prédio Prata', 'totem-prata', ...W(crossX + 3.3, curb), f.yaw + Math.PI / 2);
      const sign = frameAt(...W(crossX + 2.2, curb + .4), f.yaw, levelAt(...W(crossX + 2.2, curb + .4)));
      kit.cylinder(C_STEEL, sign, 0, 1.25, 0, .03, 2.5, 'y', 6); kit.cylinder(C_RED, sign, 0, 2.3, .03, .22, .03, 'z', 12); kit.cylinder(C_WHITE, sign, 0, 2.3, .05, .15, .02, 'z', 12);
      // Entrada principal sob o banner, vista só nas imagens aéreas (marquise cinza): aproximada.
      const eastEnd = (e.ax - e.bx) * along[0] + (e.az - e.bz) * along[1] > 0 ? [e.ax, e.az] : [e.bx, e.bz], fromEast = (prata.bannerEast ?? .5) * e.L;
      const m = frameAt(eastEnd[0] - along[0] * fromEast, eastEnd[1] - along[1] * fromEast, f.yaw);
      if (Math.abs(fromEast - Math.hypot(q.cx - eastEnd[0], q.cz - eastEnd[1])) > 12) {
        const mW = (x, z) => toWorld(m, x, z), mainY = levelAt(...mW(0, 2.6)) + .06, mainTop = mainY + .1, lower = Math.min(mainY, ground(...mW(0, 1))) - .5, wide = 5.4;
        kit.box(C_TREAD, m, 0, (mainTop + lower) / 2, 1.1, wide + 2.6, mainTop - lower, 2.2); floor(rectRing(m, -wide / 2 - 1.3, 0, wide / 2 + 1.3, 2.2), mainTop);
        glassDoor(m, 0, mainTop, 4, 2.5);
        kit.box(C_GREY, m, 0, mainTop + 3.3, 2.1, 8.4, .22, 4.4);
        for (const side of [-1, 1]) { kit.cylinder(C_GREY, { ...m, y: 0 }, side * 3.7, (mainTop + 3.2 + mainY) / 2 - .2, 3.9, .13, mainTop + 3.6 - mainY, 'y', 10); solid(rectRing(m, side * 3.7 - .18, 3.72, side * 3.7 + .18, 4.08), mainTop + 3.2, 'pilar'); }
        notes.main = { x: m.x, z: m.z, top: mainTop, path: [mW(0, 5), mW(0, 1)] };
        exclusions.push({ kind: 'entrada-principal', rings: [rectRing(m, -5.5, -.2, 5.5, 6)] });
      }
      const [ex, ez] = W(0, 0);
      entrances.push({ name: 'Prédio Prata', x: ex + e.nx * 4, z: ez + e.nz * 4, yaw: Math.atan2(-e.nx, -e.nz), frontage: { x: ex, z: ez, nx: e.nx, nz: e.nz, dx: along[0], dz: along[1], L: 18, clearance: reach, road: { w: 4.5 } } });
      notes.ground0 = { x: q.cx, z: q.cz, doorY, baseY: sideY, stairTop: top, reach, path: [W(x0 + 1.4, width / 2), W((xTop + endX) / 2, width / 2)] };
      exclusions.push({ kind: 'entrada-terreo', rings: [rectRing(f, -11, -.2, 13, reach + .5)] });
    }
  }
  return { solids, surfaces, exclusions, entrances, notes };
}
