import * as THREE from 'three';
import { deathNotice } from '../shared/death-notice.js';

const icon = id => `<svg class="control-icon" aria-hidden="true"><use href="./icons/controls.svg#${id}" /></svg>`;

export function createCombatFeedback(game) {
  const hud = document.getElementById('hud'), entries = [];
  const feed = document.createElement('ol'); feed.id = 'death-feed'; feed.setAttribute('aria-label', 'Eliminações'); feed.setAttribute('aria-live', 'polite'); feed.setAttribute('aria-relevant', 'additions'); hud.append(feed);
  const health = document.createElement('div'); health.id = 'self-health'; health.hidden = true; health.setAttribute('aria-label', 'Sua vida');
  health.innerHTML = '<b></b><div class="self-health-track"><i></i></div>'; hud.append(health);
  const fill = health.querySelector('i'), label = health.querySelector('b'), anchor = new THREE.Vector3();
  function showDeath(event) {
    const multi = game.mode === 'multiplayer', selfId = multi ? game.multiplayer.network.session?.selfId : game.combat.player.id;
    const notice = deathNotice(event, { selfId, selfName: game.player.character?.name || 'Você',
      nameOf: id => game.multiplayer?.roster.get(id)?.character.name, weapons: game.paintball.weapons });
    if (notice.victimKind === 'objective') return;
    const item = document.createElement('li'); item.classList.toggle('local', notice.local);
    const killer = document.createElement('span'), victim = document.createElement('span'), cause = document.createElement('span');
    killer.className = 'death-killer'; victim.className = 'death-victim'; cause.className = 'death-cause';
    killer.textContent = notice.source; victim.textContent = notice.victim;
    cause.innerHTML = icon(notice.icon); const weaponName = document.createElement('small'); weaponName.textContent = notice.label; cause.append(weaponName);
    if (notice.headshot) { const hs = document.createElement('span'); hs.className = 'death-headshot'; hs.innerHTML = icon('headshot'); hs.title = 'Tiro na cabeça'; cause.append(hs); }
    item.setAttribute('aria-label', `${notice.source} eliminou ${notice.victim} · ${notice.label}${notice.headshot ? ' · tiro na cabeça' : ''}`);
    item.append(killer, cause, victim); feed.prepend(item); entries.unshift({ item, age: 0 });
    while (entries.length > 5) entries.pop().item.remove();
  }
  game.events.on('combatdeath', event => { if (game.mode === 'training') showDeath(event); });
  game.events.on('multiplayerevent', event => { if (event.type === 'death' && game.mode === 'multiplayer') showDeath(event); });
  function clear() { entries.length = 0; feed.replaceChildren(); health.hidden = true; }
  game.events.on('modechange', clear); game.events.on('combatreset', clear); game.events.on('multiplayerleft', clear);
  function update(dt) {
    for (let i = entries.length - 1; i >= 0; i--) { entries[i].age += dt; if (entries[i].age > 6) { entries[i].item.remove(); entries.splice(i, 1); } }
    const multi = game.mode === 'multiplayer', actor = multi ? game.multiplayer.self : game.mode === 'training' ? game.combat.player : null;
    const hp = multi ? actor && { current: actor.health, max: actor.maxHealth } : actor?.health;
    health.hidden = !game.player.active || !hp || actor.dead || hp.current >= hp.max || hp.current <= 0;
    if (health.hidden) return;
    const first = game.player.cameraMode === 'first';
    if (!first) {
      const head = game.player.avatar.bones['DEF-head']; head.getWorldPosition(anchor); anchor.y += .47;
      anchor.project(game.engine.camera);
      health.hidden = anchor.z < -1 || anchor.z > 1 || Math.abs(anchor.x) > .95 || Math.abs(anchor.y) > .95;
      health.style.left = `${(anchor.x + 1) * 50}%`; health.style.top = `${(1 - anchor.y) * 50}%`;
    } else { health.style.left = '50%'; health.style.top = '61%'; }
    label.textContent = `${Math.ceil(hp.current)} / ${hp.max}`;
    fill.style.width = `${Math.max(0, hp.current / hp.max * 100)}%`; health.classList.toggle('critical', hp.current / hp.max <= .3);
  }
  game.engine.addSystem(update, 'late');
  return { feed, health, clear, update };
}
