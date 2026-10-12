/** Training-only feedback and an accessible counterpart to the physical console. */
export function createCombatHUD(game) {
  if (!game.combat) return null;
  const combat = game.combat, simulation = combat.simulation, lab = combat.trainingLab;
  const root = document.createElement('section'); root.id = 'combat-hud'; root.hidden = true;
  root.innerHTML = `<div class="combat-status"><small>TREINO</small>
    <div class="combat-health"><b id="combat-hp"></b><span id="combat-score"></span></div>
    <div class="combat-health-track"><i id="combat-health-fill"></i></div>
    <div data-collapsible><button class="collapse-toggle" data-collapse-toggle aria-expanded="false" aria-controls="combat-details">Placar <span class="collapse-chevron" aria-hidden="true">⌄</span></button><div id="combat-details" class="collapse-body" inert><div class="collapse-inner"><p id="combat-population"></p><p id="combat-goal"></p><button id="combat-lab-toggle" aria-expanded="false" aria-controls="combat-lab-panel">Laboratório <kbd>J</kbd></button></div></div></div></div>
    <div id="combat-hit" hidden role="status"></div><div id="combat-respawn" hidden role="status"></div>
    <button id="combat-interact" hidden></button>
    <div id="combat-lab-panel" hidden aria-label="Laboratório de combate">
      <div class="combat-lab-heading"><b>LABORATÓRIO</b><button id="combat-lab-close" aria-label="Fechar laboratório"><svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#close" /></svg></button></div>

      <div id="combat-lab-actions"></div>
      <button id="combat-mark-point">Marcar ponto na direção da mira · G</button>
      <details class="menu-help"><summary>Regras de dano</summary><small>Modo 1/2/4 — humano: cabeça 1 · tórax 2 · membros 4.<br>Zumbi: cabeça 1 · tórax 4 · membros 8.<br>Dano por arma usa o catálogo. Headshots seguem letais.<br>Botões físicos na bancada à esquerda. Anéis azuis indicam aliados.</small></details>
    </div>`;
  document.getElementById('hud').append(root);
  const $ = id => document.getElementById(id), toggle = $('combat-lab-toggle'), panel = $('combat-lab-panel');
  const hit = $('combat-hit'), respawn = $('combat-respawn'), interact = $('combat-interact');
  const actionButtons = new Map(); let open = false, hitUntil = -Infinity, hurtUntil = -Infinity;
  for (const record of lab.buttons) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.action = record.id; button.textContent = record.label;
    button.addEventListener('click', () => { lab.execute(record.id); sync(); });
    $('combat-lab-actions').append(button); actionButtons.set(record.id, button);
  }
  function setOpen(value) {
    open = !!value && game.training.active && combat.canPlayerAct; panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    if (open) { game.player.releasePointerForUI?.(); game.paintball.resetInput(); game.ui?.posePanel?.setOpen(false); }
  }
  toggle.addEventListener('click', () => setOpen(!open)); $('combat-lab-close').addEventListener('click', () => setOpen(false));
  interact.addEventListener('click', () => lab.interact());
  $('combat-mark-point').addEventListener('click', () => { setOpen(false); combat.markAimPoint(); combat.setZombieGoal('point'); });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) root.addEventListener(type, e => e.stopPropagation());
  game.input.bind('KeyJ', () => setOpen(!open), { label: 'laboratório de combate no treino' });
  const regionLabel = { head: 'Cabeça', thorax: 'Tórax', limb: 'Membro' };
  game.events.on('combatdamage', event => {
    if (event.source === combat.player) {
      hit.textContent = `${regionLabel[event.region]} · ${Math.round(event.damage)} dano${event.remaining <= 0 ? ' · KILL' : ''}`;
      hit.dataset.killed = String(event.remaining <= 0); hitUntil = simulation.time + 1.3;
    }
    if (event.victim === combat.player) hurtUntil = simulation.time + .2;
  });
  game.events.on('combatdeath', event => {
    if (event.victim === combat.player) game.paintball.resetInput();
    if (event.victim === combat.objective) game.toast('Objeto destruído. Use Reiniciar treino ou Defender objeto.');
  });
  game.events.on('combatreset', () => { hitUntil = hurtUntil = -Infinity; });
  game.events.on('modechange', () => { setOpen(false); sync(); });
  function sync() {
    const active = game.mode === 'training'; root.hidden = !active; if (!active) return;
    const player = combat.player, hp = player.health, alive = [...simulation.actors].filter(e => !e.dead);
    $('combat-hp').textContent = `VIDA ${Math.ceil(hp.current)} / ${hp.max}`;
    $('combat-health-fill').style.width = `${hp.current / hp.max * 100}%`;
    $('combat-score').textContent = `${player.stats.kills} K · ${player.stats.deaths} M · ${player.stats.headshots} HS`;
    $('combat-population').textContent = `${alive.filter(e => e.kind === 'zombie').length} zumbis · ${alive.filter(e => e.kind === 'human' && e.role !== 'ally').length} bots · ${alive.filter(e => e.role === 'ally').length} aliados${simulation.pausedAI ? ' · IA pausada' : ''}`;
    $('combat-goal').textContent = simulation.zombieGoal === 'objective' ? `Defender objeto: ${Math.ceil(combat.objective.health.current)} / ${combat.objective.health.max}`
      : simulation.zombieGoal === 'point' ? 'Zumbis → ponto amarelo · Y para mover' : 'Zumbis → personagens';
    hit.hidden = simulation.time >= hitUntil;
    root.classList.toggle('combat-hurt', simulation.time < hurtUntil);
    respawn.hidden = !player.dead;
    if (player.dead) respawn.textContent = `Você morreu · volta em ${Math.max(1, Math.ceil(simulation.rules.respawnSeconds - (simulation.time - player.dead.at)))}s`;
    const focus = lab.focused; interact.hidden = !focus || open || !!player.dead;
    if (focus) interact.textContent = `${game.player.touchMode ? 'Acionar' : 'E / atacar'} · ${focus.label}`;
    for (const record of lab.buttons) actionButtons.get(record.id).textContent = record.label;
  }
  game.engine.addSystem(sync, 'late'); sync();
  return { root, sync, setOpen, get panelOpen() { return open; } };
}
