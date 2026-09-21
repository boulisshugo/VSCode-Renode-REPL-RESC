import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadGrammar, tokenize } from './helpers.mjs';

// Opt-in regression against a real Renode checkout:
//   git clone --depth 1 https://github.com/renode/renode /tmp/renode
//   RENODE_CORPUS=/tmp/renode npm test
//
// Every token in every upstream .repl/.resc file must carry a scope. A token
// left with only the root scope means a rule stopped matching real-world
// syntax, which is exactly the regression this guards against.
const corpus = process.env.RENODE_CORPUS;

function* walk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

test('upstream Renode files are fully classified', { skip: !corpus }, async () => {
  const grammars = {
    '.repl': await loadGrammar('source.renode-repl'),
    '.resc': await loadGrammar('source.renode-resc')
  };

  const misses = [];
  let files = 0;
  for (const file of walk(corpus)) {
    const grammar = grammars[path.extname(file)];
    if (!grammar) continue;
    files++;
    for (const token of tokenize(grammar, fs.readFileSync(file, 'utf8'))) {
      if (token.scopes.length <= 1) {
        misses.push(`${path.relative(corpus, file)}: ${JSON.stringify(token.text)}`);
      }
    }
  }

  assert.ok(files > 0, `no .repl/.resc files found under ${corpus}`);
  assert.deepEqual(misses.slice(0, 20), [], `${misses.length} unclassified tokens`);
});
