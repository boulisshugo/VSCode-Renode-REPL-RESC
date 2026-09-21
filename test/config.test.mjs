import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('.repl does not declare <> as a bracket pair', () => {
  // The `>` of every `->` arrow would otherwise be an unmatched closing
  // bracket, which VS Code's bracket pair colorization paints red.
  const config = read('language-configuration/repl.json');
  const pairs = [...config.brackets, ...(config.colorizedBracketPairs ?? [])];
  for (const [open, close] of pairs) {
    assert.notEqual(open, '<', 'angle brackets must not be a bracket pair');
    assert.notEqual(close, '>', 'angle brackets must not be a bracket pair');
  }
});

test('every declared bracket pair is also the colorized set', () => {
  for (const file of ['language-configuration/repl.json', 'language-configuration/resc.json']) {
    const config = read(file);
    assert.ok(Array.isArray(config.brackets), `${file} declares brackets`);
    if (config.colorizedBracketPairs) {
      assert.deepEqual(
        config.colorizedBracketPairs,
        config.brackets,
        `${file}: colorized pairs must match the declared brackets`
      );
    }
  }
});

test('the declaration name is scoped apart from the type name', () => {
  // timer1 and Timers.ST54M_timer must not land on scopes that popular themes
  // collapse to the same color (entity.name.type / entity.name.class /
  // support.class are all one teal in Dark+).
  const grammar = read('syntaxes/renode-repl.tmLanguage.json');
  const captures = grammar.repository['entry-declaration'].captures;
  const name = captures['1'].name;
  const namespace = captures['3'].name;
  const cls = captures['4'].name;

  // Themes select on the first three segments, and these are the families
  // Dark+ and its derivatives all paint with the single "type" colour.
  const TYPE_FAMILIES = new Set([
    'entity.name.type',
    'entity.name.class',
    'entity.name.namespace',
    'support.class',
    'support.type'
  ]);
  const family = (scope) => scope.split('.').slice(0, 3).join('.');

  assert.ok(
    !TYPE_FAMILIES.has(family(name)),
    `declaration name is scoped ${name}, which themes colour as a type`
  );
  assert.ok(TYPE_FAMILIES.has(family(cls)), 'the type name should read as a type');
  assert.notEqual(family(name), family(cls));
  assert.notEqual(family(name), family(namespace));
});
