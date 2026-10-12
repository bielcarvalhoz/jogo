/** Mobile-sized live calibration; the compact receipt is readable in a print. */
export function createTrainingPosePanel(game) {
  const { player, paintball: paint } = game;
  const config = player.avatar.poseConfig, host = document.getElementById('hud');
  const el = (tag, text, id) => { const node = document.createElement(tag); if (text) node.textContent = text; if (id) node.id = id; return node; };
  const button = (text, id, action) => { const node = el('button', text, id); node.type = 'button'; node.addEventListener('click', action); return node; };
  let open = false, compact = false, target = 'weapon', signature = '', selectedInput;
  const toggle = button('Ajustar mãos / armas', 'btn-pose-debug', () => setOpen(true));
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'training-pose');
  const panel = el('section', '', 'training-pose'); panel.hidden = true;
  panel.setAttribute('aria-label', 'Configuração de armas e braços no treino');
  const header = el('div'); header.className = 'pose-header';
  const title = el('b', 'AJUSTES DO TREINO');
  const close = button('', 'pose-close', () => setOpen(false)); close.innerHTML = '<svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#close" /></svg>'; close.setAttribute('aria-label', 'Fechar ajustes');
  header.append(title, close);
  const identity = el('div', '', 'pose-identity');
  const controls = el('div'); controls.className = 'pose-editor';
  const selectors = el('div'); selectors.className = 'pose-selectors';
  function select(id, label, choices) {
    const wrapper = el('label', label), node = el('select', '', id);
    for (const [value, text] of choices) { const option = el('option', text); option.value = value; node.appendChild(option); }
    wrapper.appendChild(node); selectors.appendChild(wrapper); return node;
  }
  const weaponSelect = select('pose-weapon', 'Arma', paint.weapons.map(w => [w.id, w.label]));
  const viewSelect = select('pose-view', 'Câmera', [['first', '1ª pessoa'], ['third', '3ª pessoa']]);
  const targetSelect = select('pose-target', 'Editar', [['weapon', 'Arma nas mãos'], ['arms', 'Braços na câmera']]);
  const description = el('p', '', 'pose-description');
  const grid = el('div'); grid.className = 'pose-grid';
  for (const text of ['', 'X', 'Y', 'Z']) grid.appendChild(el('b', text));
  const inputs = [];
  for (const [group, label, step] of [['position', 'Pos. m', .01], ['rotation', 'Rot. °', 1], ['scale', 'Escala ×', .01]]) {
    grid.appendChild(el('span', label));
    for (const axis of ['x', 'y', 'z']) {
      const input = el('input', '', `pose-${group}-${axis}`);
      input.type = 'number'; input.step = String(step); input.inputMode = group === 'scale' ? 'decimal' : 'text';
      input.setAttribute('aria-label', `${label} ${axis.toUpperCase()}`);
      input.min = group === 'scale' ? '.1' : group === 'rotation' ? '-180' : '-1.5';
      input.max = group === 'scale' ? '3' : group === 'rotation' ? '180' : '1.5';
      input.addEventListener('focus', () => { selectedInput = input; nudgeLabel.textContent = `${label} ${axis.toUpperCase()}`; });
      input.addEventListener('input', () => {
        if (input.value === '' || !Number.isFinite(Number(input.value))) return;
        config.set(paint.weapon.id, player.cameraMode, target, group, axis, Number(input.value)); updateReceipt();
      });
      input.addEventListener('change', () => sync(true));
      input.dataset.group = group; input.dataset.axis = axis;
      inputs.push(input); grid.appendChild(input);
    }
  }
  const nudges = el('div'); nudges.className = 'pose-nudges';
  const nudgeLabel = el('span', 'Pos. m X', 'pose-nudge-label');
  function nudge(direction) {
    const input = selectedInput || inputs[0], { group, axis } = input.dataset;
    const value = config.get(paint.weapon.id, player.cameraMode, target)[group][axis];
    config.set(paint.weapon.id, player.cameraMode, target, group, axis, Math.round((value + Number(input.step) * direction) * 1000) / 1000);
    sync(true);
  }
  nudges.append(button('−', 'pose-minus', () => nudge(-1)), nudgeLabel, button('+', 'pose-plus', () => nudge(1)));
  const hint = el('small', 'Toque num valor e use − / +. Salvo neste navegador.');
  controls.append(selectors, description, grid, nudges, hint);
  const receipt = el('pre', '', 'pose-receipt');
  const actions = el('div'); actions.className = 'pose-actions';
  const print = button('Preparar print', 'pose-print', () => {
    compact = !compact; panel.classList.toggle('pose-compact', compact); print.textContent = compact ? 'Editar valores' : 'Preparar print';
  });
  const copy = button('Copiar config', 'pose-copy', async () => {
    const value = JSON.stringify(config.export(paint.weapon.id, player.cameraMode, target), null, 2);
    try { await navigator.clipboard.writeText(value); game.toast('Configuração copiada. Pode colar junto do print.'); }
    catch { game.toast('Use Preparar print: todos os valores aparecem no cartão.'); }
  });
  const reset = button('Restaurar', 'pose-reset', () => { config.reset(paint.weapon.id, player.cameraMode, target); sync(true); });
  actions.append(print, copy, reset); panel.append(header, identity, controls, receipt, actions); host.append(toggle, panel);
  // UI pointers never become camera/fire gestures. Native inputs/selects retain
  // their touch behavior; only the game's canvas handles looking and shooting.
  for (const node of [panel, toggle]) for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) node.addEventListener(type, e => e.stopPropagation());
  function updateReceipt() {
    const value = config.get(paint.weapon.id, player.cameraMode, target);
    const row = group => ['x', 'y', 'z'].map(axis => value[group][axis].toFixed(group === 'rotation' ? 1 : 3).padStart(7)).join(' ');
    identity.textContent = `${paint.weapon.label} · ${paint.weapon.id}\n${player.cameraMode === 'first' ? '1ª PESSOA' : '3ª PESSOA'} · ${target === 'arms' ? 'BRAÇOS / CÂMERA' : 'ARMA / MÃO DIREITA'} · v1`;
    receipt.textContent = `           X       Y       Z\nPos. m ${row('position')}\nRot. ° ${row('rotation')}\nEscala ${row('scale')}`;
  }
  function sync(force = false) {
    const allowed = game.mode === 'training';
    toggle.hidden = !allowed || open;
    if (!allowed && open) setOpen(false);
    if (!open) return;
    const next = `${paint.weapon.id}/${player.cameraMode}/${target}`;
    if (!force && signature === next) return;
    signature = next; weaponSelect.value = paint.weapon.id; viewSelect.value = player.cameraMode;
    if (player.cameraMode !== 'first' && target === 'arms') target = 'weapon';
    targetSelect.value = target;
    targetSelect.children[1].disabled = player.cameraMode !== 'first';
    const fists = paint.weapon.kind === 'unarmed';
    description.textContent = target === 'arms' ? 'Posição e rotação na câmera. Escala dos dois braços.' : fists ? 'Soco não tem modelo de arma. Selecione Braços na câmera para ajustar as mãos.' : 'Deslocamento relativo à mão direita, rotação XYZ e escala a partir do encaixe padrão.';
    for (const input of inputs) { input.value = config.get(paint.weapon.id, player.cameraMode, target)[input.dataset.group][input.dataset.axis]; input.disabled = fists && target === 'weapon'; }
    reset.disabled = fists && target === 'weapon'; updateReceipt();
  }
  function setOpen(value) {
    open = !!value && game.mode === 'training'; panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) { player.releasePointerForUI?.(); paint.setTrigger(false); }
    game.events.emit('posegui', open); sync(true);
  }
  weaponSelect.addEventListener('change', () => {
    if (weaponSelect.value === 'fists') { paint.setWeapon('fists'); target = 'arms'; player.setCameraMode('first'); }
    else if (paint.inventory.slots.includes(weaponSelect.value)) paint.setWeapon(weaponSelect.value);
    else paint.pickupWeapon(weaponSelect.value);
    sync(true);
  });
  viewSelect.addEventListener('change', () => { player.setCameraMode(viewSelect.value); sync(true); });
  targetSelect.addEventListener('change', () => { target = targetSelect.value; sync(true); });
  game.events.on('modechange', () => { setOpen(false); sync(true); });
  player.events.addEventListener('cameramode', () => sync(true));
  game.input.bind('KeyB', () => setOpen(!open), { label: 'ajustes de braços e armas no treino' });
  game.engine.addSystem(() => sync(), 'late'); sync();
  return { setOpen, sync, get open() { return open; } };
}
