import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrammar, tokenize, scopesOf, hasScope, anyHasScope, readSample } from './helpers.mjs';

const grammar = await loadGrammar('source.renode-repl');
const tok = (src) => tokenize(grammar, src);

test('peripheral declaration splits name, namespace and class', () => {
  const t = tok('uart0: UART.PL011 @ sysbus 0x40011000');
  assert.ok(hasScope(t, 'uart0', 'entity.name.type.peripheral'));
  assert.ok(hasScope(t, 'UART.', 'support.class'));
  assert.ok(hasScope(t, 'PL011', 'entity.name.class'));
  assert.ok(hasScope(t, '@', 'keyword.operator.registration'));
  assert.ok(hasScope(t, 'sysbus', 'variable.language.sysbus'));
  assert.ok(hasScope(t, '0x40011000', 'constant.numeric.hex'));
});

test('declaration without a type still highlights the entry name', () => {
  const t = tok('sysbus:');
  assert.ok(hasScope(t, 'sysbus', 'entity.name.type.peripheral'));
});

test('indented lines are properties, not declarations', () => {
  const t = tok('uart0: UART.PL011 @ sysbus 0x1000\n    size: 0x100');
  assert.ok(hasScope(t, 'size', 'variable.other.property'));
  assert.ok(!hasScope(t, 'size', 'entity.name.type'));
});

test('IRQ connection with an explicit signal name', () => {
  const t = tok('spi: SPI.Ctrl @ sysbus 0x1000\n    IRQ -> nvic@35');
  assert.ok(hasScope(t, 'IRQ', 'entity.name.function.irq'));
  assert.ok(hasScope(t, '->', 'keyword.operator.irq'));
  assert.ok(hasScope(t, 'nvic', 'variable.other.peripheral'));
  assert.ok(hasScope(t, '35', 'constant.numeric.irq'));
});

test('default IRQ connection without a signal name', () => {
  const t = tok('nvic: IRQControllers.NVIC @ sysbus 0xE000E000\n    -> cpu@0');
  assert.ok(hasScope(t, '->', 'keyword.operator.irq'));
  assert.ok(hasScope(t, '0', 'constant.numeric.irq'));
});

test('address range with base and size', () => {
  const t = tok('spi: SPI.Ctrl @ sysbus <0x40013000, +0x1000>');
  assert.ok(hasScope(t, '<', 'punctuation.definition.range.begin'));
  assert.ok(hasScope(t, '0x40013000', 'constant.numeric.hex'));
  assert.ok(hasScope(t, '+', 'keyword.operator.arithmetic'));
  assert.ok(hasScope(t, '>', 'punctuation.definition.range.end'));
});

test('multi-registration block', () => {
  const t = tok('spi1: SPI.SomeChip @ {\n        sysbus 0x40010000;\n        bridge\n    }');
  assert.ok(hasScope(t, '{', 'punctuation.section.block.begin'));
  assert.ok(hasScope(t, ';', 'punctuation.terminator'));
  assert.ok(hasScope(t, '}', 'punctuation.section.block.end'));
  assert.ok(hasScope(t, 'bridge', 'variable.other'));
});

test('string, boolean and enum property values', () => {
  const t = tok('cpu: CPU.CortexM @ sysbus\n    cpuType: "cortex-m4"\n    enabled: true\n    mode: TransferMode.FullDuplex');
  assert.ok(hasScope(t, 'cortex-m4', 'string.quoted.double'));
  assert.ok(hasScope(t, 'true', 'constant.language'));
  assert.ok(hasScope(t, 'FullDuplex', 'constant.other.enum'));
});

test('using directive with and without a prefix', () => {
  const plain = tok('using "platforms/cpus/stm32f4.repl"');
  assert.ok(hasScope(plain, 'using', 'keyword.control.import'));
  assert.ok(hasScope(plain, '"platforms/cpus/stm32f4.repl"', 'string.quoted.double'));

  const prefixed = tok('using "a.repl" prefixed "pfx_"');
  assert.ok(hasScope(prefixed, 'prefixed', 'keyword.control.import'));
});

test('comments win over code but not over strings', () => {
  const t = tok('uart0: UART.PL011 // the console');
  assert.ok(hasScope(t, '//', 'punctuation.definition.comment'));
  assert.ok(scopesOf(t, 'the console').some((s) => s.startsWith('comment.line')));

  const s = tok('sysbus:\n    init:\n        Tag <0x0, 0x10> "not // a comment"');
  assert.ok(scopesOf(s, 'not // a comment').some((x) => x.startsWith('string.quoted')));
});

