import * as THREE from 'three';
import { mulberry32 } from '../shared/rng.js';
import { pointInPolygon, distToSegment, SpatialGrid } from '../shared/geo.js';

// WebGL adaptations of Bruno Simon's folio-2025, following sato-agents-lab.
// Reference, attribution and asset license: docs/nature-reference.md.
const time = { value: 0 };
export function updateNature(seconds, reducedMotion = false) {
  time.value = reducedMotion ? 0 : seconds;
}

let leafMap;
const leafMaterials = new Set();
function foliageTexture() {
  if (leafMap) return leafMap;
  // An immediate leaf silhouette also keeps foliage visible while the SDF loads.
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (z + 0.5) / size * 2 - 1;
    const radius = Math.hypot(u * 1.2, v);
    const alpha = Math.round(THREE.MathUtils.clamp((0.86 - radius) * 8 + 0.4, 0, 1) * 255);
    data.set([alpha, alpha, alpha, 255], (z * size + x) * 4);
  }
  leafMap = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  leafMap.minFilter = leafMap.magFilter = THREE.LinearFilter;
  leafMap.needsUpdate = true;
  if (typeof document !== 'undefined') {
    const base = import.meta.env?.BASE_URL || '/';
    new THREE.TextureLoader().load(`${base}textures/folio-2025/foliageSDF.png`, (loaded) => {
      const fallback = leafMap;
      leafMap = loaded;
      for (const material of leafMaterials) material.alphaMap = loaded;
      fallback.dispose();
    });
  }
  return leafMap;
}

/** Rotated leaf cards distributed through a shell; no opaque sphere inside. */
export function createFoliageCloud(count = 64) {
  const rnd = mulberry32(3187), positions = [], normals = [], uvs = [], indices = [];
  const axis = new THREE.Vector3(0, 1, 0), card = new THREE.Vector3(), radial = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Uniform sphere directions; 1-random³ biases leaves towards the shell.
    const azimuth = rnd() * Math.PI * 2, height = rnd() * 2 - 1;
    const radius = 1 - rnd() ** 3, spread = Math.sqrt(1 - height * height);
    const center = new THREE.Vector3(Math.cos(azimuth) * spread, height, Math.sin(azimuth) * spread).multiplyScalar(radius);
    radial.copy(center).normalize();
    const angle = rnd() * Math.PI * 2, turn = (i % 3 - 1) * Math.PI / 3;
    for (const [x, y, u, v] of [[-0.4, -0.4, 0, 0], [0.4, -0.4, 1, 0], [0.4, 0.4, 1, 1], [-0.4, 0.4, 0, 1]]) {
      card.set(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), 0);
      card.applyAxisAngle(axis, turn).add(center);
      positions.push(card.x, card.y, card.z);
      card.copy(radial).lerp(new THREE.Vector3(0, 0, 1).applyAxisAngle(axis, turn), 0.15).normalize();
      normals.push(card.x, card.y, card.z);
      uvs.push(u, v);
    }
    const a = i * 4;
    indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createFoliageMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: foliageTexture(), alphaTest: 0.4, side: THREE.DoubleSide, toneMapped: false });
  leafMaterials.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.natureTime = time;
    shader.vertexShader = 'uniform float natureTime; varying vec3 vLeafNormal; varying vec3 vLeafPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      mat3 leafBasis = mat3(modelMatrix);
      vec4 leafPosition = vec4(position, 1.);
      #ifdef USE_INSTANCING
        leafBasis = leafBasis * mat3(instanceMatrix);
        leafPosition = instanceMatrix * leafPosition;
      #endif
      vLeafNormal = normalize(leafBasis * normal);
      vLeafPosition = (modelMatrix * leafPosition).xyz;
      float phase = vLeafPosition.x * .49 + vLeafPosition.z * .32;
      transformed.xz += vec2(sin(natureTime * .85 + phase), sin(natureTime * .73 + phase) * .4) * .025;`);
    shader.fragmentShader = 'uniform float natureTime; varying vec3 vLeafNormal; varying vec3 vLeafPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `
      float leafTurn = sin(natureTime * .7 + vLeafPosition.x * .5 + vLeafPosition.z * .34) * .10;
      vec2 leafUv = mat2(cos(leafTurn), -sin(leafTurn), sin(leafTurn), cos(leafTurn)) * (vAlphaMapUv - .5) + .5;
      diffuseColor.a *= texture2D(alphaMap, leafUv).g;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float leafLight = smoothstep(-.35, .95, dot(normalize(vLeafNormal), normalize(vec3(-.45, .8, -.3))));
      leafLight = mix(leafLight, floor(leafLight * 3.) / 3., .45);
      outgoingLight = mix(diffuseColor.rgb * vec3(.40, .46, .43), diffuseColor.rgb * vec3(1.18, 1.11, .88), leafLight);
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'cidade-folio-leaves-v1';
  material.userData.natureTime = time;
  return material;
}

