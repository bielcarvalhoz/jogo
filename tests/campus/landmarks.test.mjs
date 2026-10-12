import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProjection, openRing, pointInPolygon, ringArea, distToSegment } from '../../src/shared/geo.js';
import { createTerrain } from '../../src/map/terrain.js';
import { parseWorld } from '../../src/map/world.js';
import { correctCampusTerrain, gradeCampusTerrain } from '../../src/campus/grading.js';
import { planCampusAmenities } from '../../src/campus/amenities.js';
import { prepareLandmarks, gradeLandmarks, buildLandmarks } from '../../src/campus/landmarks.js';
import { planStairway, resolveStairway, stairwaySamples } from '../../src/campus/stairway.js';
import { prepareAlley, planAlleyStair, nearestStreet } from '../../src/campus/prata-access.js';
import { planLocomotive, yawFromBearing, TRACK } from '../../src/campus/locomotive.js';

const data = (name) => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url)));
const area = (ring) => Math.abs(ringArea(ring));

/** Os marcos sobre os dados reais (relevo SRTM, vias do OSM, planta do campus), sem renderização. */
let cached;
function actualLandmarks() {
  if (cached) return cached;
  const geo = data('cidade-de-deus.geojson'), campusGeo = data('campus-cidade-de-deus.geojson');
  const q = geo.features.find((f) => f.properties.place === 'quarter').geometry.coordinates[0];
  const proj = createProjection((Math.min(...q.map((p) => p[0])) + Math.max(...q.map((p) => p[0]))) / 2, (Math.min(...q.map((p) => p[1])) + Math.max(...q.map((p) => p[1]))) / 2);
  const terrain = createTerrain(data('terrain.json'), proj), world = parseWorld(geo, proj);
  for (const road of world.roads) { const middle = road.pts[Math.floor(road.pts.length / 2)]; road.internal = road.kind !== 'foot' && road.highway === 'service' && pointInPolygon(...middle, world.quarter); }
  const C = { quarter: world.quarter, buildings: [], gates: [], landmarks: [], paths: [], busStops: [] };
  for (const f of campusGeo.features) {
    const p = f.properties, g = f.geometry;
    if (p.kind === 'building') C.buildings.push({ ...p, rings: g.coordinates.map((ring) => openRing(ring.map((c) => proj.toLocal(...c)))) });
    else if (p.kind === 'gate') { const [x, z] = proj.toLocal(...g.coordinates); C.gates.push({ ...p, x, z }); }
    else if (p.kind === 'landmark') { const [x, z] = proj.toLocal(...g.coordinates); C.landmarks.push({ ...p, x, z }); }
    else if (p.kind === 'plateau') (C.plateaus ||= []).push({ ...p, rings: g.coordinates.map((ring) => openRing(ring.map((c) => proj.toLocal(...c)))) });
    else if (p.kind === 'groundControl') C.groundControl = g.coordinates.map(([lon, lat, altitude]) => [...proj.toLocal(lon, lat), altitude + (p.offset || 0)]);
    else if (g.type === 'LineString') C.paths.push({ ...p, pts: g.coordinates.map((c) => proj.toLocal(...c)) });
  }
  C.insideSolid = (x, z) => C.buildings.some((b) => pointInPolygon(x, z, b.rings));
  const original = { balanca: C.buildings.find((b) => b.planId === 'b8').rings[0], prataLevels: C.buildings.find((b) => b.planId === 'b6').levels };
  prepareLandmarks(C, world);
  const control = correctCampusTerrain(terrain, C);
  gradeCampusTerrain(world, terrain, C);
  const report = gradeLandmarks(world, terrain, C), built = buildLandmarks(C, { terrain, world });
  return (cached = { C, world, terrain, proj, report, built, original, control });
}

/** anda de `from` a `to` com a regra do personagem (degrau máximo de 0,7 m) e devolve o maior salto */
function walk({ terrain, built }, points) {
  const groundAt = (x, z, y) => Math.max(terrain.heightAt(x, z), built.surfaceHeightAt(x, z, y + .7));
  let [x, z] = points[0], y = groundAt(x, z, terrain.heightAt(x, z) + 1.5), jump = 0;
  const start = y;
  for (const [tx, tz] of points.slice(1)) for (;;) {
    const d = Math.hypot(tx - x, tz - z);
    if (d < .05) break;
    const step = Math.min(.1, d); x += (tx - x) / d * step; z += (tz - z) / d * step;
    const g = groundAt(x, z, y); jump = Math.max(jump, Math.abs(g - y)); y = g;
  }
  return { start, end: y, jump };
}

test('profile grading clears a narrow stair without touching protected ground or distant terrain', () => {
  const proj = { toLocal: (x, y) => [x, 100 - y] };
  const terrain = createTerrain({ nx: 21, ny: 21, min: 0, max: 30, bbox: [0, 0, 100, 100], heights: Array.from({ length: 441 }, (_, k) => 20 + (k % 21) * .4) }, proj);
  const far = terrain.heightAt(8, 90), kept = terrain.heightAt(60, 50), samples = [];
  for (let x = 30; x <= 70; x += .3) for (let z = 48.5; z <= 51.5; z += .5) samples.push([x, z, 24 - (x - 30) * .25]);
  const report = terrain.gradeProfile(samples, { radius: 3, band: 8, clearance: .35, minClearance: .1, protect: (x, z) => Math.hypot(x - 60, z - 50) < .1 });
  assert.ok(report.changed > 0 && report.cutFill > 3);
  let pinned = 0;
  for (const [x, z, y] of samples) {
    // os triângulos presos ao vértice protegido (células vizinhas, de 5 m) não descem por inteiro
    if (Math.abs(x - 60) <= 5 && Math.abs(z - 50) <= 5) { pinned++; continue; }
    assert.ok(terrain.heightAt(x, z) <= y - .1 + 1e-6, `relevo acima do degrau em ${x.toFixed(1)},${z.toFixed(1)}`);
  }
  assert.ok(pinned > 0 && pinned < samples.length / 3);
  assert.equal(terrain.heightAt(60, 50), kept, 'vértice protegido intacto');
  assert.equal(terrain.heightAt(8, 90), far, 'relevo distante intacto');
});

