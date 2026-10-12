# Multiplayer: salas e publicação no Render

O multiplayer usa um **serviço novo, `jogo-server`**, no repositório `bielcarvalhoz/jogo`. A estrutura segue o `defend_the_crystal`: Node + Socket.IO como autoridade, reconexão por token e WebRTC opcional para poses. O frontend continua na Vercel. O `dtc-server` existente continua atendendo o Defend the Crystal.

## O que foi implementado

- Salas públicas listadas ao abrir **Modo treta → Multijogador**, criação com nome e entrada pela lista ou código. Até **10 jogadores**, incluindo vagas reservadas durante uma reconexão.
- Cada sala tem jogadores, vida, mortes, kills, zumbis, caixas e placares próprios. Todos nascem em posições livres diferentes, perto da Portaria Bussocaba.
- Friendly fire ligado. O servidor calcula colisões dos projéteis, dano, cadência, proteção inicial de 2 segundos e respawn após 3 segundos.
- Emoji sobre o personagem; `T` acena, `G` libera o cursor e foca as opções. No celular, toque nos emojis.
- Círculo **DEFENDER O PRATA** na entrada inferior, junto ao acesso Prata -2: chegue perto e pressione `E` ou toque em **Iniciar**. São 5 waves, com portais perto da Bussocaba e 1.200 pontos de vida do prédio. Todos da sala podem ajudar; derrotar uma wave dá 5 segundos até a próxima.
- Círculo **FUTEBOL DE CAIXA** no centro do campo: `E`/toque inicia. Empurre, golpeie ou atire na caixa de madeira para mandá-la a um dos gols. Cada lado tem um placar; o primeiro a 5 vence. Depois de um gol a caixa volta ao centro em 2 segundos. A caixa precisa cruzar inteira entre as traves e abaixo do travessão.

As duas atividades podem funcionar ao mesmo tempo. Voo e teletransporte ficam desativados na sala; o mapa continua disponível para orientação. As armas do inventário atual continuam disponíveis. A coleta de armas no chão é local nesta primeira versão.

## 1. Disponibilizar o código no GitHub

Para produção, faça merge do PR desta implementação em `main`. Para testar antes, selecione a branch **`feat/multiplayer-rooms`** tanto no Render quanto no preview da Vercel.

Não misture um frontend antigo com o servidor novo. O protocolo é versionado; uma versão incompatível pede que a página seja atualizada.

## 2. Criar o servidor

