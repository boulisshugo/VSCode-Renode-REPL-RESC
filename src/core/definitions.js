'use strict';
// Work out what a ctrl+click at a point in a .repl or .resc should open.

const { resolveType } = require('./peripheralIndex');

const IDENT = /[A-Za-z_][A-Za-z0-9_.]*/g;

/** The identifier spanning `character`, with its bounds. */
function tokenAt(line, character) {
  for (const m of String(line).matchAll(IDENT)) {
    const start = m.index;
    const end = start + m[0].length;
    if (character >= start && character <= end) return { text: m[0], start, end };
  }
  return undefined;
}

/**
 * What a click in a .repl means.
 * A declaration's type opens the peripheral's source; anything else that names
 * a peripheral opens that peripheral's declaration.
 * @returns {{kind: 'type', type: string} | {kind: 'peripheral', name: string} | undefined}
 */
function replTargetAt(line, character) {
  const token = tokenAt(line, character);
  if (!token) return undefined;

  // `name: Namespace.Class @ ...` — the type sits after the colon.
  const declaration = line.match(/^(?![ \t])([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)/);
  if (declaration) {
    const typeStart = line.indexOf(declaration[2], declaration[1].length);
    if (typeStart >= 0 && character >= typeStart && character <= typeStart + declaration[2].length) {
      return { kind: 'type', type: declaration[2] };
    }
    if (character <= declaration[1].length) return { kind: 'peripheral', name: declaration[1] };
  }

  // `new Namespace.Class { ... }` registration objects also name a type.
  const neu = line.match(/\bnew[ \t]+((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)/);
  if (neu) {
    const start = line.indexOf(neu[1], line.indexOf('new'));
    if (character >= start && character <= start + neu[1].length) return { kind: 'type', type: neu[1] };
  }

  // Anything else that looks like a bare name refers to a peripheral:
  // an IRQ destination, a registration parent, a property value.
  const name = token.text.includes('.') ? token.text.split('.').pop() : token.text;
  return { kind: 'peripheral', name };
}

/** What a click in a .resc means: peripheral paths and bare names. */
function rescTargetAt(line, character) {
  const token = tokenAt(line, character);
  if (!token) return undefined;
  const parts = token.text.split('.');
  // `sysbus.uart0` -> uart0; `uart0` -> uart0.
  const name = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  if (!name) return undefined;
  return { kind: 'peripheral', name };
}

/** Where a peripheral is declared, within an already loaded platform. */
function locatePeripheral(platform, name) {
  const match = (platform.peripherals || []).find((p) => p.name === name);
  if (!match || !match.file) return undefined;
  return { file: match.file, line: match.line || 0 };
}

/** Where a .repl type is implemented, given a C# index. */
function locateType(index, type) {
  if (!index) return [];
  return resolveType(index, type).map((c) => ({
    file: c.file,
    line: c.line,
    namespace: c.namespace,
    name: c.name
  }));
}

module.exports = { tokenAt, replTargetAt, rescTargetAt, locatePeripheral, locateType };
