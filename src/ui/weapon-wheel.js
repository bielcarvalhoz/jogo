/** Four inventory directions: firearm 1, firearm 2, melee and free hands. */
export function weaponWheelIndex(x, y, count = 4, deadZone = 18) {
  if (!count || Math.hypot(x, y) < deadZone) return null;
  const angle = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return Math.round(angle / (Math.PI * 2 / count)) % count;
}

export function createWeaponWheel(game) {
  const $ = id => document.getElementById(id);
  const paint = game.paintball, player = game.player;
  const button = $('btn-weapon'), panel = $('weapon-wheel'), ring = $('weapon-wheel-ring');
  const options = $('weapon-wheel-options'), pickupButton = $('btn-pickup');
  const cursor = $('weapon-wheel-cursor');
  let owner = null, choices = [], pending = null, virtualX = 0, virtualY = 0;
  let signature = '', pickupSignature = '', pointerId = null, lastGesture = -Infinity;
  const canUse = () => player.active && !game.ui?.mapOpen && !game.ui?.reactions?.opened && !game.ui?.combatHUD?.panelOpen && (game.combat?.canPlayerAct ?? true) && (game.multiplayer?.canAct ?? true) && game.mode !== 'tour';
  const icon = weapon => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    svg.setAttribute('class', 'control-icon'); svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', `./icons/controls.svg#${weapon.icon || weapon.id}`); svg.appendChild(use);
    return svg;
  };
  const selection = () => pending === null ? choices.findIndex(w => w.id === paint.weapon.id) : pending;
  function highlight() {
    const selected = selection(), weapon = choices[selected] || paint.weapon;
    ring.dataset.selected = String(Math.max(0, selected));
    Array.from(options.children).forEach((el, i) => el.setAttribute('aria-selected', String(i === selected)));
    $('weapon-wheel-title').textContent = weapon.label;
    $('weapon-wheel-detail').textContent = '';
  }
  function move(x, y, deadZone = 18) {
    if (!owner) return;
    pending = weaponWheelIndex(x, y, choices.length, deadZone);
    const length = Math.hypot(x, y), scale = length ? Math.min(95, length) / length : 0;
    cursor.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
    highlight();
  }
  function movePointer(e) {
    const bounds = ring.getBoundingClientRect?.();
    if (bounds?.width) {
      const x = e.clientX - bounds.left - bounds.width / 2;
      const y = e.clientY - bounds.top - bounds.height / 2;
      // A short flick works from the HUD button; after reaching the circle,
      // the finger directly follows the visible sectors and center dead zone.
      if (owner.direct || Math.hypot(x, y) < bounds.width * .56) {
        owner.direct = true; move(x, y, bounds.width * .12); return;
      }
    }
    move(e.clientX - owner.x, e.clientY - owner.y);
  }
  function open(source) {
    if (owner || !canUse()) return false;
    choices = paint.availableWeapons.slice();
    owner = source; pending = null; virtualX = virtualY = 0;
    paint.resetInput(); paint.setTrigger(false); player.setFocusedAim(false);
    $('btn-fire').classList.toggle('firing', false);
    $('btn-aim').setAttribute('aria-pressed', 'false'); document.body.classList.toggle('aiming', false);
    player.setWeaponWheelOpen?.(true);
    game.events.emit('weaponwheel', true);
    options.replaceChildren();
    choices.forEach((weapon, i) => {
      const option = document.createElement('div'); option.className = 'weapon-wheel-option';
      option.setAttribute('role', 'option'); option.dataset.index = String(i);
      const label = document.createElement('b'); label.textContent = weapon.label;
      option.append(icon(weapon), label); options.appendChild(option);
    });
    panel.hidden = false; document.body.classList.toggle('weapon-wheel-open', true);
    button.setAttribute('aria-expanded', 'true');
    cursor.style.transform = 'translate(0px, 0px)'; highlight();
    return true;
  }
  function close(commit = false) {
    if (!owner) return;
    const selected = commit && canUse() && pending !== null ? choices[pending] : null;
    if (owner.type === 'pointer' || owner.type === 'button') lastGesture = performance.now();
    owner = null; pending = null;
    const captured = pointerId; pointerId = null;
    try { if (captured !== null && button.hasPointerCapture?.(captured)) button.releasePointerCapture(captured); } catch { /* detached pointer */ }
    panel.hidden = true; document.body.classList.toggle('weapon-wheel-open', false);
    button.setAttribute('aria-expanded', 'false'); player.setWeaponWheelOpen?.(false);
    paint.resetInput(); game.events.emit('weaponwheel', false);
    if (selected) paint.setWeapon(selected.id);
    syncWeaponButton();
  }
  function syncWeaponButton() {
    const next = `${paint.weapon.id}:${!!paint.holstered}`;
    if (signature === next) return;
    signature = next;
    $('weapon-icon').setAttribute('href', `./icons/controls.svg#${paint.holstered ? 'holster' : paint.weapon.icon || paint.weapon.id}`);
    $('weapon-label').textContent = paint.holstered ? 'DESARMADO' : paint.weapon.label.toUpperCase();
    $('weapon-mode').textContent = '';
    button.setAttribute('aria-label', `${paint.holstered ? 'Desarmado' : `Arma: ${paint.weapon.label}`}. Segure para abrir a roda: 2 armas de fogo, 1 melee e socos`);
    $('btn-holster').setAttribute('aria-pressed', String(!!paint.holstered));
    $('btn-holster').setAttribute('aria-label', paint.holstered ? `Equipar novamente: ${paint.weapon.label}` : 'Desarmar');
    $('btn-holster').title = 'Z · Desarmar / equipar novamente';
    $('btn-fire').disabled = $('btn-aim').disabled = !!paint.holstered;
    document.body.classList.toggle('holstered', !!paint.holstered);
    $('btn-fire').setAttribute('aria-label', paint.weapon.kind === 'firearm' ? 'Segurar para atirar; arrastar para mirar' : 'Segurar para atacar; arrastar para mirar');
    player.setFocusedAim(paint.aiming);
    document.body.classList.toggle('aiming', !!paint.aiming);
    $('btn-aim').setAttribute('aria-pressed', String(!!paint.aiming));
    document.body.classList.toggle('melee-equipped', paint.weapon.kind !== 'firearm');
  }
  function syncPickup() {
    const nearby = canUse() && !owner && !player.fly && !game.multiplayer?.nearby ? game.weaponPickups?.nearby : null;
    pickupButton.hidden = !nearby;
    if (!nearby) { pickupSignature = ''; return; }
    const definition = paint.weapons.find(w => w.id === nearby.weaponId);
    const inventory = paint.inventory;
    const selectedSlot = inventory.slots.indexOf(paint.weapon.id);
    const slot = definition?.kind === 'melee' ? 2 : selectedSlot >= 0 && selectedSlot < 2 ? selectedSlot : inventory.lastFirearmSlot;
    const next = `${nearby.id}:${nearby.weaponId}:${slot}:${inventory.slots.join(',')}`; if (next === pickupSignature) return;
    pickupSignature = next;
    const previous = paint.weapons.find(w => w.id === inventory.slots[slot]);
    $('pickup-label').textContent = `Pegar ${nearby.label || definition?.label || 'arma'}`;
    $('pickup-detail').textContent = `Slot ${slot + 1} · solta ${previous?.label || 'arma atual'}`;
    pickupButton.setAttribute('aria-label', `${$('pickup-label').textContent}. ${$('pickup-detail').textContent}`);
  }
  function pickup() {
    if (game.multiplayer?.nearby) return;
    if (game.combat?.trainingLab?.probe()) return;
    if (!canUse() || owner || player.fly) return;
    const result = game.weaponPickups?.pickup(); if (!result) return;
    syncWeaponButton(); syncPickup();
    game.toast(`Equipada no slot ${result.slot + 1}: ${paint.weapon.label}`);
  }
  button.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!open({ type: 'pointer', id: e.pointerId, x: e.clientX, y: e.clientY })) return;
    lastGesture = performance.now();
    pointerId = e.pointerId; button.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  button.addEventListener('pointermove', e => {
    if (owner?.type !== 'pointer' || owner.id !== e.pointerId) return;
    movePointer(e); e.preventDefault();
  });
  button.addEventListener('pointerup', e => {
    if (owner?.type !== 'pointer' || owner.id !== e.pointerId) return;
    e.preventDefault(); lastGesture = performance.now(); close(true);
  });
  window.addEventListener('pointerup', e => {
    if (owner?.type === 'pointer' && owner.id === e.pointerId) { e.preventDefault(); close(true); }
  }, true);
  window.addEventListener('pointercancel', e => {
    if (owner?.type === 'pointer' && owner.id === e.pointerId) close();
  }, true);
  window.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && e.isPrimary && owner?.type === 'pointer') close();
  }, true);
  for (const type of ['pointercancel', 'lostpointercapture']) button.addEventListener(type, e => {
    if (owner?.type === 'pointer' && owner.id === e.pointerId) close();
  });
  button.addEventListener('click', e => {
    e.preventDefault();
    if (e.pointerType === 'touch' || e.sourceCapabilities?.firesTouchEvents) return;
    // Screen readers can open the wheel, then use arrows and Enter.
    if (e.detail === 0 && !owner && pointerId === null && performance.now() - lastGesture > 500) open({ type: 'access' });
  });
  button.addEventListener('keydown', e => {
    if (!['Space', 'Enter'].includes(e.code) || e.repeat) return;
    e.preventDefault(); lastGesture = performance.now();
    if (owner?.type === 'access') { if (pending === null) pending = selection(); close(true); }
    else open({ type: 'button', code: e.code });
  });
  game.input.bind('KeyQ', e => { e.preventDefault(); open({ type: 'key' }); }, { label: 'segurar roda de armas' });
  for (let slot = 0; slot < 4; slot++) {
    const select = () => {
      if (!canUse()) return;
      close(); paint.setWeapon(slot === 3 ? 'fists' : paint.inventory.slots[slot]); syncWeaponButton();
    };
    game.input.bind(`Digit${slot + 1}`, select, { label: ['arma principal', 'arma secundária', 'arma branca', 'soco'][slot] });
    game.input.bind(`Numpad${slot + 1}`, select);
  }
  game.input.bind('KeyE', pickup, { label: 'pegar arma do chão' });
  pickupButton.addEventListener('click', pickup);
  window.addEventListener('keyup', e => {
    if ((owner?.type === 'key' && e.code === 'KeyQ') || (owner?.type === 'button' && e.code === owner.code)) {
      e.preventDefault(); close(true);
    }
  });
  window.addEventListener('keydown', e => {
    if (!owner) return;
    const vectors = { ArrowUp: [0, -70], ArrowRight: [70, 0], ArrowDown: [0, 70], ArrowLeft: [-70, 0] };
    if (vectors[e.code]) { e.preventDefault(); move(...vectors[e.code]); }
    if (e.code === 'Enter' && owner?.type === 'access') { e.preventDefault(); if (pending === null) pending = selection(); close(true); }
  });
  window.addEventListener('mousemove', e => {
    if (!owner || owner.type === 'pointer') return;
    const bounds = ring.getBoundingClientRect?.();
    if (!document.pointerLockElement && bounds?.width) {
      move(e.clientX - bounds.left - bounds.width / 2, e.clientY - bounds.top - bounds.height / 2, bounds.width * .12); return;
    }
    virtualX += e.movementX || 0; virtualY += e.movementY || 0; move(virtualX, virtualY);
  });
  player.events.addEventListener('joystick', e => {
    if (owner && e.detail.active) move(e.detail.x * 95, -e.detail.y * 95, 24);
  });
  const cancel = () => close();
  for (const type of ['blur', 'resize']) window.addEventListener(type, cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  player.events.addEventListener('unlock', cancel); game.events.on('modechange', cancel);
  game.engine.addSystem(() => {
    if (owner && !canUse()) close();
    if (owner && typeof navigator !== 'undefined' && navigator.getGamepads) {
      const pad = Array.from(navigator.getGamepads()).find(Boolean);
      if (pad && Math.hypot(pad.axes[0] || 0, pad.axes[1] || 0) > .25) move(pad.axes[0] * 95, pad.axes[1] * 95, 24);
    }
    syncWeaponButton(); syncPickup();
  }, 'late');
  syncWeaponButton(); syncPickup();
  return { get open() { return !!owner; }, cancel };
}
