import { frameAt, toWorld } from './landmark-kit.js';
import { yawFromBearing } from './locomotive.js';
import { alongOf, distTo, reach } from './portaria.js';

// Portaria de pedestres da Bussocaba (06), na Rua Aurora Soares Barbosa: muro de concreto com um
// portal branco e portão cinza; logo atrás, uma cobertura branca alta (~11 x 5,4 m) sobre pilares
// finos, fechada com vidro, com um pórtico vermelho na ponta oeste.
// Percurso descrito pelo usuário: entra-se pelo portal, vira-se à direita e sobe-se uma escada de
// ponta a ponta; no topo ficam as catracas; em frente a elas, a guarita do guarda; passando as
// catracas, vira-se à esquerda e entra-se no campus (faixa de pedestres).
// O estacionamento fica ~1 m acima da calçada da rua (altitudes do Google Earth).
// Medidas: vista de topo do Earth com a grade do jogo; fachada: Street View (jun/2023).
// `s` = metros ao longo do muro a partir da ponta oeste da cobertura; `v` = metros para DENTRO.

const WHITE = '#f4f3ef', RED = '#c8102e', DARK = '#2a2f35', STEEL = '#565b61', ROOF = '#e6e4dd', SOFFIT = '#cfcdc6', STEP = '#a7a399', EDGE = '#d8b13a';
const PAVING = 'pavement', PAINT = 'paint';
/** altura da pista e da calçada das vias internas acima do relevo (roads.js); espelho dos degraus */
const ROAD = .24, WALK = .41, JOIN = WALK + .016, RISER = .17, FRONT = .1;   // FRONT: a cobertura começa rente ao muro

export function planPedestrianGate(mark, inside) {
  const frame = frameAt(mark.x, mark.z, yawFromBearing(mark.heading));
  const inward = inside(...toWorld(frame, 0, 30)) ? 1 : -1;
  const at = (s, v) => toWorld(frame, s, v * inward), [ox, oz] = at(0, 0), [ix, iz] = at(0, 1), [ax, az] = at(1, 0);
  return { ...mark, frame, inward, at, inVec: [ix - ox, iz - oz], axis: [ax - ox, az - oz] };
}

const lineAt = (line, s) => { if (s <= line[0][0]) return line[0][1]; for (let i = 1; i < line.length; i++) if (s <= line[i][0]) return line[i - 1][1] + (line[i][1] - line[i - 1][1]) * (s - line[i - 1][0]) / ((line[i][0] - line[i - 1][0]) || 1); return line.at(-1)[1]; };

/** Liga a portaria ao muro (vão no portal), às catracas (no topo da escada) e à via interna de trás (faixa, guia rebaixada). */
export function fitPedestrianGate(G, world, C) {
  const [L, D] = G.cobertura;
  G.fundo = FRONT + D;
  // via interna mais próxima atrás da cobertura
  const roads = world.roads.filter((r) => r.highway === 'service' && r.kind !== 'foot' && !r.bridge && !r.hidden);   // (r.internal ainda não foi marcado nesta fase)
  const road = roads.map((r) => ({ r, d: distTo(G, r, L / 2, D + 4) })).sort((a, b) => a.d - b.d)[0];
  if (road && road.d <= 30) {
    const hw = road.r.w / 2, far = D + 40;
    G.road = road.r;
    // borda de fora da calçada dessa via (onde o piso da portaria emenda) e o meio-fio de cá, por s
    const table = (limit) => { const out = []; for (let s = G.piso[0] - 1; s <= G.piso[1] + 1 + 1e-6; s += .5) { const v = reach(G, road.r, s, .5, far, limit); if (v !== null) out.push([s, v]); } return out; };
    G.calcada = table(hw + 2.3); G.meioFio = table(hw);
    // a calçada dessa via (que no jogo passa mais perto do muro que no local) é recortada na planta da portaria,
    // sem nunca entrar no leito: os fundos param 50 cm antes do meio-fio mais próximo
    if (G.meioFio.length > 1) G.fundo = Math.min(G.fundo, Math.min(...G.meioFio.filter(([s]) => s >= G.piso[0] && s <= G.piso[1]).map((p) => p[1])) - .5);
    (world.sidewalkVoids ||= []).push([G.at(G.piso[0] - .12, -1), G.at(G.piso[1] + .25, -1), G.at(G.piso[1] + .25, G.fundo + .1), G.at(G.piso[0] - .12, G.fundo + .1)]);
    if (G.saida) {
      // faixa de pedestres até o meio-fio do outro lado: guia rebaixada nas duas calçadas (roads.js)
      const sm = (G.saida[0] + G.saida[1]) / 2, near = reach(G, road.r, sm, .5, far, hw);
      if (near !== null) {
        let v = near; while (v < far && distTo(G, road.r, sm, v + .1) <= hw) v += .1;
        G.travessia = [near, v];
        const along = alongOf(road.r, ...G.at(sm, (near + v) / 2));
        if (!road.r.sidewalkCrossings?.some((d) => Math.abs(d - along) < 3)) road.r.sidewalkCrossings = [...(road.r.sidewalkCrossings || []), along - 1.2, along + 1.2];
      }
    }
  }
  // catracas no topo da escada, de frente para quem sobe (amenities.js põe o par 1,1 m adiante)
  const gate = (C.gates || []).find((g) => g.num === G.gate && g.type === 'pedestre');
  if (gate) { const [x, z] = G.at(G.catracas + 1.1, (FRONT + G.fundo) / 2); gate.center = { x, z, tx: -G.axis[0], tz: -G.axis[1] }; gate.built = true; gate.turnstiles = G.quantidade ?? 2; }
  return G;
}

