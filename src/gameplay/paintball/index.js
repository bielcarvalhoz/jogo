import { createPaintball } from './paintball.js';

// API pública da PISTOLINHA DE TINTA. Outros módulos importam SÓ daqui.
// Usa os elementos #paint-color, #paint-label, #paint-chip, #btn-color e #btn-fire do index.html.

export { PAINTBALL_PALETTE, PAINTBALL_LIMITS, PAINTBALL_WEAPONS } from './paintball.js';
export { loadWeaponModels } from './weapon-models.js';
export { createWeaponPickups } from './pickups.js';
export { createAmmoPickups } from './ammo-pickups.js';

export function createPaintballModule(game) {
  const { scene, camera, renderer } = game.engine;
  const $ = (id) => document.getElementById(id);
  const player = game.player;
  const paintEnabled = () => ((player.active && (player.touchMode || player.pointerLocked !== false)) || game.debug.inspectionView === 'tinta') && !game.ui?.mapOpen && !game.ui?.weaponWheelOpen && !game.ui?.combatHUD?.panelOpen && (game.combat?.canPlayerAct ?? true) && (game.multiplayer?.canAct ?? true);
  const paintball = createPaintball({
    scene, camera, getActive: paintEnabled, getVisible: () => player.active || game.debug.inspectionView === 'tinta',
    getCameraMode: () => player.cameraMode,
    colliderRoots: () => game.training?.active ? [game.training.floor, game.training.root, game.dynamicProps?.root].filter(Boolean) : [scene],
    traceActors: (from, to) => {
      const live = game.multiplayer?.active ? game.multiplayer.raycast(from, to) : game.combat?.raycast(from, to), corpse = game.ragdolls?.raycast(from, to);
      return corpse && (!live || corpse.distance < live.distance) ? corpse : live;
    },
    updateWeaponPose: (gun, state) => player.updateWeapon?.(gun, state),
    getShotOrigin: target => player.getShotOrigin ? player.getShotOrigin(target) : camera.getWorldPosition(target),
    onShot: (weapon, recoil) => { game.audio?.shot(weapon, { local: true }); player.avatar?.playShot(recoil?.recoilStrength); game.multiplayer?.attack(weapon, recoil); },
    onReload: (weapon, state) => {
      if (state.active) { player.avatar?.playReload?.(state.duration); game.audio?.reload?.(weapon, { ...state, position: () => player.eyePosition }); }
      else { player.avatar?.stopReload?.(); game.audio?.stopReload?.(); }
      if (state.active || state.cancelled) game.multiplayer?.reload?.(weapon.id, state.active);
    },
    onAttack: (weapon, state) => { game.audio?.melee?.(weapon, { position: player.eyePosition }); player.avatar?.playAttack?.(weapon, state); },
    onStrike: (weapon, info) => game.multiplayer?.attack(weapon, info),
    onImpact: (hit, info) => {
      if (hit.corpse) { game.audio?.hit?.(hit, info); game.ragdolls.impact(hit, info); return; }
      if (game.multiplayer?.active) return;
      game.audio?.hit?.(hit, info);
      if (!game.combat?.impact(hit, info)) game.dynamicProps?.impact(hit, info);
    },
  });
  let ammoMode = null;
  game.events.on('modechange', mode => {
    paintball.resetInput(); paintball.clearEffects();
    if (mode !== ammoMode) paintball.resetAmmo();
    ammoMode = mode;
  });
  game.events.on('combatreset', () => paintball.resetAmmo());
  game.events.on('multiplayerevent', event => { if (event.type === 'respawn' && event.player === game.multiplayer?.self?.id) paintball.resetAmmo(); });

  // cor da tinta (menu inicial + botão do HUD)
  const colorChoice = $('paint-color');
  colorChoice.replaceChildren(); colorChoice.disabled = false;
  for (const color of paintball.palette) {
    const option = document.createElement('option');
    option.value = color.id;
    option.textContent = color.label;
    colorChoice.appendChild(option);
  }
  const syncPaintColor = () => {
    const color = paintball.color;
    colorChoice.value = color.id;
    $('paint-label').textContent = color.label;
    $('btn-color').setAttribute('aria-label', `Tinta: ${color.label}. Trocar cor da tinta`);
    $('paint-chip').style.backgroundColor = color.color;
  };
  syncPaintColor();
  colorChoice.addEventListener('change', () => { paintball.setColor(colorChoice.value); syncPaintColor(); });
  const nextPaintColor = () => { paintball.setColor((paintball.colorIndex + 1) % paintball.palette.length); syncPaintColor(); };
  $('btn-color').addEventListener('click', nextPaintColor);
  const setTrigger = pressed => {
    if (pressed && game.combat?.trainingLab.interact()) return;
    paintball.setTrigger(pressed);
    $('btn-fire').classList.toggle('firing', paintball.firing);
  };
  player.bindFireButton($('btn-fire'), setTrigger);
  // Keyboard/screen-reader activation has no pointer gesture to hold.
  const shootOrInteract = () => { if (!game.combat?.trainingLab.interact()) paintball.shoot(); };
  $('btn-fire').addEventListener('click', e => { if (e.detail === 0) shootOrInteract(); });
  const setAiming = value => {
    paintball.setAiming(value); player.setFocusedAim(paintball.aiming);
    document.body.classList.toggle('aiming', paintball.aiming);
    $('btn-aim').setAttribute('aria-pressed', String(paintball.aiming));
  };
  $('btn-aim').addEventListener('click', () => setAiming(!paintball.aiming));
  const reload = () => { if (paintEnabled()) { paintball.reload(); setAiming(false); } };
  game.input.bind('KeyR', reload, { label: 'recarregar' });
  $('btn-reload').addEventListener('click', reload);
  game.engine.addSystem(() => {
    const ammo = paintball.ammo, button = $('btn-reload');
    $('ammo-hud').hidden = !ammo || paintball.holstered;
    button.hidden = !ammo; button.disabled = !ammo || ammo.reloading || ammo.loaded === ammo.capacity || ammo.reserve === 0 || paintball.holstered;
    if (!ammo) return;
    $('ammo-loaded').textContent = ammo.loaded; $('ammo-reserve').textContent = ammo.reserve;
    $('reload-status').textContent = ammo.reloading ? `${ammo.remaining.toFixed(1)}s` : '';
    $('reload-progress').style.setProperty('--reload-progress', ammo.progress);
    $('ammo-hud').classList.toggle('reloading', ammo.reloading);
    $('ammo-hud').classList.toggle('low-ammo', ammo.loaded <= Math.ceil(ammo.capacity * .2));
    button.setAttribute('aria-label', ammo.reloading ? 'Recarregando' : 'Recarregar · R');
  }, 'late');
  game.input.bind('KeyV', () => { nextPaintColor(); game.toast(`Tinta: ${paintball.color.label}`); }, { label: 'cor da tinta' });

  // Pistola: clique sem arrastar no fallback. Metralhadora: segurar também
  // dispara enquanto olha arrastando quando o navegador bloqueia pointer lock.
  let paintPointer = null;
  let mouseHeld = false;
  // Mouse button chords do not produce another pointerdown. Mouse events
  // report each button, so RMB aim + LMB fire work in either press order.
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (player.touchMode || !paintEnabled()) return;
    if (e.button === 2) { setAiming(true); e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (document.pointerLockElement === renderer.domElement || paintball.weapon.automatic) { mouseHeld = true; setTrigger(true); return; }
    paintPointer = { x: e.clientX, y: e.clientY, dragged: false };
  });
  window.addEventListener('mousemove', (e) => {
    if (paintPointer && Math.hypot(e.clientX - paintPointer.x, e.clientY - paintPointer.y) > 6) paintPointer.dragged = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (player.touchMode) return;
    if (e.button === 2) setAiming(false);
    if (e.button === 0 && mouseHeld) { mouseHeld = false; setTrigger(false); }
    if (!paintPointer || e.button !== 0) return;
    const click = !paintPointer.dragged && e.target === renderer.domElement;
    paintPointer = null;
    if (click && paintEnabled()) shootOrInteract();
  });
  const clearPaintPointer = () => {
    paintPointer = null; mouseHeld = false; setTrigger(false); setAiming(false); paintball.resetInput();
  };
  const toggleHolstered = () => {
    if (!player.active || !paintEnabled()) return;
    clearPaintPointer(); paintball.setHolstered(!paintball.holstered);
    game.toast(paintball.holstered ? 'Desarmado' : `Equipada: ${paintball.weapon.label}`);
  };
  game.input.bind('KeyZ', toggleHolstered, { label: 'desarmar / equipar novamente' });
  $('btn-holster').addEventListener('click', toggleHolstered);
  window.addEventListener('pointercancel', clearPaintPointer);
  window.addEventListener('blur', clearPaintPointer);
  window.addEventListener('resize', clearPaintPointer);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPaintPointer(); });
  player.events.addEventListener('unlock', clearPaintPointer);
  game.events.on('weaponwheel', clearPaintPointer);

  game.engine.addSystem((dt) => paintball.update(dt), 'world');
  return paintball;
}
