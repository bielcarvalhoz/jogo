import * as THREE from 'three';
import { CSS3DRenderer, CSS3DSprite } from 'three/addons/renderers/CSS3DRenderer.js';
import { EMOTES, EMOTE_NAMES } from '../shared/multiplayer.js';
import { weaponWheelIndex } from './weapon-wheel.js';
import './reactions.css';

export function createReactions(game) {
  const player = game.player, ids = Object.keys(EMOTES), scene = new THREE.Scene(), bubbles = [];
  const renderer = new CSS3DRenderer(); renderer.domElement.className = 'reaction-scene'; document.body.append(renderer.domElement);
  const resize = () => renderer.setSize(innerWidth, innerHeight); resize(); window.addEventListener('resize', resize);
  const button = document.createElement('button'); button.id = 'btn-reactions'; button.textContent = '☺'; button.title = 'G · Reações';
  button.setAttribute('aria-label', 'Reações · G'); button.setAttribute('aria-expanded', 'false'); document.getElementById('hud').append(button);
  const panel = document.createElement('section'); panel.id = 'reaction-wheel'; panel.hidden = true; panel.setAttribute('aria-label', 'Reações');
  panel.innerHTML = '<div class="reaction-ring" role="menu" aria-label="Reações"><b>REAÇÕES<small>G</small></b></div>';
  document.getElementById('hud').append(panel); const ring = panel.firstElementChild;
  let opened = false, selected = null, virtualX = 0, virtualY = 0, held = false, localCooldown = 0, previousCamera = null;
  const canUse = () => player.active && !game.ui?.mapOpen && !game.ui?.combatHUD?.panelOpen && !game.ui?.characters.openState && !game.multiplayer?.self?.dead;
  function highlight() { ring.querySelectorAll('button').forEach((el, i) => el.classList.toggle('selected', i === selected)); }
  function close(commit = false) {
    if (!opened) return;
    const id = commit && selected !== null ? ids[selected] : null;
    opened = held = false; panel.hidden = true; button.setAttribute('aria-expanded', 'false'); player.setWeaponWheelOpen(false);
    game.paintball.resetInput(); if (id && canUse()) react(id);
  }
  function open(key = false) {
    if (opened || !canUse() || game.ui?.weaponWheelOpen) return;
    opened = true; held = key; selected = null; virtualX = virtualY = 0;
    game.paintball.resetInput(); player.releasePointerForUI(); player.setFocusedAim(false); player.setWeaponWheelOpen(true);
    panel.hidden = false; button.setAttribute('aria-expanded', 'true'); highlight();
  }
  ids.forEach((id, i) => {
    const el = document.createElement('button'); el.type = 'button'; el.setAttribute('role', 'menuitem'); el.setAttribute('aria-label', EMOTE_NAMES[id]);
    const angle = i / ids.length * Math.PI * 2 - Math.PI / 2;
    el.style.setProperty('--x', `${Math.cos(angle) * 105}px`); el.style.setProperty('--y', `${Math.sin(angle) * 105}px`);
    el.innerHTML = `<span>${EMOTES[id]}</span><small>${EMOTE_NAMES[id]}</small>`;
    el.addEventListener('click', () => { selected = i; close(true); }); ring.append(el);
  });
  button.addEventListener('click', () => {
    if (opened) close(); else { player.releasePointerForUI(); open(); ring.querySelector('button').focus({ preventScroll: true }); }
  });
  panel.addEventListener('pointerdown', event => { if (event.target === panel) close(); });
  game.input.bind('KeyG', event => { event.preventDefault(); open(true); }, { label: 'segurar roda de reações' });
  window.addEventListener('pointermove', event => {
    if (!opened) return;
    if (document.pointerLockElement) { virtualX += event.movementX; virtualY += event.movementY; }
    else { const b = ring.getBoundingClientRect(); virtualX = event.clientX - b.left - b.width / 2; virtualY = event.clientY - b.top - b.height / 2; }
    selected = weaponWheelIndex(virtualX, virtualY, ids.length, 30); highlight();
  });
  window.addEventListener('keydown', event => {
    if (!opened) return;
    if (event.code === 'Escape') { event.preventDefault(); close(); }
    if (event.code.startsWith('Arrow')) { event.preventDefault(); selected = ((selected ?? 0) + (['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1) + ids.length) % ids.length; highlight(); }
    if (event.code === 'Enter' || event.code === 'Space') { event.preventDefault(); close(true); }
  });
  window.addEventListener('keyup', event => { if (event.code === 'KeyG' && held) close(true); });
  window.addEventListener('blur', () => close());
  player.events.addEventListener('unlock', () => close());
  function spawn(id, at, local = false) {
    if (!EMOTES[id] || !at) return;
    if (bubbles.length >= 24) remove(bubbles.shift());
    const element = document.createElement('div'); element.className = 'reaction-bubble'; element.textContent = EMOTES[id]; element.setAttribute('aria-hidden', 'true');
    const sprite = new CSS3DSprite(element); element.style.pointerEvents = 'none'; sprite.position.set(at.x, at.y + 2.2, at.z); sprite.scale.setScalar(.012); scene.add(sprite);
    bubbles.push({ sprite, origin: sprite.position.clone(), age: 0, check: 0, occluded: false });
    game.audio?.notification?.({ x: at.x, y: at.y + 1.8, z: at.z });
    if (local && ['dance', 'wave'].includes(id) && player.cameraMode === 'first') { previousCamera = 'first'; player.setCameraMode('third'); }
  }
  function remove(item) { item.sprite.removeFromParent(); item.sprite.element.remove(); }
  function react(id) {
    if (!canUse() || !EMOTES[id]) return;
    if (game.mode === 'multiplayer') { game.multiplayer.emote(id); return; }
    const now = performance.now(); if (now < localCooldown) return; localCooldown = now + 1000;
    player.avatar.playEmote(id); spawn(id, player.feet, true);
  }
  game.events.on('multiplayerevent', event => { if (event.type === 'emote' && game.mode === 'multiplayer') spawn(event.emote, event.position, event.player === game.multiplayer.network.session?.selfId); });
  function clear() { close(); for (const b of bubbles) remove(b); bubbles.length = 0; player.avatar.stopEmote(); if (previousCamera && player.cameraMode === 'third') player.setCameraMode(previousCamera); previousCamera = null; }
  game.events.on('modechange', clear); game.events.on('multiplayerleft', clear);
  let wasRendered = false;
  game.engine.addSystem(dt => {
    button.hidden = !player.active || game.mode === 'tour';
    if (opened && !canUse()) close();
    if (previousCamera && !player.avatar.animationState.emote) { if (player.cameraMode === 'third') player.setCameraMode(previousCamera); previousCamera = null; }
    const eye = game.engine.camera.position;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]; b.age += Math.min(dt, .1); b.check -= dt;
      if (b.age > 2.6) { remove(b); bubbles.splice(i, 1); continue; }
      b.sprite.position.copy(b.origin).add(new THREE.Vector3(Math.sin(b.age * 3) * .13, b.age * .62, 0));
      b.sprite.scale.setScalar(.012 * Math.min(1.08, b.age / .14));
      if (b.check <= 0) {
        b.check = .15; b.occluded = false;
        const end = b.sprite.position, steps = Math.ceil(eye.distanceTo(end) / 1.5);
        if (steps > 60) b.occluded = true;
        else for (let n = 1; n < steps; n++) {
          const p = eye.clone().lerp(end, n / steps), [x, z] = game.physics.collide(p.x, p.z, .03, p.y);
          if (Math.hypot(x - p.x, z - p.z) > .01 || p.y < game.map.terrain.heightAt(p.x, p.z)) { b.occluded = true; break; }
        }
      }
      b.sprite.element.style.opacity = b.occluded ? '0' : String(Math.min(1, b.age / .1, (2.6 - b.age) / .5));
    }
    if (bubbles.length || wasRendered) renderer.render(scene, game.engine.camera);
    wasRendered = bubbles.length > 0;
  }, 'late');
  return { open: () => open(), close, react, get opened() { return opened; } };
}
