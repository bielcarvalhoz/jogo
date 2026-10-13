# Cidade de Deus 3D — Osasco/SP

Mapa 3D navegável em primeira ou terceira pessoa (Three.js) gerado a partir de **dados reais**:

- **OpenStreetMap** → ruas (com nome, mão única, nº de faixas, pontes/viadutos), prédios (altura e
  andares quando mapeados), uso do solo, praças, lagos, piscinas, rios, muros, semáforos e comércios.
- **Relevo SRTM** (tiles Terrarium, AWS Open Data) → terreno com a altitude real (≈ 726–808 m).

O polígono oficial do bairro no OSM (`place=quarter`, way 156528061, o núcleo Cidade de Deus) é
o centro do mapa, mais o entorno: Shopping União, Terminal Amador Aguiar (Vila Yara),
São Francisco Golf Club, Pátio Osasco e a Av. dos Autonomistas.

O **núcleo Cidade de Deus (matriz do Bradesco)** é modelado à mão, em estilo cartoon/pixel:
portarias (guarita, marquise, placa e cancela que abre quando você chega perto) — as de **Bussocaba**
e **Wenceslau Brás** levantadas peça por peça nas fotos do local —, muro na divisa,
Prédio Prata (com o obelisco), Prédio Rubi, prédio do heliponto, Prédio Azul, Verde, Cinza,
Bradesco Prime, Agência, Fundação Bradesco, arena, tenda, galpão, pista de atletismo com
arquibancada, quadras, piscinas, estacionamentos com carros e a mata do miolo do campus.

## Rodar

```bash
npm install
npm run dev
```

Abra http://localhost:5173 e escolha **Modo treta**, **Modo treino** ou **Modo tour**. O modo Treta abre um submenu: **Um jogador** mantém a campanha atual; **Multijogador** lista salas públicas de até 10 jogadores, com criação e entrada por código. Antes de entrar em qualquer modo, escolha e confirme um personagem. A capa **Grand Treta Auto: City of God** monta um mosaico cartoon com recortes diagonais e revela o logo letra por letra enquanto os dados da cidade são baixados. A montagem 3D começa depois da abertura (ou ao pulá-la), para não travar as imagens nem a escrita do título.

Para jogar em sala, rode também **`npm run dev:server`** em outro terminal. O multiplayer tem friendly fire, spawns separados na Bussocaba, emojis/cumprimento, defesa do Prata contra waves e futebol com a caixa de madeira. Use `E` nos círculos de início, `T` para acenar e `G` para emojis. O servidor Socket.IO mantém a autoridade e os snapshots; WebRTC opcional transmite poses entre jogadores. Veja o **[passo a passo do Render e da Vercel](docs/MULTIPLAYER-RENDER.md)** para publicar o `jogo-server` e configurar `VITE_SERVER_URL`.

Em **Personagens**, escolha o Bancário ou crie vários personagens com nome, gênero, cor de pele, cabelo (repartido, corte baixo, comprido, coques, curto arredondado ou raspado), olhos, barba, cores e estilos de camiseta, calça e tênis, além de óculos, máscara, boné, touca ou fones. A prévia 3D usa o mesmo modelo e rig do jogo, com órbita e zoom. Salve o visual e confirme a escolha. Personagens e a última seleção ficam neste navegador; cancelar uma edição mantém o visual salvo. Não há contas ou sincronização entre aparelhos nesta etapa.

O **Modo treino** abre um espaço quadriculado com caixas físicas Rapier de madeira (1,20 m / 6 kg) e metal (1,60 m / 72 kg), além de uma cópia de cada arma no chão. A caixa de metal fica à direita, fora da faixa das armas. Cada quadrado mede 2 metros. Use-o para andar, correr, pular e testar tiros, golpes e câmeras. Na campanha há as mesmas caixas no campo de futebol e armas extras ao redor. Ao sair do treino, a posição anterior na cidade é restaurada.

Abra **`/debug`** no site para entrar diretamente no treino com o painel **Ajustar mãos / armas** (`B` no teclado). Essa URL oferece só o treino e configurações; o treino normal não tem o painel. Escolha a arma, a câmera e o alvo do ajuste: **Arma nas mãos** edita posição XYZ em metros, rotação XYZ em graus e escala XYZ, separadas por arma e perspectiva; **Braços na câmera** ajusta o conjunto dos braços na primeira pessoa, inclusive o soco. Toque num valor e use `− / +` para ajustes pequenos no celular, ou digite o valor. As alterações são salvas neste navegador. **Preparar print** compacta o painel num cartão com nome/ID da arma, perspectiva, alvo e todos os valores; **Copiar config** copia os mesmos dados em JSON. **Restaurar** retorna ao padrão da arma/vista/alvo selecionados. Veja [diagnóstico e validação](docs/TRAINING-PHYSICS.md).

