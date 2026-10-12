import { WEAPON_BY_ID, WEAPONS } from './weapons.js';

/** Shared by client prediction and the room authority. One round per shot,
 * including a shotgun shell; changing equipment never refills a magazine. */
export function createAmmoStore() {
  const rounds = new Map();
  let loading = null;
  function reset() {
    rounds.clear(); loading = null;
    for (const w of WEAPONS) if (w.kind === 'firearm') rounds.set(w.id, { loaded: w.magazineSize, reserve: w.reserveAmmo });
  }
  function cancel() { loading = null; }
  function state(id) {
    const w = WEAPON_BY_ID[id], ammo = rounds.get(id);
    if (!ammo) return null;
    const active = loading?.id === id ? loading : null;
    return { ...ammo, capacity: w.magazineSize, reloading: !!active,
      progress: active ? Math.min(1, active.elapsed / active.duration) : 0,
      remaining: active ? Math.max(0, active.duration - active.elapsed) : 0 };
  }
  function reload(id) {
    const w = WEAPON_BY_ID[id], ammo = rounds.get(id);
    if (!ammo || loading || ammo.loaded >= w.magazineSize || ammo.reserve <= 0) return false;
    const count = Math.min(w.magazineSize - ammo.loaded, ammo.reserve);
    loading = { id, elapsed: 0, inserted: 0, duration: w.reloadDuration * (w.reloadStyle === 'shell' ? count : 1) };
    return true;
  }
  function consume(id) {
    const w = WEAPON_BY_ID[id], ammo = rounds.get(id);
    if (!ammo || ammo.loaded <= 0) return false;
    if (loading) {
      if (loading.id !== id || w.reloadStyle !== 'shell') return false;
      cancel(); // Nova can interrupt between shells to shoot.
    }
    ammo.loaded--; return true;
  }
  function update(dt) {
    if (!loading || !Number.isFinite(dt) || dt <= 0) return;
    const w = WEAPON_BY_ID[loading.id], ammo = rounds.get(loading.id);
    loading.elapsed = Math.min(loading.duration, loading.elapsed + dt);
    if (w.reloadStyle === 'shell') {
      const inserted = Math.floor((loading.elapsed + 1e-8) / w.reloadDuration);
      const count = Math.min(inserted - loading.inserted, w.magazineSize - ammo.loaded, ammo.reserve);
      ammo.loaded += count; ammo.reserve -= count; loading.inserted += count;
    } else if (loading.elapsed >= loading.duration) {
      const count = Math.min(w.magazineSize - ammo.loaded, ammo.reserve);
      ammo.loaded += count; ammo.reserve -= count;
    }
    if (loading.elapsed >= loading.duration) cancel();
  }
  reset();
  function refill() {
    let gained = 0;
    for (const [id, ammo] of rounds) {
      const w = WEAPON_BY_ID[id], count = Math.max(0, Math.min(w.magazineSize * 2, w.reserveAmmo * 2 - ammo.reserve));
      ammo.reserve += count; gained += count;
    }
    return gained;
  }
  return { state, reload, consume, update, cancel, reset, refill };
}
