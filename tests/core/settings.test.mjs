import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, normalizeSettings } from '../../src/core/settings.js';
import { qualityProfile } from '../../src/core/quality.js';

test('first visit defaults to medium with surroundings omitted, and corrupt storage is safe', () => {
  assert.deepEqual(loadSettings({ getItem: () => null }), { quality: 'med', surroundings: 'off' });
  assert.deepEqual(loadSettings({ getItem: () => '{broken' }), { quality: 'med', surroundings: 'off' });
  assert.deepEqual(normalizeSettings({ quality: 'ultra', surroundings: true }), { quality: 'med', surroundings: 'off' });
  assert.deepEqual(loadSettings({ getItem() { throw Error('blocked'); } }), { quality: 'med', surroundings: 'off' });
});

test('graphics and surroundings survive a new session with bounded GPU budgets', () => {
  let value;
  const storage = { getItem: () => value, setItem: (_, v) => { value = v; } };
  saveSettings({ quality: 'low', surroundings: 'fog' }, storage);
  assert.deepEqual(loadSettings(storage), { quality: 'low', surroundings: 'fog' });
  const low = qualityProfile('low', 3), med = qualityProfile('med', 3), high = qualityProfile('high', 3);
  assert.ok(low.pixelRatio < med.pixelRatio && med.pixelRatio < high.pixelRatio);
  assert.ok(low.shadowMap < med.shadowMap && med.shadowMap < high.shadowMap);
  assert.equal(qualityProfile('unknown').name, 'med');
});
