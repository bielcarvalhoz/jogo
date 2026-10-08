// Perfil gráfico: celulares/tablets usam um perfil mais leve.
export const IS_TOUCH = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

export function detectQuality() {
  const params = new URLSearchParams(location.search);
  const inspectLow = import.meta.env.DEV && params.get('quality') === 'low';
  return IS_TOUCH || inspectLow
    ? { name: 'low', pixelRatio: Math.min(devicePixelRatio, 1.5), shadowMap: 1024, shadowExtent: 90, far: 1800, fog: [220, 1200], groundPx: 2048, detailPx: 2048, antialias: false }
    : { name: 'high', pixelRatio: Math.min(devicePixelRatio, 2), shadowMap: 4096, shadowExtent: 150, far: 3500, fog: [350, 1900], groundPx: 4096, detailPx: 4096, antialias: true };
}

/** opções de depuração lidas da URL (só em desenvolvimento) */
export function debugOptions() {
  const params = new URLSearchParams(location.search);
  return { inspectionView: import.meta.env.DEV ? params.get('inspect') : null };
}
