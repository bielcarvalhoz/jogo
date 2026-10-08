/** Spread colliding labels with short leaders; keep each anchor on the map. */
export function placeMarker(x, y, placed, width, height, gap = 29) {
  for (let n = 0; n < 49; n++) {
    const radius = n ? Math.ceil(n / 8) * gap : 0, angle = n * Math.PI / 4;
    const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
    if (px < gap / 2 || px > width - gap / 2 || py < gap / 2 || py > height - gap / 2) continue;
    if (placed.every(p => Math.hypot(p[0] - px, p[1] - py) >= gap)) return [px, py];
  }
  return null;
}
