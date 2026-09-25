'use strict';
// Decide what to propose at a point in a .resc line. Kept free of any editor
// API so the behaviour can be tested directly.

const { entries, methodsFor, RECEIVERS } = require('./commands');

const WORD_BEFORE = /([A-Za-z_][A-Za-z0-9_.]*)$/;

/**
 * @param {string} linePrefix text of the current line up to the cursor
 * @param {Array<{name: string, type?: string, file?: string}>} peripherals from the loaded platform
 * @returns {Array<{label: string, kind: string, detail: string, documentation?: string, insertText?: string}>}
 */
function proposalsFor(linePrefix, peripherals) {
  // Inside a comment or a string, propose nothing.
  const withoutStrings = linePrefix.replace(/"[^"]*"|'[^']*'/g, '');
  if (/(^|\s)(#|\/\/)/.test(withoutStrings)) return [];
  const quotes = (linePrefix.match(/"/g) || []).length;
  if (quotes % 2 === 1) return [];

  const word = (linePrefix.match(WORD_BEFORE) || [, ''])[1];
  const out = [];

  // `sysbus.` or `machine.` -> peripheral names on that object.
  const dotted = word.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
  if (dotted && RECEIVERS.includes(dotted[1])) {
    for (const p of peripherals) {
      out.push({
        label: p.name,
        kind: 'peripheral',
        detail: p.type ? `${p.type}` : 'peripheral',
        documentation: peripheralDoc(p),
        insertText: p.name
      });
    }
    return out;
  }

  const isFirstWord = /^[ \t]*[A-Za-z_][A-Za-z0-9_]*$/.test(linePrefix);
  if (isFirstWord) {
    for (const e of entries) {
      if (e.kind !== 'command') continue;
      out.push({ label: e.name, kind: 'command', detail: e.detail, documentation: e.documentation });
    }
    for (const r of RECEIVERS) {
      out.push({ label: r, kind: 'object', detail: 'Renode object' });
    }
    return out;
  }

  // After a receiver, propose its methods.
  const receiverMatch = linePrefix.match(/(?:^|[ \t])([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)*[ \t]+[A-Za-z0-9_]*$/);
  if (receiverMatch && RECEIVERS.includes(receiverMatch[1])) {
    for (const m of methodsFor(receiverMatch[1])) {
      out.push({ label: m.name, kind: 'method', detail: m.detail, documentation: m.documentation });
    }
  }

  // Peripherals are valid arguments almost anywhere, offered fully qualified.
  for (const p of peripherals) {
    out.push({
      label: `sysbus.${p.name}`,
      kind: 'peripheral',
      detail: p.type ? `${p.type}` : 'peripheral',
      documentation: peripheralDoc(p),
      insertText: `sysbus.${p.name}`
    });
  }

  return out;
}

function peripheralDoc(p) {
  const lines = [];
  if (p.type) lines.push(`\`${p.name}: ${p.type}\``);
  else lines.push(`\`${p.name}\``);
  if (p.registeredOn) {
    lines.push(`Registered on \`${p.registeredOn}\`${p.address ? ` at \`${p.address}\`` : ''}.`);
  }
  if (p.irqs && p.irqs.length) {
    const wiring = p.irqs
      .map((i) => `${i.signal} → ${i.destinations.map((d) => `${d.peripheral}@${d.line}`).join(', ')}`)
      .join('; ');
    lines.push(`IRQ: ${wiring}`);
  }
  if (p.file) lines.push(`_Defined in ${p.file.split('/').pop()}_`);
  return lines.join('\n\n');
}

module.exports = { proposalsFor, peripheralDoc };
