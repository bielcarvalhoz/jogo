import fs from 'node:fs/promises';
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeadlessMap } from '../src/map/index.js';
import { createCampusPlugin } from '../src/campus/index.js';
import { pointInPolygon, distToSegment, SpatialGrid } from '../src/shared/geo.js';
import { multiplayerLandmarks } from '../src/shared/multiplayer.js';
import { createRegionCanvas } from './region-canvas.js';
import { standVolumes } from '../src/shared/stands.js';

export async function loadServerWorld() {
  const read = async name => JSON.parse(await fs.readFile(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
  const [geojson, terrainData, campusGeo] = await Promise.all(['cidade-de-deus.geojson', 'terrain.json', 'campus-cidade-de-deus.geojson'].map(read));
  const map = createHeadlessMap({ geojson, terrainData }), campus = createCampusPlugin({}, campusGeo, { createCanvas: createRegionCanvas });
  campus.prepareWorld(map); campus.correctTerrain(map);
  for (const a of map.world.areas) if (a.kind === 'water') a.waterLevel = map.terrain.carveWater(a.rings);
  campus.shapeTerrain(map);
  await RAPIER.init();
  return createWorldQueries(map, campus.data);
}

export function createWorldQueries(map, campus) {
  const terrain = map.terrain, landmarks = multiplayerLandmarks(campus, terrain);
  const obstacles = [], grid = new SpatialGrid(8);
  function add(rings, bottom, top, stepable = false) {
    const xs = rings[0].map(p => p[0]), zs = rings[0].map(p => p[1]);
    const box = { rings, stepable, min: { x: Math.min(...xs), y: bottom, z: Math.min(...zs) }, max: { x: Math.max(...xs), y: top, z: Math.max(...zs) } };
    obstacles.push(box); grid.insertBox(box, box.min.x, box.min.z, box.max.x, box.max.z);
  }
  for (const b of campus.buildings) {
    if (b.structure === 'pergola') continue;
    const p = b.rings[0][0], y = terrain.platformFor(b)?.height ?? terrain.heightAt(...p);
    add(b.rings, y - 3, y + (b.height || 9));
  }
  // Split walls into short segments. A diagonal wall's bounding box must not
  // become a solid rectangle in the shared zombie navigation grid.
  for (const line of campus.walls) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(length / 2);
    for (let j = 0; j < n; j++) {
      const x = a[0] + (b[0] - a[0]) * j / n, z = a[1] + (b[1] - a[1]) * j / n;
      const qx = a[0] + (b[0] - a[0]) * (j + 1) / n, qz = a[1] + (b[1] - a[1]) * (j + 1) / n;
      const dx = (b[1] - a[1]) / (length || 1) * .12, dz = -(b[0] - a[0]) / (length || 1) * .12;
      const y = Math.min(terrain.heightAt(x, z), terrain.heightAt(qx, qz));
      add([[[x - dx, z - dz], [qx - dx, qz - dz], [qx + dx, qz + dz], [x + dx, z + dz]]], y - 1, y + 2.7);
    }
  }
  const stands = standVolumes(campus.leisure?.stand);
  for (const v of stands) add(v.rings, campus.leisure.stand.level - 3, v.top, true);
  function groundAt(x, z, maxY = Infinity) {
    let y = terrain.heightAt(x, z);
    for (const b of grid.query(x, z, 0)) if (b.stepable && b.max.y <= maxY && pointInPolygon(x, z, b.rings)) y = Math.max(y, b.max.y);
    return y;
  }
  const all = campus.quarter[0], xs = all.map(p => p[0]), zs = all.map(p => p[1]);
  const bounds = { x0: Math.min(...xs) - 30, x1: Math.max(...xs) + 30, z0: Math.min(...zs) - 30, z1: Math.max(...zs) + 30 };
  function free(x, z, radius = .35, y = terrain.heightAt(x, z)) {
    if (x < bounds.x0 || x > bounds.x1 || z < bounds.z0 || z > bounds.z1) return false;
    for (const b of grid.query(x, z, radius + 1)) {
      if (b.stepable && y + .7 >= b.max.y) continue;
      if (x + radius < b.min.x || x - radius > b.max.x || z + radius < b.min.z || z - radius > b.max.z) continue;
      if (y >= b.max.y || y + 1.8 < b.min.y) continue;
      if (pointInPolygon(x, z, b.rings)) return false;
      for (const ring of b.rings) for (let i = 0; i < ring.length; i++) if (distToSegment(x, z, ...ring[i], ...ring[(i + 1) % ring.length]).d < radius) return false;
    }
    return true;
  }
  function segmentClear(a, b, radius = .35) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }
  function trace(a, b) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), steps = Math.ceil(distance / .2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      let blocked = p.y < terrain.heightAt(p.x, p.z);
      if (!blocked) for (const box of grid.query(p.x, p.z, 0)) if (p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z && p.y >= box.min.y && p.y <= box.max.y && pointInPolygon(p.x, p.z, box.rings)) { blocked = true; break; }
      if (blocked) return { point: p, distance: distance * t };
    }
    return null;
  }
  return { terrain, campus, landmarks, bounds, obstacles, free, groundAt, segmentClear, trace, createCrates: () => createCrates(terrain, landmarks.field) };
}

function createCrates(terrain, field) {
  const world = new RAPIER.World({ x: 0, y: -22, z: 0 }); world.timestep = 1 / 60;
  const cells = 64, extent = 128, vertices = [], indices = [];
  for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) {
    const wx = field.x + (x / cells * 2 - 1) * extent, wz = field.z + (z / cells * 2 - 1) * extent;
    vertices.push(wx, terrain.heightAt(wx, wz), wz);
  }
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) { const a = z * (cells + 1) + x, b = a + cells + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(.7));
  const crates = ['wood', 'metal'].map(type => {
    const half = type === 'wood' ? .6 : .8, mass = type === 'wood' ? 6 : 72;
    const spawn = { x: field.x + (type === 'wood' ? 0 : 5.6), y: field.y + half + .03, z: field.z - (type === 'wood' ? 0 : 1) };
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(spawn.x, spawn.y, spawn.z).setLinearDamping(.18).setAngularDamping(.35).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setMass(mass).setFriction(type === 'wood' ? .45 : .8).setRestitution(.12), body);
    return { id: type, type, half, mass, body, spawn, lastTouch: null };
  });
  return {
    world, crates, step: () => world.step(),
    reset(crate) { crate.body.setTranslation(crate.spawn, true); crate.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); crate.body.setLinvel({ x: 0, y: 0, z: 0 }, true); crate.body.setAngvel({ x: 0, y: 0, z: 0 }, true); },
    snapshot: () => crates.map(c => ({ id: c.id, position: c.body.translation(), rotation: c.body.rotation() })),
    trace(a, b) {
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, length = Math.hypot(d.x, d.y, d.z);
      if (!length) return null;
      const ray = new RAPIER.Ray(a, { x: d.x / length, y: d.y / length, z: d.z / length });
      let hit = null;
      for (const crate of crates) { const t = crate.body.collider(0).castRay(ray, length, true); if (Number.isFinite(t) && t >= 0 && (!hit || t < hit.distance)) hit = { crate, distance: t, point: { x: a.x + d.x / length * t, y: a.y + d.y / length * t, z: a.z + d.z / length * t } }; }
      return hit;
    },
    dispose: () => world.free(),
  };
}
