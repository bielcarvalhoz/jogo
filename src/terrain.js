import * as THREE from 'three';
import { pointInPolygon } from './geo.js';

// Terreno a partir da grade de elevação real (SRTM).
// heightAt() reproduz EXATAMENTE a mesma triangulação da malha, então qualquer coisa
// apoiada no chão (ruas, prédios, jogador) fica rente ao relevo, sem flutuar nem afundar.

export function createTerrain(data, proj) {
  const { nx, ny, heights } = data;
  const [west, south, east, north] = data.bbox;
  const [x0, z0] = proj.toLocal(west, north); // canto noroeste
  const [x1, z1] = proj.toLocal(east, south); // canto sudeste
  const width = x1 - x0, depth = z1 - z0;
  const dx = width / (nx - 1), dz = depth / (ny - 1);
  const base = data.min; // altitude real do ponto mais baixo -> y = 0

  const h = new Float32Array(heights.length);
  for (let i = 0; i < h.length; i++) h[i] = heights[i] - base;

  const H = (i, j) => h[j * nx + i];

  function heightAt(x, z) {
    let fx = (x - x0) / dx, fz = (z - z0) / dz;
    fx = Math.min(nx - 1.0001, Math.max(0, fx));
    fz = Math.min(ny - 1.0001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    // célula: a=(i,j) b=(i,j+1) c=(i+1,j+1) d=(i+1,j)
    // triângulos (a,b,d) quando u+v<=1, senão (b,c,d)
    const a = H(i, j), b = H(i, j + 1), c = H(i + 1, j + 1), d = H(i + 1, j);
    if (u + v <= 1) return a + (d - a) * u + (b - a) * v;
    return c + (b - c) * (1 - u) + (d - c) * (1 - v);
  }

  /**
   * Lagos: nível = média da margem. O fundo é escavado e uma faixa de BAND metros em volta
   * é nivelada suavemente até o nível da margem (desce o lado alto, aterra o lado baixo),
   * para a água não flutuar nem aparecer "espinhos" de relevo em volta.
   * Precisa rodar antes de qualquer coisa consultar heightAt().
   */
  function carveWater(rings, { band = 10, depth = 1.0, bank = 0.25 } = {}) {
    const outer = rings[0];
    let sum = 0, cnt = 0;
    for (let k = 0; k < outer.length; k++) {
      const [ax, az] = outer[k], [bx, bz] = outer[(k + 1) % outer.length];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s < n; s++) { sum += heightAt(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n); cnt++; }
    }
    const level = sum / cnt - 0.3;
    const edgeDist = (x, z) => {
      let d = Infinity;
      for (let k = 0; k < outer.length; k++) {
        const [ax, az] = outer[k], [bx, bz] = outer[(k + 1) % outer.length];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
        d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
      }
      return d;
    };
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const i0 = Math.max(0, Math.floor((minX - band - x0) / dx)), i1 = Math.min(nx - 1, Math.ceil((maxX + band - x0) / dx));
    const j0 = Math.max(0, Math.floor((minZ - band - z0) / dz)), j1 = Math.min(ny - 1, Math.ceil((maxZ + band - z0) / dz));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * dx, z = z0 + j * dz, k = j * nx + i;
        if (pointInPolygon(x, z, rings)) { h[k] = level - depth; continue; }
        const d = edgeDist(x, z);
        if (d >= band) continue;
        const t = d / band, sm = t * t * (3 - 2 * t);
        const target = level + bank;
        h[k] = target + (h[k] - target) * sm;
      }
    return level;
  }

  function buildMesh(groundTexture) {
    const pos = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = x0 + i * dx;
        pos[k * 3 + 1] = H(i, j);
        pos[k * 3 + 2] = z0 + j * dz;
        uv[k * 2] = i / (nx - 1);
        uv[k * 2 + 1] = 1 - j / (ny - 1);
      }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let n = 0;
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = (j + 1) * nx + i, c = (j + 1) * nx + i + 1, d = j * nx + i + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = d;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terreno';

    // "saia" ao redor da borda para o mapa não parecer uma folha flutuando
    const skirt = buildSkirt();
    return { mesh, skirt };
  }

  /**
   * Malha de detalhe: o mesmo relevo (mesmos vértices) recortado no retângulo `rect`, com uma
   * textura de alta resolução por cima (polygonOffset evita briga de profundidade com a base).
   */
  function buildDetailMesh(rect, texture) {
    const i0 = Math.max(0, Math.floor((rect.x0 - x0) / dx)), i1 = Math.min(nx - 1, Math.ceil((rect.x0 + rect.width - x0) / dx));
    const j0 = Math.max(0, Math.floor((rect.z0 - z0) / dz)), j1 = Math.min(ny - 1, Math.ceil((rect.z0 + rect.depth - z0) / dz));
    const cw = i1 - i0 + 1, chh = j1 - j0 + 1;
    const pos = new Float32Array(cw * chh * 3), uv = new Float32Array(cw * chh * 2);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = (j - j0) * cw + (i - i0);
        const x = x0 + i * dx, z = z0 + j * dz;
        pos[k * 3] = x; pos[k * 3 + 1] = H(i, j); pos[k * 3 + 2] = z;
        uv[k * 2] = (x - rect.x0) / rect.width;
        uv[k * 2 + 1] = 1 - (z - rect.z0) / rect.depth;
      }
    const idx = new Uint32Array((cw - 1) * (chh - 1) * 6);
    let n = 0;
    for (let j = 0; j < chh - 1; j++)
      for (let i = 0; i < cw - 1; i++) {
        const a = j * cw + i, b = (j + 1) * cw + i, c = (j + 1) * cw + i + 1, d = j * cw + i + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = d;
        idx[n++] = b; idx[n++] = c; idx[n++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.receiveShadow = true;
    mesh.name = 'terreno-detalhe-campus';
    return mesh;
  }

  function buildSkirt() {
    const pts = [];
    for (let i = 0; i < nx; i++) pts.push([i, 0]);
    for (let j = 1; j < ny; j++) pts.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i--) pts.push([i, ny - 1]);
    for (let j = ny - 2; j > 0; j--) pts.push([0, j]);
    pts.push([0, 0]);
    const pos = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ia, ja] = pts[k], [ib, jb] = pts[k + 1];
      const ax = x0 + ia * dx, az = z0 + ja * dz, bx = x0 + ib * dx, bz = z0 + jb * dz;
      const ha = H(ia, ja), hb = H(ib, jb), lo = -40;
      pos.push(ax, ha, az, bx, hb, bz, ax, lo, az, bx, hb, bz, bx, lo, bz, ax, lo, az);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1, side: THREE.DoubleSide }));
    mesh.name = 'saia-terreno';
    return mesh;
  }

  return { heightAt, carveWater, buildMesh, buildDetailMesh, base, bounds: { x0, z0, x1, z1, width, depth }, minAlt: data.min, maxAlt: data.max };
}
