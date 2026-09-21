import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrammar, tokenize, scopesOf, hasScope, anyHasScope, readSample } from './helpers.mjs';

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

// --- constructs found by scanning the upstream renode/renode scripts ---

test('description metadata continues on lines starting with a colon', () => {
  const t = tok(':name: UART Hub\n:communication between usart2<->usart2\n\nmach create "m0"');
  assert.ok(hasScope(t, ':name:', 'keyword.other.directive'));
  assert.ok(
    scopesOf(t, 'communication between usart2<->usart2').some((s) =>
      s.startsWith('string.unquoted.metadata')
    )
  );
  assert.ok(hasScope(t, 'mach', 'support.class.builtin'));
});

test("'//' is also accepted as a comment", () => {
  const t = tok('// eCSPI2 external chip-select (GPIO5)\nstart');
  assert.ok(scopesOf(t, 'eCSPI2 external chip-select (GPIO5)').some((s) => s.startsWith('comment.line')));
  assert.ok(hasScope(t, 'start', 'keyword.control'));
});

test("'//' inside a URL in a string is not a comment", () => {
  const t = tok('echo "see https://example.org/x"');
  assert.ok(scopesOf(t, 'see https://example.org/x').some((s) => s.startsWith('string.quoted.double')));
});

test('single-quoted strings', () => {
  const t = tok("e51 = machine['sysbus.e51']");
  assert.ok(scopesOf(t, 'sysbus.e51').some((s) => s.startsWith('string.quoted.single')));
});

test('inline platform fragments are highlighted as .repl', () => {
  const t = tok(
    "machine LoadPlatformDescriptionFromString 'dma: CoSimulated.Peripheral @ sysbus <0x43c20000, +0x100> { frequency: 100000; 0 -> gic@31 }'"
  );
  assert.ok(hasScope(t, 'LoadPlatformDescriptionFromString', 'support.function'));
  assert.ok(anyHasScope(t, '<', 'punctuation.definition.range.begin.renode-repl'));
  assert.ok(anyHasScope(t, '->', 'keyword.operator.irq.renode-repl'));
  assert.ok(anyHasScope(t, '31', 'constant.numeric.irq.renode-repl'));
});

test('inline platform fragments in double quotes', () => {
  const t = tok('machine LoadPlatformDescriptionFromString "bg96: Network.Quectel_BG96 @ usart2"');
  assert.ok(anyHasScope(t, 'bg96', 'entity.name.type.peripheral.renode-repl'));
  assert.ok(anyHasScope(t, 'Quectel_BG96', 'entity.name.class.renode-repl'));
});

test('multi-line inline platform fragments close correctly', () => {
  const t = tok(
    'machine LoadPlatformDescriptionFromString """\nextra: GPIOPort.Gpio @ sysbus 0x50000000\n    -> nvic@42\n"""\nstart'
  );
  assert.ok(anyHasScope(t, 'extra', 'entity.name.type.peripheral.renode-repl'));
  assert.ok(anyHasScope(t, '42', 'constant.numeric.irq.renode-repl'));
  assert.ok(hasScope(t, 'start', 'keyword.control'));
});

test('backtick Monitor expressions', () => {
  const t = tok('$id = `next_value 1`\ncpu VectorTableOffset `sysbus GetSymbolAddress "vectors"`');
  assert.ok(hasScope(t, '`', 'punctuation.definition.expression.begin'));
  assert.ok(anyHasScope(t, 'next_value', 'support.function.builtin'));
  assert.ok(anyHasScope(t, 'GetSymbolAddress', 'support.function'));
  assert.ok(anyHasScope(t, 'vectors', 'string.quoted.double'));
});

test('address ranges in Monitor commands', () => {
  const t = tok('sysbus Tag <0x40080000 0x400> "RADIO"');
  assert.ok(hasScope(t, '<', 'punctuation.definition.range.begin'));
  assert.ok(hasScope(t, '0x40080000', 'constant.numeric.hex'));
  assert.ok(hasScope(t, '>', 'punctuation.definition.range.end'));
});

test('peripheral paths with a non-built-in root', () => {
  const t = tok('twi0.lsm9ds1_imu MaxFifoDepth 2');
  assert.ok(hasScope(t, 'twi0', 'variable.other'));
  assert.ok(hasScope(t, '.lsm9ds1_imu', 'variable.other.member'));
  assert.ok(hasScope(t, 'MaxFifoDepth', 'support.function'));
});

test('bare $ORIGIN-relative paths without an @', () => {
  const t = tok('twi0.imu FeedSample $ORIGIN/../../tests/circle.data');
  assert.ok(hasScope(t, 'ORIGIN', 'variable.language'));
  assert.ok(
    scopesOf(t, '/../../tests/circle.data').some((s) => s.startsWith('string.unquoted.path'))
  );
});

test('CPU registers', () => {
  const t = tok('sysbus.cpu PC 0x1F003001\nsysbus.cpu SP 0x20025800');
  assert.ok(hasScope(t, 'PC', 'variable.language.register'));
  assert.ok(hasScope(t, 'SP', 'variable.language.register'));
});

test('custom peripherals and their methods', () => {
  const t = tok('sysbus.chipEvents SetControllerPort 18000\nsysbus.chipEvents ResolvePort "Spi"');
  assert.ok(hasScope(t, '.chipEvents', 'variable.other.member'));
  assert.ok(hasScope(t, 'SetControllerPort', 'support.function'));
  assert.ok(hasScope(t, '18000', 'constant.numeric.decimal'));
});
