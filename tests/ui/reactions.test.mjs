import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createReactions } from '../../src/ui/reactions.js';
import { createEvents } from '../../src/core/events.js';
import { EMOTES } from '../../src/shared/multiplayer.js';
import { domFixture } from './feedback-dom.mjs';

function fixture(t) {
  const { hud } = domFixture(t), scene = new THREE.Scene(), systems = [], played = [];
  const player = { active: true, cameraMode: 'first', feet: new THREE.Vector3(2, 0, 3), events: new EventTarget(),
    avatar: { animationState: { emote: null }, playEmote(id) { played.push(id); if (['wave', 'dance'].includes(id)) this.animationState.emote = id; }, stopEmote() { this.animationState.emote = null; } },
    setCameraMode(value) { this.cameraMode = value; }, setWeaponWheelOpen() {}, releasePointerForUI() {}, setFocusedAim() {} };
  const game = { mode: 'training', player, events: createEvents(), ui: { characters: { openState: false }, combatHUD: { panelOpen: false } },
    input: { bind() {} }, paintball: { resetInput() {} }, engine: { scene, addSystem: fn => systems.push(fn) },
    multiplayer: { network: { session: { selfId: 'me' } } } };
  const reactions = createReactions(game), update = dt => systems.forEach(fn => fn(dt));
  return { game, player, played, scene, hud, reactions, update };
}

for (const id of ['wave', 'dance']) test(`${id} produces body animation only and restores the first person camera afterwards`, t => {
    const { player, played, scene, reactions, update } = fixture(t);
    reactions.react(id); assert.deepEqual(played, [id]); assert.equal(player.cameraMode, 'third');
    assert.equal(scene.children.length, 0, 'body gestures must never spawn an emoji');
    player.avatar.animationState.emote = null; update(.016); assert.equal(player.cameraMode, 'first');
  assert.equal(EMOTES.wave, null); assert.equal(EMOTES.dance, null);
});

test('Kenney reactions are depth-tested scene sprites and release their material when they expire', t => {
  const { reactions, scene, hud, update } = fixture(t);
  reactions.react('smile'); const sprite = scene.children[0];
  assert.ok(sprite.isSprite); assert.equal(sprite.name, 'kenney-reaction-smile');
  assert.ok(sprite.material.map.isTexture); assert.equal(sprite.material.depthTest, true); assert.equal(sprite.material.depthWrite, false);
  assert.equal(hud.children.length, 2, 'sending a reaction cannot append a DOM bubble');
  let disposed = false; sprite.material.addEventListener('dispose', () => { disposed = true; });
  for (let i = 0; i < 27; i++) update(.1);
  assert.equal(scene.children.length, 0); assert.equal(disposed, true);
});

test('remote reactions use the same scene and a mode change removes all transient sprites', t => {
  const { game, scene, player } = fixture(t); game.mode = 'multiplayer';
  game.events.emit('multiplayerevent', { type: 'emote', player: 'other', emote: 'heart', position: { x: 4, y: 2, z: 6 } });
  assert.equal(scene.children.length, 1); assert.equal(scene.children[0].position.y, 4.2); assert.equal(player.cameraMode, 'first');
  game.events.emit('multiplayerevent', { type: 'emote', player: 'other', emote: 'wave', position: { x: 4, y: 2, z: 6 } });
  assert.equal(scene.children.length, 1, 'remote waving has no additional emoji');
  game.events.emit('modechange'); assert.equal(scene.children.length, 0);
});
