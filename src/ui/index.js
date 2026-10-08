import * as THREE from 'three';
import { IS_TOUCH } from '../core/index.js';
import { createHud } from './hud.js';
import './style.css';

export { loading, createFrontMenu } from './front-menu.js';
const $ = id => document.getElementById(id);
const updateOrientation = () => document.body.classList.toggle('portrait', innerHeight > innerWidth);

export function applyDeviceClasses() {
  document.body.classList.toggle('touch', IS_TOUCH);
  document.body.classList.add('menu-open');
  updateOrientation();
}

export function createUI(game) {
  const { map, player, engine, tour } = game;
  const overlay = $('overlay'), mapPanel = $('map-panel'), help = $('help');
  const points = game.mapPoints, places = game.places;
  let touchSession = IS_TOUCH;

  const toast = msg => {
    const el = $('toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  };
  game.events.on('toast', toast);

  async function startCampaign(touch = touchSession) {
    touchSession = touch; tour.stop(); game.mode = 'campaign';
    document.body.classList.remove('menu-open', 'tour-active');
    $('tour-panel').classList.add('hidden'); $('tour-markers').classList.add('hidden');
    overlay.classList.add('hidden'); mapPanel.classList.remove('open'); $('hud').classList.remove('hidden');
    if (touch) {
      document.body.classList.add('touch');
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* iOS */ }
      try { await screen.orientation?.lock?.('landscape'); } catch { /* requires Android fullscreen */ }
    }
    if (game.mode === 'campaign') player.start(touch);
  }

  function startMode(mode, touch = IS_TOUCH) {
    if (mode === 'campaign') { startCampaign(touch); return; }
    game.mode = 'tour'; player.stop(); tour.start(); touchSession = touch;
    document.body.classList.remove('menu-open'); document.body.classList.add('tour-active');
    overlay.classList.add('hidden'); mapPanel.classList.remove('open'); $('hud').classList.remove('hidden');
    $('tour-panel').classList.remove('hidden'); $('tour-markers').classList.remove('hidden');
    tour.setViewportInset(innerHeight - $('tour-panel').getBoundingClientRect().top + 12);
    $('tour-orbit').setAttribute('aria-pressed', String(tour.orbit));
  }

  function showMenu() {
    game.mode = null; player.stop(); tour.stop();
    document.body.classList.add('menu-open'); document.body.classList.remove('tour-active', 'flying');
    mapPanel.classList.remove('open'); overlay.classList.remove('hidden'); $('hud').classList.add('hidden');
    $('tour-panel').classList.add('hidden'); $('tour-markers').classList.add('hidden');
  }

  function selectPoint(point, world) {
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
    streetAt: map.roads.streetAt, places: points, onSelect: selectPoint, getMode: () => game.mode });
  engine.addSystem((dt, t) => {
    if (game.mode) hud.update(t, dt, tour.active ? engine.camera.position : player.feet, player.yaw, player.fly);
  }, 'late');

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
      tour.stop(); player.placeAt(p.x, p.z, p.yaw); startCampaign(touchSession); toast(`Teletransportado: ${p.name}`);
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
    markerPositions.push({ point: p, button: marker, position: new THREE.Vector3(p.x, map.terrain.heightAt(p.x, p.z) + (p.height || 8) + 3, p.z) });
  });
  let markerTime = -1;
  engine.addSystem((dt, t) => {
    if (!tour.active || t - markerTime < .05 || mapPanel.classList.contains('open')) return;
    markerTime = t; engine.camera.updateMatrixWorld();
    for (const marker of markerPositions) {
      projection.copy(marker.position).project(engine.camera);
      const visible = (!tour.focused || tour.focused === marker.point) && projection.z > -1 && projection.z < 1 && Math.abs(projection.x) < .97 && Math.abs(projection.y) < .92;
      marker.button.hidden = !visible;
      if (visible) { marker.button.style.left = `${(projection.x + 1) / 2 * innerWidth}px`; marker.button.style.top = `${(1 - projection.y) / 2 * innerHeight}px`; }
    }
  }, 'late');
  game.events.on('tour-focus', point => {
    $('tour-title').textContent = point ? `${point.number} · ${point.name}` : 'Cidade de Deus';
    $('tour-description').textContent = point ? 'Arraste para olhar ao redor. Controle o zoom e a órbita ou volte à visão aérea.' : 'Selecione um ponto para se aproximar. Arraste para navegar, use a roda ou dois dedos para dar zoom.';
    for (const b of $('tour-places').children) b.setAttribute('aria-pressed', String(points[+b.dataset.i] === point));
  });
  $('tour-overview').addEventListener('click', () => tour.overview());
  $('tour-orbit').addEventListener('click', () => { tour.setOrbit(!tour.orbit); $('tour-orbit').setAttribute('aria-pressed', String(tour.orbit)); });
  $('tour-menu').addEventListener('click', showMenu);
  $('desktop-menu').addEventListener('click', showMenu);
  $('btn-menu').addEventListener('click', showMenu);

  player.events.addEventListener('lock', e => {
    if (game.mode !== 'campaign') { player.stop(); return; }
    overlay.classList.add('hidden');
    if (e.detail.touch) toast('Arraste para olhar · toque duas vezes para voar');
    else if (e.detail.dragMode) toast('Segure e arraste para olhar · clique para atirar');
  });
  player.events.addEventListener('unlock', () => { if (game.mode === 'campaign' && !mapPanel.classList.contains('open')) showMenu(); });
  player.events.addEventListener('fly', e => { document.body.classList.toggle('flying', e.detail.flying); toast(e.detail.flying ? 'Voando — olhe para cima ou para baixo · toque 2× para parar' : 'Pousando'); });

  function openMap() {
    if (!game.mode) return;
    mapPanel.classList.add('open'); overlay.classList.add('hidden'); player.stop();
    tour.controls.enabled = false;
    $('map-mode-label').textContent = game.mode === 'tour' ? 'MAPA DO TOUR' : 'MAPA DA CAMPANHA';
    $('map-help').textContent = game.mode === 'tour' ? 'Arraste · Roda ou dois dedos para zoom · Selecione um ponto para visitar · M para voltar' : 'Arraste · Roda ou dois dedos para zoom · Clique num ponto ou local para teleportar · M para voltar';
    hud.drawBigMap(tour.active ? engine.camera.position.x : player.feet.x, tour.active ? engine.camera.position.z : player.feet.z, player.yaw);
  }
  function closeMap(resume = true) {
    mapPanel.classList.remove('open');
    if (game.mode === 'tour') tour.controls.enabled = true;
    else if (resume) startCampaign(touchSession);
    else showMenu();
  }
  $('tour-map').addEventListener('click', openMap);
  $('btn-map').addEventListener('click', openMap);
  $('minimap').addEventListener('click', openMap);
  $('minimap').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMap(); } });
  $('map-close').addEventListener('click', () => closeMap());
  game.input.bind('KeyM', () => mapPanel.classList.contains('open') ? closeMap() : openMap(), { when: 'always', label: 'mapa' });
  game.input.bind('Escape', () => { if (game.mode) showMenu(); }, { when: 'always' });
  game.input.bind('KeyH', () => help.classList.toggle('hidden'), { label: 'esconder ajuda' });
  for (let n = 1; n <= 9; n++) {
    const go = () => {
      if (!game.mode || mapPanel.classList.contains('open')) return;
      if (game.mode === 'tour') tour.focus(points.find(p => p.number === n));
      else {
        const p = places[n - 1]; if (!p) return;
        player.placeAt(p.x, p.z, p.yaw); toast(`Teletransportado: ${p.name}`);
      }
    };
    game.input.bind(`Digit${n}`, go, { when: 'always', label: n === 1 ? 'destinos (1–9)' : '' });
    game.input.bind(`Numpad${n}`, go, { when: 'always' });
  }
  addEventListener('resize', () => {
    updateOrientation();
    if (tour.active) tour.setViewportInset(innerHeight - $('tour-panel').getBoundingClientRect().top + 12);
    if (document.body.classList.contains('touch') && innerHeight > innerWidth && player.active) showMenu();
  });
  return { toast, hud, startMode, showMenu, openMap, closeMap, selectPoint, get mapOpen() { return mapPanel.classList.contains('open'); } };
}
