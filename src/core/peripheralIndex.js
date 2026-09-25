'use strict';
// Index C# type declarations in a Renode source tree so a .repl type such as
// `UART.PL011` can be opened at its definition.
//
// A .repl type is `Namespace.Class`, where the namespace is the last segment of
// the C# namespace: `UART.PL011` is `class PL011` in
// `Antmicro.Renode.Peripherals.UART`. Matching on both keeps types apart when
// several trees declare a class of the same name.

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', '.vs', 'packages', 'output']);
const NAMESPACE = /^\s*namespace\s+([A-Za-z_][\w.]*)\s*[;{]?\s*$/;
const TYPE_DECL = /^\s*(?:\[[^\]]*\]\s*)*(?:public|internal|private|protected|abstract|sealed|static|partial|unsafe|\s)*\b(class|struct|interface|enum)\s+([A-Za-z_]\w*)/;

/**
 * @param {string[]} roots directories to scan
 * @param {{maxFiles?: number, readFile?: Function, listDir?: Function}} [options]
 * @returns {{byClass: Map<string, Array>, files: number, truncated: boolean}}
 */
function buildIndex(roots, options = {}) {
  const maxFiles = options.maxFiles || 20000;
  const readFile = options.readFile || ((f) => fs.readFileSync(f, 'utf8'));
  const listDir = options.listDir || ((d) => fs.readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() })));

  const byClass = new Map();
  let files = 0;
  let truncated = false;

  const scan = (dir, depth) => {
    if (depth > 12 || files >= maxFiles) return;
    let entries;
    try { entries = listDir(dir); } catch { return; }
    for (const entry of entries) {
      if (files >= maxFiles) { truncated = true; return; }
      const full = path.join(dir, entry.name);
      if (entry.dir) {
        if (SKIP_DIRS.has(entry.name)) continue;
        scan(full, depth + 1);
      } else if (entry.name.endsWith('.cs')) {
        files++;
        indexFile(full, byClass, readFile);
      }
    }
  };

  for (const root of roots) scan(root, 0);
  return { byClass, files, truncated };
}

function indexFile(file, byClass, readFile) {
  let text;
  try { text = readFile(file); } catch { return; }
  if (text.length > 4_000_000) return;

  let namespace = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const ns = lines[i].match(NAMESPACE);
    if (ns) { namespace = ns[1]; continue; }
    const decl = lines[i].match(TYPE_DECL);
    if (!decl) continue;
    const [, kind, name] = decl;
    if (!byClass.has(name)) byClass.set(name, []);
    byClass.get(name).push({ name, kind, namespace, file, line: i });
  }
}

/**
 * Candidates for a .repl type, best first.
 * @param {{byClass: Map}} index
 * @param {string} type e.g. "UART.PL011" or "PL011"
 */
function resolveType(index, type) {
  const segments = String(type).split('.').filter(Boolean);
  if (!segments.length) return [];
  const className = segments[segments.length - 1];
  const wanted = segments.slice(0, -1);

  const candidates = index.byClass.get(className) || [];
  if (!wanted.length || candidates.length <= 1) return candidates;

  const suffix = wanted.join('.').toLowerCase();
  const score = (c) => {
    const ns = (c.namespace || '').toLowerCase();
    if (ns.endsWith('.' + suffix) || ns === suffix) return 0; // namespace matches
    if (ns.includes(suffix)) return 1;
    if (c.kind === 'class') return 2;
    return 3;
  };
  return [...candidates].sort((a, b) => score(a) - score(b));
}

module.exports = { buildIndex, resolveType };
