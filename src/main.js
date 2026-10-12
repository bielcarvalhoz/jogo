// Monta o jogo a partir dos módulos. Cada pasta de src/ é um módulo com API pública no index.js:
//   core/      motor (render, laço, eventos, teclas, física compartilhada, visual)
//   map/       mundo real: relevo, vias, prédios do OSM, vegetação, água (pipeline com plugins)
//   campus/    núcleo Cidade de Deus — plugin do mapa
//   player/    personagem em primeira pessoa (teclado, mouse e toque)
//   gameplay/  mecânicas de jogo (pistolinha de tinta)
//   ui/        HUD, menus, mapa grande, avisos, celular
//   debug/     inspeção e QA
//   shared/    utilitários puros (geometria, aleatoriedade, texturas)
// Regras e responsabilidades: docs/ARQUITETURA.md
import { createGame, detectQuality, debugOptions, setupVisualStyle, createTour, createTraining, partitionStaticInstances, createDynamicProps, createRagdolls, bindLocomotionAudio } from './core/index.js';
import { loadMapData, buildMap } from './map/index.js';
import { loadCampusData, createCampusPlugin } from './campus/index.js';
import { createPlayerModule } from './player/index.js';
import { createPaintballModule, loadWeaponModels, createWeaponPickups, createAmmoPickups } from './gameplay/paintball/index.js';
import { createCombatModule } from './gameplay/combat/index.js';
import { createMultiplayerModule } from './gameplay/multiplayer/index.js';
import { createUI, loading, applyDeviceClasses, createFrontMenu } from './ui/index.js';
import { installDebug } from './debug/index.js';

applyDeviceClasses();
const debug = debugOptions();
const frontMenu = createFrontMenu({ trainingOnly: debug.trainingOnly });

async function main() {
  await loading.status('Baixando dados do OpenStreetMap e relevo...', 3);
  const base = import.meta.env.BASE_URL;
  const downloadOptions = { beforeParse: frontMenu.introFinished };
  const [mapData, campusGeo] = await Promise.all([loadMapData(base, downloadOptions), loadCampusData(base, downloadOptions)]);
  // Keep WebGL/PMREM, terrain generation and texture painting out of the intro.
  // This also protects the opening if a future loader returns cached objects.
  await frontMenu.introFinished;

  const game = createGame({ quality: detectQuality(frontMenu.settings), settings: frontMenu.settings, audio: frontMenu.audio, debug, status: loading.status, container: document.getElementById('app') });
  game.characters = frontMenu.characters;

  const campus = createCampusPlugin(game, campusGeo);
  game.map = await buildMap(game, { data: mapData, plugins: [campus] });
  game.campus = campus;
  await loading.status('Preparando a navegação...', 88);
  game.instanceStats = partitionStaticInstances(game.engine.scene);
  game.training = createTraining(game);
  await loading.status('Preparando caixas e física Rapier...', 89);
  game.dynamicProps = await createDynamicProps(game);
  game.ragdolls = await createRagdolls(game);
  game.player = createPlayerModule(game);
  bindLocomotionAudio(game);
  await loading.status('Preparando o personagem Sato...', 90);
  await game.player.ready;
  game.tour = createTour(game);
  const weaponModels = await loadWeaponModels(base);
  await loading.status('Preparando zumbis, bots e laboratório de combate...', 93);
  game.combat = await createCombatModule(game, { base, weaponModels });
  game.paintball = createPaintballModule(game);
  game.paintball.setWeaponModels(weaponModels);
  game.weaponPickups = createWeaponPickups(game, weaponModels);
  game.ammoPickups = createAmmoPickups(game);
  game.multiplayer = createMultiplayerModule(game, { weaponModels });
  game.ui = createUI(game);
  game.styler = setupVisualStyle(game); // depois de tudo estar na cena
  game.ui.showMenu();
  await loading.status('Finalizando a cidade...', 96);
  await game.paintball.warmup(game.engine.renderer);
  await installDebug(game);
  game.engine.start();
  frontMenu.ready(game);
}

main().catch(loading.error);
