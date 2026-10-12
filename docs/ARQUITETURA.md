# Arquitetura — módulos para trabalhar em paralelo

O código é dividido em **módulos independentes**, um por pasta em `src/`. Cada módulo tem uma
**API pública** no seu `index.js`; o resto da pasta é interno e pode mudar à vontade sem
quebrar o trabalho de quem cuida de outro módulo.

## Módulos

| Pasta | Módulo | Responsabilidade | Exemplos de tarefa |
|---|---|---|---|
| `src/core/` | Núcleo / motor | renderer, cena, câmera, céu, luz e sombra, laço de sistemas, eventos, atalhos de teclado, física compartilhada, espaço de treino, visual cartoon/pixel, perfil gráfico, câmera de tour, configurações persistentes, lotes de instâncias, áudio espacial gravado e ragdolls | pós-processamento, ciclo dia/noite, otimização de desempenho |
| `src/map/` | Mapa (mundo real) | relevo SRTM, vias, prédios do OSM, prédios procedurais, vegetação, água, muros, semáforos, placas, destinos do entorno | melhorar ruas, novos tipos de prédio, mais vegetação |
| `src/campus/` | Campus Cidade de Deus | núcleo do Bradesco: prédios da planta oficial, muros, portarias, estacionamentos, terraplenagem, detalhes, marcos levantados em campo (`landmarks.js`: escadaria, beco, acessos, locomotiva) | novo prédio, fachada, mobiliário do campus |
| `src/player/` | Personagem | avatar Sato, animações e encaixe de armas; controle em primeira/terceira pessoa, teclado, mouse, toque, colisão, pulo, voo | modelo/avatar, animação, corrida, agachar |
| `src/gameplay/<mecânica>/` | Jogabilidade | `paintball/`: catálogo, inventário, armas e impactos; `combat/`: ECS Miniplex, hitboxes, dano, kills, IA Yuka/BFS e laboratório; `multiplayer/`: Socket.IO, reconciliação, WebRTC e vistas remotas | missões, carros, coletáveis, multiplayer |
| `server/` | Autoridade multiplayer | HTTP/Socket.IO, salas, simulação, colisões, Rapier, waves e gols no Node | publicação no Render, regras de sala |
| `src/ui/` | Interface | tela de carregamento, menu, HUD, minimapa, mapa grande, avisos, gestos mobile, CSS | novas telas, configurações, acessibilidade |
| `src/debug/` | Depuração | `window.__cdd`, vistas de inspeção `?inspect=` | ferramentas de QA |
| `src/shared/` | Utilitários | funções puras: geometria 2D, aleatoriedade, geometria de vias, texturas procedurais, download de JSON com parsing adiado | — |
| `scripts/` | Dados | baixar OSM/SRTM (`npm run data`), gerar o campus (`npm run campus`), verificar módulos | — |
| `tests/<módulo>/` | Testes | testes de cada módulo (`node --test`) | — |

## Como as peças se conectam

`src/main.js` só **monta** o jogo, nesta ordem:

```
menu + intro + downloads → fim da intro apresentado → JSON (map + campus) → core (game) → mapa (+ plugin campus) → lotes → treino → caixas/Rapier → personagem + GLB pronto → tour → modelos de armas → combate/Miniplex/Yuka + GLBs + laboratório → paintball/BVH → armas no chão → multiplayer → UI → visual → materiais → debug → menu pronto
```

`createFrontMenu()` expõe `introFinished`, que resolve após a abertura (ou pular/configurações/movimento reduzido) e dois `requestAnimationFrame`, garantindo que a capa final seja apresentada antes do trabalho pesado. `loadMapData(base, { beforeParse })` e `loadCampusData(base, { beforeParse })` baixam o corpo durante a intro e aguardam essa promessa antes de fazer JSON.parse. `main.js` também aguarda explicitamente antes de criar WebGL/PMREM e montar o mundo. Animações CSS não protegem o texto de tarefas longas na thread principal. Depois de carregar, o motor mantém sistemas leves a 15 Hz no menu opaco e pula o desenho da cidade oculta; a renderização normal volta ao iniciar campanha/tour.

Tudo gira em torno de um objeto **`game`** (criado em `core/game.js`), o único compartilhado:

