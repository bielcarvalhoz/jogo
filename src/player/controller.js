import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Primeira pessoa.
//  Teclado/mouse: WASD + mouse, Shift corre, Espaço pula, F alterna voo livre.
//  Toque (celular, tela deitada): arrastar = olhar; toque duplo = começa a voar para onde
//  está olhando (olhar para baixo desce, para cima sobe); toque duplo de novo = para de voar.

const EYE = 1.7;
const RADIUS = 0.35;
const GRAVITY = 22;
const STEP_UP = 0.7;
const TOUCH_FLY_SPEED = 16; // m/s

export function createPlayer(camera, dom, { terrain, collide, bridgeHeightAt, roofAt, bounds }) {
  const controls = new PointerLockControls(camera, dom);
  const keys = new Set();
  const feet = new THREE.Vector3();
  let vy = 0;
  let onGround = false;
  let fly = false; // voo livre do teclado (F)
  let autoFly = false; // voo do toque duplo
  let flySpeed = 0;

  // Estado "jogando": pointer lock, modo arrastar (pointer lock bloqueado) ou modo toque
  const events = new EventTarget();
  let active = false;
  let mode = 'mouse'; // 'mouse' | 'drag' | 'touch'
  const setActive = (v) => {
    if (active === v) return;
    active = v;
    if (!v) { keys.clear(); lookId = null; }
    events.dispatchEvent(new CustomEvent(v ? 'lock' : 'unlock', { detail: { dragMode: mode === 'drag', touch: mode === 'touch' } }));
  };
  controls.addEventListener('lock', () => { mode = 'mouse'; setActive(true); });
  controls.addEventListener('unlock', () => { if (mode === 'mouse') setActive(false); });
  const enableDragMode = () => { if (!controls.isLocked && mode !== 'touch') { mode = 'drag'; setActive(true); } };
  document.addEventListener('pointerlockerror', enableDragMode);

  /** touch = true quando o jogo foi iniciado por toque (celular/tablet) */
  function start(touch = false) {
    if (touch) {
      mode = 'touch';
      setActive(true);
      return;
    }
    mode = 'mouse';
    try {
      const p = dom.requestPointerLock();
      if (p && p.catch) p.catch(enableDragMode);
    } catch { enableDragMode(); return; }
    // alguns ambientes ignoram o pedido em silêncio
    setTimeout(() => { if (!controls.isLocked && !active) enableDragMode(); }, 700);
  }
  function stop() {
    setActive(false);
    dragging = false;
    if (controls.isLocked) controls.unlock();
  }

  // ---------------------------------------------------------------- olhar arrastando
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const look = (dx, dy, k) => {
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * k;
    euler.x = Math.max(-1.5, Math.min(1.5, euler.x - dy * k));
    camera.quaternion.setFromEuler(euler);
  };
  let dragging = false;
  let lookId = null, lastX = 0, lastY = 0;
  let downT = 0, downX = 0, downY = 0, moved = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  dom.addEventListener('pointerdown', (e) => {
    if (!active) return;
    if (e.pointerType === 'touch') {
      if (lookId !== null) return; // um dedo só controla a câmera
      lookId = e.pointerId; lastX = downX = e.clientX; lastY = downY = e.clientY; downT = performance.now(); moved = 0;
      dom.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    } else if (mode === 'drag') dragging = true;
  });
  dom.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== lookId) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      // meia largura da tela de arrasto ~ 100 graus
      look(dx, dy, (Math.PI * 1.1) / Math.max(innerWidth, 1));
      e.preventDefault();
    }
  });
  const endTouch = (e) => {
    if (e.pointerType !== 'touch' || e.pointerId !== lookId) return;
    lookId = null;
    const now = performance.now();
    const tap = now - downT < 260 && moved < 14;
    if (!tap) return;
    if (now - lastTap.t < 340 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 60) {
      lastTap.t = 0;
      toggleAutoFly();
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  };
  dom.addEventListener('pointerup', endTouch);
  dom.addEventListener('pointercancel', (e) => { if (e.pointerId === lookId) lookId = null; });
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerType === 'touch') return;
    look(e.movementX, e.movementY, 0.004);
  });

  function toggleAutoFly() {
    autoFly = !autoFly;
    fly = false;
    vy = 0;
    flySpeed = 0;
    events.dispatchEvent(new CustomEvent('fly', { detail: { flying: autoFly } }));
  }

  // ---------------------------------------------------------------- teclado
  const onKey = (e, down) => {
    if (down) keys.add(e.code); else keys.delete(e.code);
    if (down && e.code === 'Space' && !fly && !autoFly && onGround) { vy = 7; onGround = false; }
    if (down && e.code === 'KeyF') { fly = !fly; autoFly = false; vy = 0; }
  };
  window.addEventListener('keydown', (e) => {
    if (mode === 'drag' && active && e.code === 'Escape') { setActive(false); return; }
    if (active) { onKey(e, true); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => onKey(e, false));

  function groundAt(x, z, fromY) {
    let g = terrain.heightAt(x, z);
    const b = bridgeHeightAt(x, z, fromY + STEP_UP);
    if (b > g) g = b;
    const r = roofAt(x, z, fromY + 0.05);
    if (r > g) g = r;
    return g;
  }

  function placeAt(x, z, yaw = 0) {
    feet.set(x, terrain.heightAt(x, z), z);
    feet.y = groundAt(x, z, feet.y + 100);
    if (feet.y > terrain.heightAt(x, z) + 3) feet.y = terrain.heightAt(x, z); // não nascer em telhado
    vy = 0;
    autoFly = false;
    camera.position.set(x, feet.y + EYE, z);
    camera.rotation.set(0, yaw, 0, 'YXZ');
  }

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();

  function update(dt) {
    if (!active) return;
    dt = Math.min(dt, 0.05);
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const flying = fly || autoFly;
    const speed = fly ? (run ? 90 : 28) : run ? 9.5 : 4.6;

    camera.getWorldDirection(fwd);
    move.set(0, 0, 0);
    if (autoFly) {
      // voa para onde a câmera aponta (inclusive para cima/baixo)
      flySpeed += (TOUCH_FLY_SPEED - flySpeed) * Math.min(1, dt * 2.5);
      move.copy(fwd).multiplyScalar(flySpeed * dt);
    } else {
      if (!fly) { fwd.y = 0; fwd.normalize(); }
      right.crossVectors(fwd, camera.up).normalize();
      if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
      if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
      if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
      if (fly) {
        if (keys.has('KeyE') || keys.has('Space')) move.y += speed * dt;
        if (keys.has('KeyQ') || keys.has('ControlLeft')) move.y -= speed * dt;
      }
    }

    if (flying) {
      feet.y += move.y;
      const wantX = feet.x + move.x, wantZ = feet.z + move.z;
      const [nx, nz] = collide(wantX, wantZ, RADIUS, feet.y); // não atravessa prédios e muros
      // bloqueado por muro/prédio: sobe por cima dele em vez de ficar preso
      const want = Math.hypot(move.x, move.z), got = Math.hypot(nx - feet.x, nz - feet.z);
      if (want > 1e-4 && got < want * 0.6) feet.y += Math.max(want, (autoFly ? flySpeed : speed) * dt) * 0.9;
      feet.x = nx; feet.z = nz;
      const g = groundAt(feet.x, feet.z, feet.y);
      if (feet.y < g) feet.y = g; // desliza sobre o chão e os telhados
      onGround = false;
    } else {
      let nx = feet.x + move.x, nz = feet.z + move.z;
      [nx, nz] = collide(nx, nz, RADIUS, feet.y);
      feet.x = nx; feet.z = nz;
      vy -= GRAVITY * dt;
      feet.y += vy * dt;
      const g = groundAt(feet.x, feet.z, feet.y);
      if (feet.y <= g) {
        feet.y = g;
        vy = 0;
        onGround = true;
      } else if (feet.y - g < 0.25 && vy <= 0) {
        feet.y = g; vy = 0; onGround = true; // gruda em descidas
      } else onGround = false;
    }

    // não sair do mapa nem subir demais
    const m = 3;
    feet.x = Math.min(bounds.x1 - m, Math.max(bounds.x0 + m, feet.x));
    feet.z = Math.min(bounds.z1 - m, Math.max(bounds.z0 + m, feet.z));
    feet.y = Math.min(feet.y, terrain.heightAt(feet.x, feet.z) + 400);

    camera.position.set(feet.x, feet.y + EYE, feet.z);
  }

  return {
    events,
    start,
    stop,
    update,
    placeAt,
    feet,
    toggleAutoFly,
    get active() { return active; },
    get dragMode() { return mode === 'drag'; },
    get touchMode() { return mode === 'touch'; },
    get fly() { return fly || autoFly; },
    get yaw() { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); return e.y; },
  };
}
