import { traceHitboxes } from '../src/gameplay/combat/hitboxes.js';
import { NET } from '../src/shared/multiplayer.js';

/** Keep immutable collision poses; rewinding must never move the live world. */
export function createHitboxHistory() {
  const frames = [];
  function record(time, actors) {
    const poses = new Map();
    for (const e of actors) if (!e.dead && !e.networkGhost) poses.set(e.id, {
      entity: e, life: e.networkLife, position: { ...e.position }, yaw: e.yaw || 0,
      boxes: e.hitboxes.map(c => ({ region: c.region, radius: c.radius, a: { ...c.a }, b: { ...c.b } })),
    });
    const frame = { time, poses };
    if (frames.at(-1)?.time === time) frames[frames.length - 1] = frame; else frames.push(frame);
    while (frames.length > 2 && frames[1].time < time - NET.maxRewind) frames.shift();
  }
  function trace(from, to, source, time) {
    if (!frames.length || time < frames[0].time - 1e-6) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (frames[mid].time <= time) lo = mid; else hi = mid - 1; }
    const a = frames[lo], b = frames[lo + 1] || a;
    const alpha = a === b ? 0 : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
    const mix = (p, q) => ({ x: p.x + (q.x - p.x) * alpha, y: p.y + (q.y - p.y) * alpha, z: p.z + (q.z - p.z) * alpha });
    const targets = [];
    for (const [id, pose] of a.poses) {
      const e = pose.entity, next = b.poses.get(id);
      if (e === source || e.dead || e.networkGhost || e.networkLife !== pose.life || frames.at(-1).poses.get(id)?.entity !== e) continue;
      const continuous = next?.entity === e && next.life === pose.life && next.boxes.length === pose.boxes.length
        && Math.hypot(next.position.x - pose.position.x, next.position.y - pose.position.y, next.position.z - pose.position.z) < 8;
      const yaw = continuous ? pose.yaw + Math.atan2(Math.sin(next.yaw - pose.yaw), Math.cos(next.yaw - pose.yaw)) * alpha : pose.yaw;
      targets.push({ ...e, original: e, position: continuous ? mix(pose.position, next.position) : pose.position, yaw,
        hitboxes: continuous ? pose.boxes.map((c, i) => ({ ...c, a: mix(c.a, next.boxes[i].a), b: mix(c.b, next.boxes[i].b) })) : pose.boxes });
    }
    const hit = traceHitboxes(from, to, targets);
    return hit ? { ...hit, targetPose: { position: hit.entity.position, yaw: hit.entity.yaw }, entity: hit.entity.original } : null;
  }
  return { record, trace, get size() { return frames.length; } };
}

export function attackTiming(action, now) {
  if (action.shotTime === undefined && action.viewTime === undefined) return { shotTime: now, viewTime: now };
  const { shotTime, viewTime } = action;
  if (!Number.isFinite(shotTime) || !Number.isFinite(viewTime)
    || shotTime > now + .05 || shotTime < now - NET.maxCatchup
    || viewTime > shotTime + 1 / NET.tickHz || viewTime < now - NET.maxRewind || viewTime < 0) return null;
  return { shotTime: Math.min(now, shotTime), viewTime: Math.min(now, viewTime) };
}
