import { createStyler } from './style.js';

// Visual cartoon (padrão) / realista e modo pixel. Roda depois que tudo está na cena,
// porque converte os materiais existentes.
export function setupVisualStyle(game) {
  const { scene, renderer, hemi } = game.engine;
  const styler = createStyler(scene, renderer, hemi);
  styler.collect();
  styler.setCartoon(true);
  game.input.bind('KeyT', () => { styler.setCartoon(!styler.cartoon); game.toast(styler.cartoon ? 'Visual: CARTOON' : 'Visual: realista'); }, { label: 'cartoon / realista' });
  game.input.bind('KeyV', () => { styler.setPixel(!styler.pixel); game.toast(styler.pixel ? 'Modo PIXEL ligado' : 'Modo pixel desligado'); }, { label: 'modo pixel' });
  return styler;
}
