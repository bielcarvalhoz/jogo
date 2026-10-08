// Ferramentas de depuração. window.__cdd dá acesso à cena pelo console do navegador e é usado
// pelos scripts de inspeção/QA; ?inspect=<vista> (só em desenvolvimento) posiciona a câmera.
export async function installDebug(game) {
  const { engine, map, player, paintball, styler } = game;
  const campus = game.campus;
  window.__cdd = {
    scene: engine.scene,
    camera: engine.camera,
    renderer: engine.renderer,
    player,
    world: map.world,
    terrain: map.terrain,
    proj: map.proj,
    roads: map.roads,
    campus: campus?.built ?? null,
    campusData: campus?.data ?? null,
    grading: campus?.grading ?? null,
    campusQA: () => campus?.qa() ?? null,
    styler,
    paintball,
    game,
  };
  const view = game.debug.inspectionView;
  if (import.meta.env.DEV && view) (await import('./inspection.js')).inspectScene(window.__cdd, view);
}
