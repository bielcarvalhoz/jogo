import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createAvatarFromGLTF } from '../../src/player/avatar.js';
import { loadAvatarGeometry } from './load-avatar.mjs';
import { prepareWeaponModel, WEAPON_MODEL_FITS } from '../../src/gameplay/paintball/weapon-models.js';
import { GAITS } from '../../src/player/locomotion.js';

const asset = new URL('../../public/models/sato.glb', import.meta.url);
test('player asset is the unmodified functional Sato version supplied by the user', async () => {
  const digest = createHash('sha256').update(await fs.readFile(asset)).digest('hex');
  assert.equal(digest, '96cb51b751f9664cc797bdf04c0d29196dbd8d671b8ba4f4085d439b54f50e20');
});
async function fixture() {
  const gltf = await loadAvatarGeometry(asset), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70);
  const player = {
    feet: new THREE.Vector3(), eyePosition: new THREE.Vector3(0, 1.7, 0), velocity: new THREE.Vector3(),
    active: true, grounded: true, cameraMode: 'third',
    get yaw() { return new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y; },
  };
  const avatar = createAvatarFromGLTF(gltf, { scene, camera, player });
  return { avatar, player, camera, scene, gun: new THREE.Group() };
}

test('neutral idle stays standing and both views reuse the same skinned arm meshes and materials', async () => {
  const { avatar, player } = await fixture();
  avatar.update(.016);
  assert.ok(avatar.bones['DEF-upper_armR'].getWorldPosition(new THREE.Vector3()).y > 1.15,
    'Idle_Loop must not select Crouch_Idle_Loop by a partial suffix');
  const meshes = [...avatar.meshes], materials = meshes.map(mesh => mesh.material);
  player.cameraMode = 'first'; avatar.update(.016);
  assert.equal(meshes.filter(mesh => mesh.visible).length, 2);
  assert.ok(meshes.filter(mesh => mesh.visible).every(mesh => /Sato_arm_hand_[LR]/.test(mesh.name)));
  player.cameraMode = 'third'; avatar.update(.016);
  assert.ok(meshes.every(mesh => mesh.visible === !mesh.userData.characterHidden));
  assert.deepEqual(avatar.meshes, meshes); assert.deepEqual(meshes.map(mesh => mesh.material), materials);
});

test('greeting survives repeated socket evaluations without accumulating arm rotation and returns to idle', async () => {
  const { avatar, gun } = await fixture(), baseline = await fixture();
  avatar.playGreeting();
  for (let frame = 0; frame < 180; frame++) {
    avatar.update(1 / 60); baseline.avatar.update(1 / 60);
    const before = avatar.bones['DEF-upper_armR'].quaternion.clone();
    for (let i = 0; i < 4; i++) { avatar.update(0); avatar.updateWeapon(gun, { weapon: 'pistol', kind: 'firearm' }); }
    assert.ok(before.normalize().angleTo(avatar.bones['DEF-upper_armR'].quaternion.clone().normalize()) < 1e-5, 'zero-time evaluations cannot compound a gesture');
  }
  for (const name of ['DEF-upper_armR', 'DEF-forearmR']) assert.ok(avatar.bones[name].quaternion.clone().normalize().angleTo(baseline.avatar.bones[name].quaternion.clone().normalize()) < 1e-5, 'the gesture must leave no residual pose');
});

test('thumb web fills only the hand base without rewriting original vertices or adding meshes', async () => {
  const original = await loadAvatarGeometry(asset), { avatar } = await fixture();
  for (const side of ['R', 'L']) {
    const source = original.scene.getObjectByName(`Sato_arm_hand_${side}`), mesh = avatar.meshes.find(m => m.name === source.name);
    const count = source.geometry.attributes.position.count, added = mesh.geometry.attributes.position.count - count;
    assert.ok(added > 0 && added < 100, 'thumb fill must remain a small local patch');
    for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      const originalValues = source.geometry.attributes[name].array;
      assert.deepEqual(mesh.geometry.attributes[name].array.subarray(0, originalValues.length), originalValues, `${name}: existing hand geometry was changed`);
    }
    const hand = mesh.skeleton.bones.findIndex(bone => bone.name === `DEF-hand${side}`);
    for (let i = count; i < count + added; i++) {
      assert.equal(mesh.geometry.attributes.skinIndex.getX(i), hand);
      assert.equal(mesh.geometry.attributes.skinWeight.getX(i), 1, 'fill must follow the palm through all finger animations');
    }
  }
});

