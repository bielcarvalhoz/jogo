// Gera public/data/campus-cidade-de-deus.geojson: detalhes do núcleo Cidade de Deus
// (matriz do Bradesco) que NÃO existem no OpenStreetMap.
//
// Fonte: referência visual (Google Earth / Google Maps, imagens de 05/2024) + pinos
// públicos de lugares do Google Maps. Nada de imagem do Google é copiado para o jogo:
// os volumes são reconstruídos à mão, de forma aproximada e estilizada (cartoon).
// Posições: erro típico de 5–15 m. Alturas: estimadas pela vista oblíqua.
//
// Uso: npm run campus

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'campus-cidade-de-deus.geojson');

const M_LAT = 110574;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const r7 = (v) => Math.round(v * 1e7) / 1e7;

/**
 * Retângulo centrado em [lat, lon]: `length` ao longo do eixo principal, `width` perpendicular.
 * `angle` (graus) = direção do eixo principal medida do leste para o sul (sentido horário no mapa).
 */
function rect([lat, lon], length, width, angle = 0) {
  const a = (angle * Math.PI) / 180;
  const ux = Math.cos(a), uz = Math.sin(a); // eixo principal (leste, sul)
  const vx = -uz, vz = ux;
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => {
    const e = (s * length) / 2 * ux + (t * width) / 2 * vx;
    const so = (s * length) / 2 * uz + (t * width) / 2 * vz;
    return [r7(lon + e / mLon(lat)), r7(lat - so / M_LAT)];
  });
  return [...pts, pts[0]];
}
const ring = (latlons) => {
  const pts = latlons.map(([la, lo]) => [r7(lo), r7(la)]);
  return [...pts, pts[0]];
};
const circle = ([lat, lon], radius, n = 20) =>
  ring(Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [lat - (Math.sin(t) * radius) / M_LAT, lon + (Math.cos(t) * radius) / mLon(lat)];
  }));

const SRC = 'referência visual Google Earth 05/2024 (aproximado)';
const features = [];
// aceita um anel só ou [contorno, ...furos]
const poly = (props, coords) => features.push({ type: 'Feature', properties: { source: SRC, ...props }, geometry: { type: 'Polygon', coordinates: typeof coords[0][0] === 'number' ? [coords] : coords } });
const point = (props, [lat, lon]) => features.push({ type: 'Feature', properties: { source: SRC, ...props }, geometry: { type: 'Point', coordinates: [r7(lon), r7(lat)] } });

const WHITE = '#eeece6', LIGHT = '#e4e6e8', RED = '#c8102e';

// ---------------------------------------------------------------- prédios
poly({ kind: 'building', name: 'Prédio Prata', height: 18, levels: 5, wall: '#e6e8ea', roof: '#c4c8cb', windows: '#2b3f55', accent: 'bandaCentral', accentColor: RED },
  rect([-23.54832, -46.773818], 108, 38, -15.3));
poly({ kind: 'building', name: null, label: 'Prédio do Heliponto', height: 22, levels: 6, wall: LIGHT, roof: '#cfd3d6', windows: '#2c5a8f', accent: 'moldura', accentColor: RED, roofShape: 'heliport', helipadAt: 0.78 },
  rect([-23.549217, -46.772574], 129, 36, 51.7));
poly({ kind: 'building', name: 'Prédio Cinza', height: 12, levels: 3, wall: '#a7adb2', roof: '#80868b', windows: '#26323f' },
  rect([-23.549009, -46.774948], 123, 50, 80));
poly({ kind: 'building', name: null, height: 9, levels: 2, wall: WHITE, roof: '#dcdcd7', windows: '#2b3f55' },
  rect([-23.549844, -46.774986], 58, 46, 80));
poly({ kind: 'building', name: 'Bradesco Prime', height: 11, levels: 3, wall: '#f1efe9', roof: '#d3d3cf', windows: '#2b3f55' },
  rect([-23.549613, -46.771574], 38, 31, -10));
poly({ kind: 'building', name: null, height: 10, levels: 3, wall: WHITE, roof: '#d8d8d4', windows: '#2b3f55' },
  ring([[-23.549265, -46.770444], [-23.549182, -46.769991], [-23.549404, -46.769954], [-23.549474, -46.770406]]));
poly({ kind: 'building', name: null, label: 'Galpão', height: 12, levels: 2, wall: '#e6e6e2', roof: '#f2f2ef', windows: '#3a4a5a', roofShape: 'ribbed' },
  ring([[-23.548952, -46.769728], [-23.548674, -46.769049], [-23.549091, -46.768785], [-23.549335, -46.769539]]));
poly({ kind: 'building', name: null, label: 'Heliponto', height: 14, levels: 3, wall: '#eef0f2', roof: '#3b78c9', windows: '#2c5a8f', roofShape: 'heliport', helipadAt: 0.5 },
  ring([[-23.548187, -46.769313], [-23.548013, -46.768899], [-23.548187, -46.768597], [-23.54857, -46.768559], [-23.548639, -46.769049], [-23.548465, -46.769275]]));
poly({ kind: 'building', name: null, height: 12, levels: 3, wall: WHITE, roof: '#d6d6d2', windows: '#2b3f55' },
  rect([-23.54764, -46.7698], 62, 42, 15));
