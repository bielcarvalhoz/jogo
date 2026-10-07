import * as THREE from 'three';
import { labelTexture } from './textures.js';
import { ringCentroid, ringArea, SpatialGrid, distToSegment } from './geo.js';
import { createWaterMaterial } from './nature.js';

// Água, muros/grades, semáforos, rótulos de lugares e a "cortina" do limite do bairro.

// ---------------------------------------------------------------- água
export function buildWater(world, terrain, { quality = 'high' } = {}) {
  const root = new THREE.Group();
  root.name = 'agua';
  const matEdgePool = new THREE.MeshStandardMaterial({ color: 0xdcd6ca, roughness: 0.8 });
  const matEdgeLake = new THREE.MeshStandardMaterial({ color: 0x5b6b45, roughness: 1 });

  for (const a of world.areas) {
    if (a.kind !== 'pool' && a.kind !== 'water') continue;
    const outer = a.rings[0];
    let hi = -Infinity;
    for (const [x, z] of outer) hi = Math.max(hi, terrain.heightAt(x, z));
    const [cx, cz] = ringCentroid([...outer, outer[0]]);
    hi = Math.max(hi, terrain.heightAt(cx, cz));
    // lago: nível calculado ao escavar o terreno; piscina: borda elevada no ponto mais alto
    const y = a.kind === 'water' && a.waterLevel !== undefined ? a.waterLevel - 0.15 : hi + 0.08;

    const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = a.rings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { continue; }
    const all = a.rings.flat();
    const pos = [];
    for (const [i, j, k] of tris) {
      const A = all[i], B = all[j], C = all[k];
      // garante face para cima
      const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      const [P, Q] = cross > 0 ? [C, B] : [B, C];
      pos.push(A[0], y, A[1], P[0], y, P[1], Q[0], y, Q[1]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    // O lago mantém o verde-oliva das fotos; piscinas têm água turquesa.
    // Um mapa de distância às margens também respeita ilhas e recortes do lago.
    const mat = createWaterMaterial(a.rings, { pool: a.kind === 'pool', color: a.waterColor, quality });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = a.kind === 'pool' ? 'piscina-ondulacoes' : 'lago-ondulacoes';
    root.add(mesh);

    // borda (vai do espelho d'água até o chão)
    const ep = [];
    for (let i = 0; i < outer.length; i++) {
      const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length];
      const ha = terrain.heightAt(ax, az) - 0.3, hb = terrain.heightAt(bx, bz) - 0.3, t = y + (a.kind === 'pool' ? 0.12 : 0.02);
      ep.push(ax, ha, az, bx, hb, bz, bx, t, bz, ax, ha, az, bx, t, bz, ax, t, az);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    eg.computeVertexNormals();
    const em = new THREE.Mesh(eg, a.kind === 'pool' ? matEdgePool : matEdgeLake);
    em.material.side = THREE.DoubleSide;
    root.add(em);
  }
  return root;
}

// ---------------------------------------------------------------- muros, grades, guard-rails
const BARRIER = {
  wall: { h: 2.2, color: 0xc9c3b6 },
  retaining_wall: { h: 1.5, color: 0xa39e93 },
  fence: { h: 1.8, color: 0x4a5a52 },
  guard_rail: { h: 0.8, color: 0xb8bcc0 },
};

export function buildBarriers(world, terrain, builder) {
  const root = new THREE.Group();
  root.name = 'muros';
  const byKind = {};
  for (const b of world.barriers) {
    const spec = BARRIER[b.kind];
    const arr = (byKind[b.kind] ||= []);
    for (let i = 0; i < b.pts.length - 1; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n;
        const x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
        const h0 = terrain.heightAt(x0, z0), h1 = terrain.heightAt(x1, z1);
        arr.push(x0, h0 - 0.3, z0, x1, h1 - 0.3, z1, x1, h1 + spec.h, z1, x0, h0 - 0.3, z0, x1, h1 + spec.h, z1, x0, h0 + spec.h, z0);
      }
    }
    if (b.kind !== 'guard_rail') builder.addBarrier(b.pts, spec.h);
  }
  for (const [kind, arr] of Object.entries(byKind)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: BARRIER[kind].color, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

// ---------------------------------------------------------------- semáforos
export function buildTrafficSignals(world, terrain) {
  const grid = new SpatialGrid(30);
  for (const r of world.roads) {
    if (r.kind === 'foot') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      grid.insertBox({ r, ax, az, bx, bz }, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    }
  }
  const spots = [];
  for (const p of world.points) {
    if (p.tags.highway !== 'traffic_signals') continue;
    let best = null, bd = Infinity;
    for (const s of grid.query(p.x, p.z, 5)) {
      const q = distToSegment(p.x, p.z, s.ax, s.az, s.bx, s.bz);
      if (q.d < bd) { bd = q.d; best = s; }
    }
    if (!best) continue;
    const L = Math.hypot(best.bx - best.ax, best.bz - best.az) || 1;
    const tx = (best.bx - best.ax) / L, tz = (best.bz - best.az) / L;
    const off = best.r.w / 2 + 0.9;
    // um poste de cada lado da via
    for (const side of [1, -1]) spots.push({ x: p.x - tz * off * side, z: p.z + tx * off * side, yaw: Math.atan2(tx, tz) + (side > 0 ? 0 : Math.PI), reach: Math.min(best.r.w * 0.45, 4) });
  }
  const root = new THREE.Group();
  root.name = 'semaforos';
  if (!spots.length) return { root, update() {} };

  const poleG = new THREE.CylinderGeometry(0.08, 0.1, 5, 8); poleG.translate(0, 2.5, 0);
  const armG = new THREE.BoxGeometry(0.08, 0.08, 1); armG.translate(0, 0, 0.5);
  const boxG = new THREE.BoxGeometry(0.36, 1.05, 0.3);
  const lampG = new THREE.CircleGeometry(0.11, 12);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.6 });
  const pole = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.5, metalness: 0.6 }), spots.length);
  const arm = new THREE.InstancedMesh(armG, pole.material, spots.length);
  const box = new THREE.InstancedMesh(boxG, dark, spots.length);
  const lampMats = [0xff2a1a, 0xffc21a, 0x2aff5a].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const lamps = lampMats.map((mat) => new THREE.InstancedMesh(lampG, mat, spots.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach((sp, i) => {
    const y = terrain.heightAt(sp.x, sp.z);
    // braço aponta para o meio da via (perpendicular)
    q.setFromAxisAngle(up, sp.yaw + Math.PI / 2);
    pole.setMatrixAt(i, m.compose(v.set(sp.x, y, sp.z), q, s1));
    arm.setMatrixAt(i, m.compose(v.set(sp.x, y + 4.9, sp.z), q, new THREE.Vector3(1, 1, sp.reach)));
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const bx = sp.x + dir.x * sp.reach, bz = sp.z + dir.z * sp.reach;
    const qBox = new THREE.Quaternion().setFromAxisAngle(up, sp.yaw);
    box.setMatrixAt(i, m.compose(v.set(bx, y + 4.4, bz), qBox, s1));
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(qBox);
    [0.32, 0, -0.32].forEach((dy, k) => lamps[k].setMatrixAt(i, m.compose(v.set(bx + face.x * 0.16, y + 4.4 + dy, bz + face.z * 0.16), qBox, s1)));
  });
  pole.castShadow = box.castShadow = true;
  root.add(pole, arm, box, ...lamps);

  // ciclo verde -> amarelo -> vermelho
  const offColor = new THREE.Color(0x222222);
  const onColors = [0xff2a1a, 0xffc21a, 0x2aff5a].map((c) => new THREE.Color(c));
  function update(t) {
    const c = t % 30;
    const active = c < 14 ? 2 : c < 17 ? 1 : 0;
    lampMats.forEach((mat, k) => mat.color.copy(k === active ? onColors[k] : offColor));
  }
  return { root, update };
}

// ---------------------------------------------------------------- rótulos de lugares
const ICON = {
  restaurant: '🍽', fast_food: '🍔', cafe: '☕', bar: '🍺', pub: '🍺', pharmacy: '💊', school: '🎓', university: '🎓',
  kindergarten: '🧸', police: '🚓', fuel: '⛽', bank: '🏦', place_of_worship: '⛪', hospital: '🏥', clinic: '🏥',
  dentist: '🦷', bus_station: '🚌', dojo: '🥋', bakery: '🥖', butcher: '🥩', hairdresser: '💈', supermarket: '🛒',
  convenience: '🏪', hardware: '🔧', greengrocer: '🥬', motorcycle: '🏍', mall: '🛍', parking: '🅿',
};

export function buildLabels(world, terrain, builders) {
  const items = [];
  const seen = new Set();
  const addLabel = (name, kind, x, z, y) => {
    const key = name + Math.round(x / 30) + ',' + Math.round(z / 30);
    if (seen.has(key)) return;
    seen.add(key);
    const icon = ICON[kind] || '📍';
    const { texture, width, height } = labelTexture(`${icon} ${name}`, null);
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: true, transparent: true });
    const sp = new THREE.Sprite(mat);
    const k = 0.032;
    sp.scale.set(width * k, height * k, 1);
    sp.position.set(x, y, z);
    sp.center.set(0.5, 0);
    sp.visible = false;
    items.push(sp);
  };

  for (const b of world.buildings) {
    const t = b.tags;
    if (!t.name) continue;
    const outer = b.rings[0];
    const [cx, cz] = ringCentroid([...outer, outer[0]]);
    const top = builders.real.roofAt(cx, cz, 1e9);
    const y = (isFinite(top) ? top : terrain.heightAt(cx, cz) + 6) + 1.5;
    addLabel(t.name, t.amenity || t.shop || (t.building === 'school' ? 'school' : t.building === 'church' ? 'place_of_worship' : t.building === 'transportation' ? 'bus_station' : t.building === 'retail' && Math.abs(ringArea(outer)) > 3000 ? 'mall' : ''), cx, cz, y);
  }
  for (const p of world.points) {
    const t = p.tags;
    if (!t.name || (!t.amenity && !t.shop)) continue;
    const top = builders.real.roofAt(p.x, p.z, 1e9);
    addLabel(t.name, t.amenity || t.shop, p.x, p.z, (isFinite(top) ? top : terrain.heightAt(p.x, p.z) + 3.5) + 1.5);
  }
  for (const a of world.areas) {
    const t = a.tags;
    if (!t.name || !['park', 'golf', 'sports', 'school'].includes(a.kind)) continue;
    const outer = a.rings[0];
    const [cx, cz] = ringCentroid([...outer, outer[0]]);
    addLabel(t.name, a.kind === 'park' ? '' : a.kind === 'golf' ? '' : t.amenity || '', cx, cz, terrain.heightAt(cx, cz) + 4);
  }

  const root = new THREE.Group();
  root.name = 'rotulos';
  root.add(...items);
  function update(camPos) {
    for (const s of root.children) {
      const d = s.position.distanceTo(camPos);
      s.visible = d < 160;
      if (s.visible) s.material.opacity = Math.min(1, (160 - d) / 40);
    }
  }
  return { root, update, count: items.length };
}

