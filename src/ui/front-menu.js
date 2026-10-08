import { loadSettings, saveSettings } from '../core/index.js';

const $ = id => document.getElementById(id);
let progress = 0, failed = false;
function paintProgress(value) {
  progress = Math.max(progress, Math.min(100, value));
  document.querySelectorAll('[data-load-progress]').forEach(el => { el.value = progress; });
  document.querySelectorAll('[data-progress-label]').forEach(el => { el.textContent = `${Math.round(progress)}%`; });
}

export const loading = {
  async status(msg, value = progress) {
    $('loading-text').textContent = msg; $('waiting-text').textContent = msg;
    paintProgress(value);
    await new Promise(resolve => { requestAnimationFrame(() => setTimeout(resolve, 0)); setTimeout(resolve, 50); });
  },
  complete() { paintProgress(100); $('loading-text').textContent = 'Cidade pronta. Escolha seu caminho.'; $('loading').querySelector('small').textContent = 'Pronto para explorar a Cidade de Deus.'; },
  error(err) {
    failed = true;
    console.error(err);
    const msg = `Erro ao carregar: ${err.message}. Recarregue a página para tentar novamente.`;
    $('loading-text').textContent = msg; $('waiting-text').textContent = msg;
    $('loading').classList.add('error');
  },
};

/** Bind the menu before any network or 3D construction begins. */
export function createFrontMenu() {
  const settings = loadSettings();
  $('graphics').value = settings.quality; $('surroundings').value = settings.surroundings;
  let game = null, pendingMode = null, pendingTouch = false;
  const settingsPanel = $('settings-panel'), options = document.querySelector('.menu-options');
  const showSettings = on => { settingsPanel.classList.toggle('hidden', !on); options.classList.toggle('hidden', on); };
  $('settings-open').addEventListener('click', () => showSettings(true));
  $('settings-back').addEventListener('click', () => showSettings(false));
  $('settings-apply').addEventListener('click', () => {
    const next = saveSettings({ quality: $('graphics').value, surroundings: $('surroundings').value });
    if (next.quality !== settings.quality || next.surroundings !== settings.surroundings) location.reload();
    else showSettings(false);
  });
  $('loading-back').addEventListener('click', () => {
    pendingMode = null; $('loading-wait').classList.add('hidden'); $('overlay').classList.remove('hidden');
  });
  const selectMode = (mode, touch) => {
    if (failed) return;
    if (game) { game.ui.startMode(mode, touch); return; }
    pendingMode = mode; pendingTouch = touch;
    $('overlay').classList.add('hidden'); $('loading-wait').classList.remove('hidden');
  };
  for (const [id, mode] of [['play', 'campaign'], ['tour', 'tour']]) {
    let lastTouch = 0;
    $(id).addEventListener('pointerup', e => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') { lastTouch = Date.now(); selectMode(mode, true); }
    });
    $(id).addEventListener('click', () => { if (Date.now() - lastTouch > 800) selectMode(mode, document.body.classList.contains('touch')); });
  }
  return {
    settings,
    ready(context) {
      game = context; loading.complete(); $('loading-wait').classList.add('hidden');
      if (pendingMode) { const mode = pendingMode; pendingMode = null; game.ui.startMode(mode, pendingTouch); }
    },
  };
}
