import * as THREE from 'three';
import { createCombatSimulation } from './simulation.js';
import { updateHumanoidHitboxes } from './hitboxes.js';
import { loadCombatModels, createActorView } from './actors.js';
import { createTrainingLab } from './training-lab.js';
import { DIFFICULTIES } from './config.js';
import { footSurface } from '../../core/index.js';
export { DEFAULT_COMBAT_RULES, DIFFICULTIES } from './config.js';
export { createCombatSimulation, COMBAT_STEP } from './simulation.js';
export { traceHitboxes, updateHumanoidHitboxes } from './hitboxes.js';
export { createActorView } from './actors.js';

export async function createCombatModule(game, { base = '/', models, weaponModels } = {}) {
  models ||= await loadCombatModels(base);
  const root = new THREE.Group(); root.name = 'combat-actors'; root.userData.paintballIgnore = true; root.visible = false; game.engine.scene.add(root);
  const views = new Map(), spawn = game.training.spawn;
  const traceMaterials = [0xf3a888, 0x7ed7e8].map(color => new THREE.LineBasicMaterial({ color, transparent: true, opacity: .85, toneMapped: false }));
  const tracers = Array.from({ length: 32 }, () => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, traceMaterials[0]); line.frustumCulled = false; line.visible = false; root.add(line);
    return { line, until: 0 };
  });
  let traceIndex = 0;
  let showHitboxes = false, lastObstaclesAt = -Infinity, sequence = 0, disposed = false, wasTraining = false, simulation;
  function onEvent(event) {
    if (event.type === 'spawn' && ['human', 'zombie'].includes(event.entity.kind)) {
      views.set(event.entity, createActorView(event.entity, models[event.entity.kind], { parent: root, weaponModel: weaponModels?.automatic, ragdolls: game.ragdolls }));
    }
    if (event.type === 'remove') { views.get(event.entity)?.dispose(); views.delete(event.entity); }
    if (event.type === 'damage') {
      views.get(event.victim)?.react(event.region, event.time);
      if (event.weapon?.kind === 'melee' && event.source !== player) game.audio?.hit?.({ entity: event.victim, point: event.victim.position }, { kind: 'melee' });
    }
    if (event.type === 'death') {
      game.audio?.stopReload?.(`reload:${event.victim.id}`);
      if (event.victim.kind === 'player') { game.player.spawnCorpse?.(event.victim.dead.impulse); game.player.avatar?.stopEmote(); }
    }
    if (event.type === 'attack') game.audio?.melee?.({ id: 'fists' }, { position: event.entity.position });
    if (event.type === 'reload') { views.get(event.entity)?.reload?.(event.duration, event.time); game.audio?.reload?.({ id: 'automatic' }, { duration: event.duration, position: event.entity.position, tag: `reload:${event.entity.id}` }); }
    if (event.type === 'shot') {
      views.get(event.entity)?.shoot();
      const tracer = tracers[traceIndex++ % tracers.length], positions = tracer.line.geometry.attributes.position;
      positions.setXYZ(0, event.from.x, event.from.y, event.from.z); positions.setXYZ(1, event.to.x, event.to.y, event.to.z); positions.needsUpdate = true;
      tracer.line.material = traceMaterials[event.entity.role === 'ally' ? 1 : 0]; tracer.line.visible = true; tracer.until = event.time + .08;
      game.audio?.shot('automatic', { position: event.from });
      game.audio?.whiz?.(event.from, event.to);
      if (event.hit) game.audio?.hit?.(event.hit, { kind: 'firearm' });
    }
    game.events.emit(`combat${event.type}`, event);
  }
  simulation = createCombatSimulation({ bounds: game.training.bounds, onEvent });
  const player = simulation.spawn({ kind: 'player', id: 'player', position: game.player.feet });
  const objective = simulation.spawn({ kind: 'objective', id: 'objective', position: { x: spawn.x, y: 0, z: spawn.z - 28 }, team: 'squad' });
  const objectiveGeometry = new THREE.CylinderGeometry(.55, .7, 1.4, 6), objectiveMaterial = new THREE.MeshStandardMaterial({ color: 0x55bbc9, emissive: 0x277d99, emissiveIntensity: .4 });
  const beacon = new THREE.Mesh(objectiveGeometry, objectiveMaterial); beacon.position.copy(objective.position).y += .7; beacon.castShadow = true; root.add(beacon);
  const pointGeometry = new THREE.TorusGeometry(.7, .045, 6, 32), pointMaterial = new THREE.MeshBasicMaterial({ color: 0xf6c86b, toneMapped: false });
  const pointMarker = new THREE.Mesh(pointGeometry, pointMaterial); pointMarker.rotation.x = -Math.PI / 2; pointMarker.position.set(spawn.x + 10, .05, spawn.z - 28); root.add(pointMarker);
  simulation.setZombieGoal('players', pointMarker.position);
  function syncObstacles() {
    const crates = game.dynamicProps?.crates.filter(c => c.mode === 'training' && c.mesh.visible && c.bounds.max.y > .25 && c.bounds.min.y < 1.8).map(c => ({ min: { x: c.bounds.min.x, y: c.bounds.min.y, z: c.bounds.min.z }, max: { x: c.bounds.max.x, y: c.bounds.max.y, z: c.bounds.max.z } })) || [];
    simulation.setObstacles([...game.training.obstacles, ...crates]);
  }
  function add(kind, role = 'enemy', difficulty = api.trainingLab?.difficulty || 'normal', at, stationary = false) {
    if (!game.training.active || disposed) return null;
    syncObstacles();
    const center = at || { x: spawn.x + (role === 'ally' ? -4 : kind === 'human' ? 5 : -8), y: 0, z: spawn.z + (role === 'ally' ? -2 : kind === 'human' ? -12 : -25) };
    let position = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = (sequence + attempt) * 2.39996, radius = attempt ? .9 + Math.sqrt(attempt) * .8 : 0;
      const candidate = simulation.navigation.nearestFree({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
      if (candidate && [...simulation.actors].every(e => e.dead || Math.hypot(e.position.x - candidate.x, e.position.z - candidate.z) > e.radius + .5)) { position = candidate; break; }
    }
    if (!position) { game.toast('Sem espaço para outro personagem aqui'); return null; }
    sequence++;
    const entity = simulation.spawn({ kind, role, difficulty: kind === 'zombie' ? 'normal' : difficulty, position, stationary });
    if (entity && stationary) entity.yaw = Math.PI;
    if (!entity) game.toast(`Limite de ${simulation.rules.maxActors} personagens no treino`);
    return entity;
  }
  function horde(count = 8) { for (let i = 0; i < count; i++) if (!add('zombie')) break; }
  function reset() {
    simulation.clear(); simulation.revive(player, game.player.feet); simulation.revive(objective, objective.position);
    player.stats = { kills: 0, deaths: 0, headshots: 0, damage: 0 }; sequence = 0; simulation.pausedAI = false;
    game.paintball?.clearEffects(); game.events.emit('combatreset');
    for (const tracer of tracers) tracer.line.visible = false;
  }
  function targets() {
    add('human', 'enemy', 'normal', { x: spawn.x - 4, z: spawn.z - 12 }, true);
    add('zombie', 'enemy', 'normal', { x: spawn.x + 7, z: spawn.z - 11 }, true);
  }
  function scenario(name, difficulty) {
    reset(); game.player.placeAt(spawn.x, spawn.z, spawn.yaw);
    simulation.revive(player, game.player.feet);
    if (name === 'defend') {
      simulation.setZombieGoal('objective');
      add('human', 'ally', difficulty, { x: spawn.x - 3, z: spawn.z - 23 });
      add('human', 'ally', difficulty, { x: spawn.x + 3, z: spawn.z - 23 });
      for (let i = 0; i < 8; i++) add('zombie', 'enemy', difficulty, { x: spawn.x - 9 + i * 2.5, z: spawn.z - 40 });
    } else { simulation.setZombieGoal('players'); add('human', 'enemy', difficulty, { x: spawn.x + 5, z: spawn.z - 12 }); }
    api.trainingLab.refresh();
  }
  function markPoint(position) {
    if (!game.training.active) return false;
    const target = simulation.navigation.nearestFree(position); if (!target) return false;
    pointMarker.position.set(target.x, .05, target.z); simulation.setZombieGoal(simulation.zombieGoal, target);
    game.toast('Ponto amarelo marcado'); return true;
  }
  function markAimPoint() {
    if (!api.canPlayerAct || !game.training.active || game.ui?.combatHUD?.panelOpen) return false;
    const camera = game.engine.camera, from = camera.getWorldPosition(new THREE.Vector3()), direction = camera.getWorldDirection(new THREE.Vector3());
    let target;
    if (direction.y < -.025) target = from.clone().addScaledVector(direction, Math.min(80, -from.y / direction.y));
    else target = game.player.feet.clone().add(new THREE.Vector3(direction.x, 0, direction.z).normalize().multiplyScalar(15));
    const marked = markPoint(target); if (marked) simulation.setZombieGoal('point', pointMarker.position); return marked;
  }
  const api = {
    root, simulation, views, models, player, objective, spawn: add, horde, targets, reset, scenario, markPoint, markAimPoint,
    get showHitboxes() { return showHitboxes; }, set showHitboxes(value) { showHitboxes = !!value; },
    get canPlayerAct() { return !game.training.active || !player.dead; },
    configure(next) { return simulation.configure(next); },
    setDifficulty(value) { if (!DIFFICULTIES[value]) throw new RangeError('Dificuldade inválida'); for (const e of simulation.agents) if (e.kind === 'human') e.ai.difficulty = value; },
    setZombieGoal(value) { simulation.setZombieGoal(value, pointMarker.position); },
    raycast(from, to) {
      if (!game.training.active || disposed) return null;
      // Paintball supplies exact mesh occlusion and chooses the nearest hit.
      // The navigation AABBs must not block a visible shot around a rotated crate.
      const hit = simulation.traceActors(from, to, { source: player });
      return hit ? { ...hit, point: new THREE.Vector3().copy(hit.point), normal: new THREE.Vector3().copy(hit.normal) } : null;
    },
    impact(hit, info) {
      if (!hit.entity || !game.training.active) return false;
      simulation.damage(hit.entity, { source: player, region: hit.region, weapon: info.weapon }); return true;
    },
    collide(x, z, radius, feetY = 0, { from } = {}) {
      if (!game.training.active) return [x, z];
      for (const e of simulation.actors) {
        if (e === player || e.dead || feetY >= e.position.y + 1.8 || feetY + 1.8 <= e.position.y) continue;
        const dx = x - e.position.x, dz = z - e.position.z, d = Math.hypot(dx, dz), limit = radius + e.radius;
        if (d < limit) {
          if (from) { if (d < Math.hypot(from.x - e.position.x, from.z - e.position.z) - .00001) return [from.x, from.z]; }
          else { x = e.position.x + (d ? dx / d : 1) * limit; z = e.position.z + (d ? dz / d : 0) * limit; }
        }
      }
      return [x, z];
    },
  };
  api.trainingLab = createTrainingLab(game, api);
  function update(dt) {
    if (disposed) return;
    root.visible = game.training.active; if (!root.visible) return;
    player.position = { x: game.player.feet.x, y: game.player.feet.y, z: game.player.feet.z }; player.yaw = game.player.yaw; player.crouched = game.player.crouched;
    updateHumanoidHitboxes(player, player.crouched);
    const running = game.player.active && !game.ui?.mapOpen && !game.ui?.combatHUD?.panelOpen && !document.hidden;
    if (running) {
      if (simulation.time - lastObstaclesAt >= .25) { syncObstacles(); lastObstaclesAt = simulation.time; }
      simulation.update(dt);
      if (player.dead && simulation.time - player.dead.at >= simulation.rules.respawnSeconds) {
        game.player.placeAt(spawn.x, spawn.z, spawn.yaw); simulation.revive(player, game.player.feet); game.paintball?.clearEffects(); game.paintball?.resetAmmo?.();
      }
    }
    for (const [entity, view] of views) {
      const speed = Math.hypot(entity.velocity.x, entity.velocity.z);
      if (running && !entity.dead) {
        view.stepDistance = (view.stepDistance || 0) + speed * Math.min(.1, dt);
        if (view.stepDistance >= .8) { view.stepDistance %= .8; game.audio?.footstep?.(footSurface(game, entity.position), { speed, position: { ...entity.position } }); }
      }
      view.update(running ? Math.min(.1, Math.max(0, dt)) : 0, simulation.time, game.engine.camera, showHitboxes);
    }
    for (const tracer of tracers) if (simulation.time >= tracer.until) tracer.line.visible = false;
    beacon.material.emissiveIntensity = objective.dead ? 0 : .4;
    beacon.material.color.setHex(objective.dead ? 0x444c54 : 0x55bbc9);
    pointMarker.visible = simulation.zombieGoal === 'point';
    api.trainingLab.probe(); api.trainingLab.refresh();
  }
  const unbindMode = game.events.on('modechange', mode => {
    if (disposed) return;
    if (mode === 'training' && !wasTraining) reset();
    if (mode !== 'training') { simulation.clear(); root.visible = false; }
    wasTraining = mode === 'training';
  });
  game.engine.addSystem(update, 'world');
  api.update = update;
  api.dispose = () => {
    if (disposed) return; disposed = true; unbindMode(); simulation.dispose(); api.trainingLab.dispose(); root.removeFromParent();
    objectiveGeometry.dispose(); objectiveMaterial.dispose(); pointGeometry.dispose(); pointMaterial.dispose();
    for (const tracer of tracers) tracer.line.geometry.dispose(); for (const material of traceMaterials) material.dispose();
  };
  return api;
}
