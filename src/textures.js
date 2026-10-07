import * as THREE from 'three';
import { mulberry32 } from './rng.js';

// Texturas 100% procedurais (canvas) — nenhum asset externo.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function noise(ctx, w, h, amount, seed = 1) {
  const rnd = mulberry32(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(c, renderer, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ ruas
// u (0..1) = atravessa a pista; v = ao longo, 1 repetição = 12 m
export const ROAD_TILE_M = 12;

export function roadTexture(renderer, kind, lanes = 2) {
  const W = 256, Hh = 512;
  const c = canvas(W, Hh), g = c.getContext('2d');
  const asphalt = kind === 'service' ? '#55575a' : '#4a4c50';
  g.fillStyle = asphalt;
  g.fillRect(0, 0, W, Hh);
  noise(g, W, Hh, 26, 7 + lanes);
  // remendos de asfalto
  const rnd = mulberry32(99 + lanes);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(${30 + rnd() * 30},${30 + rnd() * 30},${34 + rnd() * 30},0.25)`;
    g.fillRect(rnd() * W, rnd() * Hh, 20 + rnd() * 60, 20 + rnd() * 90);
  }
  const white = '#e8e8e2', yellow = '#e7b416';
  const edge = (x) => { g.fillStyle = white; g.fillRect(x, 0, 5, Hh); };
  const dashed = (x, color) => { g.fillStyle = color; for (let y = 0; y < Hh; y += 128) g.fillRect(x - 3, y, 6, 64); };

  if (kind === 'twoway') {
    edge(8); edge(W - 13);
    g.fillStyle = yellow;
    g.fillRect(W / 2 - 9, 0, 6, Hh);
    g.fillRect(W / 2 + 3, 0, 6, Hh);
    if (lanes >= 4) { dashed(W * 0.25, white); dashed(W * 0.75, white); }
  } else if (kind === 'oneway') {
    edge(8); edge(W - 13);
    for (let l = 1; l < lanes; l++) dashed((W * l) / lanes, white);
  } else if (kind === 'local') {
    // rua de bairro: linha amarela tracejada no meio, sem bordas
    dashed(W / 2, yellow);
  }
  return toTexture(c, renderer);
}

export function pavementTexture(renderer) {
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#b9b4a8';
  g.fillRect(0, 0, S, S);
  noise(g, S, S, 22, 3);
  g.strokeStyle = 'rgba(90,85,78,0.45)';
  g.lineWidth = 2;
  for (let i = 0; i <= S; i += 64) {
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
  }
  return toTexture(c, renderer);
}

// ------------------------------------------------------------------ fachadas
// A cor da parede vem da cor de vértice (multiplicada); a textura é clara.
// u: 1 repetição = 1 vão de janela; v: 1 repetição = 1 andar

export function facadeTexture(renderer, style) {
  const W = 128, Hh = 128;
  const c = canvas(W, Hh), g = c.getContext('2d');
  g.fillStyle = '#f2f0ea';
  g.fillRect(0, 0, W, Hh);
  noise(g, W, Hh, 14, style.length);

  if (style === 'tower') {
    // prédio residencial: janela + faixa de laje
    g.fillStyle = '#d8d4cc'; g.fillRect(0, Hh - 14, W, 14);
    g.fillStyle = '#8a8f96'; g.fillRect(22, 26, 84, 70);
    g.fillStyle = '#2d3b4a'; g.fillRect(26, 30, 76, 62);
    g.fillStyle = 'rgba(160,190,220,0.35)'; g.fillRect(26, 30, 36, 62);
    g.fillStyle = '#8a8f96'; g.fillRect(62, 30, 4, 62);
  } else if (style === 'glass') {
    // comercial / escritório: pele de vidro
    g.fillStyle = '#2f4658'; g.fillRect(0, 0, W, Hh);
    const gr = g.createLinearGradient(0, 0, W, Hh);
    gr.addColorStop(0, 'rgba(170,200,225,0.45)'); gr.addColorStop(1, 'rgba(40,60,80,0.1)');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#9aa3aa'; g.fillRect(0, 0, W, 6); g.fillRect(0, Hh - 18, W, 18); g.fillRect(0, 0, 4, Hh);
  } else {
    // casa: janela com grade (bem brasileiro) a cada vão
    g.fillStyle = '#6b5a48'; g.fillRect(34, 34, 60, 50);
    g.fillStyle = '#34404c'; g.fillRect(38, 38, 52, 42);
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 2;
    for (let x = 44; x < 90; x += 8) { g.beginPath(); g.moveTo(x, 38); g.lineTo(x, 80); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, Hh - 10, W, 10);
  }
  return toTexture(c, renderer);
}

export function roofTexture(renderer, kind) {
  const S = 128;
  const c = canvas(S, S), g = c.getContext('2d');
  if (kind === 'tile') {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y + 13, S, 3);
      for (let x = (y / 16) % 2 ? 8 : 0; x < S; x += 16) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y, 2, 16); }
    }
  } else {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  }
  noise(g, S, S, 30, kind === 'tile' ? 5 : 6);
  return toTexture(c, renderer);
}

// ------------------------------------------------------------------ rótulos
export function labelTexture(text, sub, color = '#ffd34d') {
  const pad = 18;
  const g0 = canvas(8, 8).getContext('2d');
  g0.font = 'bold 34px Segoe UI, Arial, sans-serif';
  const w1 = g0.measureText(text).width;
  g0.font = '24px Segoe UI, Arial, sans-serif';
  const w2 = sub ? g0.measureText(sub).width : 0;
  const W = Math.ceil(Math.max(w1, w2) + pad * 2), Hh = sub ? 92 : 60;
  const c = canvas(W, Hh), g = c.getContext('2d');
  g.fillStyle = 'rgba(12,16,22,0.78)';
  const r = 14;
  g.beginPath();
  g.roundRect(0, 0, W, Hh, r);
  g.fill();
  g.fillStyle = color;
  g.fillRect(0, 0, 6, Hh);
  g.font = 'bold 34px Segoe UI, Arial, sans-serif';
  g.fillStyle = '#ffffff';
  g.textBaseline = 'top';
  g.fillText(text, pad, 10);
  if (sub) {
    g.font = '24px Segoe UI, Arial, sans-serif';
    g.fillStyle = '#c9d2dc';
    g.fillText(sub, pad, 54);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, width: W, height: Hh };
}

// ------------------------------------------------------------------ estilo pixel (campus)
// Texturas minúsculas com filtro "nearest": de perto viram pixel art; de longe, mipmaps.

function pixelTexture(c, renderer, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
};

/** um vão de fachada (1 janela por andar) em 16x16 px; a cor da parede vem da cor de vértice */
export function pixelFacade(renderer, windowColor = '#2b3f55', kind = 'office') {
  const c = canvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 14, 16, 2); // laje
  if (kind === 'school') {
    g.fillStyle = '#8a6a4a'; g.fillRect(4, 4, 8, 7);
    g.fillStyle = windowColor; g.fillRect(5, 5, 6, 5);
    g.fillStyle = '#ffffff'; g.fillRect(7, 5, 1, 5);
  } else {
    g.fillStyle = shade(windowColor, 0.7); g.fillRect(1, 3, 14, 9);
    g.fillStyle = windowColor; g.fillRect(2, 4, 12, 7);
    g.fillStyle = shade(windowColor, 1.9); g.fillRect(2, 4, 4, 1); g.fillRect(2, 5, 1, 2); // brilho
    g.fillStyle = shade(windowColor, 0.7); g.fillRect(8, 4, 1, 7); // caixilho
  }
  return pixelTexture(c, renderer);
}

export function pixelRoof(renderer, kind = 'flat') {
  const c = canvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
  const rnd = mulberry32(kind.length * 7);
  if (kind === 'tile') {
    for (let y = 0; y < 16; y += 4) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y + 3, 16, 1);
      for (let x = (y / 4) % 2 ? 2 : 0; x < 16; x += 4) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y, 1, 3); }
    }
  } else {
    for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.06})`; g.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1); }
  }
  return pixelTexture(c, renderer);
}

