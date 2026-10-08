# Menu, tour e desempenho

O menu aparece antes do download e da montagem da cidade. A cena começa a carregar em
segundo plano; escolher um modo antes de ela estar pronta abre a espera, com opção de
voltar ao menu. A barra avança por etapas ponderadas do pipeline (download, relevo,
chão, vias, prédios, vegetação, colisões e materiais). É uma indicação do trabalho
concluído, não uma previsão de segundos restantes. Só chega a 100% após a compilação
dos materiais e o primeiro quadro renderizado.

## Modos e mapa

- **Campanha** mantém a exploração em primeira pessoa e a pistolinha existentes.
- **Tour** usa uma câmera independente, sem personagem ativo ou tiros. Começa com o
  campus enquadrado de cima, permite arrastar, zoom e seleção de estruturas. A
  aproximação interpolada dura 1,6 s e respeita a preferência de movimento reduzido.
  A órbita automática pode ser pausada; Visão aérea retorna ao enquadramento inicial.
- O mapa 2D usa os números da planta oficial. As portarias levam o prefixo `P`, pois
  sua numeração se repete com a dos prédios. Pontos do entorno mantêm seus destinos
  de teletransporte e levam o prefixo `E` quando o entorno está ativo. Um número pode ter mais de uma estrutura
  na própria planta (ex.: 34); a lista permite selecionar cada uma pelo nome.
- Arraste para navegar; roda do mouse, pinça ou botões para zoom. No mapa da campanha,
  pontos de prédios levam às suas entradas, e clicar no chão leva à coordenada
  selecionada. No tour, pontos aproximam a câmera; clicar no chão seleciona a
  estrutura mais próxima. `M` abre/fecha o mapa, `Esc` retorna ao menu.

## Configurações

As escolhas são validadas e salvas em `localStorage`; armazenamento indisponível ou
corrompido retorna aos padrões **Med** e **entorno desabilitado**. Aplicar alterações
recarrega a página para reconstruir a cena, incluindo texturas e geometria.

| Perfil | Pixel ratio máximo | Sombra | Textura geral | Textura campus |
| --- | ---: | ---: | ---: | ---: |
| Low | 1 | 1024 | 2048 | 2048 |
| Med | 1,5 | 2048 | 2048 | 4096 |
| High | 2 | 4096 | 4096 | 4096 |

O perfil também controla os detalhes de árvores, fachadas, água e vegetação.
O campus usa 40/48/64 cards por copa de árvore e até 35.000/60.000/100.000 lâminas
de grama em Low/Med/High. O modo pixel restaura o pixel ratio do perfil selecionado ao ser desligado.
Entorno desabilitado evita a geração de prédios/procedurais, árvores e props externos.
O relevo e a imagem geral de chão permanecem para navegação e mapa 2D. O modo Fog
renderiza o entorno e usa neblina mais próxima; ele não economiza a memória de gerar
o entorno. O tour amplia a distância da neblina para permitir o enquadramento aéreo.

## Investigação dos tiros e otimizações

O principal custo identificado no código é a colisão: o tiro traça um raio de mira
até 100 m e cada projétil faz um novo raycast por quadro. Antes, malhas grandes,
especialmente chão e peças mescladas do campus, percorriam seus triângulos para
cada consulta. O cache de malhas e a exclusão de árvores já existiam; não bastavam
para reduzir esse trabalho dentro das malhas.

- As malhas com pelo menos 128 triângulos recebem uma BVH (`three-mesh-bvh`) durante
  o loading. A construção indireta preserva índices, grupos e ordem de triângulos.
- Um teste conservador de caixa delimitadora evita consultar malhas e lotes de
  instâncias que não interceptam o segmento do tiro. Atualiza a caixa pelo transform
  atual do objeto e mantém normais de instâncias e seleção de superfícies.
- Os recursos de bolinhas/manchas continuam em pools limitados (16/96). Seus shaders
  são compilados antes de liberar o jogo, evitando compilação no primeiro impacto.
- Lotes estáticos grandes de instâncias são divididos em células de 125 m, mantendo
  geometria/material compartilhados, cores e transforms. Isso permite ao frustum
  culling descartar lotes menores na câmera e nas sombras. Buffers animados devem
  receber `userData.dynamicInstances = true` para nunca serem reparticionados.
- Prédios já eram mesclados por material/célula de 250 m, e árvores já eram
  instanciadas. Essas otimizações foram preservadas.
- O minimapa/mapa agora atualiza a 10 Hz; o canvas grande só muda de resolução quando
  seu tamanho realmente muda, em vez de ser realocado em todo quadro.
- Recursos temporários do ambiente PMREM são descartados após gerar a textura.
- O menu limita a atualização de sua cena de fundo a 15 FPS; os modos ativos usam
  o ritmo normal do renderer.

