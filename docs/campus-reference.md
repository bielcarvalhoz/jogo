# Detalhes da Cidade de Deus

O primeiro passe partiu da `main` em `a575e60`; a continuação parte do merge `cc09980`. Mantém as localizações georreferenciadas, os nomes e números do mapa interno. As 31 fotos fornecidas pelo usuário foram usadas como referência visual; nenhuma fotografia foi incluída nos arquivos distribuídos. As fachadas retas do Vermelho, Rubi e Azul recebem envelopes retangulares orientados pela planta para remover os pequenos segmentos curvos/serrilhados da vetorização de telhados.

## Características observadas

- Calçadas claras em lajes, juntas, faixa estreita de tijolos, meio-fio baixo claro/escuro, travessias brancas e rampas com marcação amarela. Todos os 72 objetos de via interna de veículos recebem passeios dos dois lados; entroncamentos são recortados para preservar as pistas. Há 22 travessias. A geometria usa metros, independentemente da resolução das texturas.
- Totens grafite, faixa lateral na cor do prédio, base escura e nome branco vertical. São placas físicas, visíveis sem ativar os rótulos flutuantes. A implantação atual encontra espaço para 25 totens e 25 acessos; alguns prédios sem fotografia recebem somente a linguagem geral de identificação.
- Cinza 01: caixilhos grafite, vidro em módulos, marquise, degraus e corrimãos. Prata 04: fachada clara com caixilhos prateados e banner vermelho/rosa com os dizeres da referência. Vermelho 05: cintas largas vermelhas, estrutura clara, cobertura triangular transparente e frase sobre a entrada. Rubi 06 permanece separado, em bordô.
- Amarelo 13: paredes amarelo-claro, faixas de vidro com moldura escura, escada de sete degraus e identificação vertical. Azul 19: brises verticais azuis, bandas creme, praça ampla na fachada nordeste, chafariz central e duas escadarias curvas ao redor dele que chegam ao patamar atrás da fonte. Entrada recuada sob marquise cinza/postes salmão. CTI 24: juntas de painéis metálicos e letreiro Tecnologia da Informação; locomotiva histórica preta/vermelha sobre pequeno trilho no jardim próximo à entrada.
- Passarela Vermelho–Rubi: ligação confirmada pelo usuário e pelo mapa, implantada no trecho de sobreposição das fachadas. Uma passagem envidraçada com faixas vermelhas superior/inferior e vigamento escuro, sem pilar na rua. Entradas opostas sob pequenas marquises transparentes triangulares. A ponte não teletransporta o jogador do chão para sua cobertura.
- MOVE: abrigos existentes redesenhados com marquise grafite, vidro, moldura castanha e marca verde/azul em duas faces voltadas à via. São posições aproximadas já calculadas perto dos prédios, sem levantamento dos pontos. Catracas: cinco portarias oficiais (06/07/08/09/10), uma direção de entrada e uma de saída em cada; gabinetes/leitores vermelhos, tripés metálicos e indicação de direção. A segunda boca de veículos de Bussocaba não duplica o conjunto pedestre.
- Placas físicas ficam fora das coberturas e têm um corredor de visão desde a rua sem árvores/copas sobrepostas. A implantação remove vegetação e carros que invadiriam os novos acessos, bases, abrigos e sinalização.
- Pavilhões Bem Estar, Fitness, Conviver e Saúde: vidro com montantes escuros, base e bordas em tom de madeira e cobertura verde. As portarias têm vigas claras, pilares vermelhos, marca textual à esquerda e nome preto à direita; Vila Yara usa o corte diagonal vermelho visto na foto.
- Árvores em intervalos de 11 metros, canteiros quadrados nos passeios, copas abertas de folhas, palmeiras com frondes curvas e grama curta. A seleção preserva prédios, água, quadras, portarias e travessias. O desenho da natureza segue a [referência documentada](nature-reference.md).

## Relevo e navegação