O treino inclui um **laboratório de combate** com botões físicos à esquerda: adicione zumbis Quaternius, bots com o modelo de Sato e aliados; teste alvos parados, duelo ou defesa de objeto contra uma horda. Mire num botão e use `E`/atacar; no toque, use Acionar quando o botão estiver sob a mira. `Y` marca um ponto para os zumbis seguirem. Há três dificuldades, hitboxes visíveis, pausa da IA, imortalidade, fogo amigo e dano configurável. O padrão mata humanos com 1 tiro na cabeça, 2 no tórax ou 4 nos membros; zumbis têm o dobro de vida no corpo, com headshot letal. Zumbis mostram barra ao receber dano; a sua vida aparece acima da cabeça quando você se machuca, visível só para você. O feed de eliminações mostra autor, vítima e arma/causa, com três linhas compactas no celular. Veja [regras, controles e arquitetura do combate](docs/COMBAT-TRAINING.md).

O personagem **Sato**, carregado de `public/models/sato.glb`, começa com Glock-18, M4A4 e faca. São **2 slots de fogo + 1 melee**, com socos sempre disponíveis. O catálogo inclui revólver R8, Nova, AWP, MP5-SD, três facas, machado e bastão com arame. As referências de dano, cadência e funcionamento estão em [docs/weapons.md](docs/weapons.md). Todas as armas mantêm detalhes na cor escolhida; melee e socos não pintam o chão. `X`, o ícone discreto à esquerda ou o scroll alternam primeira/terceira pessoa. As vistas compartilham o mesmo Sato e suas animações de tiro, espada e sequência de socos.

`Z` guarda a arma ou a guarda de socos, deixando o personagem no idle normal. Armas longas ficam visíveis nas costas; pistolas e facas ficam na cintura. Desarmado, o mouse/arraste orbita livremente ao redor do corpo, inclusive pela frente; scroll ou pinça com dois dedos à direita ajusta a distância de 1,05 a 8 m. O analógico esquerdo continua independente. Ao equipar novamente, a câmera volta suavemente à posição de combate em cerca de meio segundo, restaurando a vista anterior (primeira ou terceira pessoa). `C` alterna agachado/em pé, parado ou andando, com câmera mais baixa e velocidade reduzida. No celular, as duas ações têm botões ao lado da tinta. Durante o voo da treta, Sato nada comicamente no ar usando a animação original completa.

No celular, jogue em pé ou deitado: a intensidade do analógico controla caminhada, trote e corrida em qualquer direção. Segure e arraste o botão de ataque para mirar enquanto ataca. Segure o botão da arma ou `Q` para abrir a roda, indique a opção com dedo, mouse ou analógico e solte para equipar. Perto de uma arma, use o botão de pegar ou `E`: o slot de fogo selecionado (ou o último usado) é substituído; melee troca só o slot 3. A arma anterior fica no chão. Há botões de câmera, pulo, voo, mapa, menu e orientação.

A música original dos menus e os efeitos de navegação/paintball usam Web Audio e começam no primeiro toque ou tecla. Música e efeitos têm controles independentes nas configurações, salvos no aparelho e aplicados sem recarregar. O áudio pausa quando a aba fica em segundo plano. Os SVGs da interface são do Game Icons (CC BY 3.0), os cabelos do Quaternius e as reações do Kenney (CC0); veja [créditos e licenças](public/credits.html). As fontes são Jersey 10 e Nunito (SIL OFL).