test('stairway plan: flights, corner landings and the round bench plaza stay connected', () => {
  const plan = planStairway([[0, 0], [12, 4], [18, 0], [28, 1], [36, -3], [38, 4], [48, 9]], { width: 3, rampWidth: 2.2, plaza: 3, plazaRadius: 2.7, ramps: 1 });
  assert.equal(plan.flights.length, 5);
  assert.equal(plan.ramps.length, 1);
  assert.deepEqual(plan.landings.map((l) => l.kind), ['top', 'corner', 'corner', 'plaza', 'corner', 'corner']);
  assert.equal(plan.risers, plan.flights.reduce((sum, f) => sum + f.k, 0));
  for (const f of plan.flights) assert.ok(f.tread >= .255 && f.tread <= .3, `piso de ${f.tread.toFixed(3)} m`);
  plan.landings.forEach((landing, i) => {
    if (i) assert.equal(landing.level, plan.flights.slice(0, i).reduce((sum, f) => sum + f.k, 0));
    assert.ok(pointInPolygon(...landing.node, [landing.ring]) || landing.ring.some((p) => Math.hypot(p[0] - landing.node[0], p[1] - landing.node[1]) < .5));
  });
  // os dois arcos de banco ficam em lados opostos e deixam livres a chegada e a saída
  const plaza = plan.landings[3], [inA, outB] = plaza.open, mid = (seg) => [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2];
  for (const arc of plaza.arcs) {
    assert.ok(Math.abs(arc.sweep) > .5 && Math.abs(arc.sweep) < Math.PI);
    for (const p of arc.points.slice(1, -1)) for (const gap of [inA, outB]) assert.ok(Math.hypot(p[0] - mid(gap)[0], p[1] - mid(gap)[1]) > 1.2, 'banco na frente de um lance');
  }
  assert.ok(plaza.arcs[0].sweep * plaza.arcs[1].sweep < 0, 'arcos em sentidos opostos');
  const S = resolveStairway(plan, { topY: 50, riser: .17, endY: 33 });
  assert.ok(Math.abs(S.bottomY - (50 - plan.risers * .17)) < 1e-9);
  assert.ok(Math.abs(S.ramps.at(-1).yb - 33) < 1e-9);
  assert.ok(stairwaySamples(S).every(([x, z, y]) => Number.isFinite(x + z + y)));
});

test('forest stairway follows the official plan from Rua Três down to the Agência and is walkable both ways', () => {
  const L = actualLandmarks(), S = L.built.plan.stairways[0], agencia = L.C.buildings.find((b) => b.planId === 'b34');
  assert.equal(L.built.plan.stairways.length, 1);
  assert.equal(S.flights.length, 5);
  assert.ok(S.risers >= 105 && S.risers <= 125, `${S.risers} espelhos`);
  assert.ok(S.riser >= .15 && S.riser <= .185);
  for (const f of S.flights) assert.ok(f.tread >= .25 && f.tread <= .32, `piso de ${f.tread.toFixed(3)} m`);
  assert.ok(S.topY - S.bottomY > 19 && S.topY - S.bottomY < 23, `desnível do barranco: ${(S.topY - S.bottomY).toFixed(1)} m`);
  assert.equal(nearestStreet(L.world.roads, ...S.path[0], 14).road.name, 'Rua Três');
  const foot = S.flights.at(-1).b;
  assert.ok(Math.min(...agencia.rings[0].map((p, i, ring) => distToSegment(...foot, ...p, ...ring[(i + 1) % ring.length]).d)) < 15, 'pé da escada junto à Agência');
  assert.equal(S.landings.filter((landing) => landing.kind === 'plaza').length, 1);
  assert.equal(L.report.stairways[0].blocked, 0);
  // começa 30 cm dentro do patamar do topo (o ponto `a` do lance é a própria quina do 1º degrau)
  const first = S.flights[0], inside = [first.a[0] - first.d[0] * .3, first.a[1] - first.d[1] * .3];
  const route = [inside, ...S.flights.flatMap((f) => [f.a, f.b]), ...S.ramps.flatMap((r) => [r.a, r.b])];
  const down = walk(L, route), up = walk(L, route.slice().reverse());
  assert.ok(down.jump <= .19 && up.jump <= .19, `salto de ${Math.max(down.jump, up.jump).toFixed(2)} m`);
  assert.ok(Math.abs(down.start - S.topY) < .01 && Math.abs(up.end - S.topY) < .01, `topo: desce de ${down.start.toFixed(2)}, sobe até ${up.end.toFixed(2)}, patamar ${S.topY.toFixed(2)}`);
  assert.ok(Math.abs(down.end - S.endY) < .15);
  // guarda-corpos contínuos: nenhum ponto da lateral de um lance fica sem colisão
  for (const f of S.flights) for (const side of [-1, 1]) for (let s = .3; s < f.run - .3; s += .5) {
    const x = f.a[0] + f.d[0] * s - f.d[1] * side * (f.w / 2 + .1), z = f.a[1] + f.d[1] * s + f.d[0] * side * (f.w / 2 + .1);
    assert.ok(L.built.solids.some((solid) => pointInPolygon(x, z, solid.rings)), 'vão no guarda-corpo');
  }
});

test('every landmark floor is above the graded terrain and clear of trees', () => {
  const { terrain, built } = actualLandmarks();
  for (const surface of built.surfaces) {
    const ring = surface.rings[0], cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    assert.ok(terrain.heightAt(cx, cz) <= surface.y + .03, `relevo ${(terrain.heightAt(cx, cz) - surface.y).toFixed(2)} m acima de um piso em ${cx.toFixed(1)}, ${cz.toFixed(1)}`);
  }
  assert.ok(built.trees.length >= 30, 'mata em volta da escadaria');
  for (const tree of built.trees) {
    if (!tree.fixed) assert.ok(!built.surfaces.some((surface) => pointInPolygon(tree.x, tree.z, surface.rings)));   // (fixas: árvore plantada num canteiro próprio)
    assert.ok(Number.isFinite(tree.x + tree.z + tree.s));
  }
  // Uma malha por piso texturizado/pintura (asfalto, calçada, tinta, vidro, marquise) e uma por
  // placa. Hoje: 9 de piso/material + 13 placas — locomotiva (4), placas da história (2), as duas
  // testeiras de portaria, o atlas de texto de pista e a marca do totem da Wenceslau, o símbolo das
  // vagas, os degraus coloridos e o totem do Prata.
  assert.ok(built.stats.triangles > 5000 && built.stats.meshes <= 22);
});