No [painel do Render](https://dashboard.render.com/), entre na conta usada para o `dtc-server`:

1. Clique em **New + → Web Service**.
2. Conecte o GitHub e selecione **`bielcarvalhoz/jogo`**. Se não aparecer, conceda acesso a esse repositório na integração GitHub do Render.
3. Preencha:

| Campo | Valor |
|---|---|
| Name | `jogo-server` — ou outro nome livre |
| Language / Runtime | Node |
| Branch | `main` após o merge; `feat/multiplayer-rooms` para teste |
| Region | A região que você preferir, idealmente perto dos jogadores |
| Root Directory | Deixe vazio, usando a raiz do repositório |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Instance Type | Free para experimentar |
| Health Check Path, nas opções avançadas | `/health` |

4. Em **Environment**, adicione `NODE_VERSION=22` e `NODE_ENV=production`.
5. Se o jogo usa domínio próprio, adicione **`CLIENT_ORIGINS`** com a origem completa do site, por exemplo `https://jogo.exemplo.com.br`. Para vários domínios, separe por vírgula. URLs locais e subdomínios `*.vercel.app` já são aceitos, como no DTC.
6. Clique em **Deploy Web Service** e espere ficar **Live**. O log deve mostrar `[jogo-server] listening on :...`.

O código usa `process.env.PORT` e escuta em `0.0.0.0`. Deixe o Render fornecer a porta; HTTP, Socket.IO e WebSocket usam o mesmo serviço. [Referência de Web Services](https://render.com/docs/web-services), [WebSockets no Render](https://render.com/docs/websocket).

Como alternativa ao formulário, use **New + → Blueprint**, escolha o mesmo repositório/branch e revise o [`render.yaml`](../render.yaml) incluído. Crie o serviço apenas por um dos caminhos. [Referência do Blueprint](https://render.com/docs/blueprint-spec).

## 3. Conferir a URL real

Copie a URL HTTPS exibida pelo serviço. O Render escolhe a URL final; **`https://seu-jogo-server.onrender.com` é apenas um exemplo**.

Abra `SUA_URL/health`. Deve aparecer um JSON com:

```json
{"ok":true,"game":"jogo-do-biel","protocol":1,"rooms":0,"maxPlayers":10}
```

`rooms` muda conforme as salas criadas. O servidor serve esse diagnóstico e a rede; a tela do jogo continua no frontend.

## 4. Conectar o frontend da Vercel

1. Abra o projeto **jogo** na Vercel → **Settings → Environment Variables**.
2. Crie **`VITE_SERVER_URL`** com a URL HTTPS real copiada do Render, sem `/health` e sem `/socket.io`.
3. Habilite **Production** e, se quiser testar o PR, **Preview**.
4. Faça **Redeploy** do frontend. O Vite grava essa variável durante o build; salvar a variável sozinho não altera um deploy já pronto.
5. Abra o novo deploy, vá a **Modo treta → Multijogador** e espere **Conectado**.

Para testar temporariamente um servidor sem alterar a variável, também existe `?server=URL_HTTPS_CODIFICADA` na URL do jogo. Esse parâmetro só vale para aquela abertura. Em um site HTTPS, o servidor também precisa usar HTTPS.

## 5. Teste com duas pessoas

1. Uma pessoa cria a sala; a outra abre Multijogador e escolhe **Entrar** na lista. Também é possível copiar o código no HUD.
2. Confirmem seus personagens. O visual e o nome escolhidos aparecem para os outros.
3. Andem, acenem com `T` e testem os emojis. No HUD aparece a latência e se há conexão direta com outro jogador.
4. Depois dos 2 segundos de proteção, atirem um no outro para testar friendly fire. A vida, kill, morte e respawn precisam aparecer para ambos.
5. Caminhem até o Prata e iniciem a defesa. Os portais aparecem na Bussocaba e os zumbis seguem até o prédio.
6. No centro do campo, iniciem o futebol. Mandem a madeira a um dos gols e confiram o placar e o retorno ao centro.
7. Interrompam brevemente a rede de um aparelho: a conexão tenta voltar e preserva a identidade por até 20 segundos. **Recarregar a página começa uma nova sessão**; o token fica só na memória do navegador.

## WebRTC e fallback

O servidor simula a 60 Hz e transmite snapshots a aproximadamente 18 Hz. Cada cliente prevê seu próprio movimento; o servidor limita velocidade, altura e deslocamento e varre prédios/muros antes de aceitar a pose. Os outros jogadores, zumbis e caixas são interpolados. Vida, acertos, caixas físicas, waves e gols pertencem ao servidor.

WebRTC negocia pelo Socket.IO e cria datachannels não ordenados, sem retransmissão, enviando **somente a pose do próprio jogador a 30 Hz**. Com dez jogadores, cada navegador pode ter nove links. O snapshot autoritativo continua chegando o tempo todo; se um canal falhar ou ficar sem poses, o visual volta ao servidor automaticamente. Peers nunca decidem dano ou placar.

STUN público vem configurado. Algumas redes não permitem uma conexão direta; o jogo continua pelo Socket.IO. Opcionalmente, configure **`VITE_RTC_ICE_SERVERS`** no build do frontend com uma lista JSON de servidores ICE. Dados `VITE_*` ficam públicos: para TURN autenticado, use credenciais temporárias, em vez de embutir uma senha permanente.

```json
[{"urls":"stun:stun.l.google.com:19302"}]
```

## Operação e diagnóstico

As salas ficam na memória de **uma instância Node**. Reiniciar, dormir ou fazer deploy encerra as salas. Mantenha uma instância; aumentar réplicas exige um diretório compartilhado, roteamento de sala e distribuição da autoridade, que não fazem parte desta versão.

O Free do Render dorme após 15 minutos sem tráfego e pode levar cerca de um minuto para acordar; o lobby mostra que está conectando. As 750 horas gratuitas mensais são compartilhadas pelos serviços do workspace, incluindo o DTC. Para jogar sem espera ou se as waves ficarem lentas, avalie uma instância paga. [Limites oficiais do Free](https://render.com/docs/free).

| Sintoma | Conferir |
|---|---|
| “Multiplayer ainda não foi configurado” | `VITE_SERVER_URL` no ambiente correto e novo deploy da Vercel |
| Conectando por muito tempo | Render Live, logs, URL `/health` e eventual inicialização do Free |
| `/health` abre, mas a sala não conecta | Origem do site em `CLIENT_ORIGINS`, URL HTTPS e frontend atualizado |
| Só aparece “Conexão pelo servidor” | A rede pode bloquear WebRTC; isso é um caminho funcional de fallback |
| Sala sumiu depois de deploy | Estado é em memória; crie outra sala |
| Sala lotada após alguém perder a conexão | Aguarde até 20 segundos pela liberação da vaga reservada |

## Rodar e verificar localmente

Use Node 22. Na raiz, rode `npm ci`. Em dois terminais separados:

```bash
npm run dev:server
```

```bash
npm run dev
```

Abra `http://localhost:5173` em dois navegadores. Sem configuração, o cliente local usa `http://localhost:3001`. Para uma porta diferente, configure `VITE_SERVER_URL` em `.env.local`; veja [`.env.example`](../.env.example).

```bash
npm test
npm run build
npm run qa:multiplayer
```

O QA sobe o servidor real e dois clientes Chromium, um desktop e outro mobile. Use `CHROMIUM_PATH` se o Chrome estiver em outro local. Relatórios e screenshots ficam em `artifacts/multiplayer/` e não entram no Git. Os testes de rede também podem ser executados separadamente com `npm run test:multiplayer`.
