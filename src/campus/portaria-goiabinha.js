import { pointInPolygon, distToSegment } from '../shared/geo.js';
import { planPedestrianGate } from './portaria-pedestres.js';
import { reach } from './portaria.js';

// Portaria de pedestres Goiabinha (07), na Av. Martin Luther King: entrada simples no muro da rua.
// Na calçada, um portal branco revestido em placas (porta de 1,5 m, placa com o nome e uma arandela
// preta) sob uma testeira branca comprida apoiada no muro. Dentro: a guarita do vigilante na ponta
// oeste (fundo vermelho) e, logo depois da porta, duas catracas de cartão de frente para a rampa.
// Percurso descrito pelo usuário: passadas as catracas, uma rampa ao longo do muro DESCE para o
// leste (para o lado em que a avenida sobe) até a calçada da via interna; entre a rampa e o muro
// fica o canteiro alto da cerca viva, no nível da rua (vista de topo do Google Earth).
// Fachada e testeira: Street View; sentido da rampa: Earth (o canto arredondado do estacionamento
// fica a oeste da guarita) e o relato do usuário.
// `s` = metros ao longo do muro a partir do eixo da porta (leste +); `v` = metros para DENTRO.

const WALL = '#d4d1ca', WHITE = '#f4f3ef', JOINT = '#cfccc4', SOFFIT = '#d9d7d0', RED = '#c8102e', DARK = '#2a2f35', RAIL = '#e4e4df', HEDGE = '#3f7d3a', HEDGE_DARK = '#33682f', SOIL = '#5b4a39', CURB = '#cfc9bc', CONCRETE = '#c9c4b8', LAMP = '#1d1f22';
const PAVING = 'pavement';
/** calçada das vias internas acima do eixo (roads.js); calçada refeita da avenida acima do relevo do meio-fio;
 * largura da calçada da rua usada para o muro (computeWalls) e das calçadas internas (roads.js) */
const WALK = .41, KERB = .2, SIDEWALK = 2.2, INNER_WALK = 2.5;
/** altura livre sob a testeira e altura da testeira, a partir do piso da portaria (Street View) */
const UNDER = 2.5, FASCIA = 1.15;
/** v do meio do par de catracas (a de dentro fica na faixa da rampa) */
const PAR = 1.9;

const lineAt = (line, s) => { if (s <= line[0][0]) return line[0][1]; for (let i = 1; i < line.length; i++) if (s <= line[i][0]) return line[i - 1][1] + (line[i][1] - line[i - 1][1]) * (s - line[i - 1][0]) / ((line[i][0] - line[i - 1][0]) || 1); return line.at(-1)[1]; };
const nearestRoad = (roads, x, z) => {
  let best = null;
  for (const road of roads) for (let i = 1; i < road.pts.length; i++) { const q = distToSegment(x, z, ...road.pts[i - 1], ...road.pts[i]); if (!best || q.d < best.d) best = { road, d: q.d, x: q.cx, z: q.cz }; }
  return best;
};

/**
 * Antes do muro e da terraplenagem: ancora o portal na borda da calçada da avenida e declara
 * `C.wallFills` e `C.wallLevel` (o muro vai até a calçada, com a base nela), o platô tardio que
 * rebaixa a via interna junto à rampa, o recorte da calçada interna e as catracas da portaria.
 */
