// Barramento de eventos do jogo: módulos conversam por nome de evento, sem importar um ao outro.
// Eventos usados hoje (documentados em docs/ARQUITETURA.md):
//   'toast'  (mensagem: string)  -> a UI mostra um aviso rápido na tela
export function createEvents() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name)?.delete(fn);
    },
    off(name, fn) { handlers.get(name)?.delete(fn); },
    emit(name, detail) { for (const fn of [...(handlers.get(name) || [])]) fn(detail); },
  };
}