| Tecla | Ação |
|---|---|
| `G` | interações: acenar, dançar e reações Kenney na cena |
| `W A S D` / setas | andar |
| Mouse | olhar (se o navegador bloquear o pointer lock: segurar e arrastar) |
| `Shift` | correr |
| `Espaço` | pular |
| `Z` | desarmar / equipar novamente |
| `C` | agachar / levantar, inclusive andando |
| `V` | trocar cor da tinta |
| `F` | voo livre fora do multiplayer (`E`/`Control` sobe/desce) |
| Segurar `Q` | abrir roda; apontar e soltar para equipar |
| `E` | iniciar minigame próximo na sala ou pegar arma e soltar a anterior do slot |
| `X` | alternar primeira/terceira pessoa |
| `B` | abrir/fechar ajustes de armas e braços (somente em `/debug`) |
| Scroll ↑ / ↓ | desarmado: aproximar / afastar; no escopo da AWP: ampliar / reduzir; demais casos: primeira / terceira pessoa |
| Botão direito | segurar mira focada |
| `M` | mapa — teletransporte disponível fora do multiplayer |
| `1`–`7` | teletransporte fora do multiplayer (as 3 portarias do campus e outros lugares) |
| `P` | liga/desliga os prédios procedurais |
| `B` / `L` | limite do bairro / placas |
| `T` | acenar na sala; fora dela, visual cartoon (padrão) / realista |
| `Y` | no treino, marcar destino dos zumbis |
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
src/player/              avatar Sato, animações e câmeras (teclado, mouse, toque)
src/gameplay/paintball/  pistolinha de tinta
src/ui/                  carregamento, menu, HUD, minimapa, mapa grande, celular
src/debug/               window.__cdd e vistas ?inspect=
src/shared/              utilitários puros (geometria, aleatoriedade, texturas)
scripts/                 dados, verificação de módulos e QA do personagem
tests/<módulo>/          testes de cada módulo
```

`npm test` verifica as fronteiras entre módulos e roda os testes.

`public/models/sato.glb` é uma cópia sem alterações do `sato (4).glb` fornecido para esta versão. Malhas, materiais, esqueleto e os 46 clipes originais permanecem intactos. O jogo usa a articulação dos dedos e a orientação dos punhos da animação de pistola do próprio arquivo, com encaixe dos braços nas armas existentes. Não há mecânica de recarga.

## Créditos

### Cenário baseado nas fotos

O núcleo tem calçadas com meio-fio, travessias e arborização regular, totens físicos de identificação,
fachadas específicas dos prédios coloridos, escadas e rampas, portarias detalhadas e campo nivelado.
Inclui passarela Vermelho–Rubi com entradas opostas, praça do Azul com duas escadarias em torno do chafariz,
abrigos MOVE, catracas de entrada/saída, locomotiva junto ao CTI e bases niveladas para os prédios em encostas.
Ruas internas têm seção plana, duas mãos e faixa central. Pistola e metralhadora nas duas vistas atiram tinta:
clique para disparar (segure com a metralhadora), `V` para trocar a cor, ou escolha a cor no menu/HUD.
Vegetação, grama e água usam materiais com vento e ondulações inspirados em `sato-agents-lab` / Bruno Simon.
Veja [as referências, limites e verificação](docs/campus-reference.md) e [a atribuição dos materiais](docs/nature-reference.md).
Execute `npm test` para verificar a geometria e a navegação.

Dados © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licença ODbL —
a atribuição precisa continuar visível no jogo. Relevo: SRTM / Mapzen Terrarium (AWS Open Data).

**Atenção (uso comercial):** "Bradesco" e "Fundação Bradesco" são marcas de terceiros. O jogo usa os
nomes reais dos lugares só para identificar o local, sem logotipo. Antes de vender, avalie com um
advogado o uso dos nomes/cores da marca.

## Menu, tour e configurações

A tela inicial Grand Treta Auto: City of God oferece **Modo treta** (um jogador mantém a campanha atual; multijogador em breve), **Modo treino**
(espaço plano para testar o personagem e as armas), **Modo tour**
(visão aérea, aproximação de estruturas e órbita), **Personagens** e **Configurações**. Todo modo exige confirmar um personagem antes de entrar. A cidade
carrega em segundo plano com barra de progresso por etapas. O padrão é gráfico
**Med** com o entorno de Osasco **desabilitado**. Configurações são salvas por aparelho;
aplicar mudanças reconstrói a cena e retorna ao menu.

O mapa 2D (`M` ou botão/minimapa) permite zoom com roda, pinça ou botões e navegação
por arraste. Pontos numerados teleportam na campanha e aproximam a câmera no tour.
Veja [análise e decisões de desempenho](docs/MENU-TOUR-PERFORMANCE.md), incluindo
aceleração dos tiros por BVH, memória, instâncias e avaliação de WebGPU.
