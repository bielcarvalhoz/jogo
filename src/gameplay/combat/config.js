export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ label: 'Fácil', reaction: .85, interval: .95, spread: .11, vision: 24, speed: 2, headChance: 0 }),
  normal: Object.freeze({ label: 'Normal', reaction: .45, interval: .6, spread: .055, vision: 32, speed: 2.7, headChance: .08 }),
  hard: Object.freeze({ label: 'Difícil', reaction: .2, interval: .34, spread: .018, vision: 44, speed: 3.3, headChance: .22 }),
});

// Training starts with predictable shot counts. Weapon mode uses the existing
// firearm catalogue; neither mode changes crate impulses or their damage.
export const DEFAULT_COMBAT_RULES = Object.freeze({
  damageMode: 'training', friendlyFire: false, playerDamage: true, maxActors: 32,
  human: Object.freeze({ health: 100, magazineSize: 30, reloadDuration: 2.3 }),
  zombie: Object.freeze({ health: 200, speed: 1.8, damage: 20, interval: 1.1 }),
  objective: Object.freeze({ health: 500 }),
  firearm: Object.freeze({ head: 100, thorax: 50, limb: 25 }),
  multipliers: Object.freeze({ head: 4, thorax: 1, limb: .75 }),
  lethalHeadshots: true, corpseSeconds: 5, respawnSeconds: 3, spawnProtection: 2,
});

export function combatRules(overrides = {}) {
  const rules = { ...DEFAULT_COMBAT_RULES, ...overrides };
  for (const key of ['human', 'zombie', 'objective', 'firearm', 'multipliers']) {
    rules[key] = { ...DEFAULT_COMBAT_RULES[key], ...overrides[key] };
  }
  if (!['training', 'weapon'].includes(rules.damageMode)) throw new RangeError('Modo de dano inválido');
  for (const kind of ['human', 'zombie', 'objective']) {
    if (!(Number.isFinite(rules[kind].health) && rules[kind].health > 0)) throw new RangeError('Vida inválida');
  }
  for (const group of ['firearm', 'multipliers']) for (const region of ['head', 'thorax', 'limb']) {
    if (!Number.isFinite(rules[group][region]) || rules[group][region] < 0) throw new RangeError('Dano inválido');
  }
  if (!Number.isInteger(rules.maxActors) || rules.maxActors < 1) throw new RangeError('Limite de personagens inválido');
  if (!Number.isInteger(rules.human.magazineSize) || rules.human.magazineSize < 1 || !Number.isFinite(rules.human.reloadDuration) || rules.human.reloadDuration <= 0) throw new RangeError('Recarga de humano inválida');
  for (const key of ['corpseSeconds', 'respawnSeconds', 'spawnProtection']) if (!Number.isFinite(rules[key]) || rules[key] < 0) throw new RangeError('Tempo de combate inválido');
  if (!Number.isFinite(rules.zombie.speed) || rules.zombie.speed < 0 || !Number.isFinite(rules.zombie.damage) || rules.zombie.damage < 0 || !Number.isFinite(rules.zombie.interval) || !(rules.zombie.interval > 0)) throw new RangeError('Configuração de zumbi inválida');
  return rules;
}

export function damageForHit(rules, victim, region, weapon = {}) {
  if (!['head', 'thorax', 'limb'].includes(region)) return 0;
  if (weapon.kind === 'firearm') {
    if (region === 'head' && rules.lethalHeadshots && victim.kind !== 'objective') return victim.health.max;
    const amount = rules.damageMode === 'training'
      ? rules.firearm[region] / Math.max(1, weapon.pellets || 1)
      : (weapon.damage || 0) * rules.multipliers[region];
    return Math.max(0, amount);
  }
  return Math.max(0, Number.isFinite(weapon.damage) ? weapon.damage : 0);
}
