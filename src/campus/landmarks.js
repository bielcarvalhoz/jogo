import { pointInPolygon, SpatialGrid } from '../shared/geo.js';
import { mulberry32 } from '../shared/rng.js';
import { exteriorEdges } from './reference.js';
import { createKit, toWorld } from './landmark-kit.js';
import { planStairway, resolveStairway, stairwaySamples, buildStairway } from './stairway.js';
import { planPortaria, fitPortariaRoads, buildPortaria } from './portaria.js';
import { planPedestrianGate, fitPedestrianGate, gradePedestrianGate, buildPedestrianGate } from './portaria-pedestres.js';
import { planLocomotive, settleLocomotive, buildLocomotive } from './locomotive.js';
import { WALK, prepareAlley, nearestStreet, terraceSamples, planAlleyStair, alleySamples, backDoorFrame, spanAt, buildPrataAccess } from './prata-access.js';

// Marcos levantados com os vídeos e fotos de quem trabalha no campus (10/2026) e com a planta
// oficial: escadaria da mata, beco do Balança, entradas do Prata e a locomotiva 801.
// Fluxo: prepareLandmarks (planta) -> landmarkPlatformLevels + gradeLandmarks (relevo) -> buildLandmarks.

const SIDEWALK = 2.5, FLOOR = 3.6;

/** Depois de ler as feições: ajusta vias, abre o beco e marca os prédios com acesso de referência. */
export function prepareLandmarks(C, world) {
  // Eixos de via corrigidos (o traçado do OSM passa rente à fachada errada): mantém as pontas,
  // que são os nós compartilhados com as outras vias, e troca o miolo.
  for (const fix of (C.paths || []).filter((p) => p.kind === 'roadFix')) {
    const road = world?.roads.find((r) => r.id === fix.way);
    if (!road || road.pts.length < 2) continue;
    if (fix.insert) {
      // curva acrescentada no trecho mais próximo (o resto do eixo fica como está)
      let at = 1, best = Infinity;
      for (let i = 1; i < road.pts.length; i++) { const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i], m = fix.pts[0], l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1, t = Math.max(0, Math.min(1, ((m[0] - ax) * (bx - ax) + (m[1] - az) * (bz - az)) / l2)), d = Math.hypot(m[0] - ax - (bx - ax) * t, m[1] - az - (bz - az) * t); if (d < best) { best = d; at = i; } }
      road.pts.splice(at, 0, ...fix.pts);
    } else road.pts = [road.pts[0], ...fix.pts, road.pts.at(-1)];
  }
  const marks = C.landmarks || [];
  const alley = marks.find((m) => m.type === 'beco');
  if (alley) C.alley = prepareAlley(C, alley);
  for (const m of marks) if (m.type === 'entrada') { const b = C.buildings.find((q) => q.planId === m.building); if (b) b.referenceAccess = true; }
  // portaria dupla: uma cobertura só para as duas pistas (os cruzamentos de muro não ganham marquise própria)
  const gate = marks.find((m) => m.type === 'portaria');
  if (gate) {
    C.portaria = planPortaria(gate, (x, z) => pointInPolygon(x, z, C.quarter));
    if (world) fitPortariaRoads(C.portaria, world, C);
    for (const g of C.gates || []) if (g.num === gate.gate && g.type === 'portaria') g.combined = true;
  }
  // portaria de pedestres levantada: cobertura, portal e faixa próprios (campus.js só põe o rótulo)
  const pedestrians = marks.find((m) => m.type === 'portaria-pedestres');
  if (pedestrians) { C.pedestrianGate = planPedestrianGate(pedestrians, (x, z) => pointInPolygon(x, z, C.quarter)); if (world) fitPedestrianGate(C.pedestrianGate, world, C); }
  const locomotive = marks.find((m) => m.type === 'locomotiva');
  if (locomotive) C.locomotive = planLocomotive(locomotive);
}

/**
 * Níveis de plataforma impostos pelos marcos. Prédios em encosta assentam no nível da rua mais
 * baixa e ganham os andares que ficam enterrados do lado alto (o relevo encosta neles depois).
 */
