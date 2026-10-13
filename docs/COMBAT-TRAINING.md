# Combate e laboratório de treino

O modo treino inclui uma bancada com 16 botões físicos, alvos parados e obstáculos de cobertura. Mire em um botão, aproxime-se a até 8 m e pressione **E** ou atacar. No toque, use **Acionar** quando um botão físico estiver sob a mira. O laboratório é controlado apenas pela bancada 3D, sem painel de menu ou atalho J.

## Cenários e controles

- **+ Zumbi / + Bot inimigo / + Aliado / + Horda (8)** adicionam personagens. O limite padrão é 32 NPCs, incluindo corpos ainda em cena.
- **Alvos parados** adiciona um humano e um zumbi para conferir as regiões de dano.
- **Duelo com bot** reinicia a rodada e adiciona um adversário.
- **Defender objeto** reinicia a rodada, coloca dois aliados e oito zumbis atacando o objeto azul.
- **Bot: Fácil / Normal / Difícil** altera os bots atuais e os próximos. Os perfis variam reação, cadência, dispersão, percepção, velocidade e probabilidade de mirar a cabeça.
- **Zumbi: Personagens / Objeto / Ponto** muda o objetivo dos zumbis. Eles perseguem humanos de outras equipes, atacam o objeto azul ou caminham até o marcador amarelo. **G** marca um ponto na direção da mira e seleciona esse objetivo; mirando para baixo, usa a interseção com o chão. **Ponto aqui** usa a posição do jogador.
- **Hitboxes** mostra cabeça em amarelo, tórax em vermelho e membros em azul. Cápsulas acompanham os ossos animados, incluindo mãos e pés.
- **Pausar IA**, **Imortal** e **Fogo amigo** permitem isolar testes. Fogo amigo começa desligado; aliados bloqueiam projéteis mesmo quando não recebem dano.
- **Reiniciar treino** limpa personagens, corpos, efeitos, vida do objeto e placar. Mantém escolhas de dano, dificuldade, objetivo e hitboxes; a IA volta a rodar.

Aliados usam Sato, têm anel azul, seguem o jogador quando não há ameaça e atacam zumbis e bots adversários. Bots inimigos têm anel vermelho. Ambos disparam raios com dispersão real e usam socos a curta distância. Paredes e caixas bloqueiam visão e tiros. Sem visão, um bot pode investigar a última posição observada por até quatro segundos. Zumbis preparam o ataque e confirmam alcance e visibilidade no momento do golpe.

## Vida e dano

| Padrão do treino | Vida | Cabeça | Tórax | Membros |
|---|---:|---:|---:|---:|
| Humano | 100 | 1 tiro | 2 tiros | 4 tiros |
| Zumbi | 200 | 1 tiro | 4 tiros | 8 tiros |

**Dano: 1 / 2 / 4** usa 50 de dano no tórax e 25 nos membros por projétil de arma com uma bala. Headshot de arma de fogo é letal. Na Nova, nove pellets compartilham o dano de corpo de um disparo; acertos parciais causam menos dano. Um pellet na cabeça continua letal.

**Dano: por arma** usa o catálogo existente, com multiplicadores de 1× no tórax e 0,75× nos membros. Headshots permanecem letais; desativando `lethalHeadshots`, o multiplicador passa a 4×. O resultado varia com a arma. Esta configuração não reproduz integralmente CS ou Call of Duty, com suas regras de colete, penetração e distância. Melee e socos usam o dano do catálogo e não recebem morte instantânea na cabeça.

Toda entidade tem vida no ECS. **Humanos não mostram barra no mundo**, incluindo aliados. **Zumbis mostram a barra durante três segundos após receber dano**, ocultando-a ao morrer. O HUD mostra vida, kills, mortes e headshots do jogador; aliados têm estatísticas próprias no ECS. O objeto tem 500 de vida, exibida durante a defesa. Corpos tocam a animação de morte e saem após cinco segundos. O jogador retorna ao início após três segundos, conserva o placar e recebe dois segundos de proteção. Durante a morte, movimento, pulo e ataques ficam bloqueados.