export function helipadTexture(renderer) {
  const S = 32;
  const c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#2f5f9e'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#ffffff';
  // círculo pixelado
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d > 12 && d < 14.5) g.fillRect(x, y, 1, 1);
    }
  g.fillRect(10, 8, 3, 16); g.fillRect(19, 8, 3, 16); g.fillRect(13, 14, 6, 3); // H
  return pixelTexture(c, renderer, false);
}

export function stripeTexture(renderer, a = '#c8102e', b = '#ffffff') {
  const c = canvas(8, 2), g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 4, 2);
  g.fillStyle = b; g.fillRect(4, 0, 4, 2);
  return pixelTexture(c, renderer);
}

/** placa pixelada (fonte desenhada em baixa resolução e ampliada sem suavizar) */
export function pixelSign(renderer, text, bg = '#c8102e', fg = '#ffffff') {
  const g0 = canvas(8, 8).getContext('2d');
  g0.font = 'bold 10px monospace';
  const w = Math.ceil(g0.measureText(text).width) + 8;
  const c = canvas(w, 14), g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = bg; g.fillRect(0, 0, w, 14);
  g.fillStyle = fg; g.font = 'bold 10px monospace'; g.textBaseline = 'middle';
  g.fillText(text, 4, 7.5);
  // binariza (sem anti-aliasing) para ficar "pixel": cada pixel vira fg ou bg
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const F = rgb(fg), B = rgb(bg);
  const img = g.getImageData(0, 0, w, 14), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const df = (d[i] - F[0]) ** 2 + (d[i + 1] - F[1]) ** 2 + (d[i + 2] - F[2]) ** 2;
    const db = (d[i] - B[0]) ** 2 + (d[i + 1] - B[1]) ** 2 + (d[i + 2] - B[2]) ** 2;
    const C = df < db ? F : B;
    d[i] = C[0]; d[i + 1] = C[1]; d[i + 2] = C[2]; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { texture: pixelTexture(c, renderer, false), aspect: w / 14 };
}
