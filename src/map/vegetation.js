import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../shared/rng.js';
import { pointInPolygon } from '../shared/geo.js';
import { createFoliageCloud, createFoliageMaterial, createSidewalkTrees } from './nature.js';
import { halveTrees } from '../shared/tree-density.js';

// Árvores: as mapeadas no OSM (pontos e fileiras) + preenchimento por densidade em
// matas, praças e áreas verdes reais + arborização de calçada. Tudo em InstancedMesh.
// Dentro do campus Cidade de Deus as árvores vêm das copas reais (ver campus.js).

const DENSITY = { wood: 1 / 40, park: 1 / 110, golf: 1 / 1400, grass: 1 / 260, scrub: 1 / 160, sports: 1 / 700, school: 1 / 600 };
const MAX_TREES = 16000;

/** options.exclude: lista de polígonos (rings) onde não plantar */
export function buildVegetation(world, masks, terrain, options = {}) {
  if (options.enabled === false) {
    const root = new THREE.Group(); root.name = 'vegetacao';
    return { root, count: 0 };
  }
  const rnd = mulberry32(4242);
  const trees = [];
  const excluded = (x, z) => (options.exclude || []).some((rings) => pointInPolygon(x, z, rings));
  const add = (x, z, scale = 1) => {
    if (trees.length >= MAX_TREES || excluded(x, z)) return;
    trees.push({ x, z, s: scale * (0.75 + rnd() * 0.6), r: rnd() * Math.PI * 2, v: rnd() });
  };

  for (const p of world.points) if (p.tags.natural === 'tree') add(p.x, p.z, 1.1);

  for (const row of world.treeRows)
    for (let i = 0; i < row.length - 1; i++) {
      const [ax, az] = row[i], [bx, bz] = row[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 7) add(ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L);
    }

  for (const a of world.areas) {
    if (trees.length >= MAX_TREES) break;
    const dens = DENSITY[a.kind];
    if (!dens) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of a.rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const n = Math.round((maxX - minX) * (maxZ - minZ) * dens);
    for (let i = 0; i < n && trees.length < MAX_TREES; i++) {
      // no golfe, árvores em bosques (aglomerados), não espalhadas no fairway
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      if (!pointInPolygon(x, z, a.rings) || masks.tree.get(x, z)) continue;
      if (a.kind === 'golf') {
        for (let k = 0; k < 6; k++) {
          const xx = x + (rnd() - 0.5) * 18, zz = z + (rnd() - 0.5) * 18;
          if (pointInPolygon(xx, zz, a.rings) && !masks.tree.get(xx, zz)) add(xx, zz, 1.2);
        }
      } else add(x, z, a.kind === 'wood' ? 1.2 : 1);
    }
  }

  // Ritmo regular nos passeios; máscara e vias transversais preservam as travessias.
  const streetTrees = trees.length < MAX_TREES ? createSidewalkTrees(world.roads, {
    existing: trees,
    allowed: (x, z) => !excluded(x, z) && !masks.tree.get(x, z),
    size: 0.9,
  }) : [];
  trees.push(...streetTrees.slice(0, Math.max(0, MAX_TREES - trees.length)));

  const reduced = halveTrees(trees);
  const root = makeTreeMeshes(reduced, terrain, { quality: options.quality, sidewalkHeightAt: options.sidewalkHeightAt });
  root.name = 'vegetacao';
  return { root, count: reduced.length };
}

// ---------------------------------------------------------------- malhas (reutilizadas pelo campus)
const shared = new Map();
function sharedAssets(cardCount, detail) {
  const key = `${cardCount}:${detail}`;
  if (shared.has(key)) return shared.get(key);
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, detail ? 6 : 4);
  trunkGeo.translate(0, 0.5, 0);
  const wood = [trunkGeo];
  for (let i = 0; detail && i < 3; i++) {
    // Branch ends are enclosed by trunk/canopy; omitting caps halves their cost.
    const branch = new THREE.CylinderGeometry(0.035, 0.11, 1, 3, 1, true);
    branch.translate(0, 0.5, 0);
    branch.rotateZ(-0.9);
    branch.scale(1.05, 0.36, 1.05);
    branch.rotateY(i / 3 * Math.PI * 2);
    branch.translate(0, 0.65, 0);
    wood.push(branch);
  }
  const assets = {
    trunkGeo: mergeGeometries(wood), crownGeo: createFoliageCloud(cardCount),
    trunkMat: new THREE.MeshStandardMaterial({ color: 0x796856, roughness: 1 }),
    crownMat: createFoliageMaterial(),
    soilGeo: new THREE.BoxGeometry(1.0, 0.06, 1.0),
    soilMat: new THREE.MeshStandardMaterial({ color: 0x493b2c, roughness: 1 }),
  };
  wood.forEach((geometry) => geometry.dispose());
  shared.set(key, assets);
  return assets;
}

const GREENS = ['#3f6f2a', '#4c7d30', '#36622a', '#5a8a35', '#2f5a24', '#557a2e', '#6b8f3a'].map((c) => new THREE.Color(c));
const IPE = new THREE.Color('#d9579a'); // ipê-rosa florido

/**
 * trees: [{ x, z, s (escala), r (rotação), v (0..1 variação), pink? }]
 * instâncias agrupadas diretamente em blocos de 125 m (frustum culling por bloco)
 */
