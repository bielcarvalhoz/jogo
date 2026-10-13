# Áudio gravado do jogo

Passos, disparos, recargas, golpes, impactos e natureza usam arquivos gravados.
Não há fallback procedural para esses efeitos. Música do menu e cliques da UI
continuam no sintetizador que já existia.

## Portal 2 / SourceSounds

Origem solicitada: https://github.com/sourcesounds/portal2/tree/master/sound

Os WAVs em `portal2/` conservam os caminhos relativos do diretório `sound`:

- `player/footsteps/{concrete,dirt,grass}{1,2,3,4}.wav`: quatro variações por piso.
- `physics/{concrete,wood,metal,flesh,surfaces}/`: impactos de bala e golpe.
- `physics/nearmiss/whoosh_large4.wav`: passagem próxima de projétil e movimento de golpes.
- `physics/paint/paint_blob_splat_{01,02}.wav`: respingos de tinta; arquivos originais
  copiados integralmente de [SourceSounds](https://github.com/sourcesounds/portal2/tree/master/sound/physics/paint).
- `weapons/fx/rics/ric1.wav`: arquivo legado, não é mais carregado ou reproduzido.
- `ambient/levels/forest/{treewind1,dist_birds1}.wav` e
  `ambient/nature/insects/amb_insects_lp_01.wav`: natureza na Cidade de Deus.

Créditos: Valve / Portal 2, disponibilizados pelo arquivo SourceSounds.
O repositório consultado não declara uma licença de redistribuição desses sons.
O acesso público ao arquivo não equivale a uma licença; a origem está registrada
para a avaliação de direitos antes de distribuir o jogo com esses WAVs.

## SnakeF8 / itch.io

Origem: [Snake's Authentic Gun Sounds](https://f8studios.itch.io/snakes-authentic-gun-sounds)
e [Snake's SECOND Authentic Gun Sounds](https://f8studios.itch.io/snakes-second-authentic-gun-sounds-pack).
Autor: SnakeF8 / F8 Studios. Packs gratuitos; o autor permite uso comercial,
edição e redistribuição dos sons e declara domínio público nos comentários.
Crédito não é obrigatório. `snakef8/sources.json` identifica cada arquivo original.
Os MP3s foram copiados integralmente, sem reexportar. A Glock agora reproduz
`pistol-clean.wav`, editado a partir do WAV original 9mm Single Isolated: remoção
leve de ruído, corte de subgrave, cauda de 220 ms com fade e pico normalizado
a 0,8. Isso evita os picos acima de 1 do MP3 e preserva um ataque curto e limpo.

Cada uma das seis armas de fogo tem um disparo e uma recarga próprios. O disparo
do jogador (`local: true`) toca o arquivo completo na velocidade original,
sem HRTF, filtros ou envelope de ataque/cauda: `BufferSource → ganho → bus de
efeitos → volume master → saída`. A Glock conserva o `pistol-clean.wav` acima;
os outros disparos usam os MP3s originais. A posição da arma ou da câmera em
primeira/terceira pessoa não altera esse áudio. Disparos de outros jogadores e
NPCs mantêm HRTF, distância, velocidade e envelope dos perfis existentes.
As recargas mantêm a sincronização com a animação; a Nova usa o sample de inserção
de cartucho a cada etapa da recarga.

## Impactos de tinta

Projéteis reproduzem um respingo leve (ganho 0,07) em concreto, madeira, solo e
personagens. No metal há também o impacto metálico em ganho 0,045 (antes 0,20),
sem o ricochete adicional. Não se usa o som de concreto ou madeira sendo atingido
por bala para tinta. Impactos da mesma superfície a menos de 1,5 m e em uma janela
de 50 ms compartilham o som, evitando empilhar os nove pellets da Nova; danos,
física e marcas continuam individuais. Golpes e colisões preservam seus sons.

## Revisão dos passos

`foley/{concrete,dirt}{1,2,3,4}.wav` são edições das gravações Portal 2 acima,
sem áudio procedural. Concreto (asfalto/calçada) mantém a pancada inicial e
recorta arrasto posterior; terra mantém a textura do solo com cauda mais curta.
Há redução leve de ruído e normalização de pico (concreto 0,7; terra 0,55), sem
filtro passa-baixas na preparação ou reprodução desses passos. O envelope de
entrada de 1 ms preserva o ataque. A grama conserva arquivo e envelope.
`scripts/prepare-refined-audio.mjs <WAV original da 9mm>` reproduz as edições
com FFmpeg; essa ferramenta não é dependência do jogo nem do build.

## Reprodução espacial

`src/core/recorded-audio.js` carrega e decodifica os arquivos uma vez após o gesto
que desbloqueia áudio. Eventos de passos não ficam enfileirados durante o download.
As fontes posicionadas usam HRTF e atenuação inversa contínua. Não há filtros
passa-baixas ou absorção adicional de agudos nos efeitos gravados. O disparo local
ignora o panner; as demais fontes preservam a espacialização. O listener acompanha a câmera, incluindo
terceira pessoa. Há limite de 32 vozes, cancelamento por personagem para recargas,
fade da natureza e limpeza ao silenciar ou ocultar a aba.

`QA_URL=http://127.0.0.1:5173 node scripts/qa-audio.mjs` compara no Chrome a saída
local de cada arma contra a gravação decodificada com o mesmo ganho, amostra por
amostra, e verifica direção e distância de disparos remotos.
