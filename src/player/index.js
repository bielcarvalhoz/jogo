import { createPlayer } from './controller.js';

// API pública do PERSONAGEM. Outros módulos importam SÓ daqui.
// Controle em primeira pessoa (teclado/mouse e toque). Não conhece o mapa por dentro:
// colisões, pisos e telhados vêm de game.physics, preenchido pelo mapa e pelo campus.
//
// O objeto devolvido expõe: active, fly, yaw, feet, touchMode, dragMode, events (EventTarget com
// 'lock', 'unlock', 'fly', 'joystick'), start(touch), stop(), placeAt(x, z, yaw), toggleAutoFly().

export { createPlayer } from './controller.js';

export function createPlayerModule(game) {
  const { engine, physics, map } = game;
  const player = createPlayer(engine.camera, engine.renderer.domElement, {
    terrain: map.terrain,
    bounds: map.terrain.bounds,
    bridgeHeightAt: (x, z, maxY) => physics.surfaceHeightAt(x, z, maxY),
    collide: (x, z, r, feetY) => physics.collide(x, z, r, feetY),
    roofAt: (x, z, y) => physics.roofAt(x, z, y),
  });
  const spawn = game.places[0] || { x: 0, z: 0, yaw: 0 };
  player.placeAt(spawn.x, spawn.z, spawn.yaw);

  engine.setShadowFocus(() => player.feet);
  // no modo de inspeção (?inspect=) a câmera é posicionada pelo script de depuração
  engine.addSystem((dt) => { if (!game.debug.inspectionView) player.update(dt); }, 'player');

  game.input.bind('KeyF', () => setTimeout(() => game.toast(player.fly ? 'Voo livre (E sobe, Q desce, Shift acelera)' : 'Andando'), 0), { label: 'voo livre' });
  return player;
}
