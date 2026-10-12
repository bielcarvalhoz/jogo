import fs from 'node:fs';

// Inputs: Iconify's game-icons.json and paths from the official icons repository.
// See public/icons/README.md for upstream URLs and licenses.
const pack = JSON.parse(fs.readFileSync(process.argv[2] || 'artifacts/source-assets/game-icons.json'));
const paths = fs.readFileSync(process.argv[3] || 'artifacts/source-assets/game-icons-paths.txt', 'utf8').trim().split(/\r?\n/);
const names = { fly: 'airplane', rotate: 'clockwise-rotation', fire: 'target-shot', aim: 'crosshair', jump: 'plain-arrow', menu: 'hamburger-menu', color: 'paint-bucket', music: 'musical-notes', effects: 'speaker', pistol: 'pistol-gun', automatic: 'rifle', 'camera-third': 'person', 'camera-first': 'eye-target', revolver: 'revolver', shotgun: 'shotgun', sniper: 'crosshair-arrow', smg: 'uzi', knife: 'bowie-knife', axe: 'hatchet', bat: 'baseball-bat', fists: 'fist', pickup: 'hand', holster: 'save-arrow', crouch: 'kneeling', interactions: 'conversation', wave: 'hand', dance: 'musical-notes', reload: 'reload-gun-barrel', trophy: 'trophy-cup', more: 'gamepad', close: 'cancel', skull: 'skull-crossed-bones', headshot: 'dead-eye', shield: 'shield' };
const symbols = [], credits = [];
const localSymbols = {
  fire: '<symbol id="fire" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></symbol>',
  jump: '<symbol id="jump" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></symbol>',
};
const authorNames = { lorc: 'Lorc', delapouite: 'Delapouite', skoll: 'Skoll', sbed: 'Sbed', 'john-colburn': 'John Colburn', 'carl-olsen': 'Carl Olsen', 'willdabeast': 'Willdabeast' };
for (const [id, name] of Object.entries(names)) {
  if (localSymbols[id]) {
    symbols.push(localSymbols[id]); credits.push(`| ${id} | ${id === 'fire' ? 'Concentric circles' : 'Up arrow'} | Project SVG |`); continue;
  }
  const item = pack.icons[name]; if (!item) throw new Error(`Missing icon ${name}`);
  const candidates = paths.filter(p => p.endsWith(`/${name}.svg`) && !p.startsWith('badges/'));
  let source = candidates.length === 1 ? candidates[0] : null;
  if (!source) {
    // Iconify rounds arc radii; the initial move still identifies the artwork.
    const move = body => body.match(/ d="[mM]([\d.\-\s,]+)/g)?.map(d => d.match(/-?\d*\.?\d+/g).slice(0, 2).map(Number)) || [];
    const [x, y] = move(item.body)[0]; let closest = Infinity;
    for (const candidate of candidates) {
      const response = await fetch(`https://raw.githubusercontent.com/game-icons/icons/master/${candidate}`);
      if (!response.ok) throw new Error(`Cannot verify ${candidate}: ${response.status}`);
      for (const [cx, cy] of move(await response.text())) {
        const distance = Math.hypot(cx - x, cy - y);
        if (distance < 1 && distance < closest) { source = candidate; closest = distance; }
      }
    }
  }
  if (!source || !paths.includes(source)) throw new Error(`Verify upstream attribution for ${name}`);
  const author = source.split('/')[0];
  symbols.push(`<symbol id="${id}" viewBox="0 0 ${item.width || pack.width} ${item.height || pack.height}" fill="currentColor">${item.body.replace(/#fff|#ffffff|white/g, 'currentColor')}</symbol>`);
  credits.push(`| ${id} | [${name}](https://game-icons.net/1x1/${author}/${name}.html) | ${authorNames[author] || author} |`);
}
fs.writeFileSync('public/icons/controls.svg', `<svg xmlns="http://www.w3.org/2000/svg">\n<!-- Game-icons.net, CC BY 3.0, except hand-authored fire/jump. Sources: README.md. Uses currentColor. -->\n${symbols.join('\n')}\n</svg>\n`);
fs.writeFileSync('public/icons/README.md', `# Game Icons\n\nFire and jump are hand-authored project SVGs. Remaining artwork is from [Game-icons.net](https://game-icons.net), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Individual authors and source links are below. Imported icons use transparent backgrounds, currentColor fills and symbol IDs. See LICENSE-GameIcons.txt.\n\nImported from the [Iconify game-icons collection](https://raw.githubusercontent.com/iconify/icon-sets/master/json/game-icons.json); author paths are from the [official SVG repository](https://github.com/game-icons/icons). Run scripts/import-game-icons.mjs with the downloaded collection JSON and a newline-separated list of SVG paths from that repository.\n\n| Symbol | Original | Author |\n| --- | --- | --- |\n${credits.join('\n')}\n`);
console.log(`Imported ${symbols.length} Game Icons with attribution.`);
