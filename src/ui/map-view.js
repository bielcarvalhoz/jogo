/** World/screen transform shared by drawing, hit testing, pan and anchored zoom. */
export class MapView {
  constructor(bounds) {
    this.bounds = bounds; this.width = 1; this.height = 1;
    this.x = bounds.x0 + bounds.width / 2; this.z = bounds.z0 + bounds.depth / 2; this.zoom = 1;
  }
  resize(width, height) { this.width = Math.max(1, width); this.height = Math.max(1, height); }
  get scale() { return Math.min(this.width / this.bounds.width, this.height / this.bounds.depth) * this.zoom; }
  toScreen(x, z) { return [this.width / 2 + (x - this.x) * this.scale, this.height / 2 + (z - this.z) * this.scale]; }
  toWorld(x, y) { return [this.x + (x - this.width / 2) / this.scale, this.z + (y - this.height / 2) / this.scale]; }
  pan(dx, dy) { this.x -= dx / this.scale; this.z -= dy / this.scale; this.clamp(); }
  zoomAt(factor, sx = this.width / 2, sy = this.height / 2) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(1, Math.min(16, this.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.x += before[0] - after[0]; this.z += before[1] - after[1]; this.clamp();
  }
  fit(region = this.bounds) {
    this.x = region.x0 + region.width / 2; this.z = region.z0 + region.depth / 2;
    this.zoom = Math.max(1, Math.min(16, Math.min(this.width / (region.width * 1.2), this.height / (region.depth * 1.2)) / Math.min(this.width / this.bounds.width, this.height / this.bounds.depth)));
  }
  clamp() {
    this.x = Math.max(this.bounds.x0, Math.min(this.bounds.x0 + this.bounds.width, this.x));
    this.z = Math.max(this.bounds.z0, Math.min(this.bounds.z0 + this.bounds.depth, this.z));
  }
}
