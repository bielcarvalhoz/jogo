import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// Primeira pessoa: WASD + mouse, Shift corre, Espaço pula, F alterna voo livre.

const EYE = 1.7;
const RADIUS = 0.35;
const GRAVITY = 22;
const STEP_UP = 0.7;

export function createPlayer(camera, dom, { terrain, collide, bridgeHeightAt, roofAt, bounds }) {
  const controls = new PointerLockControls(camera, dom);
  const keys = new Set();
  const feet = new THREE.Vector3();
  let vy = 0;
  let onGround = false;
  let fly = false;

  // Estado "jogando": pointer lock normal, ou modo arrastar-para-olhar quando o
  // navegador bloqueia o pointer lock (iframes, navegadores embutidos etc.)
  const events = new EventTarget();
  let active = false;
  let dragMode = false;
  const setActive = (v) => {
    if (active === v) return;
    active = v;
    if (!v) keys.clear();
    events.dispatchEvent(new CustomEvent(v ? 'lock' : 'unlock', { detail: { dragMode } }));
  };
  controls.addEventListener('lock', () => { dragMode = false; setActive(true); });
  controls.addEventListener('unlock', () => { if (!dragMode) setActive(false); });
  const enableDragMode = () => { if (!controls.isLocked) { dragMode = true; setActive(true); } };
  document.addEventListener('pointerlockerror', enableDragMode);

  function start() {
    dragMode = false; // tenta o pointer lock de novo a cada início
    try {
      const p = dom.requestPointerLock();
      if (p && p.catch) p.catch(enableDragMode);
    } catch { enableDragMode(); return; }
    // alguns ambientes ignoram o pedido em silêncio
    setTimeout(() => { if (!controls.isLocked && !active) enableDragMode(); }, 700);
  }
  function stop() {
    if (controls.isLocked) controls.unlock();
    else setActive(false);
  }

  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let dragging = false;
  dom.addEventListener('pointerdown', () => { if (active && dragMode) dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= e.movementX * 0.004;
    euler.x = Math.max(-1.55, Math.min(1.55, euler.x - e.movementY * 0.004));
    camera.quaternion.setFromEuler(euler);
  });

  const onKey = (e, down) => {
    if (down) keys.add(e.code); else keys.delete(e.code);
    if (down && e.code === 'Space' && !fly && onGround) { vy = 7; onGround = false; }
    if (down && e.code === 'KeyF') { fly = !fly; vy = 0; }
  };
  window.addEventListener('keydown', (e) => {
    if (dragMode && active && e.code === 'Escape') { setActive(false); return; }
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
    camera.position.set(x, feet.y + EYE, z);
    camera.rotation.set(0, yaw, 0, 'YXZ');
  }

  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();

  function update(dt) {
    if (!active) return;
    dt = Math.min(dt, 0.05);
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = fly ? (run ? 90 : 28) : run ? 9.5 : 4.6;

    camera.getWorldDirection(fwd);
    if (!fly) { fwd.y = 0; fwd.normalize(); }
    right.crossVectors(fwd, camera.up).normalize();
    move.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

    if (fly) {
      if (keys.has('KeyE') || keys.has('Space')) move.y += speed * dt;
      if (keys.has('KeyQ') || keys.has('ControlLeft')) move.y -= speed * dt;
      feet.add(move);
      const g = terrain.heightAt(feet.x, feet.z);
      if (feet.y < g) feet.y = g;
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

    // não sair do mapa
    const m = 3;
    feet.x = Math.min(bounds.x1 - m, Math.max(bounds.x0 + m, feet.x));
    feet.z = Math.min(bounds.z1 - m, Math.max(bounds.z0 + m, feet.z));

    camera.position.set(feet.x, feet.y + EYE, feet.z);
  }

  return {
    events,
    start,
    stop,
    update,
    placeAt,
    feet,
    get active() { return active; },
    get dragMode() { return dragMode; },
    get fly() { return fly; },
    get yaw() { const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); return e.y; },
  };
}