export function landmarkPlatformLevels(C, world, terrain) {
  const levels = new Map(), A = C.alley, roads = world.roads;
  const streetLevel = (x, z, reach = 30) => { const s = nearestStreet(roads, x, z, reach); return s ? terrain.roadHeightAt(s.road, s.x, s.z) : NaN; };
  if (A) {
    const mouth = A.at(A.uA, A.v0 - 2), level = streetLevel(...mouth, 14);
    A.lowLevel = Number.isFinite(level) ? level : terrain.heightAt(...mouth);
    levels.set(A.building, A.lowLevel);
  }
  // Prata: andar zero pela rua de trás (sul); a rua do lado norte fica no -2.
  const back = (C.landmarks || []).find((m) => m.type === 'entrada' && m.id === 'prata-terreo'), prata = back && C.buildings.find((b) => b.planId === back.building);
  const door = prata && backDoorFrame(prata, back);
  if (door) {
    // o andar zero é o nível do chão em frente à porta dos fundos
    const around = prata.rings[0].map(([x, z]) => streetLevel(x, z)).filter(Number.isFinite), front = streetLevel(...door.front) + WALK;
    const base = Math.min(...around) - .3;
    if (around.length && Number.isFinite(front) && front - base > 2) {
      prata.aboveGround ??= prata.height; prata.floorsAbove ??= prata.levels;
      prata.frontLevel = prata.floorZero = front;
      prata.height = prata.floorZero + prata.aboveGround - base;
      prata.levels = prata.floorsAbove + Math.max(1, Math.round((prata.floorZero - base) / FLOOR));
      levels.set(prata.planId, base);
    }
  }
  return levels;
}

/** maior v (lado da rua) onde a reta u = const corta o prédio do beco ou o bloco de arrimo */
function streetSideAt(A, u) {
  const best = spanAt(A, u, [...A.pieces.map((piece) => piece.rings[0]), A.block])[1];
  return Number.isFinite(best) ? best : A.v1;
}

