import * as THREE from 'three';
import { ammoPosition, AMMO_RESPAWN_SECONDS } from '../../shared/props.js';

export function createAmmoPickups(game) {
  const root = new THREE.Group(); root.name = 'ammo-loot'; root.userData.paintballIgnore = true; game.engine.scene.add(root);
  const green = new THREE.MeshStandardMaterial({ color: 0x526b46, roughness: .58, metalness: .55 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x26372d, roughness: .48, metalness: .7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8b66b, roughness: .3, metalness: .8 });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xb1e9fb, transparent: true, opacity: .6, depthWrite: false });
  const resources = [], records = []; let nearby = null, time = 0;
  function box(parent, size, position, material) {
    const geometry = new THREE.BoxGeometry(...size); resources.push(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...position); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.keepStandard = true; parent.add(mesh); return mesh;
  }
  for (const mode of ['training', 'campaign']) {
    const center = mode === 'training' ? game.dynamicProps.training : game.dynamicProps.campaign, at = ammoPosition(center), group = new THREE.Group();
    group.name = `ammo-crate-${mode}`; group.position.set(at.x, mode === 'training' ? 0 : game.map.terrain.heightAt(at.x, at.z), at.z);
    box(group, [.72, .38, .44], [0, .23, 0], green); box(group, [.76, .06, .48], [0, .45, 0], edge);
    for (const x of [-.27, .27]) box(group, [.035, .4, .46], [x, .25, 0], edge);
    box(group, [.045, .1, .045], [-.14, .51, 0], edge); box(group, [.045, .1, .045], [.14, .51, 0], edge); box(group, [.32, .035, .045], [0, .56, 0], edge);
    box(group, [.07, .12, .025], [0, .39, .24], brass);
    // Embossed cartridge silhouettes make the loot readable without a label.
    for (const x of [-.12, -.04, .04]) { box(group, [.035, .13, .018], [x, .23, .23], brass); box(group, [.023, .04, .018], [x, .315, .23], brass); }
    const geometry = new THREE.TorusGeometry(.54, .014, 4, 28); resources.push(geometry);
    const ring = new THREE.Mesh(geometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = .025; group.add(ring); root.add(group);
    records.push({ id: `ammo-${mode}`, kind: 'ammo', label: 'Munição', mode, group, ring, availableAt: 0, distance: Infinity });
  }
  function update(dt = 0) {
    if (game.player.active && !game.ui?.paused && !game.ui?.mapOpen) time += Math.max(0, dt);
    nearby = null;
    for (const record of records) {
      const network = record.mode === 'campaign' && game.multiplayer?.active;
      const available = network ? (game.multiplayer.snapshot?.ammoLoot?.availableAt || 0) <= (game.multiplayer.snapshot?.time || 0) : time >= record.availableAt;
      record.group.visible = available && (record.mode === 'training') === !!game.training.active;
      record.distance = record.group.position.distanceTo(game.player.feet);
      if (record.group.visible && game.player.active && record.distance <= 1.8 && (!nearby || record.distance < nearby.distance)) nearby = record;
      record.ring.scale.setScalar(record === nearby ? 1.12 : 1);
    }
  }
  function pickup() {
    update(); if (!nearby || game.ui?.weaponWheelOpen || game.ui?.mapOpen) return false;
    if (game.multiplayer?.active) { game.multiplayer.pickupAmmo(); return true; }
    const gained = game.paintball.refillAmmo(); if (!gained) { game.toast('Reserva de munição cheia.'); return false; }
    nearby.availableAt = time + AMMO_RESPAWN_SECONDS; game.toast('Munição coletada · +2 carregadores por arma'); game.audio?.ui('confirm'); update(); return true;
  }
  game.events.on('combatreset', () => { for (const record of records) record.availableAt = 0; update(); });
  game.events.on('modechange', () => update()); game.engine.addSystem(update, 'world'); update();
  return { root, records, update, pickup, get nearby() { return nearby; }, dispose() { root.removeFromParent(); for (const geometry of resources) geometry.dispose(); for (const material of [green, edge, brass, ringMaterial]) material.dispose(); } };
}
