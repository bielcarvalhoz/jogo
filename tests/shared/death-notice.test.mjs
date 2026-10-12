import test from 'node:test';
import assert from 'node:assert/strict';
import { deathNotice } from '../../src/shared/death-notice.js';
import { WEAPONS } from '../../src/gameplay/paintball/weapons.js';

test('authoritative deaths retain the fatal weapon, names and headshot rather than the current inventory', () => {
  const notice = deathNotice({ victim: 'b', source: 'a', victimKind: 'player', sourceKind: 'player', victimName: 'Joana', sourceName: 'Biel', weapon: 'pistol', cause: 'pistol', region: 'head' }, { selfId: 'b', weapons: WEAPONS });
  assert.equal(notice.source, 'Biel'); assert.equal(notice.victim, 'Joana');
  assert.equal(notice.icon, 'pistol'); assert.equal(notice.label, 'Glock-18'); assert.equal(notice.headshot, true); assert.equal(notice.local, true);
});

test('training deaths identify bots, zombies, melee and environment with the same formatter', () => {
  const context = { selfId: 'player', selfName: 'Joana', weapons: WEAPONS };
  const zombie = deathNotice({ victim: { id: 'player', kind: 'player' }, source: { id: 'z1', kind: 'zombie' }, weapon: { id: 'zombie', kind: 'melee' } }, context);
  assert.equal(zombie.source, 'Zumbi'); assert.equal(zombie.victim, 'Joana'); assert.equal(zombie.label, 'Ataque de zumbi'); assert.equal(zombie.headshot, false);
  const melee = deathNotice({ victim: { id: 'human-7', kind: 'human', role: 'enemy' }, source: { id: 'player' }, weapon: { id: 'knife', kind: 'melee' }, region: 'head' }, context);
  assert.equal(melee.victim, 'Bot 7'); assert.equal(melee.headshot, false); assert.equal(melee.icon, 'knife');
  const unknown = deathNotice({ victim: 'other', source: null });
  assert.equal(unknown.source, 'Ambiente'); assert.equal(unknown.local, false);
});