test('weapons follow the original hand socket through camera changes, shooting, yaw and extreme pitch', async () => {
  const { avatar, player, camera, gun } = await fixture();
  for (const mode of ['first', 'third']) for (const weapon of ['pistol', 'automatic']) {
    for (const pitch of [-1.48, -.7, 0, .7, 1.48]) for (const yaw of [0, 1.3, -2]) {
      player.cameraMode = mode; camera.rotation.set(pitch, yaw, 0, 'YXZ');
      avatar.update(.016); avatar.updateWeapon(gun, { weapon, aimBlend: .8, recoil: .6, active: true });
      assert.ok(avatar.weaponDiagnostics.gripError < .003, `${mode}/${weapon}/${pitch}/${yaw}: detached weapon`);
      const position = gun.position.clone();
      avatar.updateWeapon(gun, { weapon, aimBlend: .8, recoil: .6, active: true });
      assert.ok(gun.position.distanceTo(position) < .00001, 'same-frame shot updates must not drift the shared arm root');
      for (const side of ['R', 'L']) assert.ok([...avatar.bones[`DEF-hand${side}`].matrixWorld.elements].every(Number.isFinite));
    }
  }
});

test('neutral wrist and finger articulation comes directly from the supplied animation', async () => {
  const { avatar } = await fixture();
  avatar.update(0);
  const clip = avatar.clips.find(clip => clip.name === 'Rig|Pistol_Aim_Neutral');
  for (const name of ['DEF-handR', 'DEF-handL', 'DEF-f_middle01R', 'DEF-thumb01L']) {
    const track = clip.tracks.find(track => track.name === `${name}.quaternion`);
    const authored = new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(0));
    assert.ok(avatar.bones[name].quaternion.angleTo(authored) < .001, `${name}: authored pose was overwritten`);
  }
  avatar.playShot();
  for (let frame = 0; frame < 16; frame++) avatar.update(.05);
  const restored = clip.tracks.find(track => track.name === 'DEF-handR.quaternion');
  assert.ok(avatar.bones['DEF-handR'].quaternion.angleTo(new THREE.Quaternion().fromArray(restored.createInterpolant().evaluate(0))) < .001,
    'the original grip resumes when the shot finishes');
});

test('third-person aim tracks camera pitch and shooting retains the selected aim pose', async () => {
  const { avatar, camera, gun } = await fixture();
  const forward = () => new THREE.Vector3(0, 0, -1).applyQuaternion(gun.quaternion);
  for (const pitch of [-1.1, -.55, 0, .55, 1.1]) {
    camera.rotation.set(pitch, 0, 0, 'YXZ'); avatar.update(0); avatar.updateWeapon(gun);
    const aimed = forward(), expected = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    assert.ok(aimed.angleTo(expected) < .13, `camera pitch ${pitch}: barrel misses the aimed direction`);
    avatar.playShot();
    for (let frame = 0; frame < 16; frame++) {
      avatar.update(.05); avatar.updateWeapon(gun);
      assert.ok(forward().angleTo(aimed) < .35, `camera pitch ${pitch}: shooting resets the aimed pose`);
    }
  }
});

test('locomotion keeps firearms aimed with a small rhythmic running sway in both views', async () => {
  const { avatar, player, camera, gun } = await fixture();
  camera.rotation.set(.3, .65, 0, 'YXZ');
  for (const mode of ['first', 'third']) for (const speed of [3.1, 4.6, 9.5]) for (const side of [-1, 1]) {
    player.cameraMode = mode; player.velocity.set(speed * side, 0, 0);
    let maxSway = 0;
    for (let frame = 0; frame < 90; frame++) {
      if (frame % 8 === 0) avatar.playShot();
      avatar.update(.016); avatar.updateWeapon(gun, { active: true });
      const frameRotation = mode === 'first' ? camera.quaternion.clone() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const relative = new THREE.Euler().setFromQuaternion(frameRotation.invert().multiply(gun.quaternion), 'YXZ');
      maxSway = Math.max(maxSway, Math.abs(relative.y), Math.abs(relative.z));
      assert.ok(Math.abs(relative.y) < .01 && Math.abs(relative.z) < .015, `${mode}/${speed}: sway must stay below one degree`);
    }
    if (speed > 7) assert.ok(maxSway > (mode === 'first' ? .002 : .007), `${mode}: running must move the aim with the gait`);
    if (speed < 3.5) assert.ok(maxSway < .00001, `${mode}: walking must preserve stable aim`);
  }
});

test('slow movement selects walking and faster movement selects the supplied jog and sprint clips', async () => {
  const { avatar, player } = await fixture();
  for (const [speed, expected] of [[0, 'Idle_Loop'], [1.5, 'Walk_Loop'], [4.6, 'Jog_Fwd_Loop'], [9.5, 'Sprint_Loop']]) {
    player.velocity.set(speed, 0, 0); avatar.update(.016);
    assert.equal(avatar.animationState.motion, expected);
  }
  player.grounded = false; avatar.update(.016);
  assert.equal(avatar.animationState.motion, 'Jump_Loop');
});

