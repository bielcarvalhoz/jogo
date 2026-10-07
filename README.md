# Cidade de Deus 3D — Osasco/SP

Mapa 3D navegável em primeira pessoa (Three.js) gerado a partir de **dados reais**:

- **OpenStreetMap** → ruas (com nome, mão única, nº de faixas, pontes/viadutos), prédios (altura e
  andares quando mapeados), uso do solo, praças, lagos, piscinas, rios, muros, semáforos e comércios.
- **Relevo SRTM** (tiles Terrarium, AWS Open Data) → terreno com a altitude real (≈ 726–808 m).

O polígono oficial do bairro no OSM (`place=quarter`, way 156528061, o núcleo Cidade de Deus) é
o centro do mapa, mais o entorno: Shopping União, Terminal Amador Aguiar (Vila Yara),
São Francisco Golf Club, Pátio Osasco e a Av. dos Autonomistas.

O **núcleo Cidade de Deus (matriz do Bradesco)** é modelado à mão, em estilo cartoon/pixel:
portarias (guarita, marquise, placa e cancela que abre quando você chega perto), muro na divisa,
Prédio Prata (com o obelisco), Prédio Rubi, prédio do heliponto, Prédio Azul, Verde, Cinza,
Bradesco Prime, Agência, Fundação Bradesco, arena, tenda, galpão, pista de atletismo com
arquibancada, quadras, piscinas, estacionamentos com carros e a mata do miolo do campus.

## Rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173 e clique em **Jogar**.

| Tecla | Ação |
|---|---|
| `W A S D` / setas | andar |
| Mouse | olhar (se o navegador bloquear o pointer lock: segurar e arrastar) |
| `Shift` | correr |
| `Espaço` | pular |
| `F` | voo livre (`E`/`Q` sobe/desce) |
| `M` | mapa — clique para se teletransportar |
| `1`–`7` | teletransporte (as 3 portarias do campus e outros lugares) |
| `P` | liga/desliga os prédios procedurais |
| `B` / `L` | limite do bairro / placas |
| `T` | visual cartoon (padrão) / realista |
| `V` | modo pixel (baixa resolução, estilo retrô) |

## Como funciona (GeoJSON → 3D)

1. `npm run data` (`scripts/fetch-data.mjs`) baixa do Overpass e converte para
   **`public/data/cidade-de-deus.geojson`** (RFC 7946, lon/lat WGS84), e gera
   **`public/data/terrain.json`** (grade de elevação ~6 m, suavizada). Os arquivos já estão
   no projeto; rode de novo com `npm run data -- --fresh` para atualizar com o OSM mais recente.
2. `src/geo.js` projeta lon/lat → metros num plano tangente local centrado no bairro
   (erro < 1 cm nessa escala). Eixos: `x` = leste, `y` = altitude, `z` = sul.
3. `src/terrain.js` monta a malha do relevo; `heightAt()` usa exatamente a mesma triangulação,
   então ruas, prédios e o jogador ficam rentes ao chão. Lagos são escavados no nível da margem.
4. `src/roads.js` gera as vias como fitas 3D drapeadas no relevo (faixas pintadas conforme o tipo);
   pontes ficam retas entre as cabeceiras reais, com guarda-corpo e pilares.
5. `src/buildings.js` extruda as plantas do OSM (altura → `height`, `building:levels` ou padrão por tipo),
   com janelas por andar, laje com caixa d'água ou telhado cerâmico.
6. `src/procedural.js` — **o OSM só tem ~270 prédios mapeados nessa área.** Para a cidade não ficar
   vazia, lotes são gerados ao longo das ruas reais, sem invadir ruas, calçadas, prédios reais,
   praças, água ou o campo de golfe. Eles são **inventados** (posição plausível, não real):
   aperte `P` para ver só os dados reais. Dentro do núcleo Cidade de Deus não há nada procedural.
7. `src/campus.js` + `scripts/build-campus.mjs` (`npm run campus`) — o campus do Bradesco quase
   não existe no OSM, então foi reconstruído em **`public/data/campus-cidade-de-deus.geojson`**
   usando o Google Earth/Maps (imagens de 05/2024) **só como referência visual**: posição, tamanho,
   orientação, altura aproximada e cores dos prédios, e os pinos públicos dos lugares (Prédio Prata,
   Rubi, Azul, Verde, Cinza, Prime, portarias...). Nenhuma imagem do Google é usada no jogo — tudo é
   geometria e textura próprias. Erro típico de posição: 5–15 m. Nomes de prédios sem identificação
   pública ficaram sem nome. Correção sobre o OSM: o "lago" ao lado da pista hoje é gramado.
8. `src/style.js` converte os materiais para sombreamento cartoon (toon) e faz o modo pixel.

## Estrutura

```
scripts/fetch-data.mjs   pipeline de dados (OSM + SRTM)
public/data/             GeoJSON e relevo gerados
src/main.js              cena, luz, céu, loop
src/world.js             leitura/classificação do GeoJSON
src/ground.js            textura do chão + máscaras de ocupação
src/roads.js  buildings.js  procedural.js  vegetation.js  props.js
src/player.js            primeira pessoa, colisão, pontes, voo
src/hud.js               minimapa, mapa grande, rua atual, lat/lon
src/campus.js            núcleo Cidade de Deus (matriz do Bradesco)
src/style.js             visual cartoon / pixel
scripts/build-campus.mjs dados do campus (referência visual)
```

## Créditos

### Cenário baseado nas fotos

O núcleo tem calçadas com meio-fio, travessias e arborização regular, totens físicos de identificação,
fachadas específicas dos prédios coloridos, escadas e rampas, portarias detalhadas e campo nivelado.
Vegetação, grama e água usam materiais com vento e ondulações inspirados em `sato-agents-lab` / Bruno Simon.
Veja [as referências, limites e verificação](docs/campus-reference.md) e [a atribuição dos materiais](docs/nature-reference.md).
Execute `npm test` para verificar a geometria e a navegação.

Dados © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licença ODbL —
a atribuição precisa continuar visível no jogo. Relevo: SRTM / Mapzen Terrarium (AWS Open Data).

**Atenção (uso comercial):** "Bradesco" e "Fundação Bradesco" são marcas de terceiros. O jogo usa os
nomes reais dos lugares só para identificar o local, sem logotipo. Antes de vender, avalie com um
advogado o uso dos nomes/cores da marca.
