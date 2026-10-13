import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeAppearance, DEFAULT_APPEARANCE } from '../core/index.js';
import hairAssets from './hair-assets.js';
import { createScalpGeometry } from './hair.js';

/** Private runtime materials/rest shapes; the GLB, skeleton and clips stay intact. */
export function createAppearance(model, bones, meshes) {
  let appearance = { ...DEFAULT_APPEARANCE }, faceTexture = null;
  const entries = meshes.map(mesh => {
    mesh.material = mesh.material.clone();
    const clothing = /Sato_shirt|Sato_trousers|Sato_sneaker/.test(mesh.name);
    const deformable = clothing || mesh.name.startsWith('Sato_clean_face');
    if (deformable) mesh.geometry = mesh.geometry.clone();
    if (clothing) {
      const p = mesh.geometry.attributes.position, uv = [];
      for (let i = 0; i < p.count; i++) {
        if (mesh.name.startsWith('Sato_shirt')) uv.push(p.getX(i) / .42 + .5, (p.getY(i) - .43) / .29);
        else if (mesh.name.startsWith('Sato_trousers')) uv.push(p.getX(i) / .22 + .5, (p.getY(i) - .06) / .39);
        else uv.push((p.getZ(i) + .043) / .12, p.getY(i) / .075);
      }
      mesh.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }
    return { mesh, material: mesh.material, color: mesh.material.color.clone(), map: mesh.material.map,
      emissiveMap: mesh.material.emissiveMap, positions: deformable ? mesh.geometry.attributes.position.array.slice() : null };
  });
  const groups = new Map(), accessoryMaterials = [], hairMaterials = [], beardTextures = [];
  const material = (color, hair = false) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness: .9 });
    (hair ? hairMaterials : accessoryMaterials).push(result); return result;
  };
  const hair = material(DEFAULT_APPEARANCE.hairColor, true), accent = material(DEFAULT_APPEARANCE.accessoryColor);
  const dark = material('#141c27'), lens = material('#172b3c');
  function part(group, geometry, mat, position, scale) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(...position); if (scale) mesh.scale.set(...scale);
    mesh.castShadow = mesh.receiveShadow = true; mesh.userData.paintballIgnore = true;
    group.add(mesh); return mesh;
  }
  const box = (group, mat, pos, size) => part(group, new THREE.BoxGeometry(...size), mat, pos);
  const sphere = (group, mat, pos, size, half = false) => part(group,
    new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, half ? Math.PI * .55 : Math.PI), mat, pos, size);
  function group(key) { const result = new THREE.Group(); result.name = `character-${key}`; groups.set(key, result); return result; }
  const fittedScalp = createScalpGeometry(meshes), fittedNape = createScalpGeometry(meshes, true);
  function scalp(g, napeOnly = false) {
    part(g, (napeOnly ? fittedNape : fittedScalp).clone(), hair, [0, 0, 0]).material.side = THREE.DoubleSide;
  }
  scalp(group('nape:hair'), true);
  for (const [style, asset] of Object.entries(hairAssets)) {
    const g = group(`hair:${style}`); scalp(g);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(asset.normal, 3));
    geometry.setIndex(asset.index);
    const authored = part(g, geometry, hair, [0, -.006, 0]); authored.userData.hairSource = asset.source;
    g.userData.hairSource = asset.source;
  }
  // Merge the fitted scalp and authored asset into one draw call per head.
  for (const [key, g] of groups) if (key.startsWith('hair:') || key.startsWith('nape:')) {
    const pieces = g.children.map(mesh => {
      mesh.updateMatrix(); const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.deleteAttribute('uv'); geometry.applyMatrix4(mesh.matrix); mesh.geometry.dispose(); return geometry;
    });
    const merged = mergeGeometries(pieces); for (const geometry of pieces) geometry.dispose();
    g.clear(); part(g, merged, hair, [0, 0, 0]);
  }
  fittedScalp.dispose(); fittedNape.dispose();
  const cloth = material(DEFAULT_APPEARANCE.shirtColor), lapel = material('#304558'), white = material('#eeeae0'), tie = material('#8b3140');
  const formal = group('clothes:formal'), necktie = group('clothes:tie'), lapels = group('clothes:lapels');
  function patch(g, points, mat) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
    const m = part(g, geometry, mat, [0, 0, 0]); m.material.side = THREE.DoubleSide;
  }
  // Sleeves use the existing arm skin weights, so elbows and fists still bend.
  for (const source of meshes.filter(m => /Sato_arm_hand/.test(m.name))) {
    const geometry = source.geometry.clone(), p = geometry.attributes.position, indices = [];
    for (let i = 0; i < geometry.index.count; i += 3) {
      const triangle = [0, 1, 2].map(j => geometry.index.getX(i + j));
      if (triangle.every(v => Math.abs(p.getX(v)) < .390)) indices.push(...triangle);
    }
    for (let i = 0; i < p.count; i++) { p.setY(i, .682 + (p.getY(i) - .682) * 1.12); p.setZ(i, .009 + (p.getZ(i) - .009) * 1.12); }
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.SkinnedMesh(geometry, cloth); mesh.name = `character-formal:${source.name}`; mesh.bind(source.skeleton, source.bindMatrix); mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true; formal.add(mesh);
  }
  patch(lapels, [[-.052, .695, .056], [.052, .695, .056], [.005, .540, .079], [-.005, .540, .079]], white);
  patch(lapels, [[-.045, .702, .059], [-.084, .665, .080], [-.022, .535, .083], [-.009, .545, .083]], lapel);
  patch(lapels, [[.045, .702, .059], [.084, .665, .080], [.022, .535, .083], [.009, .545, .083]], lapel);
  for (const y of [.535, .493]) sphere(lapels, dark, [0, y, .079], [.004, .004, .002]);
  box(lapels, cloth, [.056, .603, .079], [.034, .005, .003]);
  patch(necktie, [[-.012, .657, .083], [.012, .657, .083], [.020, .535, .083], [0, .519, .083]], tie);
  patch(necktie, [[0, .519, .083], [-.020, .535, .083], [-.012, .657, .083], [.012, .657, .083]], tie);
  const collar = group('clothes:collar');
  for (const side of [-1, 1]) patch(collar, [[0, .685, .058], [side * .037, .701, .047], [side * .050, .673, .074], [side * .020, .650, .081]], white);
  for (let i = 0; i < 5; i++) sphere(collar, white, [0, .62 - i * .035, .077], [.003, .003, .003]);
  for (const style of ['stubble', 'goatee', 'full']) {
    const g = group(`beard:${style}`);
    const n = 128, bytes = new Uint8Array(n * n * 4);
    for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
      const x = (px / (n - 1) - .5) * .18, y = .67 + py / (n - 1) * .266, ax = Math.abs(x);
      const jaw = y > .727 && (style === 'goatee' ? ax < .031 && y < .747 : y < .750 + .043 * THREE.MathUtils.smoothstep(ax, .027, .082));
      const moustache = style !== 'stubble' && ax < .036 && ax > .006 && y > .775 && y < .783;
      const lips = ax < .034 && y > .747 && y < .774;
      const stipple = style !== 'stubble' || (px * 13 + py * 7) % 11 < 5;
      const i = (py * n + px) * 4;
      bytes[i] = bytes[i + 1] = bytes[i + 2] = 255; bytes[i + 3] = ((jaw && !lips) || moustache) && stipple ? 255 : 0;
    }
    const texture = new THREE.DataTexture(bytes, n, n); texture.needsUpdate = true; beardTextures.push(texture);
    const mat = material(DEFAULT_APPEARANCE.hairColor, true); mat.map = texture; mat.alphaTest = .5;
    for (const source of meshes.filter(m => m.name.startsWith('Sato_clean_face'))) {
      const geometry = source.geometry.clone(), p = geometry.attributes.position, uv = [], indices = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        uv.push(x / .18 + .5, (y - .67) / .266);
        p.setXYZ(i, x * 1.015, .80 + (y - .80) * 1.008, z + .0015);
      }
      for (let i = 0; i < geometry.index.count; i += 3) {
        const triangle = [0, 1, 2].map(j => geometry.index.getX(i + j));
        if (triangle.some(v => p.getY(v) < .81) && triangle.every(v => p.getZ(v) > -.005)) indices.push(...triangle);
      }
      geometry.setIndex(indices); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const mesh = new THREE.SkinnedMesh(geometry, mat); mesh.name = `beard-${style}`;
      mesh.bind(source.skeleton, source.bindMatrix); mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true; mesh.userData.paintballIgnore = true; g.add(mesh);
    }
  }
  for (const style of ['cap', 'backwards', 'beanie', 'headphones']) {
    const g = group(`head:${style}`);
    if (style === 'headphones') {
      const band = part(g, new THREE.TorusGeometry(.112, .012, 6, 20, Math.PI), accent, [0, .865, -.005]);
      band.rotation.z = 0;
      for (const side of [-1, 1]) { box(g, dark, [side * .111, .835, -.004], [.026, .061, .048]); box(g, accent, [side * .128, .835, -.004], [.012, .045, .038]); }
    } else {
      sphere(g, accent, [0, .875, -.012], [.111, style === 'beanie' ? .125 : .106, .112], true);
      if (style === 'beanie') {
        const cuff = part(g, new THREE.CylinderGeometry(.112, .112, .035, 20), accent, [0, .866, -.012]); cuff.scale.z = 1.01;
        sphere(g, accent, [0, 1.009, -.012], [.022, .022, .022]);
      } else box(g, accent, [0, .882, style === 'cap' ? .117 : -.136], [.149, .012, .10]);
    }
  }
  {
    const g = group('face:sunglasses');
    for (const side of [-1, 1]) {
      box(g, accent, [side * .045, .825, .103], [.082, .043, .011]);
      box(g, lens, [side * .045, .825, .110], [.067, .029, .004]);
      box(g, accent, [side * .093, .825, .046], [.009, .009, .118]);
    }
    box(g, accent, [0, .83, .108], [.017, .009, .009]);
  }
  {
    const g = group('face:mask');
    sphere(g, accent, [0, .765, .081], [.076, .043, .028]);
    for (const side of [-1, 1]) box(g, accent, [side * .084, .774, .039], [.006, .008, .106]);
  }
  // Accessory coordinates use the model's authored rest frame, then follow the head bone.
  model.updateWorldMatrix(true, true);
  const head = bones['DEF-head'];
  const restToHead = head.matrixWorld.clone().invert().multiply(model.matrixWorld);
  for (const [key, g] of groups) {
    if (key.startsWith('beard:') || key === 'clothes:formal') model.add(g);
    else if (key.startsWith('clothes:')) { const chest = bones['DEF-spine003']; g.applyMatrix4(chest.matrixWorld.clone().invert().multiply(model.matrixWorld)); chest.add(g); }
    else { g.applyMatrix4(restToHead); head.add(g); }
    g.visible = false;
  }

  const patterns = new Map();
  function pattern(kind, style) {
    const key = `${kind}:${style}`;
    if (patterns.has(key)) return patterns.get(key);
    const n = 64, bytes = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const marked = style === 'stripes' ? Math.floor(y / 8) % 2 === 0
        : style === 'sport' ? x < 9 || x > 54 || (kind === 'shirt' && y > 49)
        : style === 'cargo' ? y > 25 && y < 42 && (x < 19 || x > 45)
        : style === 'jogger' ? x < 7 || x > 56 || y < 9 : false;
      const i = (y * n + x) * 4, v = marked ? (style === 'stripes' ? 135 : 185) : 255;
      bytes[i] = bytes[i + 1] = bytes[i + 2] = v; bytes[i + 3] = 255;
    }
    const texture = new THREE.DataTexture(bytes, n, n); texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter; texture.needsUpdate = true; patterns.set(key, texture); return texture;
  }
  function paintFace(entry) {
    if (!entry.map?.image || !globalThis.document?.createElement) return entry.map;
    const a = appearance;
    if (a.eyeStyle === 'original' && a.eyeColor === DEFAULT_APPEARANCE.eyeColor && a.skinColor === DEFAULT_APPEARANCE.skinColor) return entry.map;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.drawImage(entry.map.image, 0, 0, 256, 256);
    if (a.skinColor !== DEFAULT_APPEARANCE.skinColor) {
      const pixels = ctx.getImageData(0, 0, 256, 256), target = new THREE.Color(a.skinColor);
      target.convertLinearToSRGB();
      for (let i = 0; i < pixels.data.length; i += 4) {
        const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
        if (r > 100 && g > 65 && r / g > 1.1 && r / g < 1.55 && g / Math.max(1, b) < 1.8) {
          const shade = Math.min(1.12, r / 237);
          pixels.data[i] = target.r * 255 * shade; pixels.data[i + 1] = target.g * 255 * shade; pixels.data[i + 2] = target.b * 255 * shade;
        }
      }
      ctx.putImageData(pixels, 0, 0);
    }
    if (a.eyeStyle !== 'original' || a.eyeColor !== DEFAULT_APPEARANCE.eyeColor) {
      for (const [cx, sign] of [[68, -1], [188, 1]]) {
        const skin = ctx.getImageData(128, 60, 1, 1).data;
        ctx.fillStyle = `rgb(${skin[0]}, ${skin[1]}, ${skin[2]})`; ctx.fillRect(cx - 35, 105, 70, 45);
        const height = a.eyeStyle === 'sleepy' ? 7 : a.eyeStyle === 'sharp' ? 11 : a.eyeStyle === 'round' ? 20 : 15;
        ctx.fillStyle = '#fff4de'; ctx.beginPath(); ctx.ellipse(cx, 128, 29, height, sign * (a.eyeStyle === 'sharp' ? -.15 : .02), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4e3329'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(cx, 126, 29, height, sign * (a.eyeStyle === 'sharp' ? -.15 : .02), Math.PI, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = a.eyeColor; ctx.beginPath(); ctx.ellipse(cx, 128, 12, height * .9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#211c24'; ctx.beginPath(); ctx.ellipse(cx, 128, 5, height * .78, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(cx - 4, 122, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    faceTexture = new THREE.CanvasTexture(canvas); faceTexture.flipY = entry.map.flipY;
    faceTexture.colorSpace = THREE.SRGBColorSpace; return faceTexture;
  }
  const paint = (entry, values) => {
    // The visual module may have installed a toon counterpart after creation.
    for (const m of new Set([entry.material, entry.mesh.material, entry.mesh.userData.stdMaterial].filter(Boolean))) {
      if (values.color) m.color.copy(values.color);
      if ('map' in values) m.map = values.map;
      if ('emissiveMap' in values) m.emissiveMap = values.emissiveMap;
      m.needsUpdate = true;
    }
  };
  function apply(value) {
    appearance = normalizeAppearance(value); faceTexture?.dispose(); faceTexture = null;
    const a = appearance, cap = ['cap', 'backwards', 'beanie'].includes(a.headAccessory);
    for (const entry of entries) {
      const { mesh } = entry;
      mesh.userData.characterHidden = false;
      if (entry.positions) mesh.geometry.attributes.position.array.set(entry.positions);
      paint(entry, { color: entry.color, map: entry.map, emissiveMap: entry.emissiveMap });
      if (/warm peach skin|ear fold/.test(entry.material.name)) {
        const color = new THREE.Color(a.skinColor); if (entry.material.name.includes('ear fold')) color.multiplyScalar(.73);
        paint(entry, { color });
      }
      if (mesh.name.startsWith('Sato_hair_cap')) {
        mesh.userData.characterHidden = true;
        if (a.hairColor !== DEFAULT_APPEARANCE.hairColor) paint(entry, { color: new THREE.Color(a.hairColor), map: null, emissiveMap: null });
      }
      if (mesh.name.startsWith('Sato_glasses')) {
        mesh.userData.characterHidden = a.faceAccessory !== 'glasses';
        if (a.accessoryColor !== DEFAULT_APPEARANCE.accessoryColor) paint(entry, { color: new THREE.Color(a.accessoryColor) });
      }
      if (entry.material.name.includes('painted anime face')) { const map = paintFace(entry); paint(entry, { map, emissiveMap: map }); }
      const kind = mesh.name.startsWith('Sato_shirt') ? 'shirt' : mesh.name.startsWith('Sato_trousers') ? 'pants' : mesh.name.startsWith('Sato_sneaker') ? 'shoe' : null;
      if (mesh.name === 'Sato_chest_mark') mesh.userData.characterHidden = /social|suit/.test(a.shirtStyle);
      if (!kind) continue;
      const style = a[`${kind}Style`], colorKey = `${kind}Color`;
      const trim = /collar|seams|facing|outsole/.test(entry.material.name), sole = /ivory sole/.test(entry.material.name);
      const color = a[colorKey] === DEFAULT_APPEARANCE[colorKey] ? entry.color.clone() : new THREE.Color(a[colorKey]);
      if (kind === 'pants' && style === 'dress' && a[colorKey] === DEFAULT_APPEARANCE[colorKey]) color.set('#343b45');
      if (a[colorKey] !== DEFAULT_APPEARANCE[colorKey] && trim) color.multiplyScalar(.65);
      if (!sole) paint(entry, { color, map: ['classic', 'jeans', 'casual', 'high', 'dress', 'social', 'socialTie', 'suit', 'suitTie'].includes(style) ? null : pattern(kind, style) });
      if (kind === 'shoe' && style === 'dress') paint(entry, { color: new THREE.Color(a.shoeColor).multiplyScalar(sole ? .28 : .55), map: null });
      const p = mesh.geometry.attributes.position, old = entry.positions;
      p.array.set(old);
      for (let i = 0; i < p.count; i++) {
        const x = old[i * 3], y = old[i * 3 + 1], z = old[i * 3 + 2];
        if (kind === 'pants' && style === 'cargo' && y > .19 && y < .34) p.setX(i, x + Math.sign(x) * .008);
        if (kind === 'pants' && style === 'jogger' && y < .19) p.setX(i, Math.sign(x) * .076 + (x - Math.sign(x) * .076) * .78);
        if (kind === 'pants' && style === 'dress' && y < .34) p.setX(i, Math.sign(x) * .076 + (x - Math.sign(x) * .076) * .86);
        if (kind === 'shoe' && style === 'high' && y > .04 && z < .03) p.setY(i, y + .026 * THREE.MathUtils.smoothstep(y, .04, .06));
      }
      p.needsUpdate = true; mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    }
    // Adjust rest geometry, never the animation skeleton or hitbox dimensions.
    for (const entry of entries) if (entry.positions) {
      const p = entry.mesh.geometry.attributes.position;
      if (a.gender === 'female') for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (entry.mesh.name.startsWith('Sato_shirt')) {
          const waist = 1 - THREE.MathUtils.smoothstep(Math.abs(y - .51), .025, .13);
          p.setX(i, x * (.97 - waist * .08));
          if (z > 0) p.setZ(i, z + .012 * THREE.MathUtils.smoothstep(y, .55, .62) * (1 - THREE.MathUtils.smoothstep(y, .65, .70)));
        } else if (entry.mesh.name.startsWith('Sato_trousers') && y > .3) p.setX(i, x * (1 + .07 * THREE.MathUtils.smoothstep(y, .3, .40)));
        else if (entry.mesh.name.startsWith('Sato_clean_face') && y < .80) p.setX(i, x * .94);
      }
      p.needsUpdate = true; entry.mesh.geometry.computeVertexNormals(); entry.mesh.geometry.computeBoundingBox(); entry.mesh.geometry.computeBoundingSphere();
    }
    for (const m of hairMaterials) m.color.set(a.hairColor);
    for (const m of accessoryMaterials) if (![dark, lens, cloth, lapel, white, tie].includes(m)) m.color.set(a.accessoryColor);
    cloth.color.set(a.shirtColor); lapel.color.set(a.shirtColor).multiplyScalar(1.3); tie.color.set(a.accessoryColor);
    // Also synchronize their toon materials if the world collected them.
    for (const g of groups.values()) g.traverse(o => {
      if (o.isMesh && o.userData.stdMaterial) o.material.color.copy(o.userData.stdMaterial.color);
    });
    for (const [key, g] of groups) {
      const [kind, style] = key.split(':');
      g.userData.chosen = kind === 'clothes' ? (style === 'tie' ? /Tie$/.test(a.shirtStyle) : style === 'lapels' ? /^suit/.test(a.shirtStyle) : /social|suit/.test(a.shirtStyle))
        : kind === 'nape' ? cap && a.hairStyle !== 'bald' : kind === 'hair' ? !cap && a.hairStyle === style : kind === 'beard' ? a.beard === style : a[`${kind}Accessory`] === style;
      g.visible = g.userData.chosen;
    }
    return { ...appearance };
  }
  apply(appearance);
  return {
    apply,
    get value() { return { ...appearance }; },
    setHeadVisible(visible, armsVisible = true) { for (const [key, g] of groups) g.visible = (key === 'clothes:formal' ? visible || armsVisible : visible) && g.userData.chosen; },
    dispose() {
      faceTexture?.dispose(); for (const t of [...patterns.values(), ...beardTextures]) t.dispose();
      for (const entry of entries) { entry.material.dispose(); if (entry.positions) entry.mesh.geometry.dispose(); }
      for (const g of groups.values()) { g.removeFromParent(); g.traverse(o => o.geometry?.dispose()); }
      for (const m of [...hairMaterials, ...accessoryMaterials]) m.dispose();
    },
  };
}