test('aiming while moving retains a subtle gait sway in both camera modes', async () => {
  const { avatar, player, gun, camera } = await fixture();
  player.velocity.set(0, 0, -3.1);
  for (const mode of ['first', 'third']) {
    player.cameraMode = mode; let maxSway = 0;
    for (let i = 0; i < 100; i++) {
      avatar.update(.016); avatar.updateWeapon(gun, { aimBlend: 1 });
      const frame = mode === 'first' ? camera.quaternion.clone() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
      const angle = new THREE.Euler().setFromQuaternion(frame.invert().multiply(gun.quaternion), 'YXZ');
      maxSway = Math.max(maxSway, Math.abs(angle.y), Math.abs(angle.z));
    }
    assert.ok(maxSway > (mode === 'first' ? .0003 : .001) && maxSway < .004, `${mode}: aimed walk must sway gently without losing aim`);
  }
});

test('footstep event phases coincide with descending foot contact in the supplied GLB', async () => {
  const { avatar } = await fixture();
  const height = side => Math.min(...['foot', 'toe'].map(name => avatar.bones[`DEF-${name}${side}`].getWorldPosition(new THREE.Vector3()).y));
  for (const gait of [GAITS.walk, GAITS.jog, GAITS.run]) {
    for (const [index, side] of ['L', 'R'].entries()) {
      let minimum = Infinity;
      for (let frame = 0; frame < 60; frame++) {
        avatar.setPreviewAnimation(gait.clip, gait.duration * frame / 60); minimum = Math.min(minimum, height(side));
      }
      const contact = gait.contacts[index];
      avatar.setPreviewAnimation(gait.clip, gait.duration * ((contact + .9) % 1)); const before = height(side);
      avatar.setPreviewAnimation(gait.clip, gait.duration * contact); const planted = height(side);
      assert.ok(planted < minimum + .025, `${gait.clip}/${side}: sound precedes ground contact`);
      assert.ok(before > planted + .003, `${gait.clip}/${side}: sound must mark landing, not lifting the foot`);
    }
  }
});

test('every imported weapon grip touches its mesh and stays attached through both camera modes', async () => {
  const { avatar, player, gun, camera } = await fixture();
  camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
  for (const id of Object.keys(WEAPON_MODEL_FITS)) {
    const loaded = prepareWeaponModel(await loadAvatarGeometry(new URL(`../../public/models/weapons/${id}.glb`, import.meta.url)), id);
    const kind = /knife|axe|bat/.test(id) ? 'melee' : 'firearm';
    loaded.model.updateMatrixWorld(true);
    let nearest = Infinity;
    loaded.model.traverse(mesh => {
      if (!mesh.isMesh) return;
      const position = mesh.geometry.attributes.position, index = mesh.geometry.index, count = index?.count ?? position.count;
      for (let i = 0; i < count; i += 3) {
        const points = [0, 1, 2].map(n => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + n) : i + n).applyMatrix4(mesh.matrixWorld));
        const closest = new THREE.Triangle(...points).closestPointToPoint(loaded.grip, new THREE.Vector3());
        nearest = Math.min(nearest, closest.distanceTo(loaded.grip) * .65);
      }
    });
    assert.ok(nearest < .032, `${id}: hand socket misses the actual handle mesh by ${nearest} m`);
    gun.clear(); gun.add(loaded.model); gun.userData.weaponGrip = loaded.grip;
    for (const mode of ['first', 'third']) {
      player.cameraMode = mode; avatar.setWeapon({ id, kind }); avatar.update(.016); avatar.updateWeapon(gun, { weapon: id, kind });
      assert.ok(avatar.weaponDiagnostics.gripError < .003, `${mode}/${id}: detached grip`);
      if (kind === 'melee') {
        const calibration = avatar.poseConfig.get(id, mode);
        const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(...['x', 'y', 'z'].map(axis => THREE.MathUtils.degToRad(calibration.rotation[axis]))));
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(gun.quaternion.clone().multiply(delta.invert()));
        const first = mode === 'first';
        const expected = first ? new THREE.Vector3(0, Math.sin(.35), -Math.cos(.35)) : new THREE.Vector3(0, 1, 0);
        assert.ok(direction.angleTo(expected) < (mode === 'third' ? .35 : .2), `${mode}/${id}: blade/shaft orientation misses its held pose`);
        assert.ok(Math.abs(avatar.root.scale.x - (first ? .76 : 1)) < 1e-8, `${id}: first-person scaling leaked into third person`);
        assert.ok(Math.abs(gun.scale.x / avatar.root.scale.x - .65 * calibration.scale.x) < 1e-8, `${id}: arms and weapon must scale together before socket calibration`);
        if (first) {
          const tip = gun.localToWorld(loaded.muzzle.clone()).project(camera);
          assert.ok(tip.toArray().every(Number.isFinite), `${id}: calibrated melee tip is non-finite`);
          const hand = camera.worldToLocal(avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3()));
          assert.ok(hand.x > .14 && hand.y < -.25, `${id}: first-person guard must sit lower and farther right of center`);
        }
        avatar.playAttack({ id, kind, interval: .65 });
        for (let frame = 0; frame < 13; frame++) {
          avatar.update(.05); avatar.updateWeapon(gun, { weapon: id, kind });
          assert.ok(avatar.weaponDiagnostics.gripError < .003, `${mode}/${id}: grip detached during swing`);
          if (mode === 'first') for (const side of ['R', 'L']) {
            const shoulder = camera.worldToLocal(avatar.bones[`DEF-upper_arm${side}`].getWorldPosition(new THREE.Vector3()));
            const projection = shoulder.clone().applyMatrix4(camera.projectionMatrix);
            assert.ok(shoulder.z > -camera.near || Math.abs(projection.y) > 1 || Math.abs(projection.x) > 1, `${id}: sword animation exposes the shoulder cut`);
          }
        }
      } else {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(gun.quaternion);
        assert.ok(forward.angleTo(new THREE.Vector3(0, 0, -1)) < .05, `${mode}/${id}: firearm does not point forward`);
      }
    }
  }
});

