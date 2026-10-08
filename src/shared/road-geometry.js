// Metre-based polyline geometry shared by the carriageway, sidewalk and decals.
export function resampleRoad(points, step = 1.2) {
  const clean = points.filter((p, i) => !i || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-5);
  if (!clean.length) return [];
  const out = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1], b = clean[i];
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= count; k++) out.push([a[0] + (b[0] - a[0]) * k / count, a[1] + (b[1] - a[1]) * k / count]);
  }
  return out;
}

export function roadFrames(points) {
  let distance = 0;
  return points.map(([x, z], i) => {
    if (i) distance += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
    let miter = 1;
    if (i && i < points.length - 1) {
      const px = x - a[0], pz = z - a[1], length = Math.hypot(px, pz) || 1;
      miter = 1 / Math.max(0.65, Math.abs(-tz * (-pz / length) + tx * (px / length)));
    }
    return { x, z, tx, tz, nx: -tz * miter, nz: tx * miter, distance };
  });
}

export const offsetPoint = (frame, distance) => [frame.x + frame.nx * distance, frame.z + frame.nz * distance];
export const stripQuad = (a, b, inner, outer) => [offsetPoint(a, inner), offsetPoint(a, outer), offsetPoint(b, outer), offsetPoint(b, inner)];

const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const area = (polygon) => polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

function splitByLine(polygon, a, b, sign) {
  const inside = [], outside = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = cross(a, b, p) * sign, dq = cross(a, b, q) * sign;
    if (dp >= -1e-7) inside.push(p);
    if (dp <= 1e-7) outside.push(p);
    if ((dp > 1e-7 && dq < -1e-7) || (dp < -1e-7 && dq > 1e-7)) {
      const t = dp / (dp - dq), cut = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      inside.push(cut); outside.push(cut);
    }
  }
  return { inside, outside };
}

/** Subtract one convex road footprint without putting sidewalks over a junction. */
export function subtractConvex(polygon, obstacle) {
  const pieces = [], sign = Math.sign(area(obstacle)) || 1;
  // Most spatial-grid neighbours do not intersect. Reject them before splitting
  // against infinite edge lines, which would otherwise fragment intact paving.
  for (let i = 0; i < obstacle.length; i++) {
    const a = obstacle[i], b = obstacle[(i + 1) % obstacle.length];
    if (polygon.every((p) => cross(a, b, p) * sign <= 1e-7)) return [polygon];
  }
  const subjectSign = Math.sign(area(polygon)) || 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (obstacle.every((p) => cross(a, b, p) * subjectSign <= 1e-7)) return [polygon];
  }
  let remaining = polygon;
  for (let i = 0; i < obstacle.length && remaining.length >= 3; i++) {
    const split = splitByLine(remaining, obstacle[i], obstacle[(i + 1) % obstacle.length], sign);
    if (split.outside.length >= 3 && Math.abs(area(split.outside)) > 1e-6) pieces.push(split.outside);
    remaining = split.inside;
  }
  return pieces;
}

/** Exact support height for one visible triangle; undefined outside its footprint. */
export function triangleHeightAt(x, z, a, b, c) {
  const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(den) < 1e-9) return undefined;
  const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
  const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
  if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) return undefined;
  return a[1] * u + b[1] * v + c[1] * (1 - u - v);
}
