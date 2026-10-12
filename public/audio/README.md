# Áudio gravado do jogo

Passos, disparos, recargas, golpes, impactos e natureza usam arquivos gravados.
Não há fallback procedural para esses efeitos. Música do menu e cliques da UI
continuam no sintetizador que já existia.

## Portal 2 / SourceSounds

Origem solicitada: https://github.com/sourcesounds/portal2/tree/master/sound

Os 29 WAVs em `portal2/` conservam os caminhos relativos do diretório `sound`:

- `player/footsteps/{concrete,dirt,grass}{1,2,3,4}.wav`: quatro variações por piso.
- `physics/{concrete,wood,metal,flesh,surfaces}/`: impactos de bala e golpe.
- `physics/nearmiss/whoosh_large4.wav`: passagem próxima de projétil e movimento de golpes.
- `weapons/fx/rics/ric1.wav`: detalhe de ricochete metálico.
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

Cada uma das seis armas de fogo tem um disparo e uma recarga próprios. Na reprodução,
Web Audio aplica envelope de entrada/saída, volume reduzido e filtro passa-baixas
entre 1.250 e 2.100 Hz nas outras armas; a Glock usa 4.200 Hz e entrada de
1,5 ms, preservando o estalo sem o abafamento excessivo. A Nova usa o sample de
inserção de cartucho a cada etapa da recarga.

## Revisão dos passos

`foley/{concrete,dirt}{1,2,3,4}.wav` são edições das gravações Portal 2 acima,
sem áudio procedural. Concreto (asfalto/calçada) mantém a pancada inicial e
recorta arrasto posterior; terra mantém a textura do solo com cauda mais curta.
Há redução leve de ruído e normalização de pico (concreto 0,7; terra 0,55), sem
filtro passa-baixas na preparação ou reprodução desses passos. O envelope de
entrada de 1 ms preserva o ataque. A grama conserva arquivos, filtros e envelope.
`scripts/prepare-refined-audio.mjs <WAV original da 9mm>` reproduz as edições
com FFmpeg; essa ferramenta não é dependência do jogo nem do build.

## Reprodução espacial

`src/core/recorded-audio.js` carrega e decodifica 41 arquivos uma vez após o gesto
que desbloqueia áudio. Eventos de passos não ficam enfileirados durante o download.
As fontes posicionadas usam HRTF e atenuação inversa contínua. A absorção de agudos
com distância permanece nos demais efeitos, mas concreto/terra passam direto
para ganho e posicionamento espacial. O listener acompanha a câmera, incluindo
terceira pessoa. Há limite de 32 vozes, cancelamento por personagem para recargas,
fade da natureza e limpeza ao silenciar ou ocultar a aba.
