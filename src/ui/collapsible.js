/** Grid height transitions work for variable content and reverse mid-animation.
 * Inert removes collapsed controls from keyboard and screen-reader navigation. */
export function bindCollapsiblePanels(root = document) {
  for (const panel of root.querySelectorAll('[data-collapsible]')) {
    const button = panel.querySelector('[data-collapse-toggle]');
    const body = button && root.getElementById?.(button.getAttribute('aria-controls'));
    if (!button || !body || button.dataset.collapseBound) continue;
    button.dataset.collapseBound = 'true';
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      panel.classList.toggle('is-expanded', expanded); body.inert = !expanded;
    });
  }
}
