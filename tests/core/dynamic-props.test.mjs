import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDynamicProps, footballFieldCenter } from '../../src/core/dynamic-props.js';

function fixture() {
  return {
    engine: { scene: new THREE.Scene(), addSystem() {} }, events: { on() {} },
    training: { active: true, spawn: { x: 10000, z: 10000 } }, mode: 'training',
    player: { active: true }, map: { terrain: { heightAt: () => 12 }, world: { areas: [{ id: 'cdd/campo', rings: [[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]] }] } },
  };
}

test('campaign crate uses the football-field centre, ignoring closing vertex', () => {
  assert.deepEqual(footballFieldCenter(fixture()), { x: 0, z: 0 });
});

test('metal step sits beside the large crate with two usable parkour surfaces', async () => {
  const game = fixture(), props = await createDynamicProps(game);
  try {
    for (let i = 0; i < 100; i++) props.update(1 / 60);
    const large = props.crates.find(c => c.mode === 'training' && c.type === 'metal');
    const step = props.crates.find(c => c.mode === 'training' && c.type === 'metalStep');
    assert.ok(step); assert.ok(step.mesh.position.distanceTo(large.mesh.position) < 1.7);
    const stepTop = props.surfaceHeightAt(step.mesh.position.x, step.mesh.position.z, 1.1);
    const largeTop = props.surfaceHeightAt(large.mesh.position.x, large.mesh.position.z, 2);
    assert.ok(Math.abs(stepTop - .8) < .04); assert.ok(Math.abs(largeTop - 1.6) < .04);
    assert.ok(largeTop - stepTop < .85, 'second jump remains reachable');
    assert.ok(large.mesh.material.metalness > .8); assert.ok(large.mesh.material.map && large.mesh.material.bumpMap);
  } finally { props.dispose(); }
});

test('Rapier crate settles, receives off-centre shot/melee impulses, and switches spaces', async () => {
  const game = fixture(), props = await createDynamicProps(game);
  try {
    const box = props.crates.find(c => c.mode === 'training'), city = props.crates.find(c => c.mode === 'campaign');
    for (let i = 0; i < 100; i++) props.update(1 / 60);
    assert.ok(Math.abs(box.mesh.position.y - .6) < .03, 'supported by the actual training floor');
    assert.equal(city.mesh.visible, false); assert.equal(city.body.isEnabled(), false);
    const point = box.mesh.position.clone().add(new THREE.Vector3(.4, .25, .6));
    assert.equal(props.impact({ object: box.mesh, point }, { direction: { x: 0, y: 0, z: -1 }, impulse: 12, damage: 33, kind: 'firearm' }), true);
    assert.ok(box.body.linvel().z < -1); assert.ok(Math.abs(box.body.angvel().y) > .1, 'off-centre impact rotates the box');
    assert.equal(box.damage, 33);
    props.update(1 / 60);
    props.impact({ object: box.mesh, point }, { direction: { x: 1, y: 0, z: 0 }, impulse: 8, damage: 40, kind: 'melee' });
    assert.ok(box.body.linvel().x > 0); assert.equal(box.hits, 2);
    game.training.active = false; game.mode = 'campaign'; props.update(0);
    assert.equal(box.mesh.visible, false); assert.equal(box.body.isEnabled(), false); assert.equal(city.mesh.visible, true);
    assert.equal(props.impact({ object: box.mesh, point }, { impulse: 12 }), false, 'hidden space cannot receive impacts');
    for (let i = 0; i < 100; i++) props.update(1 / 60);
    assert.ok(Math.abs(city.mesh.position.y - 12.6) < .04, 'campaign support follows terrain elevation');
    const beforeQuery = city.body.linvel();
    props.collide(0, 0, .18, 12.8, { push: false });
    assert.deepEqual(city.body.linvel(), beforeQuery, 'camera obstruction query cannot push the crate');
    const [x, z] = props.collide(0, 0, .35, 12); assert.ok(Math.hypot(x, z) > .9, 'player cannot walk through the crate');
    assert.equal(props.surfaceHeightAt(0, 0, 12.7), -Infinity, 'crate does not teleport a player below its top');
    assert.ok(props.surfaceHeightAt(0, 0, 14) > 13, 'crate top can be stood on after a jump');
  } finally { props.dispose(); }
});

test('crate ray misses never create a second floor anywhere around the football field', async () => {
  const game = fixture(); game.training.active = false; game.mode = 'campaign';
  const props = await createDynamicProps(game);
  try {
    for (let i = 0; i < 100; i++) props.update(1 / 60);
    for (const x of [-50, -3, 3, 20, 50]) for (const z of [-50, -3, 3, 20, 50]) {
      for (const maxY of [12, 14, 17, Infinity]) {
        assert.equal(props.surfaceHeightAt(x, z, maxY), -Infinity, `${x}/${z}: phantom surface after jump`);
        assert.equal(props.roofAt(x, z, maxY), -Infinity, `${x}/${z}: phantom roof after jump`);
      }
    }
    const wood = props.crates.find(c => c.mode === 'campaign' && c.type === 'wood');
    wood.body.setRotation({ x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) }, true); props.update(0);
    assert.equal(props.surfaceHeightAt(.8, .8, Infinity), -Infinity, 'misses within a rotated box AABB must also be rejected');
    assert.ok(props.surfaceHeightAt(0, 0, Infinity) > 13, 'real box tops remain walkable');
  } finally { props.dispose(); }
});

test('larger metal crate is outside the weapon ring and resists the same shots/punches', async () => {
  const game = fixture(), props = await createDynamicProps(game);
  try {
    const wood = props.crates.find(c => c.mode === 'training' && c.type === 'wood');
    const metal = props.crates.find(c => c.mode === 'training' && c.type === 'metal');
    assert.ok(metal.bounds.getSize(new THREE.Vector3()).x > wood.bounds.getSize(new THREE.Vector3()).x);
    assert.ok(metal.mesh.position.distanceTo(wood.mesh.position) > 5);
    for (const kind of ['firearm', 'melee', 'unarmed']) {
      for (const crate of [wood, metal]) { crate.body.setLinvel({ x: 0, y: 0, z: 0 }, true); props.impact({ object: crate.mesh, point: crate.mesh.position }, { direction: { x: 1, y: 0, z: 0 }, impulse: 3, kind }); }
      assert.ok(wood.body.linvel().x > 1.9, `${kind}: wood should react strongly`);
      assert.ok(metal.body.linvel().x < wood.body.linvel().x / 10, `${kind}: metal must feel heavier`);
    }
  } finally { props.dispose(); }
});
