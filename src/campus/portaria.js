import { distToSegment } from '../shared/geo.js';
import { frameAt, toWorld } from './landmark-kit.js';
import { yawFromBearing } from './locomotive.js';

// Portaria Bussocaba: UMA cobertura comprida (duas lajes em linha) paralela à rua, com três
// pórticos vermelhos e a testeira "bradesco". Sob ela, da ponta sudoeste para a nordeste: prédio
// da recepção, passagem de pedestres, pista de entrada, ilha da guarita, pistas de saída e a
// outra passagem de pedestres, ao lado da Agência. Em volta é tudo ASFALTO, sem calçada no meio:
// na frente, um pátio aberto para a rua (nariz da ilha da guarita, ilha da árvore entre as duas
// bocas, faixas de pedestres ao longo do meio-fio); atrás, um pátio largo até a rua interna.
// O asfalto e as calçadas usam as mesmas texturas das vias (landmark-kit: 'asphalt',
// 'asphalt-street', 'pavement') e toda calçada termina noutra calçada, numa faixa de pedestres
// ou numa guia — nada acaba solto.
// Medidas: vistas de topo do Google Earth com a grade do jogo; desenho das pistas e entradas de
// pedestres: fotos aéreas anotadas pelo usuário (contorno das vias em vermelho, pedestres em verde).

const RED = '#c8102e', SLAB = '#d9d5cb', WHITE = '#f4f3ef', DARK = '#2a2f35', HEDGE = '#3f7d3a', CURB = '#cfc9bc', ISLAND = '#bdb7aa', GREY = '#8d9398', STEP = '#8f8672', NOSE = '#6a6d70';
const ASPHALT = 'asphalt', STREET = 'asphalt-street', GROUND = 'asphalt-ground', PAVING = 'pavement', PAINT = 'paint', KERB = ['#e6e3d9', '#4b4b48'];
/** cor do chão pintado por baixo de cada asfalto (ground.js), para nenhuma fresta destoar */
const UNDER = { [ASPHALT]: '#55575a', [STREET]: '#4a4c50' };
/** altura da pista e da calçada das vias internas acima do relevo (ver roads.js); DECK = asfalto dos pátios */
const ROAD = .24, WALK = .41, DECK = ROAD - .02;
/** piso que emenda numa calçada das vias internas: passa por cima da borda de tijolos dela */
const JOIN = WALK + .016;

/** `s` = metros ao longo da cobertura a partir da ponta sudoeste; `v` = metros para DENTRO do campus */
export function planPortaria(mark, inside) {
  const frame = frameAt(mark.x, mark.z, yawFromBearing(mark.heading)), half = mark.length / 2, depth = mark.depth;
  const inward = inside(...toWorld(frame, 0, 40)) ? 1 : -1;   // sinal do +z local que aponta para dentro
  const at = (s, v) => toWorld(frame, s - half, v * inward);
  const local = (x, z) => { const dx = x - frame.x, dz = z - frame.z, c = Math.cos(frame.yaw), sn = Math.sin(frame.yaw); return [dx * c - dz * sn + half, (dx * sn + dz * c) * inward]; };
  const [ox, oz] = at(0, 0), [ix, iz] = at(0, 1);
  return { ...mark, frame, half, depth, inward, at, local, inVec: [ix - ox, iz - oz], lanes: [],
    ring: [at(0, -depth / 2), at(mark.length, -depth / 2), at(mark.length, depth / 2), at(0, depth / 2)] };
}

/** interpola v numa poligonal [[s, v], ...] crescente em s */
const lineAt = (line, s) => { if (s <= line[0][0]) return line[0][1]; for (let i = 1; i < line.length; i++) if (s <= line[i][0]) return line[i - 1][1] + (line[i][1] - line[i - 1][1]) * (s - line[i - 1][0]) / ((line[i][0] - line[i - 1][0]) || 1); return line.at(-1)[1]; };
/** distância de (s, v) ao eixo de uma via */
export const distTo = (P, road, s, v) => { const [x, z] = P.at(s, v); let d = Infinity; for (let i = 1; i < road.pts.length; i++) d = Math.min(d, distToSegment(x, z, ...road.pts[i - 1], ...road.pts[i]).d); return d; };
/** primeiro v, andando de `from` para `to` com s constante, que fica a `limit` m do eixo da via (null se não chega) */
export function reach(P, road, s, from, to, limit) {
  const step = Math.sign(to - from) * .25;
  for (let v = from; (to - v) * step > 0; v += step) {
    if (distTo(P, road, s, v + step) > limit) continue;
    let a = v, b = v + step;
    for (let k = 0; k < 14; k++) { const m = (a + b) / 2; if (distTo(P, road, s, m) <= limit) b = m; else a = m; }
    return b;
  }
  return null;
}
/** distância ao longo do eixo da via do ponto dela mais próximo de (x, z) */
export function alongOf(road, x, z) {
  let best = Infinity, at = 0, run = 0;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i], q = distToSegment(x, z, ...a, ...b), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (q.d < best) { best = q.d; at = run + length * q.t; }
    run += length;
  }
  return at;
}

