import * as THREE from 'three';

/** Small, recycled paint droplets: one draw call and no per-shot geometry. */
export function createMuzzlePaint(parent, random = Math.random) {
  const count = 96, geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: .65, depthWrite: false, toneMapped: false });
  const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.name = 'muzzle-paint'; mesh.frustumCulled = false;
  mesh.userData.paintballIgnore = true; parent.add(mesh);
  const particles = Array.from({ length: count }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 1, life: 0, size: 0 }));
  const dummy = new THREE.Object3D(), color = new THREE.Color(); let cursor = 0;
  function update(dt) {
    for (let i = 0; i < count; i++) {
      const p = particles[i]; p.age += dt;
      if (p.age < p.life) { p.position.addScaledVector(p.velocity, dt); p.velocity.y -= dt * 1.8; }
      dummy.position.copy(p.position); dummy.scale.setScalar(p.age < p.life ? p.size * (1 - p.age / p.life) : 0);
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  function emit(origin, direction, paint) {
    const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < .001) right.set(1, 0, 0); else right.normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    for (let i = 0; i < 10; i++) {
      const index = cursor++ % count, p = particles[index], angle = random() * Math.PI * 2;
      p.position.copy(origin); p.velocity.copy(direction).multiplyScalar(.6 + random() * 1.5)
        .addScaledVector(right, Math.cos(angle) * (.25 + random() * .5)).addScaledVector(up, Math.sin(angle) * .6);
      p.age = 0; p.life = .16 + random() * .13; p.size = .009 + random() * .012;
      mesh.setColorAt(index, color.set(paint));
    }
    mesh.instanceColor.needsUpdate = true; update(0);
  }
  function clear() { for (const p of particles) p.age = p.life; update(0); }
  clear();
  return { mesh, emit, update, clear, get active() { return particles.filter(p => p.age < p.life).length; },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); } };
}
