import { distToSegment } from '../shared/geo.js';
import { referenceEntrance, pairedEntrances } from './reference.js';

// Terraplenagem do campus (pista, prédios, acessos), aplicada depois da escavação da água
// e antes de gerar a malha do relevo. Usa só a API pública do relevo do mapa
// (gradePlatform, gradeCorridors, prepareBuildingPlatform, roadHeightAt, platformFor).

/** Local civil-work grading, applied after water carving and before mesh generation. */
export function gradeCampusTerrain(world, terrain, campus) {
  const preserve = (world.areas || []).filter((a) => a.kind === 'water' || a.kind === 'pool').map((a) => a.rings);
  const report = { roads: null, platforms: [], sports: null };
  if (campus.track) {
    const T = campus.track;
    // The pitch, eight running lanes and bleachers share one engineered platform.
    // Sampling the field centre avoids the hillside beside the grandstand biasing it.
    report.sports = terrain.gradePlatform([T.outer], { level: terrain.heightAt(T.cx, T.cz), band: 24, preserve });
    T.groundLevel = report.sports.level;
    if (Number.isFinite(T.rOut) && Number.isFinite(T.straight)) {
      const side = -T.uz >= 0 ? 1 : -1, sx = -T.uz * side, sz = T.ux * side;
      const len = T.straight * 2 - 6, near = T.rOut + 1.5, far = near + 13;
      const bleachers = [[-1, near], [1, near], [1, far], [-1, far]].map(([s, off]) => [T.cx + T.ux * s * len / 2 + sx * off, T.cz + T.uz * s * len / 2 + sz * off]);
      terrain.gradePlatform([bleachers], { level: T.groundLevel, band: 16, preserve });
      preserve.push([bleachers]);
    }
    preserve.push([T.outer]);
  }
  const internalRoads = world.roads.filter(r => r.internal && !r.bridge && r.kind !== 'foot');
  for (const r of internalRoads) { r.kind = 'twoway'; r.lanes = 2; }
  // Set the engineering datum before foundations alter the hillside. Recomputing
  // the street from a raised foundation feeds the building's embankment back into
  // its approach road, producing an artificial cliff at the entrance.
  terrain.gradeCorridors(internalRoads, { profileOnly: true });
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
  const entranceOffsets = new Map([['b21', .20], ['m2', .15], ['m0', .15]]);
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
  return report;
}
