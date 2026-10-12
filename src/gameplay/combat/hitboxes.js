const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const at = (a, d, t) => ({ x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });

function sphereEntry(origin, direction, center, radius) {
  const offset = sub(origin, center), b = dot(offset, direction), c = dot(offset, offset) - radius * radius;
  if (c <= 0) return 0;
  const h = b * b - c;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : Infinity;
}

/** Swept ray/capsule intersection; no frame-sized point tests or skin triangles. */
export function capsuleEntry(origin, direction, capsule) {
  const { a, b, radius } = capsule, ba = sub(b, a), oa = sub(origin, a);
  const baba = dot(ba, ba), bard = dot(ba, direction), baoa = dot(ba, oa);
  if (baba < 1e-10) return sphereEntry(origin, direction, a, radius);
  const closest = at(a, ba, Math.max(0, Math.min(1, baoa / baba)));
  if (dot(sub(origin, closest), sub(origin, closest)) <= radius * radius) return 0;
  const A = baba - bard * bard, B = baba * dot(direction, oa) - baoa * bard;
  const C = baba * dot(oa, oa) - baoa * baoa - radius * radius * baba;
  const h = B * B - A * C;
  let result = Math.min(sphereEntry(origin, direction, a, radius), sphereEntry(origin, direction, b, radius));
  if (Math.abs(A) > 1e-10 && h >= 0) {
    const t = (-B - Math.sqrt(h)) / A, y = baoa + t * bard;
    if (t >= 0 && y >= 0 && y <= baba) result = Math.min(result, t);
  }
  return result;
}

export function traceHitboxes(from, to, entities, { exclude = null } = {}) {
  const delta = sub(to, from), length = Math.hypot(delta.x, delta.y, delta.z);
  if (length < 1e-8) return null;
  const direction = at({ x: 0, y: 0, z: 0 }, delta, 1 / length);
  let closest = null;
  for (const entity of entities) {
    if (entity === exclude || entity.dead || entity.networkGhost || entity.health.current <= 0) continue;
    for (const capsule of entity.hitboxes) {
      const distance = capsuleEntry(from, direction, capsule);
      if (distance > length || !Number.isFinite(distance) || (closest && distance >= closest.distance)) continue;
      const point = at(from, direction, distance), axis = sub(capsule.b, capsule.a), axisLength = dot(axis, axis);
      const center = at(capsule.a, axis, axisLength ? Math.max(0, Math.min(1, dot(sub(point, capsule.a), axis) / axisLength)) : 0);
      const normal = sub(point, center), normalLength = Math.hypot(normal.x, normal.y, normal.z) || 1;
      closest = { entity, region: capsule.region, distance, point, normal: at({ x: 0, y: 0, z: 0 }, normal, 1 / normalLength) };
    }
  }
  return closest;
}

/** Server-friendly standing/crouched collision rig, independent of first-person arms. */
export function updateHumanoidHitboxes(entity, crouched = false) {
  const p = entity.position, yaw = entity.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), h = crouched ? .68 : 1;
  const point = (x, y, z = 0) => ({ x: p.x + c * x + s * z, y: p.y + y * h, z: p.z - s * x + c * z });
  const capsule = (region, a, b, radius) => ({ region, a, b, radius });
  entity.hitboxes = [
    capsule('head', point(0, 1.6), point(0, 1.66), .16),
    capsule('thorax', point(0, .91), point(0, 1.34), .23),
    ...[-1, 1].flatMap(side => [
      capsule('limb', point(side * .34, 1.35), point(side * .4, .92), .095),
      capsule('limb', point(side * .13, .78), point(side * .13, .18), .12),
    ]),
  ];
  return entity.hitboxes;
}

/** AABB entry shared by navigation, line of sight and the objective collider. */
export function boxEntry(from, to, box, padding = 0) {
  let enter = 0, leave = 1;
  for (const axis of ['x', 'y', 'z']) {
    const low = box.min[axis] - padding, high = box.max[axis] + padding, d = to[axis] - from[axis];
    if (Math.abs(d) < 1e-9) { if (from[axis] < low || from[axis] > high) return Infinity; continue; }
    const a = (low - from[axis]) / d, b = (high - from[axis]) / d;
    enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return Infinity;
  }
  return enter;
}
