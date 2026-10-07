import { pointInPolygon } from './geo.js';

// HUD: painel de localização, minimapa (norte para cima) e mapa grande clicável.

export function createHud({ groundCanvas, bounds, footprints, quarter, proj, terrain, streetAt, places }) {
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

  let bigScale = 1, bigOX = 0, bigOY = 0;
  function drawBigMap(x, z, yaw) {
    const W = (big.width = big.clientWidth * devicePixelRatio), H = (big.height = big.clientHeight * devicePixelRatio);
    bctx.fillStyle = '#15191e'; bctx.fillRect(0, 0, W, H);
    bigScale = Math.min(W / base.width, H / base.height);
    bigOX = (W - base.width * bigScale) / 2; bigOY = (H - base.height * bigScale) / 2;
    bctx.drawImage(base, bigOX, bigOY, base.width * bigScale, base.height * bigScale);
    const toScreen = (wx, wz) => [bigOX + (wx - x0) * S * bigScale, bigOY + (wz - z0) * S * bigScale];
    bctx.font = `${Math.round(13 * devicePixelRatio)}px Segoe UI, sans-serif`;
    bctx.textAlign = 'left';
    places.forEach((p, i) => {
      const [sx, sy] = toScreen(p.x, p.z);
      bctx.fillStyle = '#ffc940'; bctx.beginPath(); bctx.arc(sx, sy, 6 * devicePixelRatio, 0, Math.PI * 2); bctx.fill();
      bctx.fillStyle = '#fff'; bctx.strokeStyle = 'rgba(0,0,0,0.8)'; bctx.lineWidth = 3;
      const label = `${i + 1}. ${p.name}`;
      bctx.strokeText(label, sx + 10 * devicePixelRatio, sy + 4 * devicePixelRatio);
      bctx.fillText(label, sx + 10 * devicePixelRatio, sy + 4 * devicePixelRatio);
    });
    const [px, py] = toScreen(x, z);
    arrow(bctx, px, py, yaw, 10 * devicePixelRatio);
  }

  /** converte clique no mapa grande em coordenadas do mundo */
  function bigMapToWorld(clientX, clientY) {
    const r = big.getBoundingClientRect();
    const sx = (clientX - r.left) * devicePixelRatio, sy = (clientY - r.top) * devicePixelRatio;
    const wx = (sx - bigOX) / bigScale / S + x0, wz = (sy - bigOY) / bigScale / S + z0;
    if (wx < x0 || wz < z0 || wx > x0 + width || wz > z0 + depth) return null;
    return [wx, wz];
  }

  let lastText = 0, frames = 0, fpsT = 0;
  function update(t, dt, feet, yaw, fly) {
    frames++; fpsT += dt;
    if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
    drawMinimap(feet.x, feet.z, yaw);
    if (mapPanel.classList.contains('open')) drawBigMap(feet.x, feet.z, yaw);
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
    mode.textContent = fly ? 'VOO LIVRE' : 'A PÉ';
  }

  return { update, bigMapToWorld };
}
