import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { distToSegment, pointInPolygon, ringCentroid } from './geo.js';
import { referenceEntrance } from './campus-reference.js';

// Photos: parada_MOVE, trenzinho_lado_predio_CTI, catracas_internas_predios,
// portaria_vila_yara and portaria_bussocaba. Dimensions are visual estimates.
const RED = '#bb233a', STEEL = '#a7aeb2', DARK = '#242b30';
const PALETTE = [RED, STEEL, DARK, '#656564', '#685044', '#d1cbc0', '#ada794', '#ebd593', '#776c59', '#edede8', '#171d24', '#448594'];
const PALETTE_COLORS = PALETTE.map((hex) => new THREE.Color(hex));
const paletteKeys = new Map();
function materialKey(color) {
  if (!color.startsWith('#')) return color;
  if (paletteKeys.has(color)) return paletteKeys.get(color);
  const sample = new THREE.Color(color);
  let best = 0, distance = Infinity;
  PALETTE_COLORS.forEach((candidate, i) => {
    const d = (candidate.r - sample.r) ** 2 + (candidate.g - sample.g) ** 2 + (candidate.b - sample.b) ** 2;
    if (d < distance) { distance = d; best = i; }
  });
  paletteKeys.set(color, PALETTE[best]);
  return PALETTE[best];
}
const rect = (place, width, depth, cx = 0, cz = 0) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
  const x = cx + a * width / 2, z = cz + b * depth / 2, c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  return [place.x + x * c + z * s, place.z - x * s + z * c];
});
const localPoint = (place, x, z) => {
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  return [place.x + x * c + z * s, place.z - x * s + z * c];
};

function groundRoadClearance(x, z, roads) {
  let clearance = Infinity;
  for (const road of roads) {
    if (road.bridge) continue;
    for (let i = 1; i < road.pts.length; i++) clearance = Math.min(clearance, distToSegment(x, z, ...road.pts[i - 1], ...road.pts[i]).d - road.w / 2);
  }
  return clearance;
}

function trainByCTI(C, world) {
  const cti = C.buildings.find((building) => building.planId === 'b0' || building.num === 24);
  if (!cti) return null;
  const entry = referenceEntrance(cti, world.roads, (x, z) => !C.insideSolid?.(x, z, .5));
  if (!entry) return null;
  // The photograph shows the locomotive to the viewer's left of the entrance.
  // No surveyed point exists, so use an unobstructed garden beside that frontage.
  const leftX = -entry.nz, leftZ = entry.nx;
  const restricted = world.areas.filter((area) => ['water', 'pool', 'court', 'track', 'pitch', 'tennis'].includes(area.kind));
  for (const along of [10, 15, 20, 7, 25]) for (const setback of [8, 11, 14, 5]) {
    const place = { x: entry.x + leftX * along + entry.nx * setback, z: entry.z + leftZ * along + entry.nz * setback,
      yaw: -Math.atan2(leftZ, leftX), approximate: true, near: 'Prédio CTI', source: 'foto: locomotiva à esquerda da entrada do CTI; posição aproximada' };
    const ring = rect(place, 8.8, 3.2);
    const samples = [...ring, [place.x, place.z], ...ring.map((point, i) => [(point[0] + ring[(i + 1) % 4][0]) / 2, (point[1] + ring[(i + 1) % 4][1]) / 2])];
    if (samples.some(([x, z]) => C.insideSolid?.(x, z, .8) || !pointInPolygon(x, z, C.quarter)
      || groundRoadClearance(x, z, world.roads) < 2.6 || C.nearWall?.(x, z, .8)
      || restricted.some((area) => pointInPolygon(x, z, area.rings)))) continue;
    return { ...place, ring };
  }
  return null;
}

