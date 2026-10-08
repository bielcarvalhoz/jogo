# Arquitetura — módulos para trabalhar em paralelo

O código é dividido em **módulos independentes**, um por pasta em `src/`. Cada módulo tem uma
**API pública** no seu `index.js`; o resto da pasta é interno e pode mudar à vontade sem
quebrar o trabalho de quem cuida de outro módulo.

## Módulos

| Pasta | Módulo | Responsabilidade | Exemplos de tarefa |
|---|---|---|---|
| `src/core/` | Núcleo / motor | renderer, cena, câmera, céu, luz e sombra, laço de sistemas, eventos, atalhos de teclado, física compartilhada, visual cartoon/pixel, perfil gráfico, câmera de tour, configurações persistentes, lotes de instâncias | pós-processamento, ciclo dia/noite, otimização de desempenho |
| `src/map/` | Mapa (mundo real) | relevo SRTM, vias, prédios do OSM, prédios procedurais, vegetação, água, muros, semáforos, placas, destinos do entorno | melhorar ruas, novos tipos de prédio, mais vegetação |
| `src/campus/` | Campus Cidade de Deus | núcleo do Bradesco: prédios da planta oficial, muros, portarias, estacionamentos, terraplenagem, detalhes | novo prédio, fachada, mobiliário do campus |
| `src/player/` | Personagem | controle em primeira pessoa: teclado, mouse, toque, colisão, pulo, voo | modelo/avatar, animação, corrida, agachar |
| `src/gameplay/<mecânica>/` | Jogabilidade | uma pasta por mecânica; hoje `paintball/` (pistolinha de tinta) | missões, carros, coletáveis, multiplayer |
| `src/ui/` | Interface | tela de carregamento, menu, HUD, minimapa, mapa grande, avisos, celular deitado, CSS | novas telas, configurações, acessibilidade |
| `src/debug/` | Depuração | `window.__cdd`, vistas de inspeção `?inspect=` | ferramentas de QA |
| `src/shared/` | Utilitários | funções puras: geometria 2D, aleatoriedade, geometria de vias, texturas procedurais | — |
| `scripts/` | Dados | baixar OSM/SRTM (`npm run data`), gerar o campus (`npm run campus`), verificar módulos | — |
| `tests/<módulo>/` | Testes | testes de cada módulo (`node --test`) | — |

## Como as peças se conectam

`src/main.js` só **monta** o jogo, nesta ordem:

```
menu imediato → dados (map + campus) → core (game) → mapa (+ plugin campus) → lotes → personagem + tour → tinta/BVH → UI → visual → materiais → debug → menu pronto
```

Tudo gira em torno de um objeto **`game`** (criado em `core/game.js`), o único compartilhado:

| Campo | O que é | Quem preenche / usa |
|---|---|---|
| `game.engine` | `scene`, `camera`, `renderer`, `sun`, `addSystem(fn, fase)`, `setShadowFocus(fn)` | core; todos usam |
| `game.physics` | obstáculos, pisos e telhados (`addCollider`, `addSurface`, `addRoof`) e consultas (`collide`, `surfaceHeightAt`, `roofAt`) | mapa e campus **registram**; personagem **consulta** |
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
2. `player` — movimento do personagem
3. `world` — objetos do mundo (semáforos, cancelas, tinta, placas)
4. `late` — interface (HUD)

Depois o motor move o céu, centra a sombra no personagem e desenha.

### Mapa com plugins

O mapa é construído por um pipeline. Quem precisa alterar o mundo (como o campus) entra como
**plugin**, implementando só os ganchos de que precisa, na ordem em que rodam:

| Gancho | Quando roda | Uso no campus |
|---|---|---|
| `prepareWorld(map)` | logo após ler o GeoJSON | troca os prédios do OSM pela planta oficial; `map.reserve(área)` |
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
| `gameplay/*` | `player`, `map`, `core`, `shared` |
| `ui` | `core`, `shared` |
| `debug` | todos |
| `main.js` | todos (só os `index.js`) |

Precisa de uma dependência nova? Altere a tabela `DEPENDENCIAS` em
`scripts/check-modules.mjs` **e** esta página no mesmo PR, para a mudança ficar visível na revisão.

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
