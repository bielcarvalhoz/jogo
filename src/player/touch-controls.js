/** Analog displacement: circular clamp, dead zone and proportional speed. */
export function joystickVector(dx, dy, radius = 52, deadZone = .12) {
  const distance = Math.hypot(dx, dy);
  const clamped = Math.min(distance, radius);
  const strength = Math.max(0, (clamped / radius - deadZone) / (1 - deadZone));
  return { x: strength ? dx / distance * strength : 0,
    y: strength ? -dy / distance * strength : 0,
    dx: distance ? dx / distance * clamped : 0, dy: distance ? dy / distance * clamped : 0 };
}

/** Each pointer owns one role until release: left movement and remaining look.
 * UI buttons sit outside the canvas and never start a movement/look gesture. */
export function createTouchControls(dom, { isActive, onLook, onStick, onDoubleTap }) {
  let stick = null, look = null, lastTap = null;
  const emitStick = (dx = 0, dy = 0) => {
    const v = joystickVector(dx, dy);
    onStick({ ...v, active: !!stick, originX: stick?.x || 0, originY: stick?.y || 0 });
  };
  const release = id => { try { if (dom.hasPointerCapture?.(id)) dom.releasePointerCapture(id); } catch { /* detached pointer */ } };
  const reset = () => {
    const ids = [stick?.id, look?.id]; stick = look = lastTap = null; emitStick();
    ids.forEach(id => { if (id !== undefined) release(id); });
  };
  dom.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !isActive()) return;
    const r = dom.getBoundingClientRect();
    if (e.clientX - r.left < r.width * .42) {
      if (stick) return;
      stick = { id: e.pointerId, x: e.clientX, y: e.clientY }; emitStick();
    } else {
      if (look) return;
      look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, time: performance.now() };
    }
    dom.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  dom.addEventListener('pointermove', e => {
    if (!isActive()) return;
    if (e.pointerId === stick?.id) {
      emitStick(e.clientX - stick.x, e.clientY - stick.y); e.preventDefault();
    } else if (e.pointerId === look?.id) {
      const dx = e.clientX - look.x, dy = e.clientY - look.y;
      look.moved += Math.abs(dx) + Math.abs(dy); look.x = e.clientX; look.y = e.clientY;
      onLook(dx, dy, Math.PI * 1.1 / Math.max(1, Math.min(innerWidth, innerHeight * 1.5)));
      e.preventDefault();
    }
  });
  const end = e => {
    if (e.pointerId === stick?.id) { stick = null; emitStick(); }
    if (e.pointerId === look?.id) {
      const now = performance.now(), tap = e.type === 'pointerup' && now - look.time < 260 && look.moved < 14;
      look = null;
      if (tap && lastTap && now - lastTap.time < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 60) {
        lastTap = null; onDoubleTap();
      } else lastTap = tap ? { time: now, x: e.clientX, y: e.clientY } : null;
    }
    release(e.pointerId);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) dom.addEventListener(type, end);
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  return { reset };
}