test('alley cut separates a retaining block from the building end and its stair fits the gap', () => {
  const ring = [[0, 0], [40, 0], [40, 10], [0, 10]];
  const C = { buildings: [{ planId: 'x', name: 'X', rings: [ring] }, { planId: 'y', rings: [[[10, 30], [30, 30], [30, 40], [10, 40]]] }] };
  const alley = prepareAlley(C, { building: 'x', toward: 'y', end: 'leste', offset: 5, width: 2.6 });
  assert.equal(C.buildings.length, 2, 'o bloco de arrimo não vira prédio');
  assert.ok(Math.abs(area(C.buildings[0].rings[0]) + area(alley.block) - (400 - 26)) < 1e-6);
  assert.ok(Math.abs(alley.nz - 1) < 1e-9, 'beco aponta para o prédio de referência');
  assert.ok(Math.abs(alley.at(alley.uA, 0)[0] - 35) < 1e-9, 'vão a 5 m da ponta leste');
  for (const rise of [2.4, 4.5, 6.2]) {
    const stair = planAlleyStair({ ...alley, v0: -9, v1: 6 }, 10, 10 + rise, 4);
    assert.ok(stair.riser <= .18 && stair.tread >= .24);
    assert.equal(stair.flights.reduce((sum, run) => sum + run.k, 0), stair.K);
    assert.ok(stair.sBottom >= -9 && stair.sTop <= 6);
    let last = 10;
    for (let s = -9; s <= 6; s += .05) { const y = stair.yAt(s); assert.ok(y >= last - 1e-9 && y - last <= stair.riser + 1e-9); last = y; }
    assert.ok(Math.abs(stair.yAt(6) - (10 + rise)) < 1e-9);
  }
});

test('Balança sits at parking level with the alley stair up to the Prata street; Prata gains its buried floors', () => {
  const L = actualLandmarks(), { C, terrain, built, original } = L, A = C.alley, notes = built.plan.access;
  const balanca = C.buildings.find((b) => b.planId === 'b8'), prata = C.buildings.find((b) => b.planId === 'b6');
  assert.ok(area(balanca.rings[0]) + area(A.block) < area(original.balanca) && area(A.block) > 2);   // (bloco = parede fina a leste da escada)
  assert.ok(A.at(A.uA, 0)[0] > balanca.rings[0].reduce((s, p) => s + p[0], 0) / balanca.rings[0].length + 30, 'beco na ponta leste, não no meio');
  assert.ok(notes.alley.topY - notes.alley.bottomY > 6 && notes.alley.topY - notes.alley.bottomY < 9 && notes.alley.riser <= .18, 'beco: ~7 m (dois andares)');
  assert.ok(notes.alley.flights.length >= 2, 'lances com patamar');
  // a laje do Balança fica rente à rua do Prata (prédio semienterrado)
  const roof = terrain.platformFor(balanca).height + balanca.height;
  assert.ok(Math.abs(roof - notes.alley.topY) < .15, `laje ${(roof - notes.alley.topY).toFixed(2)} m acima da rua`);
  assert.ok(notes.deck.strip > 20 && notes.deck.drive, 'laje-estacionamento ligada à rua, com entrada de veículos');
  // (sem a malha das calçadas neste teste: o percurso para 1,2 m antes do meio-fio da rua)
  const [low, high] = notes.alley.path, span = Math.hypot(high[0] - low[0], high[1] - low[1]), inside = [high[0] - (high[0] - low[0]) / span * 1.2, high[1] - (high[1] - low[1]) / span * 1.2];
  const climb = walk(L, [low, inside]), descend = walk(L, [inside, low]);
  // (na descida, sem as superfícies das vias deste teste, o pé da escada cai da soleira para o relevo do pátio: até 70 cm; no jogo são 17 cm)
  assert.ok(climb.jump <= .19 && descend.jump <= .7, `beco: saltos de ${climb.jump.toFixed(2)} e ${descend.jump.toFixed(2)} m`);
  assert.ok(Math.abs(climb.end - notes.alley.topY) < .05 && Math.abs(descend.end - climb.start) < .05);
  // Prata: andar zero pela rua de trás; a rua do Balança fica andares abaixo (acesso do -2). O
  // desnível entre as duas ruas vem do controle altimétrico (rua norte 741 m, rua sul 747 m).
  assert.ok(prata.levels >= original.prataLevels + 2);
  assert.ok(prata.floorZero - notes.lower.top > 4 && prata.floorZero - notes.lower.top < 8, `-2 a ${(prata.floorZero - notes.lower.top).toFixed(1)} m do andar zero`);
  assert.ok(Math.abs(notes.ground0.doorY - prata.floorZero) < .3, 'porta dos fundos no piso do andar zero');
  assert.ok(Math.abs(notes.ground0.stairTop - notes.ground0.baseY - 1.65) < 1e-9, 'escada colorida: 10 espelhos de 16,5 cm');
  for (const [name, path, top] of [['-2', notes.lower.path, notes.lower.top], ['escada colorida', notes.ground0.path, notes.ground0.stairTop], ['principal', notes.main.path, notes.main.top]]) {
    const result = walk(L, path);
    assert.ok(result.jump <= .24, `${name}: salto de ${result.jump.toFixed(2)} m`);
    assert.ok(Math.abs(result.end - top) < .05, `${name}: não chega à porta`);
  }
  assert.deepEqual(built.entrances.map((entrance) => entrance.name).sort(), ['Prédio Balança', 'Prédio Prata']);
  assert.ok(built.entrances.every((e) => Number.isFinite(e.x + e.z + e.yaw + e.frontage.clearance)));
});