function gatePedestrianFrame(gate, C) {
  let x = gate.center?.x ?? gate.snap?.[0] ?? gate.x, z = gate.center?.z ?? gate.snap?.[1] ?? gate.z;
  let tx = gate.center?.tx, tz = gate.center?.tz;
  if (!Number.isFinite(tx + tz)) {
    const [cx, cz] = ringCentroid(C.quarter[0]), length = Math.hypot(cx - x, cz - z) || 1;
    tx = (cx - x) / length; tz = (cz - z) / length;
  }
  if (!pointInPolygon(x + tx * 10, z + tz * 10, C.quarter)) { tx = -tx; tz = -tz; }
  return { x, z, tx, tz, yaw: Math.atan2(tx, tz) };
}

/** Reuses the existing MOVE stops; excludes the duplicate vehicle mouth at Bussocaba. */
export function planCampusAmenities(C, world) {
  const stops = (C.busStops || []).filter((stop, i, list) => Number.isFinite(stop.x + stop.z + stop.yaw)
    && !list.slice(0, i).some((prior) => Math.hypot(prior.x - stop.x, prior.z - stop.z) < 3))
    // Existing yaw points toward the building; the shelter's opening faces the road.
    .map((stop, i) => ({ ...stop, yaw: stop.yaw + Math.PI, number: i + 1, approximate: true, source: 'ponto MOVE existente em prepareCampus, aproximado a partir do mapa', ring: rect(stop, 4.8, 2.6) }));
  const gates = [], seen = new Set();
  for (const gate of C.gateList || C.gates || []) {
    if (!gate.name || gate.type === 'portao' || gate.booth === false) continue;
    const key = `${gate.num || ''}:${gate.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const frame = gatePedestrianFrame(gate, C), vehicle = gate.type !== 'pedestre';
    const width = gate.crossing?.r?.w ?? 7, along = vehicle ? 2 : 1.1;
    const offsets = vehicle ? [-(width / 2 + 1.3), width / 2 + 1.3] : [-.85, .85];
    const lanes = offsets.map((offset, i) => {
      const [x, z] = localPoint(frame, offset, along);
      return { x, z, yaw: frame.yaw, direction: i ? 'saída' : 'entrada', gate: gate.name, num: gate.num, ring: rect({ x, z, yaw: frame.yaw }, 1.25, 2.5) };
    });
    gates.push({ ...frame, gate, vehicle, lanes, approximate: true });
  }
  const train = trainByCTI(C, world);
  const exclusions = [
    ...stops.map((stop) => ({ kind: 'move', rings: [stop.ring], padding: 1.2 })),
    ...gates.flatMap((gate) => gate.lanes.map((lane) => ({ kind: 'catraca', rings: [lane.ring], padding: .4 }))),
    ...(train ? [{ kind: 'locomotiva', rings: [train.ring], padding: 1.0 }] : []),
  ];
  return { stops, gates, train, exclusions };
}

function signTexture(renderer, kind) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const g = canvas.getContext('2d');
  if (kind === 'move') {
    g.fillStyle = '#656564'; g.fillRect(0, 0, 512, 256);
    for (const [x, y, color] of [[98, 24, '#9cb75b'], [189, 8, '#75b9bf'], [174, 87, '#73af91']]) {
      g.fillStyle = color; g.beginPath(); g.moveTo(x, y + 45); g.lineTo(x + 55, y); g.lineTo(x + 110, y + 45); g.lineTo(x + 82, y + 70); g.lineTo(x + 55, y + 45); g.lineTo(x + 28, y + 70); g.closePath(); g.fill();
    }
    g.font = 'bold 108px Arial'; g.textAlign = 'center';
    const gradient = g.createLinearGradient(105, 0, 420, 0); gradient.addColorStop(0, '#a4b653'); gradient.addColorStop(.5, '#75ac89'); gradient.addColorStop(1, '#80bdc2');
    g.fillStyle = gradient; g.fillText('move', 256, 244);
  } else if (kind === 'reader') {
    g.fillStyle = '#171d24'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#448594'; g.fillRect(40, 22, 432, 162);
    g.fillStyle = '#b8d8de'; g.fillRect(80, 45, 160, 110); g.fillRect(265, 45, 160, 16); g.fillRect(265, 80, 130, 11); g.fillRect(265, 112, 110, 11);
    g.fillStyle = '#f5f6f4'; g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.fillText('APROXIME O CRACHÁ', 256, 225);
  } else if (kind === 'entrada' || kind === 'saída') {
    g.fillStyle = '#b72139'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#182927'; g.fillRect(174, 15, 164, 95);
    g.strokeStyle = '#9bc980'; g.lineWidth = 14;
    g.beginPath(); g.moveTo(256, 86); g.lineTo(256, 38); g.lineTo(230, 63); g.moveTo(256, 38); g.lineTo(282, 63); g.stroke();
    g.fillStyle = '#ffffff'; g.font = 'bold 65px Arial'; g.textAlign = 'center'; g.fillText(kind.toUpperCase(), 256, 180); g.font = '38px Arial'; g.fillText('bradesco', 256, 230);
  } else {
    g.fillStyle = '#65645e'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#ece9d8'; g.font = 'bold 43px Arial'; g.textAlign = 'center'; g.fillText('LOCOMOTIVA HISTÓRICA', 256, 112); g.font = '36px Arial'; g.fillText('Cidade de Deus', 256, 169);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer?.capabilities.getMaxAnisotropy() || 1);
  return texture;
}

/** Reference amenities, merged into a small material palette, with flat walkable pads. */
export function buildCampusAmenities(C, { renderer, terrain, world, sidewalkHeightAt } = {}) {
  const root = new THREE.Group(); root.name = 'comodidades-cidade-de-deus';
  const plan = planCampusAmenities(C, world), parts = new Map(), surfaces = [], rotors = [], solids = [];
  const signMaterials = new Map();
  const add = (color, geometry) => { const key = materialKey(color); if (!parts.has(key)) parts.set(key, []); parts.get(key).push(geometry); };
  const matrixAt = (place) => new THREE.Matrix4().makeRotationY(place.yaw).setPosition(place.x, place.y, place.z);
  const box = (color, place, x, y, z, w, h, d) => { const geometry = new THREE.BoxGeometry(w, h, d); geometry.translate(x, y, z); geometry.applyMatrix4(matrixAt(place)); add(color, geometry); };
  const cylinder = (color, place, x, y, z, radius, length, axis = 'y', segments = 10, top = radius) => {
    const geometry = new THREE.CylinderGeometry(top, radius, length, segments);
    if (axis === 'x') geometry.rotateZ(-Math.PI / 2); else if (axis === 'z') geometry.rotateX(Math.PI / 2);
    geometry.translate(x, y, z); geometry.applyMatrix4(matrixAt(place)); add(color, geometry);
  };
  const tube = (color, place, a, b, radius = .035) => {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), vector = bv.clone().sub(av);
    const geometry = new THREE.CylinderGeometry(radius, radius, vector.length(), 5, 1, true);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize()));
    geometry.translate(...av.add(bv).multiplyScalar(.5).toArray()); geometry.applyMatrix4(matrixAt(place)); add(color, geometry);
  };
  const plaque = (kind, place, x, y, z, w, h, reverse = false) => {
    const key = `sign:${kind}`;
    if (!signMaterials.has(key)) signMaterials.set(key, new THREE.MeshBasicMaterial({ map: signTexture(renderer, kind), color: 0xffffff }));
    const geometry = new THREE.PlaneGeometry(w, h); if (reverse) geometry.rotateY(Math.PI);
    geometry.translate(x, y, z); geometry.applyMatrix4(matrixAt(place)); add(key, geometry);
  };
  const baseHeight = (place, width, depth, raised = .04) => {
    const samples = [...rect(place, width, depth), [place.x, place.z]];
    const heights = samples.map(([x, z]) => Math.max(terrain.heightAt(x, z), sidewalkHeightAt?.(x, z) ?? -Infinity));
    return { top: Math.max(...heights) + raised, bottom: Math.min(...heights) - .06 };
  };
  const pad = (place, width, depth, raised = .04, walkable = true) => {
    const { top, bottom } = baseHeight(place, width, depth, raised); place.y = top;
    box('#d1cbc0', { ...place, y: 0 }, 0, (top + bottom) / 2, 0, width, top - bottom, depth);
    if (walkable) surfaces.push({ rings: [rect(place, width, depth)], y: top });
    return top;
  };

  for (const stop of plan.stops) {
    const place = { ...stop }; pad(place, 4.8, 2.6);
    // Gray equipment wall, timber-red window frame and the wide dark canopy.
    box('#656564', place, 0, 1.28, -.91, 4.2, 2.56, .24);
    box('#685044', place, -.62, 1.47, -.755, 2.30, 1.85, .10);
    box('glass', place, -.62, 1.47, -.685, 2.06, 1.60, .035);
    box(DARK, place, 0, 2.75, -.10, 4.8, .18, 2.8);
    box('#414950', place, 0, 2.64, -.1, 4.5, .075, 2.55);
    for (const x of [-2.15, 2.15]) {
      cylinder('#292f31', place, x, 1.34, .85, .045, 2.68);
      box('glass', place, x, 1.35, -.05, .035, 2.2, 1.65);
      tube('#292f31', place, [x, .23, -.82], [x, .23, .85]);
    }
    box('#776c59', place, -.45, .48, -.35, 2.4, .12, .43);
    for (const x of [-1.35, .45]) box('#33393b', place, x, .24, -.35, .05, .45, .36);
    // Two road-facing signs: along the approach and on the rear of the same panel.
    plaque('move', place, 1.38, 1.95, -.74, 1.18, .61);
    plaque('move', place, 1.38, 1.95, -1.045, 1.18, .61, true);
    const frame = { ...place, x: place.x, y: place.y, z: place.z };
    const panelRing = rect(place, 4.2, .35, 0, -.91);
    solids.push({ rings: [panelRing], top: place.y + 2.56, kind: 'painel-MOVE' });
    stop.padHeight = frame.y;
  }

  for (const gate of plan.gates) {
    let pedestrianHeight;
    if (!gate.vehicle) {
      const [x, z] = localPoint(gate, 0, 1.1), place = { ...gate, x, z };
      pedestrianHeight = pad(place, 3.5, 3.6, .025);
      box('#edede8', place, 0, 2.76, 0, 3.5, .16, 3.0);
      for (const side of [-1.55, 1.55]) cylinder('#747b7b', place, side, 1.38, -1.02, .05, 2.76, 'y', 6);
    }
    for (const lane of gate.lanes) {
      const place = { ...lane };
      if (Number.isFinite(pedestrianHeight)) place.y = pedestrianHeight;
      else pad(place, 1.25, 2.5, .025);
      box(STEEL, place, -.44, .55, 0, .31, 1.10, 1.02);
      box('#30373b', place, -.44, 1.13, 0, .34, .095, 1.08);
      box(RED, place, -.44, .56, -.525, .29, 1.00, .03);
      box(RED, place, -.44, .56, .525, .29, 1.00, .03);
      cylinder('#1f2529', place, -.44, 1.39, 0, .027, .43, 'y', 6);
      box('#171d24', place, -.44, 1.61, 0, .20, .32, .045);
      plaque('reader', place, -.44, 1.61, .035, .173, .277);
      plaque('reader', place, -.44, 1.61, -.035, .173, .277, true);
      plaque(lane.direction, place, -.44, .69, -.544, .25, .56, true);
      plaque(lane.direction, place, -.44, .69, .544, .25, .56);
      cylinder('#8f9a9f', place, -.23, .89, 0, .12, .16, 'x', 8);
      const [rotorX, rotorZ] = localPoint(place, -.17, 0);
      rotors.push({ position: new THREE.Vector3(rotorX, place.y + .89, rotorZ), lane, phase: 0, sign: lane.direction === 'entrada' ? 1 : -1 });
      for (const z of [-1.08, 1.08]) {
        cylinder(STEEL, place, .58, .48, z, .024, .96, 'y', 6);
        tube(STEEL, place, [.58, .96, z], [.58, .96, z * .40]);
      }
      solids.push({ rings: [rect(place, .33, 1.06, -.44, 0)], top: place.y + 1.12, kind: 'gabinete-catraca' });
      lane.padHeight = place.y;
    }
  }

  if (plan.train) {
    const place = { ...plan.train }; pad(place, 8.8, 3.2, .12, false);
    // Short exhibition track and ties, raised clear of the sampled terrain.
    for (let x = -4.1; x <= 4.1; x += .45) box('#6a5441', place, x, .09, 0, .19, .15, 2.3);
    for (const z of [-.79, .79]) box('#72797a', place, 0, .23, z, 8.55, .16, .08);
    box(RED, place, -.1, .69, 0, 6.5, .28, 1.96);
    cylinder('#181e23', place, .67, 1.47, 0, .68, 3.72, 'x', 16);
    cylinder('#ada794', place, 2.59, 1.47, 0, .71, .07, 'x', 16);
    cylinder('#151b20', place, 2.64, 1.47, 0, .60, .08, 'x', 16);
    cylinder('#30383a', place, 1.62, 2.37, 0, .21, .82, 'y', 10, .28);
    cylinder('#12181d', place, 1.62, 2.84, 0, .32, .14, 'y', 10);
    cylinder('#313a40', place, .12, 2.23, 0, .20, .46, 'y', 10, .16);
    cylinder('#c5bd99', place, 2.89, 2.13, 0, .19, .24, 'x', 10);
    cylinder('#ebd593', place, 3.02, 2.13, 0, .14, .025, 'x', 10);
    // Cabin behind the boiler: open window apertures, not one solid black block.
    box('#1f262b', place, -2.04, 2.89, 0, 1.76, .16, 2.03);
    box('#283033', place, -2.73, 1.87, 0, .16, 1.86, 1.88);
    box('#222a2d', place, -2.07, 1.31, 0, 1.45, .85, 1.88);
    for (const z of [-.86, .86]) {
      for (const x of [-2.74, -1.34]) box('#273034', place, x, 2.12, z, .13, 1.35, .14);
      box('#273034', place, -2.04, 2.73, z, 1.55, .15, .14);
      box('#4a332a', place, -2.04, 1.52, z * 1.02, 1.58, .20, .06);
    }
    for (const z of [-1, 1]) {
      for (const x of [-.74, .32, 1.38]) {
        cylinder('#b5aa90', place, x, .67, z * .99, .53, .11, 'z', 14);
        cylinder('#20292c', place, x, .67, z * 1.057, .45, .025, 'z', 14);
        for (let spoke = 0; spoke < 6; spoke++) {
          const angle = spoke / 6 * Math.PI * 2;
          tube('#acaa9d', place, [x, .67, z * 1.076], [x + Math.cos(angle) * .41, .67 + Math.sin(angle) * .41, z * 1.076], .025);
        }
      }
      for (const x of [-2.62, -1.88, 2.77]) cylinder('#20282b', place, x, .52, z * .92, .32, .16, 'z', 10);
      tube('#b6ad98', place, [-.74, .58, z * 1.10], [1.38, .58, z * 1.10], .045);
      tube('#acaaa0', place, [-1.19, 1.75, z * .56], [2.40, 1.75, z * .56], .025);
      tube('#9d9787', place, [3.36, .32, z * 1.05], [2.80, .86, z * .78], .05);
    }
    // Sloping cowcatcher bars instead of a box clipping into the grass.
    for (let z = -.98; z <= 1; z += .22) tube('#b0a38a', place, [3.38, .34, z], [2.88, .92, z * .62], .035);
    tube('#a28777', place, [3.4, .34, -.98], [3.4, .34, .98], .045);
    const plaquePlace = { ...place, yaw: place.yaw + Math.PI / 2 };
    const [px, pz] = localPoint(place, 3.55, -1.40); plaquePlace.x = px; plaquePlace.z = pz;
    box('#74746d', plaquePlace, 0, .55, 0, .035, 1.1, .035);
    plaque('train', plaquePlace, 0, .91, .026, 1.25, .55);
    solids.push({ rings: [rect(place, 7.6, 2.4)], top: place.y + 3.1, kind: 'locomotiva' });
    plan.train.padHeight = place.y;
  }

  let rotorMesh;
  const rotorMatrix = new THREE.Matrix4(), rotorQ = new THREE.Quaternion(), spinQ = new THREE.Quaternion(), unitScale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), axle = new THREE.Vector3(1, 0, 0);
  const setRotorMatrix = (rotor, index) => {
    rotorQ.setFromAxisAngle(up, rotor.lane.yaw).multiply(spinQ.setFromAxisAngle(axle, rotor.phase));
    rotorMesh.setMatrixAt(index, rotorMatrix.compose(rotor.position, rotorQ, unitScale));
  };
  if (rotors.length) {
    const geometries = [];
    for (let i = 0; i < 3; i++) {
      const angle = i / 3 * Math.PI * 2, end = new THREE.Vector3(.72, Math.sin(angle) * .34, Math.cos(angle) * .34);
      const geometry = new THREE.CylinderGeometry(.025, .025, end.length(), 5, 1, true);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, end.clone().normalize())); geometry.translate(...end.multiplyScalar(.5).toArray()); geometries.push(geometry);
    }
    rotorMesh = new THREE.InstancedMesh(mergeGeometries(geometries), new THREE.MeshStandardMaterial({ color: STEEL, roughness: .42, metalness: .35 }), rotors.length);
    rotorMesh.name = 'catracas-tripodes';
    rotors.forEach(setRotorMatrix); rotorMesh.computeBoundingSphere(); root.add(rotorMesh);
    geometries.forEach((geometry) => geometry.dispose());
  }

  for (const [key, geometries] of parts) {
    const geometry = mergeGeometries(geometries.map((part) => part.index ? part.toNonIndexed() : part), false);
    const material = signMaterials.get(key) || (key === 'glass'
      ? new THREE.MeshStandardMaterial({ color: '#263b40', roughness: .24, metalness: .18 })
      : new THREE.MeshStandardMaterial({ color: key, roughness: .78 }));
    const mesh = new THREE.Mesh(geometry, material); mesh.name = key.startsWith('sign:') ? key.slice(5) + '-placas-comodidades' : 'pecas-comodidades';
    mesh.castShadow = !key.startsWith('sign:'); mesh.receiveShadow = true; root.add(mesh);
    geometries.forEach((part) => part.dispose());
  }
  const stats = { moveStops: plan.stops.length, gates: plan.gates.length, turnstiles: plan.gates.reduce((sum, gate) => sum + gate.lanes.length, 0), locomotives: plan.train ? 1 : 0,
    approximate: true, locations: { move: plan.stops.map(({ x, z, near, number }) => ({ x, z, near, number })), gates: plan.gates.map(({ gate, lanes }) => ({ name: gate.name, num: gate.num, lanes: lanes.map(({ x, z, direction }) => ({ x, z, direction })) })), train: plan.train },
    triangles: 0, meshes: 0 };
  root.traverse((object) => { if (object.isMesh) { stats.meshes++; stats.triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1); } });
  root.userData.amenities = stats;
  const surfaceHeightAt = (x, z, maxY = Infinity) => {
    let height = -Infinity;
    for (const surface of surfaces) if (surface.y <= maxY && pointInPolygon(x, z, surface.rings)) height = Math.max(height, surface.y);
    return height;
  };
  const update = (dt, playerPos) => {
    if (!playerPos) return;
    let changed = false;
    rotors.forEach((rotor, index) => {
      if (Math.hypot(playerPos.x - rotor.lane.x, playerPos.z - rotor.lane.z) >= 1.8) return;
      rotor.phase += Math.min(dt, .1) * rotor.sign * 2.1;
      setRotorMatrix(rotor, index); changed = true;
    });
    if (changed) rotorMesh.instanceMatrix.needsUpdate = true;
  };
  return { root, stats, plan, exclusions: plan.exclusions, solids, surfaces, surfaceHeightAt, update };
}
