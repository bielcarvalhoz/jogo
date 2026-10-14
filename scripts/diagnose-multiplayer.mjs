import fs from 'node:fs/promises';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { EV, NET } from '../src/shared/multiplayer.js';

const args = process.argv.slice(2), endpoint = args.find(a => !a.startsWith('--')) || process.env.MP_SERVER_URL;
if (!endpoint) { console.error('Uso: npm run diagnose:multiplayer -- https://SERVIDOR.onrender.com --duration=30 [--room]'); process.exit(1); }
const url = new URL(endpoint).origin;
const duration = Number(args.find(a => a.startsWith('--duration='))?.split('=')[1] || 30);
if (!Number.isFinite(duration) || duration < 5 || duration > 300) throw new Error('duration deve ficar entre 5 e 300 segundos.');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const summary = values => {
  const ordered = [...values].sort((a, b) => a - b), n = ordered.length;
  const round = value => Math.round(value * 10) / 10;
  return n ? { count: n, min: round(ordered[0]), p50: round(ordered[Math.floor((n - 1) * .5)]),
    p95: round(ordered[Math.ceil((n - 1) * .95)]), max: round(ordered.at(-1)), mean: round(values.reduce((a, b) => a + b, 0) / n) } : { count: 0 };
};
const report = { at: new Date().toISOString(), url, durationSecondsPerTransport: duration, createsIsolatedRoom: args.includes('--room'), transports: [] };
const at = performance.now();
try {
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(75000) });
  report.health = { status: response.status, elapsedMs: Math.round(performance.now() - at), body: await response.json() };
} catch (e) { report.health = { error: e.message, elapsedMs: Math.round(performance.now() - at) }; }
console.log(JSON.stringify({ phase: 'health', ...report.health }));

for (const transports of (args.includes('--websocket-only') ? [['websocket']] : [['websocket', 'polling'], ['polling']])) {
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  const socket = io(url, { autoConnect: false, transports, tryAllTransports: true, upgrade: transports.length > 1, timeout: 15000 });
  const result = { requested: transports.join(' → '), initial: null, final: null, reconnects: 0, timeouts: 0, pingAttempts: 0 };
  const rtts = [], variations = [], intervals = [], serverIntervals = [], payloadSizes = [];
  let previousSnapshot, connected = false, roomCode = null;
  socket.on('connect', () => { if (connected) result.reconnects++; connected = true; result.initial ||= socket.io.engine.transport.name; });
  socket.on(EV.snapshot, snapshot => {
    const at = performance.now();
    if (previousSnapshot) { intervals.push(at - previousSnapshot.at); serverIntervals.push((snapshot.time - previousSnapshot.time) * 1000); }
    previousSnapshot = { at, time: snapshot.time }; payloadSizes.push(Buffer.byteLength(JSON.stringify(snapshot)));
  });
  try {
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 16000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('connect_error', error => { if (transports.length === 1) { clearTimeout(timer); reject(error); } });
      socket.connect();
    });
    result.connectMs = Math.round(performance.now() - start);
    if (args.includes('--room')) {
      const welcome = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Room welcome timed out')), 10000);
        socket.once(EV.welcome, data => { clearTimeout(timer); resolve(data); });
      });
      const acknowledgement = await socket.timeout(10000).emitWithAck(EV.create, { name: 'Diagnóstico de conexão', protocol: report.health.body?.protocol || NET.protocol, character: { name: 'Diagnóstico' } });
      if (!acknowledgement?.ok) throw new Error(acknowledgement?.message || 'Room creation refused');
      roomCode = (await welcome).code; socket.emit(EV.action, { type: 'ready', ready: true });
    }
    const until = performance.now() + duration * 1000;
    while (performance.now() < until) {
      const start = performance.now(); result.pingAttempts++;
      try {
        await socket.timeout(3000).emitWithAck('latency:ping', {});
        const rtt = performance.now() - start;
        if (rtts.length) variations.push(Math.abs(rtt - rtts.at(-1))); rtts.push(rtt);
      } catch { result.timeouts++; }
      await sleep(Math.max(0, 500 - (performance.now() - start)));
    }
    result.final = socket.io.engine.transport.name;
  } catch (e) { result.error = e.message; }
  finally {
    if (roomCode && socket.connected) await socket.timeout(3000).emitWithAck(EV.leave, {}).catch(() => {});
    socket.disconnect();
    loop.disable(); result.localLoopLagP95Ms = Math.round(Math.max(0, loop.percentile(95) / 1e6 - 20) * 10) / 10;
  }
  Object.assign(result, { rttMs: summary(rtts), consecutiveRttVariationMs: summary(variations), snapshotIntervalMs: summary(intervals),
    serverSnapshotIntervalMs: summary(serverIntervals), snapshotBytes: summary(payloadSizes) });
  report.transports.push(result); console.log(JSON.stringify({ phase: 'transport', ...result }));
}
const directory = path.resolve('artifacts/network'); await fs.mkdir(directory, { recursive: true });
const output = path.join(directory, `connection-${report.at.replace(/[:.]/g, '-')}.json`);
await fs.writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ report: output }));
if (report.transports.every(t => t.error || !t.rttMs.count)) process.exitCode = 1;
