export const CRATE_TYPES = Object.freeze({
  wood: { half: .6, mass: 6, friction: .45 },
  metal: { half: .8, mass: 72, friction: .8 },
  metalStep: { half: .4, mass: 18, friction: .8 },
});
export const cratePosition = (type, center) => type === 'metal' ? { x: center.x + 5.6, z: center.z - 1 }
  : type === 'metalStep' ? { x: center.x + 4.2, z: center.z - 1 } : { ...center };
export const AMMO_RESPAWN_SECONDS = 15;
export const ammoPosition = center => ({ x: center.x + 1.6, z: center.z + 2 });
