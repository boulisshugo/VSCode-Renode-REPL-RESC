#!/usr/bin/env node
// Build the TextMate bundle consumed by JetBrains IDEs (Rider, IntelliJ,
// CLion, ...). Their bundled "TextMate Bundles" plugin reads a VS Code-style
// folder: a package.json declaring contributes.languages / contributes.grammars,
// plus the grammar and language-configuration files it points at.
//
// The grammars are used verbatim, so the bundle and the VS Code extension can
// never disagree about syntax.
//
//   node tools/build-textmate-bundle.mjs [--out dist/renode-textmate-bundle]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(
  root,
  args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist/renode-textmate-bundle'
);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Keep only what the TextMate reader looks at; scripts, devDependencies and
// VS Code engine constraints are noise here.
const bundleManifest = {
  name: manifest.name,
  displayName: manifest.displayName,
  description: manifest.description,
  version: manifest.version,
  publisher: manifest.publisher,
  license: manifest.license,
  repository: manifest.repository,
  contributes: {
    languages: manifest.contributes.languages,
    grammars: manifest.contributes.grammars
  }
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(bundleManifest, null, 2) + '\n'
);

// Copy every file the manifest references, at the path it references.
const referenced = [
  ...bundleManifest.contributes.grammars.map((g) => g.path),
  ...bundleManifest.contributes.languages.map((l) => l.configuration)
].filter(Boolean);

for (const ref of referenced) {
  const rel = ref.replace(/^\.\//, '');
  const from = path.join(root, rel);
  const to = path.join(outDir, rel);
  if (!fs.existsSync(from)) throw new Error(`manifest references a missing file: ${rel}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.copyFileSync(path.join(root, 'LICENSE'), path.join(outDir, 'LICENSE'));
fs.writeFileSync(
  path.join(outDir, 'README.md'),
  `# Renode .repl / .resc — TextMate bundle

Syntax highlighting for Renode platform descriptions and Monitor scripts in
JetBrains IDEs (Rider, IntelliJ IDEA, CLion, PyCharm, ...).

## Install

1. **Settings / Preferences -> Editor -> TextMate Bundles**
2. Press **+** and select this folder (unzip it first if you downloaded the zip).
3. Press **OK**, then reopen any \`.repl\` or \`.resc\` file.

Colours follow the TextMate scopes under
**Settings -> Editor -> Color Scheme -> TextMate**, not the VS Code theme.

Version ${bundleManifest.version}. Generated from the VS Code extension's
grammars, which are identical.
`
);

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(path.relative(outDir, full));
  }
};
walk(outDir);
console.log(`wrote ${path.relative(root, outDir)}/`);
for (const f of files.sort()) console.log(`  ${f}`);
