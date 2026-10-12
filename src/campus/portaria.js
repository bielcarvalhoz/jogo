import { distToSegment } from '../shared/geo.js';
import { frameAt, toWorld } from './landmark-kit.js';
import { yawFromBearing } from './locomotive.js';

// Portarias de cobertura única do campus. UMA marquise comprida paralela à rua, com pórticos
// vermelhos e a testeira "bradesco · <nome>"; sob ela, de uma ponta à outra, o prédio da recepção,
// as passagens de pedestres (catracas) e as pistas de veículos. Em volta é tudo ASFALTO, sem
// calçada no meio: na frente, um pátio aberto para a rua (faixas de pedestres ao longo do
// meio-fio); atrás, um pátio largo até a via interna. O asfalto e as calçadas usam as mesmas
// texturas das vias (landmark-kit: 'asphalt', 'asphalt-street', 'pavement') e toda calçada termina
// noutra calçada, numa faixa de pedestres ou numa guia — nada acaba solto.
//
// Cada portaria é uma feição `landmark` de tipo `portaria` (scripts/build-campus.mjs); tudo o que
// muda entre elas vem de lá, em metros do sistema da cobertura (s ao longo dela, v para dentro):
//  - Bussocaba: duas lajes em linha, três pórticos retos, DUAS pistas (entrada e saída) com a ilha
//    da guarita entre elas, ilha da árvore, abrigo de táxi e calçada rente à Agência;
//  - Wenceslau Brás: uma laje só, pórtico de duas lâminas inclinadas, pilar-letreiro vermelho e
//    UMA pista larga (`pistaUnica`) com os dois sentidos lado a lado, separados por cones e
//    balizadores e fechados por dois portões de correr.
//
// Medidas: vistas de topo do Google Earth com a grade do jogo; desenho das pistas, entradas de
// pedestres e equipamentos: fotos aéreas e de rua enviadas pelo usuário.

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
  // `saida` ausente = pista única: uma só faixa de rolamento, com os dois sentidos lado a lado
  // (Wenceslau Brás), separados só por cones e balizadores; o vão do muro é um só.
  const ways = [[P.entrada, P.larguraEntrada ?? inLane[1] - inLane[0], P.pistaUnica ? [inLane[0], outLane[1]] : inLane, P.eixoEntrada]];
  if (P.saida) ways.push([P.saida, P.larguraSaida ?? 8, outLane, P.eixoSaida]);
  for (const [id, width, span, axis] of ways) {
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
      const lane = { road, index: i, order, s, x, z, tx: (road.pts[i + 1][0] - road.pts[i][0]) / length * order, tz: (road.pts[i + 1][1] - road.pts[i][1]) / length * order, width, exit: id === P.saida,
        span, gx, gz, gateWidth: span[1] - span[0] };   // cancelas: toda a faixa de rolamento sob a cobertura
      // `P.cancelas`: uma cancela por faixa ([s0, s1, saída?]) em vez de um braço por sentido
      if (P.cancelas) lane.cancelas = P.cancelas.filter(([, , out]) => !!out === lane.exit || P.pistaUnica).map(([a0, a1, out]) => {
        const vIn = P.cancelaV ?? 2.6, [bx, bz] = P.at(a0, vIn), [ex, ez] = P.at(a1, vIn), len = Math.hypot(ex - bx, ez - bz) || 1;
        return { x: bx, z: bz, hx: (ex - bx) / len, hz: (ez - bz) / len, len, exit: !!out };
      });
      P.lanes.push(lane);
      break;
    }
  }
  if (!P.lanes.length) return P.lanes;
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
    // (pista única: um vão só, das passagens de pedestres de um lado às do outro)
    const lo = inLane[0], hi = outLane[1], pedAt = (keep) => peds.filter(keep).flatMap((p) => [p.s - p.w / 2, p.s + p.w / 2]);
    const gaps = P.pistaUnica ? [[Math.min(lo, ...pedAt(() => true)), Math.max(hi, ...pedAt(() => true))]]
      : [[Math.min(lo, ...pedAt((p) => p.s < L / 2)), inLane[1]], [outLane[0], Math.max(hi, ...pedAt((p) => p.s > L / 2))]];
    for (const [s0, s1] of gaps) (C.wallOpenings ||= []).push({ a: P.at(s0 + .1, 0), b: P.at(s1 - .1, 0), r: .25 });
    (C.sealLines ||= []).push([P.at(-.5, 0), P.at(side[0][0], 0)]);
  }
  return P.lanes;
}