/** Níveis (rua embaixo, estacionamento em cima) e os pontos onde o relevo é rebaixado: calçada da rua e saguão. */
export function gradePedestrianGate(G, terrain, { roadLevel, protect }) {
  const [x, z] = G.at(1.5, G.fundo + 1.2), up = (roadLevel?.(G.road, x, z) ?? terrain.heightAt(x, z)) + JOIN, low = up - G.espelhos * RISER, samples = [];
  G.levels = { up, low };
  for (let s = G.escada[1]; s <= G.piso[1] + 1e-6; s += 1.2) for (let v = 0; v <= G.fundo; v += 1.2) samples.push([...G.at(s, v), low - .05]);
  terrain.gradeProfile(samples, { radius: 2.4, band: 6, clearance: .12, minClearance: .06, protect });
  // a calçada da rua é o próprio relevo pintado: fica rente à soleira do portal (3 cm abaixo)
  const street = [];
  for (let s = G.rua[0]; s <= G.rua[1] + 1e-6; s += 1.5) for (let v = -G.rua[2]; v <= -.4; v += 1.2) street.push([...G.at(s, v), low]);
  return terrain.gradeProfile(street, { radius: 2.4, band: 6, clearance: .03, minClearance: 0, protect });
}

/** `surfaceAt(x, z, maxY)`: altura real das vias internas e calçadas já construídas (roads.js), se houver */
export function buildPedestrianGate(kit, G, { ground, surfaceAt }) {
  const solids = [], surfaces = [], exclusions = [], [L] = G.cobertura, [p0, p1] = G.portal, [s0, s1] = G.piso, [foot, head] = G.escada, B = G.fundo, D = B - FRONT;
  const g0 = ground(G.frame.x, G.frame.z), up = G.levels?.up ?? g0 + JOIN, low = G.levels?.low ?? up - G.espelhos * RISER, under = low + 3.75, top = low + 4.85;
  const f = { ...G.frame, y: 0 }, z = (v) => v * G.inward, mid = (FRONT + B) / 2;
  const solid = (a, v0, b, v1, height, kind) => solids.push({ rings: [[G.at(a, v0), G.at(b, v0), G.at(b, v1), G.at(a, v1)]], top: height, kind });
  const P = (s, v, y) => { const [x, zz] = G.at(s, v); return [x, y, zz]; };
  /** piso plano no nível `y`, em placas de até 2 m (pisável) */
  const slab = (color, a, b, v0, v1, y, yAt = null) => {
    const n = Math.max(1, Math.ceil((b - a) / 2)), m = Math.max(1, Math.ceil((v1 - v0) / 2));
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([u, w]) => { const s = a + (b - a) * u / n, v = v0 + (v1 - v0) * w / m; return P(s, v, yAt ? yAt(s, v) : y); });
      kit.quad(color, ...q, [0, 1, 0]); surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: Math.max(...q.map((p) => p[1])) });
    }
  };
  /** parede reta de (s, v) a (s', v') da cota y0 à y1 */
  const wall = (color, a, b, y0, y1, thick = .16) => kit.wall(color, G.at(...a), G.at(...b), thick, y0, y1, y0, y1);

  // ---- soleira do portal (a calçada da rua em frente é o relevo, rebaixado ao nível de baixo)
  slab(PAVING, p0, p1, -.45, FRONT, low);
  // ---- saguão de baixo, escada de ponta a ponta subindo para a direita de quem entra, patamar de cima
  slab(PAVING, foot, s1, FRONT, B, low);
  const treads = G.espelhos - 1, run = (foot - head) / treads;
  for (let k = 1; k <= treads; k++) {
    const a = foot - run * k, b = foot - run * (k - 1), y = low + RISER * k;
    kit.box(STEP, f, (a + b) / 2, y - RISER / 2, z(mid), b - a, RISER, D); kit.box(EDGE, f, b - .04, y + .003, z(mid), .08, .006, D);
    surfaces.push({ rings: [[G.at(a, FRONT), G.at(b, FRONT), G.at(b, B), G.at(a, B)]], y });
  }
  kit.box(STEP, f, head - .02, (low + up) / 2, z(mid), .04, up - low, D);   // espelho do último degrau
  slab(PAVING, s0, head, FRONT, B, up);
  for (const v of [FRONT + .12, B - .12]) { kit.tube(STEEL, f, [foot + .2, low + .95, z(v)], [head - .1, up + .95, z(v)], .03, 6); for (const [s, y] of [[foot + .2, low], [head - .1, up]]) kit.tube(STEEL, f, [s, y, z(v)], [s, y + .95, z(v)], .03, 6); }   // corrimãos
  // ---- fechamentos: fundos (muro de arrimo + vidro; só a saída fica aberta), lado leste e lado oeste
  const [e0, e1] = G.saida, base = (a) => Math.min(low, ground(...G.at(a, B))) - .2;
  for (const [a, b] of [[e1, L - .1], [s0, e0]]) {
    wall(WHITE, [a, B], [b, B], base(a), up + .55, .2);
    if (a >= 0) kit.box('glass-clear', f, (a + b) / 2, (up + .55 + under) / 2, z(B), b - a - .1, under - up - .55, .06);
    solid(a, B - .12, b, B + .12, a >= 0 ? under : up + .55, 'fundos-portaria-pedestres');
  }
  wall(WHITE, [L - .1, FRONT], [L - .1, B], base(L - .1), up + .55, .2); kit.box('glass-clear', f, L - .1, (up + .55 + under) / 2, z(mid), .06, under - up - .55, D - .1); solid(L - .22, FRONT, L + .02, B, under, 'vidro-portaria-pedestres');
  wall(WHITE, [L - .1, FRONT], [s1, FRONT], base(L), low + 1.1, .16);
  wall(WHITE, [s0, FRONT], [s0, B], Math.min(up, ground(...G.at(s0, mid))) - .2, up + 1.1, .16); solid(s0 - .1, FRONT, s0 + .1, B, up + 1.1, 'mureta-portaria-pedestres');
  // grades ao lado das catracas (passa-se só por elas)
  { const s = G.catracas, n = G.quantidade ?? 2, pitch = n > 2 ? 1.5 : 1.7, lanes = [mid - pitch * (n - 1) / 2, mid + pitch * (n - 1) / 2];
    for (const [a, b] of [[FRONT, lanes[0] - .62], [lanes[1] + .62, B]]) { if (b - a < .15) continue; for (const y of [.55, 1.05]) kit.tube(STEEL, f, [s, up + y, z(a)], [s, up + y, z(b)], .03, 6); solid(s - .08, a, s + .08, b, up + 1.05, 'grade-catracas'); } }
  // ---- cobertura branca alta sobre pilares finos, com forro; faixa de vidro acima do muro do lado da rua
  kit.box(ROOF, f, L / 2, (under + top) / 2, z(FRONT + G.cobertura[1] / 2), L, top - under, G.cobertura[1]); kit.box(SOFFIT, f, L / 2, under - .03, z(FRONT + G.cobertura[1] / 2), L - .2, .06, G.cobertura[1] - .2);
  for (const s of [.2, L / 2, L - .2]) for (const v of [FRONT + .2, B - .2]) { const y = Math.min(low, ground(...G.at(s, v))) - .2; kit.box(WHITE, f, s, (y + under) / 2, z(v), .22, under - y, .22); solid(s - .15, v - .15, s + .15, v + .15, under, 'pilar-portaria-pedestres'); }
  // (o vidro do lado da rua fica no mesmo plano do muro, completando-o até a cobertura)
  kit.box('glass-clear', f, L / 2, (low + 2.3 + under) / 2, 0, L, under - low - 2.3, .06);
  // ---- pórtico vermelho na ponta oeste: viga por cima da cobertura e duas pernas (a de dentro fica na calçada)
  { const s = -.55, v0 = .1, v1 = Math.min(FRONT + G.cobertura[1] + 1.9, (G.meioFio?.length ? lineAt(G.meioFio, s) : Infinity) - .5);
    kit.box(RED, f, s, top + .1, z((v0 + v1) / 2), .9, 1.0, v1 - v0);
    for (const v of [v0 + .3, v1 - .3]) { const y = ground(...G.at(s, v)) - .2; kit.box(RED, f, s, (y + top + .1) / 2, z(v), .7, top + .1 - y, .6); solid(s - .4, v - .35, s + .4, v + .35, top, 'portico-portaria-pedestres'); } }
  // ---- guarita do guarda no patamar de cima, em frente às catracas (branca, janelas em faixa, laje escura)
  if (G.guarita) {
    const [a, b, half] = G.guarita, h = 2.6;
    kit.box(WHITE, f, (a + b) / 2, up + h / 2, z(mid), b - a, h, half * 2); kit.box('glass', f, (a + b) / 2, up + 1.6, z(mid), b - a + .06, .9, half * 2 - .6); kit.box('glass', f, (a + b) / 2, up + 1.6, z(mid), b - a - .6, .9, half * 2 + .06);
    kit.box(DARK, f, (a + b) / 2, up + h + .08, z(mid), b - a + .3, .16, half * 2 + .3); kit.box(DARK, f, b + .03, up + 1.0, z(mid + half - .6), .06, 2.0, .8);
    solid(a, mid - half, b, mid + half, up + h + .2, 'guarita-pedestres');
  }
  // ---- portal branco no muro (dois pilares e verga) e o portão de correr cinza, aberto, encostado do lado de dentro
  { const wide = .6, deep = .55, h = low + 3.0, y = Math.min(low, ground(...G.at(p0, 0))) - .3;
    for (const s of [p0 - wide / 2, p1 + wide / 2]) { kit.box(WHITE, f, s, (y + h) / 2, 0, wide, h - y, deep); solid(s - wide / 2, -deep / 2, s + wide / 2, deep / 2, h, 'portal-pedestres'); }
    kit.box(WHITE, f, (p0 + p1) / 2, h - .2, 0, p1 - p0 + wide * 2, .4, deep);
    const leaf = Math.min(p1 - p0 + .2, s1 - p1 - wide - .3);
    if (leaf > .8) { kit.box(STEEL, f, p1 + wide + .1 + leaf / 2, low + 1.25, z(deep / 2 + .12), leaf, 2.4, .07); for (let k = 0; k < 5; k++) kit.box(DARK, f, p1 + wide + .25 + k * (leaf - .3) / 4, low + 1.25, z(deep / 2 + .16), .05, 2.4, .03); } }
  // ---- saída: do patamar até a calçada da via e a faixa de pedestres até o meio-fio do outro lado
  slab(PAVING, e0, e1, B, Math.max(B + .45, (G.calcada?.length > 1 ? lineAt(G.calcada, (e0 + e1) / 2) : B) + .25), up);   // (soleira por cima da ponta da calçada recortada)
  if (G.travessia) {
    const [v0, v1] = G.travessia;
    const onRoad = (extra) => (s, v) => { const [x, zz] = G.at(s, v), g = ground(x, zz) + ROAD, r = surfaceAt?.(x, zz, up + .2); return [x, (Number.isFinite(r) && r > g ? r : g) + extra, zz]; };
    const band = (color, va, vb, at) => { const n = Math.max(1, Math.ceil((e1 - e0) / 1.2)); for (let i = 0; i < n; i++) { const sa = e0 + (e1 - e0) * i / n, sb = e0 + (e1 - e0) * (i + 1) / n; kit.quad(color, at(sa, va), at(sb, va), at(sb, vb), at(sa, vb), [0, 1, 0]); } };
    for (let v = v0 + .3; v + .45 <= v1 - .15; v += .9) band(PAINT, v, v + .45, onRoad(.04));   // faixa branca comum (no Earth parece azul por causa da sombra)
  }
  exclusions.push({ kind: 'portaria-pedestres', rings: [[G.at(G.rua[0], -G.rua[2] - .5), G.at(G.rua[1], -G.rua[2] - .5), G.at(G.rua[1], B + 2.5), G.at(G.rua[0], B + 2.5)]] });
  return { solids, surfaces, exclusions, top, levels: { up, low } };
}
