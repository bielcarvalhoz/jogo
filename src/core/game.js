import * as THREE from 'three';
import { pointInPolygon } from '../shared/geo.js';
import { createEngine } from './engine.js';
import { createEvents } from './events.js';
import { createInput } from './input.js';
import { createPhysics } from './physics.js';

/**
 * O "contexto do jogo": o único objeto que os módulos compartilham.
 * Cada módulo recebe `game`, usa o que precisa e se pendura nele (game.map, game.player...).
 */
export function createGame({ quality, debug, status, container, settings, audio }) {
  const events = createEvents();
  const game = {
    quality,
    settings,
    audio,
    mode: null,
    mapPoints: [],
    debug,
    events,
    engine: createEngine({ quality, container, isIdle: () => !game.mode }),
    physics: createPhysics(),
    /** destinos de teletransporte: { name, x, z, yaw } — mapa e campus adicionam */
    places: [],
    /** mensagem na tela de carregamento (espera o navegador pintar) */
    status,
    /** aviso rápido na tela (a UI escuta o evento) */
    toast: (msg) => events.emit('toast', msg),
    /** jogo rodando (personagem com controle ativo) */
    isPlaying: () => !!game.player?.active && !game.ui?.paused,
    // preenchidos pelos módulos, na ordem de montagem (ver src/main.js)
    map: null,
    campus: null,
    player: null,
    characters: null,
    paintball: null,
    combat: null,
    ui: null,
    styler: null,
  };
  game.input = createInput(game);
  const ear = new THREE.Vector3(), forward = new THREE.Vector3(), up = new THREE.Vector3();
  game.engine.addSystem(() => {
    const camera = game.engine.camera;
    game.audio?.setListener?.(camera.getWorldPosition(ear), camera.getWorldDirection(forward), up.set(0, 1, 0).applyQuaternion(camera.quaternion));
    const quarter = game.campus?.data?.quarter;
    const inCity = !!game.player && !!quarter && pointInPolygon(game.player.feet.x, game.player.feet.z, quarter);
    game.audio?.setAmbience?.(inCity && game.player.active && ['campaign', 'multiplayer'].includes(game.mode));
  }, 'world');
  return game;
}