// ---------------------------------------------------------------- limite da Cidade de Deus
export function buildQuarterBoundary(quarter, terrain) {
  const root = new THREE.Group();
  root.name = 'limite-cidade-de-deus';
  if (!quarter) return root;
  const ring = quarter[0];
  const pos = [], alpha = [];
  const H = 4;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / 4));
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n;
      const x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
      const h0 = terrain.heightAt(x0, z0), h1 = terrain.heightAt(x1, z1);
      pos.push(x0, h0, z0, x1, h1, z1, x1, h1 + H, z1, x0, h0, z0, x1, h1 + H, z1, x0, h0 + H, z0);
      alpha.push(1, 1, 0, 1, 0, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('alpha', new THREE.Float32BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute float alpha; varying float vA; varying float vY;
      void main(){ vA = alpha; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying float vA; varying float vY;
      void main(){ float pulse = 0.65 + 0.35 * sin(uTime * 2.0 + vY * 0.8);
        gl_FragColor = vec4(1.0, 0.78, 0.25, vA * vA * 0.55 * pulse); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  root.add(mesh);

  // marco: placa gigante "CIDADE DE DEUS" sobre o centro do bairro
  const [cx, cz] = ringCentroid([...ring, ring[0]]);
  const { texture, width, height } = labelTexture('CIDADE DE DEUS', 'Osasco · SP', '#ffc940');
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, fog: false }));
  sp.scale.set(width * 0.11, height * 0.11, 1);
  sp.position.set(cx, terrain.heightAt(cx, cz) + 55, cz);
  root.add(sp);
  root.userData.update = (t) => { mat.uniforms.uTime.value = t; };
  return root;
}
