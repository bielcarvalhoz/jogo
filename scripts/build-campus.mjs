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
const convivencia = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/campus/convivencia.json'), 'utf8'));
const controle = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/campus/controle-altimetrico.json'), 'utf8'));

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
const line = (props, pts) => add(props, { type: 'LineString', coordinates: pts.map(ll) });

// ---------------------------------------------------------------- prédios (planta oficial)
const B = (id, props, ring = plan.predios[id]) => poly({ kind: 'building', source: SRC_PLAN, planId: id, ...props }, ring);
const M = (id, props) => poly({ kind: 'building', source: SRC_PLAN, planId: id, style: 'pavilion', roofShape: 'green', levels: 1, height: 5, wall: '#e9e6df', roof: '#6f8f3e', windows: '#28404f', ...props }, plan.modulos[id]);

B('b1', { name: 'Prédio Cinza', num: 1, levels: 4, height: 16, wall: '#c4c9cd', roof: '#8e949a', windows: '#26323f', roofItems: 'skylights' });
// Balança: laje plana de concreto bege (não é telhado marrom); semienterrado do lado da rua do Prata.
// Balança: fachada RETA para o estacionamento (a planta oficial vinha serrilhada). Retângulo medido no
// Earth: 126,5 m de fachada, com a ponta leste incluindo o bloco de arrimo do beco.
B('b8', { name: 'Prédio Balança', num: 2, levels: 2, height: 7, wall: '#e6ded1', roof: '#d6cab4', windows: '#2b3f55', source: 'vista de topo do Google Earth (10/2026)' },
  ringLL([[-23.5482507, -46.7749153], [-23.5478568, -46.7737902], [-23.5479684, -46.7737438], [-23.5483623, -46.7748688]]));
// Prata: 6 andares acima do andar zero (rua de trás); o banner fica a ~2/3 da fachada sul a partir da ponta leste.
B('b6', { name: 'Prédio Prata', num: 4, levels: 6, height: 22, wall: '#eceae4', roof: '#c4c8cb', windows: '#2b3f55', accent: 'banner', accentColor: RED, bannerEast: 0.68, towerBox: { at: 0.32 } });
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
B('b34', { name: 'Agência CdD', num: 20, levels: 1, height: 6, wall: '#f4f3ef', roof: '#d8d9d9', windows: '#2b3f55', accent: 'quina', accentColor: RED, flag: true, flagAt: [-23.5463545, -46.7721162] });   // mastro na calçada rente à Portaria 10
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
poly({ kind: 'canopy', source: SRC_SAT, name: 'Cobertura tensionada', height: 4.2 }, rect([-23.5493284, -46.7709392], 49, 11.5, -2));
point({ kind: 'totem', source: SRC_SAT, height: 26, radius: 1.1 }, [-23.5489104, -46.7739245]);
point({ kind: 'dish', source: SRC_SAT, diameter: 8 }, [-23.5487703, -46.7738843]);
point({ kind: 'silo', source: SRC_SAT, height: 9, radius: 1.6 }, [-23.5482465, -46.7731333]);
point({ kind: 'silo', source: SRC_SAT, height: 9, radius: 1.6 }, [-23.5482859, -46.7730957]);
point({ kind: 'playground', source: SRC_SAT }, [-23.5480252, -46.7704779]);

