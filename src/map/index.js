import { renderWorldFor } from './surroundings.js';
import { loadJSON } from '../shared/load-json.js';
import { createProjection } from '../shared/geo.js';
import { createTerrain } from './terrain.js';
import { parseWorld } from './world.js';
import { paintGround, buildMasks } from './ground.js';
import { buildRoads } from './roads.js';
import { createBuildingBuilder, specFromOsm } from './buildings.js';
import { generateProcedural } from './procedural.js';
import { buildVegetation } from './vegetation.js';
import { buildWater, buildBarriers, buildTrafficSignals, buildLabels, buildQuarterBoundary } from './props.js';
import { updateNature } from './nature.js';
import { addMapPlaces } from './places.js';

// API pública do MAPA (mundo real: OSM + relevo SRTM). Outros módulos importam SÓ daqui.
//
// O mapa é montado por um pipeline em etapas. Módulos que mudam o mundo (ex.: o campus)
// entram como PLUGINS, implementando os ganchos que quiserem — na ordem em que rodam:
//   prepareWorld(map)       depois de ler o GeoJSON (pode mexer em map.world, chamar map.reserve)
//   shapeTerrain(map)       depois de escavar a água, antes de gerar a malha do relevo
//   detailGroundRect(map)   -> { x0, z0, width, depth } para pintar o chão em alta resolução
//   build(map)              depois das vias e dos prédios do OSM
//   decorate(map)           depois da vegetação
//   finalize(map)           tudo pronto: registrar física, destinos, placas, sistemas
// Áreas reservadas (map.reserve) ficam sem prédios procedurais nem vegetação automática.

// ferramentas reutilizáveis por outros módulos
export { createBuildingBuilder, specFromOsm, PALETTE } from './buildings.js';
export { makeTreeMeshes, makePalmMeshes } from './vegetation.js';
export { createWaterMaterial, createSidewalkTrees, buildCampusGrass, createFoliageCloud, createFoliageMaterial } from './nature.js';
export { ROAD_CLASSES } from './world.js';

/** baixa o GeoJSON do OSM e a grade de relevo */
export async function loadMapData(base, { beforeParse } = {}) {
  const [geojson, terrainData] = await Promise.all([
    loadJSON(`${base}data/cidade-de-deus.geojson`, { beforeParse }),
    loadJSON(`${base}data/terrain.json`, { beforeParse }),
  ]);
  return { geojson, terrainData, proj: projectionFor(geojson) };
}

/** origem do sistema local = centro do polígono da Cidade de Deus */
export function projectionFor(geojson) {
  const qf = geojson.features.find((f) => f.properties.place === 'quarter');
  let lon0, lat0;
  if (qf) {
    const ring = qf.geometry.coordinates[0];
    const lons = ring.map((c) => c[0]), lats = ring.map((c) => c[1]);
    lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
    lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  } else {
    lon0 = (geojson.bbox[0] + geojson.bbox[2]) / 2;
    lat0 = (geojson.bbox[1] + geojson.bbox[3]) / 2;
  }
  return createProjection(lon0, lat0);
}