export function prepareGoiabinha(mark, world, C) {
  const inside = (x, z) => pointInPolygon(x, z, C.quarter);
  let G = planPedestrianGate(mark, inside);
  if (!world) return G;
  const avenue = nearestRoad(world.roads.filter((r) => r.kind !== 'foot' && !r.bridge && r.highway !== 'service'), G.x, G.z);
  if (!avenue || avenue.d > 20) return G;
  // o portal fica na borda de fora da calçada da avenida, onde o muro passa (computeWalls)
  const k = (avenue.road.w / 2 + SIDEWALK) / avenue.d;
  G = planPedestrianGate({ ...mark, x: avenue.x + (G.x - avenue.x) * k, z: avenue.z + (G.z - avenue.z) * k }, inside);
  const c = Math.cos(G.frame.yaw), sn = Math.sin(G.frame.yaw);
  G.local = (x, z) => { const dx = x - G.frame.x, dz = z - G.frame.z; return [dx * c - dz * sn, (dx * sn + dz * c) * G.inward]; };
  const street = G.avenida = avenue.road, hw = street.w / 2;
  const [r0, r1] = G.rua, table = (road, limit, from, to) => { const out = []; for (let s = r0; s <= r1 + 1e-6; s += .5) { const v = reach(G, road, s, from, to, limit); if (v !== null) out.push([s, v]); } return out; };
  G.guia = table(street, hw, 14, -40); G.borda = table(street, hw + SIDEWALK, 14, -40);
  // meio-fio do outro lado (o recapeamento junto ao meio-fio de cá é medido na largura da avenida)
  G.guiaFora = G.guia.map(([s, v]) => [s, reach(G, street, s, v - 2 * hw - 8, v, hw) ?? v - 2 * hw]);
  // via interna junto ao muro (r.internal ainda não foi marcado nesta fase) e a borda da calçada dela do lado do muro
  const inner = nearestRoad(world.roads.filter((r) => r.highway === 'service' && r.kind !== 'foot' && !r.bridge && inside(...r.pts[Math.floor(r.pts.length / 2)])), ...G.at(0, 8));
  if (!inner || G.guia.length < 2 || G.borda.length < 2) return G;
  G.interna = inner.road;
  G.calcada = table(inner.road, inner.road.w / 2 + INNER_WALK, -2, 30);
  const old = (s) => (reach(G, inner.road, s, -2, 30, inner.road.w / 2 + 1) ?? 6) - .3;   // muro do jogo: borda do traçado da via interna

  // muro na borda da calçada de m0 a m1; diagonais de volta ao muro do jogo até m0 - 6 e m2
  const [m0, m1, m2] = G.muro;
  G.muroLinha = [[m0 - 6, old(m0 - 6)]];
  for (let s = m0; s <= m1 + 1e-6; s += .5) G.muroLinha.push([s, lineAt(G.borda, s)]);
  G.muroLinha.push([m2, old(m2)]);
  (C.wallFills ||= []).push([...G.muroLinha.map(([s, v], i, all) => G.at(s, i && i < all.length - 1 ? v - .6 : v)), G.at(m2, 12), G.at(m0 - 6, 12)]);
  // a calçada da via interna não entra na planta da portaria
  const [c0, c1, depth] = G.cobertura;
  (world.sidewalkVoids ||= []).push([G.at(c0 - .15, -1), G.at(c1 + .15, -1), G.at(c1 + .15, depth + .15), G.at(c0 - .15, depth + .15)]);

  // a via interna junto ao pé da rampa fica no nível do patamar (o resto dela acompanha, até 12%);
  // platô tardio: aplicado depois da terraplenagem, com a avenida já no nível de sempre (grading.js)
  const [i0, i1] = G.interno;
  (C.plateaus ||= []).push({ id: 'portaria-goiabinha', name: G.name, late: true, reach: 70, rings: [[G.at(i0, 5), G.at(i1, 5), G.at(i1, 18), G.at(i0, 18)]], level: (terrain) => levelsOf(G, terrain).low - WALK });
  // catracas logo depois da porta, viradas para a rampa (quem passa segue para o leste);
  // `catracas` = s da linha delas, o par fica a `v` = PAR (amenities.js põe o par 1,1 m adiante)
  const gate = (C.gates || []).find((g) => g.num === G.gate && g.type === 'pedestre');
  if (gate) {
    const [x, z] = G.at(G.catracas - 1.1, PAR);
    Object.assign(gate, { center: { x, z, tx: G.axis[0], tz: G.axis[1] }, built: true, turnstiles: 2, floorLevel: () => G.levels?.floor });
  }
  // (no trecho rebaixado, o muro sai da calçada da avenida com ~2,4 m, abaixo da testeira, como no Street View)
  C.wallLevel = (x, z) => {
    const [s, v] = G.local(x, z);
    return G.levels && s >= m0 && s <= m1 && Math.abs(v - lineAt(G.borda, s)) < 1 ? lineAt(G.levels.rua, s) - .3 : undefined;
  };
  return G;
}

