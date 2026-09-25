'use strict';
// Work out which .repl a .resc loads, and gather every peripheral it defines,
// following `using` imports the way Renode layers platform files.

const fs = require('fs');
const path = require('path');
const { parseRepl } = require('./replParser');

// machine LoadPlatformDescription @a/b.repl | "a/b.repl" | 'a/b.repl' | $var
const LOAD = /\bLoadPlatformDescription\b[ \t]+(@\S+|"[^"]*"|'[^']*'|\$[A-Za-z_]\w*)/g;
const ASSIGN = /^[ \t]*\$([A-Za-z_]\w*)[ \t]*\??=[ \t]*(@\S+|"[^"]*"|'[^']*')/;

// path.isAbsolute is platform-specific: on Linux it rejects "S:/work/x.repl"
// and a Windows-authored script would then be resolved against the script
// directory. Treat drive letters and UNC paths as absolute everywhere.
function isAbsolutePath(p) {
  return path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

function unwrap(token) {
  if (!token) return undefined;
  if (token.startsWith('@')) return token.slice(1);
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Platform paths referenced by a .resc, in source order.
 * `$ORIGIN` expands to the script's own directory, as in Renode.
 * @param {string} text .resc contents
 * @param {string} scriptDir directory holding the script
 */
function findPlatformPaths(text, scriptDir) {
  const variables = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ASSIGN);
    if (m && !variables.has(m[1])) variables.set(m[1], unwrap(m[2]));
  }

  const out = [];
  for (const m of text.matchAll(LOAD)) {
    let raw = m[1];
    if (raw.startsWith('$')) {
      const resolved = variables.get(raw.slice(1));
      if (!resolved) continue;
      raw = resolved;
    } else {
      raw = unwrap(raw);
    }
    if (!raw) continue;
    const expanded = raw.replace(/\$ORIGIN/g, scriptDir).replace(/\$CWD/g, scriptDir);
    if (!/\.repl$/i.test(expanded)) continue;
    out.push(isAbsolutePath(expanded) ? expanded : path.resolve(scriptDir, expanded));
  }
  return [...new Set(out)];
}

/**
 * Resolve a `using "..."` target. Renode accepts paths relative to the file and
 * paths relative to a checkout root, so try the file's directory first and then
 * walk up looking for an ancestor that makes the path exist.
 */
function resolveImport(spec, fromDir, exists) {
  const direct = path.resolve(fromDir, spec);
  if (exists(direct)) return direct;
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.resolve(dir, spec);
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Parse a platform file and everything it imports.
 * @param {string} file
 * @param {{readFile?: (f: string) => string, exists?: (f: string) => boolean}} [io]
 */
function loadPlatform(file, io = {}) {
  const readFile = io.readFile || ((f) => fs.readFileSync(f, 'utf8'));
  const exists = io.exists || ((f) => fs.existsSync(f));

  const peripherals = [];
  const files = [];
  const missing = [];
  const seen = new Set();

  const visit = (target, prefix, depth) => {
    const key = path.resolve(target);
    if (depth > 8 || seen.has(key)) return;
    seen.add(key);
    if (!exists(key)) { missing.push(key); return; }

    let text;
    try { text = readFile(key); } catch { missing.push(key); return; }

    files.push(key);
    const parsed = parseRepl(text);
    for (const p of parsed.peripherals) {
      peripherals.push({ ...p, name: prefix + p.name, file: key });
    }
    for (const imp of parsed.imports) {
      const resolved = resolveImport(imp.path, path.dirname(key), exists);
      if (resolved) visit(resolved, prefix + (imp.prefix || ''), depth + 1);
      else missing.push(imp.path);
    }
  };

  visit(file, '', 0);

  // A later definition of the same name refines the earlier one (Renode layers
  // platform files additively), so keep the richest entry per name.
  const byName = new Map();
  for (const p of peripherals) {
    const prev = byName.get(p.name);
    if (!prev || (!prev.type && p.type)) byName.set(p.name, p);
    else if (prev && p.type && p.irqs.length > prev.irqs.length) byName.set(p.name, p);
  }

  return { peripherals: [...byName.values()], files, missing };
}

module.exports = { findPlatformPaths, loadPlatform, resolveImport, isAbsolutePath };