O personagem expõe `bindFireButton(element, onHeld)`, `setFocusedAim(bool)` e `jump()`.
`ready` resolve quando o GLB de Sato está carregado; o bootstrap aguarda essa promessa
antes de criar o paintball e registrar os materiais. `setCameraMode('first' | 'third')`
e `toggleCameraMode()` alternam a vista e emitem `cameramode` em `player.events`.
`eyePosition`, `velocity`, `grounded` e `cameraMode` descrevem o estado do jogador.
`getShotOrigin(target)` escreve em `target` a posição dos olhos, independente da
posição da câmera em terceira pessoa. `updateWeapon(gun, state)` posiciona a arma
no mundo pelo encaixe da mão direita; retorna se a pose foi aplicada.
`setCrouched(bool)`, `toggleCrouch()` e `crouched` controlam a postura; o evento
`crouch` sincroniza a UI. Agachado, a altura dos olhos é 1,1 m e a velocidade máxima
é 1,6 m/s, inclusive com analógico, corrida ou mira. Entrar em voo desfaz o agachamento.
`avatar.poseConfig` expõe `get`, `set`, `reset` e `export`, com posição em metros,
rotação XYZ em graus e escala XYZ como multiplicador. `player/pose-config.js` mantém
os encaixes por arma/perspectiva e o enquadramento dos braços por arma na primeira
pessoa, persistidos no navegador. `ui/training-pose.js` acessa essa API pelo contexto
`game`, sem importar internals do personagem. `game.ui.posePanel` abre/fecha o painel
somente em `/debug`; nas demais URLs é `null` e o painel/atalho não são montados.
`core.debugOptions().trainingOnly` identifica essa rota em produção e desenvolvimento;
o menu inicia automaticamente no treino e não oferece campanha/tour. A Vercel
reescreve `/debug` para o HTML da aplicação, com assets a partir da raiz.
o cartão para print e o JSON identificam arma, vista, alvo e unidades. Ajustes do
encaixe são aplicados depois do enquadramento automático, sem serem anulados por ele.
`player.releasePointerForUI()` solta o cursor mantendo o treino ativo para desktop.

`core/characters.js` mantém o elenco local versionado (`cdd.characters.v1`), normaliza
nomes/cores/opções e expõe `createCharacterStore()`, `normalizeAppearance`,
`DEFAULT_APPEARANCE` e `APPEARANCE_OPTIONS` pela API pública do núcleo. `main.js`
injeta o store criado pelo menu em `game.characters`. `ui/character-menu.js` gerencia
seleção explícita, rascunho, salvar/cancelar e a prévia; `ui.startMode()` exige essa
confirmação em todos os modos. A rota técnica `/debug` mantém a entrada direta no treino.
O submenu **Modo treta** chama o modo interno `campaign` para **Um jogador** e mantém
o modo `multiplayer` para **Multijogador**, passando pelo lobby público e pela escolha de personagem.

`player.applyCharacter(character)` aplica o nome e o visual a `avatar.appearance`.
`player/appearance.js` usa materiais e geometrias privados, preserva pesos/índices
de skinning e animações, e prende acessórios ao osso da cabeça. Atualizações alcançam
o material padrão e seu equivalente toon. `player.createCharacterPreview(container)`
cria uma cópia independente do rig com palco e OrbitControls; `show(appearance)` e
`stop()` só renderizam enquanto o painel está aberto. A cidade continua sem render
durante o menu opaco.

`player.setHolstered(bool)` sincroniza a câmera com o estado da arma por
`updateWeapon(gun, state)`, inclusive ao selecionar uma arma ou pegar outra no chão.
`player.yaw` descreve a direção do corpo independentemente da órbita desarmada;
`zoomOrbit(deltaPixels)`, `orbitDistance` e `cameraReturning` expõem o zoom e o retorno.
O scroll desarmado precede a troca de perspectiva; no toque, dois dedos à direita
ajustam a distância sem roubar o analógico. Reequipar interpola a rotação e o
afastamento por 0,48 s, restaura a perspectiva anterior e mantém a varredura de
colisão da câmera. A AWP conserva o controle de zoom do escopo quando equipada.

O módulo de paintball conecta o gatilho/mira ao personagem por essa API e expõe
`setTrigger(bool)`, `setWeapon(id)`, `setHolstered(bool)`, `setAiming(bool)`, `resetInput()` e `clearEffects()`; a UI usa o
personagem para pulo e voo. `getCameraMode()` permite distinguir a mira comum da AWP
do escopo em primeira pessoa: `scoped`, `scopeZoom` e `adjustScopeZoom(delta)`
controlam a ampliação de 2× a 8×. O FOV usa a relação angular da magnificação;
`updateWeapon(gun, state)` recebe `scoped` para ocultar os braços enquanto o
encaixe da arma continua atualizado para disparos e colisões. Não há imports novos entre módulos.
`holstered` guarda a arma selecionada sem alterar o inventário, cancela ataques/mira
pendentes e bloqueia novos ataques. `Z` alterna esse estado; selecionar uma arma
explicitamente equipa novamente. Sem guarda, o avatar usa `Idle_Loop` completo
e os braços ficam fora da vista em primeira pessoa. `C` agacha e `V` troca tinta;
agachar fica no canto inferior esquerdo no toque. Desarmar, tinta, reações,
câmera e outras ações ficam na grade recolhida de **Mais ações**, no topo esquerdo.