export function makeTreeMeshes(trees, terrain, { quality = 'high', detail = false, sidewalkHeightAt } = {}) {
  const cardCount = quality === 'low' ? (detail ? 20 : 12) : quality === 'med' ? (detail ? 24 : 14) : (detail ? 32 : 16);
  const { trunkGeo, crownGeo, trunkMat, crownMat, soilGeo, soilMat } = sharedAssets(cardCount, detail);
  const chunks = new Map();
  for (const t of trees) {
    const k = Math.floor(t.x / 125) + ',' + Math.floor(t.z / 125);
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(t);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const root = new THREE.Group();
  for (const list of chunks.values()) {
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const crown = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
    // Query the finished pavement once per tree, not three times per soil/trunk.
    const heights = list.map(t => t.sidewalk ? sidewalkHeightAt?.(t.x, t.z) : undefined);
    const sidewalkIndices = list.map((t, i) => i).filter(i => list[i].sidewalk && Number.isFinite(heights[i]));
    const soil = sidewalkIndices.length ? new THREE.InstancedMesh(soilGeo, soilMat, sidewalkIndices.length) : null;
    if (soil) {
      sidewalkIndices.forEach((index, i) => {
        const t = list[index];
        // Soil surface sits 4 cm above the finished pavement, not coplanar with it.
        const top = heights[index];
        m.compose(p.set(t.x, top + 0.01, t.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.sidewalkYaw || 0), sc.set(1, 1, 1));
        soil.setMatrixAt(i, m);
      });
      soil.name = 'canteiros-quadrados-arvores';
      soil.receiveShadow = true;
      soil.userData.spatiallyPartitioned = true;
      soil.computeBoundingSphere();
      root.add(soil);
    }
    list.forEach((t, i) => {
      const walkY = heights[i];
      const y = Number.isFinite(walkY) ? walkY : terrain.heightAt(t.x, t.z);
      const h = 2.4 * t.s;
      m.compose(p.set(t.x, y - 0.2, t.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.r), sc.set(t.s, h + 0.6, t.s));
      trunk.setMatrixAt(i, m);
      const cr = 2.15 * t.s;
      m.compose(p.set(t.x, y + h + cr * 0.55, t.z), q, sc.set(cr * (1.05 + t.v * 0.2), cr * (0.75 + t.v * 0.25), cr));
      crown.setMatrixAt(i, m);
      if (t.pink) col.copy(IPE).offsetHSL(0, 0, (t.v - 0.5) * 0.08);
      else col.copy(GREENS[Math.min(GREENS.length - 1, Math.floor(t.v * GREENS.length))]).offsetHSL(0, 0, (t.v - 0.5) * 0.06);
      crown.setColorAt(i, col);
    });
    trunk.computeBoundingSphere();
    crown.computeBoundingSphere();
    // The campus retains detailed wood and sun shadows; the surrounding city
    // uses compact silhouettes and no extra forest shadow passes.
    trunk.castShadow = detail;
    // Leaf cards shade their own cores in the shader, avoiding a second forest
    // draw for every shadow cascade and preserving the mobile quality budget.
    crown.castShadow = false;
    trunk.name = 'troncos';
    crown.name = 'copas';
    trunk.userData.spatiallyPartitioned = crown.userData.spatiallyPartitioned = true;
    root.add(trunk, crown);
  }
  return root;
}

/** palmeiras-imperiais (tronco alto e fino + leque de folhas) */
export function makePalmMeshes(palms, terrain) {
  const trunkGeo = new THREE.CylinderGeometry(0.17, 0.24, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  // Frondes arqueadas e folíolos abertos, como as palmeiras dos jardins reais.
  const leaf = palmFrond();
  const leaves = [];
  for (let k = 0; k < 8; k++) { const g = leaf.clone(); g.rotateY((k / 8) * Math.PI * 2); leaves.push(g); }
  const crownGeo = mergeLeaves(leaves);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x9a9184, roughness: 0.9 }), palms.length);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x4f8a32, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), palms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  palms.forEach((pl, i) => {
    const y = terrain.heightAt(pl.x, pl.z);
    const h = pl.h || 12;
    trunk.setMatrixAt(i, m.compose(p.set(pl.x, y - 0.2, pl.z), q.identity(), s.set(1, h, 1)));
    crown.setMatrixAt(i, m.compose(p.set(pl.x, y + h - 0.3, pl.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, pl.r || 0), s.set(1, 1, 1)));
  });
  trunk.castShadow = crown.castShadow = true;
  trunk.computeBoundingSphere();
  crown.computeBoundingSphere();
  const g = new THREE.Group();
  g.name = 'palmeiras';
  g.add(trunk, crown);
  return g;
}

function palmFrond() {
  const positions = [];
  const at = (t, side = 0) => [t * 4.2, Math.sin(t * Math.PI) * 0.65 - t * t * 1.6, side];
  const triangle = (a, b, c) => positions.push(...a, ...b, ...c);
  for (let i = 0; i < 10; i++) {
    const t = i / 10, u = (i + 1) / 10, width = 0.075 * (1 - t) + 0.018;
    const a = at(t, -width), b = at(t, width), c = at(u, width * 0.8), d = at(u, -width * 0.8);
    triangle(a, c, b); triangle(a, d, c);
  }
  for (let i = 1; i < 14; i++) for (const side of [-1, 1]) {
    const t = i / 15, base = at(t, side * 0.025), width = Math.sin(t * Math.PI) * 0.62;
    const tip = at(t + 0.10, side * width); tip[1] -= 0.16;
    const end = at(t + 0.06, side * 0.025);
    triangle(base, tip, end);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mergeLeaves(geoms) {
  const pos = [];
  for (const g of geoms) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
