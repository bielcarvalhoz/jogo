import { io } from 'socket.io-client';
import { EV, NET } from '../../shared/multiplayer.js';

export function resolveServerUrl(location = globalThis.location, env = import.meta.env) {
  const override = new URLSearchParams(location?.search || '').get('server');
  const value = override || env?.VITE_SERVER_URL;
  if (value) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Endereço do servidor inválido.');
    if (location?.protocol === 'https:' && url.protocol !== 'https:') throw new Error('Use um servidor com conexão segura (HTTPS).');
    return url.origin;
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname)) return `http://${location.hostname}:3001`;
  throw new Error('O multiplayer ainda não foi configurado neste site.');
}

export class MultiplayerNetwork {
  constructor({ url, socketFactory = io } = {}) {
    this.url = url; this.socketFactory = socketFactory; this.socket = null; this.session = null;
    this.listeners = new Map(); this.rooms = []; this.status = 'offline'; this.ready = false; this.latency = 0; this.openPromise = null; this.cancelOpen = null;
    this.rttSamples = []; this.jitter = 0; this.timeouts = 0; this.reconnections = 0; this.clockSample = null;
  }
  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); return () => this.listeners.get(type)?.delete(fn); }
  emit(type, data) { for (const fn of this.listeners.get(type) || []) fn(data); }
  setStatus(status) { this.status = status; this.emit('status', status); }
  async open() {
    if (this.socket?.connected) return;
    if (this.openPromise) return this.openPromise;
    // A lobby retry must replace its previous transport and heartbeat together.
    clearInterval(this.pingTimer);
    this.socket?.removeAllListeners(); this.socket?.disconnect();
    this.setStatus('connecting');
    const socket = this.socket = this.socketFactory(this.url || resolveServerUrl(), { autoConnect: false,
      transports: ['websocket', 'polling'], tryAllTransports: true,
      reconnection: true, reconnectionDelay: 800, reconnectionDelayMax: 4000, timeout: 60000 });
    this.rttSamples = []; this.latency = this.jitter = 0; this.clockSample = null;
    let pingPending = false, connectedOnce = false;
    const ping = () => {
      if (!socket.connected || pingPending) return;
      pingPending = true; const at = performance.now();
      socket.timeout(3000).emit('latency:ping', {}, (error, reply) => {
        pingPending = false; if (this.socket !== socket || !socket.connected) return;
        if (error) { this.timeouts++; return; }
        const rtt = performance.now() - at, previous = this.rttSamples.at(-1);
        if (previous !== undefined) this.jitter += (Math.abs(rtt - previous) - this.jitter) * .2;
        this.rttSamples.push(rtt); if (this.rttSamples.length > 30) this.rttSamples.shift();
        this.latency = Math.round([...this.rttSamples].sort((a, b) => a - b)[Math.floor(this.rttSamples.length / 2)]);
        if (Number.isFinite(reply?.time)) this.clockSample = { time: reply.time + rtt / 2000, at: performance.now() / 1000 };
        this.emit('latency', this.latency);
      });
    };
    socket.on('connect', async () => {
      if (connectedOnce) this.reconnections++; connectedOnce = true; this.clockSample = null;
      this.setStatus('connected');
      if (this.session) {
        try { await this.request(EV.join, { code: this.session.code, token: this.session.token, protocol: NET.protocol }); }
        catch (error) { this.session = null; this.ready = false; this.emit('ended', error.message); }
      }
    });
    socket.on('disconnect', () => { this.ready = false; this.clockSample = null; this.setStatus(this.session ? 'reconnecting' : 'offline'); this.emit('disconnect'); });
    socket.on('connect_error', () => this.setStatus(this.session ? 'reconnecting' : 'waking'));
    socket.on('session:replaced', () => { this.session = null; this.ready = false; this.emit('ended', 'Esta sessão foi aberta em outra conexão.'); });
    socket.on(EV.rooms, rooms => { this.rooms = rooms; this.emit('rooms', rooms); });
    socket.on(EV.welcome, info => {
      this.session = { code: info.code, token: info.token, selfId: info.selfId, name: info.name };
      this.ready = true; this.clockSample = null; this.emit('welcome', info); ping();
    });
    for (const name of [EV.roster, EV.snapshot, EV.event, EV.signal]) socket.on(name, data => this.emit(name, data));
    this.pingTimer = setInterval(ping, 2000);
    this.openPromise = new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); socket.off('connect', connected); this.openPromise = this.cancelOpen = null; error ? reject(error) : resolve(); };
      const connected = () => finish(), timer = setTimeout(() => { this.setStatus('error'); finish(new Error('O servidor demorou para responder. Tente novamente.')); }, 65000);
      this.cancelOpen = () => finish(new Error('Conexão cancelada.'));
      socket.once('connect', connected); socket.connect();
    });
    return this.openPromise;
  }
  async request(event, data = {}) {
    if (!this.socket?.connected) throw new Error('Aguarde a conexão com o servidor.');
    return new Promise((resolve, reject) => this.socket.timeout(10000).emit(event, data, (error, reply) => {
      if (error) reject(new Error('O servidor não respondeu. Tente novamente.'));
      else if (!reply?.ok) reject(new Error(reply?.message || 'Não foi possível concluir a ação.'));
      else resolve(reply);
    }));
  }
  async refresh() { const reply = await this.request(EV.list); this.rooms = reply.rooms; this.emit('rooms', this.rooms); }
  async create(name, character) { await this.open(); return this.request(EV.create, { name, character, protocol: NET.protocol }); }
  async join(code, character) { await this.open(); return this.request(EV.join, { code, character, protocol: NET.protocol }); }
  pose(pose) { if (this.ready && this.socket?.connected) this.socket.volatile.emit(EV.pose, pose); }
  action(data, onResult) {
    if (!this.ready || !this.socket?.connected) return;
    if (onResult) this.socket.timeout(3000).emit(EV.action, data, (error, reply) => { if (!error) onResult(reply); });
    else this.socket.emit(EV.action, data);
  }
  get transport() { return this.socket?.io.engine?.transport?.name || 'offline'; }
  serverNow(now) { return this.clockSample ? this.clockSample.time + Math.max(0, now - this.clockSample.at) : null; }
  signal(to, data) { if (this.ready && this.socket?.connected) this.socket.emit(EV.signal, { to, data }); }
  leave() {
    this.session = null; this.ready = false;
    if (this.socket?.connected) this.socket.emit(EV.leave, {});
    this.emit('left');
  }
  close() {
    this.leave(); this.cancelOpen?.(); clearInterval(this.pingTimer);
    this.socket?.disconnect(); this.socket?.removeAllListeners(); this.socket = null; this.setStatus('offline');
  }
}