`weapons.js` mantém o catálogo e a regra de dois slots de fogo, um melee e socos
sempre disponíveis. `paintball.inventory` retorna `{slots, selected, lastFirearmSlot}`;
slots 0/1/2 representam principal/secundária/melee. `1`/`2`/`3` selecionam esses
slots e `4` seleciona socos (incluindo Numpad); números não teleportam.
`availableWeapons` contém os três equipamentos e socos. `pickupWeapon(id)` retorna
`{picked, dropped, slot}`; armas de fogo substituem o slot de fogo selecionado ou o
último usado, e melee substitui apenas o slot 3. `pickups.js` cria as cópias no chão,
detecta proximidade e coloca o item descartado no lugar do coletado. A UI usa
`game.weaponPickups.nearby` e `pickup()`, e implementa a roda por segurar/arrastar/soltar
em `ui/weapon-wheel.js`. `game.ui.weaponWheelOpen` bloqueia tiros e mira durante a escolha.
Os slots aparecem somente na roda enquanto o botão está pressionado; não há
inventário permanente no HUD.

`player/avatar.js` mantém um único modelo, esqueleto e materiais para as duas vistas.
Na primeira pessoa oculta cabeça, tronco e pernas, e gira o rig em torno dos olhos;
na terceira mantém o corpo em pé. A locomoção anima quadril/pernas enquanto as
poses originais de pistola animam tronco, braços, punhos e dedos. `playShot(strength = 1)`
aplica o recuo do clipe original de disparo sobre a pose de mira atual; a Nova usa
maior amplitude e recuperação mais lenta. A arma acompanha a mão direita, e a primeira
pessoa enquadra o conjunto de braços/arma sem reescrever rotações das articulações.
Clipes preservados no GLB podem ser inspecionados com
`avatar.setPreviewAnimation(name, time)`. `playReload(duration)` usa `Pistol_Reload`
na camada superior, preserva a locomoção e evita recentrar a arma durante a recarga.
`stopReload()` cancela essa camada. `public/models/sato.glb` é uma cópia
sem alterações do `sato (4).glb` fornecido pelo usuário. A orientação dos punhos e
a articulação dos dedos vêm da pose de pistola original, sem reescrever o asset.

`gameplay/paintball/weapon-models.js` carrega os GLBs Quaternius antes da coleta
de materiais e do warmup. Normaliza escala/eixo e fornece empunhadura e cano para
`setWeaponModels()`. A seleção da tinta atualiza só os detalhes das armas;
`keepStandard` preserva seus materiais e o filtro localizado no modo cartoon.
Na primeira pessoa os ombros ficam atrás do plano próximo da câmera, e o recuo
aditivo tem peso reduzido para manter o retículo visível. A mira enquadra cada
perfil de arma abaixo do retículo. `ui/sniper-scope.js` desenha a abertura circular
e o retículo da AWP sem exibir arma ou braços. Durante o escopo, o scroll ajusta
a ampliação; fora dele, seleciona primeira pessoa para cima e terceira para baixo,
sem interferir no mapa/tour. No toque, botões +/− também ajustam o zoom.