test('init block header', () => {
  const t = tok('sysbus:\n    init:\n        ApplySVD @svd/stm32f4.svd');
  assert.ok(hasScope(t, 'init', 'keyword.control.block'));
  assert.ok(hasScope(t, 'svd/stm32f4.svd', 'string.unquoted.path'));
});

test('"@ none" is a constant, not a path', () => {
  const t = tok('virtualCpu: CPU.CortexM @ none');
  assert.ok(hasScope(t, '@', 'keyword.operator.registration'));
  assert.ok(hasScope(t, 'none', 'constant.language'));
});

test('binary and decimal literals', () => {
  const t = tok('x: Foo.Bar @ sysbus 0x0\n    a: 0b11110000\n    b: 168000000');
  assert.ok(hasScope(t, '0b11110000', 'constant.numeric.binary'));
  assert.ok(hasScope(t, '168000000', 'constant.numeric.decimal'));
});

test('pin ranges on both sides of the IRQ arrow', () => {
  const t = tok('gpio: GPIOPort.Stm32 @ sysbus 0x0\n    [0-3] -> nvic@[6-9]');
  assert.ok(hasScope(t, '->', 'keyword.operator.irq'));
  assert.ok(hasScope(t, '[6-9]', 'constant.numeric.irq'));
});

test('every sample token is classified (no unscoped leftovers)', () => {
  const tokens = tok(readSample('demo.repl'));
  const unscoped = tokens.filter((t) => t.scopes.length <= 1);
  assert.deepEqual(unscoped.map((t) => t.text), []);
});

test('negative and fractional property values', () => {
  const t = tok('x: Foo.Bar @ sysbus 0x0\n    offset: -4\n    ratio: 1.5');
  assert.ok(hasScope(t, '-4', 'constant.numeric.decimal'));
  assert.ok(hasScope(t, '1.5', 'constant.numeric.decimal'));
});

test('pin range separator is not read as a negative number', () => {
  const t = tok('gpio: GPIOPort.Stm32 @ sysbus 0x0\n    [0-3] -> nvic@[6-9]');
  assert.ok(hasScope(t, '-', 'keyword.operator.range'));
  assert.ok(hasScope(t, '3', 'constant.numeric.decimal'));
});

// --- constructs found by scanning the upstream renode/renode platform files ---

test('block comments span lines', () => {
  const t = tok('/*\n * Clock tree notes: PLLN = 16\n */\ncpu: CPU.CortexM @ sysbus');
  assert.ok(hasScope(t, '/*', 'punctuation.definition.comment.begin'));
  assert.ok(scopesOf(t, '* Clock tree notes: PLLN = 16').some((s) => s.startsWith('comment.block')));
  assert.ok(hasScope(t, '*/', 'punctuation.definition.comment.end'));
  // The comment must close so the following declaration still highlights.
  assert.ok(hasScope(t, 'cpu', 'entity.name.type.peripheral'));
});

test('connector index on an IRQ destination', () => {
  const t = tok('timer: Timers.ARM_GenericTimer @ cpu\n    EL3PhysicalTimerIRQ->gic#0@29');
  assert.ok(hasScope(t, 'EL3PhysicalTimerIRQ', 'entity.name.function.irq'));
  assert.ok(hasScope(t, 'gic', 'variable.other.peripheral'));
  assert.ok(hasScope(t, '#', 'keyword.operator.connector-index'));
  assert.ok(hasScope(t, '0', 'constant.numeric.connector'));
  assert.ok(hasScope(t, '29', 'constant.numeric.irq'));
});

test('hex connector index and hex IRQ line', () => {
  const t = tok('x: Foo.Bar @ sysbus 0x0\n    A->gic#0x1@30\n    B -> ldma@0x0040');
  assert.ok(hasScope(t, '0x1', 'constant.numeric.connector'));
  assert.ok(hasScope(t, '0x0040', 'constant.numeric.irq'));
});

test('several IRQ destinations separated by |', () => {
  const t = tok('spi: SPI.Ctrl @ sysbus 0x0\n    IRQ -> nvic@35 | dma@2 | dma@4');
  assert.ok(hasScope(t, '|', 'keyword.operator.irq-separator'));
  assert.ok(hasScope(t, '35', 'constant.numeric.irq'));
  assert.ok(hasScope(t, 'dma', 'variable.other.peripheral'));
});

