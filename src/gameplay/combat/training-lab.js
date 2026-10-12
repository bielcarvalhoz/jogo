import * as THREE from 'three';
import { DIFFICULTIES } from './config.js';

export function createTrainingLab(game, combat) {
  const root = new THREE.Group(); root.name = 'combat-training-console';
  root.position.set(game.training.spawn.x - 7, 0, game.training.spawn.z - 7); root.rotation.y = Math.PI / 4;
  game.training.root.add(root);
  const resources = new Set(), buttons = [], ray = new THREE.Raycaster();
  let difficulty = 'normal', focused = null;
  function label(text, width, height, size = 36) {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 160;
    const context = canvas.getContext('2d'); context.clearRect(0, 0, 640, 160);
    context.fillStyle = '#eef5f7'; context.font = `700 ${size}px system-ui`; context.textAlign = 'center'; context.textBaseline = 'middle';
    const lines = text.split('\n'); lines.forEach((line, i) => context.fillText(line, 320, 80 + (i - (lines.length - 1) / 2) * 52, 610));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const geometry = new THREE.PlaneGeometry(width, height), material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
    [texture, geometry, material].forEach(r => resources.add(r));
    const mesh = new THREE.Mesh(geometry, material); mesh.userData.paintballIgnore = true; return mesh;
  }
  const boardGeometry = new THREE.BoxGeometry(6.5, 2.9, .22), boardMaterial = new THREE.MeshStandardMaterial({ color: 0x172832, roughness: .8 });
  resources.add(boardGeometry); resources.add(boardMaterial);
  const board = new THREE.Mesh(boardGeometry, boardMaterial); board.position.y = 1.6; board.castShadow = true; root.add(board);
  const title = label('LABORATÓRIO DE COMBATE', 5.7, .42, 46); title.position.set(0, 2.72, .13); root.add(title);
  const instruction = label('Mire e use E / atacar · G marca um ponto no chão', 5.6, .26, 28); instruction.position.set(0, .32, .13); root.add(instruction);
  const specs = [
    ['zombie', () => '+ ZUMBI', () => combat.spawn('zombie'), 0x517c62],
    ['enemy', () => '+ BOT INIMIGO', () => combat.spawn('human', 'enemy', difficulty), 0x8c4c4f],
    ['ally', () => '+ ALIADO', () => combat.spawn('human', 'ally', difficulty), 0x366c87],
    ['horde', () => '+ HORDA (8)', () => combat.horde(8), 0x517c62],
    ['targets', () => 'ALVOS PARADOS', () => combat.targets(), 0x66617b],
    ['difficulty', () => `BOT: ${DIFFICULTIES[difficulty].label.toUpperCase()}`, () => {
      const levels = Object.keys(DIFFICULTIES); difficulty = levels[(levels.indexOf(difficulty) + 1) % levels.length];
      combat.setDifficulty(difficulty); game.toast(`Bots: ${DIFFICULTIES[difficulty].label} · aplica aos atuais e aos próximos`);
    }, 0x6c6150],
    ['goal', () => `ZUMBI: ${ { players: 'PERSONAGENS', objective: 'OBJETO', point: 'PONTO' }[combat.simulation.zombieGoal] }`, () => {
      const goals = ['players', 'objective', 'point']; combat.setZombieGoal(goals[(goals.indexOf(combat.simulation.zombieGoal) + 1) % goals.length]);
    }, 0x6c6150],
    ['hitboxes', () => `HITBOXES: ${combat.showHitboxes ? 'SIM' : 'NÃO'}`, () => { combat.showHitboxes = !combat.showHitboxes; }, 0x66617b],
    ['pause', () => combat.simulation.pausedAI ? 'RETOMAR IA' : 'PAUSAR IA', () => { combat.simulation.pausedAI = !combat.simulation.pausedAI; }, 0x6c6150],
    ['damage', () => `DANO: ${combat.simulation.rules.damageMode === 'training' ? '1 / 2 / 4' : 'POR ARMA'}`, () => {
      combat.configure({ damageMode: combat.simulation.rules.damageMode === 'training' ? 'weapon' : 'training' });
    }, 0x6c6150],
    ['friendly', () => `FOGO AMIGO: ${combat.simulation.rules.friendlyFire ? 'SIM' : 'NÃO'}`, () => combat.configure({ friendlyFire: !combat.simulation.rules.friendlyFire }), 0x6c6150],
    ['immortal', () => `IMORTAL: ${combat.simulation.rules.playerDamage === false ? 'SIM' : 'NÃO'}`, () => combat.configure({ playerDamage: combat.simulation.rules.playerDamage === false }), 0x366c87],
    ['defend', () => 'DEFENDER OBJETO', () => combat.scenario('defend', difficulty), 0x517c62],
    ['duel', () => 'DUELO COM BOT', () => combat.scenario('duel', difficulty), 0x8c4c4f],
    ['point', () => 'PONTO AQUI', () => { combat.markPoint(game.player.feet); combat.setZombieGoal('point'); }, 0x66617b],
    ['reset', () => 'REINICIAR TREINO', () => combat.reset(), 0x8c4c4f],
  ];
  const geometry = new THREE.BoxGeometry(1.45, .42, .16); resources.add(geometry);
  specs.forEach(([id, text, action, color], index) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .55, emissive: color, emissiveIntensity: .15 }); resources.add(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set((index % 4 - 1.5) * 1.55, 2.28 - Math.floor(index / 4) * .51, .2);
    mesh.userData.keepStandard = true; root.add(mesh);
    const record = { id, label: text(), text, action, mesh, caption: null }; buttons.push(record);
    record.caption = label(record.label, 1.38, .36, 34); record.caption.position.z = .085; mesh.add(record.caption);
  });
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(board);
  const obstacle = { min: { x: bounds.min.x, y: 0, z: bounds.min.z }, max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z } };
  game.training.obstacles.push(obstacle);
  function available() { return game.training.active && game.player.active && combat.canPlayerAct && !game.ui?.weaponWheelOpen && !game.ui?.mapOpen; }
  function probe() {
    focused = null; if (!available() || game.ui?.combatHUD?.panelOpen) return null;
    const camera = game.engine.camera; camera.updateWorldMatrix(true, false); root.updateWorldMatrix(true, true);
    ray.setFromCamera(new THREE.Vector2(0, 0), camera); ray.far = 14;
    const hit = ray.intersectObjects(buttons.map(b => b.mesh), false)[0];
    if (hit && hit.point.distanceTo(game.player.feet) <= 8) focused = buttons.find(b => b.mesh === hit.object);
    return focused;
  }
  function execute(id) {
    const button = buttons.find(b => b.id === id);
    if (!button || !available()) return false;
    button.action(); refresh(); game.audio?.ui('confirm'); return true;
  }
  function interact() { const button = probe(); if (!button) return false; execute(button.id); return true; }
  function refresh() {
    for (const button of buttons) {
      button.mesh.material.emissiveIntensity = button === focused ? .7 : .15;
      const text = button.text(); if (text === button.label) continue;
      const old = button.caption; button.mesh.remove(old); old.material.map.dispose(); old.material.dispose(); old.geometry.dispose();
      resources.delete(old.material.map); resources.delete(old.material); resources.delete(old.geometry);
      button.label = text; button.caption = label(text, 1.38, .36, 34); button.caption.position.z = .085; button.mesh.add(button.caption);
    }
  }
  game.input.bind('KeyE', interact, { label: 'acionar botão de treino sob a mira' });
  game.input.bind('KeyY', () => combat.markAimPoint(), { label: 'marcar objetivo dos zumbis no chão' });
  return { root, buttons, probe, execute, interact, refresh, get focused() { return focused; }, get difficulty() { return difficulty; },
    dispose() { root.removeFromParent(); for (const resource of resources) resource.dispose(); game.training.obstacles.splice(game.training.obstacles.indexOf(obstacle), 1); },
  };
}
