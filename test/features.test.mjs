import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseRepl } = require('../src/core/replParser.js');
const { findPlatformPaths, loadPlatform } = require('../src/core/platformRef.js');
const { proposalsFor } = require('../src/core/completion.js');
const { lookup, methodsFor } = require('../src/core/commands.js');
const { buildRouting, renderPlatformView } = require('../src/core/graph.js');

const labels = (line, peripherals = []) => proposalsFor(line, peripherals).map((p) => p.label);

// --- .repl parsing ----------------------------------------------------------

test('parses a peripheral, its type, registration and address', () => {
  const { peripherals } = parseRepl('uart0: UART.PL011 @ sysbus 0x40011000\n    size: 0x100');
  assert.equal(peripherals.length, 1);
  const [p] = peripherals;
  assert.equal(p.name, 'uart0');
  assert.equal(p.type, 'UART.PL011');
  assert.equal(p.registeredOn, 'sysbus');
  assert.equal(p.address, '0x40011000');
  assert.deepEqual(p.properties.map((x) => x.name), ['size']);
});

test('parses IRQ destinations including connector index and separators', () => {
  const { peripherals } = parseRepl(
    'spi: SPI.C @ sysbus 0x0\n    IRQ -> nvic@35 | dma@2\ntimer: T.T @ cpu\n    A->gic#0x1@30'
  );
  assert.deepEqual(peripherals[0].irqs[0].destinations, [
    { peripheral: 'nvic', connector: undefined, line: '35' },
    { peripheral: 'dma', connector: undefined, line: '2' }
  ]);
  assert.deepEqual(peripherals[1].irqs[0], {
    signal: 'A',
    destinations: [{ peripheral: 'gic', connector: '0x1', line: '30' }],
    sourceLine: 3
  });
});

test('an unnamed arrow is the default IRQ', () => {
  const { peripherals } = parseRepl('nvic: IRQControllers.NVIC @ sysbus 0x0\n    -> cpu@0');
  assert.equal(peripherals[0].irqs[0].signal, 'IRQ');
});

test('block comments and // comments are ignored', () => {
  const { peripherals } = parseRepl('/* uart0: UART.PL011 @ sysbus 0x0 */\nram: Memory.M @ sysbus 0x0 // note');
  assert.deepEqual(peripherals.map((p) => p.name), ['ram']);
});

test('commands inside an init block are not read as properties', () => {
  const { peripherals } = parseRepl('sysbus:\n    init:\n        Tag <0x0, 0x10> "X"\n        ApplySVD @a.svd');
  assert.deepEqual(peripherals[0].properties, []);
});

test('collects using imports', () => {
  const { imports } = parseRepl('using "a.repl"\nusing "b.repl" prefixed "pfx_"');
  assert.deepEqual(imports.map((i) => [i.path, i.prefix]), [['a.repl', undefined], ['b.repl', 'pfx_']]);
});

test('every upstream platform file parses without throwing', { skip: !process.env.RENODE_CORPUS }, () => {
  const base = path.join(process.env.RENODE_CORPUS, 'platforms');
  const walk = function* (d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) yield* walk(f);
      else if (f.endsWith('.repl')) yield f;
    }
  };
  let files = 0;
  let peripherals = 0;
  for (const f of walk(base)) {
    files++;
    const r = parseRepl(fs.readFileSync(f, 'utf8'));
    peripherals += r.peripherals.length;
  }
  assert.ok(files > 200, `expected the full corpus, saw ${files} files`);
  assert.ok(peripherals > 3000, `expected thousands of peripherals, saw ${peripherals}`);
});

// --- resolving the platform a .resc loads ------------------------------------

test('finds the platform behind each quoting style', () => {
  const dir = '/scripts';
  assert.deepEqual(findPlatformPaths('machine LoadPlatformDescription @a/b.repl', dir), ['/scripts/a/b.repl']);
  assert.deepEqual(findPlatformPaths('machine LoadPlatformDescription "a/b.repl"', dir), ['/scripts/a/b.repl']);
  assert.deepEqual(findPlatformPaths("machine LoadPlatformDescription 'a/b.repl'", dir), ['/scripts/a/b.repl']);
});

