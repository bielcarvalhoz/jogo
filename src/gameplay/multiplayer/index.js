import * as THREE from 'three';
import { createActorView, traceHitboxes, updateHumanoidHitboxes } from '../combat/index.js';
import { MultiplayerNetwork } from './network.js';
import { PeerMesh } from './peers.js';
import { footSurface } from '../../core/index.js';
import { EV, NET, interpolatePose, multiplayerLandmarks } from '../../shared/multiplayer.js';

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
  let mesh = null, latest = null, snapshots = [], seq = 0, pending = [], sendAccumulator = 0, meshTimer = 0, life = 0, nearby = null;
  const now = () => performance.now() / 1000;
  const worldEvents = event => game.events.emit('multiplayerevent', event);
  const actor = pose => ({ id: pose.id, kind: pose.kind, position: { x: pose.x, y: pose.y, z: pose.z }, yaw: pose.yaw, velocity: { x: pose.vx || 0, y: 0, z: pose.vz || 0 }, health: { current: pose.health, max: pose.maxHealth, lastHitAt: -Infinity }, dead: pose.dead, deathImpulse: pose.deathImpulse, networkGhost: pose.kind === 'player' && !pose.connected, action: pose.action, actionSerial: pose.actionSerial, hitboxes: [] });
  function remote(pose) {
    const state = { feet: new THREE.Vector3(), eyePosition: new THREE.Vector3(), velocity: new THREE.Vector3(), active: true, grounded: true, fly: false, crouched: false, cameraMode: 'third', yaw: 0 };
    const camera = new THREE.PerspectiveCamera(), avatar = game.player.avatar.cloneForPreview({ scene: root, camera, player: state });
    avatar.appearance.apply(roster.get(pose.id)?.character.appearance);
    const entity = actor(pose), gun = new THREE.Group(); gun.userData.paintballIgnore = true; root.add(gun);
    const entry = { state, camera, avatar, entity, gun, weapon: null, update(p, dt) {
      if (p.dead && !entry.dead && entry.initialized) game.ragdolls?.capture(avatar.root, { impulse: p.deathImpulse });
      if (entry.life !== p.life) { game.bodyPaint?.clear(avatar.root); entry.life = p.life; }
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
        if (source) { const model = source.model.clone(true); gun.add(model); gun.userData.grip = source.grip.clone(); gun.userData.muzzle = source.muzzle.clone(); }
        entry.weapon = weapon.id;
      }
      avatar.setWeapon({ ...weapon, holstered: p.holstered }); avatar.update(dt);
      avatar.updateWeapon(gun, { weapon: weapon.id, kind: weapon.kind, holstered: p.holstered, active: state.active });
      gun.visible = state.active && !p.holstered && weapon.kind !== 'unarmed' && !gun.userData.characterEmote;
      Object.assign(entity, actor(p)); updateHumanoidHitboxes(entity, p.crouched);
    }, dispose() {
      avatar.mixer.stopAllAction(); avatar.mixer.uncacheRoot(avatar.model); avatar.appearance.dispose();
      const skeletons = new Set(); avatar.model.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); }); for (const s of skeletons) s.dispose();
      avatar.root.removeFromParent(); gun.removeFromParent();
    } };
    return entry;
  }
  function setRoster(data) {
    roster.clear(); for (const p of data.players) roster.set(p.id, p);
    mesh?.setPeers(data.players.filter(p => p.connected && p.id !== network.session?.selfId).map(p => p.id));
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
    latest = snapshot; snapshots.push({ data: snapshot, at: now() }); if (snapshots.length > 12) snapshots.shift();
    reconcile(snapshot, force);
    game.events.emit('multiplayersnapshot', snapshot);
  }
  network.on('welcome', info => {
    snapshots = []; pending = []; mesh?.close();
    mesh = new PeerMesh({ selfId: info.selfId, signal: (to, data) => network.signal(to, data) });
    setRoster(info.roster); receiveSnapshot(info.snapshot, true);
    game.events.emit('multiplayerjoined', info);
  });
  network.on(EV.roster, setRoster); network.on(EV.snapshot, snapshot => receiveSnapshot(snapshot));
  network.on(EV.signal, ({ from, data }) => { void mesh?.receive(from, data); });
  network.on('disconnect', () => { mesh?.close(); mesh = null; game.paintball.resetInput(); game.events.emit('multiplayerstatus', network.status); });
  network.on('status', status => game.events.emit('multiplayerstatus', status));
  network.on('ended', message => { game.toast(message); game.ui?.showMenu(); });
  network.on(EV.event, event => {
    if (event.type === 'ammoPickup' && event.player === network.session?.selfId) { game.paintball.refillAmmo(); game.audio?.ui('confirm'); game.toast('Munição coletada · +2 carregadores por arma'); }
    if (event.type === 'paintHit') {
      const victim = event.victim === network.session?.selfId ? game.player.avatar.root : views.get(event.victim)?.avatar.root || zombies.get(event.victim)?.view.root;
      game.bodyPaint?.stamp(victim, event.point, event.normal, event.paintColor);
    }
    if (event.type === 'emote') (event.player === network.session?.selfId ? game.player.avatar : views.get(event.player)?.avatar)?.playEmote(event.emote);
    if (event.type === 'shot' && event.player !== network.session?.selfId) {
      views.get(event.player)?.avatar.playShot();
      game.audio?.shot(event.weapon, { position: event.origin });
      for (const b of event.bullets) { const visual = bullets[bulletIndex++ % bullets.length]; visual.id = b.id; visual.age = 0; visual.passed = false; visual.ball.position.copy(event.origin); visual.velocity.copy(b.direction).multiplyScalar(event.speed); visual.ball.visible = true; }
    }
    if (event.type === 'impact') game.audio?.hit?.({ point: event.point, surface: event.surface }, { kind: event.kind || 'firearm' });
    if (event.type === 'bulletEnd') { const visual = bullets.find(b => b.id === event.bullet); if (visual) visual.ball.visible = false; }
    if (event.type === 'attack' && event.player !== network.session?.selfId) { const weapon = game.paintball.weapons.find(w => w.id === event.weapon); views.get(event.player)?.avatar.playAttack(weapon); const pose = latest?.players.find(p => p.id === event.player); if (pose) game.audio?.melee?.(weapon, { position: pose }); }
    if (event.type === 'reload' && event.player !== network.session?.selfId) {
      const view = views.get(event.player), weapon = game.paintball.weapons.find(w => w.id === event.weapon);
      const tag = `reload:${event.player}`;
      if (event.active) { view?.avatar.playReload(event.duration); game.audio?.reload?.(weapon, { duration: event.duration, position: () => view?.state.feet, tag }); }
      else { view?.avatar.stopReload(); game.audio?.stopReload?.(tag); }
    }
    if (event.type === 'damage') {
      const zombie = zombies.get(event.victim); if (zombie) { zombie.entity.health.lastHitAt = event.time; zombie.view.react(event.region, event.time); }
      if (event.victim === network.session?.selfId && event.remaining <= 0) game.paintball.resetInput();
    }
    if (event.type === 'death') {
      game.audio?.stopReload?.(`reload:${event.victim}`);
      if (event.victim === network.session?.selfId) { game.player.spawnCorpse?.(event.impulse); game.player.avatar.stopEmote(); }
    }
    if (event.message) game.toast(event.message);
    worldEvents(event);
  });
  function sample() {
    if (!snapshots.length) return null;
    const target = now() - .1;
    while (snapshots.length > 2 && snapshots[1].at < target) snapshots.shift();
    const a = snapshots[0], b = snapshots[1] || a, alpha = a === b ? 1 : Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at)));
    return { ...b.data, players: b.data.players.map(p => interpolatePose(a.data.players.find(q => q.id === p.id), p, alpha)), zombies: b.data.zombies.map(p => interpolatePose(a.data.zombies.find(q => q.id === p.id), p, alpha)),
      crates: b.data.crates.map(p => {
        const previous = a.data.crates.find(q => q.id === p.id);
        if (!previous || new THREE.Vector3().copy(previous.position).distanceTo(new THREE.Vector3().copy(p.position)) > 8) return p;
        const position = new THREE.Vector3().copy(previous.position).lerp(p.position, alpha);
        const rotation = new THREE.Quaternion().copy(previous.rotation).slerp(p.rotation, alpha);
        return { ...p, position, rotation };
      }),
    };
  }
  function update(dt) {
    root.visible = game.mode === 'multiplayer' && !!network.session;
    if (!root.visible || !latest) return;
    const data = sample(); if (!data) return;
    game.dynamicProps.applyNetworkState(data.crates);
    for (const b of bullets) if (b.ball.visible) { const before = b.ball.position.clone(); b.ball.position.addScaledVector(b.velocity, Math.min(.1, dt)); if (!b.passed && game.audio?.whiz?.(before, b.ball.position)) b.passed = true; b.age += dt; if (b.age > 6) b.ball.visible = false; }
    sendAccumulator += Math.min(.1, dt); meshTimer += dt;
    if (network.ready && sendAccumulator >= 1 / NET.poseHz) {
      sendAccumulator %= 1 / NET.poseHz;
      const p = game.player, pose = { seq: ++seq, x: p.feet.x, y: p.feet.y, z: p.feet.z, yaw: p.yaw, crouched: p.crouched, aiming: game.paintball.aiming, weapon: game.paintball.weapon.id, holstered: game.paintball.holstered };
      pending.push(pose); if (pending.length > 150) pending.shift(); network.pose(pose); mesh?.send(pose);
    }
    if (meshTimer > 10) { meshTimer = 0; mesh?.setPeers([...roster.values()].filter(p => p.connected).map(p => p.id)); }
    const wanted = new Set();
    for (const p of data.players) {
      if (p.id === network.session.selfId) continue;
      wanted.add(p.id); if (!views.has(p.id)) views.set(p.id, remote(p));
      const rendered = mesh?.sample(p.id, p, dt) || p; views.get(p.id).update(rendered, dt);
    }
    for (const [id, view] of views) if (!wanted.has(id)) { view.dispose(); views.delete(id); }
    const zombieIds = new Set();
    for (const p of data.zombies) {
      zombieIds.add(p.id);
      if (!zombies.has(p.id)) { const entity = actor(p); zombies.set(p.id, { entity, view: createActorView(entity, game.combat.models.zombie, { parent: root, ragdolls: game.ragdolls }) }); }
      const z = zombies.get(p.id), lastHit = z.entity.health.lastHitAt;
      // Preserve the view's bone-driven hitboxes while applying authoritative state.
      Object.assign(z.entity, { position: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw, dead: p.dead, deathImpulse: p.deathImpulse, action: p.action, actionSerial: p.actionSerial });
      z.entity.health.current = p.health; z.entity.health.lastHitAt = lastHit; z.view.update(dt, latest.time, game.engine.camera);
    }
    for (const [id, z] of zombies) if (!zombieIds.has(id)) { z.view.dispose(); zombies.delete(id); }
    const me = api.self;
    if (me?.dead) game.player.avatar.root.visible = false;
    nearby = markers.find(m => Math.hypot(game.player.feet.x - m.at.x, game.player.feet.z - m.at.z) < (m.id === 'football' ? 6 : 5) && latest[m.id].status !== 'running') || null;
    for (const portal of portals) { portal.visible = latest.defense.status === 'running'; portal.children[1].rotation.z += dt * 1.5; }
    for (const marker of markers) marker.mesh.rotation.z += dt * .3;
  }
  function clear() {
    mesh?.close(); mesh = null; latest = null; snapshots = []; pending = []; nearby = null; root.visible = false;
    for (const b of bullets) b.ball.visible = false;
    for (const v of views.values()) v.dispose(); views.clear(); for (const z of zombies.values()) z.view.dispose(); zombies.clear(); roster.clear();
    game.events.emit('multiplayerleft');
  }
  network.on('left', clear);
  const api = { network, root, views, zombies, markers, landmarks, update,
    get active() { return game.mode === 'multiplayer'; }, get self() { return latest?.players.find(p => p.id === network.session?.selfId); },
    get canAct() { return !api.active || (network.ready && latest?.phase === 'running' && !!api.self && !api.self.dead); },
    get snapshot() { return latest; }, get roster() { return roster; }, get peerCount() { return mesh?.connectedCount || 0; }, get nearby() { return nearby; },
    attack(weapon, info) { if (api.active) network.action({ type: 'attack', weapon: weapon.id || weapon, origin: info.origin, direction: info.direction, aiming: !!info.aiming, paintColor: game.paintball.color.color }); },
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
    leave() { network.close(); },
    dispose() { network.close(); markerGeometry.dispose(); for (const material of markerMaterials) material.dispose(); portalGeometry.dispose(); portalMaterial.dispose(); portalDisc.dispose(); discMaterial.dispose(); ballGeometry.dispose(); ballMaterial.dispose(); root.removeFromParent(); },
  };
  game.engine.addSystem(update, 'world');
  game.input.bind('KeyE', () => api.interact(), { label: 'iniciar minigame na sala' });
  game.input.bind('KeyT', () => { if (api.active) api.emote('wave'); }, { label: 'cumprimentar no multiplayer' });
  game.events.on('modechange', mode => { if (mode !== 'multiplayer' && network.session) api.leave(); });
  return api;
}
