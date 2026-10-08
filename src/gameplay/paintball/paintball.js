import { preparePaintColliders, intersectsPaintBounds } from './collision.js';
import * as THREE from 'three';

export const PAINTBALL_PALETTE = Object.freeze([
  { id: 'cinza', label: 'Cinza', color: '#88939b' },
  { id: 'prata', label: 'Prata', color: '#c4cbd0' },
  { id: 'vermelho', label: 'Vermelho', color: '#c8102e' },
  { id: 'rubi', label: 'Rubi', color: '#8c2638' },
  { id: 'amarelo', label: 'Amarelo', color: '#efc743' },
  { id: 'azul', label: 'Azul', color: '#2879b6' },
  { id: 'marfim', label: 'Marfim', color: '#efe5cf' },
  { id: 'verde', label: 'Verde', color: '#2e8b57' },
  { id: 'marrom', label: 'Marrom', color: '#7b4a2c' },
].map(Object.freeze));

export const PAINTBALL_LIMITS = Object.freeze({ projectiles: 16, marks: 96, speed: 34, gravity: 3, lifetime: 3, interval: .16 });
export const PAINTBALL_WEAPONS = Object.freeze([
  Object.freeze({ id: 'pistol', label: 'Pistola', automatic: false, interval: .16, speed: 34 }),
  Object.freeze({ id: 'automatic', label: 'Metralhadora', automatic: true, interval: .12, speed: 60 }),
]);

/** Exact ballistic integration, independent of the render frame duration. */
export function advancePaintball(position, velocity, dt, gravity = PAINTBALL_LIMITS.gravity) {
  return {
    position: position.clone().addScaledVector(velocity, dt).add(new THREE.Vector3(0, -gravity * dt * dt / 2, 0)),
    velocity: velocity.clone().add(new THREE.Vector3(0, -gravity * dt, 0)),
  };
}

function excludedFromPaint(object, ignored, checkVisibility = true) {
  for (let o = object; o; o = o.parent) {
    if ((checkVisibility && !o.visible) || o.isCamera || o.userData.paintballIgnore || o.userData.noPaintball || ignored.has(o)) return true;
  }
  return false;
}

const paintableMaterial = material => material && material.visible !== false && !material.isShaderMaterial && (!material.transparent || material.opacity >= .65);

/** Prune ignored foliage/characters before raycasting an expensive InstancedMesh. */
export function collectPaintableMeshes(roots, ignored = []) {
  const blocked = new Set(ignored), seen = new Set(), meshes = [];
  const visit = object => {
    if (seen.has(object) || object.isCamera || object.userData.paintballIgnore || object.userData.noPaintball || blocked.has(object)) return;
    seen.add(object);
    const material = object.material;
    if (object.isMesh && (Array.isArray(material) ? material.some(paintableMaterial) : paintableMaterial(material))) meshes.push(object);
    for (const child of object.children) visit(child);
  };
  // Hidden procedural buildings stay cached; current visibility is checked for
  // every shot so the existing show/hide toggle needs no cache rebuild.
  for (const root of roots) if (!excludedFromPaint(root, blocked, false)) visit(root);
  return meshes;
}

/** A swept segment catches thin surfaces even when a ball crosses them in one frame. */
export function raycastPaintSegment(raycaster, from, to, roots, ignored = []) {
  return tracePaintMeshes(raycaster, from, to, collectPaintableMeshes(roots, ignored), new Set(ignored));
}

function tracePaintMeshes(raycaster, from, to, meshes, ignored) {
  const delta = to.clone().sub(from), length = delta.length();
  if (length < 1e-8) return null;
  raycaster.set(from, delta.multiplyScalar(1 / length));
  raycaster.near = 0; raycaster.far = length;
  const visible = meshes.filter(object => !excludedFromPaint(object, ignored) && intersectsPaintBounds(object, raycaster));
  // Mixed material groups need all hits: a transparent face may precede a solid wall.
  raycaster.firstHitOnly = visible.every(o => !Array.isArray(o.material) || o.material.every(paintableMaterial));
  for (const hit of raycaster.intersectObjects(visible, false)) {
    if (!hit.face || !hit.object.isMesh) continue;
    // Transparent water and decorative panels are scenery, not paintable walls.
    const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    if (!paintableMaterial(material)) continue;
    const matrix = hit.object.matrixWorld.clone();
    if (hit.object.isInstancedMesh && hit.instanceId !== undefined) {
      const instance = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance);
    }
    const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
    if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
    return { ...hit, normal };
  }
  return null;
}

