import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { openRing, pointInPolygon, pointInRing, ringArea, ringCentroid, SpatialGrid, distToSegment } from './geo.js';
import { createBuildingBuilder } from './buildings.js';
import { pixelFacade, pixelRoof, helipadTexture, stripeTexture, pixelSign, labelTexture } from './textures.js';
import { mulberry32 } from './rng.js';

// Núcleo Cidade de Deus (matriz do Bradesco) em estilo cartoon/pixel.
// Os dados vêm de public/data/campus-cidade-de-deus.geojson (ver scripts/build-campus.mjs).

const RED = '#c8102e';

// ---------------------------------------------------------------- 1) preparar (antes de pintar o chão)
/**
 * Lê o GeoJSON do campus, aplica os ajustes sobre feições do OSM e injeta as áreas
 * (estacionamentos, mata, pista...) no `world`, para o chão e as máscaras já saírem certos.
 */
export function prepareCampus(geo, world, proj) {
  const toLocal = (ring) => openRing(ring.map(([lon, lat]) => proj.toLocal(lon, lat)));
  const C = { buildings: [], obelisks: [], tents: [], gates: [], parkings: [], track: null };
  const ov = geo.osmOverrides || {};

  // prédios do OSM que passam a ser desenhados no estilo do campus
  world.buildings = world.buildings.filter((b) => {
    const o = ov[b.id];
    if (!o || o.kind !== 'building') return true;
    C.buildings.push({ ...o, rings: b.rings, osm: b.id });
    return false;
  });
  for (const a of world.areas) {
    const o = ov[a.id];
    if (!o) continue;
    if (o.kind === 'court') a.kind = 'court';
    if (o.kind === 'lawn') { a.kind = 'grass'; a.tags = { ...a.tags, note: 'gramado (OSM marca lago)' }; }
    if (o.kind === 'track' && !C.track) C.track = makeTrack(a.rings[0]);
  }
  if (C.track) world.areas.push({ id: 'cdd/pista', tags: {}, kind: 'track', rings: [C.track.outer], lanes: C.track.lanes });

  for (const f of geo.features) {
    const p = f.properties, g = f.geometry;
    if (g.type === 'Polygon') {
      const rings = g.coordinates.map(toLocal);
      if (p.kind === 'building') C.buildings.push({ ...p, rings });
      else if (p.kind === 'parking') { world.areas.push({ id: 'cdd/estacionamento', tags: {}, kind: 'parking', rings }); C.parkings.push({ rings, angle: p.angle || 0 }); }
      else if (p.kind === 'forest') world.areas.push({ id: 'cdd/mata', tags: {}, kind: 'wood', rings });
      else if (p.kind === 'pool') world.areas.push({ id: 'cdd/piscina', tags: {}, kind: 'pool', rings });
    } else if (g.type === 'Point') {
      const [x, z] = proj.toLocal(g.coordinates[0], g.coordinates[1]);
      if (p.kind === 'obelisk') C.obelisks.push({ ...p, x, z });
      if (p.kind === 'tent') C.tents.push({ ...p, x, z });
      if (p.kind === 'gate') C.gates.push({ ...p, x, z });
    }
  }
  C.quarter = world.quarter;
  // o campus é um parque: gramado por baixo de tudo + árvores espalhadas
  if (world.quarter) world.areas.unshift({ id: 'cdd/gramado', tags: {}, kind: 'campus', rings: world.quarter });
  return C;
}

