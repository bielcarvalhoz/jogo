import * as THREE from 'three';

// Estilo visual: "cartoon" (sombreamento em faixas, MeshToonMaterial) alternável com o
// realista (MeshStandardMaterial), e modo pixelado (renderiza em baixa resolução e
// amplia sem suavizar).

function toonGradient() {
  const data = new Uint8Array([70, 140, 205, 255]);
  const t = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

const COPY = ['map', 'color', 'vertexColors', 'transparent', 'opacity', 'side', 'alphaTest', 'depthWrite',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'emissive', 'emissiveMap', 'emissiveIntensity'];

export function createStyler(scene, renderer, hemi) {
  const gradientMap = toonGradient();
  const toonOf = new Map(); // material padrão -> toon
  const meshes = []; // [mesh, standard, toon]
  let cartoon = false;
  let pixel = false;
  const standardPixelRatio = renderer.getPixelRatio();

  function toToon(std) {
    if (toonOf.has(std)) return toonOf.get(std);
    const t = new THREE.MeshToonMaterial({ gradientMap });
    for (const k of COPY) if (std[k] !== undefined) t[k] = std[k]?.clone && !(std[k] instanceof THREE.Texture) ? std[k].clone() : std[k];
    t.name = std.name;
    toonOf.set(std, t);
    return t;
  }

  /** registra todos os meshes com material padrão que existem agora na cena */
  function collect() {
    meshes.length = 0;
    scene.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      const m = o.userData.stdMaterial || o.material;
      if (!m.isMeshStandardMaterial || o.userData.keepStandard) return;
      o.userData.stdMaterial = m;
      meshes.push([o, m, toToon(m)]);
    });
  }

  function setCartoon(on) {
    cartoon = on;
    for (const [o, std, toon] of meshes) o.material = on ? toon : std;
    // o toon não usa o mapa de ambiente: compensa com mais luz de céu
    hemi.intensity = on ? 1.15 : 0.25;
  }

  function setPixel(on) {
    pixel = on;
    renderer.setPixelRatio(on ? 0.3 : standardPixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    renderer.domElement.style.imageRendering = on ? 'pixelated' : '';
  }

  return {
    collect,
    setCartoon,
    setPixel,
    get cartoon() { return cartoon; },
    get pixel() { return pixel; },
  };
}
