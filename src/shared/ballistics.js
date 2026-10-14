export const PAINT_GRAVITY = 3;

/** Exact integration shared by local prediction and the authority. */
export function advanceProjectile(position, velocity, dt, gravity = PAINT_GRAVITY) {
  return {
    position: { x: position.x + velocity.x * dt, y: position.y + velocity.y * dt - gravity * dt * dt / 2, z: position.z + velocity.z * dt },
    velocity: { x: velocity.x, y: velocity.y - gravity * dt, z: velocity.z },
  };
}

/** A shot ID gives both sides the same spread, including every shotgun pellet. */
export function projectileDirections(direction, weapon, aiming, shotId, random = Math.random) {
  let seed = shotId >>> 0;
  const roll = Number.isSafeInteger(shotId) ? () => {
    seed += 0x6D2B79F5;
    let n = Math.imul(seed ^ seed >>> 15, seed | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  } : random;
  const length = Math.hypot(direction.x, direction.z);
  const right = length > 1e-8 ? { x: -direction.z / length, y: 0, z: direction.x / length } : { x: 1, y: 0, z: 0 };
  const up = { x: -right.z * direction.y, y: right.z * direction.x - right.x * direction.z, z: right.x * direction.y };
  const spread = !aiming && weapon.hipSpread ? weapon.hipSpread : weapon.spread;
  return Array.from({ length: weapon.pellets }, (_, pellet) => {
    const angle = roll() * Math.PI * 2, radius = weapon.pellets > 1 && pellet === 0 ? 0 : Math.sqrt(roll()) * spread;
    const a = Math.cos(angle) * radius, b = Math.sin(angle) * radius;
    const d = { x: direction.x + right.x * a + up.x * b, y: direction.y + up.y * b, z: direction.z + right.z * a + up.z * b };
    const size = Math.hypot(d.x, d.y, d.z);
    return { x: d.x / size, y: d.y / size, z: d.z / size };
  });
}