/** pista de atletismo de 8 raias em volta do campo (planta do OSM) */
function makeTrack(field) {
  // eixo maior = maior aresta do retângulo do campo
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < field.length; i++) {
    const [ax, az] = field[i], [bx, bz] = field[(i + 1) % field.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L > best) { best = L; ux = (bx - ax) / L; uz = (bz - az) / L; }
  }
  const [cx, cz] = ringCentroid([...field, field[0]]);
  let halfW = 0;
  for (const [x, z] of field) halfW = Math.max(halfW, Math.abs((x - cx) * -uz + (z - cz) * ux));
  const straight = 42.2; // metade da reta oficial (84,39 m)
  const rIn = Math.max(36.5, halfW + 1.5);
  const oval = (r, n = 36) => {
    const pts = [];
    for (const side of [1, -1])
      for (let i = 0; i <= n; i++) {
        const t = -Math.PI / 2 + (Math.PI * i) / n;
        const lu = side * (straight + Math.cos(t) * r), lv = side * Math.sin(t) * r;
        pts.push([cx + ux * lu - uz * lv, cz + uz * lu + ux * lv]);
      }
    return pts;
  };
  const lanes = [];
  for (let k = 0; k <= 8; k++) lanes.push(oval(rIn + k * 1.22));
  return { cx, cz, ux, uz, straight, rIn, rOut: rIn + 9.76, outer: oval(rIn + 9.76 + 0.6), lanes };
}