test('authored sword swings and alternating punches remain visible and hand-aligned in both cameras', async () => {
  const { avatar, player, gun } = await fixture();
  gun.userData.weaponGrip = new THREE.Vector3(0, -.1, .05);
  for (const mode of ['first', 'third']) {
    player.cameraMode = mode;
    avatar.setWeapon({ id: 'knife', kind: 'melee' }); avatar.update(.016);
    avatar.updateWeapon(gun, { weapon: 'knife', kind: 'melee' });
    assert.deepEqual(avatar.playAttack({ id: 'knife', kind: 'melee', interval: .65 }), { clip: 'Sword_Attack', duration: .65 });
    const positions = [];
    for (let i = 0; i < 13; i++) {
      avatar.update(.05); avatar.updateWeapon(gun, { weapon: 'knife', kind: 'melee' });
      positions.push(gun.position.clone());
      assert.ok(avatar.weaponDiagnostics.gripError < .003, `${mode}: sword detached during attack`);
    }
    assert.ok(positions.some(position => position.distanceTo(positions[0]) > .08), `${mode}: sword swing was erased by framing`);
    assert.equal(avatar.animationState.attack, null);
    const first = avatar.playAttack({ id: 'fists', kind: 'unarmed', interval: .42 });
    for (let i = 0; i < 10; i++) { avatar.update(.05); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' }); }
    const second = avatar.playAttack({ id: 'fists', kind: 'unarmed', interval: .42 });
    assert.notEqual(first.clip, second.clip);
    assert.ok(['Punch_Jab', 'Punch_Cross'].includes(first.clip) && ['Punch_Jab', 'Punch_Cross'].includes(second.clip));
    for (let i = 0; i < 10; i++) { avatar.update(.05); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' }); }
  }
});

test('first-person Quaternius framing hides shoulder cuts and leaves the reticle clear during recoil', async () => {
  const { avatar, camera, player, gun } = await fixture();
  player.cameraMode = 'first'; camera.position.copy(player.eyePosition);
  const ray = new THREE.Raycaster(), direction = new THREE.Vector3();
  for (const weapon of ['pistol', 'automatic', 'revolver', 'shotgun', 'sniper', 'smg']) {
    const loaded = prepareWeaponModel(await loadAvatarGeometry(new URL(`../../public/models/weapons/${weapon}.glb`, import.meta.url)), weapon);
    gun.clear(); gun.add(loaded.model); gun.userData.weaponGrip = loaded.grip;
    for (const aspect of [390 / 844, 1.6, 844 / 390]) for (const aimBlend of [0, 1]) for (const pitch of [-1, 0, 1]) {
      camera.aspect = aspect; camera.fov = aimBlend ? 45 : 70;
      camera.rotation.set(pitch, .7, 0, 'YXZ'); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      avatar.update(0); avatar.updateWeapon(gun, { weapon, aimBlend }); avatar.playShot(weapon === 'shotgun' ? 2.8 : 1);
      for (let frame = 0; frame < 16; frame++) {
        avatar.update(.025); avatar.updateWeapon(gun, { weapon, aimBlend, recoil: weapon === 'shotgun' ? 2.8 * Math.exp(-frame * .25) : 0 });
        camera.getWorldDirection(direction); ray.set(camera.position, direction);
        assert.equal(ray.intersectObject(gun, true).length, 0, `${weapon}/${aspect}/${aimBlend}: recoil obscures reticle`);
        for (const [x, y] of [[0, -.035], [-.035, 0], [.035, 0]]) {
          ray.setFromCamera(new THREE.Vector2(x, y), camera);
          assert.equal(ray.intersectObject(gun, true).length, 0, `${weapon}/${aspect}/${aimBlend}: gun obscures the reticle ring`);
        }
        for (const side of ['R', 'L']) {
          const shoulder = camera.worldToLocal(avatar.bones[`DEF-upper_arm${side}`].getWorldPosition(new THREE.Vector3()));
          assert.ok(shoulder.z > -camera.near, `${weapon}: shoulder cut enters the visible camera volume`);
        }
      }
    }
  }
});

test('scope hides only first-person arms and restores both camera views on exit', async () => {
  const { avatar, player, gun } = await fixture();
  player.cameraMode = 'first'; avatar.update(0); avatar.updateWeapon(gun, { weapon: 'sniper', scoped: true });
  assert.equal(avatar.meshes.filter(mesh => mesh.visible).length, 0);
  player.cameraMode = 'third'; avatar.update(0); avatar.updateWeapon(gun, { weapon: 'sniper', scoped: true });
  assert.ok(avatar.meshes.every(mesh => mesh.visible === !mesh.userData.characterHidden));
  player.cameraMode = 'first'; avatar.update(0); avatar.updateWeapon(gun, { weapon: 'sniper', scoped: false });
  assert.equal(avatar.meshes.filter(mesh => mesh.visible).length, 2);
  assert.ok(avatar.weaponDiagnostics.gripError < .003);
});

test('a stronger authored shot produces a visibly larger third-person recoil', async () => {
  const peaks = [];
  for (const strength of [1, 2.8]) {
    const { avatar, gun } = await fixture(); avatar.update(0); avatar.updateWeapon(gun);
    const neutral = gun.quaternion.clone(); avatar.playShot(strength); let peak = 0;
    for (let i = 0; i < 25; i++) {
      avatar.update(.025); avatar.updateWeapon(gun); peak = Math.max(peak, neutral.angleTo(gun.quaternion));
    }
    peaks.push(peak);
  }
  assert.ok(peaks[1] > peaks[0] * 1.7, 'shotgun strength must visibly affect the authored recoil');
});

test('supplied GLB preserves locomotion and pistol clips with bounded finite animated geometry', async () => {
  const { avatar } = await fixture();
  const required = ['Idle_Loop', 'Walk_Loop', 'Sprint_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload'];
  assert.ok(required.every(name => avatar.clips.some(clip => clip.name.split('|').at(-1) === name)));
  for (const name of required) {
    const clip = avatar.clips.find(clip => clip.name.split('|').at(-1) === name);
    for (const fraction of [0, .25, .5, .75]) {
      avatar.setPreviewAnimation(name, clip.duration * fraction);
      for (const mesh of avatar.meshes.filter(mesh => mesh.isSkinnedMesh)) {
        mesh.skeleton.update(); mesh.computeBoundingBox();
        const box = mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        assert.ok([...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite), `${name}/${fraction}/${mesh.name}`);
        assert.ok(box.getSize(new THREE.Vector3()).length() < 4, `${name}: exploding ${mesh.name}`);
      }
    }
  }
  avatar.setPreviewAnimation(null);
});

test('input between render frames samples the same camera/hand pose as the next frame', async () => {
  const { avatar, camera, player, gun } = await fixture();
  player.cameraMode = 'first'; player.feet.set(10000, 0, 10000); player.eyePosition.copy(player.feet).y += 1.7;
  for (const [weapon, kind] of [['pistol', 'firearm'], ['fists', 'unarmed'], ['axe', 'melee']]) {
    avatar.setWeapon({ id: weapon, kind }); avatar.update(.016); avatar.updateWeapon(gun, { weapon, kind });
    camera.rotation.set(.3, .6, 0, 'YXZ');
    avatar.updateWeapon(gun, { weapon, kind });
    const before = ['R', 'L'].map(side => avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3()));
    avatar.update(0); avatar.updateWeapon(gun, { weapon, kind });
    for (const [i, side] of ['R', 'L'].entries()) assert.ok(before[i].distanceTo(avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3())) < 1e-5, `${weapon}: stale hand pose after camera input`);
    camera.rotation.set(0, 0, 0);
  }
});