test('locomotive 801 uses the surveyed spot beside the CTI, heading ESE, clear of roads and buildings', () => {
  const { C, world, built } = actualLandmarks(), loco = built.plan.locomotive, cti = C.buildings.find((b) => b.planId === 'b0');
  const mark = C.landmarks.find((m) => m.type === 'locomotiva');
  assert.ok(Math.abs(Math.cos(yawFromBearing(113)) - Math.sin(113 * Math.PI / 180)) < 1e-12);
  assert.ok(Math.abs(-Math.sin(yawFromBearing(113)) + Math.cos(113 * Math.PI / 180)) < 1e-12);
  const front = [Math.cos(loco.yaw), -Math.sin(loco.yaw)];
  assert.ok(front[0] > .85 && front[1] > .3, 'frente para ESE (leste e um pouco ao sul)');
  assert.ok(Math.hypot(loco.x - mark.x, loco.z - mark.z) <= 9.01, 'no máximo recuada ao longo do próprio trilho');
  assert.ok(Math.abs((loco.x - mark.x) * front[1] - (loco.z - mark.z) * front[0]) < 1e-6, 'recuo só no eixo do trilho');
  assert.ok(TRACK[1] - TRACK[0] > 24 && TRACK[1] - TRACK[0] < 28);
  for (const [x, z] of [...loco.bed, ...loco.body]) {
    assert.ok(!C.insideSolid(x, z));
    const street = nearestStreet(world.roads, x, z, 30);
    assert.ok(!street || street.d - street.road.w / 2 >= 2.5, 'leito fora das calçadas');
  }
  assert.ok(Math.min(...cti.rings[0].map((p) => Math.hypot(p[0] - loco.x, p[1] - loco.z))) < 45, 'ao lado do CTI');
  assert.ok(built.solids.some((solid) => solid.kind === 'locomotiva-801'));
  assert.equal(planCampusAmenities(C, world).train, null, 'sem uma segunda locomotiva aproximada');
  const moved = planLocomotive({ x: 10, z: 20, heading: 90 });
  assert.ok(Math.abs(moved.bed[1][0] - moved.bed[0][0] - (TRACK[1] - TRACK[0] + 1)) < 1e-9, 'rumo 90° = eixo leste');
});

test('surveyed ground control: the field, Portaria 10 and the lake share one level; the Balança lot is flat', () => {
  const L = actualLandmarks(), { C, terrain, world, proj } = L, campusGeo = data('campus-cidade-de-deus.geojson');
  // o relevo corrigido reproduz as altitudes levantadas (antes de qualquer terraplenagem)
  const fresh = createTerrain(data('terrain.json'), proj), report = correctCampusTerrain(fresh, C);
  assert.ok(report.points > 100 && report.maxShift > 15, 'o SRTM chegava a ficar mais de 15 m acima do chão');
  const residuals = C.groundControl.map(([x, z, altitude]) => Math.abs(fresh.heightAt(x, z) + fresh.base - altitude));
  assert.ok(Math.max(...residuals) < 1.5 && residuals.reduce((a, b) => a + b, 0) / residuals.length < .4, `resíduo máximo ${Math.max(...residuals).toFixed(2)} m`);
  // campo de futebol, Portaria Bussocaba (10) e lago na mesma baixada
  const pitch = world.areas.filter((a) => a.kind === 'pitch').sort((a, b) => area(b.rings[0]) - area(a.rings[0]))[0].rings[0];
  const centre = pitch.reduce((s, p) => [s[0] + p[0] / pitch.length, s[1] + p[1] / pitch.length], [0, 0]), field = terrain.heightAt(...centre);
  for (const f of campusGeo.features.filter((q) => q.properties.kind === 'gate' && q.properties.num === 10)) {
    const gate = terrain.heightAt(...proj.toLocal(...f.geometry.coordinates));
    assert.ok(Math.abs(gate - field) < 2.5, `Portaria 10 ${(gate - field).toFixed(1)} m acima do campo`);   // levantado: campo 732 m, portaria 730–731 m
  }
  const lake = campusGeo.features.find((q) => q.properties.kind === 'leisure').properties.layout.lago.map(([lat, lon]) => proj.toLocal(lon, lat));
  for (const [x, z] of lake.filter((_, i) => i % 6 === 0)) assert.ok(Math.abs(terrain.heightAt(x, z) - field) < 2.5, 'margem do lago no nível do campo');
  // estacionamento em frente ao Balança: plano, na base do prédio (sem a "barriga" do relevo de satélite)
  const lot = C.plateaus.find((p) => p.id === 'estacionamento-balanca'), balanca = C.buildings.find((b) => b.planId === 'b8'), level = lot.altitude - terrain.base;
  let xs = lot.rings[0].map((p) => p[0]), zs = lot.rings[0].map((p) => p[1]), samples = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 4) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 4) {
    // miolo do platô: a borda (uma célula do relevo, ~8,5 m) é a transição para as rampas e taludes vizinhos
    const edge = (ring, d) => ring.some((p, i) => distToSegment(x, z, ...p, ...ring[(i + 1) % ring.length]).d < d);
    if (!pointInPolygon(x, z, lot.rings) || edge(lot.rings[0], 9) || edge(balanca.rings[0], 10)) continue;
    if (C.pedestrianGate && Math.hypot(x - C.pedestrianGate.frame.x, z - C.pedestrianGate.frame.z) < 34) continue;   // (saguão rebaixado da portaria de pedestres)
    assert.ok(Math.abs(terrain.heightAt(x, z) - level) < .2, `estacionamento com ${(terrain.heightAt(x, z) - level).toFixed(2)} m de desnível em ${x.toFixed(0)}, ${z.toFixed(0)}`); samples++;
  }
  assert.ok(samples > 80, `${samples} amostras`);
  assert.ok(Math.abs(terrain.platformFor(balanca).height - level) < .05, 'o térreo do Balança fica no nível do estacionamento');
  for (const road of world.roads.filter((r) => r.internal)) for (const [x, z] of road.pts) if (pointInPolygon(x, z, lot.rings)) assert.ok(Math.abs(terrain.roadHeightAt(road, x, z) - level) < 1e-6, 'vias do estacionamento no mesmo nível');
});