// ---------------------------------------------------------------- 2) construir
export function buildCampus(C, { scene, renderer, terrain, world, masks }) {
  const root = new THREE.Group();
  root.name = 'campus-cidade-de-deus';
  const rnd = mulberry32(777);

  // estilos de fachada pixel (1 por cor de janela)
  const styles = {};
  const styleFor = (b) => {
    const key = `cdd_${b.roofShape === 'tileFlat' || b.roofShape === 'tile' || b.roofShape === 'pyramid' ? 'school' : 'office'}_${b.windows || '#2b3f55'}`;
    if (!styles[key]) styles[key] = { texture: pixelFacade(renderer, b.windows || '#2b3f55', key.includes('school') ? 'school' : 'office'), bay: 3.2, floor: 3.4, mat: { roughness: 0.8, metalness: 0 } };
    return key;
  };
  for (const b of C.buildings) b.style = styleFor(b);
  const builder = createBuildingBuilder(renderer, terrain, { styles, roofTextures: { roofFlat: pixelRoof(renderer, 'flat'), roofTile: pixelRoof(renderer, 'tile') } });

  // pedaços extras agrupados por cor (faixas, molduras, nervuras, equipamentos...)
  const parts = new Map();
  const addPart = (color, geom) => { if (!parts.has(color)) parts.set(color, []); parts.get(color).push(geom); };
  const box = (color, cx, cy, cz, sx, sy, sz, yaw = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(yaw);
    g.translate(cx, cy, cz);
    addPart(color, g);
  };
  const outline = [];
  const labels = [];
  const label = (text, icon, x, y, z) => labels.push({ text: `${icon} ${text}`, x, y, z });

  // ---------------------------------------------------- prédios
  for (const b of C.buildings) {
    const rings = b.rings.map((r) => r.slice());
    const outer = rings[0];
    if (outer.length < 3) continue;
    const roofShape = b.roofShape === 'tile' ? 'tileFlat' : b.roofShape === 'pyramid' ? 'pyramid' : 'flat';
    const info = builder.add({
      id: b.osm || b.name || 'cdd', rings, height: b.height, style: b.style, floorH: b.height / (b.levels || 3),
      wall: b.wall, roof: b.roof, roofShape, noParapet: b.roofShape === 'ribbed',
    });
    if (!info) continue;
    const { gMin, top, cx, cz } = info;
    const sign = Math.sign(ringArea(outer)) || 1;
    const edges = ringEdges(outer, sign);
    const maxEdge = Math.max(...edges.map((e) => e.L));
    const axis = edges.find((e) => e.L === maxEdge);

    // contorno preto (cartoon)
    for (const [x, z] of outer) outline.push(x, Math.max(gMin, terrain.heightAt(x, z)) , z, x, top + (roofShape === 'flat' && b.roofShape !== 'ribbed' ? 0.5 : 0), z);
    for (const e of edges) { const y = top + (roofShape === 'flat' && b.roofShape !== 'ribbed' ? 0.5 : 0); outline.push(e.ax, y, e.az, e.bx, y, e.bz); }

    // destaques de fachada
    const accent = b.accentColor || RED;
    if (b.accent === 'bandaCentral') {
      for (const e of edges) if (e.L > maxEdge * 0.6) {
        const mx = (e.ax + e.bx) / 2 + e.nx * 0.2, mz = (e.az + e.bz) / 2 + e.nz * 0.2;
        const h = top + 1.2 - gMin;
        box(accent, mx, gMin + h / 2, mz, 9, h, 0.5, Math.atan2(-e.dz, e.dx));
      }
    }
    if (b.accent === 'moldura') {
      for (const e of edges) {
        const mx = (e.ax + e.bx) / 2 + e.nx * 0.18, mz = (e.az + e.bz) / 2 + e.nz * 0.18;
        box(accent, mx, top + 0.1, mz, e.L + 0.4, 1.4, 0.4, Math.atan2(-e.dz, e.dx));
        box(accent, e.ax + e.nx * 0.18, (gMin + top) / 2, e.az + e.nz * 0.18, 0.8, top - gMin, 0.8, Math.atan2(-e.dz, e.dx));
      }
    }
    if (b.accent === 'faixa') {
      const levels = b.levels || 2, fh = b.height / levels;
      const ys = b.name === 'Prédio Verde' ? Array.from({ length: levels }, (_, k) => gMin + fh * (k + 1) - 0.4) : [gMin + fh - 0.2, top - 0.4];
      for (const y of ys)
        for (const e of edges) {
          const mx = (e.ax + e.bx) / 2 + e.nx * 0.15, mz = (e.az + e.bz) / 2 + e.nz * 0.15;
          box(accent, mx, y, mz, e.L + 0.3, 0.7, 0.3, Math.atan2(-e.dz, e.dx));
        }
    }

    // coberturas especiais
    if (b.roofShape === 'ribbed') {
      // nervuras (telhas trapezoidais) ao longo do eixo maior
      const ux = axis.dx, uz = axis.dz, vx = -uz, vz = ux;
      let vMin = Infinity, vMax = -Infinity;
      for (const [x, z] of outer) { const v = (x - cx) * vx + (z - cz) * vz; vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
      const ribColor = '#' + new THREE.Color(b.roof || '#dddddd').multiplyScalar(0.82).getHexString();
      for (let v = vMin + 1.5; v < vMax - 1; v += 3.2) {
        const seg = lineThroughPolygon(outer, cx + vx * v, cz + vz * v, ux, uz);
        if (!seg) continue;
        const [s0, s1] = seg;
        const len = s1 - s0 - 1.2;
        if (len < 2) continue;
        const sm = (s0 + s1) / 2;
        box(ribColor, cx + vx * v + ux * sm, top + 0.35, cz + vz * v + uz * sm, len, 0.7, 1.1, Math.atan2(-uz, ux));
      }
    } else if (b.roofShape === 'heliport') {
      const t = (b.helipadAt ?? 0.5) - 0.5;
      const ux = axis.dx, uz = axis.dz;
      let uMin = Infinity, uMax = -Infinity;
      for (const [x, z] of outer) { const u = (x - cx) * ux + (z - cz) * uz; uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); }
      const u = (uMin + uMax) / 2 + t * (uMax - uMin);
      const px = cx + ux * u, pz = cz + uz * u;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshStandardMaterial({ map: helipadTexture(renderer), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      pad.rotation.set(-Math.PI / 2, 0, Math.atan2(-uz, ux));
      pad.position.set(px, top + 0.04, pz);
      pad.receiveShadow = true;
      root.add(pad);
      label(b.label || 'Heliponto', '🚁', px, top + 3, pz);
    } else if (roofShape === 'flat' && Math.abs(ringArea(outer)) > 1200) {
      // equipamentos de ar-condicionado na laje
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n * 4 && n > 0; k++) {
        const ux = axis.dx, uz = axis.dz;
        const x = cx + (rnd() - 0.5) * maxEdge * 0.7 * ux + (rnd() - 0.5) * 12 * -uz;
        const z = cz + (rnd() - 0.5) * maxEdge * 0.7 * uz + (rnd() - 0.5) * 12 * ux;
        if (!pointInPolygon(x, z, rings)) continue;
        box('#b9bdc1', x, top + 0.8, z, 3.2, 1.6, 2.2, Math.atan2(-uz, ux));
        if (k >= n) break;
      }
    }

    markPolygon(masks, rings, 2);
    const name = b.name || (b.label && b.roofShape !== 'heliport' ? b.label : null);
    if (name) label(name, name.startsWith('Fundação') ? '🎓' : name === 'Arena' ? '🏟' : '🏦', cx, top + 2.5, cz);
  }

  // ---------------------------------------------------- obelisco
  for (const o of C.obelisks) {
    const y = terrain.heightAt(o.x, o.z);
    const shaftH = o.height * 0.88;
    const shaft = new THREE.CylinderGeometry(o.base * 0.38, o.base * 0.62, shaftH, 4);
    shaft.rotateY(Math.PI / 4);
    shaft.translate(o.x, y + 1 + shaftH / 2, o.z);
    const tip = new THREE.ConeGeometry(o.base * 0.38 * Math.SQRT2 / Math.SQRT2, o.height - shaftH, 4);
    tip.rotateY(Math.PI / 4);
    tip.translate(o.x, y + 1 + shaftH + (o.height - shaftH) / 2, o.z);
    addPart('#f4f4f2', shaft);
    addPart('#f4f4f2', tip);
    box('#c9c6bd', o.x, y + 0.3, o.z, o.base * 2.2, 1.6, o.base * 2.2);
    const r = o.base * 1.1;
    builder.addSolid([[[o.x - r, o.z - r], [o.x + r, o.z - r], [o.x + r, o.z + r], [o.x - r, o.z + r]]], y + o.height, 'campus');
    markPolygon(masks, [[[o.x - r, o.z - r], [o.x + r, o.z - r], [o.x + r, o.z + r], [o.x - r, o.z + r]]], 2);
    outline.push(o.x, y + 1, o.z, o.x, y + o.height + 1, o.z);
  }

  // ---------------------------------------------------- tenda branca
  for (const t of C.tents) {
    const y = terrain.heightAt(t.x, t.z) - 0.3;
    const wall = new THREE.CylinderGeometry(t.radius, t.radius, t.wallHeight + 0.3, t.sides, 1, true);
    wall.translate(t.x, y + (t.wallHeight + 0.3) / 2, t.z);
    const cone = new THREE.ConeGeometry(t.radius * 1.06, t.height - t.wallHeight, t.sides);
    cone.translate(t.x, y + t.wallHeight + 0.3 + (t.height - t.wallHeight) / 2, t.z);
    addPart('#fbfbf8', wall);
    addPart('#ffffff', cone);
    const ring = Array.from({ length: t.sides }, (_, i) => { const a = (i / t.sides) * Math.PI * 2; return [t.x + Math.cos(a) * t.radius, t.z + Math.sin(a) * t.radius]; });
    builder.addSolid([ring], y + t.wallHeight, 'campus');
    markPolygon(masks, [ring], 2);
  }

  // ---------------------------------------------------- arquibancada da pista
  if (C.track) {
    const T = C.track;
    // lado leste (onde fica a arquibancada nas imagens)
    const vx = -T.uz, vz = T.ux;
    const side = vx >= 0 ? 1 : -1;
    const sx = vx * side, sz = vz * side;
    const len = T.straight * 2;
    const yaw = Math.atan2(-T.uz, T.ux);
    for (let k = 0; k < 8; k++) {
      const off = T.rOut + 1.5 + k * 1.6 + 0.8;
      const px = T.cx + sx * off, pz = T.cz + sz * off;
      const gy = terrain.heightAt(px, pz);
      const h = 0.9 + k * 0.75;
      box(k % 2 ? '#d9dcdf' : '#c9cdd1', px, gy - 0.5 + (h + 0.5) / 2, pz, len, h + 0.5, 1.6, yaw);
    }
    // cobertura
    const offR = T.rOut + 1.5 + 6.4;
    const rx = T.cx + sx * offR, rz = T.cz + sz * offR;
    const ry = terrain.heightAt(rx, rz) + 9.5;
    box('#f2f2ef', rx, ry, rz, len, 0.5, 15, yaw);
    box(RED, rx + sx * 7.5, ry - 0.2, rz + sz * 7.5, len, 0.9, 0.4, yaw);
    const back = T.rOut + 1.5 + 13.6;
    for (let u = -T.straight; u <= T.straight; u += 14) {
      const px = T.cx + T.ux * u + sx * back, pz = T.cz + T.uz * u + sz * back;
      const gy = terrain.heightAt(px, pz);
      box('#9da1a5', px, (gy + ry) / 2, pz, 0.6, ry - gy, 0.6);
    }
    const c0 = T.rOut + 1.5, c1 = T.rOut + 1.5 + 13.6;
    const foot = [[-1, c0], [1, c0], [1, c1], [-1, c1]].map(([s, o]) => [T.cx + T.ux * s * T.straight + sx * o, T.cz + T.uz * s * T.straight + sz * o]);
    builder.addSolid([foot], terrain.heightAt(T.cx + sx * c1, T.cz + sz * c1) + 6.5, 'campus');
    markPolygon(masks, [foot], 2);
    label('Pista de atletismo', '🏃', T.cx, terrain.heightAt(T.cx, T.cz) + 4, T.cz);
  }

  // ---------------------------------------------------- portarias e portões
  const carRoads = world.roads.filter((r) => r.kind !== 'foot');
  const roadGrid = new SpatialGrid(20);
  for (const r of carRoads)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      roadGrid.insertBox({ r, ax, az, bx, bz }, Math.min(ax, bx) - r.w, Math.min(az, bz) - r.w, Math.max(ax, bx) + r.w, Math.max(az, bz) + r.w);
    }
  const nearestRoad = (x, z, maxD = 15, anyKind = false) => {
    let best = null, bd = Infinity;
    const grid = anyKind ? null : roadGrid;
    const list = grid ? grid.query(x, z, maxD) : world.roads.flatMap((r) => r.pts.slice(0, -1).map((p, i) => ({ r, ax: p[0], az: p[1], bx: r.pts[i + 1][0], bz: r.pts[i + 1][1] })));
    for (const s of list) {
      const q = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
      if (q.d < bd) { bd = q.d; best = { ...s, ...q }; }
    }
    return bd <= maxD ? best : null;
  };
  const stripe = stripeTexture(renderer);
  const armMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 });
  const arms = [];
  const spawnPoints = [];

  for (const gate of C.gates) {
    const near = nearestRoad(gate.x, gate.z, 15, gate.type === 'pedestre');
    if (!near) continue;
    const L = Math.hypot(near.bx - near.ax, near.bz - near.az) || 1;
    const tx = (near.bx - near.ax) / L, tz = (near.bz - near.az) / L;
    const nx = -tz, nz = tx;
    const px = near.cx, pz = near.cz;
    const w = near.r.w;
    const gy = terrain.heightAt(px, pz);
    const yawAcross = Math.atan2(-nz, nx); // eixo x local atravessando a via
    // lado da guarita: o que não cai em outra via
    const sideFree = (s) => !nearestRoad(px + nx * s * (w / 2 + 3), pz + nz * s * (w / 2 + 3), w / 2 + 1);
    const bs = sideFree(1) ? 1 : -1;

    if (gate.type === 'portaria') {
      // marquise sobre a via
      const span = w + 7;
      const my = gy + 5.2;
      box('#ffffff', px, my, pz, span, 0.6, 9, yawAcross);
      box(RED, px + tx * 4.6, my - 0.35, pz + tz * 4.6, span, 1.2, 0.3, yawAcross);
      box(RED, px - tx * 4.6, my - 0.35, pz - tz * 4.6, span, 1.2, 0.3, yawAcross);
      for (const s of [-1, 1]) for (const a of [-1, 1]) {
        const qx = px + nx * s * (span / 2 - 0.5) + tx * a * 3.8, qz = pz + nz * s * (span / 2 - 0.5) + tz * a * 3.8;
        const qy = terrain.heightAt(qx, qz);
        box('#d6d6d2', qx, (qy + my) / 2, qz, 0.5, my - qy, 0.5);
      }
      // placa com o nome, dos dois lados
      const { texture, aspect } = pixelSign(renderer, gate.name.replace('Portaria ', 'PORTARIA ').toUpperCase());
      for (const a of [1, -1]) {
        const sh = 1.1, sw = Math.min(span - 1, sh * aspect);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: texture }));
        sign.position.set(px + tx * a * 4.78, my - 0.35, pz + tz * a * 4.78);
        sign.rotation.y = Math.atan2(tx * a, tz * a);
        root.add(sign);
      }
      // guarita
      if (gate.booth !== false) {
        const gx = px + nx * bs * (w / 2 + 2.6), gz = pz + nz * bs * (w / 2 + 2.6);
        const ring = rectRing(gx, gz, tx, tz, 4.2, 3.2);
        const info = builder.add({ id: 'guarita', rings: [ring], height: 3.2, style: styleFor({ windows: '#2b3f55' }), floorH: 3.2, wall: '#ffffff', roof: RED, roofShape: 'flat' });
        if (info) {
          box(RED, gx, info.gMin + 1.1, gz, 4.4, 0.35, 3.4, Math.atan2(-tz, tx));
          for (const [x, z] of ring) outline.push(x, info.gMin, z, x, info.top + 0.5, z);
        }
        markPolygon(masks, [ring], 2);
        label(gate.name, '🚧', gx, gy + 8, gz);
      }
      // cancelas (uma por sentido) — sobem quando o jogador chega perto
      for (const s of [1, -1]) {
        const pivot = new THREE.Object3D();
        pivot.position.set(px + nx * s * (w / 2 + 0.2) + tx * s * 1.5, gy + 1.0, pz + nz * s * (w / 2 + 0.2) + tz * s * 1.5);
        pivot.rotation.y = Math.atan2(nz * s, -nx * s); // braço aponta para o meio da via
        const armLen = w / 2 + 0.2;
        const geo = new THREE.BoxGeometry(armLen, 0.12, 0.12);
        geo.translate(armLen / 2, 0, 0);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * armLen * 0.8);
        const arm = new THREE.Mesh(geo, armMat);
        arm.castShadow = true;
        pivot.add(arm);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.45), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }));
        post.position.y = -0.45;
        pivot.add(post);
        root.add(pivot);
        arms.push({ arm, x: pivot.position.x, z: pivot.position.z, angle: 0 });
      }
      // ponto de chegada (fora do campus, olhando para a portaria)
      if (gate.booth !== false) {
        const outside = (s) => C.quarter && !pointInPolygon(px + tx * s * 22, pz + tz * s * 22, C.quarter);
        const s = outside(1) ? 1 : -1;
        let sx = px + tx * s * 22, sz = pz + tz * s * 22;
        // encaixa no asfalto mais próximo (a rua de acesso pode fazer curva)
        const snap = nearestRoad(sx, sz, 20);
        if (snap) { sx = snap.cx; sz = snap.cz; }
        spawnPoints.push({ name: gate.name, x: sx, z: sz, yaw: Math.atan2(-(px - sx), -(pz - sz)) });
      }
    } else if (gate.type === 'portao') {
      // portão de grade fechado
      const span = w + 1;
      const h = 2.4;
      for (let o = -span / 2; o <= span / 2; o += 0.18) box('#3d4248', px + nx * o, gy + h / 2, pz + nz * o, 0.06, h, 0.06);
      box('#3d4248', px, gy + h - 0.1, pz, span, 0.14, 0.12, yawAcross);
      box('#3d4248', px, gy + 0.3, pz, span, 0.14, 0.12, yawAcross);
      builder.addBarrier([[px - nx * span / 2, pz - nz * span / 2], [px + nx * span / 2, pz + nz * span / 2]], h);
    } else if (gate.type === 'pedestre') {
      const gx = px + nx * (w / 2 + 1.5), gz = pz + nz * (w / 2 + 1.5);
      box('#ffffff', gx, gy + 1.2, gz, 1.6, 2.4, 1.6, yawAcross);
      box(RED, gx, gy + 2.5, gz, 1.9, 0.3, 1.9, yawAcross);
    }
  }

  // ---------------------------------------------------- muro ao longo do limite do bairro
  if (C.quarter) {
    const ring = C.quarter[0];
    const wallRuns = [];
    let run = [];
    const blocked = (x, z) => {
      for (const s of roadGrid.query(x, z, 10)) {
        const q = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
        if (q.d < s.r.w / 2 + 1.4) return true;
      }
      for (const g of C.gates) if (Math.hypot(g.x - x, g.z - z) < 7) return true;
      if (builder.roofAt(x, z, 1e9) > -Infinity) return true;
      return false;
    };
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / 1.5));
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (blocked(x, z)) { if (run.length > 1) wallRuns.push(run); run = []; }
        else run.push([x, z]);
      }
    }
    if (run.length > 1) wallRuns.push(run);
    const H = 2.8;
    const pos = [];
    for (const r of wallRuns) {
      for (let i = 0; i < r.length - 1; i++) {
        const [x0, z0] = r[i], [x1, z1] = r[i + 1];
        if (Math.hypot(x1 - x0, z1 - z0) > 3) continue; // pulo entre trechos
        const h0 = terrain.heightAt(x0, z0), h1 = terrain.heightAt(x1, z1);
        pos.push(x0, h0 - 0.4, z0, x1, h1 - 0.4, z1, x1, h1 + H, z1, x0, h0 - 0.4, z0, x1, h1 + H, z1, x0, h0 + H, z0);
        const L = Math.hypot(x1 - x0, z1 - z0);
        box('#b3ada2', (x0 + x1) / 2, (h0 + h1) / 2 + H + 0.08, (z0 + z1) / 2, L + 0.05, 0.22, 0.38, Math.atan2(-(z1 - z0), x1 - x0));
      }
      builder.addBarrier(r, H);
      for (const [x, z] of r) { masks.build.set(x, z); masks.tree.set(x, z); }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.computeVertexNormals();
    const wall = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0xdcd7cd, roughness: 0.95, side: THREE.DoubleSide }));
    wall.castShadow = wall.receiveShadow = true;
    wall.name = 'muro-campus';
    root.add(wall);
  }

  // ---------------------------------------------------- carros nos estacionamentos
  const cars = [];
  for (const p of C.parkings) {
    const outer = p.rings[0];
    const [cx, cz] = ringCentroid([...outer, outer[0]]);
    const a = (p.angle * Math.PI) / 180;
    const ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const [x, z] of outer) {
      const u = (x - cx) * ux + (z - cz) * uz, v = (x - cx) * vx + (z - cz) * vz;
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    for (let v0 = vMin + 2.8; v0 < vMax - 2.5; v0 += 16)
      for (const v of [v0, v0 + 5.2]) {
        if (v > vMax - 2.5) continue;
        for (let u = uMin + 2; u < uMax - 2; u += 2.6) {
          const x = cx + ux * u + vx * v, z = cz + uz * u + vz * v;
          if (!pointInPolygon(x, z, p.rings) || rnd() > 0.72) continue;
          if (builder.roofAt(x, z, 1e9) > -Infinity) continue;
          cars.push({ x, z, yaw: Math.atan2(vx, vz) + (rnd() < 0.5 ? Math.PI : 0) });
        }
      }
  }
  if (cars.length) {
    const body = new THREE.BoxGeometry(1.8, 0.75, 4.3); body.translate(0, 0.62, 0);
    const cabin = new THREE.BoxGeometry(1.55, 0.6, 2.2); cabin.translate(0, 1.28, -0.2);
    const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), cars.length);
    const cabins = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial({ color: 0x24303b, roughness: 0.3 }), cars.length);
    const palette = [['#f4f4f4', 35], ['#b9bdc2', 25], ['#1d1f22', 20], ['#6b7076', 10], ['#b3202a', 5], ['#2a4f8f', 5]];
    const pickColor = () => { let r = rnd() * 100; for (const [c, w] of palette) { if ((r -= w) <= 0) return c; } return palette[0][0]; };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    cars.forEach((c, i) => {
      m.compose(v.set(c.x, terrain.heightAt(c.x, c.z), c.z), q.setFromAxisAngle(up, c.yaw), s1);
      bodies.setMatrixAt(i, m);
      cabins.setMatrixAt(i, m);
      bodies.setColorAt(i, col.set(pickColor()));
    });
    bodies.castShadow = cabins.castShadow = true;
    bodies.computeBoundingSphere(); cabins.computeBoundingSphere();
    bodies.name = 'carros';
    root.add(bodies, cabins);
  }

  // ---------------------------------------------------- malhas finais
  for (const [color, geoms] of parts) {
    const merged = mergeGeometries(geoms.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  if (outline.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x17191c, transparent: true, opacity: 0.75 }));
    lines.name = 'contornos';
    root.add(lines);
  }
  const buildingsRoot = builder.finish(root);
  buildingsRoot.name = 'predios-campus';
  scene.add(root);

  // rótulos (sprites) — atualizados junto com os demais
  const sprites = labels.map((l) => {
    const { texture, width, height } = labelTexture(l.text, null, RED);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sp.scale.set(width * 0.032, height * 0.032, 1);
    sp.center.set(0.5, 0);
    sp.position.set(l.x, l.y, l.z);
    sp.visible = false;
    return sp;
  });

  function update(dt, playerPos) {
    for (const a of arms) {
      const near = Math.hypot(playerPos.x - a.x, playerPos.z - a.z) < 12;
      const target = near ? 1.35 : 0;
      a.angle += (target - a.angle) * Math.min(1, dt * 3);
      a.arm.rotation.z = a.angle;
    }
  }

  return { root, builder, sprites, update, spawnPoints, count: C.buildings.length };
}