// ---------------------------------------------------------------- áreas
// Área de convivência (lago, campo, pista, quadras, piscinas, arquibancada, quiosques...): formas
// levantadas em scripts/campus/convivencia.json; o jogo troca as do OSM/planta por elas.
point({ kind: 'leisure', source: convivencia.fonte, layout: convivencia }, convivencia.pista.centro);
// gramados da planta (exceto campo e quadras, tratados à parte)
const PITCH = [-46.771789, -23.547988];
const centroid = (r) => { let x = 0, y = 0; for (const [a, b] of r.slice(0, -1)) { x += a; y += b; } return [x / (r.length - 1), y / (r.length - 1)]; };
const distM = ([lo1, la1], [lo2, la2]) => Math.hypot((lo1 - lo2) * mLon(la1), (la1 - la2) * M_LAT);
for (const g of plan.gramados) {
  const c = centroid(g);
  const d = distM(c, PITCH);
  if (d < 70) {
    // dentro da pista: as 3 quadras do "D" sul (as do norte vêm do OSM)
    continue; // campo e quadras vêm do levantamento da convivência
  }
  poly({ kind: 'lawn', source: SRC_PLAN }, g);
}
const park = (name, pts, extra = {}) => poly({ kind: 'parking', source: SRC_SAT, name, ...extra }, ringLL(pts));
park('Estacionamento', [[-23.5494047, -46.7740345], [-23.5495448, -46.7729965], [-23.5499603, -46.772975], [-23.5499013, -46.7740345]]);
park('Estacionamento', [[-23.549385, -46.7745548], [-23.549385, -46.7740774], [-23.5502185, -46.7740774], [-23.5502185, -46.7745548]]);
// (o estacionamento do Balança é o marco 'estacionamento', com as vagas medidas)
// Estacionamento logo depois da Portaria Wenceslau Brás: as vagas acompanham a Rua Venceslau Brás
// (vista de topo do Google Earth), da cerca a leste da boca até o fim do pátio. O retângulo em
// lat/lon de antes ficava torto em relação à rua e atravessava o leito dela; e, levado até o
// passeio, virava um lençol de asfalto vazio ao longo de toda a calçada, porque as vagas só nascem
// ao lado dos corredores (a via interna, 16 m adentro). Agora o lote começa onde as vagas começam e
// a frente, entre o muro do campus e ele, é o gramado arborizado que se vê no Earth.
// Dois lotes: o da FRENTE, entre o gramado e a via interna, e o de TRÁS, do outro lado dela. Essa
// divisão é o que faz as vagas chegarem perto da rua — as vagas nascem ao lado de corredores, e o
// lote da frente, sem nenhuma via dentro, ganha o corredor sintético de campus.js.
park('Estacionamento', [[-23.5498938, -46.7710341], [-23.5496507, -46.7700090], [-23.5494794, -46.7700587], [-23.5497322, -46.7710810]], { palms: 'sul', palmsOffset: -2.6 });
park('Estacionamento', [[-23.5497322, -46.7710810], [-23.5494139, -46.7697937], [-23.5489771, -46.7699205], [-23.5492955, -46.7712078]]);
poly({ kind: 'lawn', source: SRC_SAT }, ringLL([[-23.5499483, -46.7710385], [-23.5496999, -46.7699846], [-23.5496466, -46.7700001], [-23.5498985, -46.7710530]]));
for (const [id, n] of [['b43', 14], ['b42', 15], ['b18', 16]]) poly({ kind: 'parking', source: SRC_PLAN, slab: true, name: `Estacionamento ${n} (antigo Prédio Branco)`, num: n }, plan.predios[id]);
poly({ kind: 'parking', source: SRC_PLAN, name: 'Estacionamento Coberto', underPergola: true }, plan.predios.b15);

// Parque dos Macacos (mata do miolo) — área onde aparecem os macacos
const areaM2 = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * mLon(r[i][1]) * r[i + 1][1] * M_LAT - r[i + 1][0] * mLon(r[i][1]) * r[i][1] * M_LAT; return Math.abs(a / 2); };
const parque = plan.gramados.filter((g) => distM(centroid(g), [-46.7706, -23.5476]) < 160).sort((a, b) => areaM2(b) - areaM2(a))[0];
poly({ kind: 'monkeyPark', source: SRC_PLAN, name: 'Parque dos Macacos', num: 12 }, parque);

