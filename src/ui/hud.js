import { MapView } from './map-view.js';
import { pointInPolygon } from '../shared/geo.js';

// HUD: painel de localização, minimapa (norte para cima) e mapa grande clicável.

export function createHud({ groundCanvas, bounds, footprints, quarter, proj, terrain, streetAt, places, onSelect = () => {}, getMode = () => 'campaign' }) {
  const { x0, z0, width, depth } = bounds;

  // mapa base (chão + plantas + limite do bairro), ~1 px/m
  const S = 2048 / width;
  const base = document.createElement('canvas');
  base.width = 2048;
  base.height = Math.round(depth * S);
  const g = base.getContext('2d');
  g.drawImage(groundCanvas, 0, 0, base.width, base.height);
  const P = (p) => [(p[0] - x0) * S, (p[1] - z0) * S];
  const drawRings = (rings) => {
    g.beginPath();
    for (const r of rings) { r.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); }
  };
  for (const f of footprints) {
    g.fillStyle = f.procedural ? 'rgba(120,112,100,0.85)' : f.color === 'house' ? '#5d5248' : '#3b4450';
    drawRings(f.rings); g.fill('evenodd');
  }
  if (quarter) {
    g.fillStyle = 'rgba(255,201,64,0.16)';
    drawRings(quarter); g.fill('evenodd');
    g.strokeStyle = '#ffc940'; g.lineWidth = 6; g.setLineDash([16, 8]);
    g.stroke(); g.setLineDash([]);
  }

  // ---------------------------------------------------------------- DOM
  const $ = (id) => document.getElementById(id);
  const street = $('hud-street'), coords = $('hud-coords'), alt = $('hud-alt'), zone = $('hud-zone'), mode = $('hud-mode'), fpsEl = $('hud-fps');
  const mini = $('minimap'), mctx = mini.getContext('2d');
  const big = $('bigmap'), bctx = big.getContext('2d');
  const mapPanel = $('map-panel');

  const VIEW_M = 260; // metros visíveis no minimapa
  function drawMinimap(x, z, yaw) {
    const W = mini.width, H = mini.height;
    mctx.fillStyle = '#20252b';
    mctx.fillRect(0, 0, W, H);
    const sw = VIEW_M * S;
    mctx.drawImage(base, (x - x0) * S - sw / 2, (z - z0) * S - sw / 2, sw, sw, 0, 0, W, H);
    arrow(mctx, W / 2, H / 2, yaw, 9);
    mctx.fillStyle = '#fff'; mctx.font = 'bold 13px Segoe UI, sans-serif'; mctx.textAlign = 'center';
    mctx.fillText('N', W / 2, 15);
  }

  function arrow(ctx, cx, cy, yaw, r) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.4); ctx.lineTo(r, r); ctx.lineTo(0, r * 0.45); ctx.lineTo(-r, r); ctx.closePath();
    ctx.fillStyle = '#ff3b30'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();
  }

  const view = new MapView(bounds);
  const campusRegion = quarter ? (() => {
    const xs = quarter[0].map(p => p[0]), zs = quarter[0].map(p => p[1]);
    return { x0: Math.min(...xs), z0: Math.min(...zs), width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
  })() : bounds;
  let lastState = { x: 0, z: 0, yaw: 0 }, dirty = true, initialized = false;
  const sizeMap = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = big.clientWidth, H = big.clientHeight;
    if (!W || !H) return false;
    if (big.width !== Math.round(W * dpr) || big.height !== Math.round(H * dpr)) {
      big.width = Math.round(W * dpr); big.height = Math.round(H * dpr);
      view.resize(W, H); dirty = true;
    }
    if (!initialized) { view.fit(campusRegion); initialized = true; }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  };
  function drawBigMap(x = lastState.x, z = lastState.z, yaw = lastState.yaw) {
    lastState = { x, z, yaw };
    if (!sizeMap()) return;
    const W = view.width, H = view.height;
    bctx.fillStyle = '#111d27'; bctx.fillRect(0, 0, W, H);
    const [ox, oy] = view.toScreen(x0, z0), scale = view.scale;
    bctx.drawImage(base, ox, oy, width * scale, depth * scale);
    const tour = getMode() === 'tour';
    for (const p of places) {
      const [sx, sy] = view.toScreen(p.x, p.z);
      if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
      bctx.fillStyle = '#ffc940'; bctx.strokeStyle = '#14232d'; bctx.lineWidth = 2;
      bctx.beginPath(); bctx.arc(sx, sy, 13, 0, Math.PI * 2); bctx.fill(); bctx.stroke();
      bctx.font = 'bold 10px Segoe UI, sans-serif'; bctx.textAlign = 'center'; bctx.fillStyle = '#15222a';
      bctx.fillText(p.number, sx, sy + 3.5);
      if (view.zoom > 5) {
        bctx.textAlign = 'left'; bctx.font = '11px Segoe UI, sans-serif'; bctx.lineWidth = 3;
        bctx.strokeText(p.name, sx + 17, sy + 4); bctx.fillStyle = '#fff'; bctx.fillText(p.name, sx + 17, sy + 4);
      }
    }
    const [px, py] = view.toScreen(x, z);
    if (!tour) arrow(bctx, px, py, yaw, 9);
    else { bctx.strokeStyle = '#fff'; bctx.lineWidth = 2; bctx.beginPath(); bctx.arc(px, py, 5, 0, Math.PI * 2); bctx.stroke(); }
    bctx.textAlign = 'left'; bctx.font = 'bold 12px Segoe UI, sans-serif'; bctx.fillStyle = '#fff'; bctx.fillText('N ↑', 12, 22);
    // A physical scale bar stays meaningful at every zoom level.
    const metres = view.zoom < 3 ? 200 : view.zoom < 8 ? 100 : 25;
    bctx.fillRect(12, H - 22, metres * scale, 2); bctx.font = '10px Segoe UI, sans-serif'; bctx.fillText(`${metres} m`, 12, H - 29);
    dirty = false;
  }

  function bigMapToWorld(clientX, clientY) {
    const r = big.getBoundingClientRect();
    const [wx, wz] = view.toWorld(clientX - r.left, clientY - r.top);
    if (wx < x0 || wz < z0 || wx > x0 + width || wz > z0 + depth) return null;
    return [wx, wz];
  }
  function pointAt(sx, sy) {
    let nearest = null, distance = 23;
    for (const p of places) {
      const [px, py] = view.toScreen(p.x, p.z), d = Math.hypot(sx - px, sy - py);
      if (d < distance) { nearest = p; distance = d; }
    }
    return nearest;
  }
  const pointers = new Map();
  let dragged = false, pinchDistance = 0, start = null;
  const local = e => { const r = big.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  big.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = local(e);
    if (!pointers.size) { dragged = false; start = p; }
    pointers.set(e.pointerId, p); big.setPointerCapture(e.pointerId);
    if (pointers.size === 2) { dragged = true; const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  big.addEventListener('pointermove', e => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const oldPoints = [...pointers.values()], current = local(e); pointers.set(e.pointerId, current);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      view.pan(cx - (oldPoints[0].x + oldPoints[1].x) / 2, cy - (oldPoints[0].y + oldPoints[1].y) / 2);
      if (pinchDistance > 0) view.zoomAt(distance / pinchDistance, cx, cy);
      pinchDistance = distance;
    } else {
      if (Math.hypot(current.x - start.x, current.y - start.y) > 6) dragged = true;
      if (dragged) view.pan(current.x - previous.x, current.y - previous.y);
    }
    dirty = true; drawBigMap();
  });
  big.addEventListener('pointerup', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!dragged && !pointers.size) {
      const p = local(e), point = pointAt(p.x, p.y), world = bigMapToWorld(e.clientX, e.clientY);
      if (point || world) onSelect(point, world);
    }
    if (pointers.size === 1) start = [...pointers.values()][0];
  });
  const cancelGesture = () => { pointers.clear(); dragged = true; pinchDistance = 0; };
  big.addEventListener('pointercancel', cancelGesture);
  window.addEventListener('blur', cancelGesture);
  big.addEventListener('wheel', e => {
    e.preventDefault(); const p = local(e);
    view.zoomAt(Math.exp(-e.deltaY * .0015), p.x, p.y); dirty = true; drawBigMap();
  }, { passive: false });
  $('map-zoom-in').addEventListener('click', () => { view.zoomAt(1.4); drawBigMap(); });
  $('map-zoom-out').addEventListener('click', () => { view.zoomAt(1 / 1.4); drawBigMap(); });
  $('map-reset').addEventListener('click', () => { view.fit(campusRegion); drawBigMap(); });
  addEventListener('resize', () => { dirty = true; });

  let lastText = 0, lastMap = -1, frames = 0, fpsT = 0;
  function update(t, dt, feet, yaw, fly) {
    frames++; fpsT += dt;
    if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
    if (t - lastMap >= .1 || (dirty && mapPanel.classList.contains('open'))) {
      drawMinimap(feet.x, feet.z, yaw);
      if (mapPanel.classList.contains('open')) drawBigMap(feet.x, feet.z, yaw);
      lastMap = t;
    }
    if (t - lastText < 0.15) return;
    lastText = t;
    const [lon, lat] = proj.toLonLat(feet.x, feet.z);
    const s = streetAt(feet.x, feet.z);
    street.textContent = s ? s.name : '—';
    coords.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    alt.textContent = `${(terrain.heightAt(feet.x, feet.z) + terrain.base).toFixed(0)} m`;
    const inside = quarter && pointInPolygon(feet.x, feet.z, quarter);
    zone.textContent = inside ? 'Dentro da Cidade de Deus' : 'Entorno · Osasco/SP';
    zone.classList.toggle('inside', !!inside);
    mode.textContent = getMode() === 'tour' ? 'TOUR' : fly ? 'VOO LIVRE' : 'A PÉ';
  }

  return { update, bigMapToWorld, view, drawBigMap, pointAt };
}
