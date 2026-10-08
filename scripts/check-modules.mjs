// Verifica as fronteiras entre módulos (roda em `npm test` e `npm run check:modules`).
//
// Regras:
//  1. Um módulo só importa outro pelo index.js dele (a API pública). Exceção: shared/.
//  2. Só valem as dependências da tabela DEPENDENCIAS abaixo (evita ciclos e acoplamento
//     escondido). Precisa de uma nova? Mude a tabela E docs/ARQUITETURA.md no mesmo PR.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const DEPENDENCIAS = {
  app: ['core', 'map', 'campus', 'player', 'gameplay/paintball', 'ui', 'debug', 'shared'],
  shared: [],
  core: ['shared'],
  map: ['core', 'shared'],
  campus: ['map', 'core', 'shared'],
  player: ['core', 'shared'],
  'gameplay/paintball': ['player', 'map', 'core', 'shared'],
  ui: ['core', 'shared'],
  debug: ['core', 'map', 'campus', 'player', 'gameplay/paintball', 'ui', 'shared'],
};

const moduleOf = (abs) => {
  const rel = path.relative(SRC, abs).split(path.sep);
  if (rel.length === 1) return 'app';
  return rel[0] === 'gameplay' ? `gameplay/${rel[1]}` : rel[0];
};
const moduleRoot = (mod) => path.join(SRC, ...mod.split('/'));

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.m?js$/.test(e.name)) files.push(p);
  }
})(SRC);

const errors = [];
const importRe = /(?:from\s+|import\s*\(\s*|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
for (const file of files) {
  const from = moduleOf(file);
  if (!DEPENDENCIAS[from]) { errors.push(`${path.relative(ROOT, file)}: pasta "${from}" não é um módulo conhecido (adicione em scripts/check-modules.mjs)`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(importRe)) {
    const target = path.resolve(path.dirname(file), m[2]);
    if (!target.startsWith(SRC)) continue;
    const to = moduleOf(target);
    if (to === from) continue;
    const where = `${path.relative(ROOT, file)} → ${m[2]}`;
    if (!DEPENDENCIAS[from].includes(to)) errors.push(`${where}: "${from}" não pode depender de "${to}"`);
    else if (to !== 'shared' && target !== path.join(moduleRoot(to), 'index.js')) errors.push(`${where}: importe pela API pública (${to}/index.js), não pelo interior do módulo`);
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} violação(ões) de fronteira entre módulos:\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✓ fronteiras entre módulos ok (${files.length} arquivos)`);
