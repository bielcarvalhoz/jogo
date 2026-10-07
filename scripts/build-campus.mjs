// Gera public/data/campus-cidade-de-deus.geojson — o núcleo Cidade de Deus (matriz do Bradesco).
//
// Fontes (nenhuma imagem de terceiros entra no jogo; só coordenadas e atributos):
//  - Plantas dos prédios: planta oficial de implantação "Módulos" (DMDV Arquitetos, publicada no
//    ArchDaily em 2020), georreferenciada sobre a imagem Esri World Imagery (z19) com 10 pontos de
//    controle — erro médio 4,5 m. Ver scripts/campus/planta-oficial.json.
//  - Nomes e números: mapa interno "Mapa Cidade de Deus — Prédios e Facilidades" (enviado pelo usuário).
//  - Alturas, cores e detalhes (heliponto, frisos, letreiro, coluna, antena...): vistas 3D do
//    Google Earth (imagens de 05/2024), usadas só como referência visual.
//  - Árvores: copas detectadas na imagem de satélite (scripts/campus/arvores-satelite.json).
//
// Uso: npm run campus

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'campus-cidade-de-deus.geojson');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/campus/planta-oficial.json'), 'utf8'));
const arvores = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/campus/arvores-satelite.json'), 'utf8')).arvores;

const RED = '#c8102e';
const M_LAT = 110574;
const mLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const r7 = (v) => Math.round(v * 1e7) / 1e7;
const ll = ([lat, lon]) => [r7(lon), r7(lat)];
const ringLL = (pts) => { const r = pts.map(ll); r.push(r[0]); return r; };
const rect = ([lat, lon], length, width, angle = 0) => {
  const a = (angle * Math.PI) / 180, ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => {
    const e = (s * length) / 2 * ux + (t * width) / 2 * vx, so = (s * length) / 2 * uz + (t * width) / 2 * vz;
    return [lat - so / M_LAT, lon + e / mLon(lat)];
  });
  return ringLL(pts);
};

const features = [];
const SRC_PLAN = 'planta oficial georreferenciada';
const SRC_SAT = 'medido na imagem de satélite';
const add = (props, geometry) => features.push({ type: 'Feature', properties: props, geometry });
const poly = (props, ring, holes = []) => add(props, { type: 'Polygon', coordinates: [ring, ...holes] });
const point = (props, latlon) => add(props, { type: 'Point', coordinates: ll(latlon) });

// ---------------------------------------------------------------- prédios (planta oficial)
const B = (id, props) => poly({ kind: 'building', source: SRC_PLAN, planId: id, ...props }, plan.predios[id]);
const M = (id, props) => poly({ kind: 'building', source: SRC_PLAN, planId: id, style: 'pavilion', roofShape: 'green', levels: 1, height: 5, wall: '#e9e6df', roof: '#6f8f3e', windows: '#28404f', ...props }, plan.modulos[id]);