/**
 * Ajusta as pistas à cobertura, mede as duas ruas vizinhas e declara os pátios:
 * `P.frente` (meio-fio da rua), `P.plaza` (borda do pátio de dentro, já no leito da rua interna),
 * `world.sidewalkVoids` (sem calçada nem guia), `C.wallCutouts` e `world.boundaryOpenings` (frente fora do muro),
 * `C.wallOpenings` (vãos do muro sob a cobertura) e `C.sealLines` (a portaria fecha o perímetro).
 */
export function fitPortariaRoads(P, world, C) {
  const [inLane, outLane] = P.pistas, D = P.depth, L = P.length, peds = P.pedestres || [];
  for (const [id, width, span, axis] of [[P.entrada, P.larguraEntrada ?? inLane[1] - inLane[0], inLane, P.eixoEntrada], [P.saida, P.larguraSaida ?? 8, outLane, P.eixoSaida]]) {
    const road = world.roads.find((r) => r.id === id);
    if (!road) continue;
    // eixo medido (da rua para dentro), entre os dois nós de ligação do OSM
    if (axis) { const pts = axis.map(([s, v]) => P.at(s, v)); road.pts = [road.pts[0], ...(P.local(...road.pts[0])[1] < 0 ? pts : pts.reverse()), road.pts.at(-1)]; }
    // as pistas cruzam pátios de asfalto contínuo: sem malha, pintura nem calçadas próprias (roads.js)
    road.w = width; road.sidewalkSide = 2; road.hidden = true;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const a = P.local(...road.pts[i]), b = P.local(...road.pts[i + 1]);
      if (a[1] * b[1] > 0 || a[1] === b[1]) continue;
      const t = a[1] / (a[1] - b[1]), s = a[0] + (b[0] - a[0]) * t;
      if (s < 0 || s > L) continue;
      const x = road.pts[i][0] + (road.pts[i + 1][0] - road.pts[i][0]) * t, z = road.pts[i][1] + (road.pts[i + 1][1] - road.pts[i][1]) * t;
      const length = Math.hypot(road.pts[i + 1][0] - road.pts[i][0], road.pts[i + 1][1] - road.pts[i][1]) || 1, order = b[1] > a[1] ? 1 : -1;
      // `order`: +1 se os pontos da via seguem para dentro do campus; (tx, tz) aponta sempre para dentro
      const [gx, gz] = P.at((span[0] + span[1]) / 2, 0);
      P.lanes.push({ road, index: i, order, s, x, z, tx: (road.pts[i + 1][0] - road.pts[i][0]) / length * order, tz: (road.pts[i + 1][1] - road.pts[i][1]) / length * order, width, exit: id === P.saida,
        span, gx, gz, gateWidth: span[1] - span[0] });   // cancelas: toda a faixa de rolamento sob a cobertura
      break;
    }
  }
  if (P.lanes.length !== 2) return P.lanes;
  // rua pública da frente e rua interna dos fundos: as que recebem as pontas da pista de entrada
  const cars = world.roads.filter((r) => r.kind !== 'foot' && !r.bridge && !r.hidden), entry = P.lanes.find((l) => !l.exit).road;
  const joined = (end) => cars.find((r) => r.pts.some((p) => Math.hypot(p[0] - end[0], p[1] - end[1]) < .5));
  const ends = [entry.pts[0], entry.pts.at(-1)].sort((a, b) => P.local(...a)[1] - P.local(...b)[1]), street = joined(ends[0]), inner = joined(ends[1]);
  if (!street || !inner) return P.lanes;
  P.rua = street;
  const table = (road, limit, from, to, s0, s1, count) => { const out = []; for (let k = 0; k <= count; k++) { const s = s0 + (s1 - s0) * k / count, v = reach(P, road, s, from, to, limit); if (v !== null) out.push([s, v]); } return out; };
  // meio-fio da rua pública e a faixa dela que o pátio da frente cobre (onde ficam as faixas de pedestres)
  P.frente = table(street, street.w / 2, -D / 2 - 1, -80, -9, L + 9, 2 * (L + 18));
  P.frenteRua = table(street, street.w / 2 - 2.3, -D / 2 - 1, -80, -9, L + 9, 2 * (L + 18));
  // rua interna: borda do pátio (30 cm para dentro do leito), meio-fio de cá e meio da calçada dela
  const [p0, p1] = P.patio ?? [0, L], hw = inner.w / 2;
  P.plaza = table(inner, hw - .3, D / 2 + 1, 80, p0, p1, Math.max(21, Math.round((p1 - p0) / 1.2)));
  P.meioFioInterno = table(inner, hw, D / 2 + 1, 80, p0 - 8, p1 + 8, 2 * Math.round(p1 - p0 + 16));
  P.calcadaInterna = table(inner, hw + 2, D / 2 + 1, 80, p0 - 8, p1 + 8, 2 * Math.round(p1 - p0 + 16));
  if (P.frente.length < 2 || P.plaza.length < 2) return P.lanes;
  // pontos medidos: v = null fica no meio-fio da rua; v = 'interna' fica na calçada da rua interna
  const fix = (line) => line.map(([s, v, lift]) => v === 'guia' ? [s, lineAt(P.meioFioInterno, s), lift] : v === 'interna' ? [s, lineAt(P.calcadaInterna, s), lift ?? JOIN] : [s, v ?? lineAt(P.frente, s) + .05, lift]);
  for (const key of ['leque', 'calcadaRua', 'calcadaAgencia']) if (P[key]) P[key] = { ...P[key], ...Object.fromEntries(Object.entries(P[key]).filter(([, line]) => Array.isArray(line)).map(([side, line]) => [side, fix(line)])) };
  if (P.ilhaContorno) P.ilhaContorno = fix(P.ilhaContorno);
  // calçada dos fundos: cada borda é uma curva [início, controle, fim], amostrada em ordem crescente de s
  if (P.calcadaFundos) {
    const curve = (line) => { const [a, c, b] = fix(line); return Array.from({ length: 15 }, (_, k) => { const t = k / 14, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }).sort((p, q) => p[0] - q[0]); };
    P.calcadaFundos = { fora: curve(P.calcadaFundos.fora), dentro: curve(P.calcadaFundos.dentro) };
  }
  // bocas do pátio da frente: a borda dele dos dois lados (crescente em s), entre elas a cobertura
  P.bocaSW = P.leque ? P.leque.fora.slice(1, P.leque.guia).reverse().map(([s, v]) => [s, v]) : [[inLane[0], -D / 2]];
  P.bocaNE = P.calcadaRua ? P.calcadaRua.esquerda.map(([s, v]) => [s, v]) : [[outLane[1], -D / 2]];
  const f0 = P.bocaSW[0][0], f1 = P.bocaNE.at(-1)[0], wallS = P.muro?.[0]?.[0] ?? L + .5;
  P.forecourt = [...P.bocaSW, [P.bocaSW.at(-1)[0], -D / 2], [P.bocaNE[0][0], -D / 2], ...P.bocaNE, [f1, lineAt(P.frenteRua, f1)], ...P.frenteRua.filter(([s]) => s > f0 && s < f1).reverse(), [f0, lineAt(P.frenteRua, f0)]].map(([s, v]) => P.at(s, v));
  P.plazaRing = [P.at(p0, D / 2), P.at(p1, D / 2), ...[...P.plaza].reverse().map(([s, v]) => P.at(s, v))];
  const under = [P.at(0, -D / 2 - .2), P.at(wallS, -D / 2 - .2), P.at(wallS, D / 2), P.at(0, D / 2)];
  for (const [ring, kind] of [[under, ASPHALT], [P.forecourt, STREET], [P.plazaRing, ASPHALT]]) world.areas.push({ id: 'cdd/portaria', tags: {}, kind: 'parking', rings: [ring], color: UNDER[kind], plain: true });
  // ao longo do pátio de dentro a rua interna não tem calçada nem guia do lado de cá (recorte exato: polígonos convexos)
  for (let i = 1; i < P.plaza.length; i++) { const a = P.plaza[i - 1], b = P.plaza[i]; (world.sidewalkVoids ||= []).push([P.at(a[0], D / 2 - 1), P.at(b[0], D / 2 - 1), P.at(...b), P.at(...a)]); }
  // faixa de pedestres do pátio até o outro lado da rua interna: guia rebaixada na chegada (roads.js) e sem árvore ali (nature.js)
  if (P.faixaInterna) {
    const [v0, v1, from] = P.faixaInterna, mid = (v0 + v1) / 2;
    P.asphaltAt = (s, v) => v <= lineAt(P.plaza, s) || distTo(P, inner, s, v) <= hw - .15;
    let s = from; while (s > p0 && P.asphaltAt(s - .2, mid)) s -= .2;
    const at = alongOf(inner, ...P.at(s, mid));
    if (!inner.sidewalkCrossings?.some((d) => Math.abs(d - at) < 3)) inner.sidewalkCrossings = [...(inner.sidewalkCrossings || []), at - 1.3, at + 1.3];
    P.chegada = [s, mid];
  }
  // passagens de pedestres sob a cobertura (catracas)
  P.pedestrians = peds.map((p) => { const [x, z] = P.at(p.s, 0); return { ...p, x, z, tx: P.inVec[0], tz: P.inVec[1], lift: WALK }; });
  if (C) {
    // região fora do muro: da linha da cobertura até a rua; `muro` = fechamento do lado da Agência
    const side = P.muro || [[L + .5, 0]], deep = Math.min(...P.frente.filter(([s]) => s > -1 && s < side.at(-1)[0] + 1).map((k) => k[1])) - 4;
    const front = [P.at(-.5, 0), ...side.map(([s, v]) => P.at(s, v)), P.at(side.at(-1)[0], deep), P.at(-.5, deep)];
    (C.wallCutouts ||= []).push(front);
    (world.boundaryOpenings ||= []).push(front);   // sem a cortina do limite do bairro atravessando as bocas (map/props.js)
    // vãos do muro na linha da cobertura: pedestres + pista de entrada; pistas de saída + pedestres
    const lo = inLane[0], hi = outLane[1], gaps = [[Math.min(lo, ...peds.filter((p) => p.s < L / 2).map((p) => p.s - p.w / 2)), inLane[1]], [outLane[0], Math.max(hi, ...peds.filter((p) => p.s > L / 2).map((p) => p.s + p.w / 2))]];
    for (const [s0, s1] of gaps) (C.wallOpenings ||= []).push({ a: P.at(s0 + .1, 0), b: P.at(s1 - .1, 0), r: .25 });
    (C.sealLines ||= []).push([P.at(-.5, 0), P.at(side[0][0], 0)]);
  }
  return P.lanes;
}

