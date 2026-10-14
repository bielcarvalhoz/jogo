import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { NET, EV, cleanName, normalizeCode } from '../src/shared/multiplayer.js';
import { normalizeAppearance } from '../src/core/characters.js';
import { createRoomSimulation } from './simulation.js';

export function attachHub(io, world, { graceMs = NET.graceMs, emptyMs = NET.emptyMs, maxRooms = 12 } = {}) {
  const rooms = new Map();
  const directory = () => [...rooms.values()].filter(r => r.members.size).map(r => ({ code: r.code, name: r.name, players: r.members.size,
    connected: [...r.members.values()].filter(m => m.socketId).length, maxPlayers: NET.maxPlayers, full: r.members.size >= NET.maxPlayers,
    defense: r.sim.defense.status === 'running' ? `Wave ${r.sim.defense.wave}` : r.sim.snapshot().phase === 'waiting' ? 'Aguardando aprovação' : 'Em partida', football: r.sim.football.status === 'running' }));
  const broadcastDirectory = () => io.to('directory').emit(EV.rooms, directory());
  const flushSnapshot = socket => {
    if (!socket.data.room || !socket.data.latestSnapshot || !socket.conn.transport.writable) return;
    const snapshot = socket.data.latestSnapshot; socket.data.latestSnapshot = null;
    socket.volatile.emit(EV.snapshot, snapshot);
  };
  const roster = room => ({ code: room.code, name: room.name, ownerId: room.ownerId, players: [...room.members.values()].map(m => ({ id: m.id, character: m.character, connected: !!m.socketId })) });
  function announce(room) { io.to(room.code).emit(EV.roster, roster(room)); broadcastDirectory(); }
  function destroy(room) {
    clearInterval(room.timer); clearTimeout(room.emptyTimer);
    for (const m of room.members.values()) clearTimeout(m.graceTimer);
    room.sim.dispose(); rooms.delete(room.code); broadcastDirectory();
  }
  function remove(room, member) {
    clearTimeout(member.graceTimer); room.members.delete(member.id); room.tokens.delete(member.token); room.sim.removePlayer(member.id);
    if (room.ownerId === member.id) room.ownerId = [...room.members.values()].find(m => m.socketId)?.id || room.members.keys().next().value || null;
    if (!room.members.size) { destroy(room); return; }
    announce(room);
  }
  function detach(socket, immediate = false) {
    const room = rooms.get(socket.data.room), member = room?.members.get(socket.data.player);
    socket.data.room = socket.data.player = socket.data.latestSnapshot = null;
    if (!room || !member || member.socketId !== socket.id) return;
    socket.leave(room.code); member.socketId = null; room.sim.players.get(member.id).connected = false; room.sim.players.get(member.id).ready = false;
    // A disconnected player cannot absorb damage while occupying a slot.
    room.sim.players.get(member.id).entity.protectedUntil = Infinity;
    room.sim.players.get(member.id).entity.networkGhost = true;
    if (immediate) remove(room, member);
    else {
      member.graceTimer = setTimeout(() => remove(room, member), graceMs);
      if (room.ownerId === member.id) room.ownerId = [...room.members.values()].find(m => m.socketId)?.id || member.id;
      announce(room);
    }
    if (rooms.has(room.code) && ![...room.members.values()].some(m => m.socketId) && !room.emptyTimer) room.emptyTimer = setTimeout(() => destroy(room), emptyMs);
  }
  function makeRoom(name) {
    let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
    const room = { code, name: cleanName(name), ownerId: null, members: new Map(), tokens: new Map(), emptyTimer: null, last: performance.now(), accumulator: 0, snapAccumulator: 0 };
    room.sim = createRoomSimulation(world, { onEvent: event => {
      io.to(code).emit(EV.event, event);
      if (event.type === 'minigame' || event.type === 'matchStart') broadcastDirectory();
    } });
    room.timer = setInterval(() => {
      const now = performance.now(), elapsed = Math.min(.25, (now - room.last) / 1000); room.last = now;
      // Nobody connected: preserve the session without advancing an unattended game.
      if (![...room.members.values()].some(m => m.socketId)) { room.accumulator = room.snapAccumulator = 0; return; }
      room.accumulator += elapsed; room.snapAccumulator += elapsed;
      while (room.accumulator >= 1 / NET.tickHz) { room.sim.step(1 / NET.tickHz); room.accumulator -= 1 / NET.tickHz; }
      if (room.snapAccumulator >= 1 / NET.snapshotHz) {
        room.snapAccumulator %= 1 / NET.snapshotHz;
        const snapshot = room.sim.snapshot();
        for (const member of room.members.values()) {
          const socket = io.sockets.sockets.get(member.socketId); if (!socket) continue;
          // Keep one newest state during backpressure, never a queue of old
          // worlds. Polling receives it with its next available response.
          socket.data.latestSnapshot = snapshot; flushSnapshot(socket);
        }
      }
    }, 1000 / NET.tickHz);
    rooms.set(code, room); return room;
  }
  io.on('connection', socket => {
    socket.join('directory'); socket.emit(EV.rooms, directory());
    const ready = () => flushSnapshot(socket);
    let transport;
    const watch = next => {
      transport?.removeListener('ready', ready); transport?.removeListener('drain', ready);
      transport = next; transport.prependListener('ready', ready); transport.on('drain', ready);
    };
    watch(socket.conn.transport); socket.conn.on('upgrade', watch);
    socket.on('disconnect', () => {
      socket.conn.removeListener('upgrade', watch); transport.removeListener('ready', ready); transport.removeListener('drain', ready);
    });
    const buckets = new Map();
    const rate = (key, limit, seconds = 1) => {
      const now = performance.now() / 1000, b = buckets.get(key) || { tokens: limit, at: now };
      b.tokens = Math.min(limit, b.tokens + (now - b.at) * limit / seconds); b.at = now; buckets.set(key, b);
      if (b.tokens < 1) return false; b.tokens--; return true;
    };
    const reply = (ack, result) => { if (typeof ack === 'function') ack(result); };
    function enter(room, data, ack) {
      let member = room.members.get(room.tokens.get(data.token)) || (socket.data.room === room.code ? room.members.get(socket.data.player) : null);
      if (data.token && !member) { reply(ack, { ok: false, message: 'Seu lugar nesta sala expirou. Entre novamente pela lista de salas.' }); return; }
      if (!member && room.members.size >= NET.maxPlayers) { reply(ack, { ok: false, message: 'Esta sala já tem 10 jogadores.' }); return; }
      if (socket.data.room && (socket.data.room !== room.code || socket.data.player !== member?.id)) detach(socket, true);
      if (!member) {
        const character = { name: cleanName(data.character?.name, 'Bancário', 24), appearance: normalizeAppearance(data.character?.appearance) };
        member = { id: randomUUID(), token: randomBytes(24).toString('hex'), character, socketId: null, graceTimer: null };
        room.sim.addPlayer(member.id, character); room.members.set(member.id, member); room.tokens.set(member.token, member.id);
      }
      // Reclaiming a token invalidates the old transport, including its input and
      // disconnect handler. No second socket can control the same character.
      if (member.socketId && member.socketId !== socket.id) {
        const old = io.sockets.sockets.get(member.socketId);
        if (old) { old.data.room = old.data.player = null; old.leave(room.code); old.emit('session:replaced'); old.disconnect(true); }
      }
      clearTimeout(member.graceTimer); clearTimeout(room.emptyTimer); member.graceTimer = room.emptyTimer = null;
      member.socketId = socket.id;
      const player = room.sim.players.get(member.id); player.connected = true; player.entity.networkGhost = false; player.entity.protectedUntil = room.sim.sim.time + 2;
      room.ownerId ||= member.id;
      socket.data.room = room.code; socket.data.player = member.id; socket.join(room.code);
      socket.data.latestSnapshot = null;
      const welcome = { ok: true, code: room.code, name: room.name, selfId: member.id, token: member.token, protocol: NET.protocol, roster: roster(room), snapshot: room.sim.snapshot(), landmarks: world.landmarks };
      socket.emit(EV.welcome, welcome); reply(ack, { ok: true }); announce(room);
    }
    socket.on(EV.list, (_, ack) => { if (rate('list', 3)) reply(ack, { ok: true, rooms: directory() }); });
    socket.on(EV.create, (data = {}, ack) => {
      if (!data || typeof data !== 'object') { reply(ack, { ok: false, message: 'Pedido de sala inválido.' }); return; }
      if (!rate('enter', 3, 10)) { reply(ack, { ok: false, message: 'Espere alguns segundos antes de criar outra sala.' }); return; }
      if (data.protocol !== NET.protocol) { reply(ack, { ok: false, message: 'Atualize a página para usar esta versão do servidor.' }); return; }
      if (rooms.size >= maxRooms) { reply(ack, { ok: false, message: 'Servidor cheio. Entre em uma sala existente.' }); return; }
      const room = makeRoom(data.name);
      try { enter(room, data, ack); } catch (error) { destroy(room); console.error('[room:create]', error); reply(ack, { ok: false, message: 'Não foi possível criar a sala.' }); }
    });
    socket.on(EV.join, (data = {}, ack) => {
      if (!data || typeof data !== 'object') { reply(ack, { ok: false, message: 'Pedido de sala inválido.' }); return; }
      if (!rate('enter', 5, 10)) { reply(ack, { ok: false, message: 'Espere alguns segundos antes de tentar novamente.' }); return; }
      if (data.protocol !== NET.protocol) { reply(ack, { ok: false, message: 'Atualize a página para usar esta versão do servidor.' }); return; }
      const room = rooms.get(normalizeCode(data.code));
      if (!room) { reply(ack, { ok: false, code: 'no_room', message: 'Sala encerrada ou não encontrada. Escolha outra sala.' }); return; }
      enter(room, data, ack);
    });
    const current = () => {
      const room = rooms.get(socket.data.room), member = room?.members.get(socket.data.player);
      return member?.socketId === socket.id ? { room, member } : {};
    };
    socket.on(EV.pose, data => { const { room, member } = current(); if (room && rate('pose', 65)) room.sim.setPose(member.id, data); });
    socket.on(EV.action, (data, ack) => {
      const { room, member } = current(); if (!room || !rate('action', 35)) return;
      // Fire carries the current bounded pose so a dropped volatile update
      // cannot leave its muzzle at the previous movement sample.
      if (data?.type === 'attack' && data.pose) room.sim.setPose(member.id, data.pose);
      const accepted = room.sim.handleAction(member.id, data);
      reply(ack, { ok: true, accepted, shotId: data?.shotId });
    });
    socket.on(EV.signal, data => {
      const { room, member } = current();
      if (!room || !rate('signal', 80) || !data || typeof data.to !== 'string' || data.to === member.id) return;
      const target = room.members.get(data.to);
      if (target?.socketId && JSON.stringify(data.data || {}).length <= 32768) io.to(target.socketId).emit(EV.signal, { from: member.id, data: data.data });
    });
    socket.on('latency:ping', (_, ack) => {
      const { room } = current();
      if (rate('ping', 3)) reply(ack, { ok: true, time: room?.sim.sim.time });
    });
    socket.on(EV.leave, (_, ack) => { detach(socket, true); reply(ack, { ok: true }); });
    socket.on('disconnect', () => detach(socket));
  });
  return { rooms, directory, close() { for (const room of [...rooms.values()]) destroy(room); } };
}