export async function buildMap(game, { data, plugins = [] }) {
  const { engine, quality, physics, status } = game;
  const { scene, renderer, camera } = engine;
  const hook = async (name) => { for (const p of plugins) if (p[name]) await p[name](map); };

  await status('Gerando relevo real (SRTM)...', 16);
  const terrain = createTerrain(data.terrainData, data.proj);
  const world = parseWorld(data.geojson, data.proj);
  world.bounds = terrain.bounds;
  const map = {
    proj: data.proj,
    terrainData: data.terrainData,
    terrain,
    world,
    reserved: [],
    reserve(rings) { map.reserved.push(rings); },
    footprints: [],
    procOn: true,
  };

  await hook('prepareWorld');
  for (const a of world.areas) if (a.kind === 'water') a.waterLevel = terrain.carveWater(a.rings);
  await hook('shapeTerrain');
  const renderWorld = renderWorldFor(world, game.settings?.surroundings);
  map.surroundingsEnabled = renderWorld === world;
  if (game.settings?.surroundings === 'fog') {
    scene.fog.near = 350; scene.fog.far = 1400;
  }

  await status('Pintando uso do solo, calçadas e rios...', 28);
  map.ground = paintGround(world, terrain.bounds, renderer, quality.groundPx);
  const { mesh: terrainMesh, skirt } = terrain.buildMesh(map.ground.texture);
  scene.add(terrainMesh, skirt);
  for (const p of plugins) {
    const rect = p.detailGroundRect?.(map);
    if (!rect) continue;
    const detail = paintGround(world, rect, renderer, quality.detailPx);
    scene.add(terrain.buildDetailMesh(rect, detail.texture));
  }
  map.masks = buildMasks(world, terrain.bounds);

  await status(`Traçando ${renderWorld.roads.length} vias...`, 40);
  map.roads = buildRoads(renderWorld, terrain, renderer);
  scene.add(map.roads.root);

  await status(`Levantando ${renderWorld.buildings.length} prédios reais do OSM...`, 48);
  map.real = createBuildingBuilder(renderer, terrain);
  for (const b of renderWorld.buildings) map.real.add(specFromOsm(b));
  map.real.finish(scene);

  await hook('build');

  await status('Preparando quadras e entorno...', 66);
  map.proc = createBuildingBuilder(renderer, terrain);
  if (map.surroundingsEnabled) for (const s of generateProcedural(world, map.masks, terrain, { skipQuarter: map.reserved.length > 0 })) map.proc.add(s);
  map.procRoot = map.proc.finish(scene);
  map.procRoot.name = 'predios-procedurais';

  await status('Plantando árvores...', 72);
  map.veg = buildVegetation(renderWorld, map.masks, terrain, { quality: quality.name, sidewalkHeightAt: map.roads.sidewalkHeightAt, exclude: map.reserved,
    enabled: map.surroundingsEnabled || !map.reserved.length });
  map.veg.root.userData.noPaintball = true;
  scene.add(map.veg.root);
  await hook('decorate');

  await status('Água, muros, semáforos e placas...', 80);
  scene.add(buildWater(renderWorld, terrain, { quality: quality.name }));
  scene.add(buildBarriers(renderWorld, terrain, map.real));
  map.signals = buildTrafficSignals(renderWorld, terrain);
  scene.add(map.signals.root);
  map.labels = buildLabels(renderWorld, terrain, { real: map.real });
  scene.add(map.labels.root);
  map.boundary = buildQuarterBoundary(world.quarter, terrain);
  scene.add(map.boundary);

  // física: o que o personagem não atravessa e onde ele pisa
  const { roads, real, proc } = map;
  physics.addCollider(real);
  physics.addCollider(proc, () => map.procOn);
  physics.addSurface((x, z, maxY) => roads.bridgeHeightAt(x, z, maxY));
  physics.addSurface((x, z, maxY) => roads.surfaceHeightAt(x, z, maxY));
  physics.addRoof((x, z, y) => real.roofAt(x, z, y));
  physics.addRoof((x, z, y) => proc.roofAt(x, z, y), () => map.procOn);
  map.footprints.push(...proc.footprints, ...real.footprints);

  await hook('finalize');
  addMapPlaces(renderWorld, game.places);
  if (!game.mapPoints.length) game.mapPoints.push(...game.places.map((p, i) => ({ ...p, number: i + 1 })));
  else game.places.filter(p => !p.fixed).forEach((p, i) => game.mapPoints.push({
    ...p, number: `E${i + 1}`, x: p.target?.[0] ?? p.x, z: p.target?.[1] ?? p.z,
    teleportX: p.x, teleportZ: p.z, radius: 60, height: 20,
  }));
  // The 2D map still depicts OSM footprints when surrounding 3D geometry is omitted.
  if (!map.surroundingsEnabled) map.footprints.push(...world.buildings.filter(b => !renderWorld.buildings.includes(b)).map(b => ({ rings: b.rings, color: 'house' })));

  // sistemas do mapa
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  engine.addSystem((dt, t) => updateNature(t, motionPreference.matches), 'early');
  let frame = 0;
  engine.addSystem((dt, t) => {
    map.signals.update(t);
    map.boundary.userData.update?.(t);
    if (frame++ % 10 === 0) map.labels.update(camera.position);
  }, 'world');

  // atalhos do mapa
  game.input.bind('KeyP', () => {
    if (!map.surroundingsEnabled) { game.toast('Ative o entorno nas configurações para exibir prédios procedurais'); return; }
    map.procOn = !map.procOn;
    map.procRoot.visible = map.procOn;
    game.toast(map.procOn ? 'Prédios procedurais: LIGADOS' : 'Prédios procedurais: DESLIGADOS (só dados reais do OSM)');
  }, { label: 'prédios procedurais' });
  game.input.bind('KeyB', () => { map.boundary.visible = !map.boundary.visible; game.toast(map.boundary.visible ? 'Limite do bairro: visível' : 'Limite do bairro: oculto'); }, { label: 'limite do bairro' });
  game.input.bind('KeyL', () => { map.labels.root.visible = !map.labels.root.visible; game.toast(map.labels.root.visible ? 'Placas: visíveis' : 'Placas: ocultas'); }, { label: 'placas' });

  map.stats = { osmBuildings: real.count(), procedural: proc.count(), roads: renderWorld.roads.length, minAlt: data.terrainData.min, maxAlt: data.terrainData.max };
  return map;
}
