// Destinos de teletransporte do entorno (pontos conhecidos do OSM), sempre numa rua com nome
// e olhando ao longo dela, no sentido do destino.
const POIS = [
  ['Shopping União de Osasco', 'Shopping União de Osasco'],
  ['Terminal Amador Aguiar (Vila Yara)', 'Terminal Urbano Amador Aguiar'],
  ['São Francisco Golf Club', 'São Francisco Golf Club'],
  ['Pátio Osasco Open Mall', 'Pátio Osasco Open Mall'],
];

const centroidOf = (rings) => {
  let x = 0, z = 0;
  for (const [a, b] of rings[0]) { x += a; z += b; }
  return [x / rings[0].length, z / rings[0].length];
};

/** completa `places` (que já pode ter destinos de plugins, ex.: portarias do campus) */
export function addMapPlaces(world, places) {
  const carRoads = world.roads.filter((r) => r.kind !== 'foot' && !r.bridge && r.name);
  const nearestRoadPoint = (x, z) => {
    let best = [x, z, 1, 0], bd = Infinity;
    for (const r of carRoads)
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
        if (d < bd) { const l = Math.sqrt(l2); bd = d; best = [px, pz, dx / l, dz / l]; }
      }
    return best;
  };
  const findNamed = (name) => {
    const b = world.buildings.find((f) => f.tags.name === name) || world.areas.find((f) => f.tags.name === name);
    return b ? centroidOf(b.rings) : null;
  };
  const added = [];
  if (!places.length && world.quarter) added.push({ name: 'Cidade de Deus', target: centroidOf(world.quarter) });
  for (const [label, osmName] of POIS) {
    const c = findNamed(osmName);
    if (c) added.push({ name: label, target: c });
  }
  for (const p of added) {
    let tx, tz;
    [p.x, p.z, tx, tz] = nearestRoadPoint(p.target[0], p.target[1]);
    const toX = p.target[0] - p.x, toZ = p.target[1] - p.z;
    if (tx * toX + tz * toZ < 0) { tx = -tx; tz = -tz; }
    p.yaw = Math.atan2(-tx, -tz);
    places.push(p);
  }
}