const paintFascia = (name, fraction = .56) => (g, w, h) => {
  // visto da rua: faixa vermelha "bradesco" do lado da emenda das lajes e o nome em fundo branco
  const split = w * fraction;
  g.fillStyle = WHITE; g.fillRect(0, 0, w, h); g.fillStyle = RED; g.fillRect(0, h * .08, split, h * .84);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#ffffff'; g.font = `bold ${Math.round(h * .58)}px Arial`; g.fillText('bradesco', split / 2, h * .52);
  g.fillStyle = '#20242a'; g.font = `${Math.round(h * .4)}px Arial`; g.fillText(name, split + (w - split) / 2, h * .53);
};

/** Atlas dos textos pintados na pista ("REDUZA" em cima, "PARE" embaixo), desbotados como no local.
 * Um canvas só: cada palavra é uma célula, recortada por `ROAD_TEXT` — uma malha de placa para todos. */
const ROAD_TEXT = { REDUZA: [0, 0, 1, .5], PARE: [0, .5, 1, 1] };
/** Marca da matriz no totem da calçada: a copa em fita larga, que abre embaixo à esquerda e se
 * fecha à direita, com a ponta fina saindo para baixo, sobre os dois montantes do tronco.
 * Desenho simplificado em canvas a partir da marca — não é a arte original. */
const paintTotem = (g, w, h) => {
  g.fillStyle = RED; g.fillRect(0, 0, w, h);
  const k = Math.min(w, h) / 100;
  g.save(); g.translate(w / 2, h * .46); g.scale(k, k); g.rotate(-.22);
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineJoin = 'round';
  // copa: fita larga em laço, aberta no quadrante de baixo à esquerda
  g.beginPath();
  g.ellipse(0, -12, 43, 26, 0, Math.PI * .58, Math.PI * .28, false);
  g.ellipse(3, -11, 29, 13, 0, Math.PI * .28, Math.PI * .58, true);
  g.closePath(); g.fill();
  // ponta fina que sai da abertura e desce para a esquerda
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(-31, 6); g.quadraticCurveTo(-43, 18, -35, 31); g.stroke();
  // tronco: dois montantes de topo arredondado, saindo de dentro da copa
  g.lineWidth = 10;
  for (const x of [0, 17]) { g.beginPath(); g.moveTo(x, -6); g.lineTo(x, 38); g.stroke(); }
  g.restore();
};
const paintRoadText = (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(240, 238, 229, .9)';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  for (const [text, [, v0, , v1]] of Object.entries(ROAD_TEXT)) {
    const band = (v1 - v0) * h;
    g.font = `bold ${Math.round(band * .72)}px Arial`;
    g.fillText(text, w / 2, (1 - (v0 + v1) / 2) * h, w * .9);   // (a textura é virada em v: a célula de cima do atlas é a de baixo do canvas)
  }
};

/**
 * `surfaceAt(x, z, maxY)`: altura real das vias internas e calçadas já construídas (roads.js), se houver;
 * `streetMesh`: false quando a rua da frente é só pintura no relevo — o pátio usa então o asfalto de grão largo.
 */
