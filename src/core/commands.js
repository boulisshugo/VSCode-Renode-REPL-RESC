'use strict';
// The Monitor vocabulary offered by completion and explained on hover.
// Monitor commands come from Renode's own sources; object methods are curated.

const monitorData = require('../../data/monitor-commands.json');
const methodData = require('../../data/object-methods.json');

const RECEIVERS = ['sysbus', 'machine', 'mach', 'emulation', 'connector', 'cpu', 'host', 'monitor'];

/** @returns {Array<{kind: string, name: string, detail: string, documentation: string}>} */
function allEntries() {
  const entries = [];

  for (const c of monitorData.commands) {
    const aliases = c.aliases.length ? `\n\nAliases: ${c.aliases.map((a) => `\`${a}\``).join(', ')}` : '';
    entries.push({
      kind: 'command',
      name: c.name,
      aliases: c.aliases,
      detail: 'Renode Monitor command',
      documentation: `${c.description}${aliases}\n\n_From Renode's command sources._`
    });
  }

  for (const m of methodData.methods) {
    entries.push({
      kind: 'method',
      name: m.name,
      receiver: m.receiver,
      aliases: [],
      detail: `${m.receiver} method`,
      documentation: `\`${m.signature}\`\n\n${m.description}`
    });
  }

  return entries;
}

const entries = allEntries();
const byName = new Map();
for (const e of entries) {
  if (!byName.has(e.name)) byName.set(e.name, []);
  byName.get(e.name).push(e);
  for (const alias of e.aliases) {
    if (!byName.has(alias)) byName.set(alias, []);
    byName.get(alias).push({ ...e, name: alias, documentation: `Alias for \`${e.name}\`.\n\n${e.documentation}` });
  }
}

/** Every entry whose name or alias matches exactly. */
function lookup(word) {
  return byName.get(word) || [];
}

/** Methods offered after a given receiver, e.g. `sysbus `. */
function methodsFor(receiver) {
  return entries.filter((e) => e.kind === 'method' && e.receiver === receiver);
}

module.exports = { entries, lookup, methodsFor, RECEIVERS };
