import { ringCentroid } from '../shared/geo.js';
import { buildCampusGrass } from '../map/index.js';
import { prepareCampus, buildCampus, campusQA } from './campus.js';
import { gradeCampusTerrain } from './grading.js';

// API pública do CAMPUS — núcleo Cidade de Deus (matriz do Bradesco).
// Entra no mapa como plugin (ver ganchos em src/map/index.js). Outros módulos importam SÓ daqui.

export { campusQA } from './campus.js';

/** baixa os detalhes do campus (opcional: o mapa funciona sem) */
export async function loadCampusData(base) {
  return fetch(`${base}data/campus-cidade-de-deus.geojson`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

export function createCampusPlugin(game, campusGeo) {
  const plugin = {
    name: 'campus',
    /** resultado de prepareCampus (planta, muros, vagas, árvores...) — null sem dados */
    data: null,
    /** resultado de buildCampus (malhas, colisão, placas...) */
    built: null,
    /** relatório da terraplenagem */
    grading: null,

    prepareWorld(map) {
      if (!campusGeo) return;
      plugin.data = prepareCampus(campusGeo, map.world, map.proj);
      if (plugin.data) map.reserve(map.world.quarter);
    },

    shapeTerrain(map) {
      if (plugin.data) plugin.grading = gradeCampusTerrain(map.world, map.terrain, plugin.data);
    },

    // chão do campus em alta resolução (vagas, quadras, raias, gramados)
    detailGroundRect(map) {
      if (!plugin.data) return null;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of map.world.quarter[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      return { x0: minX - 40, z0: minZ - 40, width: maxX - minX + 80, depth: maxZ - minZ + 80 };
    },

    async build(map) {
      if (!plugin.data) return;
      await game.status('Construindo o núcleo Cidade de Deus (portarias, muros, prédios)...', 55);
      const { scene, renderer } = game.engine;
      plugin.built = buildCampus(plugin.data, { scene, renderer, terrain: map.terrain, world: map.world, roads: map.roads, masks: map.masks, quality: game.quality.name });
    },

    async decorate(map) {
      if (!plugin.data) return;
      await game.status('Cultivando os gramados...', 76);
      const C = plugin.data;
      const grass = buildCampusGrass(map.world, map.masks, map.terrain, {
        quality: game.quality.name, inside: (x, z) => !C.insideSolid(x, z) && !C.detailOccupied?.(x, z),
      }).root;
      grass.userData.noPaintball = true;
      game.engine.scene.add(grass);
    },

    finalize(map) {
      const B = plugin.built;
      if (!B) return;
      game.physics.addCollider(B.builder);
      game.physics.addSurface((x, z, maxY) => B.surfaceHeightAt(x, z, maxY));
      game.physics.addRoof((x, z, y) => B.builder.roofAt(x, z, y));
      // Numbered destinations use structure centres for the tour and safe entrances for campaign.
      const C = plugin.data;
      const destinations = [...C.buildings, ...C.parkings, ...(C.helideck ? [C.helideck] : []), ...(C.monkeyPark ? [{ num: 12, name: 'Parque dos Macacos', rings: C.monkeyPark, kind: 'park' }] : []), ...C.gates, ...C.points];
      const seen = new Set();
      for (const item of destinations.filter(p => p.num && p.name).sort((a, b) => (a.kind === 'gate') - (b.kind === 'gate') || a.num - b.num)) {
        const key = `${item.kind}-${item.num}-${item.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [x, z] = item.rings ? ringCentroid(item.rings[0]) : [item.x, item.z];
        const entry = B.details.entrances.find(e => e.name === item.name)?.frontage;
        const gate = B.spawnPoints.find(p => p.name === item.name);
        const radius = item.rings ? Math.max(...item.rings[0].map(p => Math.hypot(p[0] - x, p[1] - z))) : 25;
        game.mapPoints.push({ name: item.name, number: item.kind === 'gate' ? `P${item.num}` : item.num, x, z, height: item.height || 8, radius,
          teleportX: gate?.x ?? (entry ? entry.x + entry.nx * 4 : x),
          teleportZ: gate?.z ?? (entry ? entry.z + entry.nz * 4 : z),
          yaw: gate?.yaw ?? (entry ? Math.atan2(-entry.nx, -entry.nz) + Math.PI : 0),
        });
      }
      // portarias: chegada do lado de fora, olhando para a entrada
      for (const sp of B.spawnPoints) game.places.push({ ...sp, fixed: true });
      map.labels.root.add(...B.sprites);
      map.footprints.push(...B.builder.footprints);
      game.engine.addSystem((dt, t) => { if (game.player) B.update(dt, game.player.feet, t); }, 'world');
    },

    /** números para a tela inicial */
    get stats() { return plugin.built ? { buildings: plugin.built.count, trees: plugin.built.trees, cars: plugin.built.cars } : null; },
    qa: () => plugin.data && campusQA(plugin.data),
  };
  return plugin;
}