test('first-person boxing keeps both closed fists visible through jab/cross and hides arm starts in both orientations', async () => {
  const { avatar, player, camera, gun } = await fixture();
  player.cameraMode = 'first'; camera.position.copy(player.eyePosition);
  const outside = point => {
    const local = point.clone().applyMatrix4(camera.matrixWorldInverse), projected = point.clone().project(camera);
    return local.z > -camera.near || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1;
  };
  const punchClip = avatar.clips.find(clip => clip.name.endsWith('|Punch_Enter'));
  for (const aspect of [390 / 844, 844 / 390]) for (const pitch of [-1.1, 0, 1.1]) {
    camera.rotation.set(pitch, .7, 0, 'YXZ');
    camera.aspect = aspect; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    avatar.setWeapon({ id: 'fists', kind: 'unarmed' }); avatar.update(.016); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
    for (const side of ['R', 'L']) {
      const projected = avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3()).project(camera);
      assert.ok(Math.abs(projected.x) < .85 && Math.abs(projected.y) < .85, `${aspect}/${side}: fist guard is offscreen`);
      const track = punchClip.tracks.find(track => track.name === `DEF-f_index02${side}.quaternion`);
      const original = new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(punchClip.duration - .001));
      assert.ok(avatar.bones[`DEF-f_index02${side}`].quaternion.angleTo(original) > .4, 'close view must tighten the original loose finger curl');
    }
    for (const sequence of [0, 1]) {
      avatar.playAttack({ id: 'fists', kind: 'unarmed', interval: .42 }, { sequence });
      for (let i = 0; i < 14; i++) {
        avatar.update(.03); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
        for (const side of ['R', 'L']) {
          const shoulder = avatar.bones[`DEF-upper_arm${side}`].getWorldPosition(new THREE.Vector3());
          assert.ok(outside(shoulder), `${side}: punching exposes the shoulder cut`);
          const fist = avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3()).project(camera);
          assert.ok(Math.abs(fist.x) < .9 && Math.abs(fist.y) < .98 && fist.z > -1 && fist.z < 1, `${side}: fist leaves the view during the punch`);
        }
      }
    }
  }
});

