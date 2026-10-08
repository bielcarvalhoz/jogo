import * as THREE from 'three';

/** Continuous mitered wall: adjacent segments share a join, with no overlapping caps. */
export function campusWallGeometry(walls, heightAt, height = 2.6, thickness = .24) {
  const pos = [], colors = [];
  const side = new THREE.Color('#d4d1ca'), cap = new THREE.Color('#b8b2a6');
  const quad = (a, b, c, d, color) => {
    for (const point of [a, b, c, a, c, d]) { pos.push(...point); colors.push(color.r, color.g, color.b); }
  };
  for (const input of walls) {
    const points = [];
    for (const p of input) if (!points.length || Math.hypot(p[0] - points.at(-1)[0], p[1] - points.at(-1)[1]) > .01) points.push(p);
    if (points.length < 2) continue;
    const closed = Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < .01;
    const normals = points.slice(1).map((p, i) => {
      const a = points[i], length = Math.hypot(p[0] - a[0], p[1] - a[1]);
      return [-(p[1] - a[1]) / length, (p[0] - a[0]) / length];
    });
    const joins = points.map((p, i) => {
      const before = normals[i - 1] || (closed ? normals.at(-1) : normals[0]);
      const after = normals[i] || (closed ? normals[0] : normals.at(-1));
      let nx = before[0] + after[0], nz = before[1] + after[1];
      const len = Math.hypot(nx, nz);
      if (len < .05) { nx = after[0]; nz = after[1]; } else { nx /= len; nz /= len; }
      const extent = Math.min(thickness * 1.5, thickness / 2 / Math.max(.25, nx * after[0] + nz * after[1]));
      const h = heightAt(...p);
      return { left: [p[0] + nx * extent, p[1] + nz * extent], right: [p[0] - nx * extent, p[1] - nz * extent], bottom: h - .35, top: h + height + .12 };
    });
    const vertex = (j, sideName, level) => [j[sideName][0], j[level], j[sideName][1]];
    for (let i = 1; i < joins.length; i++) {
      const a = joins[i - 1], b = joins[i];
      quad(vertex(a, 'left', 'bottom'), vertex(b, 'left', 'bottom'), vertex(b, 'left', 'top'), vertex(a, 'left', 'top'), side);
      quad(vertex(b, 'right', 'bottom'), vertex(a, 'right', 'bottom'), vertex(a, 'right', 'top'), vertex(b, 'right', 'top'), side);
      quad(vertex(a, 'left', 'top'), vertex(b, 'left', 'top'), vertex(b, 'right', 'top'), vertex(a, 'right', 'top'), cap);
    }
    if (!closed) {
      const a = joins[0], b = joins.at(-1);
      quad(vertex(a, 'right', 'bottom'), vertex(a, 'left', 'bottom'), vertex(a, 'left', 'top'), vertex(a, 'right', 'top'), side);
      quad(vertex(b, 'left', 'bottom'), vertex(b, 'right', 'bottom'), vertex(b, 'right', 'top'), vertex(b, 'left', 'top'), side);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