// ---------------------------------------------------------------- utilidades
function ringEdges(ring, sign) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    // mesma convenção de normal externa do buildings.js
    const nx = sign > 0 ? dz : -dz, nz = sign > 0 ? -dx : dx;
    out.push({ ax, az, bx, bz, L, dx, dz, nx, nz });
  }
  return out;
}

/** intervalo [s0, s1] onde a reta p + s·u cruza o polígono (convexo ou quase) */
function lineThroughPolygon(ring, px, pz, ux, uz) {
  const ss = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ez = bz - az;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const s = ((ax - px) * ez - (az - pz) * ex) / den;
    const t = ((ax - px) * uz - (az - pz) * ux) / den;
    if (t >= 0 && t <= 1) ss.push(s);
  }
  if (ss.length < 2) return null;
  return [Math.min(...ss), Math.max(...ss)];
}

function rectRing(cx, cz, tx, tz, along, across) {
  const nx = -tz, nz = tx;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + tx * a * along / 2 + nx * b * across / 2, cz + tz * a * along / 2 + nz * b * across / 2]);
}

/** marca a planta nas máscaras (nada de árvore/casa procedural por cima) */
function markPolygon(masks, rings, margin = 0) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of rings[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  for (let x = minX - margin; x <= maxX + margin; x += 0.8)
    for (let z = minZ - margin; z <= maxZ + margin; z += 0.8) {
      let inside = pointInRing(x, z, rings[0]);
      if (!inside && margin > 0)
        for (let i = 0; i < rings[0].length && !inside; i++) {
          const [ax, az] = rings[0][i], [bx, bz] = rings[0][(i + 1) % rings[0].length];
          if (distToSegment(x, z, ax, az, bx, bz).d < margin) inside = true;
        }
      if (inside) { masks.build.set(x, z); masks.tree.set(x, z); }
    }
}
