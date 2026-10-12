import { World } from 'miniplex';
import { Vehicle, SeekBehavior, SeparationBehavior, Vector3 } from 'yuka';
import { combatRules, DIFFICULTIES, damageForHit } from './config.js';
import { traceHitboxes, updateHumanoidHitboxes, boxEntry } from './hitboxes.js';
import { createFlowField } from './flow-field.js';

export const COMBAT_STEP = 1 / 60;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (entity, height = 1.15) => ({ x: entity.position.x, y: entity.position.y + height * (entity.crouched ? .68 : 1), z: entity.position.z });
const aimPoint = (entity, head = false) => {
  const box = entity.hitboxes.find(b => b.region === (head ? 'head' : 'thorax'));
  return box ? { x: (box.a.x + box.b.x) / 2, y: (box.a.y + box.b.y) / 2, z: (box.a.z + box.b.z) / 2 } : point(entity);
};

/** The single local authority. Rendering does not own health, kills, targeting,
 * movement, attack timing or respawn. No DOM, camera or renderer is required. */
export function createCombatSimulation({ bounds, rules: overrides, random = Math.random, onEvent = () => {}, traceScenery = () => null, navigationOptions } = {}) {
  const world = new World(), actors = world.with('health', 'position', 'hitboxes'), agents = world.with('ai', 'steering').without('dead');
  const navigation = createFlowField({ bounds, ...navigationOptions });
  let rules = combatRules(overrides), serial = 0, time = 0, accumulator = 0, disposed = false;
  let obstacles = [], player = null, objective = null, zombieGoal = 'players', goalPoint = null, pausedAI = false;
  const events = (type, data = {}) => onEvent({ type, time, ...data });

  function spawn({ kind = 'human', role = 'enemy', team, position, difficulty = 'normal', id, stationary = false } = {}) {
    if (!['human', 'zombie', 'player', 'objective'].includes(kind)) throw new RangeError('Personagem inválido');
    if (!DIFFICULTIES[difficulty]) throw new RangeError('Dificuldade inválida');
    if (kind !== 'player' && kind !== 'objective' && [...actors].filter(e => e.kind !== 'player' && e.kind !== 'objective').length >= rules.maxActors) return null;
    const spec = rules[kind === 'player' ? 'human' : kind];
    const entity = world.add({
      id: id || `actor-${++serial}`, kind, role, team: team || (kind === 'player' || role === 'ally' ? 'squad' : kind === 'zombie' ? 'undead' : 'hostile'),
      position: { x: position?.x || 0, y: position?.y || 0, z: position?.z || 0 }, yaw: 0,
      velocity: { x: 0, y: 0, z: 0 }, radius: kind === 'objective' ? .65 : .35,
      health: { current: spec.health, max: spec.health, lastHitAt: -Infinity },
      hitboxes: [], stats: { kills: 0, deaths: 0, headshots: 0, damage: 0 },
      action: 'idle', actionSerial: 0, protectedUntil: 0,
    });
    if (kind === 'objective') {
      objective = entity;
      entity.hitboxes = [{ region: 'thorax', a: point(entity, .4), b: point(entity, 1), radius: .65 }];
    } else updateHumanoidHitboxes(entity);
    if (kind === 'player') player = entity;
    if (kind === 'human' || kind === 'zombie') {
      const vehicle = new Vehicle(); vehicle.position.copy(entity.position); vehicle.maxForce = 18; vehicle.updateOrientation = false;
      const seek = new SeekBehavior(new Vector3()), separation = new SeparationBehavior(); separation.weight = 1.8;
      vehicle.steering.add(seek); vehicle.steering.add(separation);
      world.addComponent(entity, 'ai', { difficulty, stationary, rounds: rules.human.magazineSize, reloadUntil: 0, target: null, lastKnown: null, lastSeenAt: -Infinity, acquiredAt: time, nextThinkAt: 0, sees: false, nextAttackAt: 0, pending: null });
      world.addComponent(entity, 'steering', { vehicle, seek });
    }
    events('spawn', { entity }); return entity;
  }
  function remove(entity) { if (!world.has(entity)) return; world.remove(entity); events('remove', { entity }); }
  function configure(next) { rules = combatRules({ ...rules, ...next }); return rules; }
  function canDamage(source, victim) {
    return !!victim && !victim.dead && victim.health.current > 0 && time >= victim.protectedUntil
      && (victim !== player || rules.playerDamage !== false)
      && (!source || (source !== victim && (rules.friendlyFire || source.team !== victim.team)));
  }
  function damage(victim, { source = null, region = 'thorax', weapon = {} } = {}) {
    if (disposed || !world.has(victim) || !canDamage(source, victim)) return null;
    const amount = Math.min(victim.health.current, damageForHit(rules, victim, region, weapon));
    if (!(amount > 0 && Number.isFinite(amount))) return null;
    victim.health.current = Math.max(0, victim.health.current - amount); victim.health.lastHitAt = time;
    if (source) source.stats.damage += amount;
    events('damage', { source, victim, region, damage: amount, weapon, remaining: victim.health.current });
    if (victim.health.current <= 1e-8) {
      victim.health.current = 0; victim.velocity = { x: 0, y: 0, z: 0 }; victim.action = 'death'; victim.actionSerial++;
      if (victim.steering) victim.steering.vehicle.velocity.set(0, 0, 0);
      const direction = source ? new Vector3(victim.position.x - source.position.x, 0, victim.position.z - source.position.z).normalize() : new Vector3(0, 0, -1);
      world.addComponent(victim, 'dead', { at: time, impulse: { x: direction.x * 1.6, y: .5, z: direction.z * 1.6 } }); victim.stats.deaths++;
      if (source && victim.kind !== 'objective') { source.stats.kills++; if (region === 'head' && weapon.kind === 'firearm') source.stats.headshots++; }
      events('death', { source, victim, region, weapon });
    }
    return { damage: amount, killed: !!victim.dead, remaining: victim.health.current };
  }
  function sceneryHit(from, to) {
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    let nearest = traceScenery(from, to);
    for (const box of obstacles) {
      const t = boxEntry(from, to, box);
      if (Number.isFinite(t) && (!nearest || t * length < nearest.distance)) nearest = { distance: t * length };
    }
    return nearest;
  }
  function trace(from, to, { source = null } = {}) {
    const hit = traceHitboxes(from, to, actors, { exclude: source }), wall = sceneryHit(from, to);
    return hit && (!wall || hit.distance < wall.distance) ? hit : null;
  }
  const visible = (a, b) => !sceneryHit(a.muzzle || point(a, 1.45), aimPoint(b));
  function selectTarget(entity) {
    const ai = entity.ai, difficulty = DIFFICULTIES[ai.difficulty];
    if (entity.kind === 'zombie' && zombieGoal === 'objective') return objective && !objective.dead ? objective : null;
    if (entity.kind === 'zombie' && zombieGoal === 'point') return null;
    let closest = null, best = Infinity;
    for (const other of actors) {
      if (other === entity || other.dead || other.kind === 'objective' || other.team === entity.team) continue;
      const d = distance(entity.position, other.position);
      if (entity.kind !== 'zombie' && (d > difficulty.vision || !visible(entity, other))) continue;
      if (d < best) { best = d; closest = other; }
    }
    // A bot may pursue its last observation briefly, without shooting through cover.
    if (!closest && ai.target && !ai.target.dead && time - ai.lastSeenAt < 4) return ai.target;
    return closest;
  }
  function attack(entity, target) {
    const ai = entity.ai, d = DIFFICULTIES[ai.difficulty], melee = entity.kind === 'zombie' || distance(entity.position, target.position) < 1.55;
    if (melee) {
      ai.pending = { target, at: time + .32 };
      ai.nextAttackAt = time + (entity.kind === 'zombie' ? rules.zombie.interval : .7);
      entity.action = 'melee'; entity.actionSerial++; events('attack', { entity, target, kind: 'melee' });
      return;
    }
    if (ai.rounds === 0) {
      ai.reloadUntil = time + rules.human.reloadDuration; ai.nextAttackAt = ai.reloadUntil;
      entity.action = 'reload'; events('reload', { entity, duration: rules.human.reloadDuration }); return;
    }
    ai.rounds--; ai.nextAttackAt = time + d.interval; entity.action = 'shoot'; entity.actionSerial++;
    const from = { ...(entity.muzzle || point(entity, 1.4)) }, aim = aimPoint(target, random() < d.headChance);
    const direction = new Vector3(aim.x - from.x, aim.y - from.y, aim.z - from.z).normalize();
    const right = new Vector3(direction.z, 0, -direction.x).normalize(), up = new Vector3().crossVectors(direction, right).normalize();
    const angle = random() * Math.PI * 2, spread = Math.sqrt(random()) * d.spread;
    direction.add(right.multiplyScalar(Math.cos(angle) * spread)).add(up.multiplyScalar(Math.sin(angle) * spread)).normalize();
    const to = { x: from.x + direction.x * d.vision, y: from.y + direction.y * d.vision, z: from.z + direction.z * d.vision };
    const wall = sceneryHit(from, to), hit = traceHitboxes(from, to, actors, { exclude: entity });
    const accepted = hit && (!wall || hit.distance < wall.distance) ? hit : null;
    const end = accepted?.point || (wall ? { x: from.x + direction.x * wall.distance, y: from.y + direction.y * wall.distance, z: from.z + direction.z * wall.distance } : to);
    events('shot', { entity, from, to: end, hit: accepted || (wall ? { ...wall, point: end } : null) });
    if (accepted) damage(accepted.entity, { source: entity, region: accepted.region, weapon: { id: 'automatic', kind: 'firearm', damage: 33, pellets: 1 } });
  }
  function move(entity, target, dt, stopDistance) {
    const { vehicle, seek } = entity.steering, previous = { ...entity.position };
    const waypoint = target && distance(previous, target) > stopDistance ? navigation.waypoint(previous, target) : null;
    if (!waypoint) { vehicle.velocity.set(0, 0, 0); entity.velocity = { x: 0, y: 0, z: 0 }; return; }
    vehicle.position.copy(previous); seek.target.set(waypoint.x, previous.y, waypoint.z);
    vehicle.maxSpeed = entity.kind === 'zombie' ? rules.zombie.speed : DIFFICULTIES[entity.ai.difficulty].speed;
    vehicle.neighbors.length = 0;
    for (const other of agents) if (other !== entity && distance(previous, other.position) < 1.5) vehicle.neighbors.push(other.steering.vehicle);
    vehicle.update(dt); vehicle.position.y = previous.y;
    const p = vehicle.position;
    p.x = Math.max(bounds.x0 + .4, Math.min(bounds.x1 - .4, p.x)); p.z = Math.max(bounds.z0 + .4, Math.min(bounds.z1 - .4, p.z));
    if (!navigation.segmentClear(previous, p)) {
      const slideX = { x: p.x, y: p.y, z: previous.z }, slideZ = { x: previous.x, y: p.y, z: p.z };
      if (navigation.segmentClear(previous, slideX)) p.z = previous.z;
      else if (navigation.segmentClear(previous, slideZ)) p.x = previous.x;
      else p.copy(previous);
      vehicle.velocity.set(0, 0, 0);
    }
    entity.position = { x: p.x, y: p.y, z: p.z };
    if (entity.muzzle) { entity.muzzle.x += p.x - previous.x; entity.muzzle.z += p.z - previous.z; }
    entity.velocity = { x: (p.x - previous.x) / dt, y: 0, z: (p.z - previous.z) / dt };
    if (Math.hypot(entity.velocity.x, entity.velocity.z) > .1) entity.yaw = Math.atan2(-entity.velocity.x, -entity.velocity.z);
    if (!entity.poseDriven) updateHumanoidHitboxes(entity);
    else for (const box of entity.hitboxes) for (const end of [box.a, box.b]) { end.x += p.x - previous.x; end.z += p.z - previous.z; }
  }
  function tick(dt) {
    time += dt;
    for (const entity of [...actors]) {
      if (!entity.dead) continue;
      if (entity === player) continue; // The adapter owns placing the live controller on respawn.
      if (entity !== objective && time - entity.dead.at >= rules.corpseSeconds) remove(entity);
    }
    if (pausedAI) return;
    for (const entity of agents) {
      const ai = entity.ai;
      if (ai.stationary) continue;
      if (ai.reloadUntil) {
        if (time < ai.reloadUntil) { entity.action = 'reload'; continue; }
        ai.reloadUntil = 0; ai.rounds = rules.human.magazineSize;
      }
      if (ai.pending) {
        if (time < ai.pending.at) continue;
        const target = ai.pending.target; ai.pending = null;
        if (!target.dead && distance(entity.position, target.position) < 1.8 && visible(entity, target)) {
          damage(target, { source: entity, region: 'thorax', weapon: { kind: 'melee', damage: entity.kind === 'zombie' ? rules.zombie.damage : 15 } });
        }
      }
      if (time >= ai.nextThinkAt || ai.target?.dead) {
        const next = selectTarget(entity);
        if (next !== ai.target) { ai.target = next; ai.acquiredAt = time; }
        ai.sees = !!next && (entity.kind === 'zombie' || visible(entity, next));
        if (next && ai.sees) { ai.lastKnown = { ...next.position }; ai.lastSeenAt = time; }
        ai.nextThinkAt = time + .15;
      }
      const target = ai.target, sees = ai.sees;
      let destination = target ? ai.lastKnown : null, stopDistance = entity.kind === 'zombie' ? 1.05 : 7;
      if (!target && entity.kind === 'zombie' && zombieGoal === 'point') { destination = goalPoint; stopDistance = .65; }
      if (!target && entity.role === 'ally' && player && !player.dead) {
        destination = { x: player.position.x - 2.2, y: player.position.y, z: player.position.z + 1.6 }; stopDistance = 1.5;
      }
      if (target && !sees) stopDistance = .7;
      entity.action = 'idle';
      move(entity, destination, dt, stopDistance);
      if (Math.hypot(entity.velocity.x, entity.velocity.z) > .1) entity.action = 'walk';
      if (!target || !sees) continue;
      entity.yaw = Math.atan2(entity.position.x - target.position.x, entity.position.z - target.position.z);
      const range = entity.kind === 'zombie' ? 1.6 : DIFFICULTIES[ai.difficulty].vision;
      if (distance(entity.position, target.position) <= range && time >= ai.nextAttackAt && time - ai.acquiredAt >= DIFFICULTIES[ai.difficulty].reaction && visible(entity, target)) attack(entity, target);
    }
  }
  function update(dt) {
    if (disposed) return;
    accumulator += Math.min(.1, Math.max(0, dt));
    while (accumulator + 1e-10 >= COMBAT_STEP) { tick(COMBAT_STEP); accumulator -= COMBAT_STEP; }
  }
  function revive(entity, position = entity.position) {
    world.removeComponent(entity, 'dead'); entity.health.current = entity.health.max; entity.health.lastHitAt = -Infinity;
    entity.position = { ...position }; entity.protectedUntil = time + rules.spawnProtection; entity.action = 'idle';
    updateHumanoidHitboxes(entity); events('respawn', { entity });
  }
  return { world, actors, agents, navigation, spawn, remove, update, damage, trace, configure, revive,
    traceActors(from, to, { source = null } = {}) { return traceHitboxes(from, to, actors, { exclude: source }); },
    get rules() { return rules; }, get time() { return time; }, get player() { return player; }, get objective() { return objective; },
    get pausedAI() { return pausedAI; }, set pausedAI(value) {
      pausedAI = !!value;
      if (pausedAI) for (const e of agents) { e.ai.pending = null; e.velocity = { x: 0, y: 0, z: 0 }; e.steering.vehicle.velocity.set(0, 0, 0); e.action = 'idle'; }
    },
    get zombieGoal() { return zombieGoal; },
    setZombieGoal(goal, target = goalPoint) {
      if (!['players', 'objective', 'point'].includes(goal)) throw new RangeError('Objetivo inválido');
      zombieGoal = goal; goalPoint = target;
      for (const e of agents) if (e.kind === 'zombie') { e.ai.target = null; e.ai.lastKnown = null; e.ai.pending = null; e.ai.nextThinkAt = 0; }
    },
    setObstacles(next) { obstacles = next; navigation.setObstacles(next); },
    clear() { for (const entity of [...actors]) if (entity !== player && entity !== objective) remove(entity); accumulator = 0; },
    dispose() { if (disposed) return; for (const entity of [...actors]) remove(entity); disposed = true; },
  };
}