const paintFascia = (name) => (g, w, h) => {
  // visto da rua: faixa vermelha "bradesco" do lado da emenda das lajes e o nome em fundo branco
  const split = w * .56;
  g.fillStyle = WHITE; g.fillRect(0, 0, w, h); g.fillStyle = RED; g.fillRect(0, h * .08, split, h * .84);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#ffffff'; g.font = `bold ${Math.round(h * .58)}px Arial`; g.fillText('bradesco', split / 2, h * .52);
  g.fillStyle = '#20242a'; g.font = `${Math.round(h * .4)}px Arial`; g.fillText(name, split + (w - split) / 2, h * .53);
};

/**
 * `surfaceAt(x, z, maxY)`: altura real das vias internas e calçadas já construídas (roads.js), se houver;
 * `streetMesh`: false quando a rua da frente é só pintura no relevo — o pátio usa então o asfalto de grão largo.
 */
export function buildPortaria(kit, P, { ground, clearance, surfaceAt, streetMesh = true }) {
  const solids = [], surfaces = [], exclusions = [], trees = [], holes = [], L = P.length, D = P.depth, half = P.half;
  const y0 = ground(P.frame.x, P.frame.z), f = { ...P.frame, y: y0 }, z = (v) => v * P.inward, X = (s) => s - half;
  const under = y0 + 5.0, top = y0 + 6.15, mid = L / 2;
  const solid = (s0, v0, s1, v1, height, kind) => solids.push({ rings: [[P.at(s0, v0), P.at(s1, v0), P.at(s1, v1), P.at(s0, v1)]], top: y0 + height, kind });
  const free = (s0, v0, s1, v1, margin) => [P.at(s0, v0), P.at(s1, v0), P.at(s1, v1), P.at(s0, v1), P.at((s0 + s1) / 2, (v0 + v1) / 2)].every((p) => clearance(...p) > margin);
  const [inLane, outLane] = P.pistas, [b0, b1] = P.recepcao, peds = P.pedestres || [], wallS = P.muro?.[0]?.[0] ?? L + .5;
  const i0 = inLane[1] + .15, i1 = outLane[0] - .15;   // ilha da guarita, entre a pista de entrada e as de saída
  const node = (s, v, lift) => { const [x, zz] = P.at(s, v); return [x, ground(x, zz) + lift, zz]; };
  const cell = (color, q) => { kit.quad(color, ...q, [0, 1, 0]); surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: Math.max(...q.map((p) => p[1])) }); };
  /** piso que acompanha o relevo, em colunas de s, de v0At(s) a v1At(s); pisável */
  const column = (color, s0, s1, v0At, v1At, lift, step = 2.5, row = 3) => {
    const cols = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i < cols; i++) {
      const sa = s0 + (s1 - s0) * i / cols, sb = s0 + (s1 - s0) * (i + 1) / cols, sm = (sa + sb) / 2, rows = Math.max(1, Math.ceil(Math.abs(v1At(sm) - v0At(sm)) / row));
      const at = (s, k) => node(s, v0At(s) + (v1At(s) - v0At(s)) * k / rows, lift);
      for (let j = 0; j < rows; j++) cell(color, [at(sa, j), at(sb, j), at(sb, j + 1), at(sa, j + 1)]);
    }
  };
  /** caminho entre duas bordas ([[s, v, altura?], ...] com o mesmo número de pontos); a altura própria de um ponto faz a rampa */
  const path = (color, left, right, lift) => {
    const mix = (a, b, t) => node(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] ?? lift) + ((b[2] ?? lift) - (a[2] ?? lift)) * t);
    for (let i = 1; i < left.length; i++) {
      const n = Math.max(1, Math.ceil(Math.max(Math.hypot(left[i][0] - left[i - 1][0], left[i][1] - left[i - 1][1]), Math.hypot(right[i][0] - right[i - 1][0], right[i][1] - right[i - 1][1])) / 2));
      for (let k = 0; k < n; k++) cell(color, [mix(left[i - 1], left[i], k / n), mix(right[i - 1], right[i], k / n), mix(right[i - 1], right[i], (k + 1) / n), mix(left[i - 1], left[i], (k + 1) / n)]);
    }
  };
  /** guia de 18 cm ao longo de [[s, v, altura?], ...] em blocos de ~1,1 m; duas cores = meio-fio bicolor das vias internas */
  const kerb = (line, colors = KERB, lip = .012) => {
    let block = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(length / 1.1)), ha = a[2] ?? WALK, hb = b[2] ?? WALK;
      if (length < .05) continue;
      const end = (t) => { const p = P.at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), g = ground(...p); return [p, g - .12, g + ha + (hb - ha) * t + lip]; };
      for (let k = 0; k < n; k++) { const [pa, ba, ta] = end(k / n), [pb, bb, tb] = end((k + 1) / n); kit.wall(colors[block++ % colors.length], pa, pb, .18, ba, ta, bb, tb); }
    }
  };
  /** pintura de solo: retângulo de centro (s, v) com o lado comprido na direção (ds, dv); `y` = altura de cada canto */
  const stripe = (s, v, ds, dv, long, wide, y = (p, q) => node(p, q, DECK + .04), color = PAINT) => {
    const n = Math.hypot(ds, dv) || 1, a = [ds / n * long / 2, dv / n * long / 2], b = [-dv / n * wide / 2, ds / n * wide / 2];
    kit.quad(color, ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => y(s + a[0] * i + b[0] * j, v + a[1] * i + b[1] * j)), [0, 1, 0]);
  };
  /** marcas de `long` x `wide` a cada `gap` m ao longo de uma poligonal [[s, v], ...] (tachões, linha tracejada) */
  const marks = (line, gap, long, wide) => {
    let next = gap / 2;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      for (; next <= length; next += gap) stripe(a[0] + (b[0] - a[0]) * next / length, a[1] + (b[1] - a[1]) * next / length, b[0] - a[0], b[1] - a[1], long, wide);
      next -= length;
    }
  };

  if (P.forecourt && P.plaza?.length > 1) {
    const [p0, p1] = P.patio ?? [0, L], between = (a, b) => (s) => a[1] + (b[1] - a[1]) * (s - a[0]) / ((b[0] - a[0]) || 1), spans = (line, each) => { for (let i = 1; i < line.length; i++) each(line[i - 1], line[i]); };
    const street = (s) => lineAt(P.frenteRua, s), walk0 = P.bocaSW.at(-1)[0], FRONT = streetMesh ? STREET : GROUND;
    // ---- asfalto contínuo. Pátio da frente: da cobertura até 2,3 m para dentro do leito da rua, com a
    // textura dela; sob a cobertura e pátio de dentro (até o leito da rua interna): textura das vias internas
    // (malha de 1,5 m: fora do platô o relevo desce em curva até a rua)
    spans(P.bocaSW, (a, b) => column(FRONT, a[0], b[0], between(a, b), street, DECK + .01, 1.5, 1.5));
    column(FRONT, walk0, p1, () => -D / 2, street, DECK + .01, 1.5, 1.5);
    spans(P.bocaNE, (a, b) => column(FRONT, a[0], b[0], between(a, b), street, DECK + .01, 1.5, 1.5));
    column(ASPHALT, walk0, p1, () => -D / 2, () => D / 2, DECK);
    // (nos fundos da recepção o asfalto começa na guia em curva da calçada)
    const back = P.calcadaFundos?.fora, bx = back ? back.at(-1)[0] : p0, step = (p1 - p0) / (P.plaza.length - 1);
    if (back) column(ASPHALT, p0, bx, (s) => lineAt(back, s), (s) => lineAt(P.plaza, s), DECK, step);
    column(ASPHALT, bx, p1, () => D / 2, (s) => lineAt(P.plaza, s), DECK, step);
    if (back) column(PAVING, p0, bx, () => D / 2, (s) => lineAt(back, s), WALK - .005, 1.2, 2);
    // ---- calçadas (mesmo piso das calçadas das vias internas): sob a cobertura nas duas pontas, o leque em
    // volta do canteiro, rente à Agência dos dois lados da cobertura e a laje ao lado da ponta sudoeste
    column(PAVING, 0, walk0, () => -D / 2 - .2, () => D / 2, WALK - .005, 4);
    column(PAVING, p1, wallS - .2, () => -D / 2, () => D / 2, WALK - .005, 6);
    if (P.leque) {
      path(PAVING, P.leque.dentro, P.leque.fora, WALK - .005);
      cell(PAVING, [node(-.2, -D / 2 - .2, WALK - .005), node(.7, -D / 2 - .2, WALK - .005), node(P.leque.dentro.at(-2)[0], P.leque.dentro.at(-2)[1], P.leque.dentro.at(-2)[2] ?? WALK - .005), node(-.2, P.leque.dentro.at(-2)[1], P.leque.dentro.at(-2)[2] ?? WALK - .005)]);
      kerb(P.leque.fora.slice(0, P.leque.guia), [WHITE]);
    }
    if (P.calcadaRua) path(PAVING, P.calcadaRua.esquerda, P.calcadaRua.direita, WALK - .005);
    if (P.calcadaAgencia) path(PAVING, P.calcadaAgencia.esquerda, P.calcadaAgencia.direita, WALK - .005);
    if (P.calcadaFundos?.dentro) {
      const inner = P.calcadaFundos.dentro, far = (s) => lineAt(P.calcadaInterna, s);
      column(PAVING, inner[0][0], p0, (s) => lineAt(inner, s), far, JOIN, 1.2, 2);
      kerb([[p0, .2], ...[...inner].reverse()], [CURB], 0);   // arremate do lado do gramado
    }
    // ---- guias: passagem sudoeste | pista de entrada; pátio | laje; e a linha inteira do lado da Agência,
    // do meio-fio da rua até o meio-fio da rua interna
    kerb([[walk0, -D / 2 - .2], [walk0, D / 2]]);
    kerb(back ? [...back, [bx, D / 2]] : [[walk0, D / 2], [p0, D / 2], [p0, lineAt(P.meioFioInterno, p0)]]);
    kerb([...(P.calcadaRua ? [...P.calcadaRua.esquerda].reverse() : [[p1, -D / 2]]), [p1, D / 2], [p1, lineAt(P.meioFioInterno, p1)]]);
    if (P.calcadaAgencia) kerb([[wallS - .2, .3], ...P.calcadaAgencia.direita], [CURB], 0);
    // ---- faixas de pedestres nas duas bocas: de ponta a ponta, atravessadas no meio-fio da rua
    for (const [sa, sb] of P.faixasBoca || []) for (let s = sa; s <= sb;) {
      const m = (lineAt(P.frente, s + .3) - lineAt(P.frente, s - .3)) / .6, k = Math.hypot(1, m);
      stripe(s + m / k * .5, lineAt(P.frente, s) - .5 / k, m, -1, 3.3, .45);
      s += .95 / k;
    }
    for (const line of P.tachoes || []) marks(line, .6, .2, .2);
    // ---- faixa de pedestres de dentro: da calçada rente à Agência até a guia do outro lado da rua interna
    if (P.faixaInterna && P.asphaltAt) {
      const [v0, v1, from] = P.faixaInterna;
      const onTop = (s, v) => { const [x, zz] = P.at(s, v), g = ground(x, zz) + DECK, r = surfaceAt?.(x, zz, g + .16); return [x, (Number.isFinite(r) && r > g ? r : g) + .04, zz]; };
      for (let s = from; s > p0; s -= .94) {
        let v = v0; while (v < v1 - 1e-6 && P.asphaltAt(s, v + .1)) v += .1;
        if (v - v0 < 1.2) break;
        stripe(s, (v0 + v) / 2, 0, 1, v - v0, .45, onTop);
      }
    }
  }

  // ---- duas lajes em linha, com platibanda branca
  for (const [s0, s1] of [[0, mid - .12], [mid + .12, L]]) {
    kit.box(SLAB, f, X((s0 + s1) / 2), (under + top) / 2 - y0, 0, s1 - s0, top - under, D);
    for (const v of [-D / 2 + .12, D / 2 - .12]) kit.box(WHITE, f, X((s0 + s1) / 2), (under + top) / 2 - y0 + .14, z(v), s1 - s0 + .04, top - under + .28, .26);
    for (const s of [s0 + .12, s1 - .12]) kit.box(WHITE, f, X(s), (under + top) / 2 - y0 + .14, 0, .26, top - under + .28, D);
  }
  // ---- três pórticos vermelhos: viga por cima das lajes e pernas nas duas bordas
  for (const s of [2.2, mid, L - 2.2]) {
    kit.box(RED, f, X(s), top - y0 + .5, 0, .8, .64, D + 1.5);
    for (const v of [-D / 2 - .4, D / 2 + .4]) {
      if (!free(s - .4, v - .4, s + .4, v + .4, .3)) continue;
      const g = ground(...P.at(s, v));
      kit.box(RED, { ...f, y: 0 }, X(s), (g + top + .82) / 2, z(v), .72, top + .82 - g, .72); solid(s - .42, v - .42, s + .42, v + .42, 7, 'pilar-portaria');
    }
  }
  // ---- testeira "bradesco · Portaria Bussocaba" na laje sudoeste, voltada para a rua
  // (começa depois do pórtico da ponta, para a perna vermelha não cobrir o nome)
  kit.sign('portaria-bussocaba', paintFascia(P.name || 'Portaria'), f, X((2.75 + mid - .3) / 2), top - y0 - .5, z(-D / 2 - .03), mid - 3.05, 1.05, { reverse: P.inward > 0, size: [2048, 128] });
  // ---- prédio da recepção sob a ponta sudoeste (branco, janelas em faixa, porta para a passagem)
  kit.box(WHITE, f, X((b0 + b1) / 2), (under - y0) / 2, 0, b1 - b0, under - y0, D - 1.2);
  kit.box('glass', f, X((b0 + b1) / 2), 1.95, 0, b1 - b0 + .06, .95, D - 2.6); kit.box('glass', f, X(b1 + .02), 1.95, 0, .08, .95, D - 4);
  kit.box(DARK, f, X(b1 + .03), WALK + 1.05, z(-D / 2 + 2.2), .08, 2.1, 1); kit.box(RED, f, X((b0 + b1) / 2), WALK + .12, 0, b1 - b0 + .1, .24, D - 1.1);
  solid(b0, -D / 2 + .6, b1, D / 2 - .6, 5, 'recepcao-portaria');
  // ---- ilha da guarita: da frente da cobertura até o fim da guarita, que avança para o pátio de dentro
  {
    const h = WALK + .01, [g0, g1, gv0, gv1] = P.guarita ?? [i0 + .5, i1 - .5, 2, 11], v0 = -D / 2 + .5, v1 = gv1 + .6;
    kit.box(ISLAND, f, X((i0 + i1) / 2), h / 2, z((v0 + v1) / 2), i1 - i0, h, v1 - v0); for (const s of [i0 + .1, i1 - .1]) kit.box(CURB, f, X(s), h / 2 + .01, z((v0 + v1) / 2), .2, h + .02, v1 - v0);
    surfaces.push({ rings: [[P.at(i0, v0), P.at(i1, v0), P.at(i1, v1), P.at(i0, v1)]], y: y0 + h });
    const gc = (g0 + g1) / 2, gm = (gv0 + gv1) / 2;
    kit.box(WHITE, f, X(gc), h + 1.45, z(gm), g1 - g0, 2.9, gv1 - gv0); kit.box('glass', f, X(gc), h + 1.75, z(gm), g1 - g0 + .06, 1, gv1 - gv0 - 1); kit.box(GREY, f, X(gc), h + 3, z(gm), g1 - g0 + .4, .22, gv1 - gv0 + .4);
    solid(g0, gv0, g1, gv1, h + 3.1, 'guarita');
    kit.box(WHITE, f, X((i0 + i1) / 2), h + .55, 0, i1 - i0 - .3, 1.1, .16);   // fechamento baixo na linha do muro
    // nariz em crescente para o lado da rua (ilha baixa, de guia branca), apontando para a boca de entrada
    if (P.nariz) {
      const low = [[i0, v0], ...P.nariz.baixo, P.nariz.ponta], high = [[i1, v0], ...P.nariz.alto, P.nariz.ponta], lift = DECK + .14;
      for (let i = 1; i < low.length; i++) cell(NOSE, [node(...low[i - 1], lift), node(...high[i - 1], lift), node(...high[i], lift), node(...low[i], lift)]);
      for (const line of [low, high]) kerb(line.map(([s, v]) => [s, v, lift]), [WHITE], .02);
    }
  }
  // ---- calçada rente à Agência: degraus e covas de árvore
  for (const [s0, s1, v0, v1, n] of P.degraus || []) for (let k = 0; k < n; k++) { const v = v0 + (v1 - v0) * (k + .5) / n, [x, zz] = P.at((s0 + s1) / 2, v); kit.box(STEP, { ...f, x, z: zz, y: ground(x, zz) + WALK }, 0, .012, 0, s1 - s0, .024, .22); }
  for (const [s, v] of P.covas || []) { const [x, zz] = P.at(s, v); kit.box('#3b3f38', { ...f, x, z: zz, y: ground(x, zz) + WALK }, 0, .012, 0, .9, .024, .9); }
  // ---- ilha da árvore entre as duas bocas: nariz redondo para o lado da cobertura, base no meio-fio da rua
  if (P.ilha) {
    const [ix, iz] = P.at(P.ilha[0], P.ilha[1]), r = P.ilha[2], ring = P.ilhaContorno ? P.ilhaContorno.map(([s, v]) => P.at(s, v)) : Array.from({ length: 12 }, (_, k) => [ix + Math.cos(k * Math.PI / 6) * r, iz + Math.sin(k * Math.PI / 6) * r]);
    const levels = ring.map((p) => ground(...p)), y1 = Math.max(...levels) + WALK + .04, cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length, cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    kit.prism(CURB, ring, Math.min(...levels) - .2, y1); kit.prism('#4f9a48', ring.map(([x, zz]) => [cx + (x - cx) * .88, cz + (zz - cz) * .88]), y1 - .1, y1 + .03);
    surfaces.push({ rings: [ring], y: y1 + .03 }); holes.push(ring);   // (a ilha fica fora da área sem árvores)
    const slope = (s) => (lineAt(P.frente, s + .3) - lineAt(P.frente, s - .3)) / .6;
    // abrigo com banco (tipo ponto de ônibus) onde se espera o táxi: na ilha, de frente para a rua
    if (P.abrigoTaxi) {
      const [bs, len] = P.abrigoTaxi, m = slope(bs), k = Math.hypot(1, m), cs = bs - m / k * 1.6, cv = lineAt(P.frente, bs) + 1.6 / k;
      const a = P.at(cs - len / 2 / k, cv - m * len / 2 / k), b = P.at(cs + len / 2 / k, cv + m * len / 2 / k), c = P.at(cs, cv), fr = frameAt(c[0], c[1], Math.atan2(-(b[1] - a[1]), b[0] - a[0]), y1 + .03);
      const out = P.at(bs, lineAt(P.frente, bs) - 3), d = (p) => Math.hypot(p[0] - out[0], p[1] - out[1]), front = d(toWorld(fr, 0, 1)) < d(toWorld(fr, 0, -1)) ? 1 : -1;
      kit.box(ISLAND, fr, 0, .03, 0, len + .5, .06, 1.9);
      kit.box('#8a6a45', fr, 0, .46, -front * .3, len - .7, .07, .42); for (const x of [-len / 2 + .6, len / 2 - .6]) kit.box(DARK, fr, x, .22, -front * .3, .08, .44, .36);
      kit.box('glass', fr, 0, 1.25, -front * .78, len, 1.9, .05);
      for (const x of [-len / 2, len / 2]) for (const zz of [-.78, .7]) kit.cylinder(DARK, fr, x, 1.2, zz * front, .04, 2.4, 'y', 6);
      kit.box('#3a4048', fr, 0, 2.44, -front * .04, len + .4, .1, 1.9); kit.box('#e7c347', fr, 0, 2.3, front * .9, len + .4, .22, .05);
      solids.push({ rings: [[toWorld(fr, -len / 2, -front * .7), toWorld(fr, len / 2, -front * .7), toWorld(fr, len / 2, -front * .86), toWorld(fr, -len / 2, -front * .86)]], top: fr.y + 2.5, kind: 'abrigo-taxi' });
    }
    // vaga dos táxis rente à ilha, do lado da rua (contorno amarelo)
    if (P.vagaTaxi) {
      const [t0, t1] = P.vagaTaxi, yellow = 'paint-yellow', off = (s, dist) => { const m = slope(s), k = Math.hypot(1, m); return [s + m / k * dist, lineAt(P.frente, s) - dist / k, m, k]; };
      for (let s = t0; s < t1 - 1e-6; s += .5) for (const dist of [.3, 2.4]) { const [x, v, m, k] = off(s + .25, dist); stripe(x, v, 1, m, .5 * k + .02, .12, undefined, yellow); }
      for (const s of [t0, t1]) { const [x, v, m] = off(s, 1.35); stripe(x, v, m, -1, 2.22, .12, undefined, yellow); }
    }
    trees.push({ x: ix, z: iz, s: 1.9, r: 1.3, v: .4, pink: false });
  }
  // ---- canteiro em meia-lua com mureta curva em frente ao prédio da recepção (lado da rua)
  if (P.canteiro) {
    const [cs, cv, r] = P.canteiro, [gx, gz] = P.at(cs, cv), gy = ground(gx, gz), p = (a, q) => P.at(cs + Math.cos(a) * q, cv - Math.sin(a) * q);
    for (let k = 0; k < 10; k++) {
      const a0 = Math.PI * k / 10, a1 = Math.PI * (k + 1) / 10;
      kit.wall(WHITE, p(a0, r), p(a1, r), .22, gy - .2, gy + .95, gy - .2, gy + .95);
      kit.tri('#3f8a3c', [gx, gy + .7, gz], [p(a0, r)[0], gy + .7, p(a0, r)[1]], [p(a1, r)[0], gy + .7, p(a1, r)[1]], [0, 1, 0]);
      solids.push({ rings: [[p(a0, r - .15), p(a1, r - .15), p(a1, r + .15), p(a0, r + .15)]], top: gy + .95, kind: 'canteiro-portaria' });
    }
    for (let k = 0; k < 6; k++) { const [hx, hz] = p(.4 + k * .46, r * .55); kit.sphere(HEDGE, frameAt(hx, hz, 0, gy), 0, 1.05, 0, .6, .75); }
  }
  const outer = P.frente?.length ? Math.min(...P.frente.filter(([s]) => s > -6 && s < wallS).map((k) => k[1])) - 3 : -D / 2 - 9;
  exclusions.push({ kind: 'portaria', rings: [[P.at(-6, outer), P.at(wallS + 1, outer), P.at(wallS + 1, D / 2 + 4), P.at(-6, D / 2 + 4)], ...holes] });
  if (P.plazaRing) exclusions.push({ kind: 'patio-portaria', rings: [P.plazaRing] });
  if (P.calcadaAgencia) exclusions.push({ kind: 'calcada-portaria', rings: [[P.at(P.calcadaAgencia.esquerda[0][0] - .5, D / 2), P.at(wallS + .5, D / 2), ...P.calcadaAgencia.direita.map(([s, v]) => P.at(s + 1, v + 1)), P.at(P.calcadaAgencia.esquerda.at(-1)[0] - .5, P.calcadaAgencia.esquerda.at(-1)[1] + 1)]] });
  if (P.calcadaFundos?.dentro && P.calcadaInterna) { const inner = P.calcadaFundos.dentro; exclusions.push({ kind: 'laje-portaria', rings: [[...inner.map(([s, v]) => P.at(s, v - .6)), P.at(.5, lineAt(P.calcadaInterna, 0) + 1), P.at(inner[0][0] - .5, lineAt(P.calcadaInterna, inner[0][0]) + 1)]] }); }
  // ---- caminhão dos bombeiros parado ao lado da ponta sudoeste da cobertura (cabine para o lado dela)
  if (P.caminhaoBombeiro) {
    const [ts, tv] = P.caminhaoBombeiro, [tx, tz] = P.at(ts, tv), t = { ...f, x: tx, z: tz, y: ground(tx, tz) }, FIRE = '#c4161c';
    kit.box(DARK, t, 0, .62, 0, 7.6, .3, 2.2);                                                    // chassi
    kit.box(FIRE, t, 2.75, 1.75, 0, 2.1, 2, 2.4); kit.box('glass', t, 3.82, 2.05, 0, .06, .85, 2.1);   // cabine e para-brisa
    for (const side of [-1, 1]) kit.box('glass', t, 2.95, 2.1, side * 1.21, 1.2, .7, .05);
    kit.box(FIRE, t, -1.15, 1.85, 0, 5.3, 2.2, 2.4); kit.box(WHITE, t, -1.15, 1.35, 0, 5.34, .22, 2.44); kit.box(WHITE, t, 2.75, 1.35, 0, 2.14, .22, 2.44);
    for (const x of [-2.9, -1.2, .5]) for (const side of [-1, 1]) kit.box(GREY, t, x, 2.05, side * 1.21, 1.4, 1.1, .04);   // portas de enrolar
    kit.box(GREY, t, -1.3, 3.02, 0, 5.6, .12, .7); for (const x of [-3.6, -2.4, -1.2, 0, 1.2]) kit.box(GREY, t, x, 3.1, 0, .08, .08, .7);   // escada no teto
    kit.box('#1f5fd0', t, 2.75, 2.85, 0, .35, .2, 1.5); kit.box('#d8d8d8', t, 3.85, .75, 0, .2, .35, 2.4);                // giroflex e para-choque
    for (const x of [2.7, -1.6, -2.9]) for (const side of [-1, 1]) kit.cylinder('#17191b', t, x, .5, side * 1.05, .5, .34, 'z', 12);
    solid(ts - 3.9, tv - 1.25, ts + 3.9, tv + 1.25, t.y - y0 + 3.1, 'caminhao-bombeiros');
    exclusions.push({ kind: 'caminhao', rings: [[P.at(ts - 5.5, tv - 3), P.at(ts + 5, tv - 3), P.at(ts + 5, tv + 3), P.at(ts - 5.5, tv + 3)]] });
  }
  return { solids, surfaces, exclusions, trees, top, level: y0 };
}
