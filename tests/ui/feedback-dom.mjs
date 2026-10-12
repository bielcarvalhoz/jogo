// Minimal DOM for event-driven HUD tests; WebGL vectors and sprites stay real.
export class Element extends EventTarget {
  constructor(tag = 'div') {
    super(); this.tagName = tag; this.children = []; this.attributes = {}; this.hidden = false;
    this.style = { setProperty(name, value) { this[name] = value; } }; this.classes = new Set();
    this.classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key) };
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  replaceChildren(...nodes) { this.children.forEach(n => { n.parent = null; }); this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() {}
  get firstElementChild() { return this.children[0]; }
  set innerHTML(value) {
    this.html = value;
    if (value.includes('reaction-ring')) this.append(new Element('div'));
    if (value.includes('self-health-track')) this.append(new Element('b'), new Element('i'));
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(tag) { return this.children.flatMap(n => [...(n.tagName === tag ? [n] : []), ...n.querySelectorAll(tag)]); }
  querySelector(tag) { return this.querySelectorAll(tag)[0]; }
}

export function domFixture(t) {
  const originals = { document: globalThis.document, window: globalThis.window }, hud = new Element();
  globalThis.document = { getElementById: () => hud, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  globalThis.window = new EventTarget();
  t.after(() => { for (const [key, value] of Object.entries(originals)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  return { hud };
}
