import * as THREE from 'three';
import { normalizeCode, rankPlayers } from '../shared/multiplayer.js';
import './multiplayer.css';

const statusText = { offline: 'Desconectado', connecting: 'Conectando ao servidor…', waking: 'Acordando o servidor… a primeira conexão pode levar cerca de um minuto.', connected: 'Conectado', reconnecting: 'Reconectando… seu lugar fica reservado por 20 segundos.', error: 'Não foi possível conectar. Tente novamente.' };

export function createMultiplayerUI(game) {
  const mp = game.multiplayer, net = mp.network;
  const lobby = document.createElement('section'); lobby.id = 'multiplayer-lobby'; lobby.className = 'mp-lobby hidden'; lobby.setAttribute('aria-label', 'Salas multijogador');
  lobby.innerHTML = `<div class="mp-heading"><div><small>MODO TRETA</small><h2>Salas multijogador</h2></div><button id="mp-back">Voltar</button></div>
    <p class="mp-description">Até 10 jogadores por sala. Escolha uma sala ou crie a sua. Friendly fire ligado.</p>
    <p id="mp-connection" role="status"></p><p id="mp-error" role="alert" hidden></p>
    <form id="mp-create-form"><label>Nome da sala<input id="mp-room-name" maxlength="32" placeholder="Sala do Biel" autocomplete="off" /></label><button id="mp-create" type="submit">Criar sala</button></form>
    <div class="mp-list-heading"><b>Salas abertas</b><button id="mp-refresh">Atualizar</button></div>
    <div id="mp-room-list" class="mp-room-list" aria-label="Lista de salas"></div>
    <form id="mp-code-form"><label>Código da sala<input id="mp-room-code" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" placeholder="ABC123" autocomplete="off" required /></label><button id="mp-join-code" type="submit">Entrar por código</button></form>`;
  document.querySelector('.menu-card').append(lobby);
  const $ = id => lobby.querySelector(`#${id}`), error = $('mp-error');
  let opened = false, touch = false, busy = false;
  function setBusy(value) { busy = value; lobby.setAttribute('aria-busy', String(value)); for (const button of lobby.querySelectorAll('button')) button.disabled = value || button.dataset.full === 'true'; }
  const fail = message => { error.textContent = message; error.hidden = false; };
  function renderRooms(rooms) {
    const list = $('mp-room-list'); list.replaceChildren();
    if (!rooms.length) { const p = document.createElement('p'); p.className = 'mp-empty'; p.textContent = net.status === 'connected' ? 'Nenhuma sala aberta. Crie a primeira!' : 'As salas aparecem assim que o servidor conectar.'; list.append(p); }
    for (const room of rooms) {
      const item = document.createElement('article'), label = document.createElement('div'), name = document.createElement('strong'), info = document.createElement('small'), join = document.createElement('button');
      item.className = 'mp-room'; name.textContent = room.name; info.textContent = `${room.players}/${room.maxPlayers} jogadores · ${room.code} · ${room.defense}${room.football ? ' · Futebol de caixa' : ''}`;
      join.textContent = room.full ? 'Lotada' : 'Entrar'; join.dataset.full = String(room.full); join.disabled = room.full || busy;
      join.setAttribute('aria-label', `${room.full ? 'Sala lotada' : 'Entrar'}: ${room.name}`);
      join.addEventListener('click', () => choose(() => net.join(room.code, game.player.character)));
      label.append(name, info); item.append(label, join); list.append(item);
    }
  }
  function choose(action) {
    if (busy || !opened) return;
    error.hidden = true;
    game.ui.characters.open({ mode: 'multiplayer', onConfirm: async () => {
      if (!opened) return;
      setBusy(true);
      try {
        await action();
        if (opened && net.session) { close(); game.ui.startMode('multiplayer', touch, true); }
      } catch (e) { if (opened) fail(e.message); }
      finally { setBusy(false); }
    } });
  }
  $('mp-create-form').addEventListener('submit', event => { event.preventDefault(); choose(() => net.create($('mp-room-name').value || `Sala de ${game.player.character?.name || 'Bancário'}`, game.player.character)); });
  $('mp-code-form').addEventListener('submit', event => { event.preventDefault(); choose(() => net.join(normalizeCode($('mp-room-code').value), game.player.character)); });
  $('mp-refresh').addEventListener('click', async () => { error.hidden = true; try { await net.open(); await net.refresh(); } catch (e) { fail(e.message); } });
  $('mp-back').addEventListener('click', () => { close(); net.close(); game.events.emit('menuopen'); document.getElementById('play').focus(); });
  net.on('rooms', renderRooms);
  net.on('status', status => { $('mp-connection').textContent = statusText[status]; if (opened) renderRooms(net.rooms); });
  async function open(touchSession) {
    opened = true; touch = touchSession; error.hidden = true; lobby.classList.remove('hidden');
    document.querySelectorAll('.menu-card > .menu-options').forEach(el => el.classList.add('hidden'));
    renderRooms(net.rooms); $('mp-room-name').focus();
    try { await net.open(); if (opened) await net.refresh(); } catch (e) { if (opened) fail(e.message); }
  }
  function close() { opened = false; lobby.classList.add('hidden'); }

  const hud = document.createElement('section'); hud.id = 'multiplayer-hud'; hud.hidden = true;
  hud.innerHTML = `<div class="mp-status"><div class="mp-status-heading"><b id="mp-session"></b><button id="mp-copy" aria-label="Copiar código da sala">Copiar código</button></div>
    <small id="mp-transport"></small><div class="mp-vitals"><strong id="mp-health"></strong><span id="mp-score"></span></div>
    <div class="mp-health-track"><i id="mp-health-fill"></i></div><small>Friendly fire ligado</small>
    <p id="mp-defense-score"></p><p id="mp-football-score"></p></div>
    <div id="mp-reconnect" role="status" hidden></div><div id="mp-respawn" role="status" hidden></div>
    <div id="mp-hit" role="status" hidden></div><button id="mp-interact" hidden></button>
    <section id="mp-ready-panel" class="mp-ready" hidden aria-label="Aprovação da partida"><h2>Prontos para a treta?</h2><ul id="mp-ready-list"></ul><button id="mp-ready" aria-pressed="false">Estou pronto</button><small>Começa quando todos aprovarem.</small></section>
    <button id="mp-ranking-button" aria-label="Ranking · Tab" aria-expanded="false">🏆 <span>Tab</span></button>
    <section id="mp-ranking" class="mp-ranking" hidden aria-label="Ranking da partida"><div><b>RANKING</b><button id="mp-ranking-close" aria-label="Fechar ranking">×</button></div><table><thead><tr><th scope="col">#</th><th scope="col">Jogador</th><th scope="col">Kills</th><th scope="col">Assist.</th><th scope="col">Mortes</th></tr></thead><tbody></tbody></table></section>
    <div class="mp-labels" aria-hidden="true"></div>`;
  document.getElementById('hud').append(hud);
  const h = id => hud.querySelector(`#${id}`), labels = hud.querySelector('.mp-labels');
  let waiting = false, rankingSignature = '', readySignature = '';
  function showRanking(value) { h('mp-ranking').hidden = !value || !mp.active; h('mp-ranking-button').setAttribute('aria-expanded', String(value && mp.active)); }
  h('mp-ready').addEventListener('click', () => mp.ready(!mp.self?.ready));
  h('mp-ranking-button').addEventListener('click', () => showRanking(h('mp-ranking').hidden));
  h('mp-ranking-close').addEventListener('click', () => showRanking(false));
  game.input.bind('Tab', event => { if (mp.active && !game.ui?.mapOpen) { event.preventDefault(); showRanking(true); } }, { label: 'ranking da sala' });
  window.addEventListener('keyup', event => { if (event.code === 'Tab') showRanking(false); });
  window.addEventListener('blur', () => showRanking(false));
  h('mp-copy').addEventListener('click', async () => { const code = net.session?.code; if (!code) return; try { await navigator.clipboard.writeText(code); game.toast('Código da sala copiado.'); } catch { game.toast(`Código da sala: ${code}`); } });
  h('mp-interact').addEventListener('click', () => mp.interact());
  const plates = new Map(), projection = new THREE.Vector3(); let hitUntil = 0, hurtUntil = 0;
  function plate(key) { if (!plates.has(key)) { const el = document.createElement('div'); el.className = 'mp-nameplate'; labels.append(el); plates.set(key, el); } return plates.get(key); }
  function place(el, position, lift = 2.3, maxDistance = 80) {
    projection.set(position.x, position.y + lift, position.z);
    const distance = projection.distanceTo(game.engine.camera.position); projection.project(game.engine.camera);
    el.hidden = distance > maxDistance || projection.z < -1 || projection.z > 1 || Math.abs(projection.x) > .96 || Math.abs(projection.y) > .94;
    if (!el.hidden) { el.style.left = `${(projection.x + 1) / 2 * innerWidth}px`; el.style.top = `${(1 - projection.y) / 2 * innerHeight}px`; }
  }
  function sync() {
    hud.hidden = !mp.active; if (hud.hidden) return;
    const self = mp.self, snapshot = mp.snapshot; if (!self || !snapshot) return;
    const nextWaiting = snapshot.phase === 'waiting';
    h('mp-ready-panel').hidden = !nextWaiting;
    if (nextWaiting && !waiting) { game.player.releasePointerForUI(); game.paintball.resetInput(); }
    if (nextWaiting && document.pointerLockElement === game.engine.renderer.domElement) game.player.releasePointerForUI();
    if (!nextWaiting && waiting && game.player.active) game.player.start(game.player.touchMode);
    waiting = nextWaiting;
    const readyKey = JSON.stringify(snapshot.players.map(p => [p.id, p.ready, p.connected, mp.roster.get(p.id)?.character.name]));
    if (readyKey !== readySignature) {
      readySignature = readyKey; h('mp-ready-list').replaceChildren();
      for (const p of snapshot.players) { const row = document.createElement('li'); row.textContent = `${p.ready && p.connected ? '✓' : '○'} ${mp.roster.get(p.id)?.character.name || 'Jogador'}${!p.connected ? ' · reconectando' : ''}`; row.classList.toggle('ready', p.ready && p.connected); h('mp-ready-list').append(row); }
    }
    h('mp-ready').disabled = !net.ready; h('mp-ready').textContent = self.ready ? 'Cancelar aprovação' : 'Estou pronto'; h('mp-ready').setAttribute('aria-pressed', String(self.ready));
    const ranked = rankPlayers(snapshot.players), rankingKey = JSON.stringify(ranked.map(p => [p.id, p.kills, p.assists, p.deaths, p.connected, mp.roster.get(p.id)?.character.name]));
    if (rankingKey !== rankingSignature) {
      rankingSignature = rankingKey; const body = h('mp-ranking').querySelector('tbody'); body.replaceChildren();
      ranked.forEach((p, i) => { const row = document.createElement('tr'); row.classList.toggle('self', p.id === self.id); for (const value of [i + 1, `${mp.roster.get(p.id)?.character.name || 'Jogador'}${p.connected ? '' : ' · offline'}`, p.kills, p.assists || 0, p.deaths]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } body.append(row); });
    }
    h('mp-session').textContent = `${net.session.name} · ${net.session.code} · ${snapshot.players.length}/10`;
    h('mp-transport').textContent = `${net.latency} ms · ${mp.peerCount ? `Conexão direta com ${mp.peerCount} jogador(es)` : 'Conexão pelo servidor'}`;
    h('mp-health').textContent = `VIDA ${Math.ceil(self.health)}/${self.maxHealth}`;
    h('mp-health-fill').style.transform = `scaleX(${self.health / self.maxHealth})`;
    h('mp-score').textContent = `${self.kills} K · ${self.assists || 0} A · ${self.deaths} M`;
    const d = snapshot.defense, f = snapshot.football;
    h('mp-defense-score').textContent = d.status === 'idle' ? 'Prata: inicie a defesa na entrada do prédio.' : `Prata · ${d.status === 'won' ? 'VITÓRIA' : d.status === 'lost' ? 'DERROTA' : `Wave ${d.wave}/${d.totalWaves} · ${d.remaining} zumbis`} · Prédio ${Math.ceil(d.health)}/${d.maxHealth}`;
    h('mp-football-score').textContent = f.status === 'idle' ? 'Campo: inicie o futebol de caixa no círculo central.' : `Futebol de caixa · Azul ${f.score[0]} × ${f.score[1]} Amarelo${f.status === 'finished' ? ' · FIM DE JOGO' : ' · até 5 gols'}`;
    h('mp-reconnect').hidden = net.ready; h('mp-reconnect').textContent = statusText[net.status] || 'Reconectando…';
    h('mp-respawn').hidden = !self.dead; if (self.dead) h('mp-respawn').textContent = `Você morreu · renasce na Bussocaba em ${Math.ceil(self.respawnIn)}s`;
    h('mp-hit').hidden = performance.now() > hitUntil; hud.classList.toggle('mp-hurt', performance.now() < hurtUntil);
    h('mp-interact').hidden = !mp.nearby || !mp.canAct || game.ui?.mapOpen;
    if (mp.nearby) h('mp-interact').textContent = `${game.player.touchMode ? 'Iniciar' : 'E · Iniciar'} ${mp.nearby.id === 'defense' ? 'defesa do Prata' : 'futebol de caixa'}`;
    for (const el of plates.values()) el.hidden = true;
    for (const p of snapshot.players) {
      const isSelf = p.id === net.session.selfId, entry = mp.views.get(p.id);
      if (p.dead || !p.connected || isSelf) continue;
      const el = plate(p.id); el.textContent = `${mp.roster.get(p.id)?.character.name || 'Jogador'}${p.protected ? ' · 🛡️' : ''}`;
      place(el, entry?.state.feet || { x: p.x, y: p.y, z: p.z });
    }
    for (const marker of mp.markers) {
      const el = plate(marker.id); el.classList.add('mp-marker-label'); el.textContent = marker.label; place(el, marker.at, 2, 150);
    }
  }
  game.events.on('multiplayerevent', event => {
    if (event.type === 'damage' && event.source === net.session?.selfId) { h('mp-hit').textContent = `${event.region === 'head' ? 'Cabeça' : event.region === 'limb' ? 'Membro' : 'Tórax'} · ${Math.round(event.damage)} dano${event.remaining <= 0 ? ' · KILL' : ''}`; hitUntil = performance.now() + 1200; }
    if (event.type === 'damage' && event.victim === net.session?.selfId) hurtUntil = performance.now() + 250;
  });
  game.events.on('multiplayerleft', () => { hud.hidden = true; waiting = false; readySignature = rankingSignature = ''; showRanking(false); for (const p of plates.values()) p.remove(); plates.clear(); });
  game.engine.addSystem(sync, 'late');
  return { open, close, sync, lobby, hud, get opened() { return opened; } };
}