poly({ kind: 'building', name: 'Agência Bradesco 2856', height: 8, levels: 2, wall: '#f2f0ea', roof: '#d9d9d4', windows: '#2b3f55', accent: 'faixa', accentColor: RED },
  rect([-23.546492, -46.771878], 31, 35, 0));
poly({ kind: 'building', name: 'Prédio Azul', height: 22, levels: 6, wall: '#eef1f4', roof: '#c9cfd6', windows: '#2f6db5', accent: 'moldura', accentColor: '#2f6db5' },
  rect([-23.546597, -46.770748], 64, 27, 32.7));
poly({ kind: 'building', name: 'Prédio Verde', height: 15, levels: 4, wall: '#eef1ee', roof: '#e9ebe8', windows: '#2e7d4f', roofShape: 'ribbed', accent: 'faixa', accentColor: '#2e8b57' },
  rect([-23.546353, -46.76711, ], 77, 31, 20));

// Fundação Bradesco: bloco com pátio + alas com telhado cerâmico
{
  const outer = rect([-23.545205, -46.771577], 54, 58, 0);
  const inner = rect([-23.545205, -46.771577], 30, 32, 0).reverse();
  poly({ kind: 'building', name: 'Fundação Bradesco', height: 8, levels: 2, wall: '#f3efe6', roof: '#c9622f', windows: '#33475b', roofShape: 'tile' }, [outer, inner]);
  for (const lat of [-23.545588, -23.545755, -23.545922])
    poly({ kind: 'building', name: null, height: 7, levels: 2, wall: '#f3efe6', roof: '#c55a2b', windows: '#33475b', roofShape: 'pyramid' }, rect([lat, -46.771635], 38, 11, 0));
  poly({ kind: 'building', name: null, height: 7, levels: 2, wall: '#f3efe6', roof: '#c55a2b', windows: '#33475b', roofShape: 'pyramid' }, rect([-23.545887, -46.771351], 69, 15, 90));
}

// ---------------------------------------------------------------- estruturas especiais
point({ kind: 'obelisk', name: 'Obelisco', height: 28, base: 2.6 }, [-23.5488, -46.773893]);
point({ kind: 'tent', name: null, radius: 24, sides: 8, wallHeight: 3.5, height: 13 }, [-23.545852, -46.769919]);
poly({ kind: 'pool' }, circle([-23.545734, -46.769557], 6));

// ---------------------------------------------------------------- áreas
poly({ kind: 'parking', angle: -12 }, rect([-23.54784, -46.774345], 100, 58, -12));
poly({ kind: 'parking', angle: -10 }, rect([-23.549635, -46.773818], 128, 70, -10));
poly({ kind: 'parking', angle: 0 }, ring([[-23.54923, -46.771424], [-23.54923, -46.770444], [-23.549613, -46.770444], [-23.549613, -46.771424]]));
// mata densa do miolo do campus
poly({ kind: 'forest' }, ring([
  [-23.546826, -46.771728], [-23.546409, -46.770296], [-23.546757, -46.769391], [-23.546965, -46.767954],
  [-23.547452, -46.767049], [-23.547452, -46.769084], [-23.547978, -46.769351], [-23.548257, -46.770331],
  [-23.548452, -46.77084], [-23.547131, -46.770796],
]));

// ---------------------------------------------------------------- portarias e portões
// (no cruzamento das ruas internas do OSM com o limite do bairro)
point({ kind: 'gate', type: 'portaria', name: 'Portaria R. Venceslau Brás' }, [-23.550003, -46.771147]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria R. Aurora Soares Barbosa' }, [-23.546572, -46.772295]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria R. Aurora Soares Barbosa', booth: false }, [-23.546337, -46.772194]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Vila Yara' }, [-23.547399, -46.766712]);
point({ kind: 'gate', type: 'portao' }, [-23.547809, -46.767148]);
point({ kind: 'gate', type: 'portao' }, [-23.548666, -46.767944]);
point({ kind: 'gate', type: 'pedestre' }, [-23.547431, -46.773729]);

// ---------------------------------------------------------------- ajustes sobre feições do OSM
// (ids do OSM que o jogo trata com o estilo do campus)
const osmOverrides = {
  'way/632090628': { kind: 'building', name: 'Prédio Rubi', height: 18, levels: 5, wall: '#f0eee9', roof: '#e3e3df', windows: '#2b3f55' },
  'way/643880242': { kind: 'building', name: 'Arena', height: 14, levels: 3, wall: '#e8e8e4', roof: '#cfd1cf', windows: '#3a4a5a', roofShape: 'ribbed' },
  'way/549773522': { kind: 'track' }, // campo de futebol -> ganha pista de atletismo + arquibancada
  'way/632090629': { kind: 'court' },
  'way/632090630': { kind: 'court' },
  'way/549773523': { kind: 'lawn' }, // mapeado como lago no OSM; nas imagens de 2024 é gramado
};

const fc = { type: 'FeatureCollection', name: 'Campus Cidade de Deus (detalhes)', source: SRC, osmOverrides, features };
fs.writeFileSync(OUT, JSON.stringify(fc, null, 1));
console.log(`> ${features.length} feições -> ${path.relative(ROOT, OUT)}`);
