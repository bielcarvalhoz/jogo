import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeProfile, exteriorEdges, referenceEntrance } from './campus-reference.js';
import { createWaterMaterial } from './nature.js';

function texture(renderer, width, height, paint, repeat = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

export function campusFacade(renderer, building) {
  const p = facadeProfile(building), win = building.windows || '#345663';
  return texture(renderer, 256, 256, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    if (p.type === 'metal') {
      g.fillStyle = '#b3bbbe'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#79868b';
      for (const y of [0, 85, 170, 254]) g.fillRect(0, y, 256, 2);
      for (const x of [0, 128, 254]) g.fillRect(x, 0, 256, 2);
      g.fillStyle = '#395359'; g.fillRect(6, 177, 244, 44);
      g.fillStyle = '#82969a'; g.fillRect(7, 178, 242, 3);
      return;
    }
    if (p.type === 'garage') {
      g.fillStyle = '#353d41'; g.fillRect(16, 45, 224, 125);
      g.fillStyle = '#d4d9d9'; g.fillRect(0, 218, 256, 10);
      return;
    }
    const fullGlass = p.type === 'pavilion';
    const y = fullGlass ? 0 : 35, h = fullGlass ? 238 : 148;
    const x = p.type === 'silver' ? 34 : fullGlass || p.type === 'louver' ? 0 : 10;
    const w = 256 - x * 2;
    g.fillStyle = p.frame; g.fillRect(x, y, w, h);
    const grad = g.createLinearGradient(0, y, 230, y + h);
    grad.addColorStop(0, '#87a6b1'); grad.addColorStop(.22, win); grad.addColorStop(.70, '#304949'); grad.addColorStop(1, '#729496');
    g.fillStyle = grad; g.fillRect(x + 8, y + 8, w - 16, h - 16);
    g.fillStyle = 'rgba(199,218,225,.22)';
    g.beginPath(); g.moveTo(x + 8, y + 8); g.lineTo(175, y + 8); g.lineTo(x + 8, y + 110); g.fill();
    g.fillStyle = p.frame;
    g.fillRect(124, y, p.type === 'silver' ? 5 : 8, h);
    g.fillRect(x, y + h * .56, w, p.type === 'silver' ? 5 : 8);
    if (p.type === 'louver') {
      for (let lx = 0; lx < 256; lx += 16) {
        g.fillStyle = '#155384'; g.fillRect(lx + 8, y, 7, h);
        g.fillStyle = '#319bdd'; g.fillRect(lx + 3, y, 5, h);
        g.fillStyle = '#64b7dd'; g.fillRect(lx + 3, y, 2, h);
      }
    }
    if (p.type === 'recessed') {
      g.fillStyle = '#6e7880'; g.fillRect(8, y + h - 9, 240, 9);
      g.fillStyle = '#cdd1d2'; g.fillRect(0, 0, 10, 256); g.fillRect(246, 0, 10, 256);
    }
    g.fillStyle = '#d5d7d6'; g.fillRect(0, 246, 256, 10);
    if (fullGlass) { g.fillStyle = '#7d6350'; g.fillRect(0, 239, 256, 17); }
  }, true);
}

export function bradescoBannerTexture(renderer) {
  return texture(renderer, 512, 1024, (g, w, h) => {
    g.fillStyle = '#cc2355'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.textAlign = 'center';
    g.font = 'bold 138px Arial'; g.fillText('amo', w / 2, 250, w - 35);
    g.font = 'italic 59px Arial'; g.fillText('ser bradesco', w / 2, 330, w - 35);
    g.font = '600 66px Arial'; g.fillText('bradesco', w / 2, 795, w - 65);
  });
}

export function gateSignTexture(renderer, name) {
  return texture(renderer, 1024, 100, (g, w, h) => {
    g.fillStyle = '#ecece7'; g.fillRect(0, 0, w, h);
    const vila = name.includes('Vila Yara');
    g.fillStyle = '#b81534';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(vila ? 435 : 315, 0); g.lineTo(vila ? 340 : 315, h); g.lineTo(0, h); g.fill();
    g.font = '600 43px Arial'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.fillText('bradesco', 36, 54);
    g.fillStyle = '#25292d'; g.font = '600 38px Arial';
    g.fillText(name, vila ? 458 : 390, 54, w - (vila ? 480 : 412));
    g.fillStyle = '#d3d5d4';
    for (let x = 340; x < w; x += 170) g.fillRect(x, 0, 1, h);
  });
}

