import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerMesh } from '../../src/gameplay/multiplayer/peers.js';
import { resolveServerUrl } from '../../src/gameplay/multiplayer/network.js';

test('WebRTC absence always uses authoritative poses, and closing is harmless', () => {
  const mesh = new PeerMesh({ selfId: 'a', rtcFactory: null }); mesh.setPeers(['b']); const pose = { x: 0, y: 0, z: 0, yaw: 0 };
  assert.equal(mesh.connectedCount, 0); assert.equal(mesh.sample('b', pose, .1), pose); mesh.send(pose); mesh.close(); mesh.close();
});

test('unordered poses ignore old/invalid messages, fade to snapshots on loss and reject distant claims', () => {
  let time = 1;
  class RTC {
    constructor() { this.connectionState = 'connected'; }
    createDataChannel() { return { readyState: 'open', bufferedAmount: 0, send() {}, close() {} }; }
    createOffer() { return Promise.reject(new Error('intentionally unavailable')); }
    close() {}
  }
  const mesh = new PeerMesh({ selfId: 'a', rtcFactory: RTC, signal() {}, clock: () => time }); mesh.setPeers(['b']); const p = mesh.peers.get('b');
  const authoritative = { x: 0, y: 0, z: 0, yaw: 0, dead: false, connected: true };
  const receive = pose => p.dc.onmessage({ data: JSON.stringify(pose) });
  receive({ ...authoritative, x: 1, seq: 2 }); receive({ ...authoritative, x: 3, seq: 1 });
  assert.equal(p.lastPose.x, 1); assert.ok(mesh.sample('b', authoritative, .2).x > .9);
  time += .3; assert.equal(mesh.sample('b', authoritative, .2).x, 0);
  receive({ ...authoritative, x: 500, seq: 3 }); assert.equal(mesh.sample('b', authoritative, .2).x, 0);
  receive({ ...authoritative, x: NaN, seq: 4 }); assert.equal(p.lastSeq, 3);
  mesh.close();
});

test('server URL resolves overrides and local development without inventing a production endpoint', () => {
  assert.equal(resolveServerUrl({ hostname: 'localhost', search: '', protocol: 'http:' }, {}), 'http://localhost:3001');
  assert.equal(resolveServerUrl({ hostname: 'jogo.vercel.app', search: '', protocol: 'https:' }, { VITE_SERVER_URL: 'https://jogo-server.onrender.com/' }), 'https://jogo-server.onrender.com');
  assert.throws(() => resolveServerUrl({ hostname: 'jogo.vercel.app', protocol: 'https:' }, {}), /configurado/);
  assert.throws(() => resolveServerUrl({ hostname: 'jogo.vercel.app', search: '?server=http://localhost:3001', protocol: 'https:' }, {}), /segura/);
});
