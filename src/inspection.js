import { ringCentroid } from './geo.js';

// Loaded only by Vite development builds. Stable camera views and DOM diagnostics
// let browser checks inspect the actual scene without changing gameplay controls.
export function inspectScene(app, view) {
  const { campus, campusData: C, camera, terrain, renderer, scene, world, roads, grading } = app;
  if (!C) return;
  app.player.stop();
  const ids = { azul: 'b17', amarelo: 'b21', cinza: 'b1', prata: 'b6', vermelho: 'b3', rubi: 'b5', cti: 'b0', conviver: 'm0' };
  const b = ids[view] ? C.buildings.find(b => b.planId === ids[view]) : null;
  if (b) {
    const entry = campus.details.entrances.find(e => e.name === b.name);
    const [cx, cz] = ringCentroid(b.rings[0]);
    if (entry) {
      const e = entry.frontage, setback = view === 'azul' ? 38 : Math.min(27, e.clearance + e.road.w + 5);
      camera.position.set(e.x + e.nx * setback + e.dx * 10, terrain.heightAt(e.x, e.z) + 3.8, e.z + e.nz * setback + e.dz * 10);
      camera.lookAt(e.x, terrain.heightAt(e.x, e.z) + (view === 'azul' ? 12 : 6), e.z);
    } else {
      camera.position.set(cx + 45, terrain.heightAt(cx, cz) + 13, cz + 50);
      camera.lookAt(cx, terrain.heightAt(cx, cz) + b.height * .4, cz);
    }
  } else if (view === 'campo' && C.track) {
    const T = C.track;
    camera.position.set(T.cx + 100, terrain.heightAt(T.cx, T.cz) + 92, T.cz + 120);
    camera.lookAt(T.cx, terrain.heightAt(T.cx, T.cz), T.cz);
  } else if (view === 'lago') {
    const lake = world.areas.find(a => a.id === 'cdd/lago');
    const [x, z] = ringCentroid(lake.rings[0]);
    camera.position.set(x + 54, terrain.heightAt(x + 54, z) + 12, z + 20);
    camera.lookAt(x, lake.waterLevel, z);
  }
  document.getElementById('overlay').classList.add('hidden');
  for (const child of document.getElementById('hud').children) {
    if (!child.classList.contains('attrib')) child.style.display = 'none';
  }
  renderer.render(scene, camera);
  const fieldHeights = [];
  if (C.track) for (let a = -25; a <= 25; a += 5) for (let b = -15; b <= 15; b += 5) {
    const T = C.track;
    fieldHeights.push(terrain.heightAt(T.cx + T.ux * a - T.uz * b, T.cz + T.uz * a + T.ux * b));
  }
  const meshes = []; scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const details = campus.details;
  const report = {
    view, signs: details.root.userData.signs, entrances: details.entrances.map(e => e.name),
    sidewalks: roads.sidewalkStats, internalRoads: world.roads.filter(r => r.internal && !r.bridge && r.kind !== 'foot').length,
    streetTrees: C.streetTreeCount, trees: C.trees.length,
    fountain: !!scene.getObjectByName('chafariz-predio-azul'),
    fieldRelief: Math.max(...fieldHeights) - Math.min(...fieldHeights), grading,
    nonFiniteGeometry: meshes.filter(o => [...o.geometry.attributes.position.array].some(v => !Number.isFinite(v))).map(o => o.name),
    shaderFailures: renderer.info.programs.filter(p => p.diagnostics?.runnable === false).map(p => p.name),
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    camera: camera.position.toArray(),
    treeTrunks: meshes.filter(o => o.name === 'troncos').reduce((n, o) => n + o.count, 0),
    grassChunks: meshes.filter(o => o.name === 'grama-com-vento').length,
  };
  const output = document.createElement('output'); output.id = 'scene-inspection'; output.hidden = true;
  output.textContent = JSON.stringify(report); document.body.appendChild(output);
  console.info('Scene inspection ready', JSON.stringify({ view, signs: report.signs.length, streetTrees: report.streetTrees, calls: report.calls, triangles: report.triangles, fieldRelief: report.fieldRelief, fountain: report.fountain, shaderFailures: report.shaderFailures }));
}