test('first-person jab and cross extend the whole arm toward the target and recover the guard', async () => {
  for (const aspect of [16 / 9, 390 / 844]) {
    const { avatar, player, camera, gun } = await fixture();
    player.cameraMode = 'first'; camera.aspect = aspect; camera.position.copy(player.eyePosition);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const weapon = { id: 'fists', kind: 'unarmed', interval: .42 };
    avatar.setWeapon(weapon); avatar.update(0); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
    for (const sequence of [0, 1]) {
      const side = sequence ? 'R' : 'L', frames = [];
      const sample = () => {
        const point = name => camera.worldToLocal(avatar.bones['DEF-' + name + side].getWorldPosition(new THREE.Vector3()));
        const shoulder = point('upper_arm'), elbow = point('forearm'), wrist = point('hand');
        return { shoulder, elbow, wrist, bend: elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow)) };
      };
      const idle = sample(); avatar.playAttack(weapon, { sequence });
      for (let frame = 0; frame < 28; frame++) {
        avatar.update(.015); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' }); frames.push(sample());
      }
      const impact = frames.reduce((best, frame) => frame.wrist.z < best.wrist.z ? frame : best);
      assert.ok(idle.wrist.z - impact.wrist.z > .20, 'fist must travel forward visibly');
      assert.ok(idle.shoulder.z - impact.shoulder.z > .15, 'shoulder must drive the strike');
      assert.ok(idle.elbow.distanceTo(impact.elbow) > .15, 'elbow must travel with the forearm');
      assert.ok(idle.bend - impact.bend > .5, 'elbow must unfold');
      assert.ok(frames.at(-1).wrist.distanceTo(idle.wrist) < .025, 'guard must recover');
      for (const frame of frames) {
        const projected = frame.wrist.clone().applyMatrix4(camera.projectionMatrix);
        assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, 'striking fist stays visible');
        assert.ok(frame.shoulder.z > -camera.near || Math.abs(frame.shoulder.clone().applyMatrix4(camera.projectionMatrix).y) > 1, 'arm start stays offscreen');
      }
    }
  }
});

test('authored reload moves the arm, keeps the weapon socket and completes at the ammo duration at 10 fps', async () => {
  for (const mode of ['first', 'third']) {
    const { avatar, player, camera, gun } = await fixture(); player.cameraMode = mode;
    camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
    avatar.update(0); avatar.updateWeapon(gun); const original = avatar.bones['DEF-handL'].getWorldPosition(new THREE.Vector3());
    assert.equal(avatar.playReload(2.2), true); let travel = 0;
    for (let frame = 0; frame < 23; frame++) {
      avatar.update(.1); avatar.updateWeapon(gun);
      travel = Math.max(travel, original.distanceTo(avatar.bones['DEF-handL'].getWorldPosition(new THREE.Vector3())));
      assert.ok(avatar.weaponDiagnostics.gripError < .003);
      if (frame === 10) assert.equal(avatar.animationState.reload, 'Pistol_Reload');
    }
    assert.ok(travel > .08); assert.equal(avatar.animationState.reload, null);
    avatar.playReload(); avatar.setWeapon({ id: 'fists', kind: 'unarmed' }); assert.equal(avatar.animationState.reload, null);
  }
});

