import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCombatFeedback } from '../../src/ui/combat-feedback.js';
import { createEvents } from '../../src/core/events.js';
import { WEAPONS } from '../../src/gameplay/paintball/weapons.js';
import { domFixture } from './feedback-dom.mjs';

function fixture(t) {
  const { hud } = domFixture(t), camera = new THREE.PerspectiveCamera(70, 1, .1, 100);
  camera.position.set(0, 2, 4); camera.lookAt(0, 1.5, 0); camera.updateMatrixWorld(true);
  const head = new THREE.Object3D(); head.position.y = 1.6; head.updateMatrixWorld(true);
  const game = { mode: 'training', engine: { camera, addSystem() {} }, events: createEvents(), paintball: { weapons: WEAPONS },
    player: { active: true, cameraMode: 'third', character: { name: 'Joana' }, avatar: { bones: { 'DEF-head': head } } },
    combat: { player: { id: 'me', health: { current: 100, max: 100 }, dead: null } },
    multiplayer: { network: { session: { selfId: 'me' } }, roster: new Map([['other', { character: { name: 'Biel' } }]]), self: { id: 'me', health: 100, maxHealth: 100 }, snapshot: { players: [{ id: 'other', health: 20 }] } } };
  return { game, hud, feedback: createCombatFeedback(game) };
}

test('only damaged self health gets a head indicator; remote health cannot change it', t => {
  const { game, feedback, hud } = fixture(t);
  feedback.update(.016); assert.equal(feedback.health.hidden, true);
  game.combat.player.health.current = 70; feedback.update(.016);
  assert.equal(feedback.health.hidden, false); assert.equal(feedback.health.querySelector('b').textContent, '70 / 100');
  assert.equal(feedback.health.querySelector('i').style.width, '70%');
  assert.ok(parseFloat(feedback.health.style.top) < 50, 'the label projects above the head');
  game.mode = 'multiplayer'; feedback.update(.016);
  assert.equal(feedback.health.hidden, true, 'a wounded enemy does not create an indicator');
  game.multiplayer.self.health = 25; feedback.update(.016); assert.equal(feedback.health.classes.has('critical'), true);
  assert.equal(hud.children.filter(n => n.id === 'self-health').length, 1, 'there is a single local indicator');
  game.player.cameraMode = 'first'; feedback.update(.016); assert.equal(feedback.health.style.top, '61%');
  game.multiplayer.self.dead = true; feedback.update(.016); assert.equal(feedback.health.hidden, true);
  game.multiplayer.self.dead = false; game.player.active = false; feedback.update(.016); assert.equal(feedback.health.hidden, true);
  game.player.active = true; game.multiplayer.self = null; feedback.update(.016); assert.equal(feedback.health.hidden, true, 'a missing snapshot during departure must not throw');
});

test('kill feed consumes the current authority once, bounds its entries and expires them on time', t => {
  const { game, feedback } = fixture(t);
  const event = { type: 'death', source: 'other', victim: 'me', sourceKind: 'player', victimKind: 'player', weapon: 'pistol', region: 'head' };
  game.events.emit('multiplayerevent', event); assert.equal(feedback.feed.children.length, 0, 'multiplayer events cannot leak into training');
  game.mode = 'multiplayer';
  for (let i = 0; i < 7; i++) game.events.emit('multiplayerevent', event);
  assert.equal(feedback.feed.children.length, 5);
  assert.equal(feedback.feed.children[0].attributes['aria-label'], 'Biel eliminou Joana · Glock-18 · tiro na cabeça');
  assert.equal(feedback.feed.children[0].classes.has('local'), true);
  game.events.emit('combatdeath', { victim: { id: 'bot', kind: 'human' } }); assert.equal(feedback.feed.children.length, 5);
  game.events.emit('multiplayerevent', { ...event, victimKind: 'objective' }); assert.equal(feedback.feed.children.length, 5);
  feedback.update(6.1); assert.equal(feedback.feed.children.length, 0);
  game.events.emit('multiplayerevent', event); game.events.emit('multiplayerleft'); assert.equal(feedback.feed.children.length, 0);
  game.mode = 'training';
  game.events.emit('combatdeath', { victim: { id: 'human-7', kind: 'human' }, source: { id: 'me', kind: 'player' }, weapon: WEAPONS[1], region: 'thorax' });
  assert.match(feedback.feed.children[0].attributes['aria-label'], /Joana eliminou Bot 7 · M4A4/);
  game.events.emit('combatreset'); assert.equal(feedback.feed.children.length, 0);
});
