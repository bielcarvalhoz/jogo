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
import { createGame, detectQuality, debugOptions, setupVisualStyle } from './core/index.js';
import { loadMapData, buildMap } from './map/index.js';
import { loadCampusData, createCampusPlugin } from './campus/index.js';
import { createPlayerModule } from './player/index.js';
import { createPaintballModule } from './gameplay/paintball/index.js';
import { createUI, loading, applyDeviceClasses } from './ui/index.js';
import { installDebug } from './debug/index.js';

applyDeviceClasses();

async function main() {
  await loading.status('Baixando dados do OpenStreetMap e relevo...');
  const base = import.meta.env.BASE_URL;
  const [mapData, campusGeo] = await Promise.all([loadMapData(base), loadCampusData(base)]);

  const game = createGame({ quality: detectQuality(), debug: debugOptions(), status: loading.status, container: document.getElementById('app') });

  const campus = createCampusPlugin(game, campusGeo);
  game.map = await buildMap(game, { data: mapData, plugins: [campus] });
  game.campus = campus;
  game.player = createPlayerModule(game);
  game.paintball = createPaintballModule(game);
  game.ui = createUI(game);
  game.styler = setupVisualStyle(game); // depois de tudo estar na cena
  game.ui.showMenu();
  game.engine.start();
  await installDebug(game);
}

main().catch(loading.error);