A postura de mira compensa a rotação do quadril na primeira vértebra e acrescenta
um balanço sutil durante a corrida, movendo a cadeia inteira de braços.
A intensidade do analógico escolhe continuamente caminhada, trote ou corrida em
qualquer direção. `Walk_Loop`, `Jog_Fwd_Loop` e `Sprint_Loop` acompanham a velocidade
real e a fase compartilhada `player.locomotion`. Eventos `footstep`, `jump` e `land`
disparam gravações de grama/terra/concreto por `core/locomotion-audio.js`, sem passos parado,
contra obstáculos ou durante o voo. `avatar.playAttack(def, {sequence})` usa
`Sword_Attack` para melee e alterna `Punch_Jab`/`Punch_Cross` para socos.
`Crouch_Idle_Loop` e `Crouch_Fwd_Loop` animam o agachamento parado/em movimento.
O enquadramento em primeira pessoa compensa o deslocamento do quadril para manter
a guarda visível. Durante qualquer voo, `Swim_Fwd_Loop` toma o corpo inteiro a 1,2×,
sem sobreposição da guarda, recuo ou correção da cabeça. Ao pousar, a locomoção
e a postura equipada/desarmada voltam automaticamente.
Na primeira pessoa, melee usa a guarda frontal original de pistola como base
e o movimento aditivo dos braços de espada, com amplitude reduzida e ombros
fora do enquadramento. A guarda fica mais à direita/abaixo, com braços e arma
reduzidos juntos nessa vista; todas as lâminas e cabos inclinam para frente.
A terceira pessoa conserva a pose e o golpe de espada completos.
Os socos em primeira pessoa partem de uma guarda dobrada. `player/first-person-fists.js`
avança ombro, cotovelo e punho, estende o braço e recupera a guarda durante Jab/Cross.
Preserva a orientação das mãos do clipe e reforça a curvatura dos dedos,
com o início dos braços fora da tela e largura adaptada ao celular. A pose original é restaurada antes
de cada avaliação, inclusive ao trocar câmera/arma ou atualizar o mesmo quadro.
Melee e socos compensam a rotação herdada do quadril e mantêm a cabeça na orientação
ereta de repouso em terceira pessoa. O encaixe reavalia o rig sem avançar o tempo
quando a câmera muda entre quadros; o balanço em primeira pessoa tem 35% da amplitude
da terceira. `player/hand-shape.js` funde um pequeno enchimento na base de cada
polegar à geometria skinned existente, sem novos draw calls ou alterações no GLB.
`player/hair.js` joga pontas e franja para a esquerda do personagem (+X no GLB),
preservando a nuca e o asset original. A classe `body.playing`, vinculada a lock/unlock do jogador,
oculta o cursor no jogo e restaura o cursor ao abrir menus/mapa.

`core/training.js` expõe `start()`, `stop()`, `active`, `floor`, `root`, `obstacles`, `terrain`, `bounds`
e consultas de colisão/pisos/telhados compatíveis com as usadas pelo personagem.
O modo `training` oculta a cidade e usa uma área plana isolada; `player/index.js`
seleciona essas consultas enquanto o treino está ativo e desativa o voo. A saída
restaura visibilidade, atmosfera, câmera e posição anteriores. A UI emite
`modechange` ao entrar ou sair dos modos; paintball limpa gatilho, mira, projéteis
e marcas de tinta. Durante o treino, seus raios consultam o piso, obstáculos, caixas e hitboxes via `game.combat`. O treino possui pisos e colisão nos obstáculos próprios, sem consultar a cidade.

`core/dynamic-props.js` inicializa Rapier por importação assíncrona e cria uma caixa
de madeira e uma de metal por espaço. O mundo usa passo fixo de 1/60 s, piso de treino e uma
malha amostrada do terreno do campo; só as caixas do espaço ativo participam. O personagem
compõe consultas de colisão e topo da caixa com os pisos existentes. `onImpact(hit, info)`
aplica impulso no ponto atingido e registra dano; marcas de tinta acompanham a caixa.
Golpes de melee e socos usam um alcance curto a partir dos olhos e nunca criam tinta.
Consultas de piso rejeitam explicitamente o `-1` que Rapier retorna quando um raio
não acerta a caixa. Não há alteração de geometria, altura ou visual do mapa.

`paintball.reload()` inicia a recarga antecipada por R ou pelo botão de toque;
`ammo` expõe munição carregada/reserva, capacidade e progresso/tempo restante.
`gameplay/paintball/ammo.js` é a regra única, usada também pelo servidor:
Glock 20, M4/MP5 30, R8/Nova 8 e AWP 5. Pentes vazios iniciam recarga automática;
a Nova insere cartuchos individualmente e pode interromper a recarga para atirar.
Troca, guarda, menus e morte cancelam recarga; voltar do mapa preserva munição.
`resetAmmo()` reinicia por partida, laboratório ou respawn. Humanos controlados
pela IA também recarregam a cada 30 tiros. A UI mostra contagem, tempo e barra.
`muzzle-paint.js` mantém 96 gotas instanciadas recicladas, dez por disparo, sem
criar geometrias por tiro.

`game.ammoPickups` cria caixas de munição no treino e no campo de futebol.
`refillAmmo()` acrescenta dois carregadores à reserva de cada arma, limitada ao
dobro da reserva inicial, sem carregar a arma ou interromper a recarga.
Coletar exige proximidade por E ou botão contextual; o loot retorna após 15 s.
No multiplayer a autoridade valida distância, visão, estoque e cooldown.
`shared/props.js` mantém posições, dimensões e massas das caixas para cliente e
servidor. Uma caixa metálica de 0,8 m de altura serve de degrau para a de 1,6 m.

