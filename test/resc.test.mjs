import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrammar, tokenize, scopesOf, hasScope, readSample } from './helpers.mjs';

const grammar = await loadGrammar('source.renode-resc');
const tok = (src) => tokenize(grammar, src);

test('script metadata headers', () => {
  const t = tok(':name: Demo board\n:description: Runs firmware.');
  assert.ok(hasScope(t, ':name:', 'keyword.other.directive'));
  assert.ok(hasScope(t, 'Demo board', 'string.unquoted.metadata'));
  assert.ok(hasScope(t, ':description:', 'keyword.other.directive'));
});

test('# starts a comment', () => {
  const t = tok('start # go');
  assert.ok(hasScope(t, 'start', 'keyword.control'));
  assert.ok(hasScope(t, '#', 'punctuation.definition.comment'));
  assert.ok(scopesOf(t, 'go').some((s) => s.startsWith('comment.line')));
});

test('# inside a string is not a comment', () => {
  const t = tok('mach create "node#1"');
  assert.ok(scopesOf(t, 'node#1').some((s) => s.startsWith('string.quoted')));
});

test('conditional and plain assignment', () => {
  const t = tok('$name?="demo"\n$other=3');
  assert.ok(hasScope(t, 'name', 'variable.other'));
  assert.ok(hasScope(t, '?=', 'keyword.operator.assignment'));
  assert.ok(hasScope(t, '=', 'keyword.operator.assignment'));
  assert.ok(hasScope(t, '3', 'constant.numeric.decimal'));
});

test('$ORIGIN is a language variable', () => {
  const t = tok('$repl?=@$ORIGIN/platform.repl');
  assert.ok(hasScope(t, 'ORIGIN', 'variable.language'));
});

test('@ paths are unquoted strings with interpolation', () => {
  const t = tok('machine LoadPlatformDescription @platforms/cpus/stm32f4.repl');
  assert.ok(hasScope(t, '@', 'punctuation.definition.path'));
  assert.ok(hasScope(t, 'platforms/cpus/stm32f4.repl', 'string.unquoted.path'));
});

test('a path ends at whitespace so later arguments still highlight', () => {
  const t = tok('sysbus LoadBinary @app.bin 0x20000000');
  assert.ok(hasScope(t, 'app.bin', 'string.unquoted.path'));
  assert.ok(hasScope(t, '0x20000000', 'constant.numeric.hex'));
});

test('built-in objects, peripheral paths and methods', () => {
  const t = tok('sysbus LoadELF $bin\nshowAnalyzer sysbus.uart0');
  assert.ok(hasScope(t, 'sysbus', 'support.class.builtin'));
  assert.ok(hasScope(t, 'LoadELF', 'support.function'));
  assert.ok(hasScope(t, 'showAnalyzer', 'support.function.builtin'));
  assert.ok(hasScope(t, '.uart0', 'variable.other.member'));
});

test('macro definition names the macro', () => {
  const t = tok('macro reset\n"""\n    sysbus LoadELF $bin\n"""');
  assert.ok(hasScope(t, 'macro', 'keyword.control.macro'));
  assert.ok(hasScope(t, 'reset', 'entity.name.function.macro'));
});

test('commands inside a triple-quoted macro body stay highlighted', () => {
  const t = tok('macro reset\n"""\n    cpu PC 0x08000000\n"""\nrunMacro $reset');
  assert.ok(hasScope(t, 'cpu', 'support.class.builtin'));
  assert.ok(hasScope(t, '0x08000000', 'constant.numeric.hex'));
  // The block must close so code after it is not swallowed.
  assert.ok(hasScope(t, 'runMacro', 'keyword.control'));
  assert.ok(hasScope(t, 'reset', 'entity.name.function.macro'));
});

test('negative log levels are numbers', () => {
  const t = tok('logLevel -1 sysbus.spi');
  assert.ok(hasScope(t, 'logLevel', 'support.function.builtin'));
  assert.ok(hasScope(t, '-1', 'constant.numeric.decimal'));
});

test('booleans in command arguments', () => {
  const t = tok('emulation CreateServerSocketTerminal 3456 "term" false');
  assert.ok(hasScope(t, 'emulation', 'support.class.builtin'));
  assert.ok(hasScope(t, 'CreateServerSocketTerminal', 'support.function'));
  assert.ok(hasScope(t, 'false', 'constant.language'));
});

test('single-letter aliases only count at the start of a line', () => {
  const alias = tok('s');
  assert.ok(hasScope(alias, 's', 'keyword.control'));
  const arg = tok('mach create s');
  assert.ok(!hasScope(arg, 's', 'keyword.control'));
});

test('embedded python block does not leak into the rest of the script', () => {
  const t = tok('python """\nprint("hi")\n"""\nstart');
  assert.ok(hasScope(t, 'python', 'keyword.control.python'));
  assert.ok(hasScope(t, 'start', 'keyword.control'));
});

test('every sample token is classified (no unscoped leftovers)', () => {
  const tokens = tok(readSample('demo.resc'));
  const unscoped = tokens.filter((t) => t.scopes.length <= 1);
  assert.deepEqual(unscoped.map((t) => t.text), []);
});
