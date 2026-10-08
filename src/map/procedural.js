import { mulberry32, pick } from '../shared/rng.js';
import { pointInPolygon } from '../shared/geo.js';
import { PALETTE } from './buildings.js';

// O OSM só tem parte dos prédios desta região mapeados. Para a cidade não parecer vazia,
// geramos lotes ao longo das ruas reais, SEM invadir ruas, calçadas, prédios reais,
// praças, água, campo de golfe etc. (máscara de ocupação). Tudo marcado como procedural.

const FRONTAGE = {
  residential: 'house', unclassified: 'house', living_street: 'house',
  tertiary: 'mixed', secondary: 'avenue', primary: 'avenue',
};

/** options.skipQuarter: não gera nada dentro do bairro (quando o campus é modelado à mão) */
export function generateProcedural(world, masks, terrain, options = {}) {
  const rnd = mulberry32(1337);
  const specs = [];
  const quarter = world.quarter;

  const rectFree = (cx, cz, tx, tz, nx, nz, w, d) => {
    for (let u = -w / 2 + 0.4; u <= w / 2 - 0.4; u += 0.9)
      for (let v = -d / 2 + 0.4; v <= d / 2 - 0.4; v += 0.9) {
        const x = cx + tx * u + nx * v, z = cz + tz * u + nz * v;
        if (masks.build.get(x, z)) return false;
      }
    // não deixar a casa "pendurada" em barranco muito íngreme
    let lo = Infinity, hi = -Infinity;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const h = terrain.heightAt(cx + tx * su * w / 2 + nx * sv * d / 2, cz + tz * su * w / 2 + nz * sv * d / 2);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo < 7;
  };
  const mark = (cx, cz, tx, tz, nx, nz, w, d) => {
    for (let u = -w / 2; u <= w / 2; u += 0.5)
      for (let v = -d / 2; v <= d / 2; v += 0.5) {
        const x = cx + tx * u + nx * v, z = cz + tz * u + nz * v;
        masks.build.set(x, z);
        masks.tree.set(x, z);
      }
  };
  const rectRing = (cx, cz, tx, tz, nx, nz, w, d) => [
    [cx - tx * w / 2 - nx * d / 2, cz - tz * w / 2 - nz * d / 2],
    [cx + tx * w / 2 - nx * d / 2, cz + tz * w / 2 - nz * d / 2],
    [cx + tx * w / 2 + nx * d / 2, cz + tz * w / 2 + nz * d / 2],
    [cx - tx * w / 2 + nx * d / 2, cz - tz * w / 2 + nz * d / 2],
  ];

  function lotParams(zone) {
    if (zone === 'campus') {
      return { w: 18 + rnd() * 22, d: 14 + rnd() * 12, setback: 5 + rnd() * 6, gap: 10 + rnd() * 14, chance: 0.45 };
    }
    if (zone === 'avenue') return { w: 8 + rnd() * 10, d: 12 + rnd() * 10, setback: 0.4 + rnd() * 1.2, gap: rnd() * 1.5, chance: 0.9 };
    if (zone === 'mixed') return { w: 6 + rnd() * 7, d: 10 + rnd() * 8, setback: 0.3 + rnd() * 1.5, gap: rnd() * 1.2, chance: 0.9 };
    return { w: 5 + rnd() * 3.5, d: 8 + rnd() * 7, setback: rnd() * 2, gap: rnd() < 0.6 ? 0 : rnd() * 1.2, chance: 0.92 };
  }

  function makeSpec(zone, ring, w, d, idx) {
    const area = w * d;
    if (zone === 'campus') {
      const levels = 2 + Math.floor(rnd() * 4);
      return { id: `proc/${idx}`, rings: [ring], procedural: true, style: rnd() < 0.5 ? 'glass' : 'tower', levels, floorH: 3.6, height: levels * 3.6 + 0.6, wall: pick(rnd, PALETTE.glass), roof: pick(rnd, PALETTE.roofFlat), roofShape: 'flat' };
    }
    if (zone === 'avenue' || zone === 'mixed') {
      const tall = rnd() < (zone === 'avenue' ? 0.12 : 0.05) && area > 120;
      if (tall) {
        const levels = 6 + Math.floor(rnd() * 10);
        return { id: `proc/${idx}`, rings: [ring], procedural: true, style: 'tower', levels, floorH: 2.9, height: levels * 2.9 + 0.6, wall: pick(rnd, PALETTE.tower), roof: pick(rnd, PALETTE.roofFlat), roofShape: 'flat' };
      }
      const levels = 1 + Math.floor(rnd() * 3);
      return { id: `proc/${idx}`, rings: [ring], procedural: true, style: levels >= 3 && rnd() < 0.4 ? 'glass' : 'house', levels, floorH: 3.4, height: levels * 3.4 + 0.6, wall: pick(rnd, PALETTE.house), roof: pick(rnd, PALETTE.roofFlat), roofShape: 'flat', waterTank: rnd() < 0.5 };
    }
    const r = rnd();
    const levels = r < 0.45 ? 1 : r < 0.88 ? 2 : 3;
    const pyramid = rnd() < 0.42;
    return {
      id: `proc/${idx}`, rings: [ring], procedural: true, style: 'house', levels, floorH: 3.0, height: levels * 3.0 + 0.4,
      wall: pick(rnd, PALETTE.house),
      roof: pyramid ? pick(rnd, PALETTE.roofTile) : pick(rnd, PALETTE.roofFlat),
      roofShape: pyramid ? 'pyramid' : 'flat',
      waterTank: !pyramid && rnd() < 0.75,
      tankOff: [(rnd() - 0.5) * (w * 0.4), (rnd() - 0.5) * (d * 0.4)],
    };
  }

  for (const road of world.roads) {
    let zone = FRONTAGE[road.highway];
    const inCampus = (x, z) => quarter && pointInPolygon(x, z, quarter);
    if (road.highway === 'service') {
      if (options.skipQuarter) continue;
      const mid = road.pts[Math.floor(road.pts.length / 2)];
      if (!inCampus(mid[0], mid[1]) || road.tags.service) continue; // só as ruas internas do campus
      zone = 'campus';
    }
    if (!zone || road.bridge) continue;

    // pontos e tangentes ao longo da via
    const pts = road.pts;
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (L < 0.01) continue;
      segs.push({ a: pts[i], b: pts[i + 1], L, s: total });
      total += L;
    }
    const at = (s) => {
      for (const sg of segs) if (s <= sg.s + sg.L) {
        const f = (s - sg.s) / sg.L;
        const tx = (sg.b[0] - sg.a[0]) / sg.L, tz = (sg.b[1] - sg.a[1]) / sg.L;
        return { x: sg.a[0] + (sg.b[0] - sg.a[0]) * f, z: sg.a[1] + (sg.b[1] - sg.a[1]) * f, tx, tz };
      }
      return null;
    };

    for (const side of [1, -1]) {
      let s = 2 + rnd() * 3;
      while (s < total - 2) {
        const p = at(s);
        if (!p) break;
        const zoneHere = zone === 'campus' ? 'campus' : inCampus(p.x, p.z) ? 'campus' : zone;
        const lp = lotParams(zoneHere);
        const nx = -p.tz * side, nz = p.tx * side;
        const sidewalk = zone === 'campus' ? 2 : 2.6;
        const off = road.w / 2 + sidewalk + lp.setback + lp.d / 2;
        const sc = s + lp.w / 2;
        const q = at(Math.min(sc, total)) || p;
        const cx = q.x + nx * off, cz = q.z + nz * off;
        const inQuarter = options.skipQuarter && inCampus(cx, cz);
        if (!inQuarter && rnd() < lp.chance && rectFree(cx, cz, q.tx, q.tz, nx, nz, lp.w, lp.d)) {
          const ring = rectRing(cx, cz, q.tx, q.tz, nx, nz, lp.w, lp.d);
          mark(cx, cz, q.tx, q.tz, nx, nz, lp.w + 0.2, lp.d + 0.2);
          specs.push(makeSpec(zoneHere, ring, lp.w, lp.d, specs.length));
          // segunda fileira (fundos do lote)
          if (zoneHere === 'house' && rnd() < 0.4) {
            const d2 = 6 + rnd() * 6, w2 = lp.w * (0.8 + rnd() * 0.2);
            const off2 = off + lp.d / 2 + 1.5 + d2 / 2;
            const cx2 = q.x + nx * off2, cz2 = q.z + nz * off2;
            if (!(options.skipQuarter && inCampus(cx2, cz2)) && rectFree(cx2, cz2, q.tx, q.tz, nx, nz, w2, d2)) {
              mark(cx2, cz2, q.tx, q.tz, nx, nz, w2 + 0.2, d2 + 0.2);
              specs.push(makeSpec('house', rectRing(cx2, cz2, q.tx, q.tz, nx, nz, w2, d2), w2, d2, specs.length));
            }
          }
          s += lp.w + lp.gap;
        } else {
          s += 2.5;
        }
      }
    }
  }
  return specs;
}