Objetos fora do frustum já deixam de ser desenhados, mas permanecem em RAM/VRAM para
voltar à vista sem reconstrução. Culling não libera essa memória. Desabilitar o
entorno evita alocar boa parte desses recursos desde a montagem da cena. Streaming
com descarte/reconstrução de bairros não foi introduzido.

## WebGL ou WebGPU?

O motor usa explicitamente `THREE.WebGLRenderer` (WebGL 2 na versão atual). A queda
causada por raycasts ocorre na CPU: trocar o backend gráfico não remove esse custo.
O projeto usa `Sky`, `ShaderMaterial` no limite do bairro e `onBeforeCompile` para
folhas, grama e água. `WebGPURenderer` não suporta esses materiais personalizados da
mesma maneira; seria necessário convertê-los para Node Materials/TSL e comparar o
visual em navegadores/dispositivos compatíveis, além de manter fallback. Por isso,
esta mudança mantém WebGL e os shaders atuais. Não há evidência de ganho garantido
com WebGPU que justifique essa migração nesta entrega.

## Validação

`npm test` verifica módulos, colisões/BVH, normais/instâncias, pools de tinta,
transformações do mapa, configurações, omissão do entorno e a geometria já existente.
`npm run build` gera a versão de produção. A verificação de navegador usa Chromium
com renderização por software; medições desse ambiente não representam FPS em GPUs
reais e não devem ser usadas como promessa de ganho em aparelhos dos jogadores.

### Benchmark de colisão reproduzível

Execute `node scripts/benchmark-paintball.mjs`. Em uma cena sintética de chão e
3.000 caixas mescladas (167.072 triângulos), 240 segmentos produziram os mesmos
impactos antes e depois da aceleração. Nesta execução: raycast nativo 1.857,62 ms,
versão otimizada 4,96 ms, construção da BVH 94,02 ms. Esses valores isolam colisão
na CPU, variam por máquina e não equivalem a aumento de FPS do jogo completo.

### Verificação da interface no navegador

Chromium na versão de produção: menu/configurações antes do download; escolha
antecipada de modo e retorno ao menu; progresso completo; tour, aproximação,
pausa de órbita e visão aérea; mapa com roda, arraste e pinça sem seleção acidental;
seleção de estruturas; menu em retrato e tour em paisagem; campanha, impacto de
tinta e teletransporte. Sem erros de JavaScript ou compilação de shaders.

Também foram validados Low + Fog após aplicar e recarregar: preferências persistem,
o entorno contém 267 prédios reais e 8.909 procedurais, e a escolha antecipada do
tour entra no modo quando a cena fica pronta. Ao sair do tour, a neblina configurada
é restaurada. Os números descrevem os dados atuais do repositório.


## Abertura e celular

A capa usa seis painéis cartoon originais em um atlas WebP (~470 KB), animados individualmente por CSS, com logo em texto “grand treta auto” e subtítulo vermelho “City of God”. A fonte Anton é servida localmente em WOFF, com licença OFL em `public/fonts`. A animação pode ser pulada e respeita movimento reduzido. Não há tempo mínimo de espera para escolher um modo. A navegação é confirmada no click, depois de terminar o toque, para não repassar um click de compatibilidade a um marcador que estava atrás do menu.

A campanha aceita retrato e paisagem sem pausar no resize ou exigir tela cheia. O botão de orientação solicita fullscreen/lock apenas por escolha do jogador; em navegadores sem suporte, indica que basta girar fisicamente. `player/touch-controls.js` atribui um papel fixo a cada dedo: à esquerda (42% da largura) abre um analógico flutuante com zona morta e velocidade proporcional; o outro controla a mira. Soltar, cancelar, perder captura, redimensionar, desfocar ou esconder a página limpa o movimento. A UI recebe eventos `joystick`; não existem dependências novas entre módulos.

As barras usam preenchimento CSS próprio e o mesmo inteiro da porcentagem/ARIA, sem transição que atrase a largura. O tour abre com enquadramento calculado pelas dimensões reais do campus e pelo espaço disponível, em vez de tratar o maior lado como um quadrado. Sua barra fica em uma linha e expande somente ao visitar um ponto. Números próximos recebem posições separadas e linhas até as âncoras originais, com hit testing atualizado no mapa 2D. O mapa 2D também inicia mais próximo.

No tour, um fundo em gradiente e curvas de nível, uma única superfície distante e fog ajustada à altitude substituem a parte branca inferior do céu. Céu, fundo, cor e alcance da fog da campanha são restaurados ao sair. A superfície distante não participa de colisões da tinta e não gera prédios do entorno.
