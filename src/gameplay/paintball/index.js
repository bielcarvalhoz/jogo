import { createPaintball } from './paintball.js';

// API pública da PISTOLINHA DE TINTA. Outros módulos importam SÓ daqui.
// Usa os elementos #paint-color, #paint-label, #paint-chip, #btn-color e #btn-fire do index.html.

export { PAINTBALL_PALETTE, PAINTBALL_LIMITS, PAINTBALL_WEAPONS } from './paintball.js';

export function createPaintballModule(game) {
  const { scene, camera, renderer } = game.engine;
  const $ = (id) => document.getElementById(id);
  const player = game.player;
  const paintEnabled = () => (player.active || game.debug.inspectionView === 'tinta') && !game.ui?.mapOpen;
  const paintball = createPaintball({ scene, camera, getActive: paintEnabled, onShot: weapon => game.audio?.shot(weapon) });

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
    paintball.setTrigger(pressed);
    $('btn-fire').classList.toggle('firing', paintball.firing);
  };
  player.bindFireButton($('btn-fire'), setTrigger);
  // Keyboard/screen-reader activation has no pointer gesture to hold.
  $('btn-fire').addEventListener('click', e => { if (e.detail === 0) paintball.shoot(); });
  const setAiming = value => {
    paintball.setAiming(value); player.setFocusedAim(paintball.aiming);
    document.body.classList.toggle('aiming', paintball.aiming);
    $('btn-aim').setAttribute('aria-pressed', String(paintball.aiming));
  };
  $('btn-aim').addEventListener('click', () => setAiming(!paintball.aiming));
  const syncWeapon = () => {
    $('weapon-icon')?.setAttribute('href', `./icons/controls.svg#${paintball.weapon.id}`);
    $('weapon-label').textContent = paintball.weapon.label.toUpperCase();
    $('weapon-mode').textContent = paintball.weapon.automatic ? 'AUTO · SEGURE PARA ATIRAR' : 'SEMIAUTO · UM TIRO POR TOQUE';
    $('btn-weapon').setAttribute('aria-label', `Arma: ${paintball.weapon.label}. Trocar arma de paintball`);
  };
  const nextWeapon = () => {
    if (!paintEnabled()) return;
    setTrigger(false); paintball.setWeapon((paintball.weaponIndex + 1) % paintball.weapons.length); syncWeapon();
  };
  syncWeapon();
  $('btn-weapon').addEventListener('click', nextWeapon);
  game.input.bind('KeyQ', nextWeapon, { label: 'trocar arma' });
  game.input.bind('KeyC', () => { nextPaintColor(); game.toast(`Tinta: ${paintball.color.label}`); }, { label: 'cor da tinta' });

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
    if (click && paintEnabled()) paintball.shoot();
  });
  const clearPaintPointer = () => {
    paintPointer = null; mouseHeld = false; setTrigger(false); setAiming(false); paintball.resetInput();
  };
  window.addEventListener('pointercancel', clearPaintPointer);
  window.addEventListener('blur', clearPaintPointer);
  window.addEventListener('resize', clearPaintPointer);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPaintPointer(); });
  player.events.addEventListener('unlock', clearPaintPointer);

  game.engine.addSystem((dt) => paintball.update(dt), 'world');
  return paintball;
}