test('resolves a platform given through a variable and $ORIGIN', () => {
  const text = '$repl ?= @$ORIGIN/board.repl\nmachine LoadPlatformDescription $repl';
  assert.deepEqual(findPlatformPaths(text, '/w'), ['/w/board.repl']);
});

test('absolute paths survive, and non-repl arguments are ignored', () => {
  // A Windows-authored script must not be resolved against the script folder.
  assert.deepEqual(
    findPlatformPaths('machine LoadPlatformDescription "S:/target/board.repl"', '/w'),
    ['S:/target/board.repl']
  );
  assert.deepEqual(findPlatformPaths('sysbus LoadELF @firmware.elf', '/w'), []);
});

test('loadPlatform follows using imports and merges the peripherals', () => {
  const files = {
    '/p/board.repl': 'using "cpu.repl"\nled: Misc.LED @ gpio 3',
    '/p/cpu.repl': 'cpu: CPU.CortexM @ sysbus\nuart0: UART.PL011 @ sysbus 0x4000'
  };
  const io = { readFile: (f) => files[f], exists: (f) => f in files };
  const result = loadPlatform('/p/board.repl', io);
  assert.deepEqual(result.peripherals.map((p) => p.name).sort(), ['cpu', 'led', 'uart0']);
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.missing, []);
});

test('a prefixed import prefixes the peripheral names', () => {
  const files = {
    '/p/top.repl': 'using "core.repl" prefixed "c0_"',
    '/p/core.repl': 'uart: UART.PL011 @ sysbus 0x0'
  };
  const result = loadPlatform('/p/top.repl', { readFile: (f) => files[f], exists: (f) => f in files });
  assert.deepEqual(result.peripherals.map((p) => p.name), ['c0_uart']);
});

test('an unresolvable import is reported, not thrown', () => {
  const files = { '/p/a.repl': 'using "nope.repl"\nram: Memory.M @ sysbus 0x0' };
  const result = loadPlatform('/p/a.repl', { readFile: (f) => files[f], exists: (f) => f in files });
  assert.deepEqual(result.peripherals.map((p) => p.name), ['ram']);
  assert.equal(result.missing.length, 1);
});

// --- completion --------------------------------------------------------------

const peripherals = [
  { name: 'uart0', type: 'UART.PL011', registeredOn: 'sysbus', address: '0x4000', irqs: [] },
  { name: 'nvic', type: 'IRQControllers.NVIC', registeredOn: 'sysbus', irqs: [] }
];

test('after "sysbus." the peripherals from the platform are proposed', () => {
  assert.deepEqual(labels('showAnalyzer sysbus.', peripherals), ['uart0', 'nvic']);
});

test('at the start of a line, Monitor commands and objects are proposed', () => {
  const out = labels('sta', peripherals);
  assert.ok(out.includes('start'));
  assert.ok(out.includes('sysbus'));
});

test('after a receiver, its methods are proposed', () => {
  const out = labels('sysbus ', peripherals);
  assert.ok(out.includes('LoadELF'));
  assert.ok(out.includes('WriteDoubleWord'));
});

test('peripherals are proposed fully qualified as arguments', () => {
  assert.ok(labels('connector Connect ', peripherals).includes('sysbus.uart0'));
});

test('nothing is proposed inside a comment or a string', () => {
  assert.deepEqual(labels('# sysbus.', peripherals), []);
  assert.deepEqual(labels('// sysbus.', peripherals), []);
  assert.deepEqual(labels('echo "sysbus.', peripherals), []);
});

test('a closed string does not suppress completion later in the line', () => {
  assert.ok(labels('mach create "m" ', peripherals).length > 0);
});

// --- command documentation ----------------------------------------------------

test('Monitor commands carry the description from Renode sources', () => {
  const [start] = lookup('start');
  assert.equal(start.kind, 'command');
  assert.match(start.documentation, /emulation/i);
  assert.ok(lookup('s').length, 'the "s" alias resolves');
});

test('object methods carry a signature and a description', () => {
  const [loadElf] = lookup('LoadELF');
  assert.equal(loadElf.kind, 'method');
  assert.match(loadElf.documentation, /sysbus LoadELF/);
  assert.ok(methodsFor('emulation').some((m) => m.name === 'CreateServerSocketTerminal'));
});

