import { openRing } from '../shared/geo.js';

// Lê o GeoJSON (lon/lat) e devolve as feições já em coordenadas locais (metros),
// separadas por categoria.

// largura total (m), estilo de pintura e prioridade de desenho de cada classe de via
export const ROAD_CLASSES = {
  motorway: { w: 14, kind: 'oneway', order: 10 },
  trunk: { w: 13, kind: 'twoway', order: 10 },
  primary: { w: 12, kind: 'twoway', order: 9 },
  secondary: { w: 10, kind: 'twoway', order: 8 },
  tertiary: { w: 8.5, kind: 'twoway', order: 7 },
  motorway_link: { w: 6.5, kind: 'oneway', order: 8 },
  trunk_link: { w: 6.5, kind: 'oneway', order: 8 },
  primary_link: { w: 6.5, kind: 'oneway', order: 8 },
  secondary_link: { w: 6, kind: 'oneway', order: 7 },
  tertiary_link: { w: 6, kind: 'oneway', order: 6 },
  busway: { w: 7, kind: 'oneway', order: 6 },
  residential: { w: 7, kind: 'local', order: 5 },
  unclassified: { w: 6.5, kind: 'local', order: 5 },
  living_street: { w: 5.5, kind: 'plain', order: 4 },
  service: { w: 4.5, kind: 'service', order: 3 },
  track: { w: 3, kind: 'service', order: 2 },
  // vias de pedestre: pintadas no chão, sem malha própria
  pedestrian: { w: 5, kind: 'foot', order: 1 },
  footway: { w: 2, kind: 'foot', order: 1 },
  path: { w: 1.6, kind: 'foot', order: 1 },
  steps: { w: 2.2, kind: 'foot', order: 1 },
  cycleway: { w: 2, kind: 'foot', order: 1 },
  corridor: { w: 2, kind: 'foot', order: 1 },
};

function lineToLocal(coords, proj) {
  const out = [];
  for (const [lon, lat] of coords) {
    const p = proj.toLocal(lon, lat);
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  return out;
}

function polygonsOf(geom, proj) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys
    .map((rings) => rings.map((r) => openRing(lineToLocal(r, proj))).filter((r) => r.length >= 3))
    .filter((rings) => rings.length > 0);
}

export function parseWorld(geojson, proj) {
  const W = {
    quarter: null,
    buildings: [],
    roads: [],
    areas: [],
    waterways: [],
    barriers: [],
    treeRows: [],
    points: [],
  };

  for (const f of geojson.features) {
    const t = f.properties || {};
    const g = f.geometry;
    if (!g) continue;

    if (t.place === 'quarter' && t.name === 'Cidade de Deus') {
      W.quarter = polygonsOf(g, proj)[0];
      continue;
    }

    if (g.type === 'Point') {
      const [x, z] = proj.toLocal(g.coordinates[0], g.coordinates[1]);
      W.points.push({ id: f.id, tags: t, x, z });
      continue;
    }

    if (g.type === 'LineString') {
      const pts = lineToLocal(g.coordinates, proj);
      if (pts.length < 2) continue;
      if (t.highway && ROAD_CLASSES[t.highway]) {
        const layer = parseInt(t.layer || '0', 10) || 0;
        if (t.tunnel && t.tunnel !== 'no') continue;
        if (layer < 0) continue; // passagens subterrâneas
        const cls = ROAD_CLASSES[t.highway];
        let w = cls.w;
        const lanes = parseInt(t.lanes || '', 10);
        if (lanes > 0 && cls.kind !== 'foot') w = Math.max(w * 0.6, lanes * 3.2 + 0.6);
        if (t.width && !isNaN(parseFloat(t.width))) w = parseFloat(t.width);
        const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
        let kind = cls.kind;
        if (kind === 'twoway' && oneway) kind = 'oneway';
        W.roads.push({
          id: f.id,
          tags: t,
          name: t.name || null,
          highway: t.highway,
          pts,
          w,
          kind,
          lanes: lanes > 0 ? lanes : kind === 'oneway' ? Math.max(1, Math.round(w / 3.3)) : 2,
          order: cls.order,
          bridge: !!t.bridge && t.bridge !== 'no',
          layer,
        });
      } else if (t.waterway) {
        if (t.tunnel && t.tunnel !== 'no') continue; // canalizado
        W.waterways.push({ tags: t, pts, w: t.waterway === 'river' ? 7 : t.waterway === 'stream' ? 3 : 2 });
      } else if (t.barrier && ['wall', 'fence', 'retaining_wall', 'guard_rail'].includes(t.barrier)) {
        W.barriers.push({ tags: t, pts, kind: t.barrier });
      } else if (t.natural === 'tree_row') {
        W.treeRows.push(pts);
      }
      continue;
    }

    const polys = polygonsOf(g, proj);
    if (!polys.length) continue;
    if (t.building || t['building:part']) {
      for (const rings of polys) W.buildings.push({ id: f.id, tags: t, rings });
      continue;
    }
    const kind = areaKind(t);
    if (kind) for (const rings of polys) W.areas.push({ id: f.id, tags: t, kind, rings });
  }
  return W;
}

export function areaKind(t) {
  if (t.leisure === 'swimming_pool' || t.amenity === 'fountain') return 'pool';
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'pitch') return 'pitch';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'sports_centre') return 'sports';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub' || t.natural === 'grassland') return 'scrub';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'recreation_ground') return 'grass';
  if (t.amenity === 'parking') return 'parking';
  if (['school', 'university', 'kindergarten', 'college'].includes(t.amenity)) return 'school';
  if (t.landuse === 'industrial') return 'industrial';
  if (t.landuse === 'retail' || t.landuse === 'commercial') return 'retail';
  if (t.landuse === 'residential') return 'residential';
  if (t.highway || t.area === 'yes') return 'plaza';
  return null;
}