B('b1', { name: 'Prédio Cinza', num: 1, levels: 4, height: 16, wall: '#c4c9cd', roof: '#8e949a', windows: '#26323f', roofItems: 'skylights' });
B('b8', { name: 'Prédio Balança', num: 2, levels: 2, height: 7, wall: '#e6ded1', roof: '#8b5a3c', windows: '#2b3f55' });
B('b6', { name: 'Prédio Prata', num: 4, levels: 6, height: 22, wall: '#eceae4', roof: '#c4c8cb', windows: '#2b3f55', accent: 'banner', accentColor: RED, towerBox: { at: 0.32 } });
B('b3', {
  name: 'Prédio Vermelho', num: 5, levels: 4, height: 16, wall: '#e8eaec', roof: '#b9bdc1', windows: '#2b3f55',
  accent: 'frisos', accentColor: RED, glassSide: true,
  volumes: [{ from: 0.3, to: 0.76, w: 0.8, height: 24, roof: '#c3c7ca' }],
  helipad: { vol: 0, at: 0.66 }, towerBox: { vol: 0, at: 0.38 },
});
B('b5', { name: 'Prédio Rubi', num: 6, levels: 4, height: 16, wall: '#f0eee9', roof: '#cfd3d5', windows: '#2b3f55', accent: 'frisos', accentColor: '#9b111e', roofItems: 'solar' });
B('b15', { name: 'Estacionamento Coberto', num: 7, structure: 'pergola', height: 3.6 });
B('b33', { name: 'Agência Prime CdD', num: 8, levels: 2, height: 8, wall: '#f2f1ed', roof: '#d9dadb', windows: '#2b3f55', accent: 'faixa', accentColor: RED });
B('b24', { name: 'CGE — Central de Geração de Energia', num: 9, levels: 3, height: 12, wall: '#f1f1ef', roof: '#cfd3d6', windows: '#3a4a5a', accent: 'faixaVertical', accentColor: RED, roofItems: 'exhaust' });
B('b4', { name: 'Estacionamento Coberto II', num: 10, levels: 2, height: 8, style: 'garage', wall: '#d9dadb', roof: '#e6e8e9', roofShape: 'ribbed' });
B('b38', { name: 'Prédio Hangar — Heliponto', num: 11, levels: 2, height: 8, wall: '#eef0f2', roof: '#e8d27a', windows: '#2b3f55', roofText: '131.675 MHz' });
B('b60', { levels: 2, height: 7, wall: '#eef0f2', roof: '#d9dbdc', windows: '#2b3f55' });
B('b21', { name: 'Prédio Amarelo', num: 13, levels: 4, height: 15, wall: '#f2e3a0', roof: '#e9e9e6', windows: '#3c4a58', towerBox: { at: 0.06 } });
for (const id of ['b28', 'b52', 'b56']) B(id, { name: id === 'b28' ? 'Prédio Terceiros' : null, num: id === 'b28' ? 17 : null, levels: 3, height: 11, wall: '#efefed', roof: '#d6d8d9', windows: '#2b3f55' });
for (const id of ['b31', 'b53', 'b61']) B(id, { name: id === 'b31' ? 'Museu Histórico Bradesco' : null, num: id === 'b31' ? 18 : null, levels: 2, height: 8, style: 'school', wall: '#f2e8d5', roof: '#c25a2f', roofShape: 'hip', windows: '#3a3226' });
B('b17', {
  name: 'Prédio Azul', num: 19, levels: 2, height: 8, wall: '#e9dcd2', roof: '#c9cdd2', windows: '#2f6db5',
  volumes: [{ from: 0.06, to: 0.94, w: 0.9, height: 37, wall: '#eef2f6', windows: '#3c78c8', roof: '#c9cdd2' }],
  sign: { vol: 0, text: 'BRADESCO' }, antenna: { vol: 0 },
});
B('b34', { name: 'Agência CdD', num: 20, levels: 1, height: 6, wall: '#f4f3ef', roof: '#d8d9d9', windows: '#2b3f55', accent: 'quina', accentColor: RED, flag: true });
// Fundação Bradesco — Unid. II (bloco com pátio interno + alas)
poly({ kind: 'building', source: SRC_SAT, name: 'Fundação Bradesco — Unid. II', num: 21, levels: 3, height: 11, style: 'school', wall: '#f3efe6', roof: '#c9622f', roofShape: 'hip', windows: '#33475b' },
  ringLL([[-23.5450471, -46.7717664], [-23.5452057, -46.7713306], [-23.5455081, -46.771392], [-23.5454823, -46.7718056]]),
  [ringLL([[-23.5451393, -46.7716849], [-23.5452622, -46.7714255], [-23.5454188, -46.7714424], [-23.5453952, -46.7716905]]).reverse()]);
