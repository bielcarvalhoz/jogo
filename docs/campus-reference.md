# Detalhes da Cidade de Deus

Esta alteração parte da `main` em `a575e60`. Mantém as plantas georreferenciadas, os nomes e números do mapa interno e a navegação existente. As 31 fotos fornecidas pelo usuário foram usadas como referência visual; nenhuma fotografia foi incluída nos arquivos distribuídos.

## Características observadas

- Calçadas claras em lajes, juntas, faixa estreita de tijolos, meio-fio baixo claro/escuro, travessias brancas e rampas com marcação amarela. Todos os 72 objetos de via interna de veículos recebem passeios dos dois lados; entroncamentos são recortados para preservar as pistas. Há 22 travessias. A geometria usa metros, independentemente da resolução das texturas.
- Totens grafite, faixa lateral na cor do prédio, base escura e nome branco vertical. São placas físicas, visíveis sem ativar os rótulos flutuantes. A implantação atual encontra espaço para 24 totens e 25 acessos; alguns prédios sem fotografia recebem somente a linguagem geral de identificação.
- Cinza 01: caixilhos grafite, vidro em módulos, marquise, degraus e corrimãos. Prata 04: fachada clara com caixilhos prateados e banner vermelho/rosa com os dizeres da referência. Vermelho 05: cintas largas vermelhas, estrutura clara, cobertura triangular transparente e frase sobre a entrada. Rubi 06 permanece separado, em bordô.
- Amarelo 13: paredes amarelo-claro, faixas de vidro com moldura escura, escada de sete degraus e identificação vertical. Azul 19: brises verticais azuis densos, bandas horizontais creme, pequeno acesso elevado com rampa, marquise cinza apoiada em postes salmão e chafariz baixo. CTI 24: juntas de painéis metálicos e letreiro Tecnologia da Informação.
- Pavilhões Bem Estar, Fitness, Conviver e Saúde: vidro com montantes escuros, base e bordas em tom de madeira e cobertura verde. As portarias têm vigas claras, pilares vermelhos, marca textual à esquerda e nome preto à direita; Vila Yara usa o corte diagonal vermelho visto na foto.
- Árvores em intervalos de 11 metros, canteiros quadrados nos passeios, copas abertas de folhas, palmeiras com frondes curvas e grama curta. A seleção preserva prédios, água, quadras, portarias e travessias. O desenho da natureza segue a [referência documentada](nature-reference.md).

## Relevo e navegação

O SRTM original continua intacto no arquivo de dados. Antes de gerar as malhas, as vias recebem correções locais de corte/aterro limitadas a 0,9 m; os apoios dos prédios, a 1 m. Campo e pista recebem uma plataforma horizontal, com transição suave no entorno e proteção do lago e das piscinas. A correção do conjunto esportivo pode ultrapassar esses limites, pois remove a inclinação do campo inteiro; os triângulos da margem do lago têm prioridade sobre a faixa externa da plataforma.

As consultas do jogador usam os mesmos pisos das calçadas, patamares, degraus e rampas que são desenhados. As rampas laterais ligam-se aos patamares e têm inclinação aproximada de 1:12. Apoios e colisões dos prédios continuam sob responsabilidade do construtor existente. A alteração não abre interiores ou adiciona minigames.

## Sobreposição de superfícies

Muros usam um único sólido com quinas contínuas e tampa compartilhada, em vez de caixas de cobertura que se cruzam. Trechos OSM substituídos por esse muro são removidos por segmento; os trechos independentes são preservados. Calçadas são recortadas nos encontros; pintura recebe separação de altura e deslocamento de profundidade. Letreiros dos dois lados de um totem ficam separados pela espessura do suporte.

## Verificação

`npm test` verifica relevo/malha, proteção da margem, cortes limitados, cruzamentos, suporte físico dos pisos, juntas dos muros, barreiras parcialmente duplicadas, normais de fachadas, copas, grama e shader da água. `npm run build` gera a versão de produção.

Em desenvolvimento, `/?inspect=azul`, `amarelo`, `cinza`, `prata`, `vermelho`, `cti`, `conviver`, `campo` ou `lago` escolhe uma câmera de inspeção. O elemento oculto `#scene-inspection` fornece dados da cena real e falhas de compilação de shaders. Esse módulo não entra na compilação de produção. O jogo normal continua em `/`.

As dimensões de marquises, escadas, mobiliário e jardins são aproximações baseadas nas fotos, sem levantamento métrico. A foto da passarela do Vermelho não determina as duas extremidades na planta disponível; nenhuma ligação entre prédios foi inventada. Números e posições dos prédios são os da base anterior.
