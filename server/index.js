import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Server } from 'socket.io';
import { attachHub } from './hub.js';
import { loadServerWorld } from './world.js';
import { NET } from '../src/shared/multiplayer.js';

export function originAllowed(origin, configured = process.env.CLIENT_ORIGINS || '') {
  if (!origin) return true;
  if (configured.split(',').map(s => s.trim()).includes(origin)) return true;
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.vercel.app')); } catch { return false; }
}

export async function createMultiplayerServer({ world, ...hubOptions } = {}) {
  world ||= await loadServerWorld();
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  let loopLag = { p95Ms: 0, maxMs: 0 };
  const sampleLoop = setInterval(() => {
    loopLag = { p95Ms: Math.round(Math.max(0, loop.percentile(95) / 1e6 - 20) * 10) / 10,
      maxMs: Math.round(Math.max(0, loop.max / 1e6 - 20) * 10) / 10 };
    loop.reset();
  }, 5000); sampleLoop.unref();
  let hub;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && ['/', '/health'].includes(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, game: 'jogo-do-biel', protocol: NET.protocol, rooms: hub.rooms.size, maxPlayers: NET.maxPlayers,
        netcode: 1, tickHz: NET.tickHz, snapshotHz: NET.snapshotHz, maxRewindMs: NET.maxRewind * 1000,
        uptimeSeconds: Math.floor(process.uptime()), build: process.env.RENDER_GIT_COMMIT?.slice(0, 12) || null,
        region: process.env.RENDER_REGION || null, loopLag })); return;
    }
    res.writeHead(404); res.end('Not found');
  });
  const io = new Server(server, { maxHttpBufferSize: 65536, pingInterval: 20000, pingTimeout: 20000,
    cors: { origin: (origin, cb) => cb(null, originAllowed(origin)), methods: ['GET', 'POST'] },
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
  });
  hub = attachHub(io, world, hubOptions);
  return { server, io, hub, world, async close() { clearInterval(sampleLoop); loop.disable(); hub.close(); await new Promise(resolve => io.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createMultiplayerServer();
  const port = Number(process.env.PORT || 3001);
  app.server.listen(port, '0.0.0.0', () => console.log(`[jogo-server] listening on :${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
