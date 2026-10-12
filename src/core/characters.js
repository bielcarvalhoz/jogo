export const CHARACTER_STORAGE_KEY = 'cdd.characters.v1';

export const APPEARANCE_OPTIONS = Object.freeze({
  hairStyle: { original: 'Curto penteado', crop: 'Corte baixo / fade', curls: 'Enroladinho baixo', long: 'Comprido', dreads: 'Dreads', spikes: 'Espetado', mohawk: 'Moicano', afro: 'Black power', bald: 'Raspado' },
  eyeStyle: { original: 'Anime original', round: 'Arredondado', sharp: 'Olhar marcante', sleepy: 'Relaxado' },
  beard: { none: 'Sem barba', stubble: 'Barba por fazer', goatee: 'Cavanhaque', full: 'Barba cheia' },
  shirtStyle: { classic: 'Camiseta lisa', stripes: 'Listrada', sport: 'Esportiva', social: 'Camisa social', socialTie: 'Camisa e gravata', suit: 'Terno sem gravata', suitTie: 'Terno e gravata' },
  pantsStyle: { jeans: 'Jeans', cargo: 'Cargo', jogger: 'Jogger', dress: 'Calça social' },
  shoeStyle: { casual: 'Tênis casual', sport: 'Tênis esportivo', high: 'Cano alto', dress: 'Sapato social' },
  faceAccessory: { glasses: 'Óculos de grau', none: 'Sem acessório', sunglasses: 'Óculos escuros', mask: 'Máscara' },
  headAccessory: { none: 'Sem acessório', cap: 'Boné', backwards: 'Boné para trás', beanie: 'Touca', headphones: 'Fone de ouvido' },
});

export const DEFAULT_APPEARANCE = Object.freeze({
  hairStyle: 'original', hairColor: '#503b2d', eyeStyle: 'original', eyeColor: '#6d4932', beard: 'none',
  shirtStyle: 'classic', shirtColor: '#263746', pantsStyle: 'jeans', pantsColor: '#536b88',
  shoeStyle: 'casual', shoeColor: '#734f44', faceAccessory: 'glasses', headAccessory: 'none', accessoryColor: '#293543',
});

export function normalizeAppearance(value = {}) {
  const result = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(result)) {
    if (APPEARANCE_OPTIONS[key]) {
      if (Object.hasOwn(APPEARANCE_OPTIONS[key], value?.[key])) result[key] = value[key];
    } else if (/^#[\da-f]{6}$/i.test(value?.[key])) result[key] = value[key].toLowerCase();
  }
  return result;
}

const characterName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';

/** Local roster; selecting a character is explicit, including on a fresh install. */
export function createCharacterStore(storage) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { /* Storage access itself can be denied. */ } }
  let roster = [], selectedId = null, persisted = true;
  try {
    const saved = JSON.parse(storage?.getItem(CHARACTER_STORAGE_KEY) || 'null');
    if (saved?.version === 1 && Array.isArray(saved.characters)) {
      const ids = new Set();
      for (const item of saved.characters.slice(0, 50)) {
        if (typeof item?.id !== 'string' || !item.id || item.id.length > 80 || ids.has(item.id) || !characterName(item.name)) continue;
        ids.add(item.id); roster.push({ id: item.id, name: item.id === 'sato' && item.name === 'Sato' ? 'Bancário' : characterName(item.name), appearance: normalizeAppearance(item.appearance) });
      }
      if (roster.some(item => item.id === saved.selectedId)) selectedId = saved.selectedId;
    }
  } catch { /* Corrupt or unavailable storage must not prevent playing. */ }
  if (!roster.length) roster.push({ id: 'banker', name: 'Bancário', appearance: { ...DEFAULT_APPEARANCE } });
  const copy = item => item ? { ...item, appearance: { ...item.appearance } } : null;
  function persist() {
    try {
      if (!storage) throw new Error('Storage unavailable');
      storage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify({ version: 1, characters: roster, selectedId })); persisted = true;
    } catch { persisted = false; }
  }
  return {
    get characters() { return roster.map(copy); },
    get selected() { return copy(roster.find(item => item.id === selectedId)); },
    get persisted() { return persisted; },
    save({ id, name, appearance }) {
      name = characterName(name);
      if (!name) throw new Error('Dê um nome ao personagem.');
      const index = roster.findIndex(item => item.id === id);
      if (index < 0 && roster.length >= 50) throw new Error('Você já tem 50 personagens. Edite um deles.');
      const item = { id: index < 0 ? (globalThis.crypto?.randomUUID?.() || `character-${Date.now()}-${Math.random().toString(36).slice(2)}`) : id, name, appearance: normalizeAppearance(appearance) };
      if (index < 0) roster.push(item); else roster[index] = item;
      persist(); return copy(item);
    },
    select(id) {
      const item = roster.find(item => item.id === id);
      if (!item) return null;
      selectedId = id; persist(); return copy(item);
    },
  };
}
