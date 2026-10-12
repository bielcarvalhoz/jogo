import { pointInPolygon } from '../shared/geo.js';
import { yawFromBearing } from './locomotive.js';
import { frameAt, toWorld, yawOf } from './landmark-kit.js';
import { mulberry32 } from '../shared/rng.js';

// Estacionamento do Balança: um pátio de asfalto ÚNICO (sem ruas nem calçadas no meio), com as vagas
// demarcadas como no local — fileiras retas e em diagonal, amarelas e brancas (as brancas com o
// quadrado/losango do símbolo na entrada da vaga), faixas zebradas, árvores entre as vagas — e a
// calçada reta rente à fachada do Balança, com a marquise da entrada.
// Medido numa vista de topo do Google Earth (170 m, dobro da resolução) girada para o sistema do
// pátio, com grade de 1 m: `u` = metros ao longo da fachada do Balança (para leste-nordeste),
// `v` = metros da fachada para o lado do muro.

const PAVING = 'pavement', ASPHALT = 'asphalt', WHITE = 'paint', YELLOW = 'paint-yellow', CURB = '#cfc9bc', SLAB = '#e4e1d8', POST = '#8d9398', WALL = '#d8d5cc', TANK = '#9aa3a8';
/** asfalto do pátio, calçada e pintura acima do relevo (as vias internas ficam a 24 cm: roads.js) */
const DECK = .22, WALK = .41, LINE = DECK + .035, CAR = { len: 4.4, wid: 1.85 };
const PALETTE = [['#f4f4f4', 34], ['#b9bdc2', 24], ['#1d1f22', 20], ['#6b7076', 10], ['#b3202a', 6], ['#2a4f8f', 6]];

export function planLot(mark) {
  const yaw = yawFromBearing(mark.heading), h = mark.heading * Math.PI / 180, ux = [Math.sin(h), -Math.cos(h)], vx = [ux[1], -ux[0]];
  const at = (u, v) => [mark.x + ux[0] * u + vx[0] * v, mark.z + ux[1] * u + vx[1] * v];
  const local = (x, z) => [(x - mark.x) * ux[0] + (z - mark.z) * ux[1], (x - mark.x) * vx[0] + (z - mark.z) * vx[1]];
  return { ...mark, yaw, ux, vx, at, local, rings: mark.partes.map((part) => part.map(([u, v]) => at(u, v))) };
}

/** linhas de uma fileira: [[u, v] do fundo, [u, v] da entrada] de cada divisória, da primeira à última */
export function rowLines(row) {
  const [v0, v1] = row.v, lean = row.inclina ?? 0, lines = [];
  // (sobe: a fileira inteira acompanha uma linha inclinada, v cresce com u)
  for (let k = 0; k <= row.vagas; k++) { const u = row.u + row.passo * k, dv = (row.sobe ?? 0) * row.passo * k; lines.push([[u, v0 + dv], [u + lean, v1 + dv + (row.sobe ?? 0) * lean]]); }
  return lines;
}
/** vagas de uma fileira: centro, direção (do fundo para a entrada) e largura útil */
export function rowStalls(row) {
  const lines = rowLines(row), out = [];
  for (let k = 1; k < lines.length; k++) {
    const [a0, a1] = lines[k - 1], [b0, b1] = lines[k], d = [a1[0] - a0[0], a1[1] - a0[1]], length = Math.hypot(...d);
    out.push({ centre: [(a0[0] + a1[0] + b0[0] + b1[0]) / 4, (a0[1] + a1[1] + b0[1] + b1[1]) / 4], dir: [d[0] / length, d[1] / length], length, width: row.passo * Math.abs(d[1]) / length, entrance: [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2] });
  }
  return out;
}

/**
 * Tira do mundo as vias que o OSM traça por dentro do pátio (não são ruas: é asfalto aberto), declara
 * o piso e os vãos de calçada e sorteia os carros estacionados (`L.cars`, nas vagas de verdade).
 */
