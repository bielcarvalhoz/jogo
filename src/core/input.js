// Atalhos de teclado: cada módulo registra os seus com bind(), em vez de todos dividirem
// um único switch gigante. when: 'playing' (só com o jogo rodando) ou 'always'.
export function createInput(game) {
  const bindings = new Map();
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target?.closest?.('input, select, textarea, [contenteditable=true]')) return;
    for (const b of bindings.get(e.code) || []) {
      if (b.when === 'playing' && !game.isPlaying()) continue;
      b.handler(e);
    }
  });
  return {
    /** code = KeyboardEvent.code (ex.: 'KeyP', 'Digit1'); label aparece na lista de atalhos */
    bind(code, handler, { when = 'playing', label = '' } = {}) {
      if (!bindings.has(code)) bindings.set(code, []);
      bindings.get(code).push({ handler, when, label });
    },
    list: () => [...bindings].flatMap(([code, bs]) => bs.map((b) => ({ code, when: b.when, label: b.label }))),
  };
}