## Organização e configuração

`src/gameplay/combat/` é montado após Sato e os modelos de armas, antes do paintball e da UI:

- `simulation.js`: **Miniplex** contém vida, equipes, posições, alvos, ataques, mortes e estatísticas. Passo fixo de 1/60 s, com no máximo 0,1 s de recuperação por quadro. Roda em Node sem DOM ou renderer e é a autoridade local para movimento, IA, dano e kills.
- `flow-field.js`: BFS de quatro vizinhos, células de 1,25 m, obstáculos inflados pelo raio dos personagens e até 24 campos compartilhados em cache. Sem conexão, retorna sem rota. Caixas Rapier atualizam os obstáculos a cada 0,25 s de treino.
- `hitboxes.js`: interseção contínua de segmentos com cápsulas; retorna a primeira região atingida e respeita o alcance. O rig lógico do jogador independe dos braços da câmera e acompanha o agachamento.
- `actors.js`: esqueletos e mixers independentes, animações e hitboxes nos ossos; geometria e texturas compartilhadas. **Yuka SeekBehavior + SeparationBehavior**, usados pela simulação, conduzem agentes pelos pontos do campo BFS. Cada movimento é conferido contra obstáculos.
- `training-lab.js`: bancada 3D e ações. `ui/combat-hud.js`: controles acessíveis e feedback.
- `index.js`: integra ECS, controlador, cena, Rapier e impactos por `game.combat`. O combate participa somente do treino. Sair remove NPCs e restaura a cidade pelo ciclo normal.

Regras ficam em `config.js`: passe-as a `createCombatSimulation({ bounds, rules })` ou use:

```js
game.combat.configure({
  damageMode: 'weapon',
  friendlyFire: false,
  zombie: { health: 300, speed: 2.2, damage: 25, interval: 1.2 },
  lethalHeadshots: true,
});
```

Vida máxima é aplicada às próximas criações. Velocidade, dano, intervalos e limite entram em vigor na simulação atual. `game.combat.simulation.world` expõe o ECS. Eventos `combatspawn`, `combatdamage`, `combatdeath`, `combatshot`, `combatremove` e `combatrespawn` passam pelo barramento. `raycast(from, to)` e `impact(hit, info)` integram armas sem pintar personagens; cenário e hitboxes concorrem pela colisão mais próxima.

Esta entrega é uma **simulação local** para testar futuros modos. Transporte de rede, servidor de partidas, replicação, lag compensation, colete e penetração ficam para outra etapa. Ao levar a autoridade a um servidor, a camada de transporte deverá enviar comandos validados e snapshots dos componentes necessários; steering e alvos em memória não são mensagens de rede.

## Modelo, referências e validação

`public/models/enemies/zombie-quaternius.glb` é uma cópia sem alteração de **Zombie by Quaternius - 22K0aSZkHV.glb**, fornecido em Downloads. Autoria informada: **Quaternius**. Preserva os clipes originais, incluindo `Idle`, `Walk`, `Idle_Attack`, `HitReact` e `Death`. Humanos usam `public/models/sato.glb`, o mesmo modelo do protagonista.

Referências: [Miniplex](https://github.com/hmans/miniplex) e [Yuka](https://mugen87.github.io/yuka/docs/), instalados no projeto e registrados no lockfile.

`npm test` verifica fronteiras, dano por região, kills únicas, equipes, pellets, melee, cápsulas, oclusão, reação de bots, coop, objetivos, preparação de ataque, BFS desconectado, desvios, invalidação de obstáculos, limites, passo fixo, GLBs reais, barras, projéteis e ciclo de treino/morte/retorno/limpeza. `npm run build` gera a versão de produção.
