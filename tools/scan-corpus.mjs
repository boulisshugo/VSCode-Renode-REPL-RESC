#!/usr/bin/env node
// Tokenize a tree of real Renode files and report what the grammars leave
// unclassified, so gaps show up as data instead of guesswork.
//
//   node tools/scan-corpus.mjs <dir> [--show <n>] [--files]
import fs from 'node:fs';
import path from 'node:path';
import { loadGrammar, tokenize } from '../test/helpers.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const show = Number(args[args.indexOf('--show') + 1]) || 40;
const listFiles = args.includes('--files');

if (!dir) {
  console.error('usage: node tools/scan-corpus.mjs <dir> [--show <n>] [--files]');
  process.exit(2);
}

function* walk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const grammars = {
  '.repl': await loadGrammar('source.renode-repl'),
  '.resc': await loadGrammar('source.renode-resc')
};

const stats = {};
for (const ext of Object.keys(grammars)) {
  stats[ext] = { files: 0, tokens: 0, unscoped: 0, kinds: new Map() };
}

for (const file of walk(dir)) {
  const ext = path.extname(file);
  const grammar = grammars[ext];
  if (!grammar) continue;

  const s = stats[ext];
  s.files++;
  const tokens = tokenize(grammar, fs.readFileSync(file, 'utf8'));
  for (const token of tokens) {
    s.tokens++;
    if (token.scopes.length > 1) continue;
    s.unscoped++;
    const key = token.text.trim();
    if (!s.kinds.has(key)) s.kinds.set(key, { count: 0, files: new Set() });
    const hit = s.kinds.get(key);
    hit.count++;
    hit.files.add(path.relative(dir, file));
  }
}

let worst = 0;
for (const [ext, s] of Object.entries(stats)) {
  const pct = s.tokens ? ((s.unscoped / s.tokens) * 100).toFixed(2) : '0.00';
  console.log(
    `\n${ext}: ${s.files} files, ${s.tokens} tokens, ` +
      `${s.unscoped} unclassified (${pct}%), ${s.kinds.size} distinct`
  );
  worst = Math.max(worst, s.unscoped);
  const ranked = [...s.kinds].sort((a, b) => b[1].count - a[1].count).slice(0, show);
  for (const [text, hit] of ranked) {
    const where = listFiles ? `  <- ${[...hit.files].slice(0, 2).join(', ')}` : '';
    console.log(`  ${String(hit.count).padStart(5)}  ${JSON.stringify(text)}${where}`);
  }
}

process.exit(worst === 0 ? 0 : 1);
