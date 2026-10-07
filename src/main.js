import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createProjection } from './geo.js';
import { createTerrain } from './terrain.js';
import { parseWorld } from './world.js';
import { paintGround, buildMasks } from './ground.js';
import { buildRoads } from './roads.js';
import { createBuildingBuilder, specFromOsm } from './buildings.js';
import { generateProcedural } from './procedural.js';
import { buildVegetation } from './vegetation.js';
import { buildWater, buildBarriers, buildTrafficSignals, buildLabels, buildQuarterBoundary } from './props.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { prepareCampus, buildCampus } from './campus.js';
import { createStyler } from './style.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const loadingText = $('loading-text');
const status = async (msg) => {
  loadingText.textContent = msg;
  // deixa o navegador pintar a mensagem (sem travar se a aba estiver em segundo plano)
  await new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 50); });
};

async function main() {
  // ---------------------------------------------------------------- dados reais
  await status('Baixando dados do OpenStreetMap e relevo...');
  const base = import.meta.env.BASE_URL;
  const [geojson, terrainData] = await Promise.all([
    fetch(`${base}data/cidade-de-deus.geojson`).then((r) => r.json()),
    fetch(`${base}data/terrain.json`).then((r) => r.json()),
  ]);
  // detalhes do núcleo Cidade de Deus (opcional: o mapa funciona sem)
  const campusGeo = await fetch(`${base}data/campus-cidade-de-deus.geojson`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  // origem do sistema local = centro do polígono da Cidade de Deus
  const qf = geojson.features.find((f) => f.properties.place === 'quarter');
  let lon0, lat0;
  if (qf) {
    const ring = qf.geometry.coordinates[0];
    const lons = ring.map((c) => c[0]), lats = ring.map((c) => c[1]);
    lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
    lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  } else {
    lon0 = (geojson.bbox[0] + geojson.bbox[2]) / 2;
    lat0 = (geojson.bbox[1] + geojson.bbox[3]) / 2;
  }
  const proj = createProjection(lon0, lat0);

  // ---------------------------------------------------------------- renderer / cena
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.75;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 3500);

  // céu + sol (hemisfério sul: o sol fica ao norte, ou seja, para -z)
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), Math.PI - 0.55);
  const makeSky = (scale) => {
    const sky = new Sky();
    sky.scale.setScalar(scale);
    const u = sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
    return sky;
  };
  const skyMesh = makeSky(3000);
  scene.add(skyMesh);
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
  scene.environmentIntensity = 0.9;
  scene.fog = new THREE.Fog(0xcbd8e2, 350, 1900);

  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.castShadow = true;
  const SH = 150;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 10, far: 1200 });
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6a5a48, 0.25);
  scene.add(hemi);

  // ---------------------------------------------------------------- terreno e chão
  await status('Gerando relevo real (SRTM)...');
  const terrain = createTerrain(terrainData, proj);
  const world = parseWorld(geojson, proj);
  const campusData = campusGeo ? prepareCampus(campusGeo, world, proj) : null;
  for (const a of world.areas) if (a.kind === 'water') a.waterLevel = terrain.carveWater(a.rings);

  await status('Pintando uso do solo, calçadas e rios...');
  const ground = paintGround(world, terrain.bounds, renderer);
  const { mesh: terrainMesh, skirt } = terrain.buildMesh(ground.texture);
  scene.add(terrainMesh, skirt);
  const masks = buildMasks(world, terrain.bounds);

  await status(`Traçando ${world.roads.length} vias...`);
  const roads = buildRoads(world, terrain, renderer);
  scene.add(roads.root);

  await status(`Levantando ${world.buildings.length} prédios reais do OSM...`);
  const real = createBuildingBuilder(renderer, terrain);
  for (const b of world.buildings) real.add(specFromOsm(b));
  real.finish(scene);

  let campus = null;
  if (campusData) {
    await status('Construindo o núcleo Cidade de Deus (portarias, muros, prédios)...');
    campus = buildCampus(campusData, { scene, renderer, terrain, world, masks });
  }

  await status('Preenchendo quadras sem prédios mapeados (procedural)...');
  const proc = createBuildingBuilder(renderer, terrain);
  for (const s of generateProcedural(world, masks, terrain, { skipQuarter: !!campus })) proc.add(s);
  const procRoot = proc.finish(scene);
  procRoot.name = 'predios-procedurais';

  await status('Plantando árvores...');
  const veg = buildVegetation(world, masks, terrain);
  scene.add(veg.root);

  await status('Água, muros, semáforos e placas...');
  scene.add(buildWater(world, terrain));
  scene.add(buildBarriers(world, terrain, real));
  const signals = buildTrafficSignals(world, terrain);
  scene.add(signals.root);
  const labels = buildLabels(world, terrain, { real });
  if (campus) labels.root.add(...campus.sprites);
  scene.add(labels.root);
  const boundary = buildQuarterBoundary(world.quarter, terrain);
  scene.add(boundary);

  // ---------------------------------------------------------------- lugares para teletransporte
  // pontos de chegada ficam numa rua com nome (o HUD já mostra onde você está)
  const carRoads = world.roads.filter((r) => r.kind !== 'foot' && !r.bridge && r.name);
  const nearestRoadPoint = (x, z) => {
    let best = [x, z, 1, 0], bd = Infinity;
    for (const r of carRoads)
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
        if (d < bd) { const l = Math.sqrt(l2); bd = d; best = [px, pz, dx / l, dz / l]; }
      }
    return best;
  };
  const centroidOf = (rings) => {
    let x = 0, z = 0;
    for (const [a, b] of rings[0]) { x += a; z += b; }
    return [x / rings[0].length, z / rings[0].length];
  };
  const findNamed = (name) => {
    const b = world.buildings.find((f) => f.tags.name === name) || world.areas.find((f) => f.tags.name === name);
    return b ? centroidOf(b.rings) : null;
  };
  const places = [];
  // portarias do campus: chegada do lado de fora, olhando para a entrada
  if (campus) for (const sp of campus.spawnPoints) places.push({ ...sp, fixed: true });
  if (!places.length && world.quarter) places.push({ name: 'Cidade de Deus', target: centroidOf(world.quarter) });
  for (const [label, osmName] of [
    ['Shopping União de Osasco', 'Shopping União de Osasco'],
    ['Terminal Amador Aguiar (Vila Yara)', 'Terminal Urbano Amador Aguiar'],
    ['São Francisco Golf Club', 'São Francisco Golf Club'],
    ['Pátio Osasco Open Mall', 'Pátio Osasco Open Mall'],
  ]) {
    const c = findNamed(osmName);
    if (c) places.push({ name: label, target: c });
  }
  for (const p of places) {
    if (p.fixed) continue;
    let tx, tz;
    [p.x, p.z, tx, tz] = nearestRoadPoint(p.target[0], p.target[1]);
    // olha ao longo da rua, no sentido que mais se aproxima do destino
    const toX = p.target[0] - p.x, toZ = p.target[1] - p.z;
    if (tx * toX + tz * toZ < 0) { tx = -tx; tz = -tz; }
    p.yaw = Math.atan2(-tx, -tz);
  }

  // ---------------------------------------------------------------- jogador
  let procOn = true;
  const player = createPlayer(camera, renderer.domElement, {
    terrain,
    bounds: terrain.bounds,
    bridgeHeightAt: roads.bridgeHeightAt,
    collide: (x, z, r, feetY) => {
      [x, z] = real.collide(x, z, r, feetY);
      if (procOn) [x, z] = proc.collide(x, z, r, feetY);
      if (campus) [x, z] = campus.builder.collide(x, z, r, feetY);
      return [x, z];
    },
    roofAt: (x, z, y) => Math.max(real.roofAt(x, z, y), procOn ? proc.roofAt(x, z, y) : -Infinity, campus ? campus.builder.roofAt(x, z, y) : -Infinity),
  });
  const spawn = places[0] || { x: 0, z: 0, yaw: 0 };
  player.placeAt(spawn.x, spawn.z, spawn.yaw);

  const hud = createHud({
    groundCanvas: ground.canvas,
    bounds: terrain.bounds,
    footprints: [...proc.footprints, ...real.footprints, ...(campus ? campus.builder.footprints : [])],
    quarter: world.quarter,
    proj,
    terrain,
    streetAt: roads.streetAt,
    places,
  });

  $('stat-line').textContent =
    `${real.count()} prédios do OSM · ${campus ? campus.count + ' no núcleo Cidade de Deus · ' : ''}${proc.count()} procedurais · ${world.roads.length} vias · ${veg.count} árvores · relevo ${terrainData.min.toFixed(0)}–${terrainData.max.toFixed(0)} m`;
  $('places-list').innerHTML = places.map((p, i) => `<li><kbd>${i + 1}</kbd> ${p.name}</li>`).join('');

  // ---------------------------------------------------------------- estilo (cartoon por padrão)
  const styler = createStyler(scene, renderer, hemi);
  styler.collect();
  styler.setCartoon(true);

  // ---------------------------------------------------------------- UI / teclas
  const overlay = $('overlay'), mapPanel = $('map-panel'), help = $('help');
  $('loading').classList.add('hidden');
  overlay.classList.remove('hidden');
  $('play').addEventListener('click', () => player.start());
  player.events.addEventListener('lock', (e) => {
    overlay.classList.add('hidden');
    mapPanel.classList.remove('open');
    if (e.detail.dragMode) toast('Modo arrastar: segure o botão do mouse e arraste para olhar');
  });
  player.events.addEventListener('unlock', () => { if (!mapPanel.classList.contains('open')) overlay.classList.remove('hidden'); });

  const toast = (msg) => {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 1800);
  };

  const openMap = () => { mapPanel.classList.add('open'); overlay.classList.add('hidden'); player.stop(); };
  const closeMap = (relock) => { mapPanel.classList.remove('open'); if (relock) player.start(); else overlay.classList.remove('hidden'); };
  $('bigmap').addEventListener('click', (e) => {
    const w = hud.bigMapToWorld(e.clientX, e.clientY);
    if (!w) return;
    player.placeAt(w[0], w[1], player.yaw);
    closeMap(true);
  });
  $('map-close').addEventListener('click', () => closeMap(true));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyM') { mapPanel.classList.contains('open') ? closeMap(true) : openMap(); return; }
    if (e.code === 'Escape' && mapPanel.classList.contains('open')) { closeMap(false); return; }
    if (!player.active) return;
    if (e.code === 'KeyP') {
      procOn = !procOn;
      procRoot.visible = procOn;
      toast(procOn ? 'Prédios procedurais: LIGADOS' : 'Prédios procedurais: DESLIGADOS (só dados reais do OSM)');
    }
    if (e.code === 'KeyB') { boundary.visible = !boundary.visible; toast(boundary.visible ? 'Limite do bairro: visível' : 'Limite do bairro: oculto'); }
    if (e.code === 'KeyL') { labels.root.visible = !labels.root.visible; toast(labels.root.visible ? 'Placas: visíveis' : 'Placas: ocultas'); }
    if (e.code === 'KeyH') help.classList.toggle('hidden');
    if (e.code === 'KeyT') { styler.setCartoon(!styler.cartoon); toast(styler.cartoon ? 'Visual: CARTOON' : 'Visual: realista'); }
    if (e.code === 'KeyV') { styler.setPixel(!styler.pixel); toast(styler.pixel ? 'Modo PIXEL ligado' : 'Modo pixel desligado'); }
    if (e.code === 'KeyF') setTimeout(() => toast(player.fly ? 'Voo livre (E sobe, Q desce, Shift acelera)' : 'Andando'), 0);
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= places.length) {
      const p = places[n - 1];
      player.placeAt(p.x, p.z, p.yaw);
      toast(`Teletransportado: ${p.name}`);
    }
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------------------------------------------------------------- loop
  const timer = new THREE.Timer();
  const texel = (SH * 2) / sun.shadow.mapSize.x;
  const shadowCenter = new THREE.Vector3();
  let frame = 0;
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = timer.getDelta();
    const t = timer.getElapsed();
    player.update(dt);
    skyMesh.position.copy(camera.position);

    // sombra acompanha o jogador (com "snap" ao texel para não tremular)
    shadowCenter.set(Math.round(camera.position.x / texel) * texel, player.feet.y, Math.round(camera.position.z / texel) * texel);
    sun.target.position.copy(shadowCenter);
    sun.position.copy(shadowCenter).addScaledVector(sunDir, 500);

    signals.update(t);
    campus?.update(dt, player.feet);
    boundary.userData.update?.(t);
    if (frame++ % 10 === 0) labels.update(camera.position);
    hud.update(t, dt, player.feet, player.yaw, player.fly);
    renderer.render(scene, camera);
  });

  // acesso para depuração no console
  window.__cdd = { scene, camera, player, world, terrain, proj, renderer, campus, styler };
}

main().catch((err) => {
  console.error(err);
  loadingText.textContent = 'Erro ao carregar: ' + err.message;
  $('loading').classList.add('error');
});