test('Portaria Bussocaba is ONE double canopy over both carriageways, inside the campus', () => {
  const { C, world, built } = actualLandmarks(), P = built.plan.portaria;
  assert.ok(P && P.half * 2 >= 24, 'cobertura única');
  assert.ok(C.gates.filter((g) => g.num === 10 && g.type === 'portaria').every((g) => g.combined), 'os cruzamentos de muro não ganham marquise própria');
  // as duas pistas internas passam sob a mesma cobertura
  const under = world.roads.filter((r) => r.internal && r.pts.some((p, i) => i && [0, .25, .5, .75, 1].some((t) => pointInPolygon(r.pts[i - 1][0] + (p[0] - r.pts[i - 1][0]) * t, r.pts[i - 1][1] + (p[1] - r.pts[i - 1][1]) * t, [P.ring]))));
  assert.ok(under.length >= 2, `${under.length} pista(s) sob a cobertura`);
  for (const p of P.ring) assert.ok(pointInPolygon(...p, C.quarter), 'cobertura para fora do campus');
  // nenhum pilar ou guarita no leito das pistas
  // as duas pistas atravessam a cobertura em ângulo reto, a entrada sob a laje sudoeste
  assert.equal(P.lanes.length, 2);
  for (const lane of P.lanes) assert.ok(lane.tx * P.inVec[0] + lane.tz * P.inVec[1] > .98, 'pista enviesada sob a cobertura');
  const [entry, exit] = [...P.lanes].sort((a, b) => a.s - b.s);
  assert.ok(!entry.exit && exit.exit && entry.s < P.length / 2 && exit.s > P.length / 2);
  // a frente é um pátio aberto para a rua: região fora do muro, com a ilha da árvore dentro dela
  const cutout = C.wallCutouts.find((ring) => pointInPolygon(...P.at(P.ilha[0], P.ilha[1]), [ring]));
  assert.ok(cutout, 'pátio da frente fora do muro');
  assert.ok(pointInPolygon(...P.at(entry.s, -8), [cutout]) && pointInPolygon(...P.at(exit.s, -8), [cutout]));
  assert.ok(!C.wallCutouts.some((ring) => pointInPolygon(...P.at(P.length / 2, 3), [ring])), 'o lado de dentro continua murado');
  const near = (p) => Math.hypot(p[0] - P.frame.x, p[1] - P.frame.z) < 60;
  assert.equal(C.wallOpenings.filter((o) => near(o.a)).length, 2, 'dois vãos do muro sob a cobertura');
  assert.equal(C.sealLines.filter((line) => near(line[0])).length, 1, 'a portaria fecha o perímetro');
  // duas entradas de pedestres: ao lado da recepção (ponta sudoeste) e ao lado da Agência (ponta nordeste)
  assert.equal(P.pedestrians.length, 2);
  assert.ok(P.pedestrians[0].s > P.recepcao[1] && P.pedestrians[0].s < entry.span[0] && P.pedestrians[1].s > exit.span[1]);
  // "rua bem larga": asfalto contínuo da cobertura até a rua interna, sem calçada no meio
  assert.ok(P.plaza.length > 20 && P.plaza.every(([, v]) => v > P.depth / 2 + 5), 'pátio de dentro até a rua interna');
  assert.ok(world.sidewalkVoids.some((ring) => pointInPolygon(...P.at(P.length / 2, P.depth / 2 + 6), [ring])), 'sem calçada dentro do pátio');
  assert.ok(exit.gateWidth > 12 && entry.gateWidth < 6, 'saída com duas faixas, entrada com uma');
  // a ilha e a guarita não invadem as pistas
  for (const lane of P.lanes) { assert.ok(Math.abs(lane.s - P.ilha[0]) > 0); const [ix, iz] = P.at(P.ilha[0], P.ilha[1]), street = nearestStreet([lane.road], ix, iz, 40); assert.ok(street.d - lane.width / 2 > P.ilha[2] + .3, 'ilha da árvore sobre a pista'); }
  for (const s of built.solids.filter((q) => /portaria|guarita/.test(q.kind))) for (const p of s.rings[0]) { const street = nearestStreet(world.roads, ...p, 20); assert.ok(!street || street.d - street.road.w / 2 > .2, `${s.kind} no leito da via`); }
  assert.ok(built.solids.filter((q) => q.kind === 'pilar-portaria').length >= 3);
});

