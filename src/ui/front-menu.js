import { loadSettings, saveSettings, createAudio, createCharacterStore, IS_TOUCH, VOLUME_KEYS } from '../core/index.js';

import { startIntro } from './intro.js';

const $ = id => document.getElementById(id);
let progress = 0, failed = false;
function paintProgress(value) {
  progress = Math.round(Math.max(progress, Math.min(100, value)));
  // One value drives both the number and the fill, including Safari. No native
  // progress rendering or delayed CSS width transition can desynchronise them.
  document.querySelectorAll('[data-load-progress]').forEach(el => {
    el.setAttribute('aria-valuenow', progress);
    el.querySelector('.load-fill').style.transform = `scaleX(${progress / 100})`;
  });
  document.querySelectorAll('[data-progress-label]').forEach(el => { el.textContent = `${Math.round(progress)}%`; });
}

export const loading = {
  async status(msg, value = progress) {
    $('loading-text').textContent = msg;
    paintProgress(value);
    await new Promise(resolve => { requestAnimationFrame(() => setTimeout(resolve, 0)); setTimeout(resolve, 50); });
  },
  complete() { paintProgress(100); $('loading-text').textContent = 'Cidade pronta.'; },
  error(err) {
    failed = true;
    console.error(err);
    const msg = `Erro ao carregar: ${err.message}. Recarregue a página para tentar novamente.`;
    $('loading-text').textContent = msg;
    $('loading').classList.add('error');
  },
};

