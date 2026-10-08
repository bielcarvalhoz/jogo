// Física compartilhada: o mapa e o campus REGISTRAM obstáculos e superfícies; o personagem
// só CONSULTA. Assim quem mexe no personagem não precisa saber de onde vem cada colisão.
export function createPhysics() {
  const colliders = [], surfaces = [], roofs = [];
  return {
    /** source.collide(x, z, raio, alturaDosPés) -> [x, z] empurrado para fora */
    addCollider(source, enabled = () => true) { colliders.push({ source, enabled }); },
    /** fn(x, z, alturaMaxima) -> altura de piso extra (pontes, calçadas, rampas) ou -Infinity */
    addSurface(fn) { surfaces.push(fn); },
    /** fn(x, z, alturaDosPés) -> altura do telhado pisável abaixo dos pés ou -Infinity */
    addRoof(fn, enabled = () => true) { roofs.push({ fn, enabled }); },

    collide(x, z, r, feetY) {
      for (const c of colliders) if (c.enabled()) [x, z] = c.source.collide(x, z, r, feetY);
      return [x, z];
    },
    surfaceHeightAt(x, z, maxY) {
      let h = -Infinity;
      for (const fn of surfaces) { const v = fn(x, z, maxY); if (v > h) h = v; }
      return h;
    },
    roofAt(x, z, y) {
      let h = -Infinity;
      for (const r of roofs) if (r.enabled()) { const v = r.fn(x, z, y); if (v > h) h = v; }
      return h;
    },
  };
}
