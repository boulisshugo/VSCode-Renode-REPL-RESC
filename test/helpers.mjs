import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Both packages ship CommonJS without named-export detection under ESM,
// so pull them in through createRequire rather than `import * as`.
const require = createRequire(import.meta.url);
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCOPES = {
  'source.renode-repl': 'syntaxes/renode-repl.tmLanguage.json',
  'source.renode-resc': 'syntaxes/renode-resc.tmLanguage.json'
};

let registryPromise;

function createRegistry() {
  const wasm = fs.readFileSync(
    path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm')
  );
  const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (s) => new oniguruma.OnigString(s)
  }));

  return new textmate.Registry({
    onigLib,
    // Grammars we do not ship (e.g. source.python, embedded in `python """..."""`)
    // resolve to null, which vscode-textmate treats as "leave it unhighlighted".
    loadGrammar: async (scopeName) => {
      // VS Code ships source.python; stand in for it so the embedded-python
      // rule compiles here exactly as it does in the editor. An unresolved
      // include makes vscode-textmate drop the entire enclosing rule.
      if (scopeName === 'source.python') {
        return textmate.parseRawGrammar(
          JSON.stringify({
            scopeName: 'source.python',
            patterns: [{ name: 'keyword.control.python', match: '\\b(print|def|import)\\b' }]
          }),
          'stub.python.json'
        );
      }
      const file = SCOPES[scopeName];
      if (!file) return null;
      const content = fs.readFileSync(path.join(root, file), 'utf8');
      return textmate.parseRawGrammar(content, file);
    }
  });
}

export async function loadGrammar(scopeName) {
  registryPromise ??= Promise.resolve(createRegistry());
  const registry = await registryPromise;
  const grammar = await registry.loadGrammar(scopeName);
  if (!grammar) throw new Error(`grammar not found: ${scopeName}`);
  return grammar;
}

/**
 * Tokenize `text` and return a flat list of { text, scopes } for every token,
 * carrying rule state across lines so multi-line constructs are covered.
 */
export function tokenize(grammar, text) {
  const out = [];
  let ruleStack = textmate.INITIAL;
  for (const line of text.split('\n')) {
    const result = grammar.tokenizeLine(line, ruleStack);
    for (const token of result.tokens) {
      const value = line.substring(token.startIndex, token.endIndex);
      if (value.trim() === '') continue;
      out.push({ text: value, scopes: token.scopes });
    }
    ruleStack = result.ruleStack;
  }
  return out;
}

/** Scopes applied to the first token whose (trimmed) text equals `needle`. */
export function scopesOf(tokens, needle) {
  const token = tokens.find((t) => t.text === needle || t.text.trim() === needle);
  if (!token) {
    throw new Error(
      `no token exactly matching ${JSON.stringify(needle)}; got: ` +
        JSON.stringify(tokens.map((t) => t.text))
    );
  }
  return token.scopes;
}

/** True when `needle` is tokenized with a scope starting with `scopePrefix`. */
export function hasScope(tokens, needle, scopePrefix) {
  return scopesOf(tokens, needle).some((s) => s.startsWith(scopePrefix));
}

/** True when SOME token with this text carries a scope starting with the prefix. */
export function anyHasScope(tokens, needle, scopePrefix) {
  return tokens.some(
    (t) =>
      (t.text === needle || t.text.trim() === needle) &&
      t.scopes.some((s) => s.startsWith(scopePrefix))
  );
}

export const readSample = (name) =>
  fs.readFileSync(path.join(root, 'samples', name), 'utf8');