/**
 * Níveis medidos no relevo já terraplenado, antes do rebaixamento: calçada da avenida, piso da
 * portaria, pé da rampa e o leito da avenida em frente (meio-fio de cá, meio e meio-fio de lá).
 */
function levelsOf(G, terrain) {
  if (G.levels) return G.levels;
  const rua = G.guia.map(([s, v]) => [s, terrain.heightAt(...G.at(s, v)) + KERB]), floor = lineAt(rua, 0);
  const leito = G.guia.map(([s, v], i) => { const far = G.guiaFora[i][1]; return [s, [v, (v + far) / 2, far].map((w) => terrain.heightAt(...G.at(s, w)))]; });
  return (G.levels = { rua, leito, floor, low: floor - G.queda });
}

/** Rampa: [s do topo, s do pé, v do lado do canteiro, v do lado de dentro]; nível do piso em (s, v). */
const rampLevel = (G, s) => { const [a, b] = G.rampa, t = Math.max(0, Math.min(1, (s - a) / (b - a))); return G.levels.floor + (G.levels.low - G.levels.floor) * t; };

/**
 * Relevo: abaixo de tudo o que é piso por dentro (portaria, rampa, patamar) e das vias internas
 * rebaixadas pelo platô (leito e calçadas). A meia pista de lá da avenida e o que fica além dela não
 * se movem; a meia pista de cá e a calçada podem ceder (a malha do relevo tem ~6 m), mas são
 * recapeadas no nível de antes (buildGoiabinha). `roads`: vias internas.
 */
export function gradeGoiabinha(G, terrain, { roads, protect }) {
  if (!G.calcada) return null;
  const L = levelsOf(G, terrain), [r0, r1] = G.rua, [c0, c1, depth] = G.cobertura, [, , v0] = G.rampa, samples = [];
  const add = (s, v, y) => samples.push([...G.at(s, v), y]);
  for (let s = c0; s <= c1 + 1e-6; s += .6) for (let v = .2; v <= depth; v += .6) add(s, v, v >= v0 ? Math.min(L.floor, rampLevel(G, s)) : L.floor);
  for (let s = c1; s <= G.patamar + 1e-6; s += .5) for (let v = v0; v <= lineAt(G.calcada, s) + .3; v += .4) add(s, v, rampLevel(G, s));
  // vias internas cujo perfil ficou abaixo do relevo: leito (malha 24 cm acima do perfil) e calçadas
  const near = (x, z) => { const [s, v] = G.local(x, z); return s > r0 - 30 && s < r1 + 30 && v > -10 && v < 60; };
  for (const road of roads) {
    const hw = road.w / 2;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i], length = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / length, tz = (bz - az) / length;
      for (let t = 0; t <= length; t += .8) {
        const cx = ax + tx * t, cz = az + tz * t;
        if (!near(cx, cz)) continue;
        const y = terrain.roadHeightAt(road, cx, cz);
        for (let off = -hw - INNER_WALK; off <= hw + INNER_WALK + 1e-6; off += .7) {
          const x = cx - tz * off, z = cz + tx * off, level = y + (Math.abs(off) > hw ? WALK : .2);
          if (terrain.heightAt(x, z) > level - .04) samples.push([x, z, level]);
        }
      }
    }
  }
  G.grading = terrain.gradeProfile(samples, { radius: .6, band: 1.4, clearance: .05, minClearance: .03, protect: (x, z) => {
    const [s, v] = G.local(x, z);
    return protect(x, z) || (s >= r0 && s <= r1 && v < (lineAt(G.guia, s) + lineAt(G.guiaFora, s)) / 2) || (s < r0 - 6 || s > r1 + 6) && v < lineAt(G.borda, s);
  } });
  return G.grading;
}