`game.ragdolls`, criado por `core/ragdolls.js`, oferece `capture(root, options)`,
`raycast(from, to)`, `impact(hit, info)`, `clear()` e `dispose()`. Humanos,
zumbis, jogador local e jogadores remotos deixam uma cópia de corpo inteiro
com 11 cápsulas em um mundo Rapier
cosmético. O corpo permanece físico por 10 s; depois libera a física e afunda
suavemente por 2,5 s, com profundidade suficiente para esconder o corpo inteiro.
Juntas fixas preservam pelve, tórax e pescoço; membros mantêm juntas esféricas.
Tiros e golpes aplicam impulso ao corpo e ao membro atingido.
`body-paint.js` projeta manchas na superfície deformada, presas ao osso dominante.
Até 24 manchas por personagem acompanham as animações e sua cópia morta;
respawn limpa apenas o personagem vivo. Novos tiros também mancham o ragdoll.
`core/ragdoll-colliders.js` amostra terreno e recorta triângulos reais de paredes,
escadas, arquibancadas e pisos próximos, aproveitando BVHs existentes. A região
de 16 × 16 m acompanha corpos arremessados; caixas usam proxies cinemáticos
que seguem suas poses. CCD e iterações adicionais estabilizam juntas/contatos.
Há limite de 16 corpos com grupos de colisão separados; não há contato entre
corpos ou com os vivos. Sair da partida/reset limpa tudo; voltar do mapa ao mesmo
modo preserva corpos. O efeito não altera dano e o original deixa as hitboxes.

`core/recorded-audio.js` reproduz samples de passos por superfície, seis disparos,
recargas, movimento/impacto de golpes, impactos por material e passagem próxima
de balas. `game.audio` oferece `setListener`, `setAmbience`, `preload`, `reload`,
`stopReload(tag)`, `hit` e `whiz`, além dos efeitos existentes. HRTF segue a câmera,
a distância atenua continuamente e reduz agudos, exceto passos de concreto/terra,
que usam gravações limpas sem passa-baixas. A grama mantém seu timbre anterior.
A Glock usa WAV editado com ataque curto e filtro mais aberto. Natureza fica ativa dentro do
polígono Cidade de Deus nos modos treta/campaign e multiplayer. Arquivos, origem,
direitos e filtros de paintball estão em `public/audio/README.md`.

`ui/collapsible.js` conecta painéis `data-collapsible` a botões com `aria-controls`.
Abertura/fechamento anima altura por CSS grid e opacidade; `inert` retira o conteúdo
fechado da navegação. Localização, detalhes do tour e placares começam recolhidos.
O minimapa permanece visível e clicável, sem cabeçalho ou botão separado de mapa.
`ui/game-menu.js` abre configurações do modo em um dialog azul translúcido;
continuar preserva a partida e só a opção explícita de sair abre o menu principal.
`ui/controls-guide.js` organiza teclas desenhadas, mouse e gestos de toque dentro
dessas configurações; H abre o guia e não há ícone de ajuda na HUD.
Nunito é a fonte da interface; Jersey 10 fica restrita ao logo da capa.

`gameplay/paintball/surface-paint.js` recorta triângulos de superfícies próximas com
um pincel volumétrico. A máscara de tinta usa coordenadas 3D para atravessar quinas
e acompanhar curvas, inclusive entre meshes estáticos e instâncias. BVHs existentes
restringem as consultas; instâncias densas também compartilham BVH de geometria.
São 96 buffers reutilizados de até 1536 vértices cada (3,38 MiB), sem alocar novas
geometrias por tiro. Só o trecho usado é enviado à GPU, e projeção ocorre no impacto.
O pequeno afastamento por face e polygon offset evitam conflito com a superfície;
depth test preserva oclusão, depthWrite desabilitado e renderOrder cronológico fazem
cada tinta nova cobrir as anteriores, inclusive após reciclar o pool. Marcas em corpos
dinâmicos seguem a matriz local da caixa, sem projetar novamente durante o movimento.

