/** Both authorities publish the fatal hit, including its actual weapon. */
export function deathNotice(event, { selfId, selfName = 'Você', nameOf = () => null, weapons = [] } = {}) {
  const victim = event.victim && typeof event.victim === 'object' ? event.victim : { id: event.victim, kind: event.victimKind };
  const source = typeof event.source === 'object' && event.source ? event.source : { id: event.source, kind: event.sourceKind };
  const name = (actor, explicit) => explicit || (actor.id === selfId ? selfName : nameOf(actor.id))
    || (actor.kind === 'zombie' ? 'Zumbi' : actor.kind === 'objective' ? 'Prata' : actor.kind === 'human' ? `${actor.role === 'ally' ? 'Aliado' : 'Bot'} ${actor.id?.split('-').at(-1) || ''}`.trim() : actor.id ? 'Jogador' : 'Ambiente');
  const id = event.cause || (typeof event.weapon === 'string' ? event.weapon : event.weapon?.id) || (source.kind === 'zombie' ? 'zombie' : 'environment');
  const weapon = weapons.find(w => w.id === id), headshot = event.region === 'head' && !!(event.weapon?.kind === 'firearm' || weapon?.kind === 'firearm');
  const label = weapon?.label || ({ zombie: 'Ataque de zumbi', fists: 'Soco', environment: 'Ambiente' }[id] || 'Eliminação');
  return { source: name(source, event.sourceName), victim: name(victim, event.victimName),
    icon: weapon?.icon || (id === 'zombie' ? 'skull' : id === 'fists' ? 'fists' : 'skull'), label, headshot,
    local: selfId != null && (victim.id === selfId || source.id === selfId), victimKind: victim.kind };
}
