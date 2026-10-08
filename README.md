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

Abra http://localhost:5173 e escolha **Campanha** ou **Modo tour**. A capa **Grand Treta Auto: City of God** monta um mosaico cartoon com recortes diagonais e revela o logo letra por letra enquanto os dados da cidade são baixados. A montagem 3D começa depois da abertura (ou ao pulá-la), para não travar as imagens nem a escrita do título.

No celular, jogue em pé ou deitado: toque à esquerda para abrir o analógico (avance até o limite para correr) e arraste do outro lado para mirar. Segure e arraste o ícone de tiro para mirar e disparar enquanto anda. O ícone de mira aproxima a visão e reduz a sensibilidade; O ícone da arma troca pistola/metralhadora de paintball. Há botões de pulo, voo, mapa, menu e orientação. Campanha/tour liberam depois do carregamento; configurações estão disponíveis desde o início e avisam antes de reiniciar a cidade.

A música original dos menus e os efeitos de navegação/paintball usam Web Audio e começam no primeiro toque ou tecla. Música e efeitos têm controles independentes nas configurações, salvos no aparelho e aplicados sem recarregar. O áudio pausa quando a aba fica em segundo plano. Os SVGs locais são do Lucide e Game Icons; veja [créditos e licenças](public/icons/README.md). A fonte do logo é Bowlby One (SIL OFL).

| Tecla | Ação |
|---|---|
| `W A S D` / setas | andar |
| Mouse | olhar (se o navegador bloquear o pointer lock: segurar e arrastar) |
| `Shift` | correr |
| `Espaço` | pular |
| `F` | voo livre (`E`/`Control` sobe/desce) |
| `Q` | trocar pistola/metralhadora |
| Botão direito | segurar mira focada |
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
2. `src/shared/geo.js` projeta lon/lat → metros num plano tangente local centrado no bairro
   (erro < 1 cm nessa escala). Eixos: `x` = leste, `y` = altitude, `z` = sul.
3. `src/map/terrain.js` monta a malha do relevo; `heightAt()` usa exatamente a mesma triangulação,
   então ruas, prédios e o jogador ficam rentes ao chão. Lagos são escavados no nível da margem.
4. `src/map/roads.js` gera as vias como fitas 3D drapeadas no relevo (faixas pintadas conforme o tipo);
   pontes ficam retas entre as cabeceiras reais, com guarda-corpo e pilares.
5. `src/map/buildings.js` extruda as plantas do OSM (altura → `height`, `building:levels` ou padrão por tipo),
   com janelas por andar, laje com caixa d'água ou telhado cerâmico.
6. `src/map/procedural.js` — **o OSM só tem ~270 prédios mapeados nessa área.** Para a cidade não ficar
   vazia, lotes são gerados ao longo das ruas reais, sem invadir ruas, calçadas, prédios reais,
   praças, água ou o campo de golfe. Eles são **inventados** (posição plausível, não real):
   aperte `P` para ver só os dados reais. Dentro do núcleo Cidade de Deus não há nada procedural.
7. `src/campus/` + `scripts/build-campus.mjs` (`npm run campus`) — o campus do Bradesco quase
   não existe no OSM, então foi reconstruído em **`public/data/campus-cidade-de-deus.geojson`**
   usando o Google Earth/Maps (imagens de 05/2024) **só como referência visual**: posição, tamanho,
   orientação, altura aproximada e cores dos prédios, e os pinos públicos dos lugares (Prédio Prata,
   Rubi, Azul, Verde, Cinza, Prime, portarias...). Nenhuma imagem do Google é usada no jogo — tudo é
   geometria e textura próprias. Erro típico de posição: 5–15 m. Nomes de prédios sem identificação
   pública ficaram sem nome. Correção sobre o OSM: o "lago" ao lado da pista hoje é gramado.
8. `src/core/style.js` converte os materiais para sombreamento cartoon (toon) e faz o modo pixel.

## Estrutura (módulos)

O código é dividido em módulos para o time trabalhar em paralelo. Cada pasta tem uma API pública
no `index.js`; regras, contratos e receitas estão em **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)**.

```
src/main.js              monta o jogo (ordem dos módulos)
src/core/                motor: render, laço, eventos, teclas, física compartilhada, visual
src/map/                 mundo real: relevo, vias, prédios do OSM, vegetação, água (pipeline com plugins)
src/campus/              núcleo Cidade de Deus (matriz do Bradesco) — plugin do mapa
src/player/              personagem em primeira pessoa (teclado, mouse, toque)
src/gameplay/paintball/  pistolinha de tinta
src/ui/                  carregamento, menu, HUD, minimapa, mapa grande, celular
src/debug/               window.__cdd e vistas ?inspect=
src/shared/              utilitários puros (geometria, aleatoriedade, texturas)
scripts/                 dados (OSM, SRTM, campus) e verificação de módulos
tests/<módulo>/          testes de cada módulo
```

`npm test` verifica as fronteiras entre módulos e roda os testes.

## Créditos

### Cenário baseado nas fotos

O núcleo tem calçadas com meio-fio, travessias e arborização regular, totens físicos de identificação,
fachadas específicas dos prédios coloridos, escadas e rampas, portarias detalhadas e campo nivelado.
Inclui passarela Vermelho–Rubi com entradas opostas, praça do Azul com duas escadarias em torno do chafariz,
abrigos MOVE, catracas de entrada/saída, locomotiva junto ao CTI e bases niveladas para os prédios em encostas.
Ruas internas têm seção plana, duas mãos e faixa central. Pistola e metralhadora de primeira pessoa atiram tinta:
clique para disparar (segure com a metralhadora), `C` para trocar a cor, ou escolha a cor no menu/HUD.
Vegetação, grama e água usam materiais com vento e ondulações inspirados em `sato-agents-lab` / Bruno Simon.
Veja [as referências, limites e verificação](docs/campus-reference.md) e [a atribuição dos materiais](docs/nature-reference.md).
Execute `npm test` para verificar a geometria e a navegação.

Dados © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licença ODbL —
a atribuição precisa continuar visível no jogo. Relevo: SRTM / Mapzen Terrarium (AWS Open Data).

**Atenção (uso comercial):** "Bradesco" e "Fundação Bradesco" são marcas de terceiros. O jogo usa os
nomes reais dos lugares só para identificar o local, sem logotipo. Antes de vender, avalie com um
advogado o uso dos nomes/cores da marca.

## Menu, tour e configurações

A tela inicial Grand Treta Auto: City of God oferece **Campanha** (exploração atual), **Modo tour**
(visão aérea, aproximação de estruturas e órbita) e **Configurações**. A cidade
carrega em segundo plano com barra de progresso por etapas. O padrão é gráfico
**Med** com o entorno de Osasco **desabilitado**. Configurações são salvas por aparelho;
aplicar mudanças reconstrói a cena e retorna ao menu.

O mapa 2D (`M` ou botão/minimapa) permite zoom com roda, pinça ou botões e navegação
por arraste. Pontos numerados teleportam na campanha e aproximam a câmera no tour.
Veja [análise e decisões de desempenho](docs/MENU-TOUR-PERFORMANCE.md), incluindo
aceleração dos tiros por BVH, memória, instâncias e avaliação de WebGPU.
