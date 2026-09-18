import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrammar, tokenize, scopesOf, hasScope, readSample } from './helpers.mjs';

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