test('first-person boxing framing is repeatable, accepts arm edits and restores original third-person joints', async () => {
  const { avatar, player, camera, gun } = await fixture();
  avatar.setWeapon({ id: 'fists', kind: 'unarmed' }); avatar.update(0);
  const names = ['DEF-upper_armR', 'DEF-forearmL', 'DEF-handR', 'DEF-f_index02L'];
  const original = names.map(name => ({ position: avatar.bones[name].position.clone(), quaternion: avatar.bones[name].quaternion.clone() }));
  player.cameraMode = 'first'; camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
  avatar.update(0); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
  const first = avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3());
  avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
  assert.ok(first.distanceTo(avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3())) < 1e-6);
  avatar.poseConfig.set('fists', 'first', 'arms', 'position', 'x', .07);
  avatar.poseConfig.set('fists', 'first', 'arms', 'rotation', 'z', 8);
  avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
  const edited = avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3());
  assert.ok(first.distanceTo(edited) > .04);
  avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
  assert.ok(edited.distanceTo(avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3())) < 1e-6);
  player.cameraMode = 'third'; avatar.update(0); avatar.updateWeapon(gun, { weapon: 'fists', kind: 'unarmed' });
  for (const [i, name] of names.entries()) {
    assert.ok(avatar.bones[name].position.distanceTo(original[i].position) < 1e-6, `${name}: first-person joint placement leaked into third person`);
    assert.ok(avatar.bones[name].quaternion.angleTo(original[i].quaternion) < 1e-3, `${name}: first-person curl/IK leaked into third person`);
  }
});

test('melee and unarmed heads stay upright during running and both attacks', async () => {
  const { avatar, player, camera } = await fixture();
  player.velocity.set(9.5, 0, 0);
  for (const [id, kind] of [['fists', 'unarmed'], ['axe', 'melee']]) for (const pitch of [-.8, 0, .8]) {
    camera.rotation.set(pitch, .7, 0, 'YXZ'); avatar.setWeapon({ id, kind });
    avatar.playAttack({ id, kind, interval: .7 });
    const expectedUp = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 20; i++) {
      avatar.update(.04);
      const headUp = expectedUp.clone().applyQuaternion(avatar.bones['DEF-head'].getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(headUp.dot(expectedUp) > .995, `${id}: head looks down with the attack/hips`);
    }
  }
});

test('debug socket transforms stay independent of camera framing and do not accumulate', async () => {
  const { avatar, player, camera, gun } = await fixture();
  player.cameraMode = 'first'; camera.position.copy(player.eyePosition);
  avatar.update(0); avatar.updateWeapon(gun); const original = gun.position.clone(), palm = avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3());
  avatar.poseConfig.set('pistol', 'first', 'weapon', 'position', 'x', .1);
  avatar.poseConfig.set('pistol', 'first', 'weapon', 'rotation', 'z', 15);
  avatar.poseConfig.set('pistol', 'first', 'weapon', 'scale', 'y', 1.2);
  avatar.updateWeapon(gun); const edited = gun.position.clone();
  assert.ok(edited.distanceTo(original) > .05, 'first-person automatic framing must not cancel the socket edit');
  assert.ok(avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3()).distanceTo(palm) < 1e-5, 'socket edits must leave the hands in their camera framing');
  avatar.updateWeapon(gun); assert.ok(gun.position.distanceTo(edited) < 1e-5);
  assert.ok(avatar.weaponDiagnostics.gripError < .003);
  player.cameraMode = 'third'; avatar.update(0); avatar.updateWeapon(gun);
  assert.equal(avatar.poseConfig.get('pistol', 'third').position.x, 0);
  avatar.poseConfig.set('pistol', 'first', 'arms', 'position', 'x', .05);
  player.cameraMode = 'first'; avatar.update(0); avatar.updateWeapon(gun); const armEdited = gun.position.clone();
  avatar.updateWeapon(gun); assert.ok(gun.position.distanceTo(armEdited) < 1e-5);
});

test('holstering uses the full normal idle with lowered hands and restores the previous guard', async () => {
  for (const [weapon, kind] of [['pistol', 'firearm'], ['knife', 'melee'], ['fists', 'unarmed']]) {
    const { avatar, player, camera, gun } = await fixture();
    const state = { weapon, kind }; avatar.setWeapon({ id: weapon, kind }); avatar.update(0); avatar.updateWeapon(gun, state);
    const ready = avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3());
    avatar.updateWeapon(gun, { ...state, holstered: true });
    for (let i = 0; i < 8; i++) { avatar.update(.05); avatar.updateWeapon(gun, { ...state, holstered: true }); }
    assert.equal(avatar.animationState.motion, 'Idle_Loop'); assert.equal(avatar.animationState.kind, 'relaxed');
    const hand = avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3());
    const shoulder = avatar.bones['DEF-upper_armR'].getWorldPosition(new THREE.Vector3());
    assert.ok(shoulder.y - hand.y > .4, `${weapon}: relaxed idle must lower the arms`);
    player.cameraMode = 'first'; camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
    avatar.update(0); avatar.updateWeapon(gun, { ...state, holstered: true });
    assert.equal(avatar.meshes.filter(mesh => mesh.visible).length, 0, 'relaxed first person must leave the view clear');
    player.cameraMode = 'third'; avatar.updateWeapon(gun, state); avatar.update(0); avatar.updateWeapon(gun, state);
    assert.equal(avatar.animationState.kind, kind);
    assert.ok(ready.distanceTo(avatar.bones['DEF-handR'].getWorldPosition(new THREE.Vector3())) < .03, `${weapon}: previous guard did not return`);
  }
});