test('Portaria Wenceslau Brás is ONE slab over a single wide carriageway, reception at the west end', () => {
  const L = actualLandmarks(), { C, world, terrain, built } = L;
  const P = built.plan.portarias.find((q) => q.id === 'wenceslau');
  assert.ok(P, 'portaria Wenceslau levantada');
  assert.ok(C.gates.filter((g) => g.num === 8 && g.type === 'portaria').every((g) => g.combined), 'o cruzamento de muro não ganha marquise própria');
  for (const p of P.ring) assert.ok(pointInPolygon(...p, C.quarter), 'cobertura para fora do campus');
  // uma pista só: os dois sentidos passam lado a lado, em ângulo reto com a cobertura
  assert.equal(P.lanes.length, 1);
  const [lane] = P.lanes;
  assert.ok(lane.tx * P.inVec[0] + lane.tz * P.inVec[1] > .98, 'pista enviesada sob a cobertura');
  assert.ok(lane.s > P.pistas[0][0] && lane.s < P.pistas[1][1], 'eixo da pista fora da boca');
  // da ponta oeste: recepção, passagem de pedestres com catraca e a boca dos carros
  assert.ok(P.recepcao[1] < P.pedestres[0].s && P.pedestres[0].s < P.pistas[0][0], 'ordem recepção -> pedestres -> boca');
  assert.equal(P.pedestrians.length, 1);
  // TRÊS faixas, uma cancela em cada: de oeste para leste a saída e as duas entradas, todas na
  // boca, sob a laje e dentro da faixa de rolamento
  assert.equal(lane.cancelas.length, 3);
  const bars = lane.cancelas.map((bar) => ({ ...bar, s: P.local(bar.x, bar.z)[0], v: P.local(bar.x, bar.z)[1], end: P.local(bar.x + bar.hx * bar.len, bar.z + bar.hz * bar.len) }))
    .sort((a, b) => a.s - b.s);
  for (const bar of bars) {
    assert.ok(Math.abs(bar.v) < P.depth / 2 && Math.abs(bar.end[1] - bar.v) < .2, 'cancela fora da laje ou enviesada');
    for (const q of [bar.s, bar.end[0]]) assert.ok(q > P.pistas[0][0] - .2 && q < P.pistas[1][1] + .2, `cancela em s = ${q.toFixed(1)}`);
  }
  assert.deepEqual(bars.map((bar) => bar.exit), [true, false, false], 'saída a oeste, duas entradas a leste');
  // divisórias: cones entre a saída e a primeira entrada, portão branco entre as duas entradas
  const divisor = (a, b) => (a.end[0] + b.s) / 2;
  const cones = P.cones[0][0][0], portao = P.portoes.find(([, , , , eixo]) => eixo === 'v')[0];
  assert.ok(Math.abs(cones - divisor(bars[0], bars[1])) < 1, 'cones fora da divisória saída/entrada');
  assert.ok(Math.abs(portao - divisor(bars[1], bars[2])) < 1, 'portão fora da divisória entre as entradas');
  // vigilante de plantão na divisória entre as duas entradas (peça fixa, com colisão)
  const vigia = built.solids.find((q) => q.kind === 'vigilante-portaria');
  assert.ok(vigia, 'sem o vigilante na boca');
  const vs = vigia.rings[0].map((p) => P.local(...p)[0]), vmid = (Math.min(...vs) + Math.max(...vs)) / 2;
  assert.ok(vmid > bars[1].end[0] && vmid < bars[2].s, `vigilante em s = ${vmid.toFixed(1)}, fora da divisória entre as entradas`);
  // o totem fica de lado, paralelo à pista: quem sobe a rua vê a marca de frente
  assert.ok(Math.abs(Math.abs(P.totem[4]) - 90) < 1, 'totem fora de esquadro com a rua');
  // o caminho de pedestres não é cortado por portão, cerca ou guarda-corpo
  const ped = P.pedestrians[0].s;
  for (const solid of built.solids.filter((q) => /portao|cerca|arrimo/.test(q.kind)))
    for (const p of solid.rings[0]) { const [ss, vv] = P.local(...p); assert.ok(Math.abs(ss - ped) > 1.3 || vv > 1 || vv < -13, `${solid.kind} atravessa a passagem de pedestres em (${ss.toFixed(1)}, ${vv.toFixed(1)})`); }
  for (const linha of P.gradil) for (let i = 1; i < linha.length; i++) assert.ok(Math.abs(linha[i][1] - linha[i - 1][1]) > Math.abs(linha[i][0] - linha[i - 1][0]) - 2.2, 'guarda-corpo atravessado no caminho de pedestres');
  // um vão de muro só (os dois sentidos passam juntos) e o pátio da frente fora da região murada
  const near = (p) => Math.hypot(p[0] - P.frame.x, p[1] - P.frame.z) < 60;
  assert.equal(C.wallOpenings.filter((o) => near(o.a)).length, 1, 'um vão do muro sob a cobertura');
  const cutout = C.wallCutouts.find((ring) => pointInPolygon(...P.at(lane.s, -9), [ring]));
  assert.ok(cutout && !pointInPolygon(...P.at(P.length / 2, 4), [cutout]), 'frente aberta para a rua, fundos murados');
  // nada construído no leito de uma FAIXA: colunas, portão e cabine ficam nas divisórias entre elas
  const spans = bars.map((bar) => [Math.min(bar.s, bar.end[0]), Math.max(bar.s, bar.end[0])]);
  for (const solid of built.solids.filter((q) => /portaria|cabine/.test(q.kind))) {
    const local = solid.rings[0].map((p) => P.local(...p));
    if (!local.some(([, v]) => v > -9 && v < 9)) continue;   // (totem, arrimo e cerca ficam longe da boca)
    const s0 = Math.min(...local.map((q) => q[0])), s1 = Math.max(...local.map((q) => q[0]));
    for (const [a, b] of spans) assert.ok(s1 <= a + .05 || s0 >= b - .05, `${solid.kind} no leito de uma faixa (s ${s0.toFixed(1)}..${s1.toFixed(1)} contra ${a.toFixed(1)}..${b.toFixed(1)})`);
  }
  // pátio de asfalto da cobertura até o leito da via interna do estacionamento, sem calçada no meio
  assert.ok(P.plaza.length > 15 && P.plaza.every(([, v]) => v > P.depth / 2), 'pátio de dentro até a via interna');
  assert.ok(world.sidewalkVoids.some((ring) => pointInPolygon(...P.at(P.length / 2, P.depth / 2 + 4), [ring])), 'sem calçada dentro do pátio');
  // platô: cobertura, boca e pátio num nível só (o SRTM deixava 1,9 m de rampa ao longo da laje)
  const level = terrain.heightAt(P.frame.x, P.frame.z);
  for (const [s, v] of [[0, 0], [27, 0], [13.5, -5.5], [13.5, 5.5], [18.5, -9], [18.5, 14]])
    assert.ok(Math.abs(terrain.heightAt(...P.at(s, v)) - level) < .05, `desnível de ${(terrain.heightAt(...P.at(s, v)) - level).toFixed(2)} m em (${s}, ${v})`);
  // a faixa de pedestres da boca cobre a boca inteira e fica no meio-fio da rua
  const kerb = (s) => { const t = P.frente; if (s <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (s <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (s - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t.at(-1)[1]; };
  const [faixa] = P.faixasBoca;
  assert.ok(faixa[0] < P.pistas[0][0] && faixa[1] > P.pistas[1][1], 'faixa de pedestres mais curta que a boca');
  // percurso a pé da calçada da rua até a passagem de pedestres, sem degrau alto
  const walk8 = walk(L, [P.at(-2.6, kerb(-2.6) + 1.4), P.at(2, -10.2), P.at(7.9, -8), P.at(8.9, -2), P.at(8.9, 4)]);
  assert.ok(walk8.jump <= .45, `degrau de ${walk8.jump.toFixed(2)} m no acesso de pedestres`);
});

test('Portaria Bussocaba: one level, straight wall, crossings from kerb to kerb and no sidewalk ending in nothing', () => {
  const L = actualLandmarks(), { C, world, terrain, built } = L, P = built.plan.portaria, D = P.depth;
  const at = (table, s) => { if (s <= table[0][0]) return table[0][1]; for (let i = 1; i < table.length; i++) if (s <= table[i][0]) return table[i - 1][1] + (table[i][1] - table[i - 1][1]) * (s - table[i - 1][0]) / (table[i][0] - table[i - 1][0]); return table.at(-1)[1]; };
  const kerb = (s) => at(P.frente, s), [entry, exit] = [...P.lanes].sort((a, b) => a.s - b.s);
  const inner = world.roads.find((r) => !r.hidden && r.pts.some((p) => Math.hypot(p[0] - entry.road.pts.at(-1)[0], p[1] - entry.road.pts.at(-1)[1]) < .5 || Math.hypot(p[0] - entry.road.pts[0][0], p[1] - entry.road.pts[0][1]) < .5) && r.internal);
  const off = (road, s, v) => nearestStreet([road], ...P.at(s, v), 60).d;
  // terraço num nível só: cobertura, pátio, passagens, calçada rente à Agência, laje e a própria Agência
  const level = terrain.heightAt(P.frame.x, P.frame.z);
  for (const [s, v] of [[10, 12], [25, 15], [20, 22], [34.5, 0], [36.8, 3], [34.5, 20], [36.8, 21], [-3, 8], [28, 30], [33, 33]]) assert.ok(Math.abs(terrain.heightAt(...P.at(s, v)) - level) < .04, `desnível de ${(terrain.heightAt(...P.at(s, v)) - level).toFixed(2)} m em (${s}, ${v})`);
  assert.ok(Math.abs(terrain.platformFor(C.buildings.find((b) => b.planId === 'b34')).height - level) < .04, 'Agência no mesmo terraço');
  for (const [s, v] of [[20, 23.8], [26, 31.5], [31, 37.5]]) assert.ok(Math.abs(terrain.roadHeightAt(inner, ...P.at(s, v)) - level) < .04, 'rua interna no nível do pátio');
  // muro reto: o pátio da frente é um retângulo fora do muro; a cortina do limite do bairro não cruza as bocas
  const cutout = C.wallCutouts.find((ring) => pointInPolygon(...P.at(P.ilha[0], P.ilha[1]), [ring]));
  assert.equal(cutout.length, 4);
  assert.deepEqual(world.boundaryOpenings, C.wallCutouts);
  for (const lane of P.lanes) assert.ok(pointInPolygon(...P.at(lane.s, kerb(lane.s) + 1), [cutout]));
  // asfalto: o pátio da frente entra no leito da rua (para as faixas) e o de dentro no leito da rua interna
  for (const [s, v] of P.frenteRua) assert.ok(kerb(s) - v > 1.5 && kerb(s) - v < 4.5);
  for (const [s, v] of P.plaza) { const d = off(inner, s, v); assert.ok(d < inner.w / 2 && d > inner.w / 2 - .6, `borda do pátio a ${d.toFixed(2)} m do eixo da rua interna`); }
  // sem calçada dentro do pátio: os vãos são convexos (recorte exato em roads.js) e vão da cobertura ao leito
  for (const ring of world.sidewalkVoids) {
    const turns = ring.map((p, i) => { const a = ring[(i + 1) % ring.length], b = ring[(i + 2) % ring.length]; return (a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0]); });
    assert.ok(turns.every((t) => t > -1e-9) || turns.every((t) => t < 1e-9), 'vão não convexo');
  }
  // faixas de pedestres das bocas: do leque até a ilha da árvore e da ilha até a calçada rente à Agência
  const [first, second] = P.faixasBoca, island = P.ilhaContorno, fan = P.leque.fora[P.leque.guia - 1];
  assert.ok(Math.abs(first[0] - fan[0]) < 1 && Math.abs(first[1] - island[0][0]) < 1 && Math.abs(second[0] - island.at(-1)[0]) < 1 && Math.abs(second[1] - P.calcadaRua.esquerda.at(-1)[0]) < 1);
  for (const p of [island[0], island.at(-1), fan, P.calcadaRua.esquerda.at(-1), P.calcadaRua.direita.at(-1), P.leque.fora.at(-1)]) assert.ok(Math.abs(p[1] - kerb(p[0])) < .1, 'ponta fora do meio-fio da rua');
  // ilhas fora das pistas (a da árvore e o nariz da ilha da guarita)
  for (const lane of P.lanes) for (const [s, v] of [...island, ...P.nariz.baixo, ...P.nariz.alto, P.nariz.ponta]) assert.ok(off(lane.road, s, v) - lane.width / 2 > .15, `ilha sobre a pista em (${s}, ${v.toFixed(1)})`);
  // a calçada rente à Agência termina na calçada da rua interna; a faixa de dentro chega ao meio-fio do outro lado
  for (const side of [P.calcadaAgencia.esquerda, P.calcadaAgencia.direita]) { const d = off(inner, ...side.at(-1)); assert.ok(d > inner.w / 2 + .2 && d < inner.w / 2 + 2.5, `fim da calçada a ${d.toFixed(2)} m do eixo`); }
  assert.ok(Math.abs(off(inner, ...P.chegada) - inner.w / 2) < .5 && P.chegada[0] < P.faixaInterna[2] - 6, 'faixa de pedestres até o outro meio-fio');
  assert.equal(inner.sidewalkCrossings.length, 2);
  // percursos a pé pelos pisos (sem a malha das calçadas das vias neste teste): nenhum degrau alto
  const fanWalk = walk(L, [P.at(-2.6, kerb(-2.6) + 1.2), P.at(1, -11), P.at(6.9, -7.5), P.at(6.65, 0), P.at(6.65, 5), P.at(3.4, 7.5), P.at(-2.5, 9)]);
  const agencyWalk = walk(L, [P.at(36.5, kerb(36.5) + 1.5), P.at(35.8, -20), P.at(34.5, -6), P.at(34.5, 6), P.at(34.5, 26)]);
  assert.ok(fanWalk.jump <= .45 && agencyWalk.jump <= .45, `degraus de ${fanWalk.jump.toFixed(2)} e ${agencyWalk.jump.toFixed(2)} m`);
  assert.ok(Math.abs(agencyWalk.end - (level + .41)) < .03 && Math.abs(fanWalk.end - (level + .41)) < .05, 'calçadas no nível das calçadas das vias internas');
  // a passarela da escadaria chega no nível da calçada rente à Agência, sem degrau
  const S = built.plan.stairways[0], tail = S.path.at(-1);
  assert.ok(Math.abs(S.endY - built.surfaceHeightAt(...P.at(36.6, P.local(...tail)[1]))) < .05, 'passarela em degrau com a calçada');
  assert.ok(S.bottomY >= S.endY - .01, 'pé da escada abaixo do fim da passarela');
  // lixeiras da passarela sobre laje própria
  const bins = built.solids.find((q) => q.kind === 'lixeiras');
  assert.ok(bins, 'sem as lixeiras');
  const cx = bins.rings[0].reduce((sum, p) => sum + p[0], 0) / 4, cz = bins.rings[0].reduce((sum, p) => sum + p[1], 0) / 4, floor = built.surfaceHeightAt(cx, cz);
  assert.ok(Number.isFinite(floor) && bins.top - floor > 1 && bins.top - floor < 1.3, 'lixeiras sem piso por baixo');
});

test('pedestrian gate 06: portal, stair up to the turnstiles on the right, exit to the left onto the crossing', () => {
  const L = actualLandmarks(), { C, world, terrain, built } = L, G = built.plan.pedestrianGate, gate = C.gates.find((g) => g.num === 6);
  assert.ok(G && gate.built);   // (sai direto no pátio do estacionamento: não há via interna atrás dela)
  // um lance de escada entre a calçada da rua e o estacionamento
  assert.ok(Math.abs(G.levels.up - G.levels.low - G.espelhos * .17) < 1e-9 && G.espelhos >= 5);
  assert.ok(Math.abs(terrain.heightAt(...G.at(8.2, -2)) - G.levels.low) < .12, 'calçada da rua rente à soleira');
  // a escada sobe para a DIREITA de quem entra (s decrescente) e as catracas ficam no topo, olhando para quem sobe
  assert.ok(G.escada[1] < G.escada[0] && G.escada[0] <= G.portal[0] && G.catracas < G.escada[1]);
  assert.ok(gate.center.tx * G.axis[0] + gate.center.tz * G.axis[1] < -.99 && gate.turnstiles === 3);
  // guarita em frente às catracas; saída para o campus à esquerda (fundos), depois delas
  assert.ok(G.guarita[1] < G.saida[0] + 1 && G.saida[1] < G.catracas - 1.2);
  // nada no leito da via; a calçada da via é recortada na planta da portaria
  for (const q of built.solids.filter((q) => /pedestres|catracas/.test(q.kind))) for (const p of q.rings[0]) { const street = nearestStreet(world.roads, ...p, 20); assert.ok(!street || street.d - street.road.w / 2 > .2, q.kind + ' no leito da via'); }
  // percurso a pé (sem as catracas e as calçadas das vias neste teste)
  const mid = (.1 + G.fundo) / 2, route = walk(L, [G.at(8.2, 0), G.at(8.2, 2), G.at(7, mid), G.at(1, mid), G.at(.8, G.fundo + .3)]);
  assert.ok(route.jump <= .18 && Math.abs(route.end - G.levels.up) < .02 && Math.abs(route.start - G.levels.low) < .02, 'degrau de ' + route.jump.toFixed(2) + ' m');
});

test('Balança lot is one open asphalt yard with the surveyed stalls, and the Balança facade is straight', () => {
  const { C, world, terrain, built } = actualLandmarks(), L = built.plan.lot, inLot = (x, z) => L.rings.some((ring) => pointInPolygon(x, z, [ring]));
  // nenhuma via de carro por dentro do pátio (o OSM traçava corredores como ruas, com calçada)
  for (const road of world.roads.filter((r) => r.kind !== 'foot' && r.highway === 'service' && !r.yard)) for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i];
    for (const t of [.25, .5, .75]) assert.ok(!inLot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), road.id + ' atravessa o pátio');
  }
  assert.ok(L.removedRoads >= 3);
  // ...mas a rua rente ao muro continua inteira, da portaria de pedestres até sair atrás do Balança
  const lane = world.roads.find((r) => r.id === 'way/965541335'), us = lane.pts.map((p) => L.local(...p)[0]);
  assert.ok(lane.yard && Math.min(...us) < -50 && Math.max(...us) > 100, 'rua do muro interrompida');
  // escadinha ao lado da casa de máquinas: sobe do pátio para o chão de cima em degraus normais
  assert.ok(L.escadinha.topY - L.escadinha.baseY > 1 && L.escadinha.risers < 90 && (L.escadinha.topY - L.escadinha.baseY) / L.escadinha.risers <= .19);
  // partes convexas (recorte exato das calçadas) e pátio num nível só
  for (const part of L.partes) { const turns = part.map((p, i) => { const a = part[(i + 1) % part.length], b = part[(i + 2) % part.length]; return (a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0]); }); assert.ok(turns.every((t) => t > 0) || turns.every((t) => t < 0)); }
  const level = terrain.heightAt(...L.at(20, 18));
  for (const [u, v] of [[-20, 8], [0, 36], [60, 12], [80, 30], [100, 20], [85, 0]]) assert.ok(Math.abs(terrain.heightAt(...L.at(u, v)) - level) < .06, 'desnível no pátio em ' + u + ', ' + v);
  // vagas: retas e em diagonal, amarelas e brancas
  const rows = Object.fromEntries(L.fileiras.map((row) => [row.id, row]));
  assert.ok(rows.A.inclina > 3 && !rows.B.inclina && rows.E.inclina > 2 && rows.C.cor === 'branca' && rows.D.simbolo && !rows.B.cor);
  assert.ok(L.fileiras.reduce((sum, row) => sum + row.vagas, 0) > 120);
  // carros dentro do pátio, um por vaga, fora das árvores
  assert.ok(L.cars.length > 25 && L.cars.every((car) => car.ring.every((p) => inLot(...p))));
  for (let i = 0; i < L.cars.length; i++) for (let j = i + 1; j < L.cars.length; j++) assert.ok(Math.hypot(L.cars[i].x - L.cars[j].x, L.cars[i].z - L.cars[j].z) > 2);
  for (const car of L.cars) for (const t of L.treeSpots) assert.ok(Math.hypot(t[0] - car.x, t[1] - car.z) > 2.2);
  // fachada do Balança reta e paralela ao pátio; calçada reta rente a ela
  const b8 = C.buildings.find((b) => b.planId === 'b8'), vs = b8.rings[0].map((p) => L.local(...p)[1]), top = Math.max(...vs);
  assert.ok(b8.rings[0].length <= 5 && vs.filter((v) => Math.abs(v - top) < .05).length >= 2 && Math.abs(top - L.calcada[2]) < .05, 'fachada serrilhada');
});
