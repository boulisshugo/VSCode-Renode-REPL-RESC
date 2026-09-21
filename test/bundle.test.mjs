import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'renode-bundle-'));
execFileSync(process.execPath, [path.join(root, 'tools/build-textmate-bundle.mjs'), '--out', out], {
  stdio: 'pipe'
});

const manifest = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));

test('the bundle manifest declares both languages and grammars', () => {
  const ids = manifest.contributes.languages.map((l) => l.id).sort();
  assert.deepEqual(ids, ['renode-repl', 'renode-resc']);
  const scopes = manifest.contributes.grammars.map((g) => g.scopeName).sort();
  assert.deepEqual(scopes, ['source.renode-repl', 'source.renode-resc']);
});

test('every file the bundle manifest references is present in the bundle', () => {
  const referenced = [
    ...manifest.contributes.grammars.map((g) => g.path),
    ...manifest.contributes.languages.map((l) => l.configuration)
  ].filter(Boolean);
  assert.ok(referenced.length >= 4);
  for (const ref of referenced) {
    const file = path.join(out, ref.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(file), `${ref} is missing from the bundle`);
    JSON.parse(fs.readFileSync(file, 'utf8')); // must be valid JSON
  }
});

test('grammars loaded from the bundle still classify the samples', async () => {
  const wasm = fs.readFileSync(path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm'));
  const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
    createOnigScanner: (p) => new oniguruma.OnigScanner(p),
    createOnigString: (s) => new oniguruma.OnigString(s)
  }));

  const byScope = Object.fromEntries(
    manifest.contributes.grammars.map((g) => [g.scopeName, g.path.replace(/^\.\//, '')])
  );

  const registry = new textmate.Registry({
    onigLib,
    loadGrammar: async (scope) => {
      const rel = byScope[scope];
      if (!rel) return null; // e.g. source.python, which the bundle does not ship
      return textmate.parseRawGrammar(fs.readFileSync(path.join(out, rel), 'utf8'), rel);
    }
  });

  for (const [scope, sample] of [
    ['source.renode-repl', 'samples/preview.repl'],
    ['source.renode-resc', 'samples/preview.resc']
  ]) {
    const grammar = await registry.loadGrammar(scope);
    assert.ok(grammar, `${scope} failed to load from the bundle`);

    let ruleStack = textmate.INITIAL;
    const unscoped = [];
    for (const line of fs.readFileSync(path.join(root, sample), 'utf8').split('\n')) {
      const result = grammar.tokenizeLine(line, ruleStack);
      for (const token of result.tokens) {
        const text = line.substring(token.startIndex, token.endIndex);
        if (text.trim() && token.scopes.length <= 1) unscoped.push(text);
      }
      ruleStack = result.ruleStack;
    }
    assert.deepEqual(unscoped, [], `${sample} has unclassified tokens when loaded from the bundle`);
  }
});