test('crouch selects authored idle/walking clips, lowers the body and keeps first-person fists and weapons framed', async () => {
  const { avatar, player, camera, gun } = await fixture();
  avatar.setWeapon({ id: 'fists', kind: 'unarmed' }); avatar.update(0);
  const standing = avatar.bones['DEF-head'].getWorldPosition(new THREE.Vector3()).y;
  player.crouched = true; player.eyePosition.y = 1.1;
  for (let i = 0; i < 8; i++) avatar.update(.05);
  assert.equal(avatar.animationState.motion, 'Crouch_Idle_Loop');
  assert.ok(avatar.bones['DEF-head'].getWorldPosition(new THREE.Vector3()).y < standing - .25);
  player.velocity.set(0, 0, -1.6);
  for (let i = 0; i < 8; i++) avatar.update(.05);
  assert.equal(avatar.animationState.motion, 'Crouch_Fwd_Loop');
  player.cameraMode = 'first'; camera.position.copy(player.eyePosition); camera.aspect = 390 / 844;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  for (const [weapon, kind] of [['fists', 'unarmed'], ['knife', 'melee'], ['pistol', 'firearm']]) {
    player.crouched = false; player.eyePosition.y = 1.7; camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
    avatar.setWeapon({ id: weapon, kind });
    for (let i = 0; i < 8; i++) { avatar.update(.03); avatar.updateWeapon(gun, { weapon, kind }); }
    const standingGuard = Object.fromEntries(['R', 'L'].map(side => [side, camera.worldToLocal(avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3()))]));
    player.crouched = true; player.eyePosition.y = 1.1; camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
    for (let i = 0; i < 16; i++) {
      avatar.update(.03); avatar.updateWeapon(gun, { weapon, kind });
      for (const side of ['R', 'L']) {
        const hand = avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3()).project(camera);
        if (kind === 'unarmed') assert.ok(Math.abs(hand.x) < 1 && Math.abs(hand.y) < 1 && hand.z > -1 && hand.z < 1, `${side}: crouch moves the fists offscreen`);
        const localHand = camera.worldToLocal(avatar.bones[`DEF-hand${side}`].getWorldPosition(new THREE.Vector3()));
        assert.ok(localHand.distanceTo(standingGuard[side]) < .04, `${weapon}/${side}: crouch changes the camera-relative guard`);
        const shoulder = camera.worldToLocal(avatar.bones[`DEF-upper_arm${side}`].getWorldPosition(new THREE.Vector3()));
        const projection = shoulder.clone().applyMatrix4(camera.projectionMatrix);
        assert.ok(shoulder.z > -camera.near || Math.abs(projection.x) > 1 || Math.abs(projection.y) > 1, `${weapon}: crouch exposes the arm start`);
      }
      assert.ok(avatar.weaponDiagnostics.gripError < .003);
    }
  }
});

test('flight plays the complete authored swimming animation for every equipment state and returns to the ground pose', async () => {
  const reference = await fixture(); reference.avatar.setPreviewAnimation('Swim_Fwd_Loop', .48);
  const names = ['DEF-hips', 'DEF-spine001', 'DEF-head', 'DEF-upper_armL', 'DEF-forearmR', 'DEF-handR', 'DEF-thighR', 'DEF-footL'];
  for (const mode of ['third', 'first']) for (const [weapon, kind, holstered] of [['pistol', 'firearm', false], ['fists', 'unarmed', false], ['knife', 'melee', true]]) {
    const { avatar, player, camera, gun } = await fixture(); const state = { weapon, kind, holstered };
    player.cameraMode = mode; camera.position.copy(player.eyePosition); camera.updateMatrixWorld(true);
    avatar.updateWeapon(gun, state);
    player.fly = true; player.grounded = false; player.velocity.set(0, 0, -16);
    for (let i = 0; i < 8; i++) { avatar.update(.05); avatar.updateWeapon(gun, state); }
    assert.equal(avatar.animationState.motion, 'Swim_Fwd_Loop');
    for (const name of names) assert.ok(avatar.bones[name].quaternion.angleTo(reference.avatar.bones[name].quaternion) < 1e-4,
      `${mode}/${weapon}/${name}: aim/boxing/hip correction must not overwrite swimming`);
    player.fly = false; player.grounded = true; player.velocity.set(0, 0, 0);
    avatar.update(.05); avatar.updateWeapon(gun, state);
    assert.equal(avatar.animationState.motion, 'Idle_Loop'); assert.equal(avatar.animationState.kind, holstered ? 'relaxed' : kind);
  }
});