function roadGrid(roads, margin) {
  const grid = new SpatialGrid(24);
  for (const road of roads) {
    if (road.bridge) continue;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
      grid.insertBox({ road, ax, az, bx, bz }, Math.min(ax, bx) - margin, Math.min(az, bz) - margin, Math.max(ax, bx) + margin, Math.max(az, bz) + margin);
    }
  }
  return grid;
}

/** Regular sidewalk spacing follows the whole polyline, including its bends. */
export function createSidewalkTrees(roads, { allowed = () => true, clearance = () => true, eligible = () => true, existing = [], spacing = 11, size = 0.85, sidewalkWidth = 2.4 } = {}) {
  const trees = [], occupied = new SpatialGrid(8), grid = roadGrid(roads, 14), rnd = mulberry32(7821);
  const register = (tree) => occupied.insertBox(tree, tree.x, tree.z, tree.x, tree.z);
  for (const tree of existing) register(tree);
  for (const road of roads) {
    if (road.kind === 'foot' || road.bridge || road.highway === 'motorway' || !eligible(road)) continue;
    let travelled = 0, next = spacing * 0.6;
    const total = road.pts.slice(1).reduce((length, point, i) => length + Math.hypot(point[0] - road.pts[i][0], point[1] - road.pts[i][1]), 0);
    // prepareCampus runs before the sidewalk meshes assign their crossing list.
    const crossings = road.sidewalkCrossings ? [...road.sidewalkCrossings] : [];
    if (!road.sidewalkCrossings && road.internal && road.name && total >= 32 && !['parking_aisle', 'driveway'].includes(road.tags?.service)) {
      for (let at = Math.min(25, total / 2); at < total - 10; at += 85) crossings.push(at);
    }
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1], length = Math.hypot(bx - ax, bz - az);
      if (length < 0.01) continue;
      const tx = (bx - ax) / length, tz = (bz - az) / length;
      while (next <= travelled + length) {
        const distance = next - travelled;
        if (next <= total - 5 && !crossings.some((at) => Math.abs(next - at) < 3.5)) for (const side of [-1, 1]) {
          const width = road.tags?.service === 'parking_aisle' ? 1.4 : sidewalkWidth;
          const offset = road.w / 2 + width * 0.6;
          const x = ax + tx * distance - tz * offset * side, z = az + tz * distance + tx * offset * side;
          if (!allowed(x, z) || !clearance(x, z)) continue;
          // Includes crossing footpaths and other roads, so trunks never block a junction.
          if ([...grid.query(x, z)].some((segment) => distToSegment(x, z, segment.ax, segment.az, segment.bx, segment.bz).d < segment.road.w / 2 + 0.8)) continue;
          if ([...occupied.query(x, z, 4)].some((tree) => Math.hypot(tree.x - x, tree.z - z) < 4)) continue;
          const tree = { x, z, s: size * (0.92 + rnd() * 0.16), r: rnd() * Math.PI * 2, v: rnd(), sidewalk: true, sidewalkYaw: -Math.atan2(tz, tx) };
          trees.push(tree);
          register(tree);
        }
        next += spacing;
      }
      travelled += length;
    }
  }
  return trees;
}

function grassMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.natureTime = time;
    shader.vertexShader = 'attribute vec3 bladeCenter; attribute float bladeHeight; attribute float bladeWidth; attribute vec3 bladeColor; uniform float natureTime; varying float bladeTip; varying vec3 grassColor;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = bladeCenter;
      vec3 centerWorld = (modelMatrix * vec4(bladeCenter, 1.)).xyz;
      vec2 facing = normalize(cameraPosition.xz - centerWorld.xz + vec2(.0001));
      transformed.xz += vec2(facing.y, -facing.x) * position.x * bladeWidth;
      transformed.y += position.y * bladeHeight;
      float phase = bladeCenter.x * .49 + bladeCenter.z * .32;
      float gust = sin(natureTime * .85 + phase) * .64 + sin(natureTime * 1.63 + phase * .57) * .36;
      transformed.xz += vec2(gust, sin(natureTime * .73 + phase) * .4) * position.y * bladeHeight * .24;
      bladeTip = position.y; grassColor = bladeColor;`);
    shader.fragmentShader = 'varying float bladeTip; varying vec3 grassColor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= grassColor * mix(vec3(.50, .56, .40), vec3(1.15, 1.14, .89), bladeTip);');
  };
  material.customProgramCacheKey = () => 'cidade-folio-grass-v1';
  material.userData.natureTime = time;
  return material;
}

/** Mown campus lawns and denser woodland floor, with bounded GPU blade counts. */
export function buildCampusGrass(world, masks, terrain, { quality = 'high', inside } = {}) {
  const root = new THREE.Group(); root.name = 'grama-campus';
  if (!world.quarter) return { root, count: 0 };
  const allowedKinds = new Set(['lawn', 'grass', 'wood', 'park', 'scrub']);
  const areas = world.areas.filter((area) => allowedKinds.has(area.kind));
  const areaGrid = new SpatialGrid(24), roads = roadGrid(world.roads, 12);
  for (const area of areas) {
    const xs = area.rings[0].map((p) => p[0]), zs = area.rings[0].map((p) => p[1]);
    areaGrid.insertBox(area, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
  }
  const ring = world.quarter[0], xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const step = quality === 'low' ? 1.3 : quality === 'med' ? 1 : .8;
  const limit = quality === 'low' ? 35000 : quality === 'med' ? 60000 : 100000;
  const rnd = mulberry32(6109), chunks = new Map(), color = new THREE.Color();
  let count = 0;
  // Shuffle the cells' visit order so a quality budget covers the entire campus.
  const columns = Math.ceil((maxX - minX) / step), rows = Math.ceil((maxZ - minZ) / step), cells = columns * rows;
  let stride = Math.max(1, Math.floor(cells * 0.61803398875));
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  while (gcd(stride, cells) !== 1) stride++;
  for (let sample = 0, cell = 0; sample < cells && count < limit; sample++, cell = (cell + stride) % cells) {
    const x = minX + (cell % columns + rnd()) * step, z = minZ + (Math.floor(cell / columns) + rnd()) * step;
    if (!pointInPolygon(x, z, world.quarter) || masks.tree.get(x, z) || (inside && !inside(x, z))) continue;
    const area = [...areaGrid.query(x, z)].find((candidate) => pointInPolygon(x, z, candidate.rings));
    if (!area) continue;
    if ([...roads.query(x, z)].some((segment) => distToSegment(x, z, segment.ax, segment.az, segment.bx, segment.bz).d < segment.road.w / 2 + (segment.road.kind === 'foot' ? 0.35 : 2.65))) continue;
    const key = `${Math.floor(x / 64)},${Math.floor(z / 64)}`;
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = { positions: [], heights: [], widths: [], colors: [] }));
    chunk.positions.push(x, terrain.heightAt(x, z) + 0.04, z);
    const wild = area.kind === 'wood' || area.kind === 'scrub';
    chunk.heights.push((wild ? 0.28 : 0.12) + rnd() * (wild ? 0.25 : 0.12));
    chunk.widths.push(0.035 + rnd() * 0.028);
    color.setHSL(0.22 + rnd() * 0.045, 0.36 + rnd() * 0.22, 0.29 + rnd() * 0.08);
    chunk.colors.push(color.r, color.g, color.b);
    count++;
  }
  const material = grassMaterial();
  for (const chunk of chunks.values()) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute('bladeCenter', new THREE.InstancedBufferAttribute(new Float32Array(chunk.positions), 3));
    geometry.setAttribute('bladeHeight', new THREE.InstancedBufferAttribute(new Float32Array(chunk.heights), 1));
    geometry.setAttribute('bladeWidth', new THREE.InstancedBufferAttribute(new Float32Array(chunk.widths), 1));
    geometry.setAttribute('bladeColor', new THREE.InstancedBufferAttribute(new Float32Array(chunk.colors), 3));
    geometry.instanceCount = chunk.heights.length;
    geometry.boundingBox = new THREE.Box3().setFromArray(chunk.positions);
    geometry.boundingBox.expandByScalar(0.8);
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'grama-com-vento';
    root.add(mesh);
  }
  return { root, count };
}

export function createWaterMaterial(rings, { pool = false, color, quality = 'high' } = {}) {
  const points = rings.flat(), xs = points.map((p) => p[0]), zs = points.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), width = Math.max(0.1, Math.max(...xs) - x0), depth = Math.max(0.1, Math.max(...zs) - z0);
  const maxPx = quality === 'low' ? 128 : 256;
  const w = Math.max(8, Math.min(maxPx, Math.ceil(width / 0.7))), h = Math.max(8, Math.min(maxPx, Math.ceil(depth / 0.7)));
  const shore = new Uint8Array(w * h), distanceRange = 12;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = x0 + (i + 0.5) / w * width, z = z0 + (j + 0.5) / h * depth;
    let distance = distanceRange;
    for (const ring of rings) for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      distance = Math.min(distance, distToSegment(x, z, a[0], a[1], b[0], b[1]).d);
    }
    shore[j * w + i] = Math.round(distance / distanceRange * 255);
  }
  const texture = new THREE.DataTexture(shore, w, h, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const shallow = new THREE.Color(pool ? '#6ccdcc' : color || '#5bc2b9');
  const deep = color ? new THREE.Color(color).multiplyScalar(0.55) : new THREE.Color(pool ? '#237cab' : '#13375f');
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { natureTime: time, shoreMap: { value: texture }, waterBounds: { value: new THREE.Vector4(x0, z0, width, depth) }, waterShallow: { value: shallow }, waterDeep: { value: deep } });
    shader.vertexShader = 'varying vec2 vWaterPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterPosition = position.xz;');
    shader.fragmentShader = `uniform float natureTime; uniform sampler2D shoreMap; uniform vec4 waterBounds; uniform vec3 waterShallow; uniform vec3 waterDeep; varying vec2 vWaterPosition;
      float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float waterNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(waterHash(i), waterHash(i + vec2(1., 0.)), f.x), mix(waterHash(i + vec2(0., 1.)), waterHash(i + 1.), f.x), f.y); }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float shoreDistance = texture2D(shoreMap, (vWaterPosition - waterBounds.xy) / waterBounds.zw).r * 12.;
      float noise = waterNoise(vWaterPosition * .8);
      float waterDepth = smoothstep(0., 5.5, shoreDistance + noise * .10);
      diffuseColor.rgb = mix(waterShallow, waterDeep, waterDepth * .86);
      diffuseColor.rgb *= .91 + .09 * waterNoise(vWaterPosition * .38);
      float contour = fract(shoreDistance * 1.9 - natureTime * .11 + noise * .14);
      float aa = max(fwidth(contour), .004);
      float ripple = 1. - smoothstep(.018 - aa, .018 + aa, abs(contour - .5));
      ripple *= smoothstep(.1, .3, shoreDistance) * (1. - smoothstep(1.5, 3., shoreDistance));
      ripple *= smoothstep(.29, .43, waterNoise(vWaterPosition * .6 + natureTime * .04));
      float surface = sin(vWaterPosition.x * 3.2 + natureTime * .55 + noise * 3.) * sin(vWaterPosition.y * 3.6 - natureTime * .4);
      diffuseColor.rgb += surface * .018;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .93, .80), ripple * .42);`);
  };
  material.customProgramCacheKey = () => 'cidade-folio-water-v1';
  material.userData.natureTime = time;
  material.userData.shoreMap = texture;
  return material;
}
