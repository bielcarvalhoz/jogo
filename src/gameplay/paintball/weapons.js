// Valve's shipped CS2 weapons.vdata is the source for base firearm damage,
// primary cycle time and pellet count. See docs/weapons.md for the snapshot.
const firearm = (id, label, damage, interval, automatic, extra = {}) => Object.freeze({
  id, label, icon: id, kind: 'firearm', damage, interval, automatic,
  pellets: 1, spread: 0, range: 180, speed: 80, impulse: damage * .09,
  aimFov: 45, recoilStrength: 1, recoilDecay: 16,
  magazineSize: 30, reserveAmmo: 90, reloadDuration: 2.3, ...extra,
});
const melee = (id, label, damage, interval, range, extra = {}) => Object.freeze({
  id, label, icon: id.startsWith('knife') ? 'knife' : id,
  kind: 'melee', damage, interval, range, automatic: true, impulse: damage * .16, ...extra,
});

export const WEAPONS = Object.freeze([
  firearm('pistol', 'Glock-18', 30, .15, false, { magazineSize: 20, reserveAmmo: 120, reloadDuration: 2.2, speed: 34, csWeapon: 'weapon_glock', spread: .002 }),
  firearm('automatic', 'M4A4', 33, .09, true, { speed: 90, csWeapon: 'weapon_m4a1', spread: .0006 }),
  firearm('revolver', 'R8 Revolver', 86, .5, true, { magazineSize: 8, reserveAmmo: 32, reloadDuration: 2.7, csWeapon: 'weapon_revolver', spread: .00052, windup: .2 }),
  firearm('shotgun', 'Nova', 26, .88, false, { magazineSize: 8, reserveAmmo: 32, reloadDuration: .6, reloadStyle: 'shell', csWeapon: 'weapon_nova', pellets: 9, spread: .04, speed: 70, range: 70, impulse: 2.4, recoilStrength: 2.8, recoilDecay: 10 }),
  firearm('sniper', 'AWP', 115, 1.455, false, { magazineSize: 5, reserveAmmo: 30, reloadDuration: 3.2, csWeapon: 'weapon_awp', spread: .0002, hipSpread: .0808, speed: 150, range: 300, aimFov: 40 }),
  firearm('smg', 'MP5-SD', 28, .08, true, { csWeapon: 'weapon_mp5sd', spread: .0006, speed: 80 }),
  melee('knife', 'Faca', 40, .65, 1.65),
  melee('knife-tactical', 'Faca tática', 40, .65, 1.65),
  melee('knife-combat', 'Faca de combate', 40, .65, 1.65),
  melee('axe', 'Machado', 65, .85, 1.95),
  melee('bat', 'Bastão com arame', 45, .72, 2.05),
  Object.freeze({ id: 'fists', label: 'Soco', icon: 'fists', kind: 'unarmed', damage: 15, interval: .42, range: 1.4, impulse: 3, automatic: true }),
]);

export const WEAPON_BY_ID = Object.freeze(Object.fromEntries(WEAPONS.map(weapon => [weapon.id, weapon])));

/** Two firearm slots, one melee slot, and an always available unarmed option. */
export function createWeaponInventory() {
  const slots = ['automatic', 'pistol', 'knife'];
  let selected = 'pistol', lastFirearmSlot = 1;
  return {
    get state() { return { slots: [...slots], selected, lastFirearmSlot }; },
    get available() { return [...slots.map(id => WEAPON_BY_ID[id]), WEAPON_BY_ID.fists]; },
    select(id) {
      if (id !== 'fists' && !slots.includes(id)) throw new RangeError('Arma não equipada');
      selected = id;
      const slot = slots.indexOf(id); if (slot >= 0 && slot < 2) lastFirearmSlot = slot;
      return WEAPON_BY_ID[id];
    },
    pickup(id) {
      const weapon = WEAPON_BY_ID[id];
      if (!weapon || weapon.kind === 'unarmed') throw new RangeError('Arma inválida');
      if (slots.includes(id)) return { picked: id, dropped: null, slot: slots.indexOf(id), duplicate: true };
      const currentSlot = slots.indexOf(selected);
      const slot = weapon.kind === 'melee' ? 2 : currentSlot >= 0 && currentSlot < 2 ? currentSlot : lastFirearmSlot;
      const dropped = slots[slot]; slots[slot] = id; this.select(id);
      return { picked: id, dropped, slot };
    },
  };
}
