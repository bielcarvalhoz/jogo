import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE } from '../core/index.js';

const $ = id => document.getElementById(id);
const labels = { hairStyle: 'Cabelo', hairColor: 'Cor do cabelo', eyeStyle: 'Olhos', eyeColor: 'Cor dos olhos', beard: 'Barba',
  shirtStyle: 'Roupa', shirtColor: 'Cor da roupa', pantsStyle: 'Calça', pantsColor: 'Cor da calça',
  shoeStyle: 'Calçado', shoeColor: 'Cor do calçado', faceAccessory: 'No rosto', headAccessory: 'Na cabeça', accessoryColor: 'Cor dos acessórios' };
const modeNames = { campaign: 'treta · um jogador', multiplayer: 'treta · multijogador', training: 'treino', tour: 'tour' };

export function createCharacterMenu(game) {
  const store = game.characters, dialog = $('character-panel'), editor = $('character-editor');
  let chosenId = null, draft = null, preview = null, onConfirm = null, mode = null;
  const controls = new Map();
  for (const key of Object.keys(DEFAULT_APPEARANCE)) {
    const label = document.createElement('label'); label.textContent = labels[key];
    const input = document.createElement(APPEARANCE_OPTIONS[key] ? 'select' : 'input');
    input.id = `character-${key}`; input.name = key;
    if (APPEARANCE_OPTIONS[key]) for (const [value, text] of Object.entries(APPEARANCE_OPTIONS[key])) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; input.appendChild(option);
    } else input.type = 'color';
    label.appendChild(input); $('character-fields').appendChild(label); controls.set(key, input);
    input.addEventListener('input', () => { if (draft) { draft.appearance[key] = input.value; showPreview(draft); } });
  }
  const chosen = () => store.characters.find(item => item.id === chosenId);
  function showPreview(character) {
    if (!dialog.open) return;
    preview ||= game.player.createCharacterPreview($('character-preview'));
    preview.show(character.appearance); $('character-preview-name').textContent = character.name || 'Seu personagem';
  }
  function renderRoster() {
    $('character-list').replaceChildren();
    for (const character of store.characters) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.characterId = character.id;
      button.setAttribute('aria-pressed', String(character.id === chosenId));
      const swatch = document.createElement('i'); swatch.style.backgroundColor = character.appearance.shirtColor; swatch.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.textContent = character.name; button.append(swatch, name);
      button.addEventListener('click', () => {
        chosenId = character.id; draft = null; editor.hidden = true; renderRoster(); showPreview(character);
        $('character-status').textContent = `${character.name} está pronto. Confirme para continuar.`;
      });
      $('character-list').appendChild(button);
    }
    $('character-edit').disabled = !chosenId || !!draft;
    $('character-confirm').disabled = !chosenId || !!draft;
    $('character-confirm').hidden = !!draft; $('character-edit-actions').hidden = !draft;
    dialog.classList.toggle('editing', !!draft);
  }
  function edit(character) {
    draft = { ...character, appearance: { ...character.appearance } }; editor.hidden = false;
    $('character-name').value = draft.name;
    for (const [key, input] of controls) input.value = draft.appearance[key];
    renderRoster(); showPreview(draft); $('character-name').focus();
    $('character-status').textContent = 'Monte o visual e salve para usar este personagem.';
  }
  $('character-new').addEventListener('click', () => edit({ name: '', appearance: { ...DEFAULT_APPEARANCE } }));
  $('character-edit').addEventListener('click', () => { if (chosen()) edit(chosen()); });
  $('character-name').addEventListener('input', () => {
    if (draft) { draft.name = $('character-name').value; $('character-preview-name').textContent = draft.name || 'Seu personagem'; }
  });
  $('character-edit-cancel').addEventListener('click', () => {
    draft = null; editor.hidden = true; renderRoster(); showPreview(chosen() || store.characters[0]);
    $('character-status').textContent = chosenId ? 'Edição cancelada. Seu personagem foi mantido.' : 'Selecione um personagem para continuar.';
  });
  editor.addEventListener('submit', event => {
    event.preventDefault(); if (!draft) return;
    try {
      const character = store.save({ ...draft, name: $('character-name').value });
      chosenId = character.id; draft = null; editor.hidden = true; renderRoster(); showPreview(character);
      $('character-status').textContent = store.persisted ? `${character.name} salvo. Confirme para continuar.` : `${character.name} pronto nesta sessão. O navegador não permitiu salvar no aparelho.`;
      $('character-confirm').focus();
    } catch (error) { $('character-status').textContent = error.message; $('character-name').focus(); }
  });
  $('character-confirm').addEventListener('click', () => {
    if (draft || !chosen()) return;
    const character = store.select(chosenId); game.player.applyCharacter(character);
    const proceed = onConfirm; onConfirm = null; dialog.close();
    if (proceed) proceed(character);
  });
  $('character-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { preview?.stop(); onConfirm = null; draft = null; });
  return {
    open(options = {}) {
      mode = options.mode || null; onConfirm = options.onConfirm || null; draft = null;
      chosenId = store.selected?.id || null; editor.hidden = true;
      $('character-title').textContent = mode ? 'Quem vai entrar nessa?' : 'Seus personagens';
      $('character-description').textContent = mode ? `Escolha seu personagem antes de entrar no modo ${modeNames[mode]}.` : 'Crie, personalize e escolha quem vai representar você.';
      $('character-confirm').textContent = mode ? `Jogar ${modeNames[mode]}` : 'Usar personagem';
      $('character-status').textContent = chosenId ? 'Confirme seu personagem ou escolha outro.' : 'Selecione um personagem ou crie o seu para continuar.';
      renderRoster(); dialog.showModal(); showPreview(chosen() || store.characters[0]);
    },
    get openState() { return dialog.open; },
  };
}
