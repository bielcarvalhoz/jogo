import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Orbit camera independent of first-person movement and paintball. */
export function createTour(game) {
  const { camera, renderer, scene } = game.engine;
  const initialPosition = camera.position.clone(), initialRotation = camera.quaternion.clone();
  const controls = new OrbitControls(camera, renderer.domElement);
  // OrbitControls aligns the camera in its constructor; keep the campaign spawn intact.
  camera.position.copy(initialPosition); camera.quaternion.copy(initialRotation);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.minDistance = 12;
  controls.maxDistance = 2200;
  controls.maxPolarAngle = Math.PI / 2 - .08;
  controls.autoRotateSpeed = .65;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, transition = null, focused = null, autoOrbit = !reducedMotion.matches;
  let bottomInset = 0;
  const campaignPosition = new THREE.Vector3(), campaignRotation = new THREE.Quaternion();
  const savedFog = { near: scene.fog.near, far: scene.fog.far };
  const savedFogColor = scene.fog.color.clone();
  let savedBackground = scene.background, savedSkyVisible = game.engine.sky.visible;
  const quarter = game.map.world.quarter?.[0];
  const b = game.map.terrain.bounds;
  const xs = quarter?.map(p => p[0]) || [b.x0, b.x1], zs = quarter?.map(p => p[1]) || [b.z0, b.z1];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const campusWidth = Math.max(...xs) - Math.min(...xs), campusDepth = Math.max(...zs) - Math.min(...zs);
  const span = Math.max(campusWidth, campusDepth);
  const centre = new THREE.Vector3(cx, game.map.terrain.heightAt(cx, cz), cz);
  // A small static atlas-like backdrop replaces the white underside of the sky
  // in aerial views. One flat mesh extends the land without generating a city.
  const art = document.createElement('canvas'); art.width = art.height = 512;
  const ctx = art.getContext('2d'), gradient = ctx.createRadialGradient(256, 220, 20, 256, 256, 380);
  gradient.addColorStop(0, '#94aaa6'); gradient.addColorStop(.55, '#64847f'); gradient.addColorStop(1, '#29494c');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = '#c7dbca18'; ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    ctx.beginPath(); ctx.ellipse(256 + Math.sin(i) * 25, 256, 70 + i * 23, 45 + i * 19, -.4, 0, Math.PI * 2); ctx.stroke();
  }
  const backdrop = new THREE.CanvasTexture(art); backdrop.colorSpace = THREE.SRGBColorSpace;
  const land = new THREE.Mesh(new THREE.CircleGeometry(12000, 64), new THREE.MeshBasicMaterial({ color: 0x809b8e, fog: true }));
  land.name = 'Tour distant land'; land.userData.noPaintball = true;
  land.rotation.x = -Math.PI / 2; land.position.set(cx, -8, cz); land.visible = false; scene.add(land);

  function moveTo(position, target, instant = false) {
    controls.autoRotate = false;
    if (instant || reducedMotion.matches) {
      transition = null; camera.position.copy(position); controls.target.copy(target); controls.update();
      controls.autoRotate = !!focused && autoOrbit;
    } else {
      transition = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: position, targetTo: target, elapsed: 0 };
    }
  }

  function overview(instant = false) {
    focused = null;
    controls.minDistance = 80;
    // Fit the campus even in narrow viewports, with a slightly tilted aerial view.
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const availableHeight = Math.max(100, innerHeight - bottomInset);
    const distance = Math.max(campusWidth / camera.aspect, campusDepth * innerHeight / availableHeight) / (2 * halfFov) * 1.06;
    controls.maxDistance = Math.max(2200, distance * 1.6);
    moveTo(centre.clone().add(new THREE.Vector3(0, distance, distance * .16)), centre.clone(), instant);
    game.events.emit('tour-focus', null);
  }

  function focus(point) {
    if (!active || !point) return;
    focused = point;
    const target = new THREE.Vector3(point.x, game.map.terrain.heightAt(point.x, point.z) + (point.height || 12) * .45, point.z);
    const radius = Math.max(28, point.radius || 35);
    controls.minDistance = Math.max(12, radius * .55);
    moveTo(target.clone().add(new THREE.Vector3(radius * 1.25, radius * .85 + (point.height || 12) * .3, radius * 1.25)), target);
    game.events.emit('tour-focus', point);
  }

  function start() {
    if (active) return;
    campaignPosition.copy(camera.position); campaignRotation.copy(camera.quaternion);
    savedBackground = scene.background; savedSkyVisible = game.engine.sky.visible;
    active = true; controls.enabled = true;
    applyFraming();
    scene.background = backdrop; game.engine.sky.visible = false; land.visible = true;
    scene.fog.color.set(0x94aaa6);
    overview(true);
  }

  function stop() {
    if (!active) return;
    active = false; transition = null; controls.enabled = false; controls.autoRotate = false;
    camera.clearViewOffset();
    camera.position.copy(campaignPosition); camera.quaternion.copy(campaignRotation);
    Object.assign(scene.fog, savedFog);
    scene.fog.color.copy(savedFogColor); scene.background = savedBackground;
    game.engine.sky.visible = savedSkyVisible; land.visible = false;
  }

  function applyFraming() {
    // Shift the optical centre above the controls without changing the canvas size.
    if (bottomInset) camera.setViewOffset(innerWidth, innerHeight, 0, bottomInset / 2, innerWidth, innerHeight);
    else camera.clearViewOffset();
  }

  controls.addEventListener('start', () => { transition = null; });
  game.engine.addSystem((dt) => {
    if (!active || !controls.enabled) return;
    if (transition) {
      transition.elapsed += Math.max(0, dt);
      const progress = Math.min(1, transition.elapsed / 1.6), eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(transition.from, transition.to, eased);
      controls.target.lerpVectors(transition.targetFrom, transition.targetTo, eased);
      if (progress === 1) { transition = null; controls.autoRotate = !!focused && autoOrbit; }
    }
    controls.update(Math.min(dt, .1));
    const altitude = Math.max(0, camera.position.y - centre.y);
    scene.fog.near = Math.max(350, altitude * .9 + span * .25);
    scene.fog.far = Math.max(scene.fog.near + span * 1.1, altitude * 1.7 + span);
    // Free orbit/pan can never take the camera under the terrain.
    camera.position.y = Math.max(camera.position.y, game.map.terrain.heightAt(camera.position.x, camera.position.z) + 4);
  }, 'player');
  return {
    controls, start, stop, overview, focus,
    setViewportInset(bottom) {
      bottomInset = Math.min(innerHeight * .6, Math.max(0, bottom));
      if (active) { applyFraming(); if (!focused) overview(true); }
    },
    setOrbit(on) { autoOrbit = on; controls.autoRotate = active && !!focused && !transition && on; },
    get active() { return active; },
    get focused() { return focused; },
    get orbit() { return autoOrbit; },
  };
}