| Campo | O que é | Quem preenche / usa |
|---|---|---|
| `game.audio` | música, UI, tiros, passos, pulo/pouso e golpes: AudioContext criado no primeiro gesto, vozes limitadas | menu cria antes dos dados; core compartilha; UI e paintball usam |
| `game.engine` | `scene`, `camera`, `renderer`, `sun`, `addSystem(fn, fase)`, `setShadowFocus(fn)` | core; todos usam |
| `game.physics` | obstáculos, pisos e telhados (`addCollider`, `addSurface`, `addRoof`) e consultas (`collide`, `surfaceHeightAt`, `roofAt`) | mapa e campus **registram**; personagem **consulta** |
| `game.training` | espaço quadriculado isolado e consultas físicas próprias; restaura o estado da cidade ao sair | core cria antes do avatar; UI inicia/encerra; player e paintball consultam |
| `game.dynamicProps` | caixas Rapier, `root`, `impact`, consultas de colisão/topo | core cria antes do avatar; player e paintball usam |
| `game.weaponPickups` | armas no chão, `nearby`, `pickup` e reposição do item descartado | gameplay cria antes da UI |
| `game.combat` | autoridade local Miniplex de vida, equipes, dano e kills; IA Yuka sobre BFS, rigs de colisão, cenários e bancada física | gameplay monta antes do paintball; player, paintball e UI consultam por contexto |
| `game.mode`, `game.tour`, `game.mapPoints`, `game.settings` | modo ativo, câmera independente, destinos numerados e escolhas persistentes | main, core, campus, UI |
| `game.places` | destinos de teletransporte `{ name, x, z, yaw }` | campus e mapa adicionam; UI e personagem leem |
| `game.input` | `bind('KeyP', fn, { when: 'playing' \| 'always', label })` | cada módulo registra as próprias teclas |
| `game.events` | `on(nome, fn)` / `emit(nome, dados)` | comunicação sem import |
| `game.toast(msg)` | aviso rápido na tela (evento `'toast'`) | qualquer módulo; a UI mostra |
| `game.status(msg, progresso)` | mensagem e percentual ponderado da etapa de carregamento | etapas de construção |
| `game.map`, `game.campus`, `game.player`, `game.paintball`, `game.ui`, `game.styler` | as APIs de cada módulo | preenchidos pelo `main.js` |

### Laço do jogo (fases)

`engine.addSystem(fn, fase)` roda `fn(dt, t)` todo quadro. As fases rodam nesta ordem:

1. `early` — antes de tudo (ex.: vento da vegetação)
2. `player` — movimento, câmera, locomoção e atualização do avatar
3. `world` — objetos do mundo (semáforos, cancelas, tinta, placas); paintball encaixa a arma na mão após animar o avatar
4. `late` — interface (HUD)

Depois o motor move o céu, centra a sombra no personagem e desenha.

### Mapa com plugins

O mapa é construído por um pipeline. Quem precisa alterar o mundo (como o campus) entra como
**plugin**, implementando só os ganchos de que precisa, na ordem em que rodam:

| Gancho | Quando roda | Uso no campus |
|---|---|---|
| `prepareWorld(map)` | logo após ler o GeoJSON | troca os prédios do OSM pela planta oficial; `map.reserve(área)` |
| `correctTerrain(map)` | antes de escavar a água | corrige o relevo de satélite com os pontos de controle altimétrico |
| `shapeTerrain(map)` | após escavar a água, antes da malha do relevo | terraplenagem (pista, prédios, acessos) |
| `detailGroundRect(map)` | ao pintar o chão | chão em alta resolução sobre o campus |
| `build(map)` | após vias e prédios do OSM | constrói prédios, muros, portarias, carros |
| `decorate(map)` | após a vegetação | gramado do campus |
| `finalize(map)` | no fim | registra física, portarias em `game.places`, placas, sistema de animação |

Áreas reservadas com `map.reserve(...)` não recebem prédios procedurais nem vegetação automática.

## Regras (verificadas automaticamente por `npm test`)

1. **Importe outro módulo só pelo `index.js` dele.** Nada de `../map/terrain.js` fora de `map/`.
   `shared/` é a exceção (pode ser importado direto).
2. **Só valem as dependências da tabela abaixo.** O personagem não conhece o mapa por dentro:
   ele usa `game.physics`. A UI não importa o personagem: usa `game.player`.

| Módulo | Pode importar |
|---|---|
| `shared` | — |
| `core` | `shared` |
| `map` | `core`, `shared` |
| `campus` | `map`, `core`, `shared` |
| `player` | `core`, `shared` |
| `gameplay/paintball`, `gameplay/combat` | `player`, `map`, `core`, `shared` |
| `gameplay/multiplayer` | `gameplay/combat`, `core`, `shared` |
| `ui` | `core`, `shared` |
| `debug` | todos |
| `main.js` | todos (só os `index.js`) |

