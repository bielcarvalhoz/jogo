/** Training feedback and interaction prompt for the physical console. */
export function createCombatHUD(game) {
  if (!game.combat) return null;
  const combat = game.combat, simulation = combat.simulation, lab = combat.trainingLab;
  const root = document.createElement('section'); root.id = 'combat-hud'; root.hidden = true;
  root.innerHTML = `<div class="combat-status"><small>TREINO</small>
    <div class="combat-health"><b id="combat-hp"></b><span id="combat-score"></span></div>
    <div class="combat-health-track"><i id="combat-health-fill"></i></div>
    <div data-collapsible><button class="collapse-toggle" data-collapse-toggle aria-expanded="false" aria-controls="combat-details">Placar <span class="collapse-chevron" aria-hidden="true">⌄</span></button><div id="combat-details" class="collapse-body" inert><div class="collapse-inner"><p id="combat-population"></p><p id="combat-goal"></p></div></div></div></div>
    <div id="combat-hit" hidden role="status"></div><div id="combat-respawn" hidden role="status"></div>
    <button id="combat-interact" hidden></button>`;
  document.getElementById('hud').append(root);
  const $ = id => document.getElementById(id);
  const hit = $('combat-hit'), respawn = $('combat-respawn'), interact = $('combat-interact');
  let hitUntil = -Infinity, hurtUntil = -Infinity;
  interact.addEventListener('click', () => lab.interact());
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) root.addEventListener(type, e => e.stopPropagation());
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
  game.events.on('modechange', sync);
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
    const focus = lab.focused; interact.hidden = !focus || !!player.dead;
    if (focus) interact.textContent = `${game.player.touchMode ? 'Acionar' : 'E / atacar'} · ${focus.label}`;
  }
  game.engine.addSystem(sync, 'late'); sync();
  return { root, sync };
}