function splatterGeometry() {
  const positions = [];
  const disk = (x, y, radius, count, irregular = false) => {
    for (let i = 0; i < count; i++) {
      const angleA = i * Math.PI * 2 / count, angleB = (i + 1) * Math.PI * 2 / count;
      const r = angle => radius * (irregular ? 1 + .16 * Math.sin(angle * 5) + .09 * Math.cos(angle * 9) : 1);
      positions.push(x, y, 0, x + Math.cos(angleA) * r(angleA), y + Math.sin(angleA) * r(angleA), 0, x + Math.cos(angleB) * r(angleB), y + Math.sin(angleB) * r(angleB), 0);
    }
  };
  disk(0, 0, .19, 28, true);
  for (const [x, y, r] of [[.26, .10, .040], [-.24, .04, .033], [.07, -.26, .035], [-.12, .23, .026], [.25, -.14, .023]]) disk(x, y, r, 7);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
  return geometry;
}

/** Inputs belong to the existing player/UI, so looking by dragging never fires. */
export function createPaintball({ scene, camera, getActive = () => true, colliderRoots = () => [scene], onShot = () => {} }) {
  const root = new THREE.Group(); root.name = 'paintball-effects'; root.userData.paintballIgnore = true; scene.add(root);
  const gun = new THREE.Group(); gun.name = 'pistolinha-tinta'; gun.userData.paintballIgnore = true;
  const pistolModel = new THREE.Group(), autoModel = new THREE.Group();
  autoModel.name = 'metralhadora-paintball'; autoModel.visible = false; gun.add(pistolModel, autoModel);
  gun.scale.setScalar(.65);
  gun.position.set(.34, -.34, -.62); camera.add(gun);
  if (!camera.parent) scene.add(camera);
  const geometries = new Set(), materials = new Set();
  const keepGeometry = g => { geometries.add(g); return g; };
  const keepMaterial = m => { materials.add(m); return m; };
  const gunMaterial = color => keepMaterial(new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false }));
  const graphite = gunMaterial('#303a40'), red = gunMaterial('#cf3046'), light = gunMaterial('#d6e0df');
  const colors = PAINTBALL_PALETTE.map(p => ({
    ball: keepMaterial(new THREE.MeshBasicMaterial({ color: p.color, toneMapped: false })),
    gun: gunMaterial(p.color),
    paint: keepMaterial(new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: .93, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false })),
  }));
  const addGun = (geometry, material, position, parent = pistolModel) => {
    const mesh = new THREE.Mesh(keepGeometry(geometry), material); mesh.position.set(...position); mesh.renderOrder = 1000; parent.add(mesh); return mesh;
  };
  addGun(new THREE.BoxGeometry(.19, .12, .36), red, [0, 0, 0]);
  const barrel = addGun(new THREE.CylinderGeometry(.050, .050, .20, 10), graphite, [0, .012, -.24]); barrel.rotation.x = Math.PI / 2;
  const muzzle = addGun(new THREE.CylinderGeometry(.057, .057, .04, 10), light, [0, .012, -.34]); muzzle.rotation.x = Math.PI / 2;
  const grip = addGun(new THREE.BoxGeometry(.09, .20, .12), graphite, [0, -.13, .08]); grip.rotation.x = -.18;
  addGun(new THREE.TorusGeometry(.054, .012, 5, 10, Math.PI), light, [0, -.078, -.005]).rotation.y = Math.PI / 2;
  // Side-mounted paint reservoirs leave a clear sight line when centred in ADS.
  const reservoir = addGun(new THREE.SphereGeometry(.075, 10, 7), colors[2].gun, [-.18, .08, .055]); reservoir.scale.set(1, .8, 1.25);
  addGun(new THREE.BoxGeometry(.17, .15, .50), graphite, [0, 0, -.06], autoModel);
  addGun(new THREE.BoxGeometry(.18, .11, .24), red, [0, -.015, -.28], autoModel);
  const autoBarrel = addGun(new THREE.CylinderGeometry(.035, .035, .23, 8), graphite, [0, .015, -.45], autoModel); autoBarrel.rotation.x = Math.PI / 2;
  const autoMuzzle = addGun(new THREE.CylinderGeometry(.05, .05, .055, 8), light, [0, .015, -.57], autoModel); autoMuzzle.rotation.x = Math.PI / 2;
  addGun(new THREE.BoxGeometry(.10, .18, .11), graphite, [0, -.15, .065], autoModel).rotation.x = -.15;
  addGun(new THREE.BoxGeometry(.11, .22, .12), red, [0, -.17, -.14], autoModel).rotation.x = .13;
  addGun(new THREE.BoxGeometry(.11, .10, .20), graphite, [0, -.025, .25], autoModel);
  addGun(new THREE.BoxGeometry(.15, .22, .05), graphite, [0, -.055, .36], autoModel);
  const hopper = addGun(new THREE.SphereGeometry(.09, 10, 7), colors[2].gun, [-.18, .08, .04], autoModel); hopper.scale.set(1, .8, 1.5);
  for (const model of [pistolModel, autoModel]) {
    addGun(new THREE.BoxGeometry(.014, .045, .018), light, [0, .095, model === autoModel ? -.35 : -.15], model);
    for (const x of [-.035, .035]) addGun(new THREE.BoxGeometry(.014, .035, .018), light, [x, .09, .10], model);
  }
  const muzzlePoint = new THREE.Object3D(); muzzlePoint.position.set(0, .012, -.38); gun.add(muzzlePoint);

  const ballGeometry = keepGeometry(new THREE.SphereGeometry(.075, 8, 6)), markGeometry = keepGeometry(splatterGeometry());
  const projectiles = Array.from({ length: PAINTBALL_LIMITS.projectiles }, () => {
    const mesh = new THREE.Mesh(ballGeometry, colors[2].ball); mesh.name = 'bolinha-tinta'; mesh.visible = false; root.add(mesh);
    return { mesh, velocity: new THREE.Vector3(), age: 0 };
  });
  const marks = Array.from({ length: PAINTBALL_LIMITS.marks }, () => {
    const mesh = new THREE.Mesh(markGeometry, colors[2].paint); mesh.name = 'marca-tinta'; mesh.visible = false; mesh.renderOrder = 3; root.add(mesh); return mesh;
  });
  const raycaster = new THREE.Raycaster(), forward = new THREE.Vector3(), origin = new THREE.Vector3(), target = new THREE.Vector3();
  let colorIndex = 2, projectileIndex = 0, markIndex = 0, cooldown = 0, recoil = 0, shots = 0, disposed = false;
  let weaponIndex = 0, trigger = false, aiming = false, aimBlend = 0;
  const baseFov = camera.fov;
  const restoreView = () => {
    aiming = false; aimBlend = 0;
    if (camera.fov !== baseFov) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
  };
  const ignored = new Set([root, camera]);
  let cachedRoots = null, colliders = [], collisionStats = {};
  const refreshColliders = () => {
    const targets = (typeof colliderRoots === 'function' ? colliderRoots() : colliderRoots) || [];
    if (!cachedRoots || targets.length !== cachedRoots.length || targets.some((target, i) => target !== cachedRoots[i])) {
      cachedRoots = targets.slice(); colliders = collectPaintableMeshes(targets, [...ignored]);
      collisionStats = preparePaintColliders(colliders);
    }
    return colliders;
  };
  // Enumerate and build BVHs before gameplay so the first click never builds them.
  refreshColliders();
  const trace = (from, to) => tracePaintMeshes(raycaster, from, to, refreshColliders(), ignored);

  function setColor(value) {
    const index = typeof value === 'number' ? value : PAINTBALL_PALETTE.findIndex(p => p.id === value);
    if (!Number.isInteger(index) || index < 0 || index >= colors.length) throw new RangeError('Cor de tinta inválida');
    colorIndex = index; reservoir.material = hopper.material = colors[index].gun;
    return PAINTBALL_PALETTE[index];
  }

  function shoot() {
    if (disposed || !getActive() || cooldown > 0) return false;
    camera.updateWorldMatrix(true, true);
    camera.getWorldPosition(origin); camera.getWorldDirection(forward); target.copy(origin).addScaledVector(forward, 100);
    const aim = trace(origin, target); if (aim) target.copy(aim.point);
    const ball = projectiles[projectileIndex++ % projectiles.length];
    muzzlePoint.getWorldPosition(ball.mesh.position);
    // A long barrel close to a wall must not spawn the ball behind that wall.
    if (aim && origin.distanceTo(aim.point) < origin.distanceTo(ball.mesh.position) + .15) ball.mesh.position.copy(origin);
    const weapon = PAINTBALL_WEAPONS[weaponIndex];
    ball.velocity.copy(target).sub(ball.mesh.position).normalize().multiplyScalar(weapon.speed);
    ball.mesh.material = colors[colorIndex].ball; ball.mesh.userData.paintColor = colorIndex; ball.mesh.visible = true; ball.age = 0;
    cooldown = weapon.interval; recoil = 1; shots++; onShot(weapon.id);
    return true;
  }

  function setTrigger(pressed) {
    if (!pressed || disposed || !getActive()) { trigger = false; return; }
    if (trigger) return;
    trigger = true; shoot();
  }

  function setWeapon(value) {
    const index = typeof value === 'number' ? value : PAINTBALL_WEAPONS.findIndex(w => w.id === value);
    if (!Number.isInteger(index) || index < 0 || index >= PAINTBALL_WEAPONS.length) throw new RangeError('Arma inválida');
    trigger = false; weaponIndex = index;
    pistolModel.visible = index === 0; autoModel.visible = index === 1;
    muzzlePoint.position.z = index === 0 ? -.38 : -.62;
    return PAINTBALL_WEAPONS[index];
  }

  function update(dt) {
    if (disposed) return;
    gun.visible = !!getActive();
    // A narrow horizontal FOV must not put the entire first-person weapon offscreen.
    const elapsed = Math.min(.1, Math.max(0, dt));
    cooldown = Math.max(0, cooldown - elapsed); recoil *= Math.exp(-elapsed * 16);
    if (!gun.visible) { trigger = false; restoreView(); return; }
    aimBlend += ((aiming ? 1 : 0) - aimBlend) * (1 - Math.exp(-elapsed * 18));
    if (Math.abs(aimBlend - (aiming ? 1 : 0)) < .001) aimBlend = aiming ? 1 : 0;
    const fov = baseFov + (45 - baseFov) * aimBlend;
    if (Math.abs(camera.fov - fov) > .001) { camera.fov = fov; camera.updateProjectionMatrix(); }
    gun.position.x = Math.min(.34, .32 * camera.aspect) * (1 - aimBlend);
    gun.position.y = -.34 + aimBlend * .27;
    gun.position.z = -.62 + recoil * .045 - aimBlend * .18; gun.rotation.x = -recoil * .09 * (1 - aimBlend * .6);
    // At most one shot per rendered frame: a slow frame never releases a burst
    // of catch-up raycasts. Projectile/splat pools remain fixed and shared.
    if (trigger && PAINTBALL_WEAPONS[weaponIndex].automatic && cooldown === 0) shoot();
    for (const ball of projectiles) {
      if (!ball.mesh.visible) continue;
      const step = advancePaintball(ball.mesh.position, ball.velocity, elapsed);
      const hit = trace(ball.mesh.position, step.position);
      ball.age += elapsed;
      if (hit) {
        const mark = marks[markIndex++ % marks.length]; mark.material = colors[ball.mesh.userData.paintColor].paint;
        mark.position.copy(hit.point).addScaledVector(hit.normal, .014);
        mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
        mark.rotateZ(markIndex * 2.39996); mark.scale.setScalar(.90 + (markIndex % 5) * .06); mark.visible = true;
        ball.mesh.visible = false;
      } else if (ball.age >= PAINTBALL_LIMITS.lifetime) ball.mesh.visible = false;
      else { ball.mesh.position.copy(step.position); ball.velocity.copy(step.velocity); }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true; trigger = false; restoreView(); root.removeFromParent(); gun.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  gun.visible = !!getActive();
  return {
    root, gun, update, shoot, setColor, setTrigger, setWeapon, palette: PAINTBALL_PALETTE, weapons: PAINTBALL_WEAPONS, dispose,
    setAiming(value) { aiming = !disposed && !!getActive() && !!value; if (!getActive()) restoreView(); },
    resetInput() { trigger = false; restoreView(); },
    async warmup(renderer) {
      // Compile pooled effect shaders before the first shot, then restore visibility.
      const visible = gun.visible;
      gun.visible = true; pistolModel.visible = autoModel.visible = true; projectiles[0].mesh.visible = true; marks[0].visible = true;
      try { await renderer.compileAsync(scene, camera); renderer.render(scene, camera); }
      finally { gun.visible = visible; pistolModel.visible = weaponIndex === 0; autoModel.visible = weaponIndex === 1; projectiles[0].mesh.visible = false; marks[0].visible = false; }
    },
    get collisionStats() { return collisionStats; },
    get color() { return PAINTBALL_PALETTE[colorIndex]; },
    get colorIndex() { return colorIndex; },
    get weapon() { return PAINTBALL_WEAPONS[weaponIndex]; },
    get weaponIndex() { return weaponIndex; },
    get aiming() { return aiming; },
    get firing() { return trigger; },
    get stats() { return { projectiles: projectiles.filter(p => p.mesh.visible).length, marks: marks.filter(m => m.visible).length, shots }; },
  };
}