// ---------------------------------------------------------------- portarias (planta oficial + OSM)
// Bussocaba: as duas pistas (entrada e saída) passam sob UMA cobertura; pontos onde a cruzam.
// (reach: o vão do muro fica só sob a cobertura; o pátio da frente é aberto para a rua)
point({ kind: 'gate', type: 'portaria', name: 'Portaria Bussocaba', num: 10, reach: 8 }, [-23.5466816, -46.7721977]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Bussocaba', num: 10, booth: false, reach: 8 }, [-23.5466081, -46.7720745]);
// (o ponto fica no portal do muro, medido no Earth; a cobertura vem do marco 'portaria-pedestres')
point({ kind: 'gate', type: 'pedestre', name: 'Portaria Bussocaba (pedestres)', num: 6 }, [-23.5474105, -46.7736409]);
point({ kind: 'gate', type: 'pedestre', name: 'Portaria Goiabinha (pedestres)', num: 7 }, [-23.5498934, -46.7739968]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Wenceslau Brás', num: 8, building: true, reach: 10 }, [-23.550003, -46.771147]);
point({ kind: 'gate', type: 'portaria', name: 'Portaria Vila Yara', num: 9 }, [-23.547399, -46.766712]);

// ---------------------------------------------------------------- marcos levantados em campo
// Vídeos e fotos de quem trabalha no campus (10/2026); coordenadas medidas na planta oficial
// e na imagem aérea. Nenhuma imagem entra no jogo — só posições e atributos.
const SRC_FIELD = 'vídeos/fotos do usuário (10/2026) + planta oficial';
// Escadaria da mata: da Rua Três (anel do Prédio Azul) até o lado da Agência / Portaria 10.
// Eixo traçado sobre a planta oficial (zigue-zague com a praça redonda dos bancos); o primeiro e o
// último lances foram alongados ~3 m para caber o desnível real (~22 m) com degraus normais.
line({ kind: 'stairway', id: 'escadaria-mata', name: 'Escadaria da mata', source: SRC_FIELD, width: 3, plaza: 3, plazaRadius: 2.7, sawtoothFrom: 3 }, [
  [-23.5465196, -46.7713852], [-23.5466001, -46.7714808], [-23.5465569, -46.7715094],
  [-23.5465629, -46.7716002], [-23.5465874, -46.7716887], [-23.5466627, -46.7717288],
]);
// Passarela de grades verdes do pé da escada até a via da Portaria Bussocaba.
// (termina na calçada bege do lado de dentro da Portaria Bussocaba, rente à Agência)
line({ kind: 'walkway', id: 'passarela-agencia', from: 'escadaria-mata', source: SRC_FIELD, width: 2.2, endLift: .41 }, [[-23.5466627, -46.7717288], [-23.5467057, -46.7718605]]);
// Portaria de pedestres da Bussocaba: ponto = ponta oeste da cobertura, na linha do muro; rumo do muro 72°.
// Em metros: s ao longo do muro a partir dali, v para dentro. Percurso descrito pelo usuário: entra-se
// pelo portal, vira-se à direita e sobe-se uma escada de ponta a ponta; no topo, as três catracas; em frente,
// a guarita do guarda; depois das catracas vira-se à esquerda e entra-se no campus.
// cobertura [comprimento, profundidade]; portal = vão do portão; escada [pé, topo] e nº de espelhos (o
// estacionamento fica ~1 m acima da calçada no Earth); catracas = s da linha delas; guarita [s0, s1,
// meia largura]; saida = vão dos fundos para o campus (e a faixa de pedestres); piso [s0, s1];
// rua = calçada da rua em frente [s0, s1, largura]. Cobertura medida no Earth (30 m) e no Street View de jun/2023.
point({ kind: 'landmark', type: 'portaria-pedestres', gate: 6, name: 'Portaria Bussocaba (pedestres)', heading: 72, cobertura: [10.9, 5.4], portal: [6.9, 9.5],
  escada: [6.5, 5], espelhos: 6, catracas: 3.6, quantidade: 3, guarita: [-2.9, -1.2, 1.5], saida: [-.6, 2.2], piso: [-3.3, 10.8], rua: [-14, 24, 5.2], source: SRC_FIELD }, [-23.5474332, -46.7737173]);
// Estacionamento do Balança: pátio de asfalto único com as vagas como no local. Ponto = origem na fachada
// do Balança; rumo da fachada 69,1°. Em metros: u ao longo da fachada, v da fachada para o muro.
// partes = polígonos CONVEXOS do asfalto. fileiras: u = 1ª divisória (no fundo da vaga), passo entre
// divisórias, nº de vagas, v = [fundo, entrada], inclina = deslocamento em u do fundo à entrada (vaga
// em diagonal), cor, simbolo (quadrado/losango branco na entrada). Medido no Earth (170 m, grade de 1 m).
point({ kind: 'landmark', type: 'estacionamento', name: 'Estacionamento do Balança', heading: 69.1, ocupacao: .35,
  partes: [[[-28.5, 4.4], [90, 4.4], [90, 40.6], [-28.5, 45.2]], [[71.1, -13.2], [78, -12.7], [78, 4.4], [71.1, 4.4]], [[78, -12.7], [91.5, -9.1], [91.5, 4.4], [78, 4.4]], [[91.5, -9.1], [98, -6.7], [98, 4.4], [91.5, 4.4]],
    [[90, 4.4], [115, 4.4], [115, 12], [90, 12]], [[98, -6.7], [110.6, -3.4], [110.6, 4.4], [98, 4.4]], [[90, 12], [108, 12], [108, 28.3], [96.2, 33.5], [90, 36.2]],
    [[67.4, .4], [71.1, .4], [71.1, 4.4], [67.4, 4.4]], [[68, -1.9], [70.6, -1.9], [70.6, .4], [68, .4]]],   // (o último: em frente ao beco, onde a faixa zebrada continua a calçada)
  // rua rente ao muro (do OSM): continua sendo rua, da portaria de pedestres até sair atrás do Balança (usuário);
  // semCalcada = trecho dela sem calçada (ao longo do muro; atrás da portaria de pedestres a calçada fica)
  vias: ['way/965541335'], semCalcada: [[[-30, 37.5], [91, 33.5], [91, 46], [-30, 51]]],
  fileiras: [
    { id: 'A', u: -18, passo: 3.4, vagas: 22, v: [10.6, 6.4], inclina: 4.2 },                       // diagonal, junto à pista da fachada
    { id: 'B', u: -17, passo: 2.4, vagas: 33, v: [10.6, 15.2] },                                     // reta, de costas para a A
    { id: 'C', u: -20.1, passo: 2.215, vagas: 21, v: [20.2, 24.8], cor: 'branca', simbolo: 'quadrado' },
    { id: 'C2', u: 31, passo: 2.4, vagas: 13, v: [20.2, 24.8] },
    { id: 'D', u: -22.6, passo: 2.25, vagas: 21, v: [32.6, 28.2], cor: 'branca', simbolo: 'quadrado' },
    { id: 'E', u: -19, passo: 2.77, vagas: 15, v: [32.6, 37.4], inclina: 2.77, cor: 'branca', simbolo: 'losango', fundo: false },   // diagonal, junto ao muro
    { id: 'F', u: 64.5, passo: 2.2, vagas: 4, v: [14, 7], inclina: 2.6 },
    // (canto leste, medido em vistas de topo a 30 m:) 7 vagas penduradas na guia ao sul da faixa zebrada; 2 junto à casa de máquinas
    { id: 'G', u: 78.6, passo: 2.17, vagas: 7, v: [1.25, -2.15], inclina: 1.05, sobe: .34, fundo: false },
    { id: 'J', u: 89.2, passo: 2.6, vagas: 2, v: [-3.6, -8.2], inclina: 1.6, fundo: false },
    { id: 'H', u: 85.5, passo: 2.25, vagas: 4, v: [19.3, 14.5] },
  ],
  // faixa zebrada única: da calçada do Balança, pela frente da casa de máquinas, até a travessia da portaria de pedestres
  // duas faixas zebradas: (1) da portaria de pedestres até a quina nordeste da casa de máquinas, onde começa o
  // caminho da escadinha; (2) dela, pela frente da casa de máquinas, até a calçada do Balança
  zebras: [{ eixo: [[95.6, 29], [97.6, 22], [102, 17], [108.3, 10.8]], largura: 3 }, { eixo: [[104, 12.7], [95, 9.3], [85, 5.75], [73.5, 1.85], [66.5, 1.85]], largura: 1.9 }],
  // guia clara ao longo do lado sul da faixa (as vagas saem dela) e passeio rente ao muro da escada [u0, u1, v0, v1]
  guia: [[75.2, .25], [94, 6.65]], passeios: [[71.05, 73.2, -9, .4]], caixaAmarela: [[77.9, -9.2], [81.7, -7.1], [83.3, -10], [79.5, -12]],
  // ao sul da faixa zebrada o pátio continua livre (sem grade) até o muro do fundo, na mesma profundidade da
  // casa de máquinas (usuário); fundo = [u0, u1, v do muro, v até onde vai o aterro atrás dele]
  // muro de arrimo do fundo (linha medida: enviesado, acompanha a casa de máquinas); atrás dele, de u = 70,9 a 98,
  // fica o passeio da rua do Prata, ~7 m acima (terraço até v = -17,2). zebrado = área hachurada atrás da casa de máquinas.
  muroFundo: [[70.9, -13.4], [78, -12.9], [91.5, -9.3], [98.3, -6.9], [111.6, -3.4]], terraco: [70.9, 98.3, -17.2], arvoreGrande: [87, -14.5],
  // largo da rua de cima: asfalto aberto pelos meios-fios MEDIDOS no Earth (170 m, grade de 1 m) — a rua do Prata
  // chegando do oeste, o braço norte ao lado do zebrado, a saída leste com a faixa de pedestres e a rua que desce
  // ao sul entre a calçada curva do Prata e a ilha. Pedaços convexos, sem calçada nem eixo pintado dentro.
  largo: [[[100, -29.5], [100, -18.2], [106.6, -11.8], [113, -20], [113, -29.5]], [[106.6, -11.8], [110, -5.5], [113, -5.5], [113, -20]],
    [[113, -20], [118, -25.5], [118, -42], [113, -42]], [[118, -25.5], [125, -27.5], [125, -40.5], [122.5, -41.5], [118, -42]],
    [[100, -29.5], [113, -29.5], [113, -42]], [[113, -42], [122.5, -42], [122.5, -48], [115.5, -48]]],
  faixaLargo: [[123.4, -28.6], [124.2, -39.8], 4.6],
  zebrado: [[95.5, -10.2], [110, -5.4], [106.6, -11.6], [104, -14.2], [99.6, -17.9], [95.5, -18.1]], escadaPara: [112.7, -6.8],
  // casa de máquinas (resfriadores) [cantos A, B, C, D]; do lado leste dela, caminho com a escadinha que sobe para a rua de cima (usuário)
  maquinas: [[94.3, 6], [107.9, 9.5], [110.9, -2.8], [97.9, -6.2]],
  arvores: [[-6.4, 19.6], [6.9, 19.6], [15.8, 19.6], [24.6, 19.6], [31, 19.6], [37, 19.6], [42.6, 19.6], [50, 19.6], [2.5, 10.6], [23, 10.6], [47, 10.6], [88.6, 17.5]],
  // calçada reta rente à fachada [u0, u1, v0, v1], marquise da entrada e pátio de equipamentos murado (oeste)
  calcada: [-28.5, 67.4, .3, 4.4], marquise: [16.5, 33.5, .3, 4.8], equipamentos: [-37.5, -29.3, 5.3, 15.2], source: SRC_FIELD }, [-23.5480865, -46.7744382]);
// Portaria de pedestres Goiabinha, na Av. Martin Luther King: ponto = eixo da porta, na linha do muro
// (o portal é ancorado na borda da calçada da avenida); rumo do muro 76°. Em metros: s ao longo do muro
// (leste +), v para dentro. Percurso descrito pelo usuário: duas catracas de cartão logo depois da porta;
// do lado de dentro, uma rampa ao longo do muro DESCE para o leste até a calçada da via interna.
// cobertura [s0, s1, profundidade] (testeira branca, Street View); portal = revestimento branco; porta;
// catracas = s da linha delas (viradas para a rampa); guarita [s0, s1] na ponta oeste; rampa [topo, pé, v do canteiro, v de dentro]
// e queda (m); patamar = fim do patamar no pé da rampa; muro [s0, s1, volta]: trecho em que o muro passa na
// borda da calçada (no jogo ele passava ~5 m para dentro) e onde volta ao traçado antigo; interno [s0, s1]:
// trecho da via interna no nível do patamar; rua = calçada da avenida refeita [s0, s1].
point({ kind: 'landmark', type: 'portaria-goiabinha', gate: 7, name: 'Portaria Goiabinha (pedestres)', heading: 76, cobertura: [-5.3, 3.9, 3.8], portal: [-1.85, 1.85], porta: 1.5,
  catracas: 1.3, guarita: [-5.1, -2.2], rampa: [3, 8.2, 2.35, 3.65], queda: .38, patamar: 9.4, muro: [-14, 14, 22], interno: [0, 11], rua: [-22, 56], source: SRC_FIELD }, [-23.5498934, -46.7739968]);
// Locomotiva 801 ao lado do CTI: frente (limpa-trilhos) para ESE, trilho de exposição de 26 m.
point({ kind: 'landmark', type: 'locomotiva', name: 'Locomotiva 801', source: SRC_FIELD, heading: 113 }, [-23.546803, -46.768288]);
// Portaria Bussocaba: UMA cobertura comprida (duas lajes em linha, 35 x 12 m) paralela à rua, junto à
// Agência. Centro, rumo do eixo (57°, para o lado da Agência) e tamanho medidos em vista de topo do
// Google Earth; as pistas de entrada e de saída passam por baixo, perpendiculares a ela.
// Sob a cobertura, da ponta sudoeste: recepção, pedestres, pista de entrada (uma faixa), ilha da
// guarita, pista de saída (duas faixas) e pedestres ao lado da Agência — conforme as fotos aéreas
// anotadas pelo usuário (contorno das vias em vermelho, entradas de pedestres em verde).
// Tudo em metros no sistema da cobertura: s ao longo dela a partir da ponta sudoeste, v para DENTRO do
// campus. Medido em vistas de topo do Google Earth a 30 m (grade do jogo sobreposta). Num ponto,
// v = null quer dizer "no meio-fio da rua" e v = 'interna' "na calçada da rua interna"; um 3º
// valor é a altura do piso acima do chão (rampa/guia rebaixada).
point({ kind: 'landmark', type: 'portaria', gate: 10, name: 'Portaria Bussocaba', heading: 57, length: 35, depth: 12, entrada: 'way/837879887', saida: 'way/837879888', larguraSaida: 8,
  recepcao: [1.6, 5.6], pistas: [[9.4, 13.4], [18.1, 31.9]], pedestres: [{ s: 6.65, w: 2.1, simples: true }, { s: 34, w: 3.4 }], guarita: [13.9, 17.7, 2, 11.1], muro: [[37.5, 0]],
  // eixos das duas pistas, da rua para dentro (entre os nós de ligação do OSM)
  eixoEntrada: [[6.6, -16.2], [9.3, -12], [11.2, -8.3], [11.4, -6], [11.4, 9], [10.4, 13], [8, 15.9]],
  eixoSaida: [[30.5, -34], [30.6, -28], [29.1, -17], [25, -9], [25, 7], [23.2, 13], [22.4, 19]],
  // ---- lado da rua: canteiro em meia-lua na frente da recepção e a calçada em leque em volta dele,
  // que vai do passeio da rua até a passagem de pedestres (guia do lado da pista de entrada)
  canteiro: [3.2, -6.2, 2.9],
  leque: { dentro: [[6.25, -6.2], [5.84, -7.73], [4.73, -8.84], [3.2, -9.25], [1.68, -8.84], [.56, -7.73, .3], [-1.2, -8.5, .04]],
    fora: [[7.7, -6.2], [7.7, -8.4], [6.3, -10.4], [3.6, null, .25], [1, null, .25], [-1.5, null, .2], [-3.5, null, .04]], guia: 4 },   // guia: nº de pontos de fora do lado da pista
  // nariz em crescente da ilha da guarita, apontando para a boca de entrada
  nariz: { baixo: [[13.5, -8.6], [12.6, -11.2]], alto: [[16.8, -9.2], [14.6, -11.8]], ponta: [11.4, -13.5] },
  // ilha da árvore entre as duas bocas: nariz redondo [s, v, raio] e o contorno até o meio-fio
  ilha: [21.4, -18.7, 3.2], ilhaContorno: [[19.5, null], [18.2, -18.87], [18.55, -17.25], [19.66, -16.02], [21.23, -15.5], [22.85, -15.85], [24.08, -16.96], [26.1, null]],
  // calçada rente à Agência, da rua até a passagem de pedestres nordeste (guia do lado das pistas de saída)
  calcadaRua: { esquerda: [[32.2, -6], [33, -12], [34, -20], [35, -28], [35.35, -31.8, .26], [35.6, null, .12]], direita: [[37.3, -6], [37.3, -12], [37.3, -20], [37.3, -28], [37.3, -32, .3], [37.3, null, .04]] },
  // faixas de pedestres nas duas bocas (trechos de s ao longo do meio-fio) e linhas de tachões
  faixasBoca: [[3.9, 19.3], [26.3, 35.3]],
  tachoes: [[[6.1, -12.3], [8.4, -10.6], [9.3, -8.6], [9.4, -6]], [[13.7, -15.8], [18.3, -12.4], [19, -11.2], [20.95, -5.9]], [[24.5, -5.8], [24.3, -12.7]], [[28.1, -5.5], [29.7, -14.9]]],
  // abrigo com banco na ilha da árvore, onde se espera o táxi [s no meio-fio, comprimento], e a vaga dos
  // táxis rente a ela [s0, s1] (informados pelo usuário; posição exata estimada)
  abrigoTaxi: [22.8, 3.2], vagaTaxi: [19.9, 25.7],
  // ---- lado de dentro: pátio de asfalto de s = 0 a 32,2;
  // calçada dos fundos da recepção, com a guia em curva marcada pelo usuário na vista de topo (da calçada
  // da rua interna até a passagem de pedestres; 'guia' = no meio-fio da rua interna); calçada com degraus rente à Agência, da passagem
  // nordeste até a calçada da rua interna; faixa de pedestres dela até o outro lado da rua [v0, v1, s inicial]
  patio: [0, 32.2],
  // (duas curvas [início, controle, fim]: a guia do lado do pátio e a borda do lado do gramado)
  calcadaFundos: { fora: [[7.7, 6], [7.4, 13.9], [0, 'guia']], dentro: [[0, 6], [-4, 6.5], [-8, 'interna']] },
  // caminhão dos bombeiros que costuma ficar parado ao lado da ponta sudoeste [s, v do centro] (informado pelo usuário)
  caminhaoBombeiro: [-5.6, 1.4],
  calcadaAgencia: { esquerda: [[32.2, 6], [32.2, 13], [32.2, 20], [32.2, 27], [32.2, 'interna']], direita: [[37.3, 6], [37.3, 13], [37.2, 21.5], [36.7, 27], [36.5, 'interna']] },
  faixaInterna: [26.9, 30.5, 31.75], degraus: [[32.5, 36.3, 19.5, 27.5, 8]], covas: [[33, 9.5], [35.9, 11.5], [33, 15.5], [35.9, 17.5]],
  source: SRC_FIELD }, [-23.5466438, -46.7721344]);
// Portaria Wenceslau Brás (Portaria 8): UMA laje comprida (23 x 11 m) paralela à Rua Venceslau Brás,
// com a recepção sob a ponta OESTE — encostada no limite do terreno, que ali recua para as casas da
// encosta —, o pilar-letreiro vermelho ao lado dela e o pórtico de duas lâminas vermelhas
// inclinadas, abertas para fora, sobre o meio da boca. Diferente de Bussocaba, a boca é UMA pista
// larga só (`pistaUnica`): entrada e saída ficam lado a lado, separadas apenas por cones laranja e
// balizadores, e fechadas pelos dois portões de correr brancos.
// Medidas nas fotos de rua e nas vistas 3D do Google Earth enviadas pelo usuário (10/2026); o rumo
// vem da rua e os dois nós de ligação, do OSM. O eixo de 2 nós do OSM encosta na borda oeste da boca
// (traçado grosseiro); `eixoEntrada` o leva ao meio dela, entre os mesmos nós.
// Sistema igual ao de Bussocaba: s ao longo da cobertura a partir da ponta OESTE, v para DENTRO do
// campus (norte); v = null é "no meio-fio da rua".
point({ kind: 'landmark', type: 'portaria', id: 'wenceslau', gate: 8, name: 'Portaria Wenceslau Brás',
  heading: 75, length: 23, depth: 11, entrada: 'way/826235184', pistaUnica: true, larguraEntrada: 12,
  lajes: [[0, 23]], testeira: [2.6, 22.4], marcaFim: .4,
  // dois pórticos inteiros: pernas vermelhas do chão até acima da laje, abrindo 1,9 m para fora, e
  // a viga que as une por cima — um em cada ponta da boca, fora do leito das pistas
  porticos: [{ s: 1.5, abertura: .85, largura: 1.5, espessura: .52, altura: 2.2, viga: .72 },
    { s: 23.3, abertura: .85, largura: 1.5, espessura: .52, altura: 2.2, viga: .72 }],
  // pilar-letreiro vermelho rente à recepção e as colunas brancas da laje, sempre nas divisórias
  torre: [5, 2.6, 3.8, -2.2], torreEspessura: 1.3,
  colunas: [[14.15, -4.6], [14.15, 4.6], [18.15, -4.6], [18.15, 4.6]],
  // recepção sob a ponta oeste (pé-direito baixo, vitrine para a rua, platibanda vermelha por cima)
  // e a passagem de pedestres com catraca entre ela e a boca dos carros, com a cabine do vigilante
  recepcao: [.4, 6.2], recepcaoFundo: 9.4, recepcaoAltura: 4.1, recepcaoTopo: 4.85, vitrine: [.9, 5.7],
  pedestres: [{ s: 7.6, w: 2.2, simples: true }], cabine: [9.6, -3.6, 1.4, 1.4],
  calcadaPedestre: [[6.3, 8.9, -14.4, -5.6]],
  // ---- boca: TRÊS faixas numa pista só, de oeste para leste — saída, entrada, entrada. Entre a
  // saída e a primeira entrada vão os cones; entre as duas entradas, o portão branco.
  pistas: [[9.1, 16.05], [16.05, 23]], guarita: false, muro: [[23.4, 0]],
  // eixo da pista da rua para dentro (entre os nós de ligação do OSM), passando no meio da boca
  eixoEntrada: [[12, -18], [14.2, -13], [15.7, -8], [16.05, -4], [16.05, 0], [16, 5], [15.3, 9], [13.6, 13], [11.4, 16]],
  cancelas: [[10.5, 13.8, true], [14.5, 17.8], [18.5, 21.8]], cancelaV: 2.6,
  divisorias: [[14.15, -13.6, -5.7], [18.15, -13.6, -5.7]],
  // ---- lado da rua: portão de correr branco na divisória entre as duas entradas (folha recolhida
  // AO LONGO da pista) e outro na borda leste da boca; cones e balizadores na divisória saída/entrada
  portoes: [[18.15, -5, 4.6, 1, 'v'], [22.4, -5.2, 5, 1]],
  cones: [[[14.15, -5.2], [14.15, 3.4]]], passoCones: 2.1,
  // vigilante de plantão na divisória entre as duas faixas de entrada, de frente para quem chega
  seguranca: [[18.15, .8, 14]],
  balizadores: [[[14.15, -9.6], [14.15, -5.8]]], passoBalizadores: 1.5,
  // legendas em pé para quem dirige, esticadas no sentido da marcha (só nas duas entradas)
  textoPista: [[16.15, -10.6, 'REDUZA', 3.8, 2.1], [20.15, -10.6, 'REDUZA', 3.8, 2.1],
    [16.15, -6.6, 'PARE', 2, 2.1], [20.15, -6.6, 'PARE', 2, 2.1]],
  setas: [[16.15, -13.4, [0, 1]], [20.15, -13.4, [0, 1]], [12.15, -9.6, [0, -1]], [12.15, 1.6, [0, -1]]],
  // guarda-corpo dos dois lados do caminho de pedestres (nunca atravessado nele)
  gradil: [[[6.3, -13.6], [6.3, -1.4]], [[8.9, -13.6], [8.9, -1.4]]],
  cerca: [[[-3.8, -4.6], [-3.8, -10.9]], [[25.6, -5.4], [25.6, -11]]],
  // muro branco que segura a encosta oeste ao longo do passeio, com o totem da marca na frente
  arrimo: [{ linha: [[-4.3, -12.6], [-11.1, -13.1], [-19.1, -13.6]], altura: 2.4 }],
  // (giro: o painel fica de lado, paralelo à pista, para quem sobe a Rua Venceslau Brás vê-lo de frente)
  totem: [-2.4, -12.2, 10.5, 3.4, -90],
  palmeiras: [[.9, -7.6, 11], [-1.8, -8.8, 9.5], [3.2, -9.2, 10]],
  // faixa de pedestres de ponta a ponta da boca, atravessada no meio-fio da rua
  faixasBoca: [[8.2, 24]],
  // ---- lado de dentro: pátio de asfalto da cobertura até a via interna do estacionamento
  patio: [1, 23],
  source: SRC_FIELD }, [-23.5498710, -46.7711878]);
// Beco com escada na ponta leste do Balança (do estacionamento à rua do Prata).
point({ kind: 'landmark', type: 'beco', building: 'b8', toward: 'b6', end: 'leste', offset: 1.6, width: 2.6, source: SRC_FIELD }, [-23.5479607, -46.7738679]);
// Entradas do Prata: -2 ao pé da torre da fachada norte; fundos do andar zero na fachada sul.
point({ kind: 'landmark', type: 'entrada', id: 'prata-menos2', building: 'b6', source: SRC_FIELD }, [-23.5482144, -46.7739443]);
point({ kind: 'landmark', type: 'entrada', id: 'prata-terreo', building: 'b6', source: SRC_FIELD }, [-23.5484477, -46.773697]);
// A rua entre o Balança e o Prata passa rente ao Balança (o eixo do OSM encosta no Prata e não
// deixa lugar para a calçada e a entrada do -2): miolo do eixo 5 m para o norte.
line({ kind: 'roadFix', way: 'way/866315705', source: SRC_FIELD }, [[-23.5482323, -46.7742755], [-23.5479618, -46.773486]]);

// A via que sobe da Agência contorna a arquibancada, que dá a volta na curva norte da pista (o
// eixo do OSM, com dois nós só, passava reto por cima dela). Traçado aproximado.
line({ kind: 'roadFix', way: 'way/549773529', insert: true, source: SRC_FIELD }, [[-23.5470481, -46.7712172], [-23.5471738, -46.7709625], [-23.5473715, -46.7709135]]);

// ---------------------------------------------------------------- relevo: controle e platôs
// O relevo SRTM é um modelo de superfície: perto dos prédios grandes ele sobe até ~19 m acima do
// chão (o estacionamento do Balança virava um morro e o campo, uma depressão). Os pontos de
// controle trazem a altitude real do chão; ver scripts/campus/controle-altimetrico.json.
add({ kind: 'groundControl', source: controle.fonte, offset: controle.ajuste }, { type: 'MultiPoint', coordinates: controle.pontos.map(([lat, lon, alt]) => [r7(lon), r7(lat), alt]) });
// Platôs: áreas que no local são planas. Altitudes do Google Earth + ajuste do controle.
const plato = (id, name, earth, pts, extra = {}) => poly({ kind: 'plateau', id, name, altitude: earth + controle.ajuste, source: SRC_FIELD, ...extra }, ringLL(pts));
// Estacionamento em frente ao Balança (térreo do prédio, onde fica o refeitório): 734 m.
plato('estacionamento-balanca', 'Estacionamento do Balança', 734, [
  // (lado norte até o muro e ponta leste até a portaria de pedestres: todo o pátio num nível só)
  [-23.5480542, -46.7748233], [-23.5477974, -46.7748839], [-23.5473946, -46.7735935], [-23.5475727, -46.7735195],
  // (ponta leste: vagas ao sul da faixa zebrada e a casa de máquinas, no nível do pátio; a rua de cima fica ~3 m acima)
  [-23.5475973, -46.7734253], [-23.5477332, -46.7733686], [-23.5477599, -46.7734036], [-23.5478325, -46.7735119], [-23.5479323, -46.7734703], [-23.5480153, -46.7737074], [-23.5479843, -46.7737203], [-23.5480019, -46.7737707]   /* (inclui o pé da escada do beco: as vagas encostam na parede fina) */,
  [-23.5479419, -46.7738336], [-23.5480003, -46.7740100], [-23.5480632, -46.7741962], [-23.5481261, -46.7743922], [-23.5481979, -46.7745881],
  [-23.5482698, -46.7747841], [-23.5482922, -46.7748576], [-23.5482249, -46.7748772],
], { band: 10 });
// Portaria Bussocaba: a cobertura, as pistas sob ela e o pátio até a rua interna num nível só (731 m).
// (inclui o trecho da rua interna ao longo do pátio, com a calçada do outro lado, e a calçada rente à
// Agência: ali o SRTM subia 1,4 m por causa das copas e a rua ficava num aterro acima do pátio)
plato('portaria-bussocaba', 'Portaria Bussocaba', 731, [[-23.5466684, -46.7723916], [-23.5464629, -46.7720464], [-23.546591, -46.7719557], [-23.5465863, -46.7719298], [-23.5469027, -46.7717056],
  [-23.5469266, -46.7717997], [-23.5468941, -46.7719162], [-23.5468687, -46.7719634], [-23.5468706, -46.7720205], [-23.5468771, -46.7721035], [-23.5469283, -46.7722074]], { band: 6, buildings: ['b34'] });   // a Agência fica no mesmo terraço
// Portaria Wenceslau Brás: a cobertura, a boca e o pátio até a via interna do estacionamento num
// nível só. Aqui não há leitura de altitude do Google Earth: a cota vem do próprio relevo corrigido
// (737,1 m no eixo da pista, sob a cobertura) — o platô só APLAINA o que o SRTM deixa em rampa de
// 1,9 m ao longo da laje. No local a plataforma é escavada na encosta oeste, que é contida pelo muro
// branco visto na foto de rua; o apoio entre o meio-fio da rua (≈738 m) e o pátio fica na banda.
plato('portaria-wenceslau', 'Portaria Wenceslau Brás', 0, [
  [-23.5499985, -46.7713281], [-23.5499217, -46.7710157], [-23.5496354, -46.7710994], [-23.5497121, -46.7714118],
], { band: 6, altitude: 737.1 });
// Rua entre o Balança e o Prata, no nível da laje do Balança (que é estacionamento): 741 m.
plato('rua-balanca-prata', 'Rua entre o Balança e o Prata', 741, [
  [-23.5479778, -46.7737846], [-23.5480030, -46.7738228], [-23.5480425, -46.7739610], [-23.5480731, -46.7740149], [-23.5480946, -46.7741109],
  [-23.5481252, -46.7741668], [-23.5481431, -46.7742197], [-23.5481997, -46.7744098], [-23.5482213, -46.7744412], [-23.5482383, -46.7744902],
  [-23.5483417, -46.7745000], [-23.5483955, -46.7744118], [-23.5484000, -46.7743236], [-23.5483848, -46.7743040], [-23.5482994, -46.7742569],
  [-23.5482267, -46.7740472], [-23.5482231, -46.7739992], [-23.5481817, -46.7739032], [-23.5481719, -46.7738689], [-23.5481323, -46.7737454],
  [-23.5480272, -46.7737160],
], { band: 8 });

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