for (const id of ['b22', 'b45']) B(id, { levels: 3, height: 10, style: 'school', wall: '#f3efe6', roof: '#c55a2b', roofShape: 'hip', windows: '#33475b' });
B('b29', { levels: 2, height: 8, style: 'school', wall: '#f3f3f1', roof: '#e2e2df', windows: '#33475b', roofItems: 'hvac' });
for (const id of ['b37', 'b39', 'b59']) B(id, { name: id === 'b37' ? 'Fundação Bradesco — Prédio Cristo' : null, num: id === 'b37' ? 22 : null, levels: 2, height: 8, style: 'school', wall: '#f4f2ec', roof: '#c9622f', roofShape: 'hip', windows: '#33475b' });
B('b7', { name: 'Ginásio de Esportes', num: 23, levels: 2, height: 11, wall: '#f2f2ef', roof: '#fbfbf9', roofShape: 'tent', windows: '#3a4a5a' });
B('b0', { name: 'Prédio CTI', num: 24, levels: 4, height: 17, wall: '#eef0f1', roof: '#d5d9db', windows: '#2b3f55', roofShape: 'terraced', accent: 'faixa', accentColor: '#9aa3ab' });
B('b12', { name: 'Prédio Marrom', num: 25, levels: 4, height: 15, wall: '#e9e4dd', roof: '#d9dbdc', windows: '#4a3426', roofShape: 'ribbed', accent: 'faixa', accentColor: '#7b4a2c' });
B('b25', { name: 'Prédio UniBrad', num: 26, levels: 4, height: 15, wall: '#f1f1ef', roof: '#e3e5e6', windows: '#2b3f55', roofShape: 'ribbed' });
B('b16', { name: 'Prédio Marfim', num: 27, levels: 5, height: 18, wall: '#efe5cf', roof: '#d9d6cc', windows: '#3c4a58' });
B('b10', { name: 'Prédio Verde', num: 28, levels: 5, height: 19, wall: '#e9efe9', roof: '#e8ebe9', windows: '#2e7d4f', roofShape: 'ribbed', accent: 'faixa', accentColor: '#2e8b57' });
B('b9', { name: 'Fundação Bradesco — Unid. I', num: 30, levels: 2, height: 8, style: 'school', wall: '#f3efe6', roof: '#c9622f', roofShape: 'hip', windows: '#33475b' });
B('b32', { levels: 2, height: 9, style: 'school', wall: '#f3f3f1', roof: '#eceeee', roofShape: 'ribbed', windows: '#33475b' });
B('b47', { levels: 1, height: 5, style: 'school', wall: '#f3efe6', roof: '#c9622f', roofShape: 'hip', windows: '#33475b' });
B('b14', { name: 'Fundação Bradesco — Prédio Adm.', num: 31, levels: 8, height: 29, wall: '#f0f0ee', roof: '#cfd2d4', windows: '#2b3f55' });
B('b13', { name: 'Fundação Bradesco — Ensino Médio', num: 32, levels: 4, height: 15, style: 'school', wall: '#f2f1ee', roof: '#d4d6d6', windows: '#33475b' });
B('b30', { levels: 2, height: 8, wall: '#f1f1ef', roof: '#e0e1e1', windows: '#2b3f55' });
B('b40', { levels: 2, height: 7, wall: '#efefec', roof: '#d8d9da', windows: '#2b3f55' });
for (const id of ['b41', 'b50', 'b51']) B(id, { levels: 2, height: 7, wall: '#f1f1ef', roof: '#d9dadb', windows: '#2b3f55' });
B('b62', { levels: 1, height: 4, wall: '#f2ece0', roof: '#c25a2f', roofShape: 'hip', windows: '#3a3226' });
B('b58', { levels: 1, height: 4, wall: '#f2f2ef', roof: '#d9dadb', windows: '#2b3f55' });

// pavilhões novos (DMDV, 2019): estrutura metálica, vidro e telhado verde com grama
M('m2', { name: 'Espaço Bem Estar — Café e Serviços', num: 34 });
M('m4', { name: 'Espaço Bem Estar — Restaurantes', num: 34 });
M('m3', { name: 'Espaço Fitness — Lanchonete e Academia', num: 35, roofItems: 'solar' });
M('m0', { name: 'Espaço Conviver — Restaurante e Serviços', num: 36 });
M('m1', { name: 'Espaço Saúde CdD — Clínica', num: 37 });

// ---------------------------------------------------------------- estruturas medidas no satélite
poly({ kind: 'helideck', source: SRC_SAT, height: 4.5 }, ringLL([[-23.5483252, -46.7693058], [-23.5481211, -46.7688739], [-23.5482244, -46.7686459], [-23.5485072, -46.7685843], [-23.54864, -46.7689544], [-23.5485834, -46.769236]]));
poly({ kind: 'building', source: SRC_SAT, name: 'Portaria Wenceslau Braz', gateBuilding: true, levels: 1, height: 5, wall: '#f4f3ef', roof: '#dcdddd', windows: '#2b3f55', accent: 'quina', accentColor: RED }, rect([-23.5498915, -46.7711833], 17, 10, -4));
poly({ kind: 'canopy', source: SRC_SAT, name: 'Cobertura tensionada', height: 4.2 }, rect([-23.5493284, -46.7709392], 49, 11.5, -2));
point({ kind: 'totem', source: SRC_SAT, height: 26, radius: 1.1 }, [-23.5489104, -46.7739245]);
point({ kind: 'dish', source: SRC_SAT, diameter: 8 }, [-23.5487703, -46.7738843]);
point({ kind: 'silo', source: SRC_SAT, height: 9, radius: 1.6 }, [-23.5482465, -46.7731333]);
point({ kind: 'silo', source: SRC_SAT, height: 9, radius: 1.6 }, [-23.5482859, -46.7730957]);
point({ kind: 'playground', source: SRC_SAT }, [-23.5480252, -46.7704779]);