test("python peripheral scripts use ''' and embed Python", () => {
  const t = tok("p: Python.PythonPeripheral @ sysbus 0x0\n    script: '''\nrequest.Value = 0x1\n'''\nnext: Foo.Bar @ sysbus 0x4");
  assert.ok(hasScope(t, "'''", 'punctuation.definition.string.begin'));
  assert.ok(scopesOf(t, 'request.Value = 0x1').some((s) => s.startsWith('meta.embedded.block.python')));
  // The block must close so the next declaration is still a declaration.
  assert.ok(hasScope(t, 'next', 'entity.name.type.peripheral'));
});

test('single-line python script', () => {
  const t = tok("p: Python.PythonPeripheral @ sysbus 0x0\n    script: '''request.Value = 0xFFFFFFFF'''");
  assert.ok(scopesOf(t, 'request.Value = 0xFFFFFFFF').some((s) => s.startsWith('meta.embedded.block.python')));
});

test('digit separators in numbers', () => {
  const t = tok('c: Clk.Src @ sysbus 0x0\n    frequency: 100_000_000');
  assert.ok(hasScope(t, '100_000_000', 'constant.numeric.decimal'));
});

test('identifiers containing digits and underscores are not numbers', () => {
  const t = tok('U74_2: CPU.RiscV64 @ sysbus\n    privilegedArchitecture: PrivilegedArchitecture.Priv1_10');
  assert.ok(hasScope(t, 'U74_2', 'entity.name.type.peripheral'));
  assert.ok(hasScope(t, 'Priv1_10', 'constant.other.enum'));
});

test('backtick Monitor expressions inside a reset block', () => {
  const t = tok('cpu: CPU.RiscV32 @ sysbus\n    reset:\n        PC `syscon ResetVector`');
  assert.ok(hasScope(t, 'reset', 'keyword.control.block'));
  assert.ok(hasScope(t, 'PC', 'variable.language.register'));
  assert.ok(scopesOf(t, 'syscon').some((s) => s.startsWith('string.interpolated')));
});

test('enum value with the type omitted', () => {
  const t = tok('gic: IRQControllers.GIC @ sysbus 0x0\n    architectureVersion: .GICv3');
  assert.ok(hasScope(t, 'GICv3', 'constant.other.enum'));
});

test('multi-segment enum values', () => {
  const t = tok('g: A.B @ sysbus 0x0\n    v: IRQControllers.ARM_GenericInterruptControllerVersion.GICv3');
  assert.ok(hasScope(t, 'GICv3', 'constant.other.enum'));
});

test('nested lists', () => {
  const t = tok('g: GPIOPort.Gpio @ sysbus 0x0\n    invertedAFPins: [[1, 5], [7, 2]]');
  const brackets = t.filter((x) => x.text === ']');
  assert.equal(brackets.length, 3);
  for (const b of brackets) {
    assert.ok(b.scopes.some((s) => s.startsWith('punctuation.section.brackets.end')));
  }
});

test("'#' is a comment in init blocks but a connector index in wiring", () => {
  const comment = tok('sysbus:\n    init:\n        SilenceRange <0x82003000 0x200> # ddrphy');
  assert.ok(scopesOf(comment, 'ddrphy').some((s) => s.startsWith('comment.line.number-sign')));

  const index = tok('t: T.T @ cpu\n    IRQ->gic#0@29');
  assert.ok(hasScope(index, '#', 'keyword.operator.connector-index'));
});

test('keyword arguments on Monitor commands in init blocks', () => {
  const t = tok('sysbus:\n    init:\n        Tag <0x40033000 0x1000> "XCACHE0" silent=true');
  assert.ok(hasScope(t, 'silent', 'variable.other'));
  assert.ok(hasScope(t, '=', 'keyword.operator.assignment'));
  assert.ok(hasScope(t, 'true', 'constant.language'));
});

test('sysbus member chains', () => {
  const t = tok('sysbus:\n    init:\n        MarkAsSkippedOnLifeCycleReset sysbus.rstmgr_aon');
  // The first `sysbus` is the entry header, the second is the command argument.
  assert.ok(anyHasScope(t, 'sysbus', 'variable.language.sysbus'));
  assert.ok(hasScope(t, '.rstmgr_aon', 'variable.other.member'));
});
