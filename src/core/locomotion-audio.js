import { pointInPolygon, distToSegment } from '../shared/geo.js';

/** Use the same paved surfaces and area polygons that draw the walkable ground. */
export function footSurface(game, position) {
  if (game.training?.active) return 'concrete';
  const { x, y = 0, z } = position, map = game.map;
  const ground = map.terrain.heightAt(x, z);
  if (y > ground + .12) return 'concrete'; // stairs, decks, crate top, bridges
  const paved = map.roads?.surfaceHeightAt(x, z, y + .2);
  if (Number.isFinite(paved) && Math.abs(paved - y) < .3) return 'concrete';
  for (const road of map.world.roads || []) {
    for (let i = 1; i < road.pts.length; i++) {
      if (distToSegment(x, z, ...road.pts[i - 1], ...road.pts[i]).d < road.w / 2) return /dirt|earth|ground|unpaved|gravel|sand/.test(road.surface || road.tags?.surface || '') ? 'dirt' : 'concrete';
    }
  }
  for (let i = map.world.areas.length - 1; i >= 0; i--) {
    const area = map.world.areas[i];
    if (!pointInPolygon(x, z, area.rings)) continue;
    if (['pitch', 'lawn', 'grass', 'forest', 'wood', 'park', 'meadow'].includes(area.kind)) return 'grass';
    if (['dirt', 'bare', 'sand', 'construction', 'scrub', 'farmland'].includes(area.kind)) return 'dirt';
    if (['deck', 'parking', 'court', 'tennis', 'track', 'pedestrian', 'residential', 'industrial'].includes(area.kind)) return 'concrete';
  }
  return 'dirt';
}

export function bindLocomotionAudio(game) {
  const events = game.player.events;
  const footstep = ({ detail }) => game.audio?.footstep(footSurface(game, detail.position || game.player.feet), { ...detail, position: detail.position || game.player.feet });
  const jump = ({ detail }) => game.audio?.jump(footSurface(game, detail?.position || game.player.feet), detail?.position || game.player.feet);
  const land = ({ detail }) => game.audio?.land(footSurface(game, detail.position || game.player.feet), detail.speed, detail.position || game.player.feet);
  events.addEventListener('footstep', footstep);
  events.addEventListener('jump', jump);
  events.addEventListener('land', land);
  return () => { events.removeEventListener('footstep', footstep); events.removeEventListener('jump', jump); events.removeEventListener('land', land); };
}