Precisa de uma dependência nova? Altere a tabela `DEPENDENCIAS` em
`scripts/check-modules.mjs` **e** esta página no mesmo PR, para a mudança ficar visível na revisão.

`gameplay/combat` e `gameplay/multiplayer` estão registrados explicitamente no verificador. Multiplayer importa as APIs públicas `createActorView`, `traceHitboxes` e `updateHumanoidHitboxes` do combate; paintball, player e UI o acessam por `game.combat` e `game.multiplayer`. Veja [configuração, eventos e limites do combate](COMBAT-TRAINING.md). O combate roda na fase `world`, antes dos projéteis; a UI de combate roda em `late`.

3. Testes de um módulo ficam em `tests/<módulo>/` e podem importar o interior do módulo.
4. Mudou a API pública (`index.js`) de um módulo? Descreva no PR e peça revisão de quem usa.

## Fluxo de trabalho em equipe

- Uma branch por tarefa: `feat/<módulo>-<assunto>` (ex.: `feat/player-agachar`).
- Cada pessoa trabalha dentro da pasta do seu módulo; conflitos ficam raros.
- Pontos de contato que todos podem tocar, com cuidado e em mudanças pequenas:
  `src/main.js` (ordem de montagem), `index.html` (elementos da interface) e esta página.
- Antes de abrir o PR: `npm test` (fronteiras + testes) e `npm run build`.

## Receitas

**Nova mecânica (ex.: carros):** crie `src/gameplay/carros/index.js` exportando
`createCarrosModule(game)`. Dentro dele use `game.engine.addSystem(...)`, `game.input.bind(...)`,
`game.physics.collide(...)` e `game.toast(...)`. Monte em `src/main.js` (uma linha) e adicione
`'gameplay/carros'` à tabela `DEPENDENCIAS`.

**Nova área modelada à mão (ex.: outro bairro):** crie `src/<area>/index.js` com
`create<Area>Plugin(game, dados)` implementando os ganchos do mapa, e inclua o plugin em
`buildMap(game, { plugins: [campus, area] })`.

**Novo obstáculo ou piso:** registre em `game.physics` (`addCollider`, `addSurface`, `addRoof`).
O personagem passa a respeitá-lo sem mudança nenhuma em `src/player/`.

**Nova tecla:** `game.input.bind('KeyX', () => ..., { label: 'o que faz' })` no seu módulo.

**Aviso na tela:** `game.toast('mensagem')`.

## Rede e autoridade das salas

`server/index.js` expõe HTTP `/health` e Socket.IO no mesmo `PORT`. `server/hub.js`
gerencia diretório público, limite de 10, tokens de reconexão por 20 segundos,
isolamento de mensagens e simulação de cada sala. O loop usa passos de 60 Hz e
snapshots a aproximadamente 18 Hz. `server/simulation.js` adapta o combate existente
e Rapier para friendly fire, respawn, waves do Prata e gols com a caixa.

`map.createHeadlessMap()` e a fábrica de canvas injetável de `campus` permitem
aplicar os mesmos dados e alterações do relevo no Node. `server/world.js` usa
polígonos de prédios, segmentos de muros e terreno para validar movimentos e tiros.
O flow field aceita consultas de geometria física e uma guarda de células; linhas
longas de navegação ficam em cache, enquanto cada movimento mantém sua varredura.

`game.multiplayer` expõe `network`, `self`, `snapshot`, `roster`, `canAct`, `nearby`,
`attack`, `interact`, `emote`, `raycast` e `leave`. A conexão só começa ao abrir o
lobby. O cliente prevê seu movimento, reconcilia poses pela sequência aceita e
interpola atores/caixas. Os avatars remotos clonam o rig e o visual selecionado;
zumbis reutilizam `combat.createActorView`. O modo desativa voo e teletransporte.

`multiplayer/peers.js` negocia WebRTC pelo mesmo socket. O menor ID inicia o link;
os datachannels enviam a própria pose a 30 Hz, sem ordem/retransmissão. Poses
antigas, inválidas ou distantes da autoridade são ignoradas. O servidor continua
enviando snapshots durante toda a sessão e controla dano, caixas e minigames.
`ui/multiplayer.js` desenha lobby, status, placares, emojis e interações.

Configuração e operação: [Multiplayer no Render](MULTIPLAYER-RENDER.md).
`npm run test:multiplayer` testa salas e regras; `npm run qa:multiplayer` executa
dois navegadores reais, desktop/mobile, com Socket.IO e Rapier reais.

### Aprovação, ranking e reações

