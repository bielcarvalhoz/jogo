# Vegetação e água

O cenário usa a linguagem de vegetação de [sato-agents-lab](https://github.com/satoLG/sato-agents-lab), inspirada no [folio-2025 de Bruno Simon](https://github.com/brunosimon/folio-2025), referência `41046b57eeed8d156d9c3fd7fa259900baef7816`.

- `sources/Game/World/Foliage.js`: cartões de folhas de 0,8 unidades distribuídos numa esfera por `1 - random³`, normais radiais, recorte SDF e rotação suave do recorte com o vento. A adaptação WebGL em `src/map/nature.js` usa três azimutes e copas largas irregulares, sem uma esfera sólida por trás das folhas.
- `static/foliage/foliageSDF.png`: textura original 128 × 128, copiada de `sato-agents-lab/static/textures/folio-2025`. O arquivo MIT com copyright Bruno Simon acompanha o asset em `public/textures/folio-2025/LICENSE.txt`.
- `sources/Game/World/Grass.js`: um triângulo por lâmina, raiz fixa e ponta movida pelo vento. Os gramados do campus são curtos, seguindo as fotos; o chão das matas tem lâminas mais altas.
- `sources/Game/Terrain.js` e `sources/Game/World/WaterSurface.js`: água com cor de profundidade, margem rasa e contornos de ondulação interrompidos por ruído. O lago do campus preserva o tom verde-oliva observado nas fotos. O mapa de distância usa os contornos reais, incluindo furos/ilhas.

As adaptações mantêm o renderer WebGL deste projeto e não acrescentam uma câmera de reflexão, framebuffer ou simulação física. Folhas, grama e água atualizam somente um uniforme de tempo compartilhado; as instâncias ficam estáticas na GPU. `updateNature(t, reducedMotion)` congela as animações quando a preferência de movimento reduzido está ativa.

## Orçamento

Árvores externas usam 16/18/20 cartões por copa em Low/Med/High; árvores do campus usam 32/40/56. As copas recuperam volume em relação à primeira otimização (20/24/32), mantendo a população de árvores reduzida à metade depois das exclusões. A seleção determinística por coordenada distribui a redução pelos dois lados das ruas e pelos bosques. As árvores com macacos têm prioridade, e as palmeiras permanecem. Nos dados atuais, o campus passa de 2.850 para 1.425 árvores; no perfil Med, são aproximadamente 58% menos triângulos de folhas que as 2.850 árvores com 48 cartões originais. Entorno desabilitado pula toda a geração da vegetação externa.

O campus mantém troncos e galhos numa malha de 42 triângulos por árvore, com sombra do sol; a cidade ao redor usa troncos de 16 triângulos sem uma passagem extra de sombras. Copas e troncos são instanciados diretamente em blocos de 125 m com descarte pelo frustum, sem reparticionar e copiar seus buffers depois. Canteiros compartilham geometria/material; a altura do passeio é consultada uma vez por árvore. A rotação do recorte das folhas pelo vento é calculada no shader de vértices. As folhas não acrescentam passagens ao mapa de sombras. A grama tem no máximo 100 mil lâminas no perfil alto e 35 mil no baixo, agrupadas em blocos de 64 metros. Cada área de água é uma superfície opaca e o mapa de distância tem no máximo 256/128 pixels por lado.

As posições candidatas das árvores de calçada seguem intervalos de 11 metros ao longo da polilinha inteira, sem reiniciar a distância em cada segmento; metade é mantida. Travessias, caminhos de pedestres, prédios, piscinas e quadras são excluídos pelas máscaras e pela proximidade às vias. A grama preserva os passeios e não invade a pista esportiva. Exclusões do campus usam um índice espacial de 24 m e conservam o teste exato de polígonos/círculos, incluindo furos; amostras fora de áreas verdes são descartadas antes das consultas de obstáculos.
