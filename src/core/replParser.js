'use strict';
// Parse a .repl platform description into a model the editor features use:
// which peripherals exist, what type each one is, where it is registered and
// how its IRQs are wired. Deliberately tolerant — an editor sees files mid-edit.

const ENTRY = /^(?![ \t])([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(?:((?:[A-Za-z_][A-Za-z0-9_]*\.)*)([A-Za-z_][A-Za-z0-9_]*))?(.*)$/;
const PROPERTY = /^[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*:(?!:)[ \t]*(.*)$/;
const BLOCK = /^[ \t]+(init|reset)(?:[ \t]+add)?[ \t]*:[ \t]*$/;
const IRQ_LINE = /^[ \t]+(?:([A-Za-z_][A-Za-z0-9_]*)[ \t]*)?(?:\[[^\]]*\][ \t]*)?->[ \t]*(.*)$/;
const IRQ_DEST = /([A-Za-z_][A-Za-z0-9_]*)(?:#(0[xX][0-9a-fA-F]+|\d+))?[ \t]*@[ \t]*(0[xX][0-9a-fA-F]+|\d+|\[[^\]]*\])/g;
const USING = /^[ \t]*using[ \t]+"([^"]+)"(?:[ \t]+prefixed[ \t]+"([^"]*)")?/;
const REGISTRATION = /^[ \t]*@[ \t]*(?:\{)?[ \t]*([A-Za-z_][A-Za-z0-9_.]*)?[ \t]*(<[^>]*>|0[xX][0-9a-fA-F]+|\d+)?/;
// <base, +size> and <base, end> both appear; the leading + marks a length.
const RANGE = /^<\s*(0[xX][0-9a-fA-F_]+|\d[\d_]*)\s*[, ]\s*(\+)?\s*(0[xX][0-9a-fA-F_]+|\d[\d_]*)\s*>$/;

/** Strip // line comments outside strings; block comments are handled by the caller. */
function stripComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && inString) { i++; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (!inString && c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * @param {string} text
 * @returns {{peripherals: Array, imports: Array<{path: string, prefix?: string, line: number}>}}
 */
function parseRepl(text) {
  const peripherals = [];
  const imports = [];
  let current = null;
  let inBlockComment = false;
  let inTripleQuote = false;
  let inIndentedBlock = false;

  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    let line = lines[n];

    if (inTripleQuote) {
      if (line.includes("'''")) inTripleQuote = false;
      continue;
    }
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = line.indexOf('/*');
    if (open !== -1 && !line.slice(0, open).includes('//')) {
      const close = line.indexOf('*/', open + 2);
      if (close === -1) { inBlockComment = true; line = line.slice(0, open); }
      else line = line.slice(0, open) + line.slice(close + 2);
    }

    line = stripComment(line);
    if (!line.trim()) continue;

    // Lines inside an init:/reset: block are Monitor commands, not properties.
    if (BLOCK.test(line)) { inIndentedBlock = true; continue; }

    const useMatch = line.match(USING);
    if (useMatch) {
      imports.push({ path: useMatch[1], prefix: useMatch[2] || undefined, line: n });
      continue;
    }

    const entry = line.match(ENTRY);
    if (entry) {
      inIndentedBlock = false;
      const [, name, namespace, className, tail] = entry;
      const reg = (tail || '').match(REGISTRATION);
      let address = reg && reg[2] ? reg[2] : undefined;
      let size;
      if (address && address.startsWith('<')) {
        const range = address.match(RANGE);
        if (range) {
          address = range[1];
          // `<base, +len>` gives a length; `<base, end>` gives an end address.
          size = range[2] ? range[3] : subtractHex(range[3], range[1]);
        } else {
          address = undefined;
        }
      }
      current = {
        name,
        type: className ? `${namespace || ''}${className}` : undefined,
        registeredOn: reg && reg[1] ? reg[1] : undefined,
        address,
        size,
        line: n,
        properties: [],
        irqs: []
      };
      peripherals.push(current);
      continue;
    }

    if (!current) continue;

    const irq = line.match(IRQ_LINE);
    if (irq) {
      const destinations = [];
      for (const d of (irq[2] || '').matchAll(IRQ_DEST)) {
        destinations.push({ peripheral: d[1], connector: d[2], line: d[3] });
      }
      if (destinations.length) {
        current.irqs.push({ signal: irq[1] || 'IRQ', destinations, sourceLine: n });
      }
      continue;
    }

    if (inIndentedBlock) continue;

    const prop = line.match(PROPERTY);
    if (prop && prop[1] === 'size' && current.size === undefined) {
      const value = prop[2].trim().split(/\s/)[0];
      if (/^(0[xX][0-9a-fA-F_]+|\d[\d_]*)$/.test(value)) current.size = value;
    }
    if (prop) {
      if (prop[2].trimEnd().endsWith("'''") === false && prop[2].includes("'''")) inTripleQuote = true;
      current.properties.push({ name: prop[1], value: prop[2].trim(), line: n });
    }
  }

  return { peripherals, imports };
}

/** Numeric value of a .repl integer literal, or NaN. */
function toNumber(literal) {
  if (literal == null) return NaN;
  const clean = String(literal).replace(/_/g, '');
  return /^0[xX]/.test(clean) ? Number.parseInt(clean, 16) : Number.parseInt(clean, 10);
}

function subtractHex(end, start) {
  const a = toNumber(end);
  const b = toNumber(start);
  if (Number.isNaN(a) || Number.isNaN(b) || a <= b) return undefined;
  return '0x' + (a - b).toString(16).toUpperCase();
}

module.exports = { parseRepl, toNumber };