/** Bind the menu before any network or 3D construction begins. */
export function createFrontMenu({ trainingOnly = false } = {}) {
  failed = false; progress = 0;
  const intro = startIntro(), endIntro = intro.finish;
  if (trainingOnly) {
    endIntro();
    $('play').hidden = $('tour').hidden = true;
    $('characters-open').hidden = true;
    $('places-list').hidden = true;
    const placesTitle = document.querySelector('.places-title'); if (placesTitle) placesTitle.hidden = true;
    $('training').querySelector('b').textContent = 'Retomar treino com debug';
  }
  const settings = loadSettings();
  const characters = createCharacterStore();
  const audio = createAudio({ ...settings, base: import.meta.env?.BASE_URL || '/' });
  $('graphics').value = settings.quality; $('surroundings').value = settings.surroundings;
  for (const key of VOLUME_KEYS) {
    const enabled = key === 'musicVolume' ? settings.music : key === 'effectsVolume' ? settings.effects : true;
    $(key).value = Math.round((enabled ? settings[key] : 0) * 100);
    $(key + '-value').textContent = `${$(key).value}%`;
    $(key).addEventListener('input', () => {
      settings[key] = Number($(key).value) / 100;
      if (key === 'musicVolume') settings.music = true;
      if (key === 'effectsVolume') settings.effects = true;
      $(key + '-value').textContent = `${$(key).value}%`;
      audio.setPreferences(settings); saveSettings(settings);
    });
  }
  // Browser autoplay rules: the first real interaction unlocks the one context.
  document.addEventListener?.('pointerdown', () => { void audio.unlock(); }, {capture:true});
  document.addEventListener?.('keydown', () => { void audio.unlock(); }, {capture:true});
  document.addEventListener?.('visibilitychange', () => { void audio.setHidden(document.hidden); });
  document.addEventListener?.('click', e => {
    const button = e.target.closest?.('button, summary');
    if (!button || button.disabled || button.id === 'btn-fire') return;
    audio.ui(/back|close|cancel|menu/.test(button.id) ? 'back' : /play|tour$|training$/.test(button.id) ? 'start' : 'select');
  });
  document.addEventListener?.('change', () => audio.ui('confirm'));
  document.addEventListener?.('pointerover', e => {
    const button = e.target.closest?.('#overlay button, #tour-panel button, #map-panel button');
    if (e.pointerType === 'mouse' && button && !button.disabled && !button.contains(e.relatedTarget)) audio.ui();
  });
  document.addEventListener?.('focusin', e => {
    if (e.target.matches?.('#overlay button, #tour-panel button, #map-panel button') && !e.target.disabled) audio.ui();
  });
  let game = null;
  const modeButtons = [$('play'), $('training'), $('tour'), $('characters-open'), $('treta-multi')];
  for (const button of modeButtons) { button.disabled = true; button.setAttribute('aria-describedby', 'loading-text'); }
  const settingsPanel = $('settings-panel'), options = document.querySelector('.menu-options'), tretaMenu = $('treta-menu');
  const showTreta = on => {
    endIntro(); tretaMenu.classList.toggle('hidden', !on); options.classList.toggle('hidden', on);
    if (on) $('treta-single').focus();
  };
  const showSettings = on => {
    endIntro();
    tretaMenu.classList.add('hidden');
    $('overlay').classList.toggle('settings-open', on);
    settingsPanel.classList.toggle('hidden', !on); options.classList.toggle('hidden', on);
  };
  $('settings-open').addEventListener('click', () => showSettings(true));
  $('settings-back').addEventListener('click', () => showSettings(false));
  const restartDialog = $('settings-restart');
  const changed = () => $('graphics').value !== settings.quality || $('surroundings').value !== settings.surroundings;
  $('settings-apply').addEventListener('click', () => {
    if (!changed()) { showSettings(false); return; }
    $('restart-description').textContent = game
      ? 'A cidade precisa ser recarregada para aplicar gráficos ou entorno. Você voltará ao menu.'
      : 'A cidade está carregando. Aplicar gráficos ou entorno interrompe o carregamento atual e começa novamente.';
    restartDialog.showModal(); $('settings-cancel-restart').focus();
  });
  $('settings-cancel-restart').addEventListener('click', () => restartDialog.close());
  $('settings-confirm-restart').addEventListener('click', () => {
    saveSettings({ ...settings, quality: $('graphics').value, surroundings: $('surroundings').value });
    restartDialog.close(); location.reload();
  });
  const selectMode = (mode, touch) => {
    if (failed || !game) return;
    game.ui.startMode(mode, touch);
  };
  $('characters-open').addEventListener('click', () => { if (game && !trainingOnly) game.ui.characters.open(); });
  $('treta-back').addEventListener('click', () => { showTreta(false); $('play').focus(); });
  document.addEventListener?.('keydown', event => {
    if (event.code === 'Escape' && !tretaMenu.classList.contains('hidden') && !game?.ui?.characters.openState) showTreta(false);
  });
  for (const [id, mode] of [['play', 'treta'], ['treta-single', 'campaign'], ['treta-multi', 'multiplayer'], ['training', 'training'], ['tour', 'tour']]) {
    if (trainingOnly && mode !== 'training') continue;
    let pointerType = '';
    $(id).addEventListener('pointerdown', e => { pointerType = e.pointerType; });
    // Commit navigation on the click, after the touch gesture has completed.
    // Hiding this button on pointerup can retarget its compatibility click to
    // a newly revealed tour marker underneath, accidentally focusing a building.
    $(id).addEventListener('click', e => {
      const type = e.pointerType || (e.detail ? pointerType : '');
      if (mode === 'treta') { if (!failed && game) showTreta(true); return; }
      selectMode(mode, type === 'touch' || type === 'pen' || document.body.classList.contains('touch'));
    });
  }
  return {
    settings, characters, audio, introFinished: intro.finished,
    ready(context) {
      game = context; loading.complete();
      game.events?.on('menuopen', () => { showTreta(false); showSettings(false); });
      if (trainingOnly) {
        $('loading-text').textContent = 'Treino com debug pronto.';
      }
      for (const button of modeButtons) { button.disabled = trainingOnly && button !== $('training'); button.removeAttribute('aria-describedby'); }
      if (trainingOnly) selectMode('training', IS_TOUCH);
    },
  };
}
