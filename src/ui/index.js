import { IS_TOUCH } from '../core/index.js';
import { createHud } from './hud.js';
import './style.css';

// API pública da INTERFACE. Outros módulos importam SÓ daqui.
// Para mostrar um aviso, módulos chamam game.toast('...') (evento 'toast'), sem importar a UI.

const $ = (id) => document.getElementById(id);
const updateOrientation = () => document.body.classList.toggle('portrait', innerHeight > innerWidth);

/** classes do <body> conforme o aparelho (antes de qualquer coisa aparecer) */
export function applyDeviceClasses() {
  document.body.classList.toggle('touch', IS_TOUCH);
  updateOrientation();
}

/** tela de carregamento */
export const loading = {
  async status(msg) {
    $('loading-text').textContent = msg;
    // deixa o navegador pintar a mensagem (sem travar se a aba estiver em segundo plano)
    await new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 50); });
  },
  error(err) {
    console.error(err);
    $('loading-text').textContent = 'Erro ao carregar: ' + err.message;
    $('loading').classList.add('error');
  },
};

export function createUI(game) {
  const { map, player, engine } = game;
  const overlay = $('overlay'), mapPanel = $('map-panel'), help = $('help');
  const places = game.places;

  const hud = createHud({
    groundCanvas: map.ground.canvas,
    bounds: map.terrain.bounds,
    footprints: map.footprints,
    quarter: map.world.quarter,
    proj: map.proj,
    terrain: map.terrain,
    streetAt: map.roads.streetAt,
    places,
  });
  engine.addSystem((dt, t) => hud.update(t, dt, player.feet, player.yaw, player.fly), 'late');

  // ---------------------------------------------------------------- menu inicial
  const c = game.campus?.stats, s = map.stats;
  $('stat-line').textContent =
    `${c ? c.buildings + ' prédios no núcleo Cidade de Deus · ' + c.trees + ' árvores no campus · ' + c.cars + ' carros · ' : ''}${s.osmBuildings} prédios do OSM · ${s.procedural} procedurais · ${s.roads} vias · relevo ${s.minAlt.toFixed(0)}–${s.maxAlt.toFixed(0)} m`;
  $('places-list').innerHTML = places.map((p, i) => `<li><button data-i="${i}"><kbd class="only-desktop">${i + 1}</kbd>${p.name}</button></li>`).join('');

  // ---------------------------------------------------------------- avisos
  const toast = (msg) => {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 1800);
  };
  game.events.on('toast', toast);

  // ---------------------------------------------------------------- iniciar / pausar
  // mouse/teclado usa pointer lock; toque entra em tela cheia deitada
  let touchSession = IS_TOUCH, lastTouchUp = 0;
  const startGame = async (touch) => {
    touchSession = touch;
    if (touch) {
      document.body.classList.add('touch');
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* iOS não suporta */ }
      try { await screen.orientation?.lock?.('landscape'); } catch { /* só funciona em tela cheia (Android) */ }
    }
    player.start(touch);
  };
  const isTouchEvent = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
  $('play').addEventListener('pointerup', (e) => { if (isTouchEvent(e)) { lastTouchUp = Date.now(); startGame(true); } });
  $('play').addEventListener('click', () => { if (Date.now() - lastTouchUp > 800) startGame(false); });
  $('places-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const p = places[+b.dataset.i];
    player.placeAt(p.x, p.z, p.yaw);
    startGame(isTouchEvent(e) || touchSession);
    toast(`Teletransportado: ${p.name}`);
  });
  player.events.addEventListener('lock', (e) => {
    overlay.classList.add('hidden');
    mapPanel.classList.remove('open');
    if (e.detail.touch) toast('Arraste para olhar · toque duas vezes para voar');
    else if (e.detail.dragMode) toast('Modo arrastar: segure o botão do mouse e arraste para olhar');
  });
  player.events.addEventListener('fly', (e) => {
    document.body.classList.toggle('flying', e.detail.flying);
    toast(e.detail.flying ? '✈ Voando — olhe para baixo para descer · toque 2× para parar' : 'Pousando');
  });
  player.events.addEventListener('unlock', () => { if (!mapPanel.classList.contains('open')) overlay.classList.remove('hidden'); });

  // ---------------------------------------------------------------- mapa grande
  const openMap = () => { mapPanel.classList.add('open'); overlay.classList.add('hidden'); player.stop(); };
  const closeMap = (relock) => { mapPanel.classList.remove('open'); if (relock) startGame(touchSession); else overlay.classList.remove('hidden'); };
  $('btn-map').addEventListener('click', () => openMap());
  $('btn-menu').addEventListener('click', () => player.stop());
  $('bigmap').addEventListener('click', (e) => {
    const w = hud.bigMapToWorld(e.clientX, e.clientY);
    if (!w) return;
    player.placeAt(w[0], w[1], player.yaw);
    closeMap(true);
  });
  $('map-close').addEventListener('click', () => closeMap(true));

  // ---------------------------------------------------------------- atalhos da interface
  game.input.bind('KeyM', () => (mapPanel.classList.contains('open') ? closeMap(true) : openMap()), { when: 'always', label: 'mapa' });
  game.input.bind('Escape', () => { if (mapPanel.classList.contains('open')) closeMap(false); }, { when: 'always' });
  game.input.bind('KeyH', () => help.classList.toggle('hidden'), { label: 'esconder ajuda' });
  for (let n = 1; n <= 9; n++) {
    const go = () => {
      const p = places[n - 1];
      if (!p) return;
      player.placeAt(p.x, p.z, p.yaw);
      toast(`Teletransportado: ${p.name}`);
    };
    game.input.bind(`Digit${n}`, go, { label: n === 1 ? 'teletransporte (1–9)' : '' });
    game.input.bind(`Numpad${n}`, go);
  }

  // celular em pé: pausa (o aviso de girar aparece por cima)
  addEventListener('resize', () => {
    updateOrientation();
    if (document.body.classList.contains('touch') && innerHeight > innerWidth && player.active) player.stop();
  });

  return {
    toast,
    hud,
    get mapOpen() { return mapPanel.classList.contains('open'); },
    /** troca a tela de carregamento pelo menu inicial */
    showMenu() {
      $('loading').classList.add('hidden');
      overlay.classList.remove('hidden');
    },
  };
}
