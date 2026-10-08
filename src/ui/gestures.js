/** Keep native Safari/Chrome page gestures out of the game's pointer controls.
 * Application pinch gestures on the map/tour still use pointer events. */
export function installGestureGuard(target = document) {
  const prevent = e => { if (e.cancelable) e.preventDefault(); };
  // touch-action handles pinch/double-tap without cancelling compatibility
  // clicks on a second finger's button while the first finger keeps moving.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'selectstart', 'contextmenu']) target.addEventListener(type, prevent, { passive: false });

  // Browsers generally generate a compatibility click only for the primary
  // touch. HUD actions must also work with a second/third finger while moving.
  const taps = new Map(); let lastAction = null;
  target.addEventListener('pointerdown', e => {
    if (!['touch', 'pen'].includes(e.pointerType)) return;
    const button = e.target?.closest?.('#hud button:not(#btn-fire), #minimap, #map-panel button');
    if (button && !button.disabled) taps.set(e.pointerId, { button, x: e.clientX, y: e.clientY, moved: false });
  }, true);
  target.addEventListener('pointermove', e => {
    const tap = taps.get(e.pointerId);
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) tap.moved = true;
  }, true);
  target.addEventListener('pointerup', e => {
    const tap = taps.get(e.pointerId); taps.delete(e.pointerId);
    if (!tap || tap.moved || tap.button.disabled || !tap.button.isConnected) return;
    lastAction = { time: performance.now(), x: e.clientX, y: e.clientY };
    prevent(e); tap.button.click();
  }, true);
  target.addEventListener('pointercancel', e => taps.delete(e.pointerId), true);
  target.addEventListener('click', e => {
    // Consume the delayed native click, including one retargeted after opening
    // a map/menu. Synthetic activation above and keyboard clicks have detail 0.
    if (e.detail && lastAction && performance.now() - lastAction.time < 700
      && Math.hypot(e.clientX - lastAction.x, e.clientY - lastAction.y) < 24) {
      prevent(e); e.stopImmediatePropagation(); lastAction = null;
    }
  }, true);
  target.addEventListener('visibilitychange', () => { taps.clear(); lastAction = null; });
}
