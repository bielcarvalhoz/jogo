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
