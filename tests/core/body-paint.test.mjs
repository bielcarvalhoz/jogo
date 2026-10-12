import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createBodyPaint, copyBodyPaint } from '../../src/core/body-paint.js';

function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.1, 0, 0, .1, 0, 0, -.1, .4, 0, .1, .4, 0, -.1, .8, 0, .1, .8, 0], 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]); geometry.computeVertexNormals();
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, .5, .5, 0, 0, .5, .5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial()); skin.name = 'skin';
  const base = new THREE.Bone(), joint = new THREE.Bone(); joint.position.y = .4; base.add(joint); skin.add(base);
  skin.bind(new THREE.Skeleton([base, joint]));
  const root = new THREE.Group(); root.position.set(2, 1, -3); root.add(skin); root.updateMatrixWorld(true);
  return { root, skin, joint, point: root.localToWorld(new THREE.Vector3(0, .4, 0)), normal: new THREE.Vector3(0, 0, 1) };
}

test('paint spans a joint using the surface skin weights and bends exactly with its triangles', t => {
  const { root, skin, joint, point, normal } = fixture(), paint = createBodyPaint(); t.after(() => paint.dispose());
  const mark = paint.stamp(root, point, normal, '#c8102e');
  assert.ok(mark?.isSkinnedMesh, 'a surface overlay must replace the flat sprite');
  assert.equal(mark.parent, skin); assert.equal(mark.skeleton, skin.skeleton);
  assert.deepEqual(mark.geometry.attributes.skinWeight.array, skin.geometry.attributes.skinWeight.array);
  const before = mark.getVertexPosition(5, new THREE.Vector3()).applyMatrix4(mark.matrixWorld);
  joint.rotation.x = .9; root.updateMatrixWorld(true); skin.skeleton.update();
  for (let i = 0; i < mark.geometry.attributes.position.count; i++) {
    const a = skin.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.matrixWorld);
    const b = mark.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mark.matrixWorld);
    assert.ok(a.distanceTo(b) < 1e-7, 'paint cannot detach when different bones bend the same mark');
  }
  assert.ok(mark.getVertexPosition(5, new THREE.Vector3()).applyMatrix4(mark.matrixWorld).distanceTo(before) > .2);
});

test('corpse copies own their overlay geometry and clearing one life preserves the other skeleton', t => {
  const { root, skin, point, normal } = fixture(), paint = createBodyPaint(); t.after(() => paint.dispose());
  const original = paint.stamp(root, point, normal);
  const copy = cloneSkeleton(root);
  const inherited = []; copy.traverse(o => { if (o.userData.bodyPaint) inherited.push(o); });
  inherited.forEach(mark => mark.removeFromParent()); copyBodyPaint(root, copy); copy.updateMatrixWorld(true);
  const mark = copy.getObjectByName('body-paint-surface'), copySkin = copy.getObjectByName('skin');
  assert.notEqual(mark.geometry, original.geometry); assert.equal(mark.skeleton, copySkin.skeleton); assert.notEqual(mark.skeleton, skin.skeleton);
  paint.clear(root); assert.equal(original.parent, null); assert.equal(mark.parent, copySkin);
  paint.clear(copy); assert.equal(mark.parent, null);
});

test('repeated hits cap each character at 24 stamps and reject points outside its surface', t => {
  const { root, point, normal } = fixture(), paint = createBodyPaint(); t.after(() => paint.dispose());
  for (let i = 0; i < 30; i++) assert.ok(paint.stamp(root, point, normal));
  const marks = []; root.traverse(o => { if (o.userData.bodyPaint) marks.push(o); });
  assert.equal(new Set(marks.map(m => m.userData.stampId)).size, 24);
  assert.equal(paint.stamp(root, point.clone().addScalar(10), normal), null);
});
