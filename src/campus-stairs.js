import { referenceEntrance } from './campus-reference.js';

/** Choose an actual stair run before drawing it: safe rises need adequate treads. */
export function planEntranceStairs(C, b, info, e, terrain) {
  const pavilion = b.style === 'pavilion';
  const landing = 1.45, minimumRun = pavilion ? 1.2 : 2.15;
  const rise = pavilion ? .36 : b.planId === 'b17' ? .32 : b.planId === 'b6' ? 1.35 : .9;
  const preferredWidth = pavilion ? 5.4 : b.planId === 'b17' ? 8 : 4.4;
  const at = (u, v) => [e.x + e.dx * u + e.nx * v, e.z + e.dz * u + e.nz * v];
  const limit = Math.min(80, Math.floor((e.clearance - landing - .55) / .30));
  for (let steps = 3; steps <= limit; steps++) {
    const run = Math.max(minimumRun, steps * .30), foot = landing + run;
    if (foot > e.clearance - .55) continue;
    const bottomY = terrain.heightAt(...at(0, foot));
    const entryY = Math.max(info.gMin + rise, bottomY + .4);
    const dh = (entryY - bottomY) / steps, tread = run / steps;
    if (dh > .17 + 1e-8 || tread < .27) continue;
    for (let width = preferredWidth; width >= 2.4 - 1e-8; width -= .4) {
      let clear = true;
      // Check the complete run; an intervening bend or footprint can lie between
      // otherwise clear end corners. The two sides also catch cross-slope burial.
      for (let k = 0; clear && k <= Math.ceil(foot / .25); k++) {
        const v = .08 + (foot - .08) * k / Math.ceil(foot / .25);
        const top = v < landing ? entryY : entryY - Math.min(steps - 1, Math.floor((v - landing) / tread)) * dh;
        for (const u of [-width / 2, 0, width / 2]) {
          const [x, z] = at(u, v);
          if (C.RI.clearance(x, z).d <= .45 || !C.inRegion(x, z, .1) || C.insideSolid(x, z, .025) || terrain.heightAt(x, z) > top + .025) { clear = false; break; }
        }
      }
      if (clear) return { width, landing, run, steps, tread, dh, entryY, bottomY };
    }
  }
  return null;
}

/** Keep the photographed paired doors; other buildings may use a clear side frontage. */
export function chooseEntranceStairs(C, b, info, frontage, terrain, roads) {
  let e = frontage;
  const rejected = [];
  for (let attempt = 0; e && attempt < 12; attempt++) {
    const stairs = planEntranceStairs(C, b, info, e, terrain);
    if (stairs) return { frontage: e, stairs };
    if (['b3', 'b5'].includes(b.planId)) break;
    rejected.push([e.x + e.nx * 3, e.z + e.nz * 3]);
    e = referenceEntrance(b, roads, (x, z) => C.inRegion(x, z, .3) && !C.insideSolid(x, z, .2)
      && rejected.every(p => Math.hypot(x - p[0], z - p[1]) > .5));
  }
  return null;
}
