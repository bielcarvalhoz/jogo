import { loadSettings } from './settings.js';

export const IS_TOUCH = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);

export function qualityProfile(name = 'med', dpr = globalThis.devicePixelRatio || 1) {
  const profiles = {
    low: { pixelRatio: Math.min(dpr, 1), shadowMap: 1024, shadowExtent: 90, far: 3500, fog: [500, 2200], groundPx: 2048, detailPx: 2048, antialias: false },
    med: { pixelRatio: Math.min(dpr, 1.5), shadowMap: 2048, shadowExtent: 120, far: 3500, fog: [600, 2400], groundPx: 2048, detailPx: 4096, antialias: true },
    high: { pixelRatio: Math.min(dpr, 2), shadowMap: 4096, shadowExtent: 150, far: 4500, fog: [800, 3000], groundPx: 4096, detailPx: 4096, antialias: true },
  };
  const selected = profiles[name] ? name : 'med';
  return { name: selected, ...profiles[selected] };
}

export function detectQuality(settings = loadSettings()) {
  const params = new URLSearchParams(location.search);
  const override = import.meta.env.DEV ? params.get('quality') : null;
  return qualityProfile(override || settings.quality);
}

export function debugOptions() {
  const params = new URLSearchParams(location.search);
  return { inspectionView: import.meta.env.DEV ? params.get('inspect') : null };
}