test('the extracted command set covers the common ones', () => {
  for (const name of ['start', 'pause', 'include', 'using', 'macro', 'runMacro', 'logLevel', 'showAnalyzer']) {
    assert.ok(lookup(name).length, `${name} is missing from the command data`);
  }
});

// --- routing view --------------------------------------------------------------

test('routing lays sources left of what they signal', () => {
  const platform = parseRepl(
    'uart0: UART.P @ sysbus 0x0\n    IRQ -> nvic@5\nnvic: IRQControllers.NVIC @ sysbus 0x1\n    -> cpu@0\ncpu: CPU.CortexM @ sysbus'
  ).peripherals;
  const routing = buildRouting(platform);
  const x = Object.fromEntries(routing.nodes.map((n) => [n.name, n.x]));
  assert.ok(x.uart0 < x.nvic, 'a source sits left of its controller');
  assert.ok(x.nvic < x.cpu, 'the controller sits left of the CPU');
  assert.equal(routing.edges.length, 2);
});

test('a destination the platform never declares is flagged', () => {
  const platform = parseRepl('spi: SPI.C @ sysbus 0x0\n    IRQ -> dma@2').peripherals;
  const routing = buildRouting(platform);
  assert.equal(routing.nodes.find((n) => n.name === 'dma').missing, true);
  assert.equal(routing.nodes.find((n) => n.name === 'spi').missing, false);
});

test('the view renders the diagram, the interrupt table and the memory map', () => {
  const platform = loadPlatform(path.join(root, 'samples/preview.repl'));
  const html = renderPlatformView(platform, { title: 'preview.repl' });
  assert.match(html, /<svg/);
  assert.match(html, /Interrupt lines/);
  assert.match(html, /Address space/);
  assert.match(html, /Regions/);
  assert.match(html, /preview\.repl/);
  assert.ok(!/<script/i.test(html), 'the webview needs no scripts');
});

test('a platform with no interrupts still renders', () => {
  const html = renderPlatformView({ peripherals: parseRepl('ram: Memory.M @ sysbus 0x0').peripherals });
  assert.match(html, /No interrupt connections/);
});

test('the routing view escapes values taken from the file', () => {
  const html = renderPlatformView({
    peripherals: [
      {
        name: 'evil',
        type: '<img src=x>',
        address: '0x0',
        irqs: [{ signal: 'IRQ', destinations: [{ peripheral: 'nvic', line: '1' }] }],
        properties: []
      }
    ]
  });
  assert.ok(!html.includes('<img src=x>'), 'type text must be escaped');
  assert.match(html, /&lt;img src=x&gt;/);
});

// --- go to definition ----------------------------------------------------------

const definitions = require('../src/core/definitions.js');
const { buildIndex, resolveType } = require('../src/core/peripheralIndex.js');

test('clicking a declaration type targets the type, the name targets the peripheral', () => {
  const line = 'timer1: Timers.ST54M_timer @ sysbus 0x40000000';
  assert.deepEqual(definitions.replTargetAt(line, 12), { kind: 'type', type: 'Timers.ST54M_timer' });
  assert.deepEqual(definitions.replTargetAt(line, 2), { kind: 'peripheral', name: 'timer1' });
});

test('clicking an IRQ destination targets that peripheral', () => {
  assert.deepEqual(definitions.replTargetAt('    IRQ -> nvic@4', 13), { kind: 'peripheral', name: 'nvic' });
  assert.deepEqual(definitions.replTargetAt('    A->gic#0@29', 9), { kind: 'peripheral', name: 'gic' });
});

test('clicking a new-registration type targets the type', () => {
  const line = '    @ sysbus new Bus.BusMultiRegistration { address: 0x0 }';
  assert.deepEqual(definitions.replTargetAt(line, 22), { kind: 'type', type: 'Bus.BusMultiRegistration' });
});

test('in a .resc a peripheral path targets its last segment', () => {
  assert.deepEqual(definitions.rescTargetAt('showAnalyzer sysbus.uart0', 22), { kind: 'peripheral', name: 'uart0' });
  assert.deepEqual(definitions.rescTargetAt('logLevel -1 spi0', 14), { kind: 'peripheral', name: 'spi0' });
});

