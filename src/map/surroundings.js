import { pointInPolygon, ringCentroid } from '../shared/geo.js';

/** Keep the full world for terrain/map data, but omit surrounding 3D assets. */
export function renderWorldFor(world, surroundings = 'off') {
  if (surroundings !== 'off' || !world.quarter) return world;
  const inside = (p) => pointInPolygon(p[0], p[1], world.quarter);
  const polygonInside = (item) => inside(ringCentroid(item.rings[0]));
  return {
    ...world,
    buildings: world.buildings.filter(polygonInside),
    areas: world.areas.filter(polygonInside),
    roads: world.roads.filter(r => r.internal || r.pts.some(inside)),
    barriers: world.barriers.filter(r => r.pts.some(inside)),
    treeRows: world.treeRows.filter(r => r.some(inside)),
    waterways: world.waterways.filter(r => r.pts.some(inside)),
    points: world.points.filter(p => inside([p.x, p.z])),
  };
}
