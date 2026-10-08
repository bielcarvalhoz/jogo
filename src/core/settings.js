export const DEFAULT_SETTINGS = Object.freeze({ quality: 'med', surroundings: 'off', music: true, effects: true });
const KEY = 'cdd-settings-v1';

export function normalizeSettings(value = {}) {
  return {
    quality: ['low', 'med', 'high'].includes(value?.quality) ? value.quality : DEFAULT_SETTINGS.quality,
    surroundings: ['off', 'fog', 'on'].includes(value?.surroundings) ? value.surroundings : DEFAULT_SETTINGS.surroundings,
    music: typeof value?.music === 'boolean' ? value.music : DEFAULT_SETTINGS.music,
    effects: typeof value?.effects === 'boolean' ? value.effects : DEFAULT_SETTINGS.effects,
  };
}

export function loadSettings(storage) {
  try { return normalizeSettings(JSON.parse((storage ?? globalThis.localStorage).getItem(KEY))); }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings, storage) {
  const normalized = normalizeSettings(settings);
  try { (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify(normalized)); } catch { /* modo privado / armazenamento cheio */ }
  return normalized;
}
