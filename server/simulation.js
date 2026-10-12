import { createCombatSimulation } from '../src/gameplay/combat/simulation.js';
import { updateHumanoidHitboxes } from '../src/gameplay/combat/hitboxes.js';
import { WEAPON_BY_ID } from '../src/gameplay/paintball/weapons.js';
import { createAmmoStore } from '../src/gameplay/paintball/ammo.js';
import { EMOTES, finitePoint, separatedSpawn, cleanName } from '../src/shared/multiplayer.js';
import { ammoPosition, AMMO_RESPAWN_SECONDS } from '../src/shared/props.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Node owns health, accepted poses, projectile collisions, Rapier and games.
 * As in DTC, browsers predict their poses; the server bounds speed and sweeps
 * every accepted move against the surveyed building/wall geometry. */
export function createRoomSimulation(world, { onEvent = () => {}, random = Math.random } = {}) {
  const players = new Map(), physics = world.createCrates(), projectiles = [];
  const defense = { status: 'idle', wave: 0, totalWaves: 5, remaining: 0, nextWaveAt: 0 };
  const football = { status: 'idle', score: [0, 0], target: 5, resetAt: 0, lastScorer: null };
  const ammoLoot = { position: ammoPosition(world.landmarks.field), availableAt: 0 };
  let serial = 0, disposed = false, phase = 'waiting';
  function tryStart() {
    if (phase !== 'waiting' || !players.size || ![...players.values()].every(p => p.ready && p.connected)) return;
    phase = 'running'; for (const p of players.values()) p.entity.protectedUntil = sim.time + 2;
    emit('matchStart', { message: 'Todos prontos. A treta começou!' });
  }
  const emit = (type, data = {}) => onEvent({ type, time: sim.time, ...data });
  const sim = createCombatSimulation({ bounds: world.bounds, navigationOptions: { cellSize: 1.25, maxFields: 4, guardGrid: true,
    isBlocked: (x, z, r) => !world.free(x, z, r),
    isSegmentClear: (a, b, r) => world.segmentClear({ ...a, y: world.terrain.heightAt(a.x, a.z) }, { ...b, y: world.terrain.heightAt(b.x, b.z) }, r),
  },
    rules: { friendlyFire: true, damageMode: 'weapon', maxActors: 40, corpseSeconds: 4, zombie: { health: 160, speed: 5, damage: 20 }, objective: { health: 1200 } },
    random, traceScenery: world.trace,
    onEvent(event) {
      if (event.type === 'damage') emit('damage', { victim: event.victim.id, source: event.source?.id, region: event.region, damage: event.damage, remaining: event.remaining });
      if (event.type === 'death') emit('death', { victim: event.victim.id, source: event.source?.id, impulse: event.victim.dead.impulse });
    },
  });
  sim.navigation.setObstacles(world.obstacles);
  const objective = sim.spawn({ kind: 'objective', id: 'prata', position: world.landmarks.defense });
  sim.setZombieGoal('objective');
  const spawnFor = () => {
    const p = separatedSpawn(world.landmarks, [...players.values()].map(p => p.entity.position), world.free);
    p.y = world.terrain.heightAt(p.x, p.z); return p;
  };
  function addPlayer(id, character) {
    const entity = sim.spawn({ kind: 'player', id, position: spawnFor() });
    entity.protectedUntil = sim.time + 2;
    const player = { entity, ready: phase === 'running', character: { name: cleanName(character?.name, 'Bancário', 24), appearance: character?.appearance || {} }, seq: 0,
      connected: true, ammunition: createAmmoStore(), aiming: false, budget: .7, nextAttackAt: 0, nextEmoteAt: 0, emote: null, life: 1, lastPoseAt: sim.time, weapon: 'pistol', holstered: false };
    players.set(id, player); return player;
  }
  function removePlayer(id) { const p = players.get(id); if (p) sim.remove(p.entity); players.delete(id); tryStart(); }
  function setPose(id, pose) {
    const p = players.get(id);
    if (!p || !p.connected || p.entity.dead || !finitePoint(pose) || !Number.isSafeInteger(pose.seq) || pose.seq <= p.seq || !Number.isFinite(pose.yaw)) return false;
    if (phase !== 'running') { p.seq = pose.seq; return false; }
    const e = p.entity, before = { ...e.position }, speed = pose.crouched ? 1.6 : pose.aiming ? 3.1 : 9.5;
    p.budget = Math.min(p.budget, speed * .25 + .2);
    const d = distance(before, pose), fraction = d > p.budget ? p.budget / d : 1;
    let next = { x: before.x + (pose.x - before.x) * fraction, y: pose.y, z: before.z + (pose.z - before.z) * fraction };
    const floor = world.groundAt?.(next.x, next.z, Math.max(before.y, world.terrain.heightAt(next.x, next.z)) + .7) ?? world.terrain.heightAt(next.x, next.z);
    // Jump clearance is measured above the walkable floor, including stands.
    next.y = Math.max(floor, Math.min(floor + 2.5, next.y));
    if (!world.segmentClear(before, next)) {
      const xOnly = { ...next, z: before.z }, zOnly = { ...next, x: before.x };
      next = world.segmentClear(before, xOnly) ? xOnly : world.segmentClear(before, zOnly) ? zOnly : before;
    }
    p.budget = Math.max(0, p.budget - distance(before, next));
    const dt = Math.max(1 / 60, sim.time - p.lastPoseAt);
    e.position = next; e.yaw = Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw)); e.crouched = !!pose.crouched; p.aiming = !!pose.aiming;
    e.velocity = { x: (next.x - before.x) / dt, y: (next.y - before.y) / dt, z: (next.z - before.z) / dt };
    e.action = distance(before, next) > .001 ? 'walk' : 'idle'; updateHumanoidHitboxes(e, e.crouched);
    p.seq = pose.seq; p.lastPoseAt = sim.time;
    if (typeof pose.weapon === 'string' && Object.hasOwn(WEAPON_BY_ID, pose.weapon)) {
      if (p.weapon !== pose.weapon) p.ammunition.cancel();
      p.weapon = pose.weapon;
    }
    p.holstered = !!pose.holstered;
    if (p.holstered) p.ammunition.cancel();
    // The server applies contact pushes; the client's Rapier world is only a view.
    for (const crate of physics.crates) {
      const at = crate.body.translation(), delta = distance(next, at);
      if (delta < crate.half + .5 && Math.abs(next.y + .6 - at.y) < 1.5 && distance(before, next) > .001) {
        const amount = .3, dx = at.x - next.x, dz = at.z - next.z, l = Math.hypot(dx, dz) || 1;
        crate.body.applyImpulse({ x: dx / l * amount, y: 0, z: dz / l * amount }, true); crate.lastTouch = id;
      }
    }
    return true;
  }
  function firstHit(a, b, source) {
    const actor = sim.traceActors(a, b, { source }), wall = world.trace(a, b), crate = physics.trace(a, b);
    return [actor, wall, crate].filter(Boolean).sort((x, y) => x.distance - y.distance)[0] || null;
  }
  function impact(hit, source, weapon, direction, paintColor = '#d91e44') {
    const surface = hit.entity ? 'flesh' : hit.crate?.type || (Math.abs(hit.normal?.y || 0) > .7 ? 'dirt' : 'concrete');
    emit('impact', { point: hit.point, surface, kind: weapon.kind });
    if (hit.entity) {
      if (weapon.kind === 'firearm') emit('paintHit', { victim: hit.entity.id, point: hit.point, normal: hit.normal, paintColor });
      sim.damage(hit.entity, { source, region: hit.region, weapon });
    }
    if (hit.crate) {
      const c = hit.crate, power = weapon.impulse * (weapon.kind === 'firearm' ? 4 : 4.5);
      c.body.applyImpulseAtPoint({ x: direction.x * power, y: direction.y * power + (weapon.kind === 'firearm' ? 0 : power * .13), z: direction.z * power }, hit.point, true);
      c.lastTouch = source.id;
    }
  }
  function attack(p, action) {
    const weapon = typeof action.weapon === 'string' && Object.hasOwn(WEAPON_BY_ID, action.weapon) ? WEAPON_BY_ID[action.weapon] : null, e = p.entity;
    if (!weapon || p.holstered || e.dead || sim.time + .015 < p.nextAttackAt || !finitePoint(action.origin) || !finitePoint(action.direction)) return false;
    const expected = { x: e.position.x, y: e.position.y + (e.crouched ? 1.1 : 1.7), z: e.position.z };
    if (Math.hypot(action.origin.x - expected.x, action.origin.y - expected.y, action.origin.z - expected.z) > 1.8) return false;
    const len = Math.hypot(action.direction.x, action.direction.y, action.direction.z);
    if (len < .9 || len > 1.1) return false;
    const direction = { x: action.direction.x / len, y: action.direction.y / len, z: action.direction.z / len };
    if (p.weapon !== weapon.id) p.ammunition.cancel();
    if (weapon.kind === 'firearm' && !p.ammunition.consume(weapon.id)) return false;
    p.nextAttackAt = sim.time + weapon.interval; p.weapon = weapon.id;
    // Never let a third-person muzzle beyond a wall shoot through that wall.
    const obstruction = world.trace(expected, action.origin), origin = obstruction ? expected : { ...action.origin };
    if (weapon.kind !== 'firearm') {
      const to = { x: origin.x + direction.x * weapon.range, y: origin.y + direction.y * weapon.range, z: origin.z + direction.z * weapon.range };
      let hit = null;
      for (const offset of [0, -.13, .13]) {
        const end = { ...to, x: to.x + direction.z * offset, z: to.z - direction.x * offset }, next = firstHit(origin, end, e);
        if (next && (!hit || next.distance < hit.distance)) hit = next;
      }
      if (hit) impact(hit, e, weapon, direction);
      emit('attack', { player: e.id, weapon: weapon.id }); return true;
    }
    const rightLen = Math.hypot(direction.x, direction.z) || 1;
    const right = { x: -direction.z / rightLen, y: 0, z: direction.x / rightLen };
    const up = { x: right.z * direction.y, y: right.x * direction.z - right.z * direction.x, z: -right.x * direction.y };
    const bullets = [];
    for (let i = 0; i < weapon.pellets; i++) {
      const a = random() * Math.PI * 2, r = i === 0 && weapon.pellets > 1 ? 0 : Math.sqrt(random()) * (action.aiming ? weapon.spread : weapon.hipSpread || weapon.spread);
      const d = { x: direction.x + right.x * Math.cos(a) * r + up.x * Math.sin(a) * r, y: direction.y + up.y * Math.sin(a) * r, z: direction.z + right.z * Math.cos(a) * r + up.z * Math.sin(a) * r };
      const l = Math.hypot(d.x, d.y, d.z); for (const key of ['x', 'y', 'z']) d[key] /= l;
      const bullet = { id: ++serial, source: e, weapon, position: { ...origin }, direction: d, traveled: 0, paintColor: /^#[0-9a-f]{6}$/i.test(action.paintColor || '') ? action.paintColor : '#d91e44' };
      if (projectiles.length < 256) projectiles.push(bullet);
      bullets.push({ id: bullet.id, direction: d });
    }
    emit('shot', { player: e.id, weapon: weapon.id, origin, speed: weapon.speed, bullets }); return true;
  }
  function startDefense() {
    for (const e of [...sim.actors]) if (e.kind === 'zombie') sim.remove(e);
    sim.revive(objective, world.landmarks.defense);
    Object.assign(defense, { status: 'running', wave: 0, remaining: 0, nextWaveAt: sim.time });
    emit('minigame', { message: 'Defendam o Prata! Os portais abriram na Bussocaba.' });
  }
  function handleAction(id, action) {
    const p = players.get(id);
    if (!p || !p.connected || !action || p.entity.dead) return false;
    if (action.type === 'ready' && phase === 'waiting' && typeof action.ready === 'boolean') { p.ready = action.ready; tryStart(); return true; }
    if (phase !== 'running' && action.type !== 'emote') return false;
    if (action.type === 'pickupAmmo') {
      const at = p.entity.position, y = world.terrain.heightAt(ammoLoot.position.x, ammoLoot.position.z);
      if (sim.time < ammoLoot.availableAt || distance(at, ammoLoot.position) > 1.8 || Math.abs(at.y - y) > 1.8) return false;
      if (world.trace({ ...at, y: at.y + .8 }, { ...ammoLoot.position, y: y + .3 })) return false;
      const gained = p.ammunition.refill(); if (!gained) return false;
      ammoLoot.availableAt = sim.time + AMMO_RESPAWN_SECONDS;
      emit('ammoPickup', { player: id, availableAt: ammoLoot.availableAt, gained }); return true;
    }
    if (action.type === 'attack') return attack(p, action);
    if (action.type === 'cancelReload') { p.ammunition.cancel(); emit('reload', { player: id, weapon: p.weapon, active: false }); return true; }
    if (action.type === 'reload') {
      if (p.holstered || action.weapon !== p.weapon || !p.ammunition.reload(p.weapon)) return false;
      emit('reload', { player: id, weapon: p.weapon, active: true, duration: p.ammunition.state(p.weapon).remaining }); return true;
    }
    if (action.type === 'emote' && Object.hasOwn(EMOTES, action.emote) && sim.time >= p.nextEmoteAt) {
      p.emote = { id: action.emote, until: sim.time + (action.emote === 'dance' ? 5 : 2.5) }; p.nextEmoteAt = sim.time + 1;
      emit('emote', { player: id, emote: action.emote, position: { ...p.entity.position } }); return true;
    }
    if (action.type === 'interact' && action.game === 'defense' && distance(p.entity.position, world.landmarks.defense) <= 5 && defense.status !== 'running') { startDefense(); return true; }
    if (action.type === 'interact' && action.game === 'football' && distance(p.entity.position, world.landmarks.field) <= 6 && football.status !== 'running') {
      Object.assign(football, { status: 'running', score: [0, 0], resetAt: 0, lastScorer: null }); physics.reset(physics.crates[0]);
      emit('minigame', { message: 'Futebol de caixa! Empurre ou golpeie a madeira até um dos gols. Vence o lado que chegar a 5.' }); return true;
    }
    return false;
  }
  function step(dt = 1 / 60) {
    if (disposed) return;
    for (const p of players.values()) {
      if (p.entity.dead) p.ammunition.cancel(); else p.ammunition.update(dt);
      p.budget = Math.min(2.6, p.budget + dt * (p.entity.crouched ? 1.6 : p.aiming ? 3.1 : 9.5));
      if (sim.time - p.lastPoseAt > .2) { p.entity.velocity = { x: 0, y: 0, z: 0 }; p.entity.action = 'idle'; }
      if (p.entity.dead && sim.time - p.entity.dead.at >= 3) { sim.revive(p.entity, spawnFor()); p.ammunition.reset(); p.life++; p.seq = p.seq || 0; p.budget = .7; emit('respawn', { player: p.entity.id }); }
      if (p.emote && p.emote.until <= sim.time) p.emote = null;
    }
    sim.update(dt);
    for (const e of sim.agents) { e.position.y = world.terrain.heightAt(e.position.x, e.position.z); updateHumanoidHitboxes(e); }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const b = projectiles[i], next = { x: b.position.x + b.direction.x * b.weapon.speed * dt, y: b.position.y + b.direction.y * b.weapon.speed * dt, z: b.position.z + b.direction.z * b.weapon.speed * dt };
      const hit = firstHit(b.position, next, b.source); b.traveled += b.weapon.speed * dt;
      if (hit) { impact(hit, b.source, b.weapon, b.direction, b.paintColor); emit('bulletEnd', { bullet: b.id }); }
      if (hit || b.traveled >= b.weapon.range) projectiles.splice(i, 1); else b.position = next;
    }
    const wood = physics.crates[0], before = { ...wood.body.translation() };
    physics.step();
    for (const c of physics.crates) { const p = c.body.translation(); if (p.y < c.spawn.y - 40 || distance(p, c.spawn) > 120) physics.reset(c); }
    if (defense.status === 'running') {
      const alive = [...sim.actors].filter(e => e.kind === 'zombie' && !e.dead);
      defense.remaining = alive.length;
      if (objective.dead) { defense.status = 'lost'; emit('minigame', { message: 'O Prata caiu! Volte à entrada para tentar novamente.' }); }
      else if (!alive.length && !defense.nextWaveAt && defense.wave > 0) {
        if (defense.wave >= defense.totalWaves) { defense.status = 'won'; emit('minigame', { message: 'Vitória! Vocês defenderam o Prata por 5 waves.' }); }
        else { defense.nextWaveAt = sim.time + 5; emit('minigame', { message: `Wave ${defense.wave} vencida! Próxima em 5 segundos.` }); }
      }
      if (defense.status === 'running' && defense.nextWaveAt <= sim.time && (defense.nextWaveAt > 0 || defense.wave === 0)) {
        defense.wave++; defense.nextWaveAt = 0;
        const count = Math.min(32, 4 + defense.wave * 2 + players.size);
        for (let i = 0; i < count; i++) {
          const base = world.landmarks.portals[i % world.landmarks.portals.length];
          const at = sim.navigation.nearestFree({ x: base.x + Math.floor(i / 2) % 4 * 1.2, z: base.z + Math.floor(i / 8) * 1.2 });
          if (at) { at.y = world.terrain.heightAt(at.x, at.z); sim.spawn({ kind: 'zombie', position: at }); }
        }
        defense.remaining = [...sim.agents].filter(e => e.kind === 'zombie').length;
        emit('minigame', { message: `Wave ${defense.wave}/${defense.totalWaves}: ${defense.remaining} zumbis saindo dos portais!` });
      }
    }
    if (football.status === 'running') {
      const f = world.landmarks.field, at = wood.body.translation();
      const u = p => (p.x - f.x) * f.ux + (p.z - f.z) * f.uz;
      const v = p => -(p.x - f.x) * f.uz + (p.z - f.z) * f.ux;
      if (football.resetAt && sim.time >= football.resetAt) { physics.reset(wood); football.resetAt = 0; }
      else if (!football.resetAt) for (const side of [-1, 1]) {
        const plane = f.halfLength + wood.half;
        if (u(before) * side < plane && u(at) * side >= plane && Math.abs(v(at)) + wood.half < f.goalHalfWidth && at.y - f.y + wood.half < f.goalHeight) {
          const index = side < 0 ? 0 : 1; football.score[index]++; football.lastScorer = wood.lastTouch; football.resetAt = sim.time + 2;
          emit('goal', { score: [...football.score], player: wood.lastTouch, side: index, message: `GOL! ${football.score[0]} × ${football.score[1]}` });
          if (football.score[index] >= football.target) { football.status = 'finished'; emit('minigame', { message: `Fim de jogo! ${football.score[0]} × ${football.score[1]}. Inicie outra partida no centro do campo.` }); }
          break;
        }
      }
    }
  }
  const pack = e => ({ id: e.id, kind: e.kind, x: e.position.x, y: e.position.y, z: e.position.z, yaw: e.yaw, vx: e.velocity.x, vz: e.velocity.z, crouched: !!e.crouched,
    health: e.health.current, maxHealth: e.health.max, dead: !!e.dead, deathImpulse: e.dead?.impulse, respawnIn: e.dead ? Math.max(0, 3 - (sim.time - e.dead.at)) : 0, protected: sim.time < e.protectedUntil,
    kills: e.stats.kills, assists: e.stats.assists, deaths: e.stats.deaths, action: e.action, actionSerial: e.actionSerial });
  return { players, sim, physics, defense, football, objective, projectiles, addPlayer, removePlayer, setPose, handleAction, step,
    snapshot: () => ({ phase, time: sim.time, ammoLoot: { ...ammoLoot }, players: [...players.values()].map(p => ({ ...pack(p.entity), ready: p.ready, seq: p.seq, life: p.life, connected: p.connected, weapon: p.weapon, ammo: p.ammunition.state(p.weapon), holstered: p.holstered, emote: p.emote })),
      zombies: [...sim.actors].filter(e => e.kind === 'zombie').map(pack), crates: physics.snapshot(), defense: { ...defense, health: objective.health.current, maxHealth: objective.health.max }, football: { ...football, score: [...football.score] } }),
    dispose() { if (disposed) return; disposed = true; sim.dispose(); physics.dispose(); },
  };
}