/** Malhas, pisos e colisão. `streetMesh`: a avenida tem malha 3D (senão é só pintura no relevo). */
export function buildGoiabinha(kit, G, { ground, streetMesh = true }) {
  const solids = [], surfaces = [], exclusions = [];
  if (!G.levels || !G.calcada) return { solids, surfaces, exclusions };
  const L = G.levels, F = L.floor, [c0, c1, depth] = G.cobertura, [p0, p1] = G.portal, door = G.porta / 2, [g0, g1] = G.guarita;
  const [head, foot, v0, v1] = G.rampa, [r0, r1] = G.rua, under = F + UNDER, top = under + FASCIA;
  const f = { ...G.frame, y: 0 }, z = (v) => v * G.inward;
  const P = (s, v, y) => { const [x, zz] = G.at(s, v); return [x, y, zz]; };
  const solid = (a, va, b, vb, height, kind) => solids.push({ rings: [[G.at(a, va), G.at(b, va), G.at(b, vb), G.at(a, vb)]], top: height, kind });
  /** piso pisável de `a` a `b` (s) entre as linhas v0(s) e v1(s), na altura y(s), em faixas de `step` m */
  const strip = (color, a, b, lo, hi, y, step = 1) => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    for (let i = 0; i < n; i++) {
      const sa = a + (b - a) * i / n, sb = a + (b - a) * (i + 1) / n, q = [P(sa, lo(sa), y(sa)), P(sb, lo(sb), y(sb)), P(sb, hi(sb), y(sb)), P(sa, hi(sa), y(sa))];
      kit.quad(color, ...q, [0, 1, 0]); surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: Math.max(...q.map((p) => p[1])) });
    }
  };
  // (a calçada refeita desce ao relevo nos 2 m das pontas)
  const flat = (v) => () => v, rua = (s) => lineAt(L.rua, s) - KERB * (1 - Math.max(0, Math.min(1, (s - r0) / 2, (r1 - s) / 2))), guia = (s) => lineAt(G.guia, s), borda = (s) => lineAt(G.borda, s), calcada = (s) => lineAt(G.calcada, s);
  const rail = (a, va, ya, b, vb, yb, h = .95) => { for (const y of [h, h - .45]) kit.tube(RAIL, f, [a, ya + y, z(va)], [b, yb + y, z(vb)], .03, 6); };
  const post = (s, v, y, h = .95) => kit.tube(RAIL, f, [s, y, z(v)], [s, y + h, z(v)], .03, 6);

  // ---- faixa da avenida junto ao meio-fio em frente à portaria, recapeada no nível de antes: ali a
  // malha do relevo (~6 m) cede com o rebaixamento do lado de dentro. Para antes da faixa amarela e
  // emenda no relevo nas pontas. `streetMesh`: a avenida tem malha 3D (senão é só pintura no relevo).
  { const asphalt = streetMesh ? 'asphalt-street' : 'asphalt-ground', a = c0 - 1, b = G.patamar + 6, fade = 2.5;
    const across = (s, t) => guia(s) + (lineAt(G.guiaFora, s) - guia(s)) * t;
    const old = (s, t) => { const [y0, y1] = [0, 1].map((k) => lineAt(L.leito.map(([u, ys]) => [u, ys[k]]), s)); return y0 + (y1 - y0) * t * 2; };
    const at = (s, t) => { const [x, zz] = G.at(s, across(s, t)), w = Math.max(0, Math.min(1, (s - a) / fade, (b - s) / fade)), g = ground(x, zz); return [x, Math.max(g, g + (old(s, t) - g) * w) + .09, zz]; };
    for (let s = a; s < b - 1e-6; s += .5) for (let t = 0; t < .4 - 1e-6; t += .1) {
      const e = Math.min(b, s + .5), q = [at(s, t), at(e, t), at(e, t + .1), at(s, t + .1)];
      kit.quad(asphalt, ...q, [0, 1, 0]); surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: q.reduce((sum, p) => sum + p[1], 0) / 4 - .09 });
    } }
  // ---- calçada da avenida refeita em cima do relevo (o lado de dentro foi rebaixado), com guia
  strip(PAVING, r0, r1, guia, borda, rua, .5);
  for (let s = r0; s < r1 - 1e-6; s += 1) {
    const b = Math.min(r1, s + 1), a0 = P(s, guia(s), rua(s)), b0 = P(b, guia(b), rua(b));
    kit.quad(CURB, a0, b0, [b0[0], ground(b0[0], b0[2]) - .05, b0[2]], [a0[0], ground(a0[0], a0[2]) - .05, a0[2]], [-G.inVec[0], 0, -G.inVec[1]]);
  }

  // ---- piso da portaria (porta, catracas e o topo da rampa, tudo no nível da calçada em frente à porta)
  strip(PAVING, -door, door, flat(-.3), flat(.12), flat(F));   // soleira
  strip(PAVING, c0, head, flat(.12), flat(depth), flat(F), 1.2);
  strip(PAVING, head, c1, flat(.12), flat(v0), flat(F), 1);

  // ---- portal branco revestido em placas, com a verga da porta; placa e arandela
  { const y = Math.min(F, ground(...G.at(p0, 0)), ground(...G.at(p1, 0))) - .3;
    for (const [a, b] of [[p0, -door], [door, p1]]) {
      kit.box(WHITE, f, (a + b) / 2, (y + under) / 2, z(.11), b - a, under - y, .46); solid(a, -.12, b, .34, under, 'portal-goiabinha');
      for (let k = 1; k < 5; k++) kit.box(JOINT, f, (a + b) / 2, F + k * .5, z(-.125), b - a - .02, .018, .012);
    }
    kit.box(WHITE, f, 0, F + 2.1 + (UNDER - 2.1) / 2, z(.11), 2 * door, UNDER - 2.1, .46);
    kit.box(DARK, f, -door - .03, F + 1.05, z(.11), .06, 2.1, .48); kit.box(DARK, f, door + .03, F + 1.05, z(.11), .06, 2.1, .48);   // batentes
    kit.sign('portaria-goiabinha', paintPlaque, f, -door - .48, F + 1.55, z(-.13), .5, .36, { reverse: G.inward > 0, size: [256, 184] });
    kit.cylinder(LAMP, f, door + .32, F + 1.95, z(-.17), .14, .08, 'z', 12); kit.cylinder('#f3ead0', f, door + .32, F + 1.95, z(-.215), .1, .02, 'z', 12); }

  // ---- fachada fechada até a testeira dos dois lados do portal (o vão do muro e a fresta sob a testeira)
  for (const [a, b] of [[c0, p0], [p1, c1]]) { const y = Math.min(F, ground(...G.at(a, 0)), ground(...G.at(b, 0))) - .3; kit.box(WALL, f, (a + b) / 2, (y + under) / 2, z(.11), b - a, under - y, .42); solid(a, -.1, b, .32, under, 'fachada-goiabinha'); }

  // ---- testeira branca em placas sobre o muro e o portal, com forro
  kit.box(WHITE, f, (c0 + c1) / 2, (under + top) / 2, z((depth - .14) / 2), c1 - c0, top - under, depth + .14);
  kit.box(SOFFIT, f, (c0 + c1) / 2, under - .02, z((depth - .14) / 2), c1 - c0 - .1, .04, depth + .04);
  for (let s = c0 + 1.85; s < c1 - .5; s += 1.85) kit.box(JOINT, f, s, (under + top) / 2, z(-.145), .025, top - under - .04, .012);

  // ---- guarita na ponta oeste: paredes brancas até a testeira, janela para as catracas, fundo vermelho
  { const y = Math.min(F, ground(...G.at(g0, depth))) - .2, mid = (g0 + g1) / 2, d0 = .14, d1 = depth;
    kit.box(WHITE, f, mid, (y + under) / 2, z((d0 + d1) / 2), g1 - g0, under - y, d1 - d0);
    kit.box('glass', f, g1 + .01, F + 1.55, z((d0 + d1) / 2 + .2), .04, 1.0, d1 - d0 - 1.4);
    kit.box('glass', f, mid, F + 1.55, z(d1 + .01), g1 - g0 - .9, 1.0, .04);
    kit.box(RED, f, g0 - .015, (F + under) / 2 + .2, z((d0 + d1) / 2), .03, under - F - .4, d1 - d0 - .2);
    kit.box(DARK, f, g1 + .02, F + 1.0, z(d0 + .55), .04, 2.0, .8);   // porta da guarita
    solid(g0, d0, g1, d1, under, 'guarita-goiabinha'); }

  // ---- fundos (mureta + vidro para a calçada interna, mais baixa) e a ponta leste (só a rampa passa)
  { const base = Math.min(L.low, ground(...G.at(g1, depth))) - .2;
    kit.wall(WHITE, G.at(g1, depth), G.at(c1, depth), .16, base, F + .9, base, F + .9);
    kit.box('glass-clear', f, (g1 + c1) / 2, (F + .9 + under) / 2, z(depth), c1 - g1, under - F - .9, .05);
    solid(g1, depth - .1, c1, depth + .1, under, 'fundos-goiabinha');
    kit.wall(WHITE, G.at(c1, .1), G.at(c1, v0 - .02), .16, Math.min(F, ground(...G.at(c1, 1))) - .2, under, Math.min(F, ground(...G.at(c1, v0))) - .2, under);
    solid(c1 - .08, .1, c1 + .08, v0, under, 'fundos-goiabinha'); }
  // grades entre as catracas, e delas até as paredes (passa-se só por elas)
  for (const [a, b] of [[.14, PAR - 1.47], [PAR - .23, PAR + .23], [PAR + 1.47, depth - .05]]) { if (b - a < .1) continue; for (const y of [.55, 1.05]) kit.tube(DARK, f, [G.catracas, F + y, z(a)], [G.catracas, F + y, z(b)], .025, 6); solid(G.catracas - .06, a, G.catracas + .06, b, F + 1.05, 'grade-catracas'); }

  // ---- rampa ao longo do muro, descendo para o leste até o patamar na calçada da via interna
  { const n = Math.max(2, Math.ceil((foot - head) / .5)), run = (foot - head) / n;
    for (let i = 0; i < n; i++) {
      const a = head + run * i, b = a + run, q = [P(a, v0, rampLevel(G, a)), P(b, v0, rampLevel(G, b)), P(b, v1, rampLevel(G, b)), P(a, v1, rampLevel(G, a))];
      kit.quad(PAVING, ...q, [0, 1, 0]); surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: Math.max(q[0][1], q[1][1]) });
    }
    // parede lateral do lado de dentro (a calçada da via fica abaixo) e mureta do lado do canteiro, dentro da portaria
    const sideBase = (s) => Math.min(L.low, ground(...G.at(s, v1))) - .2;
    kit.wall(CONCRETE, G.at(head, v1 + .08), G.at(foot, v1 + .08), .16, sideBase(head), F + .02, sideBase(foot), L.low + .02);
    kit.wall(CONCRETE, G.at(head, v0 - .02), G.at(c1, v0 - .02), .12, rampLevel(G, c1) - .2, F + .12, rampLevel(G, c1) - .2, F + .12);
    // guarda-corpos brancos dos dois lados
    for (const v of [v0 + .06, v1 + .02]) { rail(head, v, F, foot, v, L.low); for (let s = head; s <= foot + 1e-6; s += (foot - head) / Math.ceil((foot - head) / 1.6)) post(s, v, rampLevel(G, s)); }
    solid(head, v1 - .05, foot, v1 + .16, F + .95, 'guarda-corpo-rampa');
    // patamar até a calçada da via interna (aberto para ela)
    strip(PAVING, foot, G.patamar, flat(v0), (s) => calcada(s) + .05, flat(L.low + .015), .8);
    const sb = Math.min(L.low, ground(...G.at(G.patamar, v0))) - .2;
    kit.wall(CONCRETE, G.at(G.patamar, v0), G.at(G.patamar, calcada(G.patamar) + .15), .14, sb, L.low + .02, sb, L.low + .02); }

  // ---- canteiro alto da cerca viva entre o muro e a rampa / calçada interna, no nível da rua
  // (moitas da cerca viva passam um pouco do muro, como no Street View)
  { const end = G.muro[2], out = (t) => lineAt(G.muroLinha, t) + .14, cuts = [c1], soilAt = (t) => Math.max(rua(t), L.low + .45);
    const jitter = (k) => { const x = Math.sin(k * 12.9898) * 43758.5453; return x - Math.floor(x); };
    for (let s = c1 + 1; s < end - .2; s += 1) { if (cuts.at(-1) < G.patamar && s > G.patamar) cuts.push(G.patamar); cuts.push(s); }
    cuts.push(end);
    for (let i = 1; i < cuts.length; i++) {
      const s = cuts[i - 1], b = cuts[i], inner = (s + b) / 2 < G.patamar ? () => v0 - .04 : (t) => calcada(t) - .03;
      if (inner(s) - out(s) < .3 && inner(b) - out(b) < .3) continue;
      const soil = Math.max(soilAt(s), soilAt(b)), base = Math.min(L.low, ground(...G.at(s, inner(s))), ground(...G.at(b, inner(b)))) - .25;
      kit.prism(SOIL, [G.at(s, out(s)), G.at(b, out(b)), G.at(b, inner(b)), G.at(s, inner(s))], base, soil);
      kit.wall(WHITE, G.at(s, inner(s) + .07), G.at(b, inner(b) + .07), .14, base, soilAt(s) + .25, base, soilAt(b) + .25);
      const width = Math.min(inner(s) - out(s), inner(b) - out(b));
      if (width > .7) {
        kit.prism(HEDGE, [G.at(s, out(s) + .2), G.at(b, out(b) + .2), G.at(b, inner(b) - .25), G.at(s, inner(s) - .25)], soil, soil + 1.2);
        const m = (s + b) / 2, rows = Math.max(1, Math.round((width - .4) / 1.1));
        for (let r = 0; r < rows; r++) {
          const k = i * 7 + r, v = out(m) + .2 + (inner(m) - out(m) - .45) * (r + .5) / rows, radius = .55 + jitter(k) * .2;
          kit.sphere(jitter(k + 3) > .5 ? HEDGE : HEDGE_DARK, f, Math.max(c1 + radius + .1, m + (jitter(k + 1) - .5) * .3), soil + 1.25 + jitter(k + 2) * .35, z(v), radius, 1.15);
        }
      }
      solids.push({ rings: [[G.at(s, out(s) - .1), G.at(b, out(b) - .1), G.at(b, inner(b) + .14), G.at(s, inner(s) + .14)]], top: soil + 2.1, kind: 'canteiro-goiabinha' });
    } }

  exclusions.push({ kind: 'portaria-goiabinha', rings: [[G.at(r0, Math.min(...G.guia.map((p) => p[1])) - .5), G.at(r1, Math.min(...G.guia.map((p) => p[1])) - .5), G.at(r1, 4.5), G.at(r0, 4.5)]] });
  return { solids, surfaces, exclusions, top, levels: L };
}

/** Placa ao lado da porta: nome da portaria e o aviso de acesso, em letras brancas sobre fundo escuro. */
const paintPlaque = (g, w, h) => {
  g.fillStyle = '#2b3036'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d8d8d4'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * .15)}px Arial`; g.fillText('PORTARIA', w / 2, h * .25); g.fillText('GOIABINHA', w / 2, h * .43);
  g.font = `${Math.round(h * .095)}px Arial`; g.fillText('Acesso de pedestres', w / 2, h * .64); g.fillText('com cartão', w / 2, h * .78);
};
