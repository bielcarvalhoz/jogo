import { pointInPolygon, SpatialGrid } from './geo.js';

/** Exact polygon/circle occupancy with a bounded broad phase. */
export function createRegionTest(regions, cell = 24) {
  const grid = new SpatialGrid(cell);
  for (const region of regions) {
    if (region.rings) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of region.rings[0]) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      grid.insertBox(region, x0, z0, x1, z1);
    } else if (region.radius > 0) grid.insertBox(region, region.x - region.radius, region.z - region.radius, region.x + region.radius, region.z + region.radius);
  }
  return (x, z) => {
    for (const region of grid.query(x, z)) {
      if (region.rings ? pointInPolygon(x, z, region.rings) : Math.hypot(x - region.x, z - region.z) < region.radius) return true;
    }
    return false;
  };
}
