import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadAvatarGeometry } from './load-avatar.mjs';
import { sweepHairTips, createScalpGeometry } from '../../src/player/hair.js';

test('the nape covering stays within a thin shell of the real skull instead of flaring toward the neck', async () => {
  const gltf = await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), meshes = [];
  gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const skull = meshes.filter(m => m.name.startsWith('Sato_clean_face')).map(m => new THREE.Mesh(m.geometry, material));
  const center = new THREE.Vector3(0, .858, -.009), ray = new THREE.Raycaster();
  for (const napeOnly of [false, true]) {
    const geometry = createScalpGeometry(meshes, napeOnly), p = geometry.attributes.position; let napeVertices = 0;
    for (let i = 0; i < p.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(p, i);
      if (point.z >= -.03 || point.y >= .83) continue;
      napeVertices++; ray.set(point, center.clone().sub(point).normalize());
      const hit = ray.intersectObjects(skull, false)[0];
      assert.ok(hit && hit.distance > .0005 && hit.distance < .003, `nape vertex is ${hit?.distance} from the skull`);
      assert.ok(point.y > .77, 'the short covering must stop above the neck');
    }
    assert.ok(napeVertices > 30); geometry.dispose();
  }
  material.dispose();
});

test('hair changes only a small rest-shape region and preserves rig, UVs and other meshes', async () => {
  const gltf = await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), meshes = [];
  gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const originals = meshes.map(mesh => ({ geometry: mesh.geometry, positions: mesh.geometry.attributes.position.array.slice() }));
  sweepHairTips(meshes);
  let changed = 0, sweptFringe = 0, loweredCrown = 0, peak = -Infinity;
  meshes.forEach((mesh, i) => {
    const old = originals[i];
    if (!mesh.name.startsWith('Sato_hair_cap')) { assert.equal(mesh.geometry, old.geometry); return; }
    assert.deepEqual(mesh.geometry.attributes.skinIndex.array, old.geometry.attributes.skinIndex.array);
    assert.deepEqual(mesh.geometry.attributes.skinWeight.array, old.geometry.attributes.skinWeight.array);
    assert.deepEqual(mesh.geometry.attributes.uv?.array, old.geometry.attributes.uv?.array);
    assert.deepEqual(mesh.geometry.index.array, old.geometry.index.array);
    const positions = mesh.geometry.attributes.position.array;
    for (let j = 0; j < positions.length; j += 3) {
      const dx = positions[j] - old.positions[j], dy = positions[j + 1] - old.positions[j + 1], dz = positions[j + 2] - old.positions[j + 2];
      assert.ok(Math.hypot(dx, dy, dz) < .075, 'hair must keep its silhouette');
      assert.ok(dx >= -1e-7 && dy <= 1e-7, 'tips sweep sideways/down, rather than growing upwards');
      if (old.positions[j + 2] < -.04 && old.positions[j + 1] < .865) assert.equal(Math.hypot(dx, dy, dz), 0, 'nape must be untouched');
      if (old.positions[j + 2] > .09 && dx > .017) sweptFringe++;
      if (old.positions[j + 1] <= .948 && old.positions[j + 2] <= .015) {
        assert.equal(Math.hypot(dx, dy, dz), 0, 'the crown shell and back roots must stay in place');
      }
      if (old.positions[j + 1] > .996) {
        assert.ok(dx > .053 && dy < -.027, 'every high crown spike must comb left and down'); loweredCrown++;
      }
      peak = Math.max(peak, positions[j + 1]);
      if (Math.hypot(dx, dy, dz) > .00001) changed++;
    }
  });
  assert.ok(changed > 0);
  assert.ok(sweptFringe > 0, 'front tips must visibly follow the sweep toward character +X/left');
  assert.ok(loweredCrown > 0 && peak < .985, 'the former upright crown peak must be lowered without sinking its shell');
});

test('combed crown keeps the original scalp covered by hair on the real head geometry', async () => {
  const gltf = await loadAvatarGeometry(new URL('../../public/models/sato.glb', import.meta.url)), meshes = [];
  gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const staticMeshes = source => source.map(mesh => new THREE.Mesh(mesh.geometry.clone(), material));
  const rawHair = staticMeshes(meshes.filter(mesh => mesh.name.startsWith('Sato_hair_cap')));
  const head = staticMeshes(meshes.filter(mesh => mesh.name.startsWith('Sato_clean_face')));
  sweepHairTips(meshes);
  const hair = staticMeshes(meshes.filter(mesh => mesh.name.startsWith('Sato_hair_cap')));
  for (const mesh of [...rawHair, ...head, ...hair]) mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0); let checked = 0;
  for (const x of [-.055, -.0275, 0, .0275, .055]) for (const z of [-.045, -.02, .005, .03, .055]) {
    ray.set(new THREE.Vector3(x, 1.2, z), down);
    const skin = ray.intersectObjects(head)[0], before = ray.intersectObjects(rawHair)[0];
    if (!skin || !before || before.point.y <= skin.point.y + .001) continue;
    const after = ray.intersectObjects(hair)[0]; checked++;
    assert.ok(after && after.point.y > skin.point.y + .001, `combing exposes scalp at ${x},${z}`);
  }
  assert.ok(checked >= 20, 'coverage proof must sample the front and both sides of the crown');
});
