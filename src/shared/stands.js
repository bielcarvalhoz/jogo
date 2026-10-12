/** Exact row and walkway footprints shared by rendering and authority. */
export function standVolumes(stand) {
  if (!stand) return [];
  const volumes = [];
  for (const seg of stand.segments) {
    const c = Math.cos(seg.frame.yaw), s = Math.sin(seg.frame.yaw);
    const point = (x, z) => [seg.frame.x + x * c + z * s, seg.frame.z - x * s + z * c];
    function row(x0, x1, z0, z1, top) {
      volumes.push({ rings: [[point(x0, z0), point(x1, z0), point(x1, z1), point(x0, z1)]], top, kind: 'degrau-arquibancada', stepable: true });
    }
    for (let k = 0; k < seg.rows; k++) {
      const ext = .25 + (k + .5) * .8 * .2;
      row(-ext, seg.L + ext, seg.side * k * .8, seg.side * (k + 1) * .8, stand.level + (k + 1) * stand.rise);
    }
    const we = seg.depth * .2 + .6;
    row(-we, seg.L + we, seg.side * seg.depth, seg.side * (seg.depth + 2.6), seg.top);
  }
  return volumes;
}
