import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadAvatarGeometry } from './load-avatar.mjs';
import { createAvatarFromGLTF } from '../../src/player/avatar.js';
import { createStyler } from '../../src/core/style.js';
import { DEFAULT_APPEARANCE } from '../../src/core/characters.js';

async function fixture() {
  const gltf = await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70);
  const player = { feet: new THREE.Vector3(), eyePosition: new THREE.Vector3(0, 1.7, 0), velocity: new THREE.Vector3(), active: true, grounded: true, cameraMode: 'third', yaw: 0 };
  return { avatar: createAvatarFromGLTF(gltf, { scene, camera, player }), scene, player };
}

test('appearance styles preserve skeleton/skin data, reset rest shapes and follow the animated head', async () => {
  const { avatar, player } = await fixture();
  const trousers = avatar.meshes.find(m => m.name === 'Sato_trousers_1');
  const original = trousers.geometry.attributes.position.array.slice(), skin = trousers.geometry.attributes.skinWeight.array.slice();
  const clips = avatar.clips.map(clip => clip.toJSON()), bones = Object.values(avatar.bones);
  const look = { ...DEFAULT_APPEARANCE, hairStyle: 'sidecut', beard: 'full', shirtStyle: 'stripes', shirtColor: '#ff3300', pantsStyle: 'cargo', shoeStyle: 'high', faceAccessory: 'mask', headAccessory: 'headphones' };
  avatar.appearance.apply(look); avatar.setWeapon({ holstered: true }); avatar.update(.016);
  assert.notDeepEqual(trousers.geometry.attributes.position.array, original);
  assert.deepEqual(trousers.geometry.attributes.skinWeight.array, skin);
  assert.deepEqual(avatar.clips.map(clip => clip.toJSON()), clips); assert.deepEqual(Object.values(avatar.bones), bones);
  assert.ok(avatar.meshes.filter(m => m.name.startsWith('Sato_hair_cap')).every(m => !m.visible));
  const hair = avatar.model.getObjectByName('character-hair:sidecut');
  assert.equal(hair.parent, avatar.bones['DEF-head']); assert.equal(hair.visible, true);
  avatar.appearance.apply(look); assert.deepEqual(trousers.geometry.attributes.skinWeight.array, skin);
  player.cameraMode = 'first'; avatar.update(.016); assert.equal(hair.visible, false);
  avatar.appearance.apply(DEFAULT_APPEARANCE); player.cameraMode = 'third'; avatar.update(.016);
  assert.deepEqual(trousers.geometry.attributes.position.array, original);
  assert.ok(avatar.meshes.filter(m => m.name.startsWith('Sato_hair_cap')).every(m => !m.visible));
  assert.equal(avatar.model.getObjectByName('character-hair:original').visible, true);
  assert.equal(hair.visible, false);
});

test('new appearances reach collected toon and standard materials and do not leak between avatars', async () => {
  const first = await fixture(), second = await fixture();
  const styler = createStyler(first.scene, {}, { intensity: 1 }); styler.collect(); styler.setCartoon(true);
  const shirt = first.avatar.meshes.find(m => m.name === 'Sato_shirt_2');
  first.avatar.appearance.apply({ shirtColor: '#ee1122', shirtStyle: 'sport', hairStyle: 'buns', hairColor: '#ffcc00', headAccessory: 'beanie' });
  assert.equal(shirt.material.color.getHexString(), 'ee1122');
  assert.equal(shirt.userData.stdMaterial.color.getHexString(), 'ee1122');
  assert.ok(shirt.material.map?.isDataTexture);
  assert.equal(first.avatar.model.getObjectByName('character-hair:buns').visible, false, 'headwear hides protruding hair');
  assert.equal(first.avatar.model.getObjectByName('character-head:beanie').visible, true);
  assert.deepEqual(second.avatar.appearance.value, DEFAULT_APPEARANCE);
  styler.setCartoon(false); assert.equal(shirt.material.color.getHexString(), 'ee1122');
  first.avatar.appearance.apply(DEFAULT_APPEARANCE); assert.equal(shirt.material.map, null);
});

