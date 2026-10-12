import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterStore, normalizeAppearance, DEFAULT_APPEARANCE, CHARACTER_STORAGE_KEY } from '../../src/core/characters.js';

test('a fresh roster requires selection and saves independent named appearances across reloads', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const store = createCharacterStore(storage);
  assert.equal(store.selected, null); assert.equal(store.characters[0].name, 'Bancário');
  assert.throws(() => store.save({ name: '  ' }), /nome/);
  const biel = store.save({ name: '  Biel  ', appearance: { hairStyle: 'mohawk', headAccessory: 'cap', shirtColor: '#FF3300' } });
  const other = store.save({ name: 'Outro', appearance: { hairStyle: 'afro' } });
  assert.notEqual(biel.id, other.id); assert.equal(biel.name, 'Biel'); assert.equal(store.selected, null);
  store.select(biel.id);
  const reloaded = createCharacterStore(storage);
  assert.equal(reloaded.selected.id, biel.id); assert.equal(reloaded.selected.appearance.shirtColor, '#ff3300');
  assert.equal(reloaded.characters.length, 3);
  const copy = reloaded.selected; copy.appearance.hairStyle = 'bald';
  assert.equal(reloaded.selected.appearance.hairStyle, 'crop');
  reloaded.save({ ...biel, name: 'Biel novo', appearance: { beard: 'full' } });
  assert.equal(reloaded.selected.name, 'Biel novo'); assert.equal(reloaded.characters.length, 3);
  assert.equal(reloaded.select('missing'), null); assert.equal(reloaded.selected.id, biel.id);
  assert.ok(data.has(CHARACTER_STORAGE_KEY));
});

test('invalid stored data falls back safely and unavailable storage keeps session play possible', () => {
  for (const content of ['{', 'null', '{"version":2}', '{"version":1,"characters":[null,{}, {"id":"x","name":""}],"selectedId":"missing"}']) {
    const store = createCharacterStore({ getItem: () => content });
    assert.equal(store.characters[0].name, 'Bancário'); assert.equal(store.selected, null);
  }
  const store = createCharacterStore({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  const character = store.save({ name: 'Sem storage' }); store.select(character.id);
  assert.equal(store.selected.name, 'Sem storage'); assert.equal(store.persisted, false);
  assert.deepEqual(normalizeAppearance({ hairStyle: 'constructor', eyeStyle: null, shirtColor: 'url(bad)', pantsColor: '#123', extra: 1 }), DEFAULT_APPEARANCE);
});

test('legacy starter becomes a generic banker without renaming user-created characters', () => {
  const store = createCharacterStore({ getItem: () => JSON.stringify({ version: 1, selectedId: 'sato', characters: [{ id: 'sato', name: 'Sato' }, { id: 'mine', name: 'Sato' }] }) });
  assert.equal(store.selected.name, 'Bancário'); assert.equal(store.characters[1].name, 'Sato');
});

test('skin and gender persist and legacy hairstyles migrate without discarding other customization', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const store = createCharacterStore(storage), character = store.save({ name: 'Joana', appearance: { gender: 'female', skinColor: '#643F2D', hairStyle: 'buns' } });
  store.select(character.id);
  const restored = createCharacterStore(storage).selected;
  assert.equal(restored.appearance.gender, 'female'); assert.equal(restored.appearance.skinColor, '#643f2d');
  assert.equal(restored.appearance.hairStyle, 'buns');
  for (const [old, next] of Object.entries({ curls: 'buns', dreads: 'long', spikes: 'original', mohawk: 'crop', afro: 'buns' })) {
    const appearance = normalizeAppearance({ hairStyle: old, shirtColor: '#abcdef' });
    assert.equal(appearance.hairStyle, next); assert.equal(appearance.shirtColor, '#abcdef');
  }
  const invalid = normalizeAppearance({ gender: 'constructor', skinColor: 'url(invalid)' });
  assert.equal(invalid.gender, DEFAULT_APPEARANCE.gender); assert.equal(invalid.skinColor, DEFAULT_APPEARANCE.skinColor);
});

test('actual v1 rosters keep IDs, selection and colors while old hairstyles survive edit, save and reload', () => {
  const mapping = { original: 'original', crop: 'crop', long: 'long', sidecut: 'sidecut', bald: 'bald', curls: 'buns', dreads: 'long', spikes: 'original', mohawk: 'crop', afro: 'buns' };
  const characters = Object.keys(mapping).map(hairStyle => ({ id: hairStyle, name: `Antigo ${hairStyle}`, appearance: { hairStyle, hairColor: '#abcdef', gender: 'female', skinColor: '#654321', headAccessory: 'headphones' } }));
  let saved = JSON.stringify({ version: 1, selectedId: 'dreads', characters });
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const store = createCharacterStore(storage);
  assert.equal(store.selected.id, 'dreads'); assert.equal(store.selected.appearance.hairStyle, 'long');
  assert.equal(JSON.parse(saved).characters.find(c => c.id === 'dreads').appearance.hairStyle, 'dreads', 'loading must preserve the stored source until an explicit save');
  for (const character of store.characters) {
    assert.equal(character.appearance.hairStyle, mapping[character.id]);
    store.save({ ...character, name: character.name + ' novo' });
  }
  const restored = createCharacterStore(storage);
  assert.equal(restored.selected.id, 'dreads'); assert.equal(restored.characters.length, characters.length);
  for (const character of restored.characters) {
    assert.equal(character.appearance.hairStyle, mapping[character.id]);
    assert.equal(character.appearance.hairColor, '#abcdef'); assert.equal(character.appearance.skinColor, '#654321');
    assert.equal(character.appearance.gender, 'female'); assert.equal(character.appearance.headAccessory, 'headphones');
  }
});
