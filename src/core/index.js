// API pública do núcleo (motor, eventos, entrada, física, visual).
// Outros módulos importam SÓ deste arquivo.
export { createGame } from './game.js';
export { createEngine } from './engine.js';
export { createEvents } from './events.js';
export { createInput } from './input.js';
export { createPhysics } from './physics.js';
export { detectQuality, debugOptions, IS_TOUCH } from './quality.js';
export { setupVisualStyle } from './visual.js';
export { createStyler } from './style.js';