export function fitLot(L, world) {
  const walk = L.calcada ? [L.at(L.calcada[0], L.calcada[2] - .5), L.at(L.calcada[1], L.calcada[2] - .5), L.at(L.calcada[1], L.calcada[3]), L.at(L.calcada[0], L.calcada[3])] : null;
  const inside = (x, z) => L.rings.some((ring) => pointInPolygon(x, z, [ring])) || (walk && pointInPolygon(x, z, [walk]));
  const roads = [];
  for (const road of world.roads) {
    // (L.vias: ruas de verdade que cruzam o pátio continuam sendo ruas, sem calçada dentro dele)
    if ((L.vias || []).includes(road.id)) { road.yard = true; roads.push(road); continue; }
    if (road.kind === 'foot' || road.bridge || road.highway !== 'service' || !road.pts.some((p, i) => inside(...p) || (i && inside((p[0] + road.pts[i - 1][0]) / 2, (p[1] + road.pts[i - 1][1]) / 2)))) { roads.push(road); continue; }
    // percorre a via de meio em meio metro e guarda só os trechos de fora
    const runs = []; let run = null;
    const visit = (p) => { if (inside(...p)) { run = null; return; } if (!run) runs.push(run = []); const q = run.at(-1); if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) run.push(p); };
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .5));
      if (i === 1) visit(a);
      // (só os pontos de corte e os vértices originais entram no trecho)
      let was = !inside(...a);
      for (let k = 1; k <= n; k++) { const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], now = !inside(...p); if (now !== was || k === n) visit(p); was = now; }
    }
    runs.filter((r) => r.length > 1 && r.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0) > 2).forEach((pts, k) => roads.push(k ? { ...road, id: `${road.id}~${k}`, pts } : Object.assign(road, { pts })));
  }
  L.removedRoads = world.roads.length - roads.length;
  // grades/cercas que o OSM traça por dentro do pátio também saem
  if (world.barriers) { const kept = world.barriers.filter((b) => !b.pts.some((p) => inside(...p))); world.barriers.length = 0; world.barriers.push(...kept); }
  world.roads.length = 0; world.roads.push(...roads);
  for (const ring of L.rings) { world.areas.push({ id: 'cdd/patio-balanca', tags: {}, kind: 'parking', rings: [ring], color: '#55575a', plain: true }); (world.sidewalkVoids ||= []).push(ring); }
  for (const ring of L.semCalcada || []) (world.sidewalkVoids ||= []).push(ring.map(([u, v]) => L.at(u, v)));
  for (const part of L.largo || []) { const ring = part.map(([u, v]) => L.at(u, v)); world.areas.push({ id: 'cdd/largo', tags: {}, kind: 'parking', rings: [ring], color: '#55575a', plain: true }); (world.sidewalkVoids ||= []).push(ring); }
  if (L.zebrado) world.areas.push({ id: 'cdd/zebrado', tags: {}, kind: 'parking', rings: [L.zebrado.map(([u, v]) => L.at(u, v))], color: '#55575a', plain: true });
  if (L.calcada) (world.sidewalkVoids ||= []).push([L.at(L.calcada[0], L.calcada[2]), L.at(L.calcada[1], L.calcada[2]), L.at(L.calcada[1], L.calcada[3]), L.at(L.calcada[0], L.calcada[3])]);
  // árvores entre as vagas e carros estacionados
  L.treeSpots = (L.arvores || []).map(([u, v]) => L.at(u, v));
  const rnd = mulberry32(4107), pick = () => { let r = rnd() * 100; for (const [c, w] of PALETTE) if ((r -= w) <= 0) return c; return PALETTE[0][0]; };
  L.cars = [];
  for (const row of L.fileiras) for (const stall of rowStalls(row)) {
    if (rnd() > (row.ocupacao ?? L.ocupacao ?? .4) || stall.length < CAR.len - .3) continue;
    // o carro para encostado no fundo da vaga
    const back = stall.length / 2 - CAR.len / 2 - .25, c = [stall.centre[0] - stall.dir[0] * back, stall.centre[1] - stall.dir[1] * back], [x, z] = L.at(...c);
    if (L.treeSpots.some((t) => Math.hypot(t[0] - x, t[1] - z) < 2.3)) continue;
    const [ax, az] = L.at(c[0] + stall.dir[0], c[1] + stall.dir[1]), nx = ax - x, nz = az - z;
    const ring = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [x + nx * i * CAR.len / 2 - nz * j * CAR.wid / 2, z + nz * i * CAR.len / 2 + nx * j * CAR.wid / 2]);
    L.cars.push({ x, z, yaw: Math.atan2(nx, nz) + (rnd() < .5 ? Math.PI : 0), color: pick(), ring, lot: true });
  }
  return L;
}

