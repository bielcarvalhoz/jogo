const key = label => `<kbd>${label}</kbd>`;
const icon = name => `<svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#${name}" /></svg>`;
const row = (drawing, label, mode = '') => `<div class="control-guide-row"${mode ? ` data-control-mode="${mode}"` : ''}><span class="control-drawing">${drawing}</span><span>${label}</span></div>`;
export const controlsGuide = `<details id="session-controls"><summary>Controles e atalhos <span aria-hidden="true">⌄</span></summary>
  <div class="controls-guide">
    <h3>Teclado e mouse</h3>
    ${row(`<span class="keys-wasd">${['W', 'A', 'S', 'D'].map(key).join('')}</span>`, 'Mover personagem')}
    ${row(key('Shift'), 'Correr')}${row(key('Espaço'), 'Pular')}${row(key('C'), 'Agachar / levantar')}
    ${row('<span class="mouse-key mouse-left" aria-label="Botão esquerdo do mouse"></span>', 'Atirar / atacar')}
    ${row('<span class="mouse-key mouse-right" aria-label="Botão direito do mouse"></span>', 'Mirar')}
    ${row(key('R'), 'Recarregar')}${row(['1', '2', '3', '4'].map(key).join(''), 'Escolher arma / soco')}
    ${row(key('Q'), 'Segurar para abrir a roda de armas')}${row(key('E'), 'Pegar arma ou munição')}
    ${row(key('T'), 'Segurar para abrir interações; mouse escolhe, soltar confirma')}${row(key('V'), 'Trocar cor da tinta')}
    ${row(key('Z'), 'Guardar / equipar arma')}${row(key('X'), 'Alternar câmera')}
    ${row(key('F'), 'Voar / pousar', 'flight')}${row(key('E') + key('Ctrl'), 'Subir / descer em voo', 'flight')}
    ${row(key('M'), 'Abrir / fechar mapa')}${row(key('Esc'), 'Configurações / continuar')}
    ${row(key('H'), 'Abrir este guia')}${row(key('Y'), 'Marcar objetivo dos zumbis', 'training')}
    ${row(key('Tab'), 'Segurar para ver o ranking', 'multiplayer')}
    ${row(key('K'), 'Alternar visual cartoon', 'single')}${row(key('P'), 'Exibir / ocultar prédios do entorno', 'city')}
    ${row(key('B'), 'Exibir / ocultar limite do bairro', 'city')}${row(key('L'), 'Exibir / ocultar placas', 'city')}
    <h3>Tela de toque</h3>
    ${row('<span class="touch-stick" aria-hidden="true"></span>', 'Arraste à esquerda para andar; afaste o dedo para correr')}
    ${row('<span class="touch-swipe" aria-hidden="true">↔</span>', 'Arraste à direita para olhar')}
    ${row(icon('fire'), 'Segure para atacar; arraste para mirar')}${row(icon('aim'), 'Toque para focar a mira')}
    ${row(icon('jump') + icon('crouch'), 'Pular / agachar')}${row(icon('pistol'), 'Segure a arma para abrir a roda')}
    ${row(icon('map'), 'Toque no minimapa para expandir')}${row('<b class="touch-more">•••</b>', 'Mais ações: tinta, câmera, reações e outras opções')}
  </div></details>`;