// ---------------------------------------------------------------- áreas
poly({ kind: 'lake', source: SRC_PLAN, name: 'Lago' }, plan.lago);
// gramados da planta (exceto campo e quadras, tratados à parte)
const PITCH = [-46.771789, -23.547988];
const centroid = (r) => { let x = 0, y = 0; for (const [a, b] of r.slice(0, -1)) { x += a; y += b; } return [x / (r.length - 1), y / (r.length - 1)]; };
const distM = ([lo1, la1], [lo2, la2]) => Math.hypot((lo1 - lo2) * mLon(la1), (la1 - la2) * M_LAT);
for (const g of plan.gramados) {
  const c = centroid(g);
  const d = distM(c, PITCH);
  if (d < 70) {
    // dentro da pista: as 3 quadras do "D" sul (as do norte vêm do OSM)
    if (d > 35) poly({ kind: 'court', source: SRC_PLAN }, g);
    continue;
  }
  poly({ kind: 'lawn', source: SRC_PLAN }, g);
}
const park = (name, pts, extra = {}) => poly({ kind: 'parking', source: SRC_SAT, name, ...extra }, ringLL(pts));
park('Estacionamento', [[-23.5494047, -46.7740345], [-23.5495448, -46.7729965], [-23.5499603, -46.772975], [-23.5499013, -46.7740345]]);
park('Estacionamento', [[-23.549385, -46.7745548], [-23.549385, -46.7740774], [-23.5502185, -46.7740774], [-23.5502185, -46.7745548]]);
park('Estacionamento', [[-23.5476417, -46.7748365], [-23.5475605, -46.7736241], [-23.5478974, -46.7736027], [-23.5482146, -46.7748123]]);
park('Estacionamento', [[-23.5492768, -46.7712289], [-23.5492768, -46.7698395], [-23.5498694, -46.7698395], [-23.5498694, -46.7712289]], { palms: 'sul' });
for (const [id, n] of [['b43', 14], ['b42', 15], ['b18', 16]]) poly({ kind: 'parking', source: SRC_PLAN, slab: true, name: `Estacionamento ${n} (antigo Prédio Branco)`, num: n }, plan.predios[id]);
poly({ kind: 'parking', source: SRC_PLAN, name: 'Estacionamento Coberto', underPergola: true }, plan.predios.b15);

// Parque dos Macacos (mata do miolo) — área onde aparecem os macacos
const areaM2 = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * mLon(r[i][1]) * r[i + 1][1] * M_LAT - r[i + 1][0] * mLon(r[i][1]) * r[i][1] * M_LAT; return Math.abs(a / 2); };
const parque = plan.gramados.filter((g) => distM(centroid(g), [-46.7706, -23.5476]) < 160).sort((a, b) => areaM2(b) - areaM2(a))[0];
poly({ kind: 'monkeyPark', source: SRC_PLAN, name: 'Parque dos Macacos', num: 12 }, parque);

// ---------------------------------------------------------------- portarias (planta oficial + OSM)
point({ kind: 'gate', type: 'portaria', name: 'Portaria Bussocaba', num: 10 }, [-23.546572, -46.772295]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Bussocaba', num: 10, booth: false }, [-23.546337, -46.772194]);
point({ kind: 'gate', type: 'pedestre', name: 'Portaria Bussocaba (pedestres)', num: 6 }, [-23.547431, -46.773729]);
point({ kind: 'gate', type: 'pedestre', name: 'Portaria Goiabinha (pedestres)', num: 7 }, [-23.5498934, -46.7739968]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Wenceslau Braz', num: 8, building: true }, [-23.550003, -46.771147]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Vila Yara', num: 9 }, [-23.547399, -46.766712]);

// ---------------------------------------------------------------- árvores
add({ kind: 'trees', source: 'copas detectadas na imagem de satélite' }, { type: 'MultiPoint', coordinates: arvores.map(([lon, lat]) => [lon, lat]) });

const fc = {
  type: 'FeatureCollection',
  name: 'Núcleo Cidade de Deus — matriz do Bradesco',
  fontes: [plan.fonte, 'Mapa "Cidade de Deus — Prédios e Facilidades"', 'Google Earth 05/2024 (referência visual)', 'Esri World Imagery (copas)'],
  features,
};
fs.writeFileSync(OUT, JSON.stringify(fc));
const kinds = {};
for (const f of features) kinds[f.properties.kind] = (kinds[f.properties.kind] || 0) + 1;
console.log(`> ${features.length} feições -> ${path.relative(ROOT, OUT)}`, kinds);
