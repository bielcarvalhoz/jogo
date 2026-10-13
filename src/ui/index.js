import { bindCollapsiblePanels } from './collapsible.js';
import * as THREE from 'three';
import { IS_TOUCH } from '../core/index.js';
import { createHud } from './hud.js';
import { placeMarker } from './marker-layout.js';
import { installGestureGuard } from './gestures.js';
import { createWeaponWheel } from './weapon-wheel.js';
import { createSniperScope } from './sniper-scope.js';
import { createTrainingPosePanel } from './training-pose.js';
import { createCombatHUD } from './combat-hud.js';
import { createCharacterMenu } from './character-menu.js';
import { createMultiplayerUI } from './multiplayer.js';
import { createReactions } from './reactions.js';
import { createGameMenu } from './game-menu.js';
import { createCombatFeedback } from './combat-feedback.js';
import './style.css';
import './game-menu.css';
import './creation.css';
import './combat-feedback.css';
import './reactions.css';

export { loading, createFrontMenu } from './front-menu.js';
const $ = id => document.getElementById(id);
const updateOrientation = () => document.body.classList.toggle('portrait', innerHeight > innerWidth);

export function applyDeviceClasses() {
  installGestureGuard();
  document.body.classList.toggle('touch', IS_TOUCH);
  document.body.classList.add('menu-open');
  updateOrientation();
}

