import * as THREE from 'three';
import { createActorView, traceHitboxes, updateHumanoidHitboxes } from '../combat/index.js';
import { MultiplayerNetwork } from './network.js';
import { SnapshotTimeline } from './timeline.js';
import { footSurface } from '../../core/index.js';
import { EV, NET, interpolatePose, multiplayerLandmarks } from '../../shared/multiplayer.js';
import { slideCharacterContacts } from '../../shared/movement.js';
import { advanceProjectile } from '../../shared/ballistics.js';

export function createMultiplayerModule(game, { weaponModels } = {}) {
  const network = new MultiplayerNetwork(), views = new Map(), zombies = new Map(), roster = new Map();
  const root = new THREE.Group(); root.name = 'multiplayer-world'; root.userData.paintballIgnore = true; root.visible = false; game.engine.scene.add(root);
  const landmarks = multiplayerLandmarks(game.campus.data, game.map.terrain);
  const markerGeometry = new THREE.RingGeometry(1.1, 1.35, 32), markerMaterials = [0x69d8dc, 0xefc760].map(color => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .85, depthWrite: false, toneMapped: false }));
  const markers = ['defense', 'football'].map((id, i) => {
    const at = id === 'defense' ? landmarks.defense : landmarks.field;
    const mesh = new THREE.Mesh(markerGeometry, markerMaterials[i]); mesh.rotation.x = -Math.PI / 2; mesh.position.set(at.x, at.y + .12, at.z); root.add(mesh);
    return { id, mesh, at, label: id === 'defense' ? 'DEFENDER O PRATA' : 'FUTEBOL DE CAIXA' };
  });
  const portalGeometry = new THREE.TorusGeometry(1.5, .15, 8, 32), portalMaterial = new THREE.MeshBasicMaterial({ color: 0xac6eff, toneMapped: false });
  const portalDisc = new THREE.CircleGeometry(1.4, 32), discMaterial = new THREE.MeshBasicMaterial({ color: 0x6331ac, transparent: true, opacity: .6, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const portals = landmarks.portals.map(at => { const p = new THREE.Group(); p.add(new THREE.Mesh(portalGeometry, portalMaterial), new THREE.Mesh(portalDisc, discMaterial)); p.position.set(at.x, at.y + 1.8, at.z); root.add(p); return p; });
  const ballGeometry = new THREE.SphereGeometry(.075, 6, 4), ballMaterial = new THREE.MeshBasicMaterial({ color: 0xf0b16b, toneMapped: false });
  const bullets = Array.from({ length: 128 }, () => { const ball = new THREE.Mesh(ballGeometry, ballMaterial); ball.visible = false; root.add(ball); return { ball, id: null, velocity: new THREE.Vector3(), age: 0 }; });
  let bulletIndex = 0;
  const timeline = new SnapshotTimeline(), predictedImpacts = new Map();
  let latest = null, seq = 0, pending = [], sendAccumulator = 0, life = 0, nearby = null;
  const now = () => performance.now() / 1000;
  const worldEvents = event => game.events.emit('multiplayerevent', event);
  const actor = pose => ({ id: pose.id, kind: pose.kind, radius: .35, position: { x: pose.x, y: pose.y, z: pose.z }, yaw: pose.yaw, velocity: { x: pose.vx || 0, y: 0, z: pose.vz || 0 }, health: { current: pose.health, max: pose.maxHealth, lastHitAt: -Infinity }, dead: pose.dead, deathImpulse: pose.deathImpulse, networkGhost: pose.kind === 'player' && !pose.connected, action: pose.action, actionSerial: pose.actionSerial, hitboxes: [] });
  function remote(pose) {
    const state = { feet: new THREE.Vector3(), eyePosition: new THREE.Vector3(), velocity: new THREE.Vector3(), active: true, grounded: true, fly: false, crouched: false, cameraMode: 'third', yaw: 0 };
    const camera = new THREE.PerspectiveCamera(), avatar = game.player.avatar.cloneForPreview({ scene: root, camera, player: state });
    avatar.appearance.apply(roster.get(pose.id)?.character.appearance);
    const entity = actor(pose), gun = new THREE.Group(); gun.userData.paintballIgnore = true; root.add(gun);
    const entry = { state, camera, avatar, entity, gun, weapon: null, update(p, dt) {
      if (p.dead && !entry.dead && entry.initialized) game.ragdolls?.capture(avatar.root, { impulse: p.deathImpulse });
      if (entry.life !== p.life) { game.bodyPaint?.clear(avatar.root); avatar.stopHit(); entry.life = p.life; }
      entry.dead = p.dead; entry.initialized = true;
      const displacement = state.feet.distanceTo(new THREE.Vector3(p.x, p.y, p.z));
      if (!p.dead && displacement < 1 && Math.abs(p.y - state.feet.y) < .05) {
        entry.stepDistance = (entry.stepDistance || 0) + displacement;
        if (entry.stepDistance >= .8) { entry.stepDistance %= .8; game.audio?.footstep?.(footSurface(game, { x: p.x, y: p.y, z: p.z }), { speed: Math.hypot(p.vx || 0, p.vz || 0), position: { x: p.x, y: p.y, z: p.z } }); }
      }
      state.feet.set(p.x, p.y, p.z); state.eyePosition.copy(state.feet).y += p.crouched ? 1.1 : 1.7;
      state.velocity.set(p.vx || 0, 0, p.vz || 0); state.yaw = p.yaw; state.crouched = p.crouched; state.active = !p.dead && p.connected;
      camera.rotation.set(0, p.yaw, 0);
      const weapon = game.paintball.weapons.find(w => w.id === p.weapon) || game.paintball.weapons[0];
      if (entry.weapon !== weapon.id) {
        game.audio?.stopReload?.(`reload:${p.id}`);
        gun.clear(); const source = weaponModels?.[weapon.id];
        if (source) { const model = source.model.clone(true); gun.add(model); gun.userData.weaponGrip = source.grip.clone(); gun.userData.weaponLength = source.length; gun.userData.muzzle = source.muzzle.clone(); }
        entry.weapon = weapon.id;
      }
      avatar.setWeapon({ ...weapon, holstered: p.holstered }); avatar.update(dt);
      avatar.updateWeapon(gun, { weapon: weapon.id, kind: weapon.kind, holstered: p.holstered, active: state.active });
      gun.visible = state.active && weapon.kind !== 'unarmed' && (!p.holstered || !!gun.userData.stowedVisible) && !gun.userData.characterEmote;
      Object.assign(entity, actor(p)); updateHumanoidHitboxes(entity, p.crouched);
    }, dispose() {
      game.bodyPaint?.clear(avatar.root);
      avatar.mixer.stopAllAction(); avatar.mixer.uncacheRoot(avatar.model); avatar.appearance.dispose();
      const skeletons = new Set(); avatar.model.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); }); for (const s of skeletons) s.dispose();
      avatar.root.removeFromParent(); gun.removeFromParent();
    } };
    return entry;
  }
  function setRoster(data) {
    roster.clear(); for (const p of data.players) roster.set(p.id, p);
    game.events.emit('multiplayerroster', data);
  }
  function reconcile(snapshot, force = false) {
    const me = snapshot.players.find(p => p.id === network.session?.selfId); if (!me) return;
    if (force || me.life !== life) {
      game.bodyPaint?.clear(game.player.avatar.root);
      life = me.life; pending = []; seq = Math.max(seq, me.seq);
      game.player.placeAt(me.x, me.z, me.yaw); game.player.feet.y = me.y; game.player.updateCamera(); return;
    }
    const sent = pending.find(p => p.seq === me.seq);
    if (sent && !me.dead) {
      const correction = { x: me.x - sent.x, y: Math.abs(me.y - sent.y) > .65 ? me.y - sent.y : 0, z: me.z - sent.z };
      if (Math.hypot(correction.x, correction.y, correction.z) > .06) {
        game.player.feet.add(new THREE.Vector3(correction.x, correction.y, correction.z)); game.player.updateCamera();
        for (const p of pending) if (p.seq > me.seq) for (const k of ['x', 'y', 'z']) p[k] += correction[k];
      }
    }
    pending = pending.filter(p => p.seq > me.seq);
  }
  function receiveSnapshot(snapshot, force = false) {
    if (!timeline.add(snapshot, now())) return;
    latest = snapshot;
    reconcile(snapshot, force);
    game.events.emit('multiplayersnapshot', snapshot);
  }
  network.on('welcome', info => {
    timeline.clear(); predictedImpacts.clear(); pending = [];
    setRoster(info.roster); receiveSnapshot(info.snapshot, true);
    game.events.emit('multiplayerjoined', info);
  });
  network.on(EV.roster, setRoster); network.on(EV.snapshot, snapshot => receiveSnapshot(snapshot));
  network.on('disconnect', () => { game.paintball.resetInput(); game.events.emit('multiplayerstatus', network.status); });
  network.on('status', status => game.events.emit('multiplayerstatus', status));
  network.on('ended', message => { game.toast(message); game.ui?.showMenu(); });
  network.on(EV.event, event => {
    if (event.type === 'ammoPickup' && event.player === network.session?.selfId) { game.paintball.refillAmmo(); game.audio?.ui('confirm'); game.toast('Munição coletada · +2 carregadores por arma'); }
    if (event.type === 'paintHit') {
      const own = event.victim === network.session?.selfId, view = views.get(event.victim) || zombies.get(event.victim);
      const victim = own ? game.player.avatar.root : view?.avatar?.root || view?.view.root;
      let point = event.point, normal = event.normal;
      if (event.targetPose) {
        const position = own ? game.player.feet : view?.entity.position;
        const yaw = own ? game.player.yaw : view?.entity.yaw;
        if (position) {
          const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw - event.targetPose.yaw);
          point = new THREE.Vector3().copy(point).sub(event.targetPose.position).applyQuaternion(turn).add(position);
          normal = new THREE.Vector3().copy(normal).applyQuaternion(turn);
        }
      }
      game.bodyPaint?.stamp(victim, point, normal, event.paintColor);
    }
    if (event.type === 'emote') (event.player === network.session?.selfId ? game.player.avatar : views.get(event.player)?.avatar)?.playEmote(event.emote);
    if (event.type === 'shot' && event.player !== network.session?.selfId) {
      views.get(event.player)?.avatar.playShot();
      game.audio?.shot(event.weapon, { position: event.origin });
      for (const b of event.bullets) { const visual = bullets[bulletIndex++ % bullets.length]; visual.id = b.id; visual.age = 0; visual.passed = false; visual.ball.position.copy(event.origin); visual.velocity.copy(b.direction).multiplyScalar(event.speed); visual.ball.visible = true; }
    }
    if (event.type === 'impact') {
      const key = `${event.shotId}:${event.pellet}`;
      if (event.player !== network.session?.selfId || !predictedImpacts.has(key)) game.audio?.hit?.({ point: event.point, surface: event.surface }, { kind: event.kind || 'firearm' });
      if (event.player === network.session?.selfId && event.shotId !== undefined) predictedImpacts.set(key, now());
    }
    if (event.type === 'bulletEnd') {
      const visual = bullets.find(b => b.id === event.bullet); if (visual) visual.ball.visible = false;
      if (event.player === network.session?.selfId && event.victim && event.shotId !== undefined) game.paintball.endNetworkShot(event.shotId, event.pellet);
    }
    if (event.type === 'attack' && event.player !== network.session?.selfId) { const weapon = game.paintball.weapons.find(w => w.id === event.weapon); views.get(event.player)?.avatar.playAttack(weapon); const pose = latest?.players.find(p => p.id === event.player); if (pose) game.audio?.melee?.(weapon, { position: pose }); }
    if (event.type === 'reload' && event.player !== network.session?.selfId) {
      const view = views.get(event.player), weapon = game.paintball.weapons.find(w => w.id === event.weapon);
      const tag = `reload:${event.player}`;
      if (event.active) { view?.avatar.playReload(event.duration); game.audio?.reload?.(weapon, { duration: event.duration, position: () => view?.state.feet, tag }); }
      else { view?.avatar.stopReload(); game.audio?.stopReload?.(tag); }
    }
    if (event.type === 'damage') {
      const zombie = zombies.get(event.victim); if (zombie) { zombie.entity.health.lastHitAt = event.time; zombie.view.react(event.region, event.time); }
      (event.victim === network.session?.selfId ? game.player.avatar : views.get(event.victim)?.avatar)?.playHit(event.region);
      if (event.victim === network.session?.selfId && event.remaining <= 0) game.paintball.resetInput();
    }
    if (event.type === 'respawn' && event.player === network.session?.selfId) game.player.avatar.stopHit();
    if (event.type === 'death') {
      game.audio?.stopReload?.(`reload:${event.victim}`);
      if (event.victim === network.session?.selfId) { game.player.spawnCorpse?.(event.impulse); game.player.avatar.stopEmote(); }
    }
    if (event.message) game.toast(event.message);
    worldEvents(event);
  });
  function sample() {
    const frame = timeline.sample(now()); if (!frame) return null;
    const { a, b, alpha, time } = frame;
    return { ...b, time, players: b.players.map(p => interpolatePose(a.players.find(q => q.id === p.id), p, alpha)), zombies: b.zombies.map(p => interpolatePose(a.zombies.find(q => q.id === p.id), p, alpha)),
      crates: b.crates.map(p => {
        const previous = a.crates.find(q => q.id === p.id);
        if (!previous || new THREE.Vector3().copy(previous.position).distanceTo(new THREE.Vector3().copy(p.position)) > 8) return p;
        const position = new THREE.Vector3().copy(previous.position).lerp(p.position, alpha);
        const rotation = new THREE.Quaternion().copy(previous.rotation).slerp(p.rotation, alpha);
        return { ...p, position, rotation };
      }),
    };
  }
  function currentPose() {
    const p = game.player, pose = { seq: ++seq, x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, crouched: p.crouched, aiming: game.paintball.aiming, weapon: game.paintball.weapon.id, holstered: game.paintball.holstered };
    pending.push(pose); if (pending.length > 150) pending.shift(); return pose;
  }
  function update(dt) {
    root.visible = game.mode === 'multiplayer' && !!network.session;
    if (!root.visible || !latest) return;
    const data = sample(); if (!data) return;
    game.dynamicProps.applyNetworkState(data.crates);
    for (const b of bullets) if (b.ball.visible) { const before = b.ball.position.clone(), step = advanceProjectile(before, b.velocity, Math.min(.1, dt)); b.ball.position.copy(step.position); b.velocity.copy(step.velocity); if (!b.passed && game.audio?.whiz?.(before, b.ball.position)) b.passed = true; b.age += dt; if (b.age > 3) b.ball.visible = false; }
    for (const [key, at] of predictedImpacts) if (now() - at > 4) predictedImpacts.delete(key);
    sendAccumulator += Math.min(.1, dt);
    if (network.ready && sendAccumulator >= 1 / NET.poseHz) {
      sendAccumulator %= 1 / NET.poseHz;
      network.pose(currentPose());
    }
    const wanted = new Set();
    for (const p of data.players) {
      if (p.id === network.session.selfId) continue;
      wanted.add(p.id); if (!views.has(p.id)) views.set(p.id, remote(p));
      // Render every combat target on the same authoritative timeline used
      // for rewind; cosmetic peer poses cannot define a hittable position.
      views.get(p.id).update(p, dt);
    }
    for (const [id, view] of views) if (!wanted.has(id)) { view.dispose(); views.delete(id); }
    const zombieIds = new Set();
    for (const p of data.zombies) {
      zombieIds.add(p.id);
      if (!zombies.has(p.id)) { const entity = actor(p); zombies.set(p.id, { entity, view: createActorView(entity, game.combat.models.zombie, { parent: root, ragdolls: game.ragdolls }) }); }
      const z = zombies.get(p.id), lastHit = z.entity.health.lastHitAt;
      // Animate the supplied rig, then restore the shared network hitboxes.
      Object.assign(z.entity, { position: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw, dead: p.dead, deathImpulse: p.deathImpulse, action: p.action, actionSerial: p.actionSerial });
      z.entity.health.current = p.health; z.entity.health.lastHitAt = lastHit; z.view.update(dt, data.time, game.engine.camera);
      updateHumanoidHitboxes(z.entity);
    }
    for (const [id, z] of zombies) if (!zombieIds.has(id)) { game.bodyPaint?.clear(z.view.root); z.view.dispose(); zombies.delete(id); }
    const me = api.self;
    if (me?.dead) game.player.avatar.root.visible = false;
    nearby = markers.find(m => Math.hypot(game.player.feet.x - m.at.x, game.player.feet.z - m.at.z) < (m.id === 'football' ? 6 : 5) && latest[m.id].status !== 'running') || null;
    for (const portal of portals) { portal.visible = latest.defense.status === 'running'; portal.children[1].rotation.z += dt * 1.5; }
    for (const marker of markers) marker.mesh.rotation.z += dt * .3;
  }
  function clear() {
    latest = null; timeline.clear(); predictedImpacts.clear(); pending = []; nearby = null; root.visible = false;
    for (const b of bullets) b.ball.visible = false;
    for (const v of views.values()) v.dispose(); views.clear(); for (const z of zombies.values()) { game.bodyPaint?.clear(z.view.root); z.view.dispose(); } zombies.clear(); roster.clear();
    game.events.emit('multiplayerleft');
  }
  network.on('left', clear);
  const api = { network, root, views, zombies, markers, landmarks, update,
    get active() { return game.mode === 'multiplayer'; }, get self() { return latest?.players.find(p => p.id === network.session?.selfId); },
    get canAct() { return !api.active || (network.ready && !timeline.stale(now()) && latest?.phase === 'running' && !!api.self && !api.self.dead); },
    get snapshot() { return latest; }, get roster() { return roster; }, get peerCount() { return 0; }, get nearby() { return nearby; },
    get connectionStale() { return timeline.stale(now()); }, get interpolationMs() { return Math.round(timeline.delay * 1000); },
    attack(weapon, info) {
      if (!api.active || !api.canAct) return;
      const at = now(), shotTime = network.serverNow(at) ?? timeline.serverNow(at, network.latency);
      network.action({ type: 'attack', weapon: weapon.id || weapon, origin: info.origin, direction: info.direction, aiming: !!info.aiming,
        shotId: info.shotId, shotTime, viewTime: Math.min(shotTime, timeline.renderTime), pose: currentPose(), paintColor: game.paintball.color.color }, reply => {
        if (reply?.accepted === false && info.shotId !== undefined) game.paintball.rejectNetworkShot(info.shotId);
      });
    },
    predictImpact(hit, info) {
      if (info.shotId === undefined) return;
      const key = `${info.shotId}:${info.pellet}`;
      if (!predictedImpacts.has(key)) game.audio?.hit?.(hit, info);
      predictedImpacts.set(key, now());
    },
    pickupAmmo() { if (api.active && api.canAct) network.action({ type: 'pickupAmmo' }); },
    reload(weapon, active) { if (api.active) network.action({ type: active ? 'reload' : 'cancelReload', weapon }); },
    emote(id) { if (api.active && network.ready && api.self && !api.self.dead) network.action({ type: 'emote', emote: id }); },
    ready(value) { if (api.active && network.ready) network.action({ type: 'ready', ready: !!value }); },
    interact() { if (!api.active || !api.canAct || !nearby || game.ui?.weaponWheelOpen) return false; network.action({ type: 'interact', game: nearby.id }); return true; },
    raycast(from, to) {
      if (!api.active) return null;
      const actors = [...views.values()].map(v => v.entity).concat([...zombies.values()].map(z => z.entity));
      const hit = traceHitboxes(from, to, actors); return hit ? { ...hit, point: new THREE.Vector3().copy(hit.point), normal: new THREE.Vector3().copy(hit.normal) } : null;
    },
    collide(x, z, radius, feetY = 0, options) {
      if (!api.active) return [x, z];
      const actors = [...views.values()].map(v => v.entity).concat([...zombies.values()].map(z => z.entity));
      return slideCharacterContacts(x, z, radius, feetY, actors, options);
    },
    leave() { network.close(); },
    dispose() { network.close(); markerGeometry.dispose(); for (const material of markerMaterials) material.dispose(); portalGeometry.dispose(); portalMaterial.dispose(); portalDisc.dispose(); discMaterial.dispose(); ballGeometry.dispose(); ballMaterial.dispose(); root.removeFromParent(); },
  };
  game.engine.addSystem(update, 'world');
  game.input.bind('KeyE', () => api.interact(), { label: 'iniciar minigame na sala' });
  game.events.on('modechange', mode => { if (mode !== 'multiplayer' && network.session) api.leave(); });
  return api;
}
