import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTraining } from '../../src/core/training.js';
import { createEvents } from '../../src/core/events.js';
import { createCombatModule } from '../../src/gameplay/combat/index.js';
import { loadAvatarGeometry } from '../player/load-avatar.mjs';

test('training adapter supports physical controls, player death/respawn and complete scene cleanup on exit', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { hidden: false, createElement: () => ({ getContext: () => ({ clearRect() {}, fillText() {} }) }) };
  let combat;
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), sky = new THREE.Mesh(), city = new THREE.Group(), sun = new THREE.DirectionalLight();
    scene.add(sky, city, sun, sun.target); const systems = [], bindings = [];
    let cleared = 0;
    const game = { mode: null, events: createEvents(), engine: { scene, camera, sky, sun, addSystem: f => systems.push(f) },
      player: { feet: new THREE.Vector3(3, 0, 4), active: true, yaw: 0, crouched: false,
        placeAt(x, z) { this.feet.set(x, 0, z); camera.position.set(x, 1.7, z); } },
      input: { bind: (...args) => bindings.push(args) }, toast() {}, paintball: { clearEffects() { cleared++; } },
    };
    game.training = createTraining(game);
    const models = { human: await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), zombie: await loadAvatarGeometry(new URL('../../public/models/enemies/zombie-quaternius.glb', import.meta.url)) };
    combat = game.combat = await createCombatModule(game, { models });
    assert.equal(combat.root.visible, false); assert.equal(combat.spawn('zombie'), null);
    const checkpoint = game.player.feet.clone();
    game.mode = 'training'; game.training.start(); game.events.emit('modechange', 'training'); combat.update(1 / 60);
    assert.equal(city.visible, false); assert.equal(combat.root.visible, true);
    assert.ok(bindings.some(([key]) => key === 'KeyE')); assert.ok(bindings.some(([key]) => key === 'KeyY'));
    assert.equal(combat.trainingLab.buttons.length, 16);
    const button = combat.trainingLab.buttons.find(b => b.id === 'zombie');
    const aim = button.mesh.getWorldPosition(new THREE.Vector3());
    camera.position.copy(aim).add(new THREE.Vector3(0, 0, 4).applyQuaternion(combat.trainingLab.root.quaternion)); camera.position.y = 1.7;
    game.player.feet.set(camera.position.x, 0, camera.position.z); camera.lookAt(aim);
    assert.equal(combat.trainingLab.probe()?.id, 'zombie');
    bindings.find(([key]) => key === 'KeyE')[1]();
    assert.equal([...combat.simulation.agents].filter(e => e.kind === 'zombie').length, 1, 'E activates the physical button under the camera ray');
    combat.reset(); game.player.placeAt(game.training.spawn.x, game.training.spawn.z);
    assert.equal(combat.trainingLab.execute('targets'), true); assert.equal(combat.views.size, 2);
    assert.equal(combat.trainingLab.execute('hitboxes'), true); combat.update(.1);
    assert.ok([...combat.views.values()].every(v => v.debugRoot.visible));
    assert.equal(combat.trainingLab.execute('friendly'), true); assert.equal(combat.simulation.rules.friendlyFire, true);
    for (let i = 0; i < 130; i++) combat.update(1 / 60);
    const enemy = [...combat.simulation.actors].find(e => e.kind === 'human');
    combat.simulation.damage(combat.player, { source: enemy, region: 'head', weapon: { kind: 'firearm', damage: 30 } });
    assert.equal(combat.canPlayerAct, false); assert.equal(combat.player.stats.deaths, 1);
    for (let i = 0; i < 190; i++) combat.update(1 / 60);
    assert.equal(combat.canPlayerAct, true); assert.equal(combat.player.health.current, 100);
    assert.equal(combat.player.stats.deaths, 1); assert.ok(combat.player.protectedUntil > combat.simulation.time);
    const start = game.training.spawn;
    game.dynamicProps = { crates: [
      { mode: 'training', mesh: { visible: true }, bounds: new THREE.Box3(new THREE.Vector3(start.x - .6, 0, start.z - 4.6), new THREE.Vector3(start.x + .6, 1.2, start.z - 3.4)) },
      { mode: 'training', mesh: { visible: true }, bounds: new THREE.Box3(new THREE.Vector3(start.x + 4.8, 0, start.z - 5.8), new THREE.Vector3(start.x + 6.4, 1.6, start.z - 4.2)) },
    ] };
    let duelDamage = 0; game.events.on('combatdamage', e => { if (e.victim === combat.player) duelDamage++; });
    combat.scenario('duel', 'hard');
    for (let i = 0; i < 300; i++) combat.update(1 / 60);
    assert.ok(duelDamage > 0, 'the duel bot must acquire and attack the player with both training crates present');
    combat.reset();
    const from = { x: game.player.feet.x, z: game.player.feet.z };
    combat.simulation.spawn({ kind: 'human', stationary: true, position: { x: from.x + .4, y: 0, z: from.z } });
    for (let i = 0; i < 120; i++) assert.deepEqual(combat.collide(from.x, from.z, .35, 0, { from }), [from.x, from.z], 'an overlapping character cannot push an idle player every frame');
    assert.deepEqual(combat.collide(from.x + .1, from.z, .35, 0, { from }), [from.x, from.z]);
    assert.deepEqual(combat.collide(from.x - .1, from.z, .35, 0, { from }), [from.x - .1, from.z], 'movement away from contact remains controllable');
    const around = combat.collide(from.x + .05, from.z + .1, .35, 0, { from });
    assert.ok(around[1] > from.z + .05, 'contact must preserve sideways movement around a character');
    assert.ok(Math.hypot(around[0] - from.x - .4, around[1] - from.z) >= .4 - 1e-6, 'sliding cannot deepen an existing overlap');
    game.mode = null; game.training.stop(); game.events.emit('modechange', null); combat.update(.1);
    assert.deepEqual(game.player.feet, checkpoint); assert.equal(city.visible, true);
    assert.equal(combat.root.visible, false); assert.equal(combat.views.size, 0); assert.equal([...combat.simulation.actors].length, 2);
    assert.equal(combat.trainingLab.execute('zombie'), false); assert.ok(cleared >= 2);
    combat.dispose(); assert.equal(combat.root.parent, null); assert.equal(combat.trainingLab.root.parent, null);
  } finally { combat?.dispose(); globalThis.document = oldDocument; }
});