Salas novas ficam em `snapshot.phase = waiting`. Cada membro envia a ação
`ready` com um booleano; a autoridade só muda para `running` quando todos os
membros estão conectados e aprovaram. Desconectar revoga a aprovação durante a
espera, e reconectar exige aprovar novamente. Sair remove o voto da sala. A
partida inicia uma vez por sala; entrar em uma partida já iniciada mantém o
fluxo de entrada e a proteção inicial. Movimento, ataques e minigames ficam
bloqueados na espera. `game.multiplayer.ready(bool)` é usado por `ui`.

`stats.assists` credita uma assistência por morte a cada participante que
causou dano nos últimos 10 segundos, excluindo quem matou; a lista é limpa na
morte/respawn. `shared.rankPlayers` ordena kills decrescentes, assistências
decrescentes e mortes crescentes. Tab mostra o ranking enquanto pressionado;
o botão permite alternar no celular. O protocolo passa a **2**: publicar
cliente e servidor juntos; versões antigas recebem o pedido de atualização.

`game.ui.reactions` expõe `react(id)`, `open()`, `close()` e `opened`. G abre a
roda com emojis, aceno e dança; Esc cancela, soltar G confirma, e toque permite
escolher um item. Reações de rede usam o evento autoritativo `emote` com posição.
`avatar.playEmote(id)` reutiliza `Dance_Loop` e o aceno do rig; `stopEmote()`
encerra a reação em morte/saída. Movimento,
ataque, recarga e morte encerram a dança. `ui/reactions` renderiza um pool
limitado a 24 CSS3DSprites, flutuando e desaparecendo em 2,6 s, com consultas
de oclusão ao terreno e às colisões estáticas. `audio.notification(position)`
gera um aviso curto em HRTF com atenuação contínua; passos/armas continuam
usando exclusivamente os samples gravados.
O marcador de objetivo dos zumbis no treino passa a Y, liberando G para reações.

### Personalização e contatos

O catálogo de aparência inclui camisa social/terno, com ou sem gravata,
calça/sapato social e tênis. Mangas reutilizam pesos do skin original;
colarinho, lapelas e gravata acompanham o tórax. Cabelos usam uma base contínua
até a nuca, com curto penteado, fade, enroladinho baixo, comprido, dreads,
black power, espetado e moicano. Boné/touca preservam a faixa de cabelo na
nuca e sua cor, exceto no estilo raspado. O GLB original permanece intacto.
O personagem inicial é Bancário; dados antigos do personagem inicial são
atualizados preservando o ID e a seleção, sem renomear personagens criados.

`shared.moveWithContacts` subdivide o percurso e resolve contatos, mantendo o
último ponto estável em conflitos. NPCs bloqueiam aproximação em vez de
empurrar o controlador continuamente e sua navegação evita invadir atores.
`shared.standVolumes` fornece os mesmos degraus/passeio para cliente e servidor;
`builder.addSolid(..., stepable)` permite subir degraus até 70 cm e bloqueia
entrada pelas laterais altas. A autoridade mede o limite de salto a partir
do piso pisável da arquibancada. `player.start(touch, { pointerLock })` permite
entrar na espera com cursor livre para aprovar a partida.

## Responsáveis

Preencha com o time e espelhe em `.github/CODEOWNERS` para o GitHub pedir revisão automática.

| Módulo | Responsável |
|---|---|
| core | (definir) |
| map | (definir) |
| campus | (definir) |
| player | (definir) |
| gameplay | (definir) |
| ui | (definir) |

### Regressão da abertura no navegador

`scripts/qa-intro.cjs` requer Playwright e Chromium. Após `npm run build` e `npm run preview`, execute:

```bash
CHROMIUM_PATH=/usr/bin/chromium QA_CPU_RATE=4 node scripts/qa-intro.cjs http://localhost:4173/
```

Se o Chromium instalado pelo Playwright for usado, omita `CHROMIUM_PATH`. `QA_VIEWPORT=844x390` testa horizontal; o padrão é `390x844`. `QA_ARTIFACT_DIR` define onde salvar o relatório por quadro e a captura (padrão: diretório temporário `jogo-intro-qa`). O teste deixa downloads e construção 3D acontecerem normalmente, reduz a velocidade da CPU e verifica intervalos entre quadros, revelação progressiva antes do final, fundo estável, palavras sem quebra e WebGL após a abertura. Também confirma que os dados baixam durante a intro, que o menu opaco não redesenha a cidade e que a campanha volta a renderizar ao iniciar. A CPU retorna à velocidade normal para essas verificações após medir a abertura.
