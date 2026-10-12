import { boxEntry } from './hitboxes.js';

/** Four-neighbour BFS fields shared by agents heading toward the same cell.
 * The blocked grid is inflated by the actor radius; no diagonal corner cutting. */
export function createFlowField({ bounds, cellSize = 1.25, radius = .4, maxFields = 24, isBlocked, isSegmentClear, guardGrid = false }) {
  const width = Math.ceil((bounds.x1 - bounds.x0) / cellSize), height = Math.ceil((bounds.z1 - bounds.z0) / cellSize);
  const blocked = new Uint8Array(width * height), queue = new Int32Array(blocked.length), fields = new Map(), clearPaths = new Map();
  let obstacles = [], signature = '', revision = 0;
  const cell = p => [Math.max(0, Math.min(width - 1, Math.floor((p.x - bounds.x0) / cellSize))), Math.max(0, Math.min(height - 1, Math.floor((p.z - bounds.z0) / cellSize)))];
  const index = p => { const [x, z] = cell(p); return z * width + x; };
  const center = i => ({ x: bounds.x0 + (i % width + .5) * cellSize, y: 0, z: bounds.z0 + (Math.floor(i / width) + .5) * cellSize });
  function neighbors(i) {
    const x = i % width, z = Math.floor(i / width), result = [];
    if (x > 0) result.push(i - 1); if (x + 1 < width) result.push(i + 1);
    if (z > 0) result.push(i - width); if (z + 1 < height) result.push(i + width);
    return result;
  }
  function setObstacles(next) {
    const stamp = next.map(b => [b.min.x, b.min.z, b.max.x, b.max.z].map(n => Math.round(n * 10)).join(',')).join(';');
    if (stamp === signature) return false;
    signature = stamp; obstacles = next.map(b => ({ min: { ...b.min }, max: { ...b.max } }));
    blocked.fill(0);
    for (const box of isBlocked ? [] : obstacles) {
      const pad = radius + cellSize * .5;
      const [x0, z0] = cell({ x: box.min.x - pad, z: box.min.z - pad });
      const [x1, z1] = cell({ x: box.max.x + pad, z: box.max.z + pad });
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) blocked[z * width + x] = 1;
    }
    if (isBlocked) for (let i = 0; i < blocked.length; i++) { const p = center(i); blocked[i] = isBlocked(p.x, p.z, radius) ? 1 : 0; }
    fields.clear(); clearPaths.clear(); revision++; return true;
  }
  function nearestFree(p) {
    const start = index(p);
    if (!blocked[start]) return center(start);
    const seen = new Uint8Array(blocked.length); let head = 0, tail = 1; queue[0] = start; seen[start] = 1;
    while (head < tail) for (const n of neighbors(queue[head++])) {
      if (seen[n]) continue;
      if (!blocked[n]) return center(n);
      seen[n] = 1; queue[tail++] = n;
    }
    return null;
  }
  function fieldFor(target) {
    const free = nearestFree(target); if (!free) return null;
    const goal = index(free);
    if (fields.has(goal)) return fields.get(goal);
    const distances = new Int32Array(blocked.length); distances.fill(-1);
    let head = 0, tail = 1; queue[0] = goal; distances[goal] = 0;
    while (head < tail) {
      const i = queue[head++];
      for (const n of neighbors(i)) if (!blocked[n] && distances[n] < 0) {
        distances[n] = distances[i] + 1; queue[tail++] = n;
      }
    }
    if (fields.size >= maxFields) fields.delete(fields.keys().next().value);
    fields.set(goal, distances); return distances;
  }
  function segmentClear(from, to, padding = radius) {
    if (guardGrid) {
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / (cellSize / 4)));
      for (let i = 0; i <= steps; i++) if (blocked[index({ x: from.x + (to.x - from.x) * i / steps, z: from.z + (to.z - from.z) * i / steps })]) return false;
    }
    if (isSegmentClear) return isSegmentClear(from, to, padding);
    const a = { x: from.x, y: .8, z: from.z }, b = { x: to.x, y: .8, z: to.z };
    return obstacles.every(box => !Number.isFinite(boxEntry(a, b, { min: { ...box.min, y: -10 }, max: { ...box.max, y: 10 } }, padding)));
  }
  function waypoint(from, target) {
    let direct = false;
    if (target.x >= bounds.x0 && target.x < bounds.x1 && target.z >= bounds.z0 && target.z < bounds.z1) {
      if (guardGrid) {
        // Surveyed geometry is static. Cache the expensive long sightline by
        // cell; each actual movement still gets its exact short sweep below.
        const a = index(from), b = index(target), key = a * blocked.length + b;
        if (!clearPaths.has(key)) { if (clearPaths.size >= 10000) clearPaths.clear(); clearPaths.set(key, segmentClear(center(a), center(b))); }
        direct = clearPaths.get(key);
      } else direct = segmentClear(from, target);
    }
    if (direct) return { x: target.x, y: 0, z: target.z };
    const distances = fieldFor(target); if (!distances) return null;
    let i = index(from);
    if (distances[i] < 0) return null; // unreachable, never fall back to walking through walls
    for (let step = 0; step < 3 && distances[i] > 0; step++) {
      const n = neighbors(i).find(n => distances[n] >= 0 && distances[n] < distances[i]);
      if (n === undefined || !segmentClear(from, center(n))) break;
      i = n;
    }
    return center(i);
  }
  return { bounds, blocked, width, height, cellSize, setObstacles, nearestFree, waypoint, segmentClear,
    get stats() { return { revision, fields: fields.size, cells: blocked.length }; },
  };
}
