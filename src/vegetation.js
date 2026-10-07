import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { pointInPolygon } from './geo.js';

// Árvores: as mapeadas no OSM (pontos e fileiras) + preenchimento por densidade em
// matas, praças e áreas verdes reais + arborização de calçada. Tudo em InstancedMesh.

const DENSITY = { campus: 1 / 320, wood: 1 / 40, park: 1 / 110, golf: 1 / 1400, grass: 1 / 260, scrub: 1 / 160, sports: 1 / 700, school: 1 / 600 };
const MAX_TREES = 16000;

export function buildVegetation(world, masks, terrain) {
  const rnd = mulberry32(4242);
  const trees = [];
  const add = (x, z, scale = 1) => {
    if (trees.length >= MAX_TREES) return;
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
    const dens = DENSITY[a.kind];
    if (!dens) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of a.rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const n = Math.round((maxX - minX) * (maxZ - minZ) * dens);
    for (let i = 0; i < n; i++) {
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

  // arborização de calçada nas ruas residenciais e avenidas
  for (const r of world.roads) {
    if (!['residential', 'tertiary', 'secondary', 'primary', 'unclassified'].includes(r.highway) || r.bridge) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let s = rnd() * 10; s < L; s += 11 + rnd() * 8) {
        for (const side of [1, -1]) {
          if (rnd() > 0.32) continue;
          const off = r.w / 2 + 1.5;
          const x = ax + tx * s - tz * off * side, z = az + tz * s + tx * off * side;
          if (!masks.tree.get(x, z)) add(x, z, 0.8);
        }
      }
    }
  }

  // ---------------------------------------------------------------- malhas
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  // deforma levemente a copa para não ficar uma bola perfeita
  const pos = crownGeo.attributes.position;
  const nr = mulberry32(9);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.85 + nr() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
  }
  crownGeo.computeVertexNormals();

  // instâncias agrupadas em blocos de 250 m (frustum culling por bloco)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const chunks = new Map();
  for (const t of trees) {
    const k = Math.floor(t.x / 250) + ',' + Math.floor(t.z / 250);
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(t);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const greens = ['#3f6f2a', '#4c7d30', '#36622a', '#5a8a35', '#2f5a24', '#557a2e', '#6b8f3a'].map((c) => new THREE.Color(c));
  const col = new THREE.Color();
  const root = new THREE.Group();
  root.name = 'vegetacao';
  for (const list of chunks.values()) {
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const crown = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
    list.forEach((t, i) => {
      const y = terrain.heightAt(t.x, t.z);
      const h = 2.4 * t.s;
      m.compose(p.set(t.x, y - 0.2, t.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.r), sc.set(t.s, h + 0.6, t.s));
      trunk.setMatrixAt(i, m);
      const cr = 2.0 * t.s;
      m.compose(p.set(t.x, y + h + cr * 0.55, t.z), q, sc.set(cr, cr * (0.9 + t.v * 0.4), cr));
      crown.setMatrixAt(i, m);
      col.copy(greens[Math.floor(t.v * greens.length)]).offsetHSL(0, 0, (t.v - 0.5) * 0.06);
      crown.setColorAt(i, col);
    });
    trunk.computeBoundingSphere();
    crown.computeBoundingSphere();
    trunk.castShadow = crown.castShadow = true;
    crown.receiveShadow = true;
    root.add(trunk, crown);
  }
  return { root, count: trees.length };
}
