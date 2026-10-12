// Rasterize the campus wall mask on Node, using the same polygon and rounded
// road strokes as computeWalls. Only this small mask needs a canvas on startup.
export function createRegionCanvas() {
  const canvas = { width: 0, height: 0 };
  let pixels, path = [];
  const value = color => color === '#fff' ? 255 : 0;
  const set = (x, y, color) => {
    if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) pixels[y * canvas.width + x] = color;
  };
  const context = {
    fillStyle: '#000', strokeStyle: '#fff', lineWidth: 1,
    fillRect() { pixels = new Uint8Array(canvas.width * canvas.height).fill(value(this.fillStyle)); },
    beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); }, closePath() {},
    fill() {
      const ys = path.map(p => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(canvas.height - 1, Math.ceil(Math.max(...ys))); y++) {
        const cuts = [];
        for (let i = 0; i < path.length; i++) {
          const a = path[i], b = path[(i + 1) % path.length];
          if ((a[1] > y + .5) !== (b[1] > y + .5)) cuts.push(a[0] + (y + .5 - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        cuts.sort((a, b) => a - b);
        for (let i = 0; i + 1 < cuts.length; i += 2) for (let x = Math.max(0, Math.ceil(cuts[i] - .5)); x < Math.min(canvas.width, cuts[i + 1] - .5); x++) set(x, y, value(this.fillStyle));
      }
    },
    stroke() {
      const radius = this.lineWidth / 2;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy || 1;
        for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius)); y <= Math.min(canvas.height - 1, Math.ceil(Math.max(a[1], b[1]) + radius)); y++) {
          for (let x = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius)); x <= Math.min(canvas.width - 1, Math.ceil(Math.max(a[0], b[0]) + radius)); x++) {
            const t = Math.max(0, Math.min(1, ((x + .5 - a[0]) * dx + (y + .5 - a[1]) * dy) / length2));
            if ((x + .5 - a[0] - t * dx) ** 2 + (y + .5 - a[1] - t * dy) ** 2 <= radius ** 2) set(x, y, value(this.strokeStyle));
          }
        }
      }
    },
    getImageData() {
      const data = new Uint8ClampedArray(pixels.length * 4);
      for (let i = 0; i < pixels.length; i++) data[i * 4] = pixels[i];
      return { data };
    },
  };
  canvas.getContext = () => context;
  return canvas;
}
