import { distToSegment, pointInPolygon } from '../shared/geo.js';
import { referenceEntrance, pairedEntrances } from './reference.js';
import { landmarkPlatformLevels } from './landmarks.js';

// Terraplenagem do campus (pista, prédios, acessos), aplicada depois da escavação da água
// e antes de gerar a malha do relevo. Usa só a API pública do relevo do mapa
// (gradePlatform, gradeCorridors, prepareBuildingPlatform, roadHeightAt, platformFor).

/**
 * Corrige o relevo de satélite com as altitudes de chão levantadas no campus. O SRTM é um modelo
 * de superfície: sobe vários metros perto dos prédios grandes e da mata. Roda antes de tudo
 * (inclusive de escavar a água).
 */
export function correctCampusTerrain(terrain, campus) {
  const control = campus.groundControl;
  if (!control?.length) return null;
  return terrain.applyControlPoints(control.map(([x, z, altitude]) => [x, z, altitude - terrain.base]));
}

/** Local civil-work grading, applied after water carving and before mesh generation. */
export function gradeCampusTerrain(world, terrain, campus) {
  const preserve = (world.areas || []).filter((a) => a.kind === 'water' || a.kind === 'pool').map((a) => a.rings);
  const report = { roads: null, platforms: [], sports: null, plateaus: [] };
  // Platôs de projeto: áreas que no local são planas e niveladas (estacionamentos, baixada do
  // campo). O relevo de satélite e a suavização das vias criavam barrigas e depressões; aqui a
  // cota é imposta ao relevo e aos nós das vias que passam por dentro.
  // (`late`: platô de um marco aplicado só depois da terraplenagem, ver o fim desta função)
  const levelOf = (p) => typeof p.level === 'function' ? p.level(terrain) : p.altitude - terrain.base;
  const plateaus = (campus.plateaus || []).filter((p) => !p.late).map((p) => ({ ...p, level: levelOf(p) }));
  plateaus.forEach((p, i) => {
    const graded = terrain.gradePlatform(p.rings, { level: p.level, band: p.band ?? 12, preserve: [...preserve, ...plateaus.slice(0, i).map((q) => ({ rings: q.rings, margin: 0 }))] });
    report.plateaus.push({ id: p.id, level: p.level, ...graded });
  });
  const plateauLevel = (x, z) => plateaus.find((p) => pointInPolygon(x, z, p.rings))?.level;
  campus.plateauLevel = plateauLevel;
  for (const p of plateaus) preserve.push({ rings: p.rings, margin: 0 });
  if (campus.track) {
    const T = campus.track;
    // The pitch, eight running lanes and bleachers share one engineered platform.
    // Sampling the field centre avoids the hillside beside the grandstand biasing it.
    // (pista levantada: transição curta, para não rebaixar a encosta da arquibancada nem a rua de trás)
    report.sports = terrain.gradePlatform([T.outer], { level: terrain.heightAt(T.cx, T.cz), band: T.surveyed ? 9 : 24, preserve });
    T.groundLevel = report.sports.level;
    if (!T.surveyed && Number.isFinite(T.rOut) && Number.isFinite(T.straight)) {
      const side = -T.uz >= 0 ? 1 : -1, sx = -T.uz * side, sz = T.ux * side;
      const len = T.straight * 2 - 6, near = T.rOut + 1.5, far = near + 13;
      const bleachers = [[-1, near], [1, near], [1, far], [-1, far]].map(([s, off]) => [T.cx + T.ux * s * len / 2 + sx * off, T.cz + T.uz * s * len / 2 + sz * off]);
      terrain.gradePlatform([bleachers], { level: T.groundLevel, band: 16, preserve });
      preserve.push([bleachers]);
    }
    preserve.push([T.outer]);
    // quadras vizinhas ao campo (tênis): planas, no mesmo nível do conjunto esportivo
    for (const court of world.areas || []) {
      if (!['tennis', 'court'].includes(court.kind) || court.rings[0].every(([x, z]) => Math.hypot(x - T.cx, z - T.cz) > T.rOut + T.straight + 90)) continue;
      terrain.gradePlatform(court.rings, { level: T.groundLevel, band: 8, preserve });
      preserve.push(court.rings);
    }
  }
  const internalRoads = world.roads.filter(r => r.internal && !r.bridge && r.kind !== 'foot');
  for (const r of internalRoads) { r.kind = 'twoway'; r.lanes = 2; }
  // Set the engineering datum before foundations alter the hillside. Recomputing
  // the street from a raised foundation feeds the building's embankment back into
  // its approach road, producing an artificial cliff at the entrance.
  terrain.gradeCorridors(internalRoads, { profileOnly: true, pinned: plateaus.length ? plateauLevel : null });
  const frontageLevels = new Map();
  for (const apron of campus.platformAprons || []) {
    if (!apron.sample) continue;
    const nearby = internalRoads.map(r => ({ r, distance: Math.min(...r.pts.slice(1).map((b, i) => distToSegment(...apron.sample, ...r.pts[i], ...b).d)) })).sort((a, b) => a.distance - b.distance);
    const references = nearby.filter(({ distance }) => distance <= Math.min(40, (nearby[0]?.distance ?? Infinity) + 2)).map(({ r }) => terrain.roadHeightAt(r, ...apron.sample)).sort((a, b) => a - b);
    const datum = references.length ? (references[Math.floor((references.length - 1) / 2)] + references[Math.floor(references.length / 2)]) / 2 : terrain.heightAt(...apron.sample);
    frontageLevels.set(apron.buildingId, datum + (apron.buildingRise ?? .85));
  }
  // These photographed low entrances sit beside streets substantially below the
  // SRTM footprint median. Cut the complete foundation to its approach datum;
  // raising only a tiny entrance apron would merely move the cliff to the street.
  // (a Agência fica ao pé do barranco: a mediana da planta pegava a encosta de trás)
  const entranceOffsets = new Map([['b21', .20], ['m2', .15], ['m0', .15], ['b34', .15]]);
  for (const b of campus.buildings) {
    const id = b.planId || b.id;
    if (!entranceOffsets.has(id) || frontageLevels.has(id)) continue;
    const e = referenceEntrance(b, world.roads, (x, z) => (!campus.inRegion || campus.inRegion(x, z, .3)) && (!campus.insideSolid || !campus.insideSolid(x, z, .2)));
    if (e?.road && internalRoads.includes(e.road)) frontageLevels.set(id, terrain.roadHeightAt(e.road, e.roadX, e.roadZ) + entranceOffsets.get(id));
  }
  const red = campus.buildings.find(b => b.planId === 'b3'), ruby = campus.buildings.find(b => b.planId === 'b5');
  const pair = pairedEntrances(red, ruby, internalRoads);
  if (pair) {
    const mid = [(pair.red.x + pair.ruby.x) / 2, (pair.red.z + pair.ruby.z) / 2];
    const shared = internalRoads.map(r => ({ r, d: Math.min(...r.pts.slice(1).map((b, i) => distToSegment(...mid, ...r.pts[i], ...b).d)) })).sort((a, b) => a.d - b.d)[0]?.r;
    if (shared) {
      const level = (terrain.roadHeightAt(shared, pair.red.x, pair.red.z) + terrain.roadHeightAt(shared, pair.ruby.x, pair.ruby.z)) / 2 + .05;
      frontageLevels.set('b3', level); frontageLevels.set('b5', level);
    }
  }
  // Marcos levantados em campo (ex.: o Balança semienterrado assenta no nível do estacionamento).
  for (const [id, level] of landmarkPlatformLevels(campus, world, terrain)) frontageLevels.set(id, level);
  // Prédios que assentam num platô de projeto (ex.: a Agência, no terraço da Portaria Bussocaba).
  for (const p of plateaus) for (const id of p.buildings || []) frontageLevels.set(id, p.level);
  for (const b of campus.buildings) {
    if (b.structure === 'pergola') continue;
    report.platforms.push(terrain.prepareBuildingPlatform(b, { preserve, level: frontageLevels.get(b.planId || b.id) }));
    preserve.push({ rings: b.rings, roadCutAllowed: true });
  }
  report.aprons = [];
  for (const apron of campus.platformAprons || []) {
    const b = campus.buildings.find(b => (b.planId || b.id) === apron.buildingId);
    const level = b ? terrain.platformFor(b).height - .7 : typeof apron.level === 'function' ? apron.level(terrain) : apron.level;
    const graded = terrain.gradePlatform(apron.rings, { level, band: apron.band ?? 6, maxAdjustment: apron.maxAdjustment ?? Infinity, preserve });
    apron.height = graded.level;
    report.aprons.push({ buildingId: apron.buildingId, height: graded.level, ...graded });
    preserve.push({ rings: apron.rings, margin: 0, roadCutAllowed: true });
  }
  report.roads = terrain.gradeCorridors(internalRoads, { preserve, reuseProfiles: true });
  // Platôs tardios: um marco rebaixa um trecho de via (ex.: a via interna junto à rampa da Portaria
  // Goiabinha, abaixo da avenida). Só o perfil das vias até `reach` m dele muda — os nós mais longe
  // ficam presos ao perfil de antes — e o relevo continua o da terraplenagem: o marco o rebaixa por
  // baixo das vias depois (gradeLandmarks), sem arrastar a rua de fora junto.
  const late = (campus.plateaus || []).filter((p) => p.late).map((p) => ({ ...p, level: levelOf(p) }));
  if (late.length) {
    const near = (x, z) => late.some((p) => p.rings[0].some(([px, pz]) => Math.hypot(px - x, pz - z) < (p.reach ?? 80)));
    const roads = internalRoads.filter((r) => r.pts.some((p) => near(...p)));
    const before = (x, z) => { let best = Infinity, y; for (const r of roads) for (let i = 1; i < r.pts.length; i++) { const d = distToSegment(x, z, ...r.pts[i - 1], ...r.pts[i]).d; if (d < best) { best = d; y = terrain.roadHeightAt(r, x, z); } } return y; };
    terrain.gradeCorridors(roads, { profileOnly: true, pinned: (x, z) => late.find((p) => pointInPolygon(x, z, p.rings))?.level ?? (near(x, z) ? plateauLevel(x, z) : before(x, z)) });
    report.late = late.map((p) => ({ id: p.id, level: p.level, roads: roads.length }));
  }
  return report;
}