export function createUI(game) {
  const { map, player, engine, tour, training } = game;
  const overlay = $('overlay'), mapPanel = $('map-panel');
  const points = game.mapPoints, places = game.places;
  let touchSession = IS_TOUCH;
  const weaponWheel = createWeaponWheel(game);
  const sniperScope = createSniperScope(game);
  const posePanel = game.debug.trainingOnly ? createTrainingPosePanel(game) : null;
  const combatHUD = createCombatHUD(game);
  const combatFeedback = createCombatFeedback(game);
  const characters = createCharacterMenu(game);
  const multiplayerUI = createMultiplayerUI(game);
  const reactions = createReactions(game);
  const sessionMenu = createGameMenu(game, { exit: showMenu, resume: resumeGame, setTouch(touch) {
    touchSession = touch; document.body.classList.toggle('touch', touch);
  } });
  function resumeGame() {
    game.audio?.setMenu(false);
    if (game.mode === 'tour') tour.controls.enabled = true;
    else if (walkingMode()) {
      player.start(touchSession, { pointerLock: game.mode !== 'multiplayer' || game.multiplayer.snapshot?.phase === 'running' });
      document.body.classList.add('playing');
    }
  }

  const toast = msg => {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  };
  game.events.on('toast', toast);

  const walkingMode = () => ['campaign', 'training', 'multiplayer'].includes(game.mode);
  function startWalking(mode, touch = touchSession) {
    game.audio?.setMenu(false);
    touchSession = touch; tour.stop();
    if (mode === 'training') training.start(); else training.stop();
    game.mode = mode;
    document.body.classList.remove('menu-open', 'tour-active');
    document.body.classList.toggle('training-active', mode === 'training');
    document.body.classList.toggle('multiplayer-active', mode === 'multiplayer');
    $('tour-panel').classList.add('hidden'); $('tour-markers').classList.add('hidden');
    overlay.classList.add('hidden'); mapPanel.classList.remove('open'); $('hud').classList.remove('hidden');
    if (touch) document.body.classList.add('touch');
    document.body.classList.toggle('flying', player.fly);
    $('btn-fly').setAttribute('aria-pressed', String(player.fly));
    game.events.emit('modechange', mode);
    player.start(touch, { pointerLock: mode !== 'multiplayer' || game.multiplayer.snapshot?.phase === 'running' });
  }

  function startCampaign(touch = touchSession) { startWalking('campaign', touch); }

  function startMode(mode, touch = IS_TOUCH, characterChosen = false) {
    if (game.debug.trainingOnly) mode = 'training';
    if (mode === 'multiplayer' && !game.multiplayer.network.session) { void multiplayerUI.open(touch); return; }
    if (!game.debug.trainingOnly && !characterChosen) {
      characters.open({ mode, onConfirm: () => startMode(mode, touch, true) }); return;
    }
    if (['campaign', 'training', 'multiplayer'].includes(mode)) { startWalking(mode, touch); return; }
    game.audio?.setMenu(false);
    game.mode = 'tour'; player.stop(); training.stop(); tour.start(); touchSession = touch;
    game.events.emit('modechange', 'tour');
    document.body.classList.remove('menu-open', 'training-active', 'flying'); document.body.classList.add('tour-active');
    overlay.classList.add('hidden'); mapPanel.classList.remove('open'); $('hud').classList.remove('hidden');
    $('tour-panel').classList.remove('hidden'); $('tour-markers').classList.remove('hidden');
    tour.setViewportInset(innerHeight - $('tour-panel').getBoundingClientRect().top + 12);
    $('tour-orbit').setAttribute('aria-pressed', String(tour.orbit));
  }

  function showMenu() {
    multiplayerUI.close();
    game.audio?.setMenu(true);
    game.mode = null; player.stop(); tour.stop(); training.stop();
    game.events.emit('modechange', null);
    document.body.classList.add('menu-open'); document.body.classList.remove('tour-active', 'training-active', 'multiplayer-active', 'flying');
    mapPanel.classList.remove('open'); overlay.classList.remove('hidden'); $('hud').classList.add('hidden');
    $('tour-panel').classList.add('hidden'); $('tour-markers').classList.add('hidden');
    game.events.emit('menuopen');
  }

  function selectPoint(point, world) {
    if (game.mode === 'training') return;
    if (game.mode === 'multiplayer') { toast('Na sala, vá a pé até o destino.'); closeMap(true); return; }
    if (game.mode === 'tour') {
      if (!point && world) {
        point = points.reduce((best, p) => !best || Math.hypot(p.x - world[0], p.z - world[1]) < Math.hypot(best.x - world[0], best.z - world[1]) ? p : best, null);
      }
      if (point) { closeMap(false); tour.focus(point); }
      return;
    }
    if (point) {
      player.placeAt(point.teleportX ?? point.x, point.teleportZ ?? point.z, point.yaw || 0);
      toast(`Teletransportado: ${point.name}`);
    } else if (world) player.placeAt(world[0], world[1], player.yaw);
    closeMap(true);
  }

  const hud = createHud({ groundCanvas: map.ground.canvas, bounds: map.terrain.bounds,
    footprints: map.footprints, quarter: map.world.quarter, proj: map.proj, terrain: map.terrain,
    streetAt: map.roads.streetAt, places: points, onSelect: selectPoint, getMode: () => game.mode, training, dynamicProps: game.dynamicProps });
  engine.addSystem((dt, t) => {
    sniperScope.update();
    if (game.mode) hud.update(t, dt, tour.active ? engine.camera.position : player.feet, player.yaw, player.fly);
  }, 'late');

  function syncCameraMode() {
    const third = player.cameraMode === 'third';
    $('camera-mode').value = player.cameraMode;
    $('btn-camera').setAttribute('aria-pressed', String(third));
    $('btn-camera').setAttribute('aria-label', `Câmera em ${third ? 'terceira' : 'primeira'} pessoa. Alternar câmera`);
    $('camera-icon').setAttribute('href', `./icons/controls.svg#${third ? 'camera-third' : 'camera-first'}`);
    $('btn-camera').title = `${third ? 'Terceira' : 'Primeira'} pessoa · X para alternar`;
  }
  function toggleCamera() {
    if (!walkingMode() || weaponWheel.open) return;
    player.toggleCameraMode();
    syncCameraMode();
    toast(`Câmera: ${player.cameraMode === 'third' ? 'terceira' : 'primeira'} pessoa`);
  }
  $('camera-mode').addEventListener('change', () => { player.setCameraMode($('camera-mode').value); syncCameraMode(); });
  $('btn-camera').addEventListener('click', toggleCamera);
  player.events.addEventListener('cameramode', syncCameraMode);
  player.setCameraMode($('camera-mode').value);
  syncCameraMode();
  game.input.bind('KeyX', toggleCamera, { label: 'primeira / terceira pessoa' });
  const syncCrouch = () => {
    $('btn-crouch').setAttribute('aria-pressed', String(player.crouched));
    $('btn-crouch').setAttribute('aria-label', player.crouched ? 'Levantar' : 'Agachar');
  };
  const toggleCrouch = () => {
    if (!walkingMode() || !player.active || weaponWheel.open || mapPanel.classList.contains('open') || player.fly) return;
    player.toggleCrouch(); syncCrouch(); toast(player.crouched ? 'Agachado' : 'Em pé');
  };
  $('btn-crouch').addEventListener('click', toggleCrouch);
  player.events.addEventListener('crouch', syncCrouch);
  game.input.bind('KeyC', toggleCrouch, { label: 'agachar / levantar' });
  syncCrouch();
  engine.renderer.domElement.addEventListener('wheel', event => {
    if (sniperScope.handleWheel(event)) return;
    if (walkingMode() && !mapPanel.classList.contains('open') && player.zoomOrbit(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1))) { event.preventDefault(); return; }
    if (!walkingMode() || !player.active || weaponWheel.open || mapPanel.classList.contains('open') || event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    // Direction selects a view, so a smooth trackpad gesture cannot flicker it.
    player.setCameraMode(event.deltaY < 0 ? 'first' : 'third');
  }, { passive: false });

  const c = game.campus?.stats;
  $('stat-line').textContent = `${c ? `${c.buildings} estruturas · ${c.trees} árvores · ` : ''}Entorno ${map.surroundingsEnabled ? 'ativado' : 'desabilitado'} · Gráfico ${game.quality.name.toUpperCase()}`;
  // Build text nodes to keep place names safe even with custom map data.
  function placeButton(p, index, parent, className = '') {
    const button = document.createElement('button'); button.dataset.i = index; button.className = className;
    const number = document.createElement('b'); number.textContent = p.number ?? index + 1;
    const label = document.createElement('span'); label.textContent = p.name;
    button.append(number, label); parent.appendChild(button); return button;
  }
  places.forEach((p, i) => {
    const item = document.createElement('li'); $('places-list').appendChild(item);
    placeButton(p, i, item).addEventListener('click', () => {
      const visit = () => { tour.stop(); training.stop(); player.placeAt(p.x, p.z, p.yaw); startCampaign(touchSession); toast(`Teletransportado: ${p.name}`); };
      characters.open({ mode: 'campaign', onConfirm: visit });
    });
  });
  const markerPositions = [], projection = new THREE.Vector3();
  points.forEach((p, i) => {
    placeButton(p, i, $('map-places')).addEventListener('click', () => selectPoint(p));
    const choice = placeButton(p, i, $('tour-places')); choice.setAttribute('aria-pressed', 'false');
    choice.addEventListener('click', () => tour.focus(p));
    const marker = document.createElement('button'); marker.className = 'tour-marker'; marker.textContent = p.number;
    marker.title = `${p.number} · ${p.name}`; marker.setAttribute('aria-label', `Visitar ${p.name}`);
    marker.addEventListener('click', () => tour.focus(p)); $('tour-markers').appendChild(marker);
    const leader = document.createElement('span'); leader.className = 'marker-leader'; leader.hidden = true; $('tour-markers').appendChild(leader);
    markerPositions.push({ point: p, button: marker, leader, position: new THREE.Vector3(p.x, map.terrain.heightAt(p.x, p.z) + (p.height || 8) + 3, p.z) });
  });
  let markerTime = -1;
  engine.addSystem((dt, t) => {
    if (!tour.active || t - markerTime < .05 || mapPanel.classList.contains('open')) return;
    markerTime = t; engine.camera.updateMatrixWorld();
    const placed = [], panelTop = $('tour-panel').getBoundingClientRect().top;
    for (const marker of markerPositions) {
      projection.copy(marker.position).project(engine.camera);
      const visible = (!tour.focused || tour.focused === marker.point) && projection.z > -1 && projection.z < 1 && Math.abs(projection.x) < .97 && Math.abs(projection.y) < .92;
      marker.button.hidden = !visible; marker.leader.hidden = true;
      if (visible) {
        const x = (projection.x + 1) / 2 * innerWidth, y = (1 - projection.y) / 2 * innerHeight;
        // Keep nearby numbers individually tappable; leaders retain their real anchors.
        const chosen = placeMarker(x, y, placed, innerWidth, panelTop - 8);
        if (!chosen) { marker.button.hidden = true; continue; }
        const [px, py] = chosen; placed.push(chosen);
        marker.button.style.left = `${px}px`; marker.button.style.top = `${py}px`;
        const length = Math.hypot(px - x, py - y);
        if (length > 1) {
          marker.leader.hidden = false; marker.leader.style.left = `${x}px`; marker.leader.style.top = `${y}px`;
          marker.leader.style.width = `${length}px`; marker.leader.style.transform = `rotate(${Math.atan2(py - y, px - x)}rad)`;
        }
      }
    }
  }, 'late');
  game.events.on('tour-focus', point => {
    $('tour-panel').classList.toggle('focused', !!point);
    $('tour-title').textContent = point ? `${point.number} · ${point.name}` : 'Cidade de Deus';
    $('tour-description').textContent = point ? 'Arraste para olhar ao redor. Controle o zoom e a órbita ou volte à visão aérea.' : 'Selecione um ponto para se aproximar. Arraste para navegar, use a roda ou dois dedos para dar zoom.';
    for (const b of $('tour-places').children) b.setAttribute('aria-pressed', String(points[+b.dataset.i] === point));
  });
  // Insets follow actual responsive panel height, including focus expansion.
  new ResizeObserver(() => {
    if (tour.active) tour.setViewportInset(innerHeight - $('tour-panel').getBoundingClientRect().top + 8);
  }).observe($('tour-panel'));
  $('tour-overview').addEventListener('click', () => tour.overview());
  $('tour-orbit').addEventListener('click', () => { tour.setOrbit(!tour.orbit); $('tour-orbit').setAttribute('aria-pressed', String(tour.orbit)); });
  $('desktop-menu').addEventListener('click', sessionMenu.open);
  $('btn-menu').addEventListener('click', sessionMenu.open);

  player.events.addEventListener('lock', e => {
    if (!walkingMode()) { player.stop(); return; }
    document.body.classList.add('playing');
    overlay.classList.add('hidden');
    if (e.detail.touch) toast('Esquerda: andar · Direita: mirar');
  });
  player.events.addEventListener('unlock', () => {
    document.body.classList.remove('playing');
    if (walkingMode() && !mapPanel.classList.contains('open')) sessionMenu.open();
  });
  player.events.addEventListener('pointerlockfailed', () => {
    if (!walkingMode() || mapPanel.classList.contains('open')) return;
    sessionMenu.open();
    toast('Clique em Continuar jogando para capturar o mouse na mira.');
  });
  player.events.addEventListener('fly', e => {
    document.body.classList.toggle('flying', e.detail.flying);
    $('btn-fly').setAttribute('aria-pressed', String(e.detail.flying));
    toast(e.detail.flying ? 'Voando · Mais ações → Voar / pousar' : 'Pousando');
  });
  player.events.addEventListener('joystick', e => {
    const s = e.detail, el = $('joystick'); el.hidden = !s.active;
    el.style.left = `${s.originX}px`; el.style.top = `${s.originY}px`;
    el.firstElementChild.style.transform = `translate(${s.dx}px, ${s.dy}px)`;
  });
  $('btn-fly').addEventListener('click', () => { if (player.active && game.mode !== 'training') player.toggleAutoFly(); });
  $('btn-jump').addEventListener('click', () => player.jump());

  function openMap() {
    if (!game.mode || sessionMenu.paused) return;
    sessionMenu.setActions(false);
    game.audio?.setMenu(true);
    mapPanel.classList.add('open'); overlay.classList.add('hidden'); player.stop();
    tour.controls.enabled = false;
    $('map-mode-label').textContent = game.mode === 'training' ? 'MAPA DO TREINO' : game.mode === 'tour' ? 'MAPA DO TOUR' : game.mode === 'multiplayer' ? 'MAPA DA SALA' : 'MAPA DA TRETA';
    $('map-help').textContent = game.mode === 'tour' ? 'Arraste · Roda ou dois dedos para zoom · Selecione um ponto para visitar · M para voltar' : game.mode === 'multiplayer' ? 'Arraste · Roda ou dois dedos para zoom · Prata: defender o prédio · Campo: futebol de caixa · M para voltar' : 'Arraste · Roda ou dois dedos para zoom · Clique num ponto ou local para teleportar · M para voltar';
    if (game.mode === 'training') $('map-help').textContent = 'Área de treino · Caixas e posição do personagem · M para voltar';
    hud.drawBigMap(tour.active ? engine.camera.position.x : player.feet.x, tour.active ? engine.camera.position.z : player.feet.z, player.yaw);
  }
  function closeMap(resume = true) {
    mapPanel.classList.remove('open');
    if (game.mode === 'tour') { tour.controls.enabled = true; game.audio?.setMenu(false); }
    else if (resume) resumeGame();
    else showMenu();
  }
  $('minimap').addEventListener('click', openMap);
  $('minimap').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMap(); } });
  $('map-close').addEventListener('click', () => closeMap());
  game.input.bind('KeyM', () => mapPanel.classList.contains('open') ? closeMap() : openMap(), { when: 'always', label: 'mapa' });
  game.input.bind('Escape', event => {
    if (sessionMenu.paused) return; // Native dialog cancel resumes exactly once.
    event.preventDefault();
    if (sessionMenu.actionsOpen) sessionMenu.setActions(false);
    else if (reactions.opened) reactions.close();
    else if (weaponWheel.open) weaponWheel.cancel();
    else if (mapPanel.classList.contains('open')) closeMap();
    else if (game.mode) sessionMenu.open();
  }, { when: 'always' });
  bindCollapsiblePanels();
  game.input.bind('KeyH', () => sessionMenu.openControls(), { label: 'controles e atalhos' });
  addEventListener('resize', () => {
    updateOrientation();
    if (tour.active) tour.setViewportInset(innerHeight - $('tour-panel').getBoundingClientRect().top + 12);
  });
  return { toast, hud, posePanel, combatHUD, combatFeedback, characters, multiplayerUI, reactions, sessionMenu, startMode, showMenu, openMap, closeMap, selectPoint,
    get paused() { return sessionMenu.paused; },
    get mapOpen() { return mapPanel.classList.contains('open'); },
    get weaponWheelOpen() { return weaponWheel.open || reactions.opened || sessionMenu.actionsOpen || sessionMenu.paused; } };
}
