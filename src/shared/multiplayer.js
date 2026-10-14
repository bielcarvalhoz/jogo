import { ringCentroid } from './geo.js';

export const NET = Object.freeze({ maxPlayers: 10, tickHz: 60, snapshotHz: 18, poseHz: 30, graceMs: 20000, emptyMs: 25000, protocol: 2,
  minInterpolation: .06, maxInterpolation: .15, maxRewind: .5, maxCatchup: .25, staleSeconds: 1 });
export const EV = Object.freeze({ list: 'rooms:list', rooms: 'rooms:update', create: 'room:create', join: 'room:join', leave: 'room:leave', welcome: 'room:welcome', roster: 'room:roster', pose: 'player:pose', action: 'player:action', snapshot: 'world:snapshot', event: 'world:event', signal: 'rtc:signal' });
export const EMOTES = Object.freeze({ wave: null, dance: null, smile: 'smile.png', heart: 'heart.png', gg: 'gg.png', fire: 'fire.png' });
export const EMOTE_NAMES = Object.freeze({ wave: 'Acenar', dance: 'Dançar', smile: 'Sorrir', heart: 'Coração', gg: 'Boa!', fire: 'Provocar' });
export const rankPlayers = players => [...players].sort((a, b) => (b.kills || 0) - (a.kills || 0) || (b.assists || 0) - (a.assists || 0) || (a.deaths || 0) - (b.deaths || 0) || a.id.localeCompare(b.id));
export const finitePoint = p => !!p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) < 100000);
export const cleanName = (v, fallback = 'Sala da treta', max = 32) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || fallback : fallback;
export const normalizeCode = v => typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
export const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Positions come from the surveyed campus, shared by the client and server. */
export function multiplayerLandmarks(campus, terrain) {
  const gate = campus.gates.find(g => /bussocaba/i.test(g.name)) || campus.gates[0];
  const center = ringCentroid(campus.quarter[0]);
  const length = Math.hypot(center[0] - gate.x, center[1] - gate.z) || 1;
  const inward = { x: (center[0] - gate.x) / length, z: (center[1] - gate.z) / length };
  const locate = (x, z) => ({ x, y: terrain.heightAt(x, z), z });
  const spawn = locate(gate.x + inward.x * 14, gate.z + inward.z * 14);
  const prata = campus.landmarks.find(m => m.id === 'prata-menos2');
  const building = campus.buildings.find(b => b.planId === prata.building);
  const [bx, bz] = ringCentroid(building.rings[0]);
  const away = Math.hypot(prata.x - bx, prata.z - bz) || 1;
  const defense = locate(prata.x + (prata.x - bx) / away * 4, prata.z + (prata.z - bz) / away * 4);
  const ring = campus.leisure.campo;
  // Use the surveyed track frame and the same 70 cm inset as the visible goal
  // posts in campus/details.js, including a slightly nonrectangular pitch.
  const track = campus.track, { ux, uz } = track;
  const u = ring.map(([x, z]) => (x - track.cx) * ux + (z - track.cz) * uz);
  const v = ring.map(([x, z]) => -(x - track.cx) * uz + (z - track.cz) * ux);
  const u0 = Math.min(...u) + .7, u1 = Math.max(...u) - .7, midU = (u0 + u1) / 2, midV = (Math.min(...v) + Math.max(...v)) / 2;
  const field = { ...locate(track.cx + ux * midU - uz * midV, track.cz + uz * midU + ux * midV), ux, uz, halfLength: (u1 - u0) / 2, goalHalfWidth: 3.66, goalHeight: 2.44 };
  const portals = [-5, 5].map(offset => locate(spawn.x + inward.x * 9 - inward.z * offset, spawn.z + inward.z * 9 + inward.x * offset));
  return { spawn, inward, defense, portals, field };
}

export function separatedSpawn(landmarks, occupied, isFree = () => true) {
  const { spawn, inward } = landmarks;
  for (let row = 0; row < 16; row++) for (const col of [0, -1, 1, -2, 2, -3, 3]) {
    const x = spawn.x + inward.x * row * 2 - inward.z * col * 2;
    const z = spawn.z + inward.z * row * 2 + inward.x * col * 2;
    if (isFree(x, z) && occupied.every(p => Math.hypot(x - p.x, z - p.z) >= 1.4)) return { x, y: spawn.y, z };
  }
  throw new Error('Não há espaço livre próximo à portaria.');
}

export function interpolatePose(a, b, t) {
  if (!a) return { ...b };
  // Death/respawn should never sweep an avatar across the whole campus.
  if (a.dead !== b.dead || Math.hypot(a.x - b.x, a.z - b.z) > 8) return { ...b };
  return { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, yaw: angleLerp(a.yaw, b.yaw, t) };
}
