import { createPaintball } from './paintball.js';

// API pública da PISTOLINHA DE TINTA. Outros módulos importam SÓ daqui.
// Usa os elementos #paint-color, #paint-label, #paint-chip, #btn-color e #btn-fire do index.html.

export { PAINTBALL_PALETTE, PAINTBALL_LIMITS } from './paintball.js';

export function createPaintballModule(game) {
  const { scene, camera, renderer } = game.engine;
  const $ = (id) => document.getElementById(id);
  const player = game.player;
  const paintEnabled = () => (player.active || game.debug.inspectionView === 'tinta') && !game.ui?.mapOpen;
  const paintball = createPaintball({ scene, camera, getActive: paintEnabled });

  // cor da tinta (menu inicial + botão do HUD)
  const colorChoice = $('paint-color');
  for (const color of paintball.palette) {
    const option = document.createElement('option');
    option.value = color.id;
    option.textContent = color.label;
    colorChoice.appendChild(option);
  }
  const syncPaintColor = () => {
    const color = paintball.color;
    colorChoice.value = color.id;
    $('paint-label').textContent = color.label;
    $('paint-chip').style.backgroundColor = color.color;
  };
  syncPaintColor();
  colorChoice.addEventListener('change', () => { paintball.setColor(colorChoice.value); syncPaintColor(); });
  const nextPaintColor = () => { paintball.setColor((paintball.colorIndex + 1) % paintball.palette.length); syncPaintColor(); };
  $('btn-color').addEventListener('click', nextPaintColor);
  $('btn-fire').addEventListener('click', () => paintball.shoot());
  game.input.bind('KeyC', () => { nextPaintColor(); game.toast(`Tinta: ${paintball.color.label}`); }, { label: 'cor da tinta' });

  // tiro: clique com o mouse travado, ou clique sem arrastar no modo arrastar
  let paintPointer = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch' || !paintEnabled()) return;
    if (document.pointerLockElement === renderer.domElement) { paintball.shoot(); return; }
    paintPointer = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (paintPointer?.id === e.pointerId && Math.hypot(e.clientX - paintPointer.x, e.clientY - paintPointer.y) > 6) paintPointer.dragged = true;
  });
  window.addEventListener('pointerup', (e) => {
    if (paintPointer?.id !== e.pointerId) return;
    const click = !paintPointer.dragged && e.button === 0 && e.target === renderer.domElement;
    paintPointer = null;
    if (click && paintEnabled()) paintball.shoot();
  });
  const clearPaintPointer = () => { paintPointer = null; };
  window.addEventListener('pointercancel', clearPaintPointer);
  window.addEventListener('blur', clearPaintPointer);
  player.events.addEventListener('unlock', clearPaintPointer);

  game.engine.addSystem((dt) => paintball.update(dt), 'world');
  return paintball;
}