test('hair covers the back and nape, and hats preserve the selected hair color', async () => {
  const { avatar } = await fixture();
  for (const hairStyle of ['original', 'crop', 'long', 'buns', 'sidecut']) {
    avatar.appearance.apply({ hairStyle }); avatar.update(0);
    const group = avatar.model.getObjectByName(`character-hair:${hairStyle}`), scalp = group.children[0].geometry.attributes.position;
    assert.equal(group.visible, true);
    assert.equal(group.children.length, 1, 'each hairstyle uses a single draw call');
    assert.match(group.userData.hairSource, /^Hair_/);
    let nape = false;
    for (let i = 0; i < scalp.count; i++) if (scalp.getZ(i) < -.07 && scalp.getY(i) < .815) nape = true;
    assert.ok(nape, `${hairStyle} must extend behind the ears`);
  }
  for (const headAccessory of ['cap', 'backwards', 'beanie']) {
    avatar.appearance.apply({ headAccessory, hairColor: '#ffbb22', hairStyle: 'buns' }); avatar.update(0);
    const nape = avatar.model.getObjectByName('character-nape:hair');
    assert.equal(nape.visible, true); assert.equal(nape.children[0].material.color.getHexString(), 'ffbb22');
    assert.equal(avatar.model.getObjectByName('character-hair:buns').visible, false);
  }
  avatar.appearance.apply({ hairStyle: 'bald', headAccessory: 'cap' }); avatar.update(0);
  assert.equal(avatar.model.getObjectByName('character-nape:hair').visible, false);
});

test('skin and female rest shape remain independent and revert without altering animation weights', async () => {
  const first = await fixture(), second = await fixture();
  const shirt = first.avatar.meshes.find(m => m.name === 'Sato_shirt_2');
  const rest = shirt.geometry.attributes.position.array.slice(), weights = shirt.geometry.attributes.skinWeight.array.slice();
  first.avatar.appearance.apply({ gender: 'female', skinColor: '#643f2d' });
  assert.notDeepEqual(shirt.geometry.attributes.position.array, rest);
  const female = shirt.geometry.attributes.position.array.slice();
  first.avatar.appearance.apply({ gender: 'female', skinColor: '#643f2d' });
  assert.deepEqual(shirt.geometry.attributes.position.array, female, 'editing repeatedly cannot accumulate deformation');
  assert.deepEqual(shirt.geometry.attributes.skinWeight.array, weights);
  const skin = first.avatar.meshes.filter(m => m.material.name.includes('warm peach skin'));
  assert.ok(skin.length > 0); assert.ok(skin.every(m => m.material.color.getHexString() === '643f2d'));
  assert.deepEqual(second.avatar.appearance.value, DEFAULT_APPEARANCE);
  first.avatar.appearance.apply(DEFAULT_APPEARANCE);
  assert.deepEqual(shirt.geometry.attributes.position.array, rest);
});

test('formal outfits have skinned sleeves, optional ties and lapels without changing skin weights', async () => {
  const { avatar } = await fixture();
  for (const shirtStyle of ['social', 'socialTie', 'suit', 'suitTie']) {
    avatar.appearance.apply({ shirtStyle, pantsStyle: 'dress', shoeStyle: 'dress' }); avatar.update(.016);
    const sleeves = avatar.model.getObjectByName('character-clothes:formal');
    assert.equal(sleeves.visible, true); assert.ok(sleeves.children.every(mesh => mesh.isSkinnedMesh && mesh.geometry.index.count > 0));
    assert.equal(avatar.model.getObjectByName('character-clothes:tie').visible, shirtStyle.endsWith('Tie'));
    assert.equal(avatar.model.getObjectByName('character-clothes:lapels').visible, shirtStyle.startsWith('suit'));
  }
  avatar.appearance.apply(DEFAULT_APPEARANCE); avatar.update(0);
  assert.equal(avatar.model.getObjectByName('character-clothes:formal').visible, false);
});

test('dance uses the supplied full body clip, cancels on movement, and leaves weapon poses usable', async () => {
  const { avatar, player } = await fixture(); avatar.playEmote('dance'); avatar.update(.05);
  assert.equal(avatar.animationState.motion, 'Dance_Loop'); assert.equal(avatar.animationState.emote, 'dance');
  const before = avatar.bones['DEF-upper_armR'].quaternion.clone(); avatar.update(.3);
  assert.ok(before.angleTo(avatar.bones['DEF-upper_armR'].quaternion) > .01);
  player.velocity.x = 3; avatar.update(.05); assert.equal(avatar.animationState.emote, null);
  avatar.playEmote('dance'); avatar.playShot(); avatar.update(.05); assert.notEqual(avatar.animationState.motion, 'Dance_Loop');
  player.velocity.x = 0; avatar.playEmote('dance'); avatar.update(.05); avatar.stopEmote(); avatar.update(.05);
  assert.equal(avatar.animationState.emote, null); assert.notEqual(avatar.animationState.motion, 'Dance_Loop');
});
