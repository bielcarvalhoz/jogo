import { loadSettings, saveSettings } from '../core/index.js';

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
  complete() { paintProgress(100); $('loading-text').textContent = 'Cidade pronta. Escolha seu caminho.'; $('loading').querySelector('small').textContent = 'Pronto para explorar a Cidade de Deus.'; },
  error(err) {
    failed = true;
    console.error(err);
    const msg = `Erro ao carregar: ${err.message}. Recarregue a página para tentar novamente.`;
    $('loading-text').textContent = msg;
    $('loading').classList.add('error');
  },
};

/** Bind the menu before any network or 3D construction begins. */
export function createFrontMenu() {
  failed = false; progress = 0;
  document.body.classList.add('intro-playing');
  const endIntro = () => { document.body.classList.remove('intro-playing'); $('intro-skip').hidden = true; };
  const introTimer = setTimeout(endIntro, 2200);
  $('intro-skip').addEventListener('click', () => { clearTimeout(introTimer); endIntro(); });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { clearTimeout(introTimer); endIntro(); }
  const settings = loadSettings();
  $('graphics').value = settings.quality; $('surroundings').value = settings.surroundings;
  let game = null;
  const modeButtons = [$('play'), $('tour')];
  for (const button of modeButtons) { button.disabled = true; button.setAttribute('aria-describedby', 'loading-text'); }
  const settingsPanel = $('settings-panel'), options = document.querySelector('.menu-options');
  const showSettings = on => {
    endIntro();
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
    saveSettings({ quality: $('graphics').value, surroundings: $('surroundings').value });
    restartDialog.close(); location.reload();
  });
  const selectMode = (mode, touch) => {
    if (failed || !game) return;
    game.ui.startMode(mode, touch);
  };
  for (const [id, mode] of [['play', 'campaign'], ['tour', 'tour']]) {
    let pointerType = '';
    $(id).addEventListener('pointerdown', e => { pointerType = e.pointerType; });
    // Commit navigation on the click, after the touch gesture has completed.
    // Hiding this button on pointerup can retarget its compatibility click to
    // a newly revealed tour marker underneath, accidentally focusing a building.
    $(id).addEventListener('click', e => {
      const type = e.pointerType || (e.detail ? pointerType : '');
      selectMode(mode, type === 'touch' || type === 'pen' || document.body.classList.contains('touch'));
    });
  }
  return {
    settings,
    ready(context) {
      game = context; loading.complete();
      for (const button of modeButtons) { button.disabled = false; button.removeAttribute('aria-describedby'); }
    },
  };
}
