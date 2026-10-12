import * as THREE from 'three';
import { CRATE_TYPES, cratePosition } from '../shared/props.js';
export { CRATE_TYPES } from '../shared/props.js';

const FIXED_STEP = 1 / 60;
let rapierReady;

export function metalCrateTexture() {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const frame = x < 8 || x > 119 || y < 8 || y > 119;
    const seam = x === 8 || x === 119 || y === 8 || y === 119;
    const rivet = [[5, 5], [122, 5], [5, 122], [122, 122]].some(([a, b]) => (x - a) ** 2 + (y - b) ** 2 < 7);
    const grain = Math.sin(y * 2.43) * 5 + Math.sin(x * 1.19 + y * 12.7) * 2;
    const scratch = y % 37 === 11 && x > 24 && x < 70 ? 12 : 0;
    const c = rivet ? 174 : seam ? 50 : (frame ? 104 : 126) + grain + scratch;
    pixels.set([c * .83, c * .94, c, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat); texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true; return texture;
}

/** A small deterministic plank texture, including battens and nail heads. */
export function woodenCrateTexture() {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const seam = y % 26 < 2;
    const batten = x < 12 || x > 115 || Math.abs(x - y) < 7;
    const grain = Math.sin(x * .22 + Math.sin(y * .32)) * 7 + Math.sin(x * 1.7 + y * .19) * 3;
    const nail = [[6, 6], [121, 6], [6, 121], [121, 121], [32, 32], [96, 96]].some(([a, b]) => (x - a) ** 2 + (y - b) ** 2 < 5);
    const c = nail ? [55, 51, 45] : seam ? [76, 46, 24] : batten ? [155 + grain, 103 + grain, 55 + grain] : [176 + grain, 124 + grain, 72 + grain];
    pixels.set([...c, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function footballFieldCenter(game) {
  const ring = game.campus?.data?.leisure?.campo || game.map.world.areas.find(area => area.id === 'cdd/campo' || area.kind === 'pitch')?.rings[0];
  if (ring?.length) {
    const unique = ring.filter((p, i) => i === 0 || p[0] !== ring[0][0] || p[1] !== ring[0][1]);
    return { x: unique.reduce((s, p) => s + p[0], 0) / unique.length, z: unique.reduce((s, p) => s + p[1], 0) / unique.length };
  }
  return { x: game.places[0]?.x || 0, z: game.places[0]?.z || 0 };
}

/** Rapier owns rigid-body motion; existing player queries stay compatible. */
export async function createDynamicProps(game) {
  const RAPIER = await (rapierReady ||= import('@dimforge/rapier3d-compat').then(async ({ default: rapier }) => { await rapier.init(); return rapier; }));
  const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
  world.timestep = FIXED_STEP;
  const root = new THREE.Group(); root.name = 'rapier-test-crates';
  game.engine.scene.add(root);
  const texture = woodenCrateTexture();
  const metalTexture = metalCrateTexture();
  const resources = Object.fromEntries(Object.entries(CRATE_TYPES).map(([type, { half }]) => [type, {
    geometry: new THREE.BoxGeometry(half * 2, half * 2, half * 2),
    material: new THREE.MeshStandardMaterial(type === 'wood' ? { map: texture, roughness: .91 }
      : { map: metalTexture, bumpMap: metalTexture, bumpScale: .018, metalness: .88, roughness: .42 }),
  }]));
  const campaign = footballFieldCenter(game), training = { x: game.training.spawn.x, z: game.training.spawn.z - 4 };
  const crates = [];
  for (const [mode, center] of [['campaign', campaign], ['training', training]]) for (const [type, spec] of Object.entries(CRATE_TYPES)) {
    // The metal box sits beyond the pickup lane/ring, with a clear firing lane.
    const at = cratePosition(type, center);
    const { half, mass, friction } = spec;
    const y = mode === 'training' ? 0 : game.map.terrain.heightAt(at.x, at.z);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, y + half + .03, at.z)
      .setLinearDamping(.18).setAngularDamping(.35).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setMass(mass).setFriction(friction).setRestitution(.12), body);
    const mesh = new THREE.Mesh(resources[type].geometry, resources[type].material);
    mesh.name = `${type === 'wood' ? 'wooden' : 'metal'}-crate-${mode}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.dynamicBody = true;
    mesh.userData.dynamicPaint = true;
    mesh.userData.keepStandard = type !== 'wood';
    const crate = { mode, type, mass, mesh, body, bounds: new THREE.Box3(), damage: 0, hits: 0, spawn: new THREE.Vector3(at.x, y + half + .03, at.z) };
    mesh.userData.crate = crate;
    root.add(mesh); crates.push(crate);
  }
  // The isolated checker floor and a sampled patch of the actual football-field
  // terrain support the boxes. The patch follows slopes beyond the pitch too.
  world.createCollider(RAPIER.ColliderDesc.cuboid(512, .1, 512).setTranslation(game.training.spawn.x, -.1, game.training.spawn.z).setFriction(.7));
  const cells = 64, extent = 128, vertices = [], indices = [];
  for (let z = 0; z <= cells; z++) for (let x = 0; x <= cells; x++) {
    const wx = campaign.x + (x / cells * 2 - 1) * extent, wz = campaign.z + (z / cells * 2 - 1) * extent;
    vertices.push(wx, game.map.terrain.heightAt(wx, wz), wz);
  }
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
    const a = z * (cells + 1) + x, b = a + cells + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(.7));
  let accumulator = 0, disposed = false;
  const isTraining = () => !!game.training.active;
  function sync() {
    if (disposed) return;
    for (const crate of crates) {
      const visible = (crate.mode === 'training') === isTraining();
      crate.mesh.visible = visible;
      if (crate.body.isEnabled() !== visible) crate.body.setEnabled(visible);
      crate.mesh.position.copy(crate.body.translation());
      crate.mesh.quaternion.copy(crate.body.rotation());
      crate.mesh.updateWorldMatrix(true, false);
      crate.bounds.setFromObject(crate.mesh);
    }
  }
  function reset(crate) {
    crate.body.setTranslation(crate.spawn, true);
    crate.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    crate.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    crate.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  function update(dt) {
    if (disposed) return;
    sync();
    if (!game.player?.active || game.ui?.paused || game.ui?.mapOpen || !['campaign', 'training'].includes(game.mode)) { accumulator = 0; return; }
    accumulator += Math.min(.05, Math.max(0, dt));
    while (accumulator >= FIXED_STEP) { world.step(); accumulator -= FIXED_STEP; }
    for (const crate of crates) {
      const p = crate.body.translation();
      if (p.y < crate.spawn.y - 40 || Math.hypot(p.x - crate.spawn.x, p.z - crate.spawn.z) > 120) reset(crate);
    }
    sync();
  }
  function impact(hit, info) {
    if (game.mode === 'multiplayer') return true;
    const crate = hit.object?.userData.crate;
    if (!crate || !crate.mesh.visible || disposed) return false;
    const direction = new THREE.Vector3().copy(info.direction || { x: 0, y: 0, z: -1 }).normalize();
    const impulse = Math.max(0, info.impulse ?? 6) * (info.kind === 'firearm' ? 4 : 4.5);
    direction.multiplyScalar(impulse);
    if (info.kind !== 'firearm') direction.y += impulse * .13;
    crate.body.applyImpulseAtPoint(direction, hit.point, true);
    crate.damage += Math.max(0, info.damage || 0); crate.hits++;
    // The projectile/melee impact owner plays the positional material sound.
    return true;
  }
  function collide(x, z, radius = .35, feetY = 0, { push = true } = {}) {
    if (disposed) return [x, z];
    for (const crate of crates) {
      if (!crate.mesh.visible) continue;
      const b = crate.bounds;
      if (feetY >= b.max.y - .06 || feetY + 1.8 <= b.min.y) continue;
      const cx = THREE.MathUtils.clamp(x, b.min.x, b.max.x), cz = THREE.MathUtils.clamp(z, b.min.z, b.max.z);
      let dx = x - cx, dz = z - cz, length = Math.hypot(dx, dz);
      if (length >= radius) continue;
      if (length < 1e-6) {
        const sides = [[Math.abs(x - b.min.x), -1, 0], [Math.abs(x - b.max.x), 1, 0], [Math.abs(z - b.min.z), 0, -1], [Math.abs(z - b.max.z), 0, 1]].sort((a, b) => a[0] - b[0]);
        [, dx, dz] = sides[0]; length = 1;
        x = dx < 0 ? b.min.x - radius : dx > 0 ? b.max.x + radius : x;
        z = dz < 0 ? b.min.z - radius : dz > 0 ? b.max.z + radius : z;
      } else { x += dx / length * (radius - length); z += dz / length * (radius - length); }
      if (push && game.player?.active && game.mode !== 'multiplayer') crate.body.applyImpulse({ x: -dx / length * .3, y: 0, z: -dz / length * .3 }, true);
    }
    return [x, z];
  }
  function surfaceHeightAt(x, z, maxY = Infinity) {
    if (disposed) return -Infinity;
    let top = -Infinity;
    for (const crate of crates) {
      if (!crate.mesh.visible) continue;
      // Rapier 0.21 returns -1 on a miss. Reject misses before converting the
      // time-of-impact into height, otherwise a phantom floor covers the map.
      if (x < crate.bounds.min.x || x > crate.bounds.max.x || z < crate.bounds.min.z || z > crate.bounds.max.z) continue;
      const ray = new RAPIER.Ray({ x, y: crate.bounds.max.y + 1, z }, { x: 0, y: -1, z: 0 });
      const hit = crate.body.collider(0).castRay(ray, 3, true);
      if (Number.isFinite(hit) && hit >= 0 && ray.origin.y - hit <= maxY + .001) top = Math.max(top, ray.origin.y - hit);
    }
    return top;
  }
  sync(); game.events.on('modechange', sync);
  game.engine.addSystem(update, 'early');
  return { root, crates, world, campaign, training, update, impact, collide, surfaceHeightAt,
    applyNetworkState(states) {
      for (const state of states) {
        const crate = crates.find(c => c.mode === 'campaign' && c.type === state.id); if (!crate) continue;
        crate.body.setTranslation(state.position, false); crate.body.setRotation(state.rotation, false);
        crate.body.setLinvel({ x: 0, y: 0, z: 0 }, false); crate.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      }
      sync();
    },
    roofAt: (x, z, y) => surfaceHeightAt(x, z, y + .05),
    dispose() { if (disposed) return; disposed = true; root.removeFromParent(); for (const { geometry, material } of Object.values(resources)) { geometry.dispose(); material.dispose(); } texture.dispose(); metalTexture.dispose(); world.free(); },
  };
}