/** Ajustes finos do relevo, depois da terraplenagem geral do campus e antes de gerar a malha. */
export function gradeLandmarks(world, terrain, C) {
  const roads = world.roads, report = {};
  const bed = (x, z) => { const s = nearestStreet(roads, x, z, 12); return !!s && s.d - s.road.w / 2 <= SIDEWALK + .3; };
  const inBuilding = (x, z, except = []) => C.buildings.some((b) => b.structure !== 'pergola' && !except.includes(b) && pointInPolygon(x, z, b.rings));
  const sidewalkEdge = (p, toward, reach = 26) => {
    for (let t = .25; t <= reach; t += .25) {
      const q = [p[0] + toward[0] * t, p[1] + toward[1] * t], s = nearestStreet(roads, ...q, 12);
      if (s && s.d - s.road.w / 2 <= SIDEWALK) return { t, street: s, y: terrain.roadHeightAt(s.road, s.x, s.z) + WALK };
    }
    return null;
  };

  // Depois de rebaixar uma plataforma, o leito das vias vizinhas volta ao perfil da via (a
  // terraplenagem geral nunca aterra células que tocam a planta de um prédio).
  const restoreBeds = (rings, reach = 34) => {
    const samples = [];
    for (const road of roads) {
      if (!road.internal || road.bridge || road.kind === 'foot') continue;
      for (let i = 1; i < road.pts.length; i++) {
        const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i], L = Math.hypot(bx - ax, bz - az) || 1, d = [(bx - ax) / L, (bz - az) / L], half = road.w / 2 + SIDEWALK;
        for (let t = 0; t <= L; t += 1.4) {
          const x = ax + d[0] * t, z = az + d[1] * t;
          if (!rings.some((ring) => ring.some((p) => Math.hypot(p[0] - x, p[1] - z) < reach))) continue;
          const y = terrain.roadHeightAt(road, x, z) - .03;
          for (let o = -half; o <= half + 1e-6; o += half / 3) samples.push([x - d[1] * o, z + d[0] * o, y]);
        }
      }
    }
    return samples.length ? terrain.gradeProfile(samples, { radius: 1, band: 2, clearance: 0, minClearance: -9, protect: (x, z) => !bed(x, z) }) : null;
  };

  // 1) Balança semienterrado: a rua do Prata encosta na laje; o beco sobe do estacionamento até ela.
  const A = C.alley;
  if (A) {
    const exit = sidewalkEdge(A.at(A.uA, A.v1), [A.nx, A.nz]);
    if (exit) {
      // O relevo sobe para o nível da rua só nos 5 m de trás da planta: da linha para o lado do
      // estacionamento ele fica no nível do térreo (a fachada da frente aparece inteira).
      const inset = 5, front = (x, z) => A.V([x, z]) < streetSideAt(A, A.U([x, z])) - inset - .5;
      const terrace = terraceSamples(roads, terrain, A.at(A.uMin, 0), [A.ux, A.uz], [A.nx, A.nz], A.uMax - A.uMin, { inset, depthAt: (s) => streetSideAt(A, A.uMin + s) });
      report.terrace = terrain.gradeProfile(terrace.samples, { radius: 1.2, band: 4, clearance: .05, minClearance: .02, protect: (x, z) => bed(x, z) || inBuilding(x, z, A.pieces) || front(x, z) });
      report.beds = restoreBeds([...A.pieces.map((piece) => piece.rings[0]), A.block]);
      A.stair = planAlleyStair(A, A.lowLevel + .1, exit.y, exit.t);
      report.alley = terrain.gradeProfile(alleySamples(A, A.stair), { radius: 1, band: 2.5, clearance: .3, minClearance: .1, protect: bed });
      for (const piece of A.pieces) {
        const platform = terrain.platformFor(piece)?.height ?? A.lowLevel;
        // a laje é estacionamento: fica rente à calçada da rua de trás
        piece.height = Math.max(3.5, Math.min(11, exit.y + .03 - platform)); piece.levels = 2; piece.deckLevel = platform + piece.height;
      }
    }
  }

  // 2) Prata em encosta: o chão em volta acompanha a rua de cada lado (andar zero ao sul, -2 ao norte).
  const prata = C.buildings.find((b) => b.planId === 'b6' && Number.isFinite(b.floorZero));
  if (prata) {
    const samples = [];
    for (const e of exteriorEdges(prata.rings[0])) if (e.L >= 1.5) samples.push(...terraceSamples(roads, terrain, [e.ax, e.az], [e.dx, e.dz], [e.nx, e.nz], e.L, { inset: 4 }).samples);
    report.prata = terrain.gradeProfile(samples, { radius: 1.2, band: 4, clearance: .05, minClearance: .02, protect: (x, z) => bed(x, z) || inBuilding(x, z, [prata]) });
    report.prataBeds = restoreBeds([prata.rings[0]]);
  }

  // 3) Jardim da locomotiva: plano, no nível do gramado.
  if (C.locomotive) {
    const L = C.locomotive = settleLocomotive(C.locomotive, (x, z) => { const s = nearestStreet(roads, x, z, 20); return s ? s.d - s.road.w / 2 : Infinity; });
    // nível do jardim: o das vias em volta (o gramado real é plano, rente ao calçamento)
    const around = roads.filter((r) => r.internal && !r.bridge && r.kind !== 'foot').map((r) => nearestStreet([r], L.x, L.z, 32)).filter(Boolean).map((s) => terrain.roadHeightAt(s.road, s.x, s.z));
    const level = around.length ? around.reduce((sum, y) => sum + y, 0) / around.length + .1 : terrain.heightAt(L.x, L.z), samples = [];
    for (let x = -17; x <= 15; x += 1.5) for (let z = -5; z <= 5; z += 1.25) samples.push([...toWorld(L.frame, x, z), level]);
    report.locomotive = terrain.gradeProfile(samples, { radius: 8.5, band: 7, clearance: 0, minClearance: -.4, protect: (x, z) => bed(x, z) || inBuilding(x, z) });
  }

  // Portaria de pedestres: a calçada da rua e o saguão ficam um lance abaixo do estacionamento.
  if (C.pedestrianGate) {
    const leito = (x, z) => { const s = nearestStreet(roads.filter((r) => r.kind !== 'foot'), x, z, 14); return !!s && s.d - s.road.w / 2 <= .4; };
    report.pedestrianGate = gradePedestrianGate(C.pedestrianGate, terrain, { roadLevel: (road, x, z) => { const s = road && nearestStreet([road], x, z, 40); return s ? terrain.roadHeightAt(road, s.x, s.z) : undefined; }, protect: (x, z) => leito(x, z) || inBuilding(x, z) });
  }

  // 4) Escadarias: corte/aterro sob lances, patamares e passarela.
  C.stairways = [];
  for (const path of (C.paths || []).filter((p) => p.kind === 'stairway')) {
    const walk = (C.paths || []).find((p) => p.kind === 'walkway' && p.from === path.id), points = [...path.pts, ...(walk ? walk.pts.slice(1) : [])];
    // topo e fim encostam na borda externa da calçada das vias internas
    const snap = (p, reach) => {
      const s = nearestStreet(roads, ...p, reach);
      if (!s) return { p, y: terrain.heightAt(...p) + (walk?.endLift ?? 0) };   // (endLift: chega numa calçada feita por outro marco)
      const dx = p[0] - s.x, dz = p[1] - s.z, L = Math.hypot(dx, dz) || 1, off = s.road.w / 2 + SIDEWALK + .02;
      return { p: [s.x + dx / L * off, s.z + dz / L * off], y: terrain.roadHeightAt(s.road, s.x, s.z) + WALK, street: s };
    };
    const top = snap(points[0], 14), end = walk ? snap(points.at(-1), 9) : null;
    points[0] = top.p; if (end) points[points.length - 1] = end.p;
    const options = { width: path.width ?? 3, rampWidth: walk?.width ?? 2.2, plaza: path.plaza ?? -1, plazaRadius: path.plazaRadius ?? 2.7, ramps: walk ? walk.pts.length - 1 : 0 };
    let plan = planStairway(points, options);
    // Degraus suficientes para o desnível real do barranco: espelho perto de 18 cm e piso entre
    // 25 e 30 cm (o eixo vem da planta; o número de degraus, do relevo).
    // (o pé da escada não desce abaixo do fim da passarela: ela é plana, como no vídeo)
    const foot = plan.flights.at(-1).b, drop = top.y - Math.max(terrain.heightAt(...foot), end ? end.y : -Infinity) - .05, run = plan.flights.reduce((sum, f) => sum + f.run, 0);
    const tread = Math.max(.25, Math.min(.3, run / Math.ceil(drop / .18)));
    if (Math.abs(tread - plan.flights[0].tread) > .004) plan = planStairway(points, { ...options, tread });
    const riser = Math.max(.14, Math.min(.2, drop / plan.risers));
    const S = resolveStairway(plan, { topY: top.y, riser, endY: end ? end.y : top.y - plan.risers * riser });
    S.id = path.id; S.name = path.name; S.sawtoothFrom = path.sawtoothFrom ?? Infinity;
    S.grading = terrain.gradeProfile(stairwaySamples(S), { radius: 3.5, band: 9, clearance: .35, minClearance: .12, protect: (x, z) => bed(x, z) || inBuilding(x, z) });
    C.stairways.push(S);
  }
  report.stairways = C.stairways.map((S) => ({ id: S.id, risers: S.risers, riser: S.riser, topY: S.topY, bottomY: S.bottomY, endY: S.endY, ...S.grading }));
  return report;
}

