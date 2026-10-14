# Diagnóstico de latência e correção dos acertos

Medições de 13/10/2026, deste computador, contra `https://jogo-server-dbfz.onrender.com`.
Os testes criaram salas próprias e saíram por `room:leave`; `/health` voltou a indicar zero salas.

## Conexão publicada

| Cenário | Amostras de ping | Ping mediano | Ping p95 | Maior ping | Maior intervalo entre snapshots |
|---|---:|---:|---:|---:|---:|
| WebSocket, 45 s, uma pessoa | 89 | 209 ms | 243 ms | 295 ms | 137 ms |
| HTTP polling forçado, 30 s | 50 | 465 ms | 953 ms | 1.352 ms | 2.555 ms |
| WebSocket, defesa do Prata, 25 s | 49 | 200 ms | 249 ms | 317 ms | 378 ms |

Nenhum ping expirou nesses três cenários. O primeiro comparativo, feito durante o QA
gráfico local, teve picos maiores; a repetição de 45 s acima foi feita sem esse QA.
O atraso p95 do event loop do próprio processo de diagnóstico foi de 12 ms nessa repetição.
Uma amostra curta não determina a qualidade de todas as redes/aparelhos ou horários.

No teste da defesa, o cliente percorreu uma rota válida da Bussocaba ao Prata,
iniciou a atividade pela ação normal e recebeu sete zumbis na primeira wave.
O servidor sustentou aproximadamente 18 snapshots/s nessa sala. Isso valida uma
sala e a primeira wave; não representa dez pessoas remotas ou todas as cinco waves.

O DNS resolveu para `gcp-us-west1-1.origin.onrender.com`, sinal de infraestrutura
no oeste dos EUA. A conexão Socket.IO com as opções antigas começou em polling e
conseguiu subir para WebSocket. Portanto, a queda para polling é um agravante
possível, mas não foi comprovada no aparelho em que o problema foi relatado.

## Causas confirmadas no código

- O cliente adicionava 100 ms de interpolação por horário de chegada; o servidor
  testava tiros contra o alvo na posição atual, sem consultar o que o atirador viu.
- O projétil local sofria gravidade de 3 m/s², enquanto o servidor o movia em linha reta.
- Dispersão e orientação do espalhamento eram calculadas separadamente nos dois lados.
- O zumbi Quaternius de 1,95 m usava a hitbox humana no servidor: cabeça de raio
  0,16 m entre 1,60–1,66 m. A cabeça animada usa raio de 0,25 m e sobe durante a caminhada.
- Os sons de impacto no multiplayer esperavam o servidor, inclusive em superfícies locais.
- Snapshots voláteis podiam ser descartados repetidamente durante congestionamento
  do transporte, especialmente no HTTP polling.

Antes da correção, os testes reproduziram a falha de headshot alto, a diferença de
gravidade e os erros contra alvo em movimento com RTT de 80, 160 e 300 ms.

## Comportamento corrigido

O cliente envia `shotId`, horário estimado do disparo, horário exibido dos alvos e
a pose atual validada junto do ataque. O servidor mantém até 500 ms de hitboxes,
interpola o histórico e avança o projétil durante até 250 ms do percurso de envio.
Cada passo varre alvos, cenário e caixas. A consulta histórica preserva as posições
vivas e exclui mortos, desconectados e vidas anteriores ao respawn.

Gravidade e dispersão por ID do tiro vêm de `shared/ballistics.js`. O cliente
usa os mesmos envelopes de colisão do servidor para os zumbis; a campanha mantém
as hitboxes animadas nos ossos. O som do impacto local é previsto e deduplicado;
dano e morte continuam confirmados pela autoridade. Tiros rejeitados devolvem
a munição prevista uma única vez. A tinta confirmada acompanha a posição visual
do alvo, mesmo quando o acerto veio de uma posição histórica.

A interpolação usa horários da simulação e adapta sua janela entre 60 e 150 ms
conforme os intervalos recebidos. Todos os alvos de combate usam essa mesma linha
de tempo; o fluxo do jogo deixou de substituir a posição de jogadores por poses
WebRTC. O módulo de peers e o sinalizador antigo continuam disponíveis no código.

A conexão tenta WebSocket primeiro e permite HTTP quando ele estiver bloqueado.
Durante congestionamento, o servidor mantém um snapshot mais recente por conexão
para entregar quando o transporte estiver disponível. Após um segundo sem estado
novo, o HUD avisa e o cliente suspende novos ataques até receber atualizações.

O `/health` novo informa versão do netcode, commit do Render quando disponível,
frequências configuradas e atraso do event loop nos últimos cinco segundos.
O HUD mostra ping, transporte, oscilação e diagnóstico ao passar o mouse.

## Ajustes no Render

1. **Região:** comparar um serviço de teste em Virginia/Ohio com o atual, a partir
   dos aparelhos dos jogadores no Brasil. A distância do oeste dos EUA pode
   contribuir para os cerca de 200 ms observados. O Render não permite mudar
   a região de um serviço existente; é necessário criar outro e trocar
   `VITE_SERVER_URL`, com novo build do frontend.
   [Regiões e migração](https://render.com/docs/regions).
2. **Compute:** o `render.yaml` pede `free`, mas não confirma o plano aplicado
   atualmente no painel. Se estiver Free, comparar com `0.5c-512mb` (Starter)
   após implantar a correção e observar CPU/event loop durante as waves.
   Free oferece 0,1 CPU; esse plano oferece 0,5 CPU e a mesma RAM de 512 MB.
   O plano pago evita a suspensão por inatividade. Mais CPU pode ajudar nos picos
   da simulação; o ping geográfico exige avaliar região.
   [Planos](https://render.com/docs/compute-plans), [limites do Free](https://render.com/docs/free).
3. **Instâncias:** manter uma instância enquanto salas e simulação ficam em memória.
   Réplicas exigem roteamento de sala e autoridade compartilhada.
4. **Publicação:** publicar primeiro o servidor e depois o frontend, e recarregar
   a página. Os campos novos são opcionais no protocolo 2; as melhorias de acerto
   dependem de ambos os lados atualizados.

O painel abriu sem sessão. Plano aplicado, uso real de CPU/RAM e logs do Render
não puderam ser inspecionados. Nenhuma alteração de plano, região ou cobrança foi feita.

## Reproduzir

```bash
npm run diagnose:multiplayer -- https://jogo-server-dbfz.onrender.com --duration=45 --room
npm run diagnose:multiplayer -- https://jogo-server-dbfz.onrender.com --duration=45 --room --websocket-only
node scripts/diagnose-defense.mjs https://jogo-server-dbfz.onrender.com
npm run qa:multiplayer
npm run qa:latency
```

`--room` cria somente uma sala de diagnóstico. Sem essa opção, o teste mede
conexão/ping sem entrar em salas. O teste da defesa percorre o mapa a 7 m/s e
observa a primeira wave por 25 segundos. Os JSONs ficam em `artifacts/network`.

`qa:latency` usa um navegador real e uma ponte Socket.IO com atraso configurado:
0/80/160/300 ms, variação de até 15 ms por direção e descarte de um em vinte
snapshots no último cenário. **20/20 headshots** em zumbi em movimento foram
confirmados; a falta de snapshots bloqueou ataques e o retorno dos pacotes
restaurou a partida. O descarte de snapshots simula falta de atualizações na
aplicação; não é uma medição de perda de pacotes TCP. O teste de transporte
cobre WebSocket bloqueado, HTTP com 160 ms de atraso e reconexão da mesma identidade.
