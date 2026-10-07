// Baixa os dados reais da Cidade de Deus (Osasco/SP) e gera:
//   public/data/cidade-de-deus.geojson  -> feições do OpenStreetMap (lon/lat, WGS84)
//   public/data/terrain.json            -> grade de elevação (metros) amostrada do SRTM
//
// Uso:  npm run data            (usa cache em data/raw se existir)
//       npm run data -- --fresh (força novo download)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const FRESH = process.argv.includes('--fresh');
const UA = 'cidade-de-deus-3d/0.1 (projeto pessoal de jogo)';

// Polígono oficial do OSM: place=quarter "Cidade de Deus" (way 156528061)
const QUARTER_WAY_ID = 156528061;
// Bounding box do bairro + entorno (inclui o Shopping União ao norte e o
// São Francisco Golf Club ao sul, que encostam no bairro)
const BBOX = { south: -23.5592, west: -46.7792, north: -23.5356, east: -46.7600 };

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function cached(file, fetcher) {
  const p = path.join(RAW, file);
  if (!FRESH && fs.existsSync(p)) return fs.readFileSync(p);
  const buf = await fetcher();
  fs.writeFileSync(p, buf);
  return buf;
}

async function get(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4) throw new Error(`${res.status} ${res.statusText} em ${url}`);
    console.warn(`  ${res.status} — tentando de novo (${attempt})...`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

// ---------------------------------------------------------------- OSM
async function fetchOsm() {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const query = `
[out:json][timeout:180];
(
  way(${QUARTER_WAY_ID});
  way["building"](${b});            relation["building"](${b});
  way["building:part"](${b});
  way["highway"](${b});
  way["railway"](${b});
  way["waterway"](${b});
  way["natural"](${b});             relation["natural"](${b});
  way["landuse"](${b});             relation["landuse"](${b});
  way["leisure"](${b});             relation["leisure"](${b});
  way["amenity"](${b});             relation["amenity"](${b});
  way["barrier"](${b});
  node["natural"="tree"](${b});
  node["amenity"](${b});
  node["shop"](${b});
  node["highway"="traffic_signals"](${b});
  node["highway"="street_lamp"](${b});
);
out body;
>;
out skel qt;`;
  console.log('> Overpass: baixando feições do OSM...');
  const buf = await cached('osm.json', () =>
    get('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    })
  );
  return JSON.parse(buf.toString('utf8'));
}

// Recorte de linhas na bbox (Liang–Barsky por segmento), devolve várias partes
function clipLine(coords) {
  const parts = [];
  let cur = [];
  const { west: x0, east: x1, south: y0, north: y1 } = BBOX;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { if (cur.length > 1) parts.push(cur); cur = []; continue; }
    const a = [ax + dx * t0, ay + dy * t0];
    const bb = [ax + dx * t1, ay + dy * t1];
    if (cur.length === 0) cur.push(a);
    cur.push(bb);
    if (t1 < 1) { if (cur.length > 1) parts.push(cur); cur = []; }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}

// polígono entra se o seu retângulo envolvente cruza a bbox
function intersectsBbox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 >= BBOX.west && x0 <= BBOX.east && y1 >= BBOX.south && y0 <= BBOX.north;
}

const round = (c) => [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7];

function buildGeoJson(osm) {
  const fc = osmtogeojson(osm, { flatProperties: true });
  const out = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const props = { ...f.properties, id: f.id };
    delete props.meta;
    if (g.type === 'LineString') {
      for (const part of clipLine(g.coordinates))
        out.push({ type: 'Feature', id: f.id, properties: props, geometry: { type: 'LineString', coordinates: part.map(round) } });
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates)
        for (const part of clipLine(line))
          out.push({ type: 'Feature', id: f.id, properties: props, geometry: { type: 'LineString', coordinates: part.map(round) } });
    } else if (g.type === 'Polygon') {
      if (f.id === `way/${QUARTER_WAY_ID}` || intersectsBbox(g.coordinates[0]))
        out.push({ type: 'Feature', id: f.id, properties: props, geometry: { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(round)) } });
    } else if (g.type === 'MultiPolygon') {
      const polys = g.coordinates.filter((p) => intersectsBbox(p[0]));
      if (polys.length)
        out.push({ type: 'Feature', id: f.id, properties: props, geometry: { type: 'MultiPolygon', coordinates: polys.map((p) => p.map((r) => r.map(round))) } });
    } else if (g.type === 'Point') {
      const [x, y] = g.coordinates;
      if (x >= BBOX.west && x <= BBOX.east && y >= BBOX.south && y <= BBOX.north && Object.keys(f.properties).length > 1)
        out.push({ type: 'Feature', id: f.id, properties: props, geometry: { type: 'Point', coordinates: round(g.coordinates) } });
    }
  }
  return {
    type: 'FeatureCollection',
    name: 'Cidade de Deus, Osasco - SP',
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    attribution: 'Dados © OpenStreetMap contributors, ODbL 1.0',
    features: out,
  };
}

