import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Motor gráfico: renderer, cena, câmera, céu, luzes, sombra que acompanha o foco e o laço.
// Os módulos se penduram no laço com addSystem(fn, fase); as fases rodam nesta ordem:
const PHASES = ['early', 'player', 'world', 'late'];

export function createEngine({ quality, container, isIdle = () => false }) {
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, quality.far);

  // céu + sol (hemisfério sul: o sol fica ao norte, ou seja, para -z)
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), Math.PI - 0.55);
  const sky = new Sky();
  sky.scale.setScalar(3000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  // Iluminação ambiente (IBL): gradiente céu/horizonte/chão com valores calibrados.
  // (o shader Sky gera radiância HDR alta demais para usar direto como ambiente)
  const envScene = new THREE.Scene();
  {
    const g = new THREE.SphereGeometry(100, 32, 16);
    const top = new THREE.Color(0x5f8fca), hor = new THREE.Color(0xd4dde4), bot = new THREE.Color(0x6e6352);
    const cols = [];
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 100;
      const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(bot, Math.pow(-y, 0.4));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    envScene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.Fog(0xcbd8e2, quality.fog[0], quality.fog[1]);

  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.castShadow = true;
  const SH = quality.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 1200 });
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a5a48, 0.25);
  scene.add(hemi);

  // ---------------------------------------------------------------- sistemas e laço
  const systems = [];
  let shadowFocus = () => camera.position;
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  function start() {
    const timer = new THREE.Timer();
    const texel = (SH * 2) / sun.shadow.mapSize.x;
    const shadowCenter = new THREE.Vector3();
    let lastFrame = -Infinity;
    renderer.setAnimationLoop((now) => {
      if (isIdle() && now - lastFrame < 1000 / 15) return;
      lastFrame = now;
      timer.update(now);
      const dt = timer.getDelta();
      const t = timer.getElapsed();
      for (const s of systems) s.fn(dt, t);
      sky.position.copy(camera.position);
      // sombra acompanha o foco (com "snap" ao texel para não tremular)
      shadowCenter.set(Math.round(camera.position.x / texel) * texel, shadowFocus().y, Math.round(camera.position.z / texel) * texel);
      sun.target.position.copy(shadowCenter);
      sun.position.copy(shadowCenter).addScaledVector(sunDir, 500);
      renderer.render(scene, camera);
    });
  }

  return {
    renderer, scene, camera, sun, hemi, sky, sunDir, quality,
    /** fn(dt, t) roda todo quadro; fase: 'early' | 'player' | 'world' | 'late' */
    addSystem(fn, phase = 'world') {
      const order = PHASES.indexOf(phase);
      if (order < 0) throw new Error(`fase desconhecida: ${phase}`);
      systems.push({ fn, order });
      systems.sort((a, b) => a.order - b.order); // sort estável: mantém a ordem de registro na fase
    },
    /** de onde a sombra do sol é centrada (o personagem registra os pés) */
    setShadowFocus(fn) { shadowFocus = fn; },
    start,
  };
}
