/** Resolve penetration while retaining the tangent so input can go around a body.
 * A pre-existing overlap can escape without pushing an idle character each frame. */
export function slideCharacterContacts(x, z, radius, feetY, actors, { from, exclude } = {}) {
  for (const other of actors) {
    if (other === exclude || other.dead || other.networkGhost || feetY >= other.position.y + 1.8 || feetY + 1.8 <= other.position.y) continue;
    const dx = x - other.position.x, dz = z - other.position.z, distance = Math.hypot(dx, dz);
    const limit = radius + other.radius;
    const clearance = from ? Math.min(limit, Math.hypot(from.x - other.position.x, from.z - other.position.z)) : limit;
    if (distance < clearance - 1e-7) {
      const nx = distance ? dx / distance : from ? (from.x - other.position.x) / clearance : 1;
      const nz = distance ? dz / distance : from ? (from.z - other.position.z) / clearance : 0;
      x = other.position.x + nx * clearance; z = other.position.z + nz * clearance;
    }
  }
  return [x, z];
}

/** Sweep short steps and converge all contacts together. Conflicting contacts
 * retain the last stable point rather than alternating pushes every frame. */
export function moveWithContacts(from, to, radius, feetY, collide, options) {
  let x = from.x, z = from.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - x, to.z - z) / (radius * .45)));
  for (let step = 1; step <= steps; step++) {
    let nx = x + (to.x - from.x) / steps, nz = z + (to.z - from.z) / steps, stable = false;
    for (let i = 0; i < 8; i++) {
      const [cx, cz] = collide(nx, nz, radius, feetY, { ...options, from: { x, z }, push: false });
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) break;
      if (Math.hypot(cx - nx, cz - nz) < .0001) { stable = true; break; }
      nx = cx; nz = cz;
    }
    if (!stable || Math.hypot(nx - x, nz - z) > Math.hypot(to.x - from.x, to.z - from.z) / steps + radius) break;
    x = nx; z = nz;
  }
  // Apply a physical prop impulse once, never during the convergence probes.
  if (options?.push !== false && Math.hypot(to.x - from.x, to.z - from.z) > .0001) collide(to.x, to.z, radius, feetY, options);
  return [x, z];
}
