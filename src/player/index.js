import { createPlayer } from './controller.js';
import { loadPlayerAvatar } from './avatar.js';
import { createCharacterPreview } from './character-preview.js';

// API pública do PERSONAGEM. Outros módulos importam SÓ daqui.
// Controle em primeira pessoa (teclado/mouse e toque). Não conhece o mapa por dentro:
// colisões, pisos e telhados vêm de game.physics, preenchido pelo mapa e pelo campus.
//
// O objeto devolvido expõe: active, fly, crouched, yaw, feet, touchMode, dragMode, events (EventTarget com
// 'lock', 'unlock', 'fly', 'crouch', 'joystick'), start(touch), stop(), placeAt(x, z, yaw), toggleAutoFly(),
// jump(), setCrouched(bool), toggleCrouch(), setFocusedAim(bool), bindFireButton(element, onHeld(bool)).

export { createPlayer } from './controller.js';

export function createPlayerModule(game) {
  const { engine, physics, map } = game;
  const training = () => game.training?.active ? game.training : null;
  const player = createPlayer(engine.camera, engine.renderer.domElement, {
    terrain: { heightAt: (x, z) => (training()?.terrain || map.terrain).heightAt(x, z) },
    bounds: () => training()?.bounds || map.terrain.bounds,
    bridgeHeightAt: (x, z, maxY) => Math.max((training() || physics).surfaceHeightAt(x, z, maxY), game.dynamicProps?.surfaceHeightAt(x, z, maxY) ?? -Infinity),
    collide: (x, z, r, feetY, options) => {
      const [nx, nz] = (training() || physics).collide(x, z, r, feetY, options);
      const [dx, dz] = game.dynamicProps?.collide(nx, nz, r, feetY, options) || [nx, nz];
      const [ax, az] = game.combat?.collide(dx, dz, r, feetY, options) || [dx, dz];
      return game.multiplayer?.collide(ax, az, r, feetY, options) || [ax, az];
    },
    roofAt: (x, z, y) => Math.max((training() || physics).roofAt(x, z, y), game.dynamicProps?.roofAt(x, z, y) ?? -Infinity),
    allowFlight: () => !training() && game.mode !== 'multiplayer',
    canAct: () => !game.ui?.paused && (game.combat?.canPlayerAct ?? true) && (game.multiplayer?.canAct ?? true) && !game.ui?.combatHUD?.panelOpen,
  });
  const spawn = game.places[0] || { x: 0, z: 0, yaw: 0 };
  player.placeAt(spawn.x, spawn.z, spawn.yaw);

  engine.setShadowFocus(() => player.feet);
  // no modo de inspeção (?inspect=) a câmera é posicionada pelo script de depuração
  engine.addSystem((dt) => {
    if (!game.debug.inspectionView) player.update(dt);
    player.avatar?.update(dt);
  }, 'player');

  player.ready = loadPlayerAvatar({ scene: engine.scene, camera: engine.camera, player }, `${import.meta.env.BASE_URL}models/sato.glb`).then(avatar => {
    player.avatar = avatar;
    return avatar;
  });
  player.updateWeapon = (gun, state) => {
    player.setHolstered(!!state?.holstered);
    return player.avatar?.updateWeapon(gun, state) || false;
  };
  player.applyCharacter = character => {
    player.character = character;
    player.avatar.appearance.apply(character.appearance); player.avatar.update(0);
  };
  player.createCharacterPreview = container => createCharacterPreview(player.avatar, container);
  player.spawnCorpse = impulse => {
    if (!game.ragdolls) return null;
    const corpse = player.avatar.createCorpse();
    return game.ragdolls.capture(corpse.root, { owned: true, cleanup: corpse.cleanup, impulse });
  };

  game.input.bind('KeyF', () => setTimeout(() => game.toast(player.fly ? 'Voo livre (E sobe, Control desce, Shift acelera)' : 'Andando'), 0), { label: 'voo livre' });
  return player;
}