/** recorta um polígono convexo `subject` pelo retângulo [u0, u1] x [v0, v1] (Sutherland–Hodgman) */
function clipRect(subject, u0, v0, u1, v1) {
  let out = subject;
  for (const [axis, limit, keepLess] of [[0, u0, false], [0, u1, true], [1, v0, false], [1, v1, true]]) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], ia = keepLess ? a[axis] <= limit : a[axis] >= limit, ib = keepLess ? b[axis] <= limit : b[axis] >= limit;
      if (ia) out.push(a);
      if (ia !== ib) { const t = (limit - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (out.length < 3) return [];
  }
  return out;
}

const paintSymbol = (g, w, h) => {
  // quadrado branco da entrada da vaga; o pictograma do local não é legível nas imagens aéreas: só um traço neutro
  g.fillStyle = '#f1eee2'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#4a4f55'; g.lineWidth = w * .07; g.lineCap = 'round';
  g.beginPath(); g.arc(w * .36, h * .52, w * .14, Math.PI * .1, Math.PI * 1.5); g.stroke();
  g.beginPath(); g.arc(w * .64, h * .48, w * .14, Math.PI * 1.1, Math.PI * 2.5); g.stroke();
};

export function buildLot(kit, L, { ground }) {
  const solids = [], surfaces = [], exclusions = [], trees = [], f = { ...frameAt(L.x, L.z, L.yaw), y: 0 };
  const node = (u, v, lift) => { const [x, z] = L.at(u, v); return [x, ground(x, z) + lift, z]; };
  const flat = (color, ring, lift, walkable = true) => {
    const q = ring.map(([u, v]) => node(u, v, lift));
    for (let i = 1; i < q.length - 1; i++) kit.tri(color, q[0], q[i], q[i + 1], [0, 1, 0]);
    if (walkable) surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: Math.max(...q.map((p) => p[1])) });
  };
  // ---- asfalto único do pátio, em placas de 3 m recortadas em cada parte (convexa)
  for (const part of L.partes) {
    const us = part.map((p) => p[0]), vs = part.map((p) => p[1]);
    for (let u = Math.floor(Math.min(...us) / 3) * 3; u < Math.max(...us); u += 3) for (let v = Math.floor(Math.min(...vs) / 3) * 3; v < Math.max(...vs); v += 3) {
      const cell = clipRect(part, u, v, u + 3, v + 3);
      if (cell.length >= 3) flat(ASPHALT, cell, DECK);
    }
  }
  // saia nas bordas livres do asfalto (fecha o vão até o chão)
  const covered = (u, v) => L.partes.some((part) => pointInPolygon(u, v, [part])) || (L.calcada && u > L.calcada[0] && u < L.calcada[1] && v > L.calcada[2] && v < L.calcada[3]);
  for (const part of L.partes) for (let i = 0; i < part.length; i++) {
    const a = part[i], b = part[(i + 1) % part.length], d = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d), n = [-d[1] / length, d[0] / length], steps = Math.max(1, Math.ceil(length / 3));
    for (let k = 0; k < steps; k++) {
      const p = [a[0] + d[0] * k / steps, a[1] + d[1] * k / steps], q = [a[0] + d[0] * (k + 1) / steps, a[1] + d[1] * (k + 1) / steps], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (covered(m[0] + n[0] * .15, m[1] + n[1] * .15) && covered(m[0] - n[0] * .15, m[1] - n[1] * .15)) continue;
      const wa = L.at(...p), wb = L.at(...q), ga = ground(...wa), gb = ground(...wb); kit.wall('#505255', wa, wb, .1, ga - .15, ga + DECK, gb - .15, gb + DECK);
    }
  }
  /** faixa pintada de (u0, v0) a (u1, v1) com `wide` m de largura */
  const stroke = (color, a, b, wide = .12, lift = LINE) => {
    const d = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d) || 1, n = [-d[1] / length * wide / 2, d[0] / length * wide / 2], steps = Math.max(1, Math.ceil(length / 3));
    for (let k = 0; k < steps; k++) { const p = [a[0] + d[0] * k / steps, a[1] + d[1] * k / steps], q = [a[0] + d[0] * (k + 1) / steps, a[1] + d[1] * (k + 1) / steps]; flat(color, [[p[0] + n[0], p[1] + n[1]], [q[0] + n[0], q[1] + n[1]], [q[0] - n[0], q[1] - n[1]], [p[0] - n[0], p[1] - n[1]]], lift, false); }
  };
  // ---- vagas: divisórias, linha de fundo e o símbolo na entrada das vagas brancas
  for (const row of L.fileiras) {
    const color = row.cor === 'branca' ? WHITE : YELLOW, lines = rowLines(row);
    for (const [a, b] of lines) stroke(color, a, b);
    if (row.fundo !== false) stroke(color, lines[0][0], lines.at(-1)[0]);
    if (row.simbolo) for (const stall of rowStalls(row)) {
      const size = row.simbolo === 'losango' ? 1.45 : 1.55, c = [stall.entrance[0] - stall.dir[0] * (size / 2 + .25), stall.entrance[1] - stall.dir[1] * (size / 2 + .25)], d = stall.dir, n = [-d[1], d[0]];
      const corner = (i, j) => node(c[0] + (d[0] * i + n[0] * j) * size / 2, c[1] + (d[1] * i + n[1] * j) * size / 2, LINE + .01);
      kit.signCorners('vaga-simbolo', paintSymbol, [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)], { size: [128, 128], lit: true });
    }
  }
  // ---- faixas zebradas de pedestres (listras atravessadas ao percurso)
  for (const z of L.zebras || []) {
    // listras a cada 95 cm ao longo de TODA a poligonal (sem recomeçar nem sobrepor nas quinas)
    const wide = z.largura ?? 2.4, legs = z.eixo.slice(1).map((b, i) => { const a = z.eixo[i], d = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d); return { a, d: [d[0] / length, d[1] / length], length }; });
    let s = .3, start = 0;
    for (const leg of legs) {
      for (; s + .45 <= start + leg.length; s += .95) {
        const t = s - start + .225;
        if ((t < .55 && leg !== legs[0]) || (leg.length - t < .55 && leg !== legs.at(-1))) continue;   // (a quina fica livre)
        const m = [leg.a[0] + leg.d[0] * t, leg.a[1] + leg.d[1] * t], n = [-leg.d[1], leg.d[0]];
        stroke(WHITE, [m[0] - n[0] * wide / 2, m[1] - n[1] * wide / 2], [m[0] + n[0] * wide / 2, m[1] + n[1] * wide / 2], .45);
      }
      start += leg.length;
    }
  }
  // ---- muro de arrimo do fundo, pela linha medida; atrás dele o terraço no nível do passeio da rua de cima
  if (L.muroFundo) {
    const line = L.muroFundo, [t0, t1, tv] = L.terraco || [0, -1, 0], wallV = (u) => { for (let k = 1; k < line.length; k++) if (u <= line[k][0] + 1e-9) { const a = line[k - 1], b = line[k]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); } return line.at(-1)[1]; };
    const street = (u) => ground(...L.at(u, tv - 1.6)) + WALK, lot = (u) => ground(...L.at(u, wallV(u) + 1.5));
    // topo do muro: nível do terraço (onde há) ou 2,6 m; sempre contínuo
    // (topo reto: um nível só ao longo do terraço, outro no trecho junto às máquinas)
    const terraceTop = Math.max(...Array.from({ length: 12 }, (_, k) => street(t0 + (t1 - t0) * k / 11))), topAt = (u) => (u <= t1 ? terraceTop : lot(line.at(-1)[0]) + 2.6) + 1.0;
    const us = [...new Set([...line.map((p) => p[0]), ...Array.from({ length: Math.ceil((line.at(-1)[0] - line[0][0]) / 2.5) + 1 }, (_, k) => Math.min(line.at(-1)[0], line[0][0] + k * 2.5))])].sort((a, b) => a - b);
    for (let k = 1; k < us.length; k++) {
      const a = us[k - 1], b = us[k]; if (b - a < .05) continue;
      const wa = L.at(a, wallV(a) - .13), wb = L.at(b, wallV(b) - .13), low = Math.min(lot(a), lot(b)) - .3;
      kit.wall(WALL, wa, wb, .26, low, topAt(a), low, topAt(b));
      solids.push({ rings: [[L.at(a, wallV(a)), L.at(b, wallV(b)), L.at(b, wallV(b) - .3), L.at(a, wallV(a) - .3)]], top: Math.max(topAt(a), topAt(b)), kind: 'muro-fundo-patio' });
      if (b <= t1 + 1e-6) {   // terraço: laje do passeio de cima, do muro até a calçada da rua
        const ya = topAt(a) - 1, yb = topAt(b) - 1, q = [[a, wallV(a) - .26, ya], [b, wallV(b) - .26, yb], [b, tv, yb], [a, tv, ya]].map(([u, v, y]) => { const [x, z] = L.at(u, v); return [x, y, z]; });
        kit.quad(PAVING, ...q, [0, 1, 0]); surfaces.push({ rings: [q.map((p) => [p[0], p[2]])], y: Math.max(ya, yb) });
      }
    }
    if (L.terraco) {   // testeira leste do terraço e exclusão (sem árvores sorteadas em cima)
      const y = topAt(t1) - 1; kit.wall(WALL, L.at(t1, wallV(t1)), L.at(t1, tv), .26, lot(t1) - .3, y, ground(...L.at(t1, tv)) - .3, y);
      exclusions.push({ kind: 'terraco-patio', rings: [[...line.filter((p) => p[0] <= t1).map(([u, v]) => L.at(u, v + 1)), L.at(t1, tv), L.at(t0, tv)]] });
    }
    if (L.arvoreGrande) { const [x, z] = L.at(...L.arvoreGrande); trees.push({ x, z, s: 2.5, r: 1.1, v: .5, pink: false }); }
  }
  // ---- passeios extras (ex.: rente ao muro da escada) e a guia clara ao longo da faixa zebrada
  for (const [u0, u1, v0, v1] of L.passeios || []) {
    for (let v = v0; v < v1 - 1e-6; v += 3) { const e = Math.min(v1, v + 3); flat(PAVING, [[u0, v], [u1, v], [u1, e], [u0, e]], WALK); const a = L.at(u1, v), b = L.at(u1, e), ga = ground(...a), gb = ground(...b); kit.wall(CURB, a, b, .16, ga - .1, ga + WALK + .01, gb - .1, gb + WALK + .01); }
    for (const v of [v0, v1]) { const a = L.at(u0, v), b = L.at(u1, v), ga = ground(...a), gb = ground(...b); kit.wall(CURB, a, b, .16, ga - .1, ga + WALK + .01, gb - .1, gb + WALK + .01); }
  }
  if (L.guia) { const [a, b] = L.guia, d = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d), n = [-d[1] / length * .45, d[0] / length * .45], steps = Math.ceil(length / 2.5); for (let k = 0; k < steps; k++) { const p = [a[0] + d[0] * k / steps, a[1] + d[1] * k / steps], q = [a[0] + d[0] * (k + 1) / steps, a[1] + d[1] * (k + 1) / steps]; flat(PAVING, [[p[0] + n[0], p[1] + n[1]], [q[0] + n[0], q[1] + n[1]], [q[0] - n[0], q[1] - n[1]], [p[0] - n[0], p[1] - n[1]]], DECK + .05, false); } }
  if (L.caixaAmarela) L.caixaAmarela.forEach((p, k, ring) => stroke(YELLOW, p, ring[(k + 1) % ring.length]));
  // ---- largo da rua de cima: asfalto aberto entre os meios-fios medidos, e a faixa de pedestres da saída leste
  for (const part of L.largo || []) {
    const us = part.map((p) => p[0]), vs = part.map((p) => p[1]);
    for (let u = Math.floor(Math.min(...us) / 1.5) * 1.5; u < Math.max(...us); u += 1.5) for (let v = Math.floor(Math.min(...vs) / 1.5) * 1.5; v < Math.max(...vs); v += 1.5) { const cell = clipRect(part, u, v, u + 1.5, v + 1.5); if (cell.length >= 3) flat(ASPHALT, cell, DECK + .045); }
    exclusions.push({ kind: 'largo', rings: [part.map(([u, v]) => L.at(u, v))] });
  }
  if (L.faixaLargo) { const [a, b, wide] = L.faixaLargo, d = [b[0] - a[0], b[1] - a[1]], length = Math.hypot(...d), n = [-d[1] / length, d[0] / length]; for (let t = .3; t + .45 <= length; t += .95) { const m = [a[0] + d[0] * (t + .225) / length, a[1] + d[1] * (t + .225) / length]; stroke(WHITE, [m[0] - n[0] * wide / 2, m[1] - n[1] * wide / 2], [m[0] + n[0] * wide / 2, m[1] + n[1] * wide / 2], .45, DECK + .09); } }
  // ---- zebrado atrás da casa de máquinas (no nível de cima): asfalto e listras diagonais recortadas no contorno
  if (L.zebrado) {
    const ring = L.zebrado, us = ring.map((p) => p[0]), vs = ring.map((p) => p[1]);
    for (let u = Math.floor(Math.min(...us) / 1.5) * 1.5; u < Math.max(...us); u += 1.5) for (let v = Math.floor(Math.min(...vs) / 1.5) * 1.5; v < Math.max(...vs); v += 1.5) { const cell = clipRect(ring, u, v, u + 1.5, v + 1.5); if (cell.length >= 3) flat(ASPHALT, cell, DECK + .1, false); }
    const d = [.81, -.58], n = [.58, .81], dots = ring.map((p) => p[0] * n[0] + p[1] * n[1]);
    for (let c = Math.min(...dots) + .7; c < Math.max(...dots); c += 1.5) {
      const hits = [];
      for (let k = 0; k < ring.length; k++) { const p = ring[k], q = ring[(k + 1) % ring.length], dp = p[0] * n[0] + p[1] * n[1] - c, dq = q[0] * n[0] + q[1] * n[1] - c; if (dp * dq < 0) { const t = dp / (dp - dq); hits.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } }
      if (hits.length === 2) stroke(WHITE, hits[0], hits[1], .6, DECK + .135);
    }
    ring.forEach((p, k) => stroke(WHITE, p, ring[(k + 1) % ring.length], .16, DECK + .135));
  }
  // ---- casa de máquinas: galpão de cobertura envidraçada e duas torres de resfriamento; caminho do lado leste
  // com a escadinha que sobe para a rua de cima
  if (L.maquinas) {
    const [A, B, C, D] = L.maquinas.map(([u, v]) => L.at(u, v)), len = Math.hypot(B[0] - A[0], B[1] - A[1]), deep = Math.hypot(D[0] - A[0], D[1] - A[1]);
    const m = frameAt(A[0], A[1], yawOf(B[0] - A[0], B[1] - A[1])), near = (t) => Math.hypot(toWorld(m, 0, t)[0] - D[0], toWorld(m, 0, t)[1] - D[1]), side = near(1) < near(-1) ? 1 : -1;
    const g = Math.min(...[A, B, C, D].map((p) => ground(...p))), hall = len * .45, mf = { ...m, y: 0 };
    kit.box('#c9ccc8', mf, hall / 2, g + 2.4, side * deep / 2, hall, 5.2, deep); kit.box('#7f9aa3', mf, hall / 2, g + 5.1, side * deep / 2, hall - .6, .25, deep - .6);
    kit.box('#9a9fa2', mf, (hall + len) / 2, g + .9, side * deep / 2, len - hall, 2.2, deep);
    for (const k of [.3, .76]) { const x = hall + (len - hall) * k; kit.box('#e9e9e4', mf, x, g + 4.2, side * deep / 2, 3.4, 4.6, deep - 1.6); for (let q = 0; q < 5; q++) kit.cylinder('#1c1f22', mf, x, g + 6.53, side * (1.7 + q * (deep - 3.4) / 4), 1.1, .08, 'y', 10); }
    solids.push({ rings: [[A, B, C, D]], top: g + 6.6, kind: 'casa-de-maquinas' }); exclusions.push({ kind: 'casa-de-maquinas', rings: [[A, B, C, D]] });
    // caminho rente ao lado leste (B→C) e escada que continua na mesma direção até o chão de cima
    const wf = frameAt(...toWorld(m, len + 1.1, side * -1.2), yawOf(C[0] - B[0], C[1] - B[1])), run = deep - 1.6, P = (x, t) => toWorld(wf, x, t), base = ground(...P(run / 2, 0)) + WALK, w0 = { ...wf, y: 0 };
    kit.box(SLAB, w0, run / 2, base - .25, 0, run, .5, 1.6); surfaces.push({ rings: [[P(0, -.8), P(run, -.8), P(run, .8), P(0, .8)]], y: base });
    // degraus de 40 cm acompanhando o talude (espelho de até 17 cm), do fim do caminho até o zebrado da rua de cima
    const TREAD = .3, s0 = P(run, 0), aim = L.escadaPara ? L.at(...L.escadaPara) : P(run + 8, 0), dist = Math.hypot(aim[0] - s0[0], aim[1] - s0[1]);
    const sf = frameAt(s0[0], s0[1], yawOf(aim[0] - s0[0], aim[1] - s0[1])), S = (x, t) => toWorld(sf, x, t), z0 = { ...sf, y: 0 };
    let y = base, k = 0;
    for (; k < 90; k++) {
      const x0 = k * TREAD, here = ground(...S(x0 + TREAD / 2, 0));
      if (x0 >= dist && ground(...S(x0 + 1.4, 0)) <= y + .12) break;   // (só termina quando chega ao chão de cima)
      y = Math.max(y, Math.min(y + .18, Math.max(here, ground(...S(x0 + TREAD, 0))) + .08));   // (no trecho plano vira caminho; sobe quando o talude sobe)
      kit.box('#a7a399', z0, x0 + TREAD / 2, y - .6, 0, TREAD, 1.2, 1.6); kit.box('#d8b13a', z0, x0 + .04, y + .003, 0, .08, .006, 1.6);
      surfaces.push({ rings: [[S(x0, -.8), S(x0 + TREAD, -.8), S(x0 + TREAD, .8), S(x0, .8)]], y });
    }
    const end = k * TREAD; kit.box(SLAB, z0, end + .6, y - .5, 0, 1.2, 1, 1.6); surfaces.push({ rings: [[S(end, -.8), S(end + 1.2, -.8), S(end + 1.2, .8), S(end, .8)]], y });
    kit.cylinder(SLAB, w0, run, base - .25, 0, 1.0, .5, 'y', 10); surfaces.push({ rings: [[P(run - .9, -.9), P(run + .9, -.9), P(run + .9, .9), P(run - .9, .9)]], y: base });   // patamar da virada
    for (const t of [-.8, .8]) { kit.tube('#565b61', z0, [0, base + .95, t], [end, y + .95, t], .03, 6); for (const [x, yy] of [[0, base], [end, y]]) kit.tube('#565b61', z0, [x, yy, t], [x, yy + .95, t], .03, 6); }
    L.escadinha = { risers: k, baseY: base, topY: y, path: [P(1, 0), P(run, 0), S(end + 1, 0)] };
    exclusions.push({ kind: 'escadinha', rings: [[S(-1, -1.5), S(end + 2, -1.5), S(end + 2, 1.5), S(-1, 1.5)]] });
    exclusions.push({ kind: 'escadinha', rings: [[P(-1, -1.5), P(run + 1, -1.5), P(run + 1, 1.5), P(-1, 1.5)]] });
  }
  // ---- calçada reta rente à fachada, com guia; marquise da entrada sobre ela
  if (L.calcada) {
    const [u0, u1, v0, v1] = L.calcada;
    for (let u = u0; u < u1 - 1e-6; u += 3) { const e = Math.min(u1, u + 3); flat(PAVING, [[u, v0], [e, v0], [e, v1], [u, v1]], WALK); const a = L.at(u, v1), b = L.at(e, v1), ga = ground(...a), gb = ground(...b); kit.wall(CURB, a, b, .16, ga - .1, ga + WALK + .01, gb - .1, gb + WALK + .01); }
    for (const u of [u0, u1]) { const a = L.at(u, v0), b = L.at(u, v1), ga = ground(...a), gb = ground(...b); kit.wall(CURB, a, b, .16, ga - .1, ga + WALK + .01, gb - .1, gb + WALK + .01); }
  }
  if (L.marquise) {
    const [u0, u1, v0, v1] = L.marquise, [cx, cz] = L.at((u0 + u1) / 2, (v0 + v1) / 2), y = ground(cx, cz) + WALK + 3.1, m = { ...f, x: cx, z: cz };
    kit.box(SLAB, m, 0, y + .15, 0, u1 - u0, .3, v1 - v0);
    for (const u of [u0 + .3, (u0 + u1) / 2, u1 - .3]) { const [x, z] = L.at(u, v1 - .3), g = ground(x, z); kit.box(POST, { ...f, x, z }, 0, (g + y) / 2, 0, .18, y - g, .18); solids.push({ rings: [[[x - .15, z - .15], [x + .15, z - .15], [x + .15, z + .15], [x - .15, z + .15]]], top: y, kind: 'pilar-marquise' }); }
  }
  // ---- pátio de equipamentos murado na ponta oeste (tanques)
  if (L.equipamentos) {
    const [u0, u1, v0, v1] = L.equipamentos, ring = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => L.at(u, v)), g = Math.min(...ring.map((p) => ground(...p)));
    for (let i = 0; i < 4; i++) kit.wall(WALL, ring[i], ring[(i + 1) % 4], .2, g - .2, g + 2.6, g - .2, g + 2.6);
    for (const k of [.3, .7]) { const [x, z] = L.at(u0 + (u1 - u0) * k, v1 - 2); kit.cylinder(TANK, { ...f, x, z }, 0, g + 1.9, 0, 1.3, 3.4, 'y', 12); }
    solids.push({ rings: [ring], top: g + 2.6, kind: 'patio-equipamentos' });
    exclusions.push({ kind: 'patio-equipamentos', rings: [ring] });
  }
  // ---- árvores entre as vagas, cada uma no seu canteiro
  for (const [x, z] of L.treeSpots || []) {
    const g = ground(x, z);
    kit.cylinder(CURB, { ...f, x, z }, 0, g + DECK + .06, 0, .75, .12, 'y', 10); kit.cylinder('#6b5a44', { ...f, x, z }, 0, g + DECK + .125, 0, .6, .02, 'y', 10);
    trees.push({ x, z, s: 1.25, r: (x * 7 + z * 3) % 6.28, v: .5, pink: false });
    solids.push({ rings: [[[x - .25, z - .25], [x + .25, z - .25], [x + .25, z + .25], [x - .25, z + .25]]], top: g + 3, kind: 'tronco-patio' });
  }
  // sem árvores de calçada na rua rente ao muro
  for (const ring of L.semCalcada || []) exclusions.push({ kind: 'rua-do-muro', rings: [ring.map(([u, v]) => L.at(u, v))] });
  return { solids, surfaces, exclusions, trees, escadinha: L.escadinha };
}