/** Mata em volta de uma escadaria: árvores dos dois lados do eixo, fora dos pisos e das vias. */
function groveAround(S, C, roads) {
  const rnd = mulberry32(8011), trees = [], pts = S.path;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), d = [(bx - ax) / L, (bz - az) / L];
    for (let s = 1; s < L; s += 2.6) for (const side of [-1, 1]) for (const ring of [0, 1]) {
      const off = side * (4.6 + ring * 5.2 + rnd() * 3.6), along = s + (rnd() - .5) * 2.4;
      const x = ax + d[0] * along - d[1] * off, z = az + d[1] * along + d[0] * off, street = nearestStreet(roads, x, z, 12);
      if (street && street.d - street.road.w / 2 < SIDEWALK + 1.2) continue;
      if (C.insideSolid?.(x, z, 1.6) || (C.inRegion && !C.inRegion(x, z, .4)) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.1)) continue;
      trees.push({ x, z, s: 1.05 + rnd() * .55, r: rnd() * Math.PI * 2, v: rnd(), pink: false, grove: true });
    }
  }
  return trees;
}

/** Malhas, pisos, colisão e áreas sem árvores/carros dos marcos. */
/** `rendered(road)`: se a via ganha malha 3D (sem o entorno, as ruas de fora são só pintura no relevo) */
export function buildLandmarks(C, { renderer, terrain, world, roads, rendered }) {
  const kit = createKit(renderer), solids = [], surfaces = [], exclusions = [], entrances = [], trees = [];
  const ground = (x, z) => terrain.heightAt(x, z), sidewalkAt = roads?.sidewalkHeightAt, surfaceAt = roads?.surfaceHeightAt;
  const take = (part) => { solids.push(...part.solids); surfaces.push(...part.surfaces); exclusions.push(...part.exclusions); if (part.entrances) entrances.push(...part.entrances); if (part.trees) trees.push(...part.trees.map((t) => ({ ...t, fixed: true }))); return part; };
  const plan = { stairways: [], locomotive: C.locomotive || null, alley: C.alley || null };

  for (const planned of C.stairways || []) {
    // cota real da calçada (a terraplenagem usou a estimativa do perfil da via)
    const first = planned.flights[0], head = planned.path[0], tail = planned.path.at(-1), last = planned.ramps.at(-1);
    const yTop = sidewalkAt?.(head[0] - first.d[0] * .5, head[1] - first.d[1] * .5), yEnd = last ? sidewalkAt?.(tail[0] + last.d[0] * .5, tail[1] + last.d[1] * .5) : NaN;
    const topY = Number.isFinite(yTop) && Math.abs(yTop - planned.topY) < .6 ? yTop : planned.topY;
    const endY = Number.isFinite(yEnd) && Math.abs(yEnd - planned.endY) < .6 ? yEnd : planned.endY + (topY - planned.topY);
    const S = resolveStairway(planned, { topY, riser: planned.riser, endY });
    take(buildStairway(kit, S, { ground, sawtoothFrom: planned.sawtoothFrom }));
    trees.push(...groveAround(S, C, world.roads));
    plan.stairways.push(S);
  }
  const roadClearance = (x, z) => { const s = nearestStreet(world.roads, x, z, 20); return s ? s.d - s.road.w / 2 : Infinity; };
  if (C.locomotive) plan.locomotive = { ...C.locomotive, ...take(buildLocomotive(kit, C.locomotive, { ground, clearance: roadClearance })) };
  if (C.portaria) plan.portaria = { ...C.portaria, ...take(buildPortaria(kit, C.portaria, { ground, clearance: roadClearance, surfaceAt, streetMesh: !rendered || !C.portaria.rua || rendered(C.portaria.rua) })) };
  if (C.pedestrianGate) plan.pedestrianGate = { ...C.pedestrianGate, ...take(buildPedestrianGate(kit, C.pedestrianGate, { ground, surfaceAt })) };
  const access = take(buildPrataAccess(kit, C, { ground, roads: world.roads, surfaceAt, sidewalkAt }));
  plan.access = access.notes;

  const root = kit.finish('marcos-cidade-de-deus');
  const index = new SpatialGrid(8);
  for (const surface of surfaces) {
    // Pisos vizinhos (degrau/patamar) dividem uma aresta exata: alarga cada um 3 cm a partir do
    // centro para a consulta nunca cair na junta. Todos os pisos dos marcos são convexos.
    const ring = surface.rings[0], cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length, cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    surface.rings = [ring.map(([x, z]) => { const d = Math.hypot(x - cx, z - cz) || 1; return [x + (x - cx) / d * .03, z + (z - cz) / d * .03]; })];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of surface.rings[0]) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    index.insertBox(surface, x0, z0, x1, z1);
  }
  const surfaceHeightAt = (x, z, maxY = Infinity) => {
    let height = -Infinity;
    for (const surface of index.query(x, z)) if (surface.y <= maxY && surface.y > height && pointInPolygon(x, z, surface.rings)) height = surface.y;
    return height;
  };
  // a mata não invade pisos (o zigue-zague traz um lance para perto do recuo lateral de outro)
  const onFloor = (x, z) => [[0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]].some(([dx, dz]) => Number.isFinite(surfaceHeightAt(x + dx, z + dz)));
  for (let i = trees.length - 1; i >= 0; i--) if (!trees[i].fixed && onFloor(trees[i].x, trees[i].z)) trees.splice(i, 1);
  const stats = { ...root.userData.stats, stairways: plan.stairways.length, risers: plan.stairways.reduce((sum, S) => sum + S.risers, 0), locomotive: !!C.locomotive, alley: !!C.alley?.stair, surfaces: surfaces.length, solids: solids.length, groveTrees: trees.length };
  root.userData.landmarks = stats;
  return { root, plan, stats, solids, surfaces, exclusions, entrances, trees, surfaceHeightAt };
}