// ---------------------------------------------------------------- Elevação (Terrarium / SRTM)
const Z = 15;
const lon2tx = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2ty = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};

async function buildTerrain() {
  console.log('> Elevação: baixando tiles Terrarium (SRTM)...');
  const tx0 = Math.floor(lon2tx(BBOX.west)), tx1 = Math.floor(lon2tx(BBOX.east));
  const ty0 = Math.floor(lat2ty(BBOX.north)), ty1 = Math.floor(lat2ty(BBOX.south));
  const tiles = new Map();
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      const buf = await cached(`terrarium_${Z}_${tx}_${ty}.png`, () =>
        get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`)
      );
      tiles.set(`${tx}/${ty}`, PNG.sync.read(buf));
    }

  const pixel = (px, py) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const png = tiles.get(`${tx}/${ty}`);
    const x = Math.min(255, Math.max(0, Math.floor(px - tx * 256)));
    const y = Math.min(255, Math.max(0, Math.floor(py - ty * 256)));
    const i = (y * 256 + x) * 4;
    return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
  };
  // amostragem bilinear em coordenadas de pixel globais
  const sample = (lon, lat) => {
    const px = lon2tx(lon) * 256 - 0.5, py = lat2ty(lat) * 256 - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const a = pixel(x0, y0), b = pixel(x0 + 1, y0), c = pixel(x0, y0 + 1), d = pixel(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  // grade regular ~6 m
  const lat0 = (BBOX.north + BBOX.south) / 2;
  const widthM = (BBOX.east - BBOX.west) * 111320 * Math.cos((lat0 * Math.PI) / 180);
  const heightM = (BBOX.north - BBOX.south) * 110574;
  const nx = Math.round(widthM / 6) + 1, ny = Math.round(heightM / 6) + 1;
  let h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const lon = BBOX.west + ((BBOX.east - BBOX.west) * i) / (nx - 1);
      const lat = BBOX.north - ((BBOX.north - BBOX.south) * j) / (ny - 1);
      h[j * nx + i] = sample(lon, lat);
    }

  // O SRTM é um modelo de superfície (inclui copas/prédios) e tem resolução ~30 m:
  // suavização gaussiana separável para tirar degraus e ruído.
  const blur = (src, r) => {
    const k = [];
    let s = 0;
    for (let i = -r; i <= r; i++) { const w = Math.exp(-(i * i) / (2 * (r / 2) ** 2)); k.push(w); s += w; }
    const kk = k.map((w) => w / s);
    const tmp = new Float32Array(src.length), dst = new Float32Array(src.length);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let v = 0;
        for (let o = -r; o <= r; o++) v += src[j * nx + Math.min(nx - 1, Math.max(0, i + o))] * kk[o + r];
        tmp[j * nx + i] = v;
      }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let v = 0;
        for (let o = -r; o <= r; o++) v += tmp[Math.min(ny - 1, Math.max(0, j + o)) * nx + i] * kk[o + r];
        dst[j * nx + i] = v;
      }
    return dst;
  };
  h = blur(h, 4);

  let min = Infinity, max = -Infinity;
  for (const v of h) { if (v < min) min = v; if (v > max) max = v; }
  console.log(`  grade ${nx}x${ny}, altitude ${min.toFixed(1)} m .. ${max.toFixed(1)} m`);
  return {
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north],
    nx, ny, min, max,
    source: 'Mapzen Terrarium (SRTM) via AWS Open Data',
    heights: Array.from(h, (v) => Math.round(v * 100) / 100),
  };
}

// ---------------------------------------------------------------- main
const osm = await fetchOsm();
const geo = buildGeoJson(osm);
const stats = {};
for (const f of geo.features) {
  const p = f.properties;
  const k = p.building ? 'building' : p.highway ? 'highway' : p.waterway ? 'waterway' : p.landuse ? 'landuse' : p.leisure ? 'leisure' : p.natural ? 'natural' : p.amenity ? 'amenity' : p.shop ? 'shop' : 'outros';
  stats[k] = (stats[k] || 0) + 1;
}
console.log('  feições:', stats);
fs.writeFileSync(path.join(OUT, 'cidade-de-deus.geojson'), JSON.stringify(geo));

const terrain = await buildTerrain();
fs.writeFileSync(path.join(OUT, 'terrain.json'), JSON.stringify(terrain));
console.log('> OK: public/data/cidade-de-deus.geojson e public/data/terrain.json');
