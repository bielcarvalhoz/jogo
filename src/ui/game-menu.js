import { controlsGuide } from './controls-guide.js';
import { VOLUME_KEYS } from '../core/index.js';

/** Secondary controls keep their original handlers when moved into this tray. */
export function createGameMenu(game, { exit, resume, setTouch }) {
  const $ = id => document.getElementById(id), hud = $('hud');
  const trigger = document.createElement('button');
  trigger.id = 'actions-toggle'; trigger.type = 'button'; trigger.innerHTML = '<svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#more" /></svg>';
  trigger.setAttribute('aria-label', 'Mais ações'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', 'more-actions');
  const tray = document.createElement('section'); tray.id = 'more-actions'; tray.hidden = true;
  tray.setAttribute('aria-label', 'Mais ações');
  tray.innerHTML = '<header><b>Mais ações</b><button id="actions-close" aria-label="Fechar mais ações"><svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#close" /></svg></button></header><div class="actions-grid"></div>';
  hud.append(trigger, tray);
  const grid = tray.querySelector('.actions-grid');
  for (const [id, label] of [['btn-color', 'Trocar tinta'], ['btn-holster', 'Guardar / equipar'], ['btn-reactions', 'Interações'], ['btn-camera', 'Câmera'], ['btn-fly', 'Voar / pousar'], ['mp-ranking-button', 'Ranking']]) {
    const button = $(id); if (!button) continue;
    button.classList.remove('only-touch'); button.classList.add('action-tile');
    const caption = document.createElement('span'); caption.className = 'action-caption'; caption.textContent = label;
    button.append(caption); grid.append(button);
  }
  // Meaningful details remain available without a permanently empty HUD box.
  for (const selector of ['.compact-location', '.combat-status']) {
    const element = document.querySelector(selector); if (element) tray.append(element);
  }
  let actionsOpen = false;
  function setActions(value) {
    actionsOpen = !!value && !!game.mode && !dialog.open;
    tray.hidden = !actionsOpen; trigger.setAttribute('aria-expanded', String(actionsOpen));
    game.player.setWeaponWheelOpen(actionsOpen);
    game.paintball.resetInput();
    document.body.classList.toggle('actions-open', actionsOpen);
    if (actionsOpen) { game.player.releasePointerForUI(); document.body.classList.remove('playing'); $('actions-close').focus({ preventScroll: true }); }
    else if (game.player.active && !dialog.open) document.body.classList.add('playing');
  }
  trigger.addEventListener('click', () => setActions(!actionsOpen));
  $('actions-close').addEventListener('click', () => { setActions(false); trigger.focus({ preventScroll: true }); });
  // Close before existing click handlers run, so the chosen action can execute.
  grid.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && button.id !== 'btn-color') setActions(false);
  }, true);
  document.addEventListener('pointerdown', event => { if (actionsOpen && !tray.contains(event.target) && !trigger.contains(event.target)) setActions(false); });

  const dialog = document.createElement('dialog'); dialog.id = 'game-menu';
  dialog.setAttribute('aria-labelledby', 'game-menu-title');
  dialog.innerHTML = `<header><div><small id="game-menu-mode"></small><h2 id="game-menu-title">Seu jogo</h2></div><button id="game-menu-close" aria-label="Continuar jogando"><svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#close" /></svg></button></header>
    <p id="game-menu-description"></p><div class="game-menu-settings">
    <label>Câmera<select id="session-camera"><option value="third">Terceira pessoa</option><option value="first">Primeira pessoa</option></select></label>
    <label>Controles na tela<input id="session-touch" type="checkbox" /></label>
    ${[['masterVolume', 'Volume master'], ['musicVolume', 'Música / ambiente'], ['effectsVolume', 'Efeitos sonoros']].map(([key, label]) => `<label class="audio-volume" for="session-${key}"><span>${label} <output id="session-${key}-value">100%</output></span><input id="session-${key}" type="range" min="0" max="100" step="1" value="100" /></label>`).join('')}
    </div><div id="session-mode-actions"></div>${controlsGuide}<footer><button id="game-menu-resume">Continuar jogando</button><button id="game-menu-exit">Voltar ao menu principal</button></footer>`;
  document.body.append(dialog);
  function close(continueGame = true) {
    if (!dialog.open) return;
    dialog.close(); document.body.classList.remove('session-menu-open');
    game.player.setWeaponWheelOpen(false); game.paintball.resetInput();
    if (continueGame) resume();
  }
  function open() {
    if (!game.mode || dialog.open) return;
    setActions(false); game.ui?.reactions.close();
    if (game.mode !== 'tour' && !game.player.active) game.player.start(game.player.touchMode, { pointerLock: false });
    game.player.releasePointerForUI(); game.player.setWeaponWheelOpen(true); game.paintball.resetInput();
    game.tour.controls.enabled = false;
    document.body.classList.remove('playing'); document.body.classList.add('session-menu-open');
    const names = { training: 'Modo treino', campaign: 'Modo treta · Um jogador', multiplayer: 'Modo treta · Multijogador', tour: 'Modo tour' };
    $('game-menu-mode').textContent = names[game.mode];
    $('game-menu-description').textContent = game.mode === 'multiplayer' ? 'Ajuste seus controles. A sala continua em andamento.' : 'Ajuste seu jogo e continue de onde parou.';
    $('session-camera').value = game.player.cameraMode;
    $('session-touch').checked = game.player.touchMode;
    dialog.dataset.mode = game.mode;
    for (const key of VOLUME_KEYS) { $('session-' + key).value = $(key).value; $('session-' + key + '-value').textContent = `${$(key).value}%`; }
    const modeActions = $('session-mode-actions'); modeActions.replaceChildren();
    if (game.mode === 'training') {
      const lab = document.createElement('button'); lab.textContent = 'Laboratório de treino';
      lab.addEventListener('click', () => { close(); game.ui.combatHUD.setOpen(true); }); modeActions.append(lab);
    }
    dialog.showModal(); $('game-menu-resume').focus();
  }
  $('session-camera').addEventListener('change', () => { $('camera-mode').value = $('session-camera').value; $('camera-mode').dispatchEvent(new Event('change')); });
  $('session-touch').addEventListener('change', () => setTouch($('session-touch').checked));
  for (const key of VOLUME_KEYS) $('session-' + key).addEventListener('input', () => {
    $(key).value = $('session-' + key).value; $(key).dispatchEvent(new Event('input'));
    $('session-' + key + '-value').textContent = `${$(key).value}%`;
  });
  $('game-menu-close').addEventListener('click', () => close()); $('game-menu-resume').addEventListener('click', () => close());
  $('game-menu-exit').addEventListener('click', () => { close(false); exit(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  game.events.on('modechange', mode => {
    setActions(false); close(false);
    $('btn-fly').hidden = !['campaign'].includes(mode);
    $('mp-ranking-button').hidden = mode !== 'multiplayer';
  });
  function openControls() { open(); $('session-controls').open = true; $('session-controls').scrollIntoView({ block: 'nearest' }); }
  return { open, close, openControls, setActions, get paused() { return dialog.open; }, get actionsOpen() { return actionsOpen; } };
}