test('a peripheral is located in the file that declares it', () => {
  const platform = loadPlatform(path.join(root, 'samples/preview.repl'));
  const found = definitions.locatePeripheral(platform, 'uart0');
  assert.ok(found, 'uart0 should be found');
  assert.match(found.file, /preview\.repl$/);
  const declaration = fs.readFileSync(found.file, 'utf8').split('\n')[found.line];
  assert.match(declaration, /^uart0:/);
});

test('the C# index resolves a type to its class declaration', () => {
  const files = {
    '/src/UART/PL011.cs': 'namespace Antmicro.Renode.Peripherals.UART\n{\n    public class PL011 : UARTBase\n    {\n    }\n}',
    '/src/Other/PL011.cs': 'namespace Something.Else\n{\n    public class PL011\n    {\n    }\n}'
  };
  const index = buildIndex(['/src'], {
    readFile: (f) => files[f],
    listDir: (d) =>
      d === '/src'
        ? [{ name: 'UART', dir: true }, { name: 'Other', dir: true }]
        : [{ name: 'PL011.cs', dir: false }]
  });
  const [best] = resolveType(index, 'UART.PL011');
  assert.equal(best.namespace, 'Antmicro.Renode.Peripherals.UART');
  assert.equal(best.line, 2, 'points at the class declaration line');

  const located = definitions.locateType(index, 'UART.PL011');
  assert.match(located[0].file, /UART\/PL011\.cs$/);
});

test('an unknown type resolves to nothing rather than throwing', () => {
  const index = buildIndex([], { listDir: () => [] });
  assert.deepEqual(definitions.locateType(index, 'Nope.Missing'), []);
});

test('types used by upstream platforms resolve against real Renode sources', { skip: !process.env.RENODE_INFRA }, () => {
  const index = buildIndex([path.join(process.env.RENODE_INFRA, 'src')]);
  assert.ok(index.files > 500, `expected a real checkout, scanned ${index.files} files`);
  // Spot-check types that appear across the upstream platform corpus.
  for (const type of ['UART.PL011', 'I2C.NRF52840_I2C', 'Timers.NRF52840_Timer']) {
    assert.ok(resolveType(index, type).length, `${type} did not resolve`);
  }
  const [pl011] = resolveType(index, 'UART.PL011');
  assert.match(pl011.namespace, /Peripherals\.UART$/);
});

// --- memory map ----------------------------------------------------------------

test('sizes come from a range or from a size property', () => {
  const { peripherals } = parseRepl(
    'a: X.Y @ sysbus <0x40013000, +0x1000>\nb: X.Y @ sysbus 0x20000000\n    size: 0x40000\nc: X.Y @ sysbus <0x100, 0x200>'
  );
  assert.deepEqual(peripherals.map((p) => [p.address, p.size]), [
    ['0x40013000', '0x1000'],
    ['0x20000000', '0x40000'],
    ['0x100', '0x100']
  ]);
});

test('the address space is split into bands around large holes', () => {
  const platform = loadPlatform(path.join(root, 'samples/preview.repl'));
  const html = renderPlatformView(platform, { title: 'preview.repl' });
  assert.match(html, /Address space/);
  assert.match(html, /unmapped/, 'gaps between bands are labelled');
});

test('a band of unsized regions is drawn in order and marked not to scale', () => {
  const peripherals = Array.from({ length: 6 }, (_, i) => ({
    name: `p${i}`,
    address: `0x4000${i}000`,
    irqs: [],
    properties: []
  }));
  const html = renderPlatformView({ peripherals });
  assert.match(html, /not to scale/);
  for (let i = 0; i < 6; i++) assert.match(html, new RegExp(`>p${i}<`));
});

test('overlapping regions are reported', () => {
  const peripherals = [
    { name: 'a', address: '0x1000', size: '0x1000', irqs: [], properties: [] },
    { name: 'b', address: '0x1800', size: '0x100', irqs: [], properties: [] }
  ];
  const html = renderPlatformView({ peripherals });
  assert.match(html, /overlap/);
});
