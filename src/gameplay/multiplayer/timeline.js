import { NET } from '../../shared/multiplayer.js';

/** Interpolate on simulation timestamps, never on packet arrival order. */
export class SnapshotTimeline {
  constructor() { this.clear(); }
  clear() { this.frames = []; this.jitter = 0; this.renderTime = 0; }
  get delay() { return Math.max(NET.minInterpolation, Math.min(NET.maxInterpolation, 1.25 / NET.snapshotHz + this.jitter * 2)); }
  add(data, at) {
    const last = this.frames.at(-1);
    if (!Number.isFinite(data?.time) || (last && data.time <= last.data.time)) return false;
    if (last) {
      const deviation = Math.abs((at - last.at) - (data.time - last.data.time));
      this.jitter += (Math.min(.15, deviation) - this.jitter) * .15;
    }
    this.frames.push({ data, at });
    if (this.frames.length > 32) this.frames.shift();
    return true;
  }
  stale(now) { return !this.frames.length || now - this.frames.at(-1).at > NET.staleSeconds; }
  serverNow(now, rttMs = 0) {
    const latest = this.frames.at(-1);
    return latest ? latest.data.time + Math.max(0, now - latest.at) + Math.min(.2, rttMs / 2000) : 0;
  }
  sample(now) {
    const latest = this.frames.at(-1); if (!latest) return null;
    const target = Math.min(latest.data.time, Math.max(this.renderTime, latest.data.time + now - latest.at - this.delay));
    while (this.frames.length > 2 && this.frames[1].data.time <= target) this.frames.shift();
    const a = this.frames[0], b = this.frames[1] || a;
    const alpha = a === b ? 1 : Math.max(0, Math.min(1, (target - a.data.time) / (b.data.time - a.data.time)));
    this.renderTime = a.data.time + (b.data.time - a.data.time) * alpha;
    return { a: a.data, b: b.data, alpha, time: this.renderTime };
  }
}
