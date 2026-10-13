import { createStyler } from './style.js';

// Visual cartoon (padrão) / realista. Roda depois que tudo está na cena,
// porque converte os materiais existentes.
export function setupVisualStyle(game) {
  const { scene, renderer, hemi } = game.engine;
  const styler = createStyler(scene, renderer, hemi);
  styler.collect();
  styler.setCartoon(true);
  game.input.bind('KeyK', () => { if (game.mode === 'multiplayer') return; styler.setCartoon(!styler.cartoon); game.toast(styler.cartoon ? 'Visual: CARTOON' : 'Visual: realista'); }, { label: 'cartoon / realista (fora da sala)' });
  return styler;
}