/** Street-level entrances, signage and architectural details from the reference photos. */
export function buildCampusDetails(C, specs, { renderer, terrain, world, quality = 'high' }) {
  const root = new THREE.Group(); root.name = 'detalhes-referencias-campus';
  const parts = new Map(), surfaces = [], entrances = [], signs = [];
  const H = (x, z) => terrain.heightAt(x, z);
  const add = (color, geo) => { if (!parts.has(color)) parts.set(color, []); parts.get(color).push(geo); };
  const box = (color, x, y, z, w, h, d, yaw = 0) => {
    const g = new THREE.BoxGeometry(w, h, d); g.rotateY(yaw); g.translate(x, y, z); add(color, g);
  };
  const rail = (a, b, radius = .035, color = '#a7afb4') => {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b), v = bv.clone().sub(av);
    const g = new THREE.CylinderGeometry(radius, radius, v.length(), 6);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
    g.translate(...av.add(bv).multiplyScalar(.5).toArray()); add(color, g);
  };
  const plaque = (text, color, x, y, z, yaw, number) => {
    const map = texture(renderer, 192, 768, (g, w, h) => {
      g.fillStyle = '#313638'; g.fillRect(0, 0, w, h);
      g.fillStyle = color; g.fillRect(0, 0, 20, h);
      g.fillStyle = '#596064';
      for (let yy = 400; yy < h - 30; yy += 12) for (let xx = 36; xx < w; xx += 12) {
        if ((xx + yy) % 36 !== 0) { g.beginPath(); g.arc(xx, yy, 2, 0, Math.PI * 2); g.fill(); }
      }
      g.save(); g.translate(125, 40); g.rotate(-Math.PI / 2);
      g.fillStyle = '#ffffff'; g.font = '600 35px Arial'; g.textAlign = 'right';
      g.fillText(text.toLowerCase(), 0, 0, 640); g.restore();
      g.fillStyle = '#d1d4d4'; g.font = '26px Arial'; g.fillText(String(number || '').padStart(2, '0'), 72, h - 24);
    });
    box('#474c4e', x, y + 1.8, z, .86, 3.6, .23, yaw);
    box('#72716b', x, y + .09, z, 1.05, .18, .48, yaw);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(.82, 3.52), new THREE.MeshBasicMaterial({ map }));
      m.name = `totem-${text}`;
      m.position.set(x + normal.x * .125 * side, y + 1.82, z + normal.z * .125 * side);
      m.rotation.y = yaw + (side < 0 ? Math.PI : 0); root.add(m);
    }
    signs.push(text);
  };

  for (const { b, info } of specs) {
    if (!b.name || b.gateBuilding || b.style === 'garage') continue;
    const p = facadeProfile(b), e = referenceEntrance(b, world.roads, (x, z) => C.inRegion(x, z, .3) && !C.insideSolid(x, z, .2));
    if (!e) continue;
    const yaw = Math.atan2(-e.dz, e.dx), at = (u, v) => [e.x + e.dx * u + e.nx * v, e.z + e.dz * u + e.nz * v];
    let width = b.style === 'pavilion' ? 5.4 : b.planId === 'b17' ? 8 : 4.4;
    const rise = b.style === 'pavilion' ? .36 : b.planId === 'b17' ? .32 : b.planId === 'b6' ? 1.35 : .9;
    const landing = 1.45, run = b.style === 'pavilion' ? 1.2 : 2.15;
    const stepClear = (w) => [-w / 2, w / 2].every(u => [.08, landing + run].every(v => {
      const [x, z] = at(u, v);
      return C.RI.clearance(x, z).d > .45 && C.inRegion(x, z, .1) && !C.insideSolid(x, z, .025);
    }));
    while (width > 2.4 && !stepClear(width)) width -= .4;
    if (!stepClear(width)) continue;
    const entryY = Math.max(info.gMin + rise, H(...at(0, landing + run)) + .4);
    const [lx, lz] = at(0, landing / 2 + .08);
    const landingBase = Math.min(H(...at(0, landing)), entryY - .15) - .08;
    box('#a19e97', lx, (entryY + landingBase) / 2, lz, width, entryY - landingBase, landing, yaw);
    const floor = (v0, v1, top) => surfaces.push({ ...e, floor: true, width, v0, v1, top });
    floor(.08, landing + .08, entryY);
    const steps = b.style === 'pavilion' || b.planId === 'b17' ? 2 : b.planId === 'b21' ? 7 : 6;
    const bottomY = H(...at(0, landing + run)) + .05;
    const dh = (entryY - bottomY) / steps, tread = run / steps;
    for (let k = 0; k < steps; k++) {
      const v = landing + (k + .5) * tread, [x, z] = at(0, v), top = entryY - k * dh;
      const base = Math.min(H(x, z) - .12, top - .15);
      box('#969c9e', x, (base + top) / 2, z, width, top - base, tread + .005, yaw);
      floor(v - (tread + .005) / 2, v + (tread + .005) / 2, top);
      const noseV = v + tread / 2 - .025, [noseX, noseZ] = at(0, noseV);
      box('#d5d6d2', noseX, top + .008, noseZ, width, .016, .05, yaw);
      floor(noseV - .025, noseV + .025, top + .016);
    }
    // Entry glazing and light metal canopy have real thickness and separated faces.
    const [dx, dz] = at(0, .13);
    box('#32474b', dx, entryY + 1.45, dz, 2.7, 2.9, .16, yaw);
    for (const u of [-1.4, 0, 1.4]) { const [x, z] = at(u, .25); box('#899398', x, entryY + 1.45, z, .065, 2.9, .10, yaw); }
    if (b.planId !== 'b3') box('#555e64', lx, entryY + 3.16, lz, width + .75, .18, landing + 1.3, yaw);
    if (b.planId === 'b17') for (const s of [-1, 1]) {
      const [x, z] = at(s * (width / 2 + .15), landing + .7);
      box('#b78178', x, entryY + 1.5, z, .25, 3, .25, yaw);
    }
    if (quality === 'high') for (let u = -width / 2; u < width / 2; u += .28) {
      const [x, z] = at(u, landing / 2); box('#a9b0b2', x, entryY + 3.27, z, .07, .05, landing + 1.3, yaw);
    }
    for (const side of [-1, 1]) {
      const start = at(side * (width / 2 - .12), .2), end = at(side * (width / 2 - .12), landing + run - .1);
      rail([start[0], entryY + .93, start[1]], [end[0], bottomY + .93, end[1]]);
      rail([start[0], entryY + .5, start[1]], [end[0], bottomY + .5, end[1]], .025);
      for (let k = 0; k <= 3; k++) {
        const v = .2 + k / 3 * (landing + run - .3), [x, z] = at(side * (width / 2 - .12), v);
        const y = v <= landing ? entryY : entryY - (entryY - bottomY) * (v - landing) / run;
        rail([x, y, z], [x, y + .96, z]);
      }
    }
    // Accessible side ramp: 1:12, parallel to facade, clear of the vehicle lane.
    const rampLen = (entryY - bottomY) * 12, rampU = width / 2 - .04;
    if (e.L / 2 > rampLen + rampU + 1) {
      const u0 = rampU, u1 = rampU + rampLen, v = .8, rw = 1.3;
      const pts = [at(u0, v - rw / 2), at(u1, v - rw / 2), at(u1, v + rw / 2), at(u0, v + rw / 2)];
      const pos = [pts[0][0], entryY, pts[0][1], pts[2][0], bottomY, pts[2][1], pts[1][0], bottomY, pts[1][1], pts[0][0], entryY, pts[0][1], pts[3][0], entryY, pts[3][1], pts[2][0], bottomY, pts[2][1]];
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) { g.setIndex([0, 2, 1, 3, 5, 4]); g.computeVertexNormals(); }
      const ramp = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#b2afa5', roughness: .85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      ramp.name = `rampa-${b.name}`; ramp.receiveShadow = true; root.add(ramp);
      for (const s of [-1, 1]) {
        const a = at(u0, v + s * rw / 2), end = at(u1, v + s * rw / 2);
        rail([a[0], entryY + .95, a[1]], [end[0], bottomY + .95, end[1]]);
        for (let k = 0; k <= 5; k++) { const t = k / 5, [x, z] = at(u0 + rampLen * t, v + s * rw / 2), y = entryY + (bottomY - entryY) * t; rail([x, y, z], [x, y + .95, z]); }
      }
      surfaces.push({ ...e, ramp: true, u0, u1, v, width: rw, entryY, bottomY });
    }
    const [sx, sz] = at(width / 2 + 1.25, Math.min(e.clearance - 1.3, 4.8));
    if (C.RI.clearance(sx, sz).d > .65 && !C.insideSolid(sx, sz, .6)) plaque(b.name.split(' — ')[0], p.sign, sx, H(sx, sz), sz, Math.atan2(e.nx, e.nz), b.num);
    const [px, pz] = at(0, Math.min(e.clearance - .5, landing + run + 2));
    entrances.push({ name: b.name, x: px, z: pz, yaw: Math.atan2(-e.x + px, -e.z + pz), frontage: e });

    if (b.planId === 'b3') {
      const canopyWidth = 10.5, canopyDepth = 4.4, h = entryY + 3.15;
      const ends = [-canopyWidth / 2, canopyWidth / 2];
      for (const u of ends) {
        const a = at(u, .35), c = at(u, canopyDepth), peak = at(u, canopyDepth / 2);
        rail([a[0], h, a[1]], [peak[0], h + .95, peak[1]], .045, '#e2e4df');
        rail([peak[0], h + .95, peak[1]], [c[0], h, c[1]], .045, '#e2e4df');
        rail([c[0], H(...c), c[1]], [c[0], h, c[1]], .09, '#e2e4df');
      }
      const a = at(ends[0], canopyDepth / 2), c = at(ends[1], canopyDepth / 2);
      rail([a[0], h + .95, a[1]], [c[0], h + .95, c[1]], .045, '#e2e4df');
      const contour = [];
      for (const v of [.35, canopyDepth]) {
        const a0 = at(ends[0], v), a1 = at(ends[1], v), r0 = at(ends[0], canopyDepth / 2), r1 = at(ends[1], canopyDepth / 2);
        contour.push(a0[0], h, a0[1], a1[0], h, a1[1], r1[0], h + .95, r1[1], a0[0], h, a0[1], r1[0], h + .95, r1[1], r0[0], h + .95, r0[1]);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(contour, 3)); geo.computeVertexNormals();
      const glazing = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#bfd1d5', side: THREE.DoubleSide, transparent: true, opacity: .35, roughness: .2, depthWrite: false }));
      glazing.userData.keepStandard = true; glazing.name = 'marquise-triangular-vermelho'; root.add(glazing);
      const map = texture(renderer, 2048, 100, (g, w, hh) => {
        g.fillStyle = '#444b52'; g.fillRect(0, 0, w, hh);
        g.fillStyle = '#f0f0ed'; g.font = '500 55px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('SÓ O TRABALHO PODE PRODUZIR RIQUEZA', w / 2, hh / 2, w - 80);
      });
      const text = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(e.L - 1, 38), .92), new THREE.MeshBasicMaterial({ map }));
      text.name = 'frase-fachada-vermelho'; text.position.set(e.x + e.nx * .20, info.gMin + 5.2, e.z + e.nz * .20); text.rotation.y = Math.atan2(e.nx, e.nz); root.add(text);
    }
    if (b.planId === 'b0') {
      const map = texture(renderer, 768, 192, (g, w, h) => {
        g.fillStyle = '#e5e8e8'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#bb1935'; g.fillRect(22, 20, 130, 150);
        g.fillStyle = '#ffffff'; g.font = 'bold 82px Arial'; g.fillText('B', 55, 123);
        g.fillStyle = '#30383c'; g.font = '600 47px Arial';
        g.fillText('TECNOLOGIA', 178, 78); g.fillText('DA INFORMAÇÃO', 178, 141);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 1.7), new THREE.MeshBasicMaterial({ map }));
      m.name = 'identificacao-cti'; m.position.set(e.x + e.nx * .20, info.gMin + 5.7, e.z + e.nz * .20); m.rotation.y = Math.atan2(e.nx, e.nz); root.add(m);
    }

    // Pronounced storey ledges and narrow vertical fins on the Blue tower.
    if (['b1', 'b21', 'b3', 'b5', 'b17'].includes(b.planId)) {
      const volume = b.planId === 'b17' && b.volumes?.[0];
      const top = info.gMin + (volume ? volume.height : b.height);
      const levels = volume ? Math.round(volume.height / 3.3) : b.levels;
      // The upper tower is inset; only ground volume receives geometry here.
      for (let level = 1; level <= b.levels; level++) for (const edge of exteriorEdges(b.rings[0])) {
        box(b.planId === 'b17' ? '#d4c9bb' : p.frame, (edge.ax + edge.bx) / 2 + edge.nx * .08, info.gMin + level * b.height / b.levels - .20, (edge.az + edge.bz) / 2 + edge.nz * .08, edge.L, .32, .23, Math.atan2(-edge.dz, edge.dx));
      }
      if (volume) {
        root.userData.blueTower = { height: top, levels }; // texture brises continue on the inset volume
      }
    }
    if (b.style === 'pavilion') {
      for (const edge of exteriorEdges(b.rings[0])) {
        for (let u = 1; u < edge.L; u += 4.5) box('#40484b', edge.ax + edge.dx * u + edge.nx * .12, (info.gMin + info.top) / 2, edge.az + edge.dz * u + edge.nz * .12, .14, info.top - info.gMin, .20, Math.atan2(-edge.dz, edge.dx));
        box('#665b4e', (edge.ax + edge.bx) / 2, info.top - .2, (edge.az + edge.bz) / 2, edge.L, .20, .42, Math.atan2(-edge.dz, edge.dx));
      }
    }
    if (b.planId === 'b17') {
      // Low round fountain and planted island visible in the Blue entrance photo.
      let fountain = null;
      for (const radius of [2.5, 1.5]) for (const u of [-width / 2 - radius - 1, width / 2 + radius + 1, -width / 2 - radius - 4, width / 2 + radius + 4]) for (const v of [radius + .55, 4.8, 6.5]) {
        const [fx, fz] = at(u, v);
        if (!fountain && C.inRegion(fx, fz, radius) && C.RI.clearance(fx, fz).d > radius + .35 && !C.insideSolid(fx, fz, radius)) fountain = { fx, fz, radius };
      }
      if (fountain) {
        const { fx, fz, radius } = fountain;
        const y = H(fx, fz) + .17;
        const edge = new THREE.TorusGeometry(radius, .16, 6, 40); edge.rotateX(Math.PI / 2); edge.translate(fx, y + .20, fz); add('#dbd5c7', edge);
        const ring = Array.from({length: 40}, (_, i) => [fx + Math.cos(i / 40 * Math.PI * 2) * radius, fz + Math.sin(i / 40 * Math.PI * 2) * radius]);
        const geo = new THREE.CircleGeometry(radius - .15, 40); geo.rotateX(-Math.PI / 2); geo.translate(fx, y + .12, fz);
        const water = new THREE.Mesh(geo, createWaterMaterial([ring], {pool: true, quality}));
        water.name = 'chafariz-predio-azul'; root.add(water);
        const nozzle = new THREE.CylinderGeometry(.07, .11, .34, 8); nozzle.translate(fx, y + .26, fz); add('#555e5a', nozzle);
      }
    }
  }

  for (const [color, geoms] of parts) {
    const buffers = geoms.map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; });
    const mesh = new THREE.Mesh(mergeGeometries(buffers, false), new THREE.MeshStandardMaterial({ color, roughness: .76 }));
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  root.userData.signs = signs;
  root.userData.entrances = entrances;

  function surfaceHeightAt(x, z, maxY = Infinity) {
    let best = -Infinity;
    for (const s of surfaces) {
      const u = (x - s.x) * s.dx + (z - s.z) * s.dz, v = (x - s.x) * s.nx + (z - s.z) * s.nz;
      let y;
      if (s.ramp) {
        if (u < s.u0 - .0001 || u > s.u1 + .0001 || Math.abs(v - s.v) > s.width / 2 + .0001) continue;
        y = s.entryY + (s.bottomY - s.entryY) * (u - s.u0) / (s.u1 - s.u0);
      } else {
        if (Math.abs(u) > s.width / 2 + .0001 || v < s.v0 - .0001 || v > s.v1 + .0001) continue;
        y = s.top;
      }
      if (y <= maxY) best = Math.max(best, y);
    }
    return best;
  }
  return { root, surfaceHeightAt, entrances, signCount: signs.length, surfaces };
}
