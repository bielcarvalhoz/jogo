import { finitePoint, interpolatePose } from '../../shared/multiplayer.js';

/** DTC's ordered-ID negotiation, room-scoped signalling and always-on server
 * fallback. Only cosmetic poses cross the mesh; actions always use Socket.IO. */
export class PeerMesh {
  constructor({ selfId, signal, onPose = () => {}, rtcFactory = globalThis.RTCPeerConnection, clock = () => performance.now() / 1000, iceServers } = {}) {
    this.selfId = selfId; this.signal = signal; this.onPose = onPose; this.RTC = rtcFactory; this.clock = clock;
    this.peers = new Map(); this.wanted = new Set(); this.earlyIce = new Map(); this.closed = false;
    this.iceServers = iceServers || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    // Optional ICE/TURN list. Credentials placed in VITE_* are public; use
    // short-lived credentials if configuring TURN (see the deployment guide).
    try { const configured = JSON.parse(import.meta.env?.VITE_RTC_ICE_SERVERS || 'null'); if (Array.isArray(configured) && configured.length) this.iceServers = configured; } catch { /* Keep STUN and server fallback. */ }
  }
  setPeers(ids) {
    this.wanted = new Set(ids.filter(id => id !== this.selfId));
    for (const id of this.peers.keys()) if (!this.wanted.has(id)) this.drop(id);
    if (!this.RTC || this.closed) return;
    for (const id of this.wanted) {
      const peer = this.peers.get(id);
      if (peer && (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'disconnected') && this.clock() - peer.createdAt > 12 && this.selfId < id) this.drop(id);
      if (!this.peers.has(id)) this.connect(id);
    }
  }
  connect(id, passive = false) {
    if (!this.RTC || this.closed) return null;
    let pc; try { pc = new this.RTC({ iceServers: this.iceServers }); } catch { return null; }
    const peer = { pc, dc: null, pendingIce: this.earlyIce.get(id) || [], remote: false, createdAt: this.clock(), lastSeq: -1, lastPose: null, previousPose: null, lastRx: -Infinity, blend: 0 };
    this.earlyIce.delete(id); this.peers.set(id, peer);
    pc.onicecandidate = e => { if (e.candidate && !this.closed) this.signal(id, { ice: e.candidate.toJSON?.() || e.candidate }); };
    pc.ondatachannel = e => this.bind(id, peer, e.channel);
    if (!passive && this.selfId < id) {
      this.bind(id, peer, pc.createDataChannel('biel-pose', { ordered: false, maxRetransmits: 0 }));
      void (async () => {
        try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); if (this.peers.get(id) === peer) this.signal(id, { sdp: pc.localDescription }); } catch { /* snapshots continue */ }
      })();
    }
    return peer;
  }
  bind(id, peer, dc) {
    peer.dc = dc;
    dc.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 2048 || this.peers.get(id) !== peer) return;
      let pose; try { pose = JSON.parse(event.data); } catch { return; }
      if (!finitePoint(pose) || !Number.isFinite(pose.yaw) || !Number.isSafeInteger(pose.seq) || pose.seq <= peer.lastSeq) return;
      peer.lastSeq = pose.seq; peer.previousPose = peer.lastPose; peer.lastPose = pose; peer.lastRx = this.clock(); this.onPose(id, pose);
    };
  }
  async receive(from, data) {
    if (!this.wanted.has(from) || !this.RTC || this.closed || !data) return;
    let peer = this.peers.get(from);
    if (data.sdp?.type === 'offer' && peer?.remote) { this.drop(from); peer = null; }
    if (!peer) peer = this.connect(from, data.sdp?.type === 'offer');
    if (!peer) return;
    try {
      if (data.sdp && ['offer', 'answer'].includes(data.sdp.type)) {
        await peer.pc.setRemoteDescription(data.sdp); peer.remote = true;
        for (const ice of peer.pendingIce.splice(0)) { try { await peer.pc.addIceCandidate(ice); } catch { /* stale */ } }
        if (data.sdp.type === 'offer') { await peer.pc.setLocalDescription(await peer.pc.createAnswer()); if (this.peers.get(from) === peer) this.signal(from, { sdp: peer.pc.localDescription }); }
      }
      if (data.ice) { if (peer.remote) await peer.pc.addIceCandidate(data.ice); else if (peer.pendingIce.length < 64) peer.pendingIce.push(data.ice); }
    } catch { /* A failed direct link keeps drawing server snapshots. */ }
  }
  send(pose) {
    const data = JSON.stringify(pose);
    for (const peer of this.peers.values()) if (peer.dc?.readyState === 'open' && peer.dc.bufferedAmount < 8192) { try { peer.dc.send(data); } catch { /* server path */ } }
  }
  sample(id, authoritative, dt) {
    const p = this.peers.get(id); if (!p) return authoritative;
    const fresh = this.clock() - p.lastRx < .25 && !authoritative.dead && authoritative.connected !== false;
    // Never let an untrusted cosmetic pose wander beyond the accepted snapshot.
    const nearby = p.lastPose && Math.hypot(p.lastPose.x - authoritative.x, p.lastPose.y - authoritative.y, p.lastPose.z - authoritative.z) < 4;
    p.blend = Math.max(0, Math.min(1, p.blend + (fresh && nearby ? 1 : -1) * dt / .15));
    if (!p.lastPose || !p.blend) return authoritative;
    const alpha = Math.max(0, Math.min(1, (this.clock() - p.lastRx + .016) * 30));
    const direct = interpolatePose(p.previousPose, p.lastPose, alpha);
    const result = interpolatePose(authoritative, { ...authoritative, x: direct.x, y: direct.y, z: direct.z, yaw: direct.yaw }, p.blend);
    return result;
  }
  get connectedCount() { return [...this.peers.values()].filter(p => p.dc?.readyState === 'open').length; }
  drop(id) { const p = this.peers.get(id); this.peers.delete(id); if (p) { p.dc?.close(); p.pc.close(); } }
  close() { this.closed = true; for (const id of [...this.peers.keys()]) this.drop(id); this.wanted.clear(); this.earlyIce.clear(); }
}
