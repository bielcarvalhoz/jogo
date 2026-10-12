import { preparePaintColliders, intersectsPaintBounds } from './collision.js';
import * as THREE from 'three';
import { WEAPONS, createWeaponInventory } from './weapons.js';
import { createAmmoStore } from './ammo.js';
import { createMuzzlePaint } from './muzzle-paint.js';
import { createSurfacePaintGeometry, projectSurfacePaint, surfacePaintMaterial } from './surface-paint.js';

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

export const PAINTBALL_LIMITS = Object.freeze({ projectiles: 48, marks: 96, speed: 34, gravity: 3, lifetime: 3, interval: .15 });
export const PAINTBALL_WEAPONS = WEAPONS;

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

/** Inputs belong to the existing player/UI, so looking by dragging never fires. */
export function createPaintball({ scene, camera, getActive = () => true, getVisible = getActive, getCameraMode = () => 'first', colliderRoots = () => [scene], traceActors = () => null, onShot = () => {}, onReload = () => {}, onAttack = () => {}, onStrike = () => {}, onImpact = () => {}, updateWeaponPose, getShotOrigin, random = Math.random }) {
  const root = new THREE.Group(); root.name = 'paintball-effects'; root.userData.paintballIgnore = true; scene.add(root);
  const gun = new THREE.Group(); gun.name = 'pistolinha-tinta'; gun.userData.paintballIgnore = true;
  const pistolModel = new THREE.Group(), autoModel = new THREE.Group();
  autoModel.name = 'metralhadora-paintball'; autoModel.visible = false; gun.add(pistolModel, autoModel);
  const inventory = createWeaponInventory();
  const ammunition = createAmmoStore(), muzzlePaint = createMuzzlePaint(root, random);
  const weaponParents = { pistol: pistolModel, automatic: autoModel };
  for (const weapon of WEAPONS.slice(2)) {
    const parent = new THREE.Group(); parent.name = `arma-${weapon.id}`; parent.visible = false;
    gun.add(parent); weaponParents[weapon.id] = parent;
  }
  gun.scale.setScalar(.65);
  gun.position.set(.34, -.34, -.62); camera.add(gun);
  if (!camera.parent) scene.add(camera);
  const geometries = new Set(), materials = new Set();
  const keepGeometry = g => { geometries.add(g); return g; };
  const keepMaterial = m => { materials.add(m); return m; };
  // A held weapon must be occluded by its owner's fingers and nearby scenery.
  const gunMaterial = color => keepMaterial(new THREE.MeshBasicMaterial({ color, depthTest: !!updateWeaponPose, toneMapped: false }));
  const graphite = gunMaterial('#303a40'), red = gunMaterial('#cf3046'), light = gunMaterial('#d6e0df');
  const colors = PAINTBALL_PALETTE.map(p => ({
    ball: keepMaterial(new THREE.MeshBasicMaterial({ color: p.color, toneMapped: false })),
    gun: gunMaterial(p.color),
    paint: keepMaterial(surfacePaintMaterial(p.color)),
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

  // Loading silhouettes are replaced by the supplied models when ready.
  for (const weapon of WEAPONS.slice(2)) {
    if (weapon.kind === 'unarmed') continue;
    const parent = weaponParents[weapon.id], length = weapon.kind === 'firearm' ? .5 : .55;
    addGun(new THREE.BoxGeometry(.055, .055, length), graphite, [0, 0, -length / 2], parent);
    addGun(new THREE.BoxGeometry(.065, .06, .07), colors[2].gun, [0, 0, -.16], parent);
  }

  const ballGeometry = keepGeometry(new THREE.SphereGeometry(.075, 8, 6));
  const projectiles = Array.from({ length: PAINTBALL_LIMITS.projectiles }, () => {
    const mesh = new THREE.Mesh(ballGeometry, colors[2].ball); mesh.name = 'bolinha-tinta'; mesh.visible = false; root.add(mesh);
    return { mesh, velocity: new THREE.Vector3(), age: 0 };
  });
  const marks = Array.from({ length: PAINTBALL_LIMITS.marks }, () => {
    const mesh = new THREE.Mesh(keepGeometry(createSurfacePaintGeometry()), colors[2].paint); mesh.name = 'marca-tinta'; mesh.visible = false; mesh.renderOrder = 3; root.add(mesh); return mesh;
  });
  const raycaster = new THREE.Raycaster(), forward = new THREE.Vector3(), origin = new THREE.Vector3(), target = new THREE.Vector3(), shotOrigin = new THREE.Vector3();
  let colorIndex = 2, projectileIndex = 0, markIndex = 0, cooldown = 0, recoil = 0, recoilDecay = 16, shots = 0, disposed = false;
  let weaponIndex = 0, trigger = false, aiming = false, aimBlend = 0, attackSequence = 0, pendingAttack = null, pendingShot = null;
  let weaponModels = null, holstered = false;
  let scopeZoom = 2;
  const scoped = () => !disposed && !holstered && !!getActive() && aiming && PAINTBALL_WEAPONS[weaponIndex].id === 'sniper' && getCameraMode() === 'first';
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
  const trace = (from, to) => {
    const scenery = tracePaintMeshes(raycaster, from, to, refreshColliders(), ignored), actor = traceActors(from, to);
    return actor && (!scenery || actor.distance < scenery.distance) ? actor : scenery;
  };

  function poseWeapon() {
    const weapon = PAINTBALL_WEAPONS[weaponIndex];
    const scopeActive = scoped();
    if (!updateWeaponPose?.(gun, { aimBlend, recoil, weapon: weapon.id, kind: weapon.kind, holstered, reloading: !!ammunition.state(weapon.id)?.reloading, active: !!getVisible(), scoped: scopeActive })) {
      gun.position.x = Math.min(.34, .32 * camera.aspect) * (1 - aimBlend);
      gun.position.y = -.34 + aimBlend * .27;
      gun.position.z = -.62 + recoil * .045 - aimBlend * .18;
      gun.rotation.x = -recoil * .09 * (1 - aimBlend * .6);
    }
    // Keep updating the hidden socket: scoped shots still originate at the
    // muzzle and use the same collision/aim path as every other firearm.
    gun.visible = !!getVisible() && !scopeActive && !holstered && !gun.userData.characterEmote;
  }

  function resetInput() {
    trigger = false; pendingAttack = pendingShot = null; cancelReload(); restoreView();
  }

  function cancelReload() {
    const weapon = PAINTBALL_WEAPONS[weaponIndex];
    if (ammunition.state(weapon.id)?.reloading) { ammunition.cancel(); onReload(weapon, { active: false, cancelled: true }); }
  }

  function reload() {
    const weapon = PAINTBALL_WEAPONS[weaponIndex];
    if (disposed || holstered || !getActive() || !ammunition.reload(weapon.id)) return false;
    pendingAttack = pendingShot = null; restoreView();
    onReload(weapon, { active: true, duration: ammunition.state(weapon.id).remaining });
    return true;
  }

  function setHolstered(value) {
    holstered = !!value; resetInput(); recoil = 0; poseWeapon();
    return holstered;
  }

  function clearEffects() {
    cancelReload(); muzzlePaint.clear();
    trigger = false; recoil = 0; cooldown = 0; pendingAttack = pendingShot = null;
    for (const ball of projectiles) ball.mesh.visible = false;
    for (const mark of marks) { mark.visible = false; mark.userData.followObject = null; }
  }

  function setColor(value) {
    const index = typeof value === 'number' ? value : PAINTBALL_PALETTE.findIndex(p => p.id === value);
    if (!Number.isInteger(index) || index < 0 || index >= colors.length) throw new RangeError('Cor de tinta inválida');
    colorIndex = index; reservoir.material = hopper.material = colors[index].gun;
    for (const parent of Object.values(weaponParents)) parent.traverse(object => {
      if (object.isMesh && colors.some(color => color.gun === object.material)) object.material = colors[index].gun;
    });
    if (weaponModels) for (const model of Object.values(weaponModels)) model.setColor(PAINTBALL_PALETTE[index].color);
    return PAINTBALL_PALETTE[index];
  }

  function emitShot(weapon) {
    const wasReloading = ammunition.state(weapon.id)?.reloading;
    if (!ammunition.consume(weapon.id)) return;
    if (wasReloading) onReload(weapon, { active: false, cancelled: true });
    camera.updateWorldMatrix(true, true);
    poseWeapon();
    gun.updateWorldMatrix(true, true);
    camera.getWorldPosition(origin); camera.getWorldDirection(forward); target.copy(origin).addScaledVector(forward, weapon.range);
    const aim = trace(origin, target); if (aim) target.copy(aim.point);
    const muzzleOrigin = muzzlePoint.getWorldPosition(new THREE.Vector3());
    // Sweep from the player's eye to the muzzle, independently of the chase
    // camera. This also catches a wall beside the reticle at a cover corner.
    if (getShotOrigin) getShotOrigin(shotOrigin); else shotOrigin.copy(origin);
    const obstruction = trace(shotOrigin, muzzleOrigin);
    if (obstruction) {
      muzzleOrigin.copy(obstruction.point).addScaledVector(obstruction.normal, .015);
      target.copy(obstruction.point);
    } else if (aim && origin.distanceTo(aim.point) < origin.distanceTo(muzzleOrigin) + .15) {
      muzzleOrigin.copy(shotOrigin);
    }
    const direction = target.clone().sub(muzzleOrigin).normalize();
    const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const ball = projectiles[projectileIndex++ % projectiles.length]; ball.mesh.position.copy(muzzleOrigin);
      const spread = weapon.hipSpread && !aiming ? weapon.hipSpread : weapon.spread;
      // The central pellet follows the reticle, with other pellets distributed
      // across a disk. One shell is one shot and one sound, even with nine hits.
      const angle = random() * Math.PI * 2, radius = weapon.pellets > 1 && pellet === 0 ? 0 : Math.sqrt(random()) * spread;
      ball.velocity.copy(direction).addScaledVector(right, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius).normalize().multiplyScalar(weapon.speed);
      ball.weapon = weapon; ball.distance = 0;
      ball.mesh.material = colors[colorIndex].ball; ball.mesh.userData.paintColor = colorIndex; ball.mesh.visible = true; ball.age = 0;
    }
    recoil = weapon.recoilStrength; recoilDecay = weapon.recoilDecay;
    muzzlePaint.emit(muzzleOrigin, direction, PAINTBALL_PALETTE[colorIndex].color);
    shots++; onShot(weapon.id, { recoilStrength: weapon.recoilStrength, recoilDecay: weapon.recoilDecay, origin: muzzleOrigin.clone(), direction: direction.clone(), aiming });
  }

  function meleeImpact(weapon) {
    camera.updateWorldMatrix(true, true);
    camera.getWorldPosition(origin); camera.getWorldDirection(forward);
    if (getShotOrigin) getShotOrigin(shotOrigin); else shotOrigin.copy(origin);
    target.copy(origin).addScaledVector(forward, 100);
    const aim = trace(origin, target); if (aim) target.copy(aim.point);
    const direction = target.clone().sub(shotOrigin).normalize();
    onStrike(weapon, { origin: shotOrigin.clone(), direction: direction.clone() });
    const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
    let closest = null;
    // A short swept fan covers the hand/blade width while respecting walls
    // and the player's reach, independently of the chase camera distance.
    for (const offset of [0, -.13, .13]) {
      const end = shotOrigin.clone().addScaledVector(direction, weapon.range).addScaledVector(right, offset);
      const hit = trace(shotOrigin, end);
      if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
    }
    if (closest) onImpact(closest, { weapon, damage: weapon.damage, impulse: weapon.impulse, direction, kind: weapon.kind });
  }

  function shoot() {
    if (disposed || holstered || !getActive() || cooldown > 0) return false;
    const weapon = PAINTBALL_WEAPONS[weaponIndex], ammo = ammunition.state(weapon.id);
    if (ammo && !ammo.loaded) { reload(); return false; }
    if (ammo?.reloading && weapon.reloadStyle !== 'shell') return false;
    cooldown = weapon.interval;
    if (weapon.kind !== 'firearm') {
      recoil = 1; recoilDecay = 16; pendingAttack = { weapon, remaining: weapon.interval * .28 };
      onAttack(weapon, { sequence: attackSequence++ });
    } else if (weapon.windup) pendingShot = { weapon, remaining: weapon.windup };
    else emitShot(weapon);
    return true;
  }

  function setTrigger(pressed) {
    if (disposed || holstered || !getActive()) { trigger = false; pendingShot = null; return; }
    // A tap commits one shot, including its trigger preparation. Releasing
    // stops repetition; explicit resets/switches still cancel pending shots.
    if (!pressed) { trigger = false; return; }
    if (trigger) return;
    trigger = true; shoot();
  }

  function setWeapon(value) {
    const index = typeof value === 'number' ? value : PAINTBALL_WEAPONS.findIndex(w => w.id === value);
    if (!Number.isInteger(index) || index < 0 || index >= PAINTBALL_WEAPONS.length) throw new RangeError('Arma inválida');
    inventory.select(PAINTBALL_WEAPONS[index].id);
    cancelReload();
    trigger = false; pendingAttack = pendingShot = null; weaponIndex = index; holstered = false;
    for (const [id, parent] of Object.entries(weaponParents)) parent.visible = id === PAINTBALL_WEAPONS[index].id;
    if (PAINTBALL_WEAPONS[index].kind !== 'firearm') restoreView();
    const loaded = weaponModels?.[PAINTBALL_WEAPONS[index].id];
    if (loaded) { muzzlePoint.position.copy(loaded.muzzle); gun.userData.weaponGrip = loaded.grip; }
    else muzzlePoint.position.set(0, .012, index === 0 ? -.38 : -.62);
    return PAINTBALL_WEAPONS[index];
  }

  function setWeaponModels(models) {
    weaponModels = models;
    for (const [id, parent] of Object.entries(weaponParents)) {
      if (!models[id]) continue;
      parent.clear(); parent.add(models[id].model);
      models[id].model.traverse(object => {
        if (!object.isMesh) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
    }
    setColor(colorIndex); setWeapon(weaponIndex);
  }

  function update(dt) {
    if (disposed) return;
    const active = !!getActive();
    gun.visible = !!getVisible();
    // A narrow horizontal FOV must not put the entire first-person weapon offscreen.
    const elapsed = Math.min(.1, Math.max(0, dt));
    const cooldownOvershoot = Math.max(0, elapsed - cooldown);
    cooldown = Math.max(0, cooldown - elapsed); recoil *= Math.exp(-elapsed * recoilDecay);
    muzzlePaint.update(elapsed);
    if (!active) { resetInput(); poseWeapon(); return; }
    const weapon = PAINTBALL_WEAPONS[weaponIndex], wasReloading = ammunition.state(weapon.id)?.reloading;
    ammunition.update(elapsed);
    if (wasReloading && !ammunition.state(weapon.id)?.reloading) onReload(weapon, { active: false });
    if (!holstered && weapon.kind === 'firearm' && ammunition.state(weapon.id).loaded === 0 && cooldown === 0 && !pendingShot) reload();
    if (pendingAttack) {
      pendingAttack.remaining -= elapsed;
      if (pendingAttack.remaining <= 0) { meleeImpact(pendingAttack.weapon); pendingAttack = null; }
    }
    if (pendingShot) {
      pendingShot.remaining -= elapsed;
      if (pendingShot.remaining <= 0) { emitShot(pendingShot.weapon); pendingShot = null; }
    }
    aimBlend += ((aiming ? 1 : 0) - aimBlend) * (1 - Math.exp(-elapsed * 18));
    if (Math.abs(aimBlend - (aiming ? 1 : 0)) < .001) aimBlend = aiming ? 1 : 0;
    const aimFov = scoped()
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) / scopeZoom))
      : PAINTBALL_WEAPONS[weaponIndex].aimFov || 45;
    const fov = baseFov + (aimFov - baseFov) * aimBlend;
    if (Math.abs(camera.fov - fov) > .001) { camera.fov = fov; camera.updateProjectionMatrix(); }
    poseWeapon();
    // At most one shot per rendered frame: a slow frame never releases a burst
    // of catch-up raycasts. Projectile/splat pools remain fixed and shared.
    if (trigger && PAINTBALL_WEAPONS[weaponIndex].automatic && cooldown === 0 && shoot()) {
      // Preserve the fractional frame so 90 ms fire does not become 100 ms at
      // 50 Hz. Cap debt to one interval; stalled frames never create bursts.
      cooldown -= Math.min(cooldownOvershoot, PAINTBALL_WEAPONS[weaponIndex].interval * .5);
    }
    for (const ball of projectiles) {
      if (!ball.mesh.visible) continue;
      const step = advancePaintball(ball.mesh.position, ball.velocity, elapsed);
      const hit = trace(ball.mesh.position, step.position);
      ball.age += elapsed;
      ball.distance += ball.mesh.position.distanceTo(step.position);
      if (hit) {
        onImpact(hit, { weapon: ball.weapon, damage: ball.weapon.damage, impulse: ball.weapon.impulse, direction: ball.velocity.clone().normalize(), kind: 'firearm', paintColor: PAINTBALL_PALETTE[ball.mesh.userData.paintColor].color });
        if (hit.entity || hit.corpse) { ball.mesh.visible = false; continue; }
        const mark = marks[markIndex++ % marks.length]; mark.material = colors[ball.mesh.userData.paintColor].paint;
        const projection = projectSurfacePaint(hit, refreshColliders(), mark.geometry, markIndex);
        mark.position.copy(projection.origin); mark.quaternion.identity(); mark.scale.setScalar(1);
        mark.visible = projection.vertices > 0;
        // Depth test keeps paint behind scenery; no depth writes and explicit
        // chronology make each new colour cover the previous one, even on reuse.
        mark.renderOrder = 3 + markIndex;
        mark.userData.followObject = null;
        for (let object = hit.object; object; object = object.parent) {
          if (!object.userData.dynamicPaint && !object.userData.rigidBody && !object.userData.physicsBody) continue;
          object.updateWorldMatrix(true, false); mark.updateMatrix();
          mark.userData.followObject = object;
          mark.userData.localMark = object.matrixWorld.clone().invert().multiply(mark.matrix);
          break;
        }
        ball.mesh.visible = false;
      } else if (ball.age >= PAINTBALL_LIMITS.lifetime || ball.distance >= ball.weapon.range) ball.mesh.visible = false;
      else { ball.mesh.position.copy(step.position); ball.velocity.copy(step.velocity); }
    }
    for (const mark of marks) {
      const object = mark.userData.followObject;
      if (!mark.visible || !object) continue;
      if (!object.parent) { mark.visible = false; continue; }
      object.updateWorldMatrix(true, false);
      new THREE.Matrix4().multiplyMatrices(object.matrixWorld, mark.userData.localMark).decompose(mark.position, mark.quaternion, mark.scale);
    }
  }

  function dispose() {
    if (disposed) return;
    cancelReload(); muzzlePaint.dispose(); disposed = true; trigger = false; restoreView(); root.removeFromParent(); gun.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  gun.visible = !!getActive();
  return {
    root, gun, update, shoot, reload, setColor, setTrigger, setWeapon, setHolstered, setWeaponModels, resetInput, clearEffects, palette: PAINTBALL_PALETTE, weapons: PAINTBALL_WEAPONS, dispose,
    get ammo() { return ammunition.state(PAINTBALL_WEAPONS[weaponIndex].id); },
    refillAmmo: () => ammunition.refill(),
    resetAmmo() { cancelReload(); ammunition.reset(); },
    pickupWeapon(id) { const result = inventory.pickup(id); setWeapon(id); return result; },
    get inventory() { return inventory.state; },
    get availableWeapons() { return inventory.available; },
    get weaponModels() { return weaponModels; },
    setAiming(value) { aiming = !disposed && !holstered && !ammunition.state(PAINTBALL_WEAPONS[weaponIndex].id)?.reloading && !!getActive() && PAINTBALL_WEAPONS[weaponIndex].kind === 'firearm' && !!value; if (!getActive()) restoreView(); },
    async warmup(renderer) {
      // Compile pooled effect shaders before the first shot, then restore visibility.
      const visible = gun.visible;
      gun.visible = true; for (const parent of Object.values(weaponParents)) parent.visible = true; projectiles[0].mesh.visible = true; marks[0].visible = true;
      try { await renderer.compileAsync(scene, camera); renderer.render(scene, camera); }
      finally { gun.visible = visible; for (const [id, parent] of Object.entries(weaponParents)) parent.visible = id === PAINTBALL_WEAPONS[weaponIndex].id; projectiles[0].mesh.visible = false; marks[0].visible = false; }
    },
    get collisionStats() { return collisionStats; },
    get color() { return PAINTBALL_PALETTE[colorIndex]; },
    get colorIndex() { return colorIndex; },
    get weapon() { return PAINTBALL_WEAPONS[weaponIndex]; },
    get weaponIndex() { return weaponIndex; },
    get holstered() { return holstered; },
    get aiming() { return aiming; },
    get scoped() { return scoped(); },
    get scopeZoom() { return scopeZoom; },
    adjustScopeZoom(delta) {
      if (scoped() && Number.isFinite(delta)) scopeZoom = THREE.MathUtils.clamp(scopeZoom + delta, 2, 8);
      return scopeZoom;
    },
    get firing() { return trigger; },
    get stats() { return { projectiles: projectiles.filter(p => p.mesh.visible).length, marks: marks.filter(m => m.visible).length, shots, muzzleParticles: muzzlePaint.active }; },
  };
}
