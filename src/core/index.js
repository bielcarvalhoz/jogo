// API pública do núcleo (motor, eventos, entrada, física, visual).
// Outros módulos importam SÓ deste arquivo.
export { createGame } from './game.js';
export { createEngine } from './engine.js';
export { createEvents } from './events.js';
export { createInput } from './input.js';
export { createPhysics } from './physics.js';
export { detectQuality, qualityProfile, debugOptions, IS_TOUCH } from './quality.js';
export { setupVisualStyle } from './visual.js';
export { createStyler } from './style.js';

export { loadSettings, saveSettings, normalizeSettings, DEFAULT_SETTINGS } from './settings.js';
export { createTour } from './tour.js';
export { createTraining } from './training.js';
export { partitionStaticInstances } from './instances.js';
export { createAudio } from './audio.js';
export { createDynamicProps } from './dynamic-props.js';
export { createRagdolls } from './ragdolls.js';
export { bindLocomotionAudio, footSurface } from './locomotion-audio.js';
export { createCharacterStore, normalizeAppearance, DEFAULT_APPEARANCE, APPEARANCE_OPTIONS } from './characters.js';
export { copyBodyPaint } from './body-paint.js';