export function buildPortaria(kit, P, { ground, clearance, surfaceAt, streetMesh = true }) {
  const solids = [], surfaces = [], exclusions = [], trees = [], palms = [], holes = [], L = P.length, D = P.depth, half = P.half;
  const y0 = ground(P.frame.x, P.frame.z), f = { ...P.frame, y: y0 }, z = (v) => v * P.inward, X = (s) => s - half;
  const under = y0 + 5.0, top = y0 + 6.15, mid = L / 2;
  const solid = (s0, v0, s1, v1, height, kind) => solids.push({ rings: [[P.at(s0, v0), P.at(s1, v0), P.at(s1, v1), P.at(s0, v1)]], top: y0 + height, kind });
  const free = (s0, v0, s1, v1, margin) => [P.at(s0, v0), P.at(s1, v0), P.at(s1, v1), P.at(s0, v1), P.at((s0 + s1) / 2, (v0 + v1) / 2)].every((p) => clearance(...p) > margin);
  const [inLane, outLane] = P.pistas, peds = P.pedestres || [], wallS = P.muro?.[0]?.[0] ?? L + .5;
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
  /** lâmina inclinada: prisma entre o retângulo do pé (s, vA, yA) e o do topo (s, vB, yB) */
  const slab = (color, s, vA, yA, vB, yB, w, t) => {
    const face = (v, y) => [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]].map(([du, dv]) => { const [x, zz] = P.at(s + du, v + dv); return [x, y, zz]; });
    const A = face(vA, yA), B = face(vB, yB);
    const avg = (ps) => ps.reduce((q, p) => [q[0] + p[0] / ps.length, q[1] + p[1] / ps.length, q[2] + p[2] / ps.length], [0, 0, 0]), c = avg([...A, ...B]);
    for (let i = 0; i < 4; i++) { const side = [A[i], A[(i + 1) % 4], B[(i + 1) % 4], B[i]], m = avg(side); kit.quad(color, ...side, [m[0] - c[0], m[1] - c[1], m[2] - c[2]]); }
    kit.quad(color, ...A, [0, -1, 0]); kit.quad(color, ...B, [0, 1, 0]);
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
    // calçada do caminho de pedestres, do passeio da rua até a cobertura (sem ela o percurso
    // atravessava o gramado): [s0, s1, v junto à rua, v junto à cobertura]
    for (const [c0, c1, cv0, cv1] of P.calcadaPedestre || []) {
      column(PAVING, c0, c1, () => cv0, () => cv1, WALK - .005, 1.2, 2);
      for (const cs of [c0, c1]) kerb([[cs, cv0], [cs, cv1]], [CURB], 0);
    }
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

  // ---- lajes da cobertura, com platibanda branca (Bussocaba: duas em linha; Wenceslau Brás: uma só)
  for (const [s0, s1] of P.lajes ?? [[0, mid - .12], [mid + .12, L]]) {
    kit.box(SLAB, f, X((s0 + s1) / 2), (under + top) / 2 - y0, 0, s1 - s0, top - under, D);
    for (const v of [-D / 2 + .12, D / 2 - .12]) kit.box(WHITE, f, X((s0 + s1) / 2), (under + top) / 2 - y0 + .14, z(v), s1 - s0 + .04, top - under + .28, .26);
    for (const s of [s0 + .12, s1 - .12]) kit.box(WHITE, f, X(s), (under + top) / 2 - y0 + .14, 0, .26, top - under + .28, D);
  }
  // ---- pórticos vermelhos. Retos (Bussocaba): viga por cima das lajes e pernas nas duas bordas.
  // Inclinados (Wenceslau Brás): PÓRTICO INTEIRO — as duas pernas sobem do chão rente às bordas da
  // laje, abrindo-se para fora, e uma viga vermelha as une por cima dela. É o "Π" aberto das fotos,
  // não duas lâminas soltas; por isso cada pórtico fica numa ponta da boca, fora do leito das pistas.
  for (const spec of P.porticos ?? [2.2, mid, L - 2.2]) {
    const ps = typeof spec === 'number' ? spec : spec.s, open = typeof spec === 'number' ? 0 : spec.abertura ?? 0;
    if (!open) {
      kit.box(RED, f, X(ps), top - y0 + .5, 0, .8, .64, D + 1.5);
      for (const v of [-D / 2 - .4, D / 2 + .4]) {
        if (!free(ps - .4, v - .4, ps + .4, v + .4, .3)) continue;
        const g = ground(...P.at(ps, v));
        kit.box(RED, { ...f, y: 0 }, X(ps), (g + top + .82) / 2, z(v), .72, top + .82 - g, .72); solid(ps - .42, v - .42, ps + .42, v + .42, 7, 'pilar-portaria');
      }
      continue;
    }
    const pw = spec.largura ?? 1.6, pt = spec.espessura ?? .55, rise = spec.altura ?? 3.2, head = spec.viga ?? .85;
    const yTop = top + rise, vTop = D / 2 + .45 + open;
    for (const side of [-1, 1]) {
      const vFoot = side * (D / 2 + .45);
      slab(RED, ps, vFoot, ground(...P.at(ps, vFoot)) - .3, side * vTop, yTop, pw, pt);
      solid(ps - pw / 2 - .05, vFoot - pt / 2 - .05, ps + pw / 2 + .05, vFoot + pt / 2 + .05, yTop - y0, 'pilar-portaria');
    }
    kit.box(RED, f, X(ps), yTop - y0 - head / 2, 0, pw, head, 2 * vTop);   // viga ligando os topos, por cima da laje
  }
  // ---- colunas brancas esguias da cobertura, rente às bordas da boca (fora do leito das pistas)
  for (const [cs, cv] of P.colunas || []) {
    const g = ground(...P.at(cs, cv));
    kit.box(WHITE, { ...f, y: 0 }, X(cs), (g + under) / 2, z(cv), .3, under - g, .3);
    solid(cs - .2, cv - .2, cs + .2, cv + .2, under - y0, 'pilar-portaria');
  }
  // ---- testeira "bradesco · <nome>" voltada para a rua
  // (começa depois do pórtico da ponta, para a perna vermelha não cobrir o nome)
  {
    const [t0, t1] = P.testeira ?? [2.75, mid - .3];
    kit.sign(`portaria-${P.id || 'cdd'}`, paintFascia(P.name || 'Portaria', P.marcaFim), f, X((t0 + t1) / 2), top - y0 - .5, z(-D / 2 - .03), t1 - t0 - .3, 1.05, { reverse: P.inward > 0, size: [2048, 128] });
  }
  // ---- pilar-letreiro vermelho na ponta da cobertura (Wenceslau Brás): lâmina alta que sobe do
  // chão, passa a laje e serve de fundo para a marca
  if (P.torre) {
    const [ts, tw, rise, tv = 0] = P.torre, g = ground(...P.at(ts, tv));
    kit.box(RED, { ...f, y: 0 }, X(ts), (g - .4 + top + rise) / 2, z(tv), tw, top + rise - g + .4, P.torreEspessura ?? 1.1);
    solid(ts - tw / 2, tv - .6, ts + tw / 2, tv + .6, top + rise - y0, 'pilar-portaria');
  }
  // ---- prédio da recepção sob uma das pontas (branco, janelas em faixa, porta para a passagem)
  if (P.recepcao) {
    const [b0, b1] = P.recepcao, bd = P.recepcaoFundo ?? D - 1.2, bh = P.recepcaoAltura ?? under - y0;
    kit.box(WHITE, f, X((b0 + b1) / 2), bh / 2, 0, b1 - b0, bh, bd);
    kit.box('glass', f, X((b0 + b1) / 2), 1.95, 0, b1 - b0 + .06, .95, bd - 1.4); kit.box('glass', f, X(b1 + .02), 1.95, 0, .08, .95, bd - 2.8);
    kit.box(DARK, f, X(b1 + .03), WALK + 1.05, z(-bd / 2 + 1.6), .08, 2.1, 1); kit.box(RED, f, X((b0 + b1) / 2), WALK + .12, 0, b1 - b0 + .1, .24, bd + .1);
    // fachada da rua envidraçada (vista nas fotos): peitoril branco, faixa de vidro e montantes
    if (P.vitrine) {
      const [w0, w1] = P.vitrine, sill = WALK + .95, head = bh - .55;
      kit.box('glass', f, X((w0 + w1) / 2), (sill + head) / 2, z(-bd / 2 - .04), w1 - w0, head - sill, .1);
      for (let x = w0; x <= w1 + 1e-6; x += (w1 - w0) / Math.max(1, Math.round((w1 - w0) / 1.5))) kit.box(WHITE, f, X(x), (sill + head) / 2, z(-bd / 2 - .07), .14, head - sill, .1);
      for (const [y, t] of [[sill, .22], [head, .3]]) kit.box(WHITE, f, X((w0 + w1) / 2), y, z(-bd / 2 - .07), w1 - w0 + .3, t, .12);
    }
    if (P.recepcaoTopo) kit.box(RED, f, X((b0 + b1) / 2), (bh + P.recepcaoTopo) / 2, 0, b1 - b0 + .14, P.recepcaoTopo - bh, bd + .14);
    solid(b0, -bd / 2, b1, bd / 2, bh, 'recepcao-portaria');
  }
  // ---- ilha da guarita: da frente da cobertura até o fim da guarita, que avança para o pátio de dentro
  if (P.guarita !== false) {
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
  // ======== equipamentos da boca (levantados nas fotos da Portaria Wenceslau Brás) ========
  /** ponto do mundo [x, y, z] em (s, v), `lift` acima do chão */
  const at3 = (s, v, lift = 0) => { const [x, zz] = P.at(s, v); return [x, ground(x, zz) + lift, zz]; };
  /** percorre uma poligonal [[s, v], ...] a passo fixo, chamando each(s, v, direção) */
  const along = (line, gap, each) => {
    let next = gap / 2;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      for (; next <= len; next += gap) each(a[0] + (b[0] - a[0]) * next / len, a[1] + (b[1] - a[1]) * next / len, [(b[0] - a[0]) / len, (b[1] - a[1]) / len]);
      next -= len;
    }
  };

  // ---- cabine do vigilante rente à passagem de pedestres, com o extintor ao lado (foto de rua)
  if (P.cabine) {
    const [cs, cv, cw = 1.4, cd = 1.4] = P.cabine, g = ground(...P.at(cs, cv)), fr = { ...f, y: 0 };
    kit.box(WHITE, fr, X(cs), g + 1.3, z(cv), cw, 2.6, cd);
    kit.box('glass', fr, X(cs), g + 1.75, z(cv), cw + .05, 1.1, cd - .5); kit.box('glass', fr, X(cs), g + 1.75, z(cv), cw - .5, 1.1, cd + .05);
    kit.box(RED, fr, X(cs), g + 2.72, z(cv), cw + .26, .22, cd + .26);
    kit.cylinder('#cf2027', fr, X(cs + cw / 2 + .45), g + .3, z(cv), .14, .6, 'y', 8);
    kit.box(DARK, fr, X(cs + cw / 2 + .45), g + .04, z(cv), .4, .08, .4);
    solid(cs - cw / 2 - .05, cv - cd / 2 - .05, cs + cw / 2 + .05, cv + cd / 2 + .05, g - y0 + 2.85, 'cabine-portaria');
  }
  // ---- portões de correr brancos nas duas bordas da boca: a folha recolhida ao lado do vão,
  // com montantes verticais, travessas e o trilho-guia no chão
  // (`eixo: 'v'` = folha recolhida AO LONGO da pista, sobre a divisória entre duas faixas; o padrão
  // é atravessada na linha da boca)
  for (const [gs, gv, width, dir, eixo = 's'] of P.portoes || []) {
    const h = 2.2, side = Math.sign(dir || 1), gy = ground(...P.at(gs, gv)), alongV = eixo === 'v';
    const g = { ...f, y: 0 }, S = (t) => alongV ? gs : gs + side * t, V = (t) => alongV ? gv + side * t : gv;
    const place = (color, t, y, high, thin, long) => kit.box(color, g, X(S(t)), y, z(V(t)), alongV ? thin : long, high, alongV ? long : thin);
    for (const [y, th] of [[gy + .12, .1], [gy + h - .12, .1]]) place(WHITE, width / 2, y, th, .1, width);
    for (let k = 0; k <= Math.round(width / .22); k++) place(WHITE, k * .22, gy + h / 2, h, alongV ? .07 : .05, alongV ? .05 : .07);
    for (const end of [0, width]) place(GREY, end, gy + h / 2 + .18, h + .36, .14, .14);
    place(DARK, width / 2, gy + .02, .04, .14, width + .6);   // trilho no piso
    const ring = alongV ? [[gs - .12, gv], [gs + .12, gv], [gs + .12, gv + side * width], [gs - .12, gv + side * width]]
      : [[gs, gv - .12], [gs + side * width, gv - .12], [gs + side * width, gv + .12], [gs, gv + .12]];
    solids.push({ rings: [ring.map(([a, b]) => P.at(a, b))], top: gy + h, kind: 'portao-portaria' });
  }
  // ---- cones laranja separando os sentidos sob a cobertura
  for (const line of P.cones || []) along(line, P.passoCones ?? 2.4, (cs, cv) => {
    const b = at3(cs, cv, 0), y = b[1];
    kit.box(DARK, { ...f, x: b[0], z: b[2], y }, 0, .02, 0, .44, .04, .44);
    kit.cylinder('#e4601f', { ...f, x: b[0], z: b[2], y }, 0, .36, 0, .17, .64, 'y', 8, .05);
    kit.cylinder(WHITE, { ...f, x: b[0], z: b[2], y }, 0, .44, 0, .125, .12, 'y', 8, .108);
  });
  // ---- balizadores flexíveis vermelhos e brancos ao longo da divisória
  for (const line of P.balizadores || []) along(line, P.passoBalizadores ?? 1.6, (bs, bv) => {
    const b = at3(bs, bv, 0), fr = { ...f, x: b[0], z: b[2], y: b[1] };
    kit.cylinder(DARK, fr, 0, .03, 0, .16, .06, 'y', 8);
    for (let k = 0; k < 4; k++) kit.cylinder(k % 2 ? WHITE : '#cf2027', fr, 0, .12 + k * .18, 0, .055, .18, 'y', 8);
    kit.cylinder('#d9d9d2', fr, 0, .83, 0, .06, .1, 'y', 8);
  });
  // ---- pintura de solo das pistas: texto ("REDUZA", "PARE") e setas de sentido.
  // O texto fica EM PÉ para quem dirige: lê-se da esquerda para a direita atravessando a faixa, com
  // o topo das letras apontando para onde o carro vai — e esticado no sentido da marcha (`alto`),
  // como a legenda pintada de verdade. `sentido` = +1 entrando no campus, -1 saindo.
  for (const [ts, tv, text, alto, larg, sentido = 1] of P.textoPista || []) {
    const uv = ROAD_TEXT[text];
    if (!uv) continue;
    const d = Math.sign(sentido) || 1, corner = (du, dv) => at3(ts + d * du, tv + d * dv, DECK + .05);
    kit.signCorners('pista-texto', paintRoadText, [corner(-larg / 2, -alto / 2), corner(larg / 2, -alto / 2), corner(larg / 2, alto / 2), corner(-larg / 2, alto / 2)], { size: [512, 256], lit: true, uv });
  }
  // setas de sentido (finas, como as do local): polígono no piso `paint`, que já é uma malha dos
  // pisos — sem textura própria
  for (const [as, av, dir, len = 5.2, wide = 1.1] of P.setas || []) {
    const [ds, dv] = dir, n = Math.hypot(ds, dv) || 1, u = [ds / n, dv / n], q = [-u[1], u[0]];
    const node4 = (du, dq) => at3(as + u[0] * du + q[0] * dq, av + u[1] * du + q[1] * dq, DECK + .05);
    kit.quad(PAINT, node4(-len / 2, -wide * .16), node4(len * .12, -wide * .16), node4(len * .12, wide * .16), node4(-len / 2, wide * .16), [0, 1, 0]);
    kit.tri(PAINT, node4(len / 2, 0), node4(len * .12, -wide / 2), node4(len * .12, wide / 2), [0, 1, 0]);
  }
  // ---- linha branca contínua dividindo as faixas da boca
  for (const [ds, v0, v1] of P.divisorias || []) {
    const steps = Math.max(1, Math.round(Math.abs(v1 - v0) / 2));
    for (let k = 0; k < steps; k++) {
      const a = v0 + (v1 - v0) * k / steps, b = v0 + (v1 - v0) * (k + 1) / steps;
      kit.quad(PAINT, at3(ds - .075, a, DECK + .05), at3(ds + .075, a, DECK + .05), at3(ds + .075, b, DECK + .05), at3(ds - .075, b, DECK + .05), [0, 1, 0]);
    }
  }
  // ---- gradil tubular da passagem de pedestres (guarda-corpo pintado de branco)
  for (const line of P.gradil || []) {
    const h = P.alturaGradil ?? 1.05, posts = [];
    along(line, 1.8, (gs, gv) => posts.push(at3(gs, gv, 0)));
    const ends = [at3(...line[0], 0), at3(...line.at(-1), 0)], all = [ends[0], ...posts, ends[1]];
    for (const q of all) kit.cylinder(WHITE, { ...f, x: q[0], z: q[2], y: q[1] }, 0, h / 2, 0, .035, h, 'y', 6);
    for (let i = 1; i < all.length; i++) for (const lift of [h - .05, h * .55]) kit.rail(WHITE, [all[i - 1][0], all[i - 1][1] + lift, all[i - 1][2]], [all[i][0], all[i][1] + lift, all[i][2]], .028);
  }
  // ---- totem vermelho da marca na frente da portaria, visto de longe na rua
  if (P.totem) {
    // `giro` (graus, + para o lado de quem chega pela rua) vira o painel de frente para a rua
    const [ms, mv, mh = 9.5, mw = 3.4, giro = 0] = P.totem, [mx, mz] = P.at(ms, mv), gy = ground(mx, mz);
    const mt = 2.4, fr = frameAt(mx, mz, f.yaw + giro * Math.PI / 180 * P.inward, gy);
    kit.box(GREY, fr, 0, (mh - mt) / 2, 0, .5, mh - mt, .5);
    kit.box(RED, fr, 0, mh - mt / 2, 0, mw, mt, .42);
    for (const face of [-1, 1]) kit.sign('totem-marca', paintTotem, fr, 0, mh - mt / 2, face * .23, mw - .24, mt - .24, { reverse: face * P.inward > 0, size: [320, 320] });
    solids.push({ rings: [[P.at(ms - .4, mv - .4), P.at(ms + .4, mv - .4), P.at(ms + .4, mv + .4), P.at(ms - .4, mv + .4)]], top: gy + mh, kind: 'totem-portaria' });
    exclusions.push({ kind: 'totem-portaria', rings: [[P.at(ms - 2.6, mv - 2.6), P.at(ms + 2.6, mv - 2.6), P.at(ms + 2.6, mv + 2.6), P.at(ms - 2.6, mv + 2.6)]] });
  }
  // ---- cerca branca de barras com sebe, ao longo do passeio dos dois lados da boca
  for (const line of P.cerca || []) {
    const h = 1.5, posts = [];
    along(line, 2.4, (cs, cv) => posts.push([cs, cv]));
    const pts = [line[0], ...posts, line.at(-1)];
    for (const [cs, cv] of pts) { const q = at3(cs, cv, 0); kit.box(WHITE, { ...f, x: q[0], z: q[2], y: q[1] }, 0, h / 2, 0, .12, h, .12); }
    for (let i = 1; i < pts.length; i++) {
      const a = at3(...pts[i - 1], 0), b = at3(...pts[i], 0), len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < .05) continue;
      for (const lift of [h - .1, .25]) kit.rail(WHITE, [a[0], a[1] + lift, a[2]], [b[0], b[1] + lift, b[2]], .035);
      for (let k = 1; k * .16 < len; k++) { const t = k * .16 / len, x = a[0] + (b[0] - a[0]) * t, zz = a[2] + (b[2] - a[2]) * t, yy = a[1] + (b[1] - a[1]) * t; kit.box(WHITE, { ...f, x, z: zz, y: yy }, 0, h / 2, 0, .035, h - .1, .035); }
      solids.push({ rings: [[[a[0], a[2]], [b[0], b[2]], [b[0] + .12, b[2] + .12], [a[0] + .12, a[2] + .12]]], top: Math.max(a[1], b[1]) + h, kind: 'cerca-portaria' });
    }
    // sebe baixa rente à cerca, do lado do campus
    along(line, 1.1, (cs, cv, dir) => { const q = at3(cs + dir[1] * .75, cv - dir[0] * .75, 0); kit.sphere(HEDGE, { ...f, x: q[0], z: q[2], y: q[1] }, 0, .5, 0, .62, .7); });
  }
  // ---- vigilante de plantão, de braços cruzados, na divisória entre as duas faixas de entrada.
  // Mesmas proporções dos personagens do jogo (1,75 m), em peças lisas: uniforme escuro, boné e os
  // antebraços cruzados no peito.
  for (const [gs, gv, giro = 0] of P.seguranca || []) {
    const [gx, gz] = P.at(gs, gv), gy = ground(gx, gz);
    // de frente para a rua (contra quem entra), mais o giro informado
    const fr = frameAt(gx, gz, Math.atan2(-P.inVec[0], -P.inVec[1]) + giro * Math.PI / 180, gy);
    const SKIN = '#c08a5e', UNIF = '#232833', CALCA = '#1b1f27', BOTA = '#101216', CINTO = '#0e1014';
    for (const side of [-1, 1]) {
      kit.box(BOTA, fr, side * .11, .05, .04, .13, .1, .27);                                  // coturnos
      kit.cylinder(CALCA, fr, side * .11, .49, 0, .095, .78, 'y', 7);                          // pernas
      kit.cylinder(UNIF, fr, side * .235, 1.16, 0, .075, .34, 'y', 7);                         // braços, do ombro ao cotovelo
      // antebraços cruzados no peito: cada um sai do próprio cotovelo e cruza para o outro lado
      kit.tube(UNIF, fr, [side * .235, 1.0, .02], [-side * .12, 1.11, .2], .068, 7);
      kit.sphere(SKIN, fr, -side * .15, 1.12, .21, .06);                                       // mãos
    }
    kit.box(CALCA, fr, 0, .86, 0, .34, .14, .24);                                              // quadril
    kit.box(CINTO, fr, 0, .95, 0, .36, .07, .26);                                              // cinto
    kit.box(UNIF, fr, 0, 1.19, 0, .42, .42, .25);                                              // tronco
    kit.box('#39404f', fr, 0, 1.3, .13, .2, .2, .02);                                          // emblema no peito
    kit.cylinder(SKIN, fr, 0, 1.45, 0, .065, .1, 'y', 7);                                      // pescoço
    kit.sphere(SKIN, fr, 0, 1.62, .01, .115, 1.12);                                            // cabeça
    kit.sphere(UNIF, fr, 0, 1.64, 0, .122, .78);                                               // copa do boné
    kit.box(UNIF, fr, 0, 1.655, .13, .21, .03, .11);                                           // aba do boné
    solids.push({ rings: [[P.at(gs - .3, gv - .3), P.at(gs + .3, gv - .3), P.at(gs + .3, gv + .3), P.at(gs - .3, gv + .3)]], top: gy + 1.78, kind: 'vigilante-portaria' });
  }
  // ---- muro de arrimo da encosta ao lado da boca (o terreno sobe do lado de fora do platô)
  for (const { linha, altura = 2 } of P.arrimo || []) {
    for (let i = 1; i < linha.length; i++) {
      const a = P.at(...linha[i - 1]), b = P.at(...linha[i]), ga = ground(...a), gb = ground(...b);
      kit.wall(WHITE, a, b, .36, ga - 1.2, ga + altura, gb - 1.2, gb + altura);
      kit.rail('#b7bbbe', [a[0], ga + altura + .5, a[1]], [b[0], gb + altura + .5, b[1]], .035);
      for (const [p, g] of [[a, ga], [b, gb]]) kit.cylinder('#b7bbbe', { ...f, x: p[0], z: p[1], y: g + altura }, 0, .26, 0, .035, .52, 'y', 6);
      solids.push({ rings: [[a, b, [b[0] + .3, b[1] + .3], [a[0] + .3, a[1] + .3]]], top: Math.max(ga, gb) + altura, kind: 'arrimo-portaria' });
    }
  }
  // ---- palmeiras do canteiro ao lado da recepção (cada uma com a cova aberta na área da portaria,
  // senão o próprio recorte sem vegetação as apagaria)
  for (const [ps, pv, height = 10] of P.palmeiras || []) {
    const [px, pz] = P.at(ps, pv);
    palms.push({ x: px, z: pz, h: height, r: Math.abs(ps * 7 + pv) % 6 });
    holes.push([[ps - 1, pv - 1], [ps + 1, pv - 1], [ps + 1, pv + 1], [ps - 1, pv + 1]].map(([a, b]) => P.at(a, b)));
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
  return { solids, surfaces, exclusions, trees, palms, top, level: y0 };
}