O SRTM original continua intacto no arquivo de dados. Campo/pista/arquibancada são nivelados antes das vias. Prédios recebem cotas fixas, plataformas de construção e bases de contenção, incluindo amostras do interior da planta. As cotas próximas da entrada do Azul são vinculadas à rua para impedir uma praça suspensa. A seção transversal das ruas/passeios é horizontal e a rampa longitudinal é limitada a 12%; todas as vias internas de veículos têm duas mãos e faixa central amarela, inclusive ruas sem nome. Os perfis das vias não são recalculados a partir do aterro dos prédios.

O limite antigo de 0,9 m de corte/aterro foi substituído por plataformas locais completas: aquele limite deixava ruas tombadas e edifícios parcialmente enterrados. A correção pode chegar a cerca de 19 m na transição do conjunto esportivo para uma encosta imprecisa do SRTM e cerca de 8 m junto ao Azul. São intervenções locais com transição suave, não um levantamento topográfico nem alteração global do relevo. Lago, piscinas e plataforma esportiva têm prioridade de preservação. O campo está plano; um vértice no canto externo oeste da pista compartilha a malha com a margem preservada do lago e ainda tem até 61 cm de variação.

As consultas do jogador usam os mesmos triângulos de asfalto, calçadas, plataformas, patamares, degraus e rampas que são desenhados. Bases têm acessos laterais curtos com corrimãos onde há espaço e desnível apropriados junto às vias/estacionamentos. As escadas curvas do Azul têm espelhos de até 17 cm. Apoios e colisões dos prédios continuam sob responsabilidade do construtor existente. A alteração não abre interiores.

## Sobreposição de superfícies

Muros usam um único sólido com quinas contínuas e tampa compartilhada, em vez de caixas de cobertura que se cruzam. Trechos OSM substituídos por esse muro são removidos por segmento; os trechos independentes são preservados. Calçadas são recortadas nos encontros; pintura recebe separação de altura e deslocamento de profundidade. Letreiros dos dois lados de um totem ficam separados pela espessura do suporte.

## Verificação

`npm test` verifica relevo/malha, proteção da margem, seção de via plana, limite de rampa longitudinal, eixo de rua sem nome, plataformas/escadas, ligação entre fachadas opostas, formatos retificados, suporte físico dos pisos, catracas/MOVE/locomotiva, muros, natureza e disparos/impactos/pools de tinta. `npm run build` gera a versão de produção.

Em desenvolvimento, `/?inspect=azul`, `amarelo`, `cinza`, `prata`, `vermelho`, `rubi`, `cti`, `conviver`, `campo`, `lago`, `passarela`, `move`, `trem`, `portaria` ou `tinta` escolhe uma câmera de inspeção. O elemento oculto `#scene-inspection` fornece dados da cena real e falhas de shaders; `#paintball-inspection` registra disparos/cores no modo tinta. Esse módulo não entra na compilação de produção. O jogo normal continua em `/`.

As dimensões de marquises, escadas, mobiliário e jardins são aproximações baseadas nas fotos, sem levantamento métrico. O usuário confirmou as extremidades da passarela e o desenho da escadaria do Azul. Números e localização dos prédios são os da base anterior; a forma dos três envelopes retos foi corrigida conforme a referência.

## Pistolinha de tinta

Modelo simples preso à câmera, com bolinhas coloridas e manchas nas superfícies. Clique para disparar (no modo arrastar, somente clique sem arrasto); `C` alterna a cor. A cor também pode ser escolhida no menu inicial ou pelo botão do HUD. No celular, o botão de disparo não interfere nos gestos de olhar/voar. Paleta: Cinza, Prata, Vermelho, Rubi, Amarelo, Azul, Marfim, Verde e Marrom. Limites de 16 bolinhas e 96 marcas, reutilizadas; colisão por segmento evita atravessar paredes finas, folhas/grama/água são excluídas antes do raycast. A tinta é visual e fica somente na sessão local, sem persistência ou dano.
