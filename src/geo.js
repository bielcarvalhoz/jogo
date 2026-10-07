// Conversão GeoJSON (lon/lat WGS84) -> coordenadas 3D locais em metros.
//
// Usa um plano tangente local (equiretangular centrado na origem). Para uma área de
// ~2 km o erro em relação a uma projeção UTM é da ordem de milímetros.
// Convenção Three.js:  x = leste,  y = altitude,  z = sul  (portanto -z = norte)

const DEG = Math.PI / 180;
const R = 6378137; // raio equatorial WGS84

export function createProjection(lon0, lat0) {
  const kx = R * DEG * Math.cos(lat0 * DEG);
  const kz = R * DEG;
  return {
    lon0,
    lat0,
    toLocal: (lon, lat) => [(lon - lon0) * kx, -(lat - lat0) * kz],
    toLonLat: (x, z) => [lon0 + x / kx, lat0 - z / kz],
  };
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** rings[0] = contorno externo, demais = furos */
export function pointInPolygon(x, z, rings) {
  if (!pointInRing(x, z, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, z, rings[i])) return false;
  return true;
}

/** área com sinal (o sinal depende da orientação; use Math.abs para a área) */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

export function ringCentroid(ring) {
  let x = 0, z = 0, n = 0;
  const last = ring.length - 1;
  const closed = ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
  for (let i = 0; i < (closed ? last : ring.length); i++) { x += ring[i][0]; z += ring[i][1]; n++; }
  return [x / n, z / n];
}

/** remove o ponto de fechamento duplicado e vértices repetidos */
export function openRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) out.pop();
  }
  return out;
}

export function isConvex(ring) {
  let sign = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n], [cx, cz] = ring[(i + 2) % n];
    const cr = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), t, cx, cz };
}

/** Grade espacial simples para consultas de proximidade em 2D (x/z). */
export class SpatialGrid {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
  }
  key(i, j) { return (i + 50000) * 100000 + (j + 50000); }
  insertBox(item, minX, minZ, maxX, maxZ) {
    const c = this.cell;
    for (let i = Math.floor(minX / c); i <= Math.floor(maxX / c); i++)
      for (let j = Math.floor(minZ / c); j <= Math.floor(maxZ / c); j++) {
        const k = this.key(i, j);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(item);
      }
  }
  query(x, z, r = 0) {
    const c = this.cell, out = new Set();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const arr = this.map.get(this.key(i, j));
        if (arr) for (const it of arr) out.add(it);
      }
    return out;
  }
}
