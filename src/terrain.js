import * as THREE from 'three';
import { pointInPolygon, SpatialGrid, distToSegment } from './geo.js';
import { resampleRoad } from './road-geometry.js';
import { referenceEntrance, pairedEntrances } from './campus-reference.js';

// Terreno a partir da grade de elevação real (SRTM).
// heightAt() reproduz EXATAMENTE a mesma triangulação da malha, então qualquer coisa
// apoiada no chão (ruas, prédios, jogador) fica rente ao relevo, sem flutuar nem afundar.

export function createTerrain(data, proj) {
  const { nx, ny, heights } = data;
  const [west, south, east, north] = data.bbox;
  const [x0, z0] = proj.toLocal(west, north); // canto noroeste
  const [x1, z1] = proj.toLocal(east, south); // canto sudeste
  const width = x1 - x0, depth = z1 - z0;
  const dx = width / (nx - 1), dz = depth / (ny - 1);
  const base = data.min; // altitude real do ponto mais baixo -> y = 0

  const h = new Float32Array(heights.length);
  for (let i = 0; i < h.length; i++) h[i] = heights[i] - base;

  const H = (i, j) => h[j * nx + i];
  const roadProfiles = new Map(), platforms = new WeakMap();

  function heightAt(x, z) {
    let fx = (x - x0) / dx, fz = (z - z0) / dz;
    fx = Math.min(nx - 1.0001, Math.max(0, fx));
    fz = Math.min(ny - 1.0001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    // célula: a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j)
    // triângulos (a,b,d) quando u+v<=1, senão (b,c,d)
    const a = H(i, j), b = H(i, j + 1), c = H(i + 1, j + 1), d = H(i + 1, j);
    if (u + v <= 1) return a + (d - a) * u + (b - a) * v;
    return c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  // Edits the same elevation vertices used by both navigation and the visible mesh.
  // A full-cell safety margin keeps triangles crossing a platform boundary level too.
  const preservedVertices = new WeakMap();
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const overlapsTriangle = (triangle, rings) => {
    const centre = triangle.reduce((p, q) => [p[0] + q[0] / 3, p[1] + q[1] / 3], [0, 0]);
    if (pointInPolygon(...centre, rings)) return true;
    for (const p of triangle) if (pointInPolygon(...p, rings) && !rings.some(ring => ring.some((a, i) => distToSegment(...p, ...a, ...ring[(i + 1) % ring.length]).d < 1e-6))) return true;
    for (const ring of rings) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], sides = triangle.map((a, j) => cross(a, triangle[(j + 1) % 3], p));
      if (sides.every(v => v > 1e-7) || sides.every(v => v < -1e-7)) return true;
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3];
        if (cross(a, b, p) * cross(a, b, q) < -1e-7 && cross(p, q, a) * cross(p, q, b) < -1e-7) return true;
      }
    }
    return false;
  };
  const isPreserved = (x, z, regions) => regions.some((region) => {
    const rings = region.rings || region, margin = region.margin ?? Math.hypot(dx, dz);
    if (pointInPolygon(x, z, rings)) return true;
    const near = margin > 0 && rings.some(ring => ring.some((a, i) => { const b = ring[(i + 1) % ring.length]; return distToSegment(x, z, a[0], a[1], b[0], b[1]).d < margin; }));
    if (!near || region.margin !== undefined) return near;
    // Preserve exactly the vertices of triangles intersecting the protected area.
    // A circular full-cell halo also froze unrelated vertices beside the lake,
    // leaving an artificial mound in the otherwise flat western running lanes.
    let cache = preservedVertices.get(region);
    if (!cache) { cache = new Map(); preservedVertices.set(region, cache); }
    const key = `${Math.round((x - x0) / dx)},${Math.round((z - z0) / dz)}`;
    if (!cache.has(key)) {
      const incident = [[[0, 0], [0, 1], [1, 0]], [[-1, 0], [-1, 1], [0, 0]], [[-1, 1], [0, 1], [0, 0]], [[0, -1], [0, 0], [1, -1]], [[0, 0], [1, 0], [1, -1]], [[-1, 0], [0, 0], [0, -1]]];
      cache.set(key, incident.some(triangle => overlapsTriangle(triangle.map(([i, j]) => [x + i * dx, z + j * dz]), rings)));
    }
    return cache.get(key);
  });

  function gradePlatform(rings, { level, padding = 0, band = 16, maxAdjustment = Infinity, preserve = [] } = {}) {
    if (!rings?.[0]?.length) return null;
    const ring = rings[0];
    if (!Number.isFinite(level)) {
      const samples = ring.map(([x, z]) => heightAt(x, z)).sort((a, b) => a - b);
      level = samples[Math.floor(samples.length / 2)];
    }
    const margin = Math.hypot(dx, dz) + padding;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const i0 = Math.max(0, Math.floor((minX - margin - band - x0) / dx)), i1 = Math.min(nx - 1, Math.ceil((maxX + margin + band - x0) / dx));
    const j0 = Math.max(0, Math.floor((minZ - margin - band - z0) / dz)), j1 = Math.min(ny - 1, Math.ceil((maxZ + margin + band - z0) / dz));
    let changed = 0, cutFill = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * dx, z = z0 + j * dz, k = j * nx + i;
      if (isPreserved(x, z, preserve)) continue;
      let distance = 0;
      if (!pointInPolygon(x, z, rings)) {
        distance = Infinity;
        for (let e = 0; e < ring.length; e++) {
          const a = ring[e], b = ring[(e + 1) % ring.length];
          distance = Math.min(distance, distToSegment(x, z, a[0], a[1], b[0], b[1]).d);
        }
      }
      if (distance >= margin + band) continue;
      const t = Math.max(0, (distance - margin) / band);
      const weight = 1 - t * t * (3 - 2 * t);
      const delta = Math.max(-maxAdjustment, Math.min(maxAdjustment, level - h[k])) * weight;
      h[k] += delta;
      if (Math.abs(delta) > 0.001) changed++;
      cutFill = Math.max(cutFill, Math.abs(delta));
    }
    return { level, changed, cutFill };
  }

  function gradeCorridors(roads, { sidewalk = 2.5, band = 18, maxAdjustment = Infinity, maxGrade = .12, preserve = [], profileOnly = false, reuseProfiles = false } = {}) {
    const grid = new SpatialGrid(24);
    const nodes = new Map(), edges = [], samples = new Map();
    const ordered = [...roads].sort((a, b) => String(a.id || JSON.stringify(a.pts)).localeCompare(String(b.id || JSON.stringify(b.pts))));
    if (reuseProfiles && ordered.every(r => roadProfiles.has(r))) {
      for (const r of ordered) samples.set(r, roadProfiles.get(r));
    } else {
    for (const r of ordered) {
      const pts = resampleRoad(r.pts, 2.5), profile = [];
      for (const [x, z] of pts) {
        const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
        if (!nodes.has(key)) nodes.set(key, { x, z, y: heightAt(x, z), count: 0, sum: 0 });
        profile.push(nodes.get(key));
      }
      // Smooth only along the street, retaining shared nodes at OSM junctions.
      for (let i = 0; i < profile.length; i++) {
        const nearby = profile.slice(Math.max(0, i - 3), Math.min(profile.length, i + 4));
        profile[i].sum += nearby.reduce((sum, n) => sum + n.y, 0) / nearby.length;
        profile[i].count++;
      }
      samples.set(r, profile);
      for (let i = 1; i < profile.length; i++) edges.push({ a: profile[i - 1], b: profile[i], limit: maxGrade * Math.hypot(profile[i].x - profile[i - 1].x, profile[i].z - profile[i - 1].z) });
    }
    for (const node of nodes.values()) node.y = node.sum / node.count;
    // Two graph distance envelopes impose the slope bound exactly, even over a
    // long hill. Averaging their upper/lower solutions avoids lowering every hill
    // to the lowest road node. Shared OSM nodes keep connected branches coherent.
    const allNodes = [...nodes.values()];
    allNodes.forEach((node, i) => { node.index = i; node.neighbours = []; });
    for (const { a, b, limit } of edges) { a.neighbours.push([b.index, limit]); b.neighbours.push([a.index, limit]); }
    const envelope = (sign) => {
      const values = allNodes.map(node => node.y * sign), heap = [];
      const push = (item) => {
        let i = heap.length; heap.push(item);
        while (i && heap[(i - 1) >> 1][0] > item[0]) { heap[i] = heap[(i - 1) >> 1]; i = (i - 1) >> 1; }
        heap[i] = item;
      };
      values.forEach((value, i) => push([value, i]));
      while (heap.length) {
        const first = heap[0], last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (i * 2 + 1 < heap.length) {
            let child = i * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
            if (heap[child][0] >= last[0]) break;
            heap[i] = heap[child]; i = child;
          }
          heap[i] = last;
        }
        const [value, index] = first;
        if (value > values[index] + 1e-9) continue;
        for (const [next, cost] of allNodes[index].neighbours) if (value + cost < values[next] - 1e-9) {
          values[next] = value + cost; push([values[next], next]);
        }
      }
      return values;
    };
    const upper = envelope(1), lower = envelope(-1);
    allNodes.forEach((node, i) => { node.y = (upper[i] - lower[i]) / 2; });
    }
    let steepest = 0;
    for (const [r, profile] of samples) {
      roadProfiles.set(r, profile);
      for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], b = profile[i], ax = a.x, az = a.z, bx = b.x, bz = b.z;
      const radius = r.w / 2 + sidewalk + Math.hypot(dx, dz);
      const s = { r, ax, az, bx, bz, radius, ya: a.y, yb: b.y };
      steepest = Math.max(steepest, Math.abs(b.y - a.y) / Math.max(.001, Math.hypot(bx - ax, bz - az)));
      const m = radius + band;
      grid.insertBox(s, Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m);
      }
    }
    if (profileOnly) return { changed: 0, cutFill: 0, maxGrade: steepest, profiles: samples.size };
    const hardPreserve = preserve.filter(region => !region.roadCutAllowed), softPreserve = preserve.filter(region => region.roadCutAllowed);
    let changed = 0, cutFill = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * dx, z = z0 + j * dz, k = j * nx + i;
      let target = 0, weights = 0, influence = 0, nearest = null, nearestD = Infinity;
      const nearestRoad = new Map();
      for (const s of grid.query(x, z)) {
        const q = distToSegment(x, z, s.ax, s.az, s.bx, s.bz);
        if (q.d > s.radius + band) continue;
        const t = Math.max(0, (q.d - s.radius) / band);
        const weight = 1 - t * t * (3 - 2 * t);
        target += (s.ya + (s.yb - s.ya) * q.t) * weight;
        weights += weight;
        influence = Math.max(influence, weight);
        if (q.d < nearestD) { nearestD = q.d; nearest = { s, q }; }
        if (!nearestRoad.has(s.r) || q.d < nearestRoad.get(s.r).q.d) nearestRoad.set(s.r, { s, q });
      }
      if (!weights) continue;
      if (isPreserved(x, z, hardPreserve)) continue;
      // Inside the engineered road + sidewalk core use a section normal to the
      // closest centreline. Averaging unrelated nearby sections tilts the road.
      if (nearest && nearestD <= nearest.s.radius) target = (nearest.s.ya + (nearest.s.yb - nearest.s.ya) * nearest.q.t) * weights;
      for (const { s, q } of nearestRoad.values()) if (q.d <= s.radius)
        target = Math.min(target, (s.ya + (s.yb - s.ya) * q.t) * weights);
      // A road may share a coarse SRTM cell with an engineered foundation. Lower
      // that cell when necessary, while the real foundation/retaining geometry
      // continues supporting the building; never raise earth over its first floor.
      if (isPreserved(x, z, softPreserve)) target = Math.min(target, h[k] * weights);
      const delta = Math.max(-maxAdjustment, Math.min(maxAdjustment, target / weights - h[k])) * influence;
      h[k] += delta;
      if (Math.abs(delta) > 0.001) changed++;
      cutFill = Math.max(cutFill, Math.abs(delta));
    }
    return { changed, cutFill, maxGrade: steepest, profiles: samples.size };
  }

  function roadHeightAt(road, x, z) {
    const profile = roadProfiles.get(road);
    if (!profile?.length) return heightAt(x, z);
    let best = Infinity, y = profile[0].y;
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], b = profile[i], q = distToSegment(x, z, a.x, a.z, b.x, b.z);
      if (q.d < best) { best = q.d; y = a.y + (b.y - a.y) * q.t; }
    }
    return y;
  }

  function prepareBuildingPlatform(building, { preserve = [], level } = {}) {
    const ring = building.rings[0], samples = [];
    for (let e = 0; e < ring.length; e++) {
      const a = ring[e], b = ring[(e + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let i = 0; i < n; i++) samples.push(heightAt(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n));
    }
    const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
    for (let j = Math.max(0, Math.floor((Math.min(...zs) - z0) / dz)); j <= Math.min(ny - 1, Math.ceil((Math.max(...zs) - z0) / dz)); j++)
      for (let i = Math.max(0, Math.floor((Math.min(...xs) - x0) / dx)); i <= Math.min(nx - 1, Math.ceil((Math.max(...xs) - x0) / dx)); i++)
        if (pointInPolygon(x0 + i * dx, z0 + j * dz, building.rings)) samples.push(H(i, j));
    samples.sort((a, b) => a - b);
    const min = samples[0], max = samples.at(-1), height = Number.isFinite(level) ? level : samples[Math.floor(samples.length / 2)];
    const result = { height, min, max, depth: Math.max(height - min, max - height), ...gradePlatform(building.rings, { level: height, padding: .5, band: Math.max(14, Math.min(28, (max - min) * 3)), preserve }) };
    building.groundY = height;
    platforms.set(building, result);
    return result;
  }

  /**
   * Lagos: nível = média da margem. O fundo é escavado e uma faixa de BAND metros em volta
   * é nivelada suavemente até o nível da margem (desce o lado alto, aterra o lado baixo),
   * para a água não flutuar nem aparecer "espinhos" de relevo em volta.
   * Precisa rodar antes de qualquer coisa consultar heightAt().
   */
  function carveWater(rings, { band = 10, depth = 1.0, bank = 0.25 } = {}) {
    const outer = rings[0];
    let sum = 0, cnt = 0;
    for (let k = 0; k < outer.length; k++) {
      const [ax, az] = outer[k], [bx, bz] = outer[(k + 1) % outer.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s < n; s++) { sum += heightAt(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n); cnt++; }
    }
    const level = sum / cnt - 0.3;
    const edgeDist = (x, z) => {
      let d = Infinity;
      for (let k = 0; k < outer.length; k++) {
        const [ax, az] = outer[k], [bx, bz] = outer[(k + 1) % outer.length];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
        d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
      }
      return d;
    };
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const i0 = Math.max(0, Math.floor((minX - band - x0) / dx)), i1 = Math.min(nx - 1, Math.ceil((maxX + band - x0) / dx));
    const j0 = Math.max(0, Math.floor((minZ - band - z0) / dz)), j1 = Math.min(ny - 1, Math.ceil((maxZ + band - z0) / dz));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * dx, z = z0 + j * dz, k = j * nx + i;
        if (pointInPolygon(x, z, rings)) { h[k] = level - depth; continue; }
        const d = edgeDist(x, z);
        if (d >= band) continue;
        const t = d / band, sm = t * t * (3 - 2 * t);
        const target = level + bank;
        h[k] = target + (h[k] - target) * sm;
      }
    return level;
  }

  function buildMesh(groundTexture) {
    const pos = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = x0 + i * dx;
        pos[k * 3 + 1] = H(i, j);
        pos[k * 3 + 2] = z0 + j * dz;
        uv[k * 2] = i / (nx - 1);
        uv[k * 2 + 1] = 1 - j / (ny - 1);
      }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let n = 0;
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = (j + 1) * nx + i, c = (j + 1) * nx + i + 1, d = j * nx + i + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = d;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terreno';

    // "saia" ao redor da borda para o mapa não parecer uma folha flutuando
    const skirt = buildSkirt();
    return { mesh, skirt };
  }

  /**
   * Malha de detalhe: o mesmo relevo (mesmos vértices) recortado no retângulo `rect`, com uma
   * textura de alta resolução por cima (polygonOffset evita briga de profundidade com a base).
   */
  function buildDetailMesh(rect, texture) {
    const i0 = Math.max(0, Math.floor((rect.x0 - x0) / dx)), i1 = Math.min(nx - 1, Math.ceil((rect.x0 + rect.width - x0) / dx));
    const j0 = Math.max(0, Math.floor((rect.z0 - z0) / dz)), j1 = Math.min(ny - 1, Math.ceil((rect.z0 + rect.depth - z0) / dz));
    const cw = i1 - i0 + 1, chh = j1 - j0 + 1;
    const pos = new Float32Array(cw * chh * 3), uv = new Float32Array(cw * chh * 2);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = (j - j0) * cw + (i - i0);
        const x = x0 + i * dx, z = z0 + j * dz;
        pos[k * 3] = x; pos[k * 3 + 1] = H(i, j); pos[k * 3 + 2] = z;
        uv[k * 2] = (x - rect.x0) / rect.width;
        uv[k * 2 + 1] = 1 - (z - rect.z0) / rect.depth;
      }
    const idx = new Uint32Array((cw - 1) * (chh - 1) * 6);
    let n = 0;
    for (let j = 0; j < chh - 1; j++)
      for (let i = 0; i < cw - 1; i++) {
        const a = j * cw + i, b = (j + 1) * cw + i, c = (j + 1) * cw + i + 1, d = j * cw + i + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = d;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.receiveShadow = true;
    mesh.name = 'terreno-detalhe-campus';
    return mesh;
  }

  function buildSkirt() {
    const pts = [];
    for (let i = 0; i < nx; i++) pts.push([i, 0]);
    for (let j = 1; j < ny; j++) pts.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i--) pts.push([i, ny - 1]);
    for (let j = ny - 2; j > 0; j--) pts.push([0, j]);
    pts.push([0, 0]);
    const pos = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ia, ja] = pts[k], [ib, jb] = pts[k + 1];
      const ax = x0 + ia * dx, az = z0 + ja * dz, bx = x0 + ib * dx, bz = z0 + jb * dz;
      const ha = H(ia, ja), hb = H(ib, jb), lo = -40;
      pos.push(ax, ha, az, bx, hb, bz, ax, lo, az, bx, hb, bz, bx, lo, bz, ax, lo, az);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1, side: THREE.DoubleSide }));
    mesh.name = 'saia-terreno';
    return mesh;
  }

  return { heightAt, roadHeightAt, platformFor: (building) => platforms.get(building), prepareBuildingPlatform, carveWater, gradePlatform, gradeCorridors, buildMesh, buildDetailMesh, base, bounds: { x0, z0, x1, z1, width, depth }, minAlt: data.min, maxAlt: data.max };
}

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
