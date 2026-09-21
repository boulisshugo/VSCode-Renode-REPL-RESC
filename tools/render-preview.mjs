#!/usr/bin/env node
// Render the README preview image.
//
// Colours are resolved the way VS Code resolves them: the real Dark+ theme is
// fed to vscode-textmate's own theme matcher and tokens are read back through
// tokenizeLine2, so the picture cannot drift from what the editor shows.
//
//   node tools/render-preview.mjs                 # writes images/preview.html
//   node tools/render-preview.mjs --png images/preview.png
//
// The PNG step needs Playwright; without it the HTML is still written and can
// be screenshotted by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME_BASE =
  'https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes';
const PYTHON_GRAMMAR =
  'https://raw.githubusercontent.com/microsoft/vscode/main/extensions/python/syntaxes/MagicPython.tmLanguage.json';

const args = process.argv.slice(2);
const pngOut = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;
const htmlOut = path.join(root, 'images', 'preview.html');

/** Strip // and /* *\/ comments from JSONC without touching string contents. */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') { out += text[++i]; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  // Trailing commas are legal in JSONC but not JSON.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

async function loadTheme() {
  const cache = path.join(root, 'images', '.theme-cache');
  fs.mkdirSync(cache, { recursive: true });
  const get = async (name) => {
    const file = path.join(cache, name);
    if (!fs.existsSync(file)) {
      const res = await fetch(`${THEME_BASE}/${name}`);
      if (!res.ok) throw new Error(`fetching ${name}: HTTP ${res.status}`);
      fs.writeFileSync(file, await res.text());
    }
    return parseJsonc(fs.readFileSync(file, 'utf8'));
  };
  const base = await get('dark_vs.json');
  const plus = await get('dark_plus.json');
  return {
    colors: { ...base.colors, ...plus.colors },
    // Later rules win in TextMate themes, so the Dark+ overrides go last.
    tokenColors: [...(base.tokenColors ?? []), ...(plus.tokenColors ?? [])]
  };
}

const theme = await loadTheme();

const wasm = fs.readFileSync(path.join(root, 'node_modules/vscode-oniguruma/release/onig.wasm'));
const onigLib = oniguruma.loadWASM(wasm.buffer).then(() => ({
  createOnigScanner: (p) => new oniguruma.OnigScanner(p),
  createOnigString: (s) => new oniguruma.OnigString(s)
}));

const GRAMMARS = {
  'source.renode-repl': 'syntaxes/renode-repl.tmLanguage.json',
  'source.renode-resc': 'syntaxes/renode-resc.tmLanguage.json'
};

const registry = new textmate.Registry({
  onigLib,
  theme: {
    name: 'Dark+',
    // vscode-textmate needs an explicit scopeless default rule; Dark+ carries
    // its editor foreground/background in `colors` instead, so bridge it here
    // or unmatched scopes resolve to colour id 0 (black on a dark editor).
    settings: [
      {
        settings: {
          foreground: theme.colors['editor.foreground'] ?? '#CCCCCC',
          background: theme.colors['editor.background'] ?? '#1F1F1F'
        }
      },
      ...theme.tokenColors
    ]
  },
  loadGrammar: async (scope) => {
    if (scope === 'source.python') {
      const cached = path.join(root, 'images', '.theme-cache', 'MagicPython.json');
      if (!fs.existsSync(cached)) {
        const res = await fetch(PYTHON_GRAMMAR);
        if (!res.ok) throw new Error(`fetching the Python grammar: HTTP ${res.status}`);
        fs.writeFileSync(cached, await res.text());
      }
      return textmate.parseRawGrammar(fs.readFileSync(cached, 'utf8'), 'MagicPython.json');
    }
    const file = GRAMMARS[scope];
    if (!file) return null;
    return textmate.parseRawGrammar(fs.readFileSync(path.join(root, file), 'utf8'), file);
  }
});

const colorMap = registry.getColorMap();
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function renderFile(scopeName, file) {
  const grammar = await registry.loadGrammar(scopeName);
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\n+$/, '');
  let ruleStack = textmate.INITIAL;
  const lines = [];

  for (const line of source.split('\n')) {
    const { tokens } = grammar.tokenizeLine2(line, ruleStack);
    ruleStack = grammar.tokenizeLine(line, ruleStack).ruleStack;

    let html = '';
    for (let i = 0; i < tokens.length; i += 2) {
      const start = tokens[i];
      const end = i + 2 < tokens.length ? tokens[i + 2] : line.length;
      const metadata = tokens[i + 1];
      const text = line.substring(start, end);
      if (!text) continue;

      // Bit layout of the encoded token metadata (vscode-textmate):
      // font style in bits 11-14, foreground colour id in bits 15-23.
      const fontStyle = (metadata >>> 11) & 0b1111;
      const foreground = (metadata >>> 15) & 0b111111111;
      const style = [`color:${colorMap[foreground]}`];
      if (fontStyle & 1) style.push('font-style:italic');
      if (fontStyle & 2) style.push('font-weight:600');
      if (fontStyle & 4) style.push('text-decoration:underline');
      html += `<span style="${style.join(';')}">${escapeHtml(text)}</span>`;
    }
    lines.push(html || '&nbsp;');
  }
  return lines;
}

function pane(title, lines) {
  const gutter = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
  const code = lines.map((l) => `<div class="line">${l}</div>`).join('');
  return `
    <section class="pane">
      <div class="tab"><span class="dot"></span>${escapeHtml(title)}</div>
      <div class="body">
        <div class="gutter">${gutter}</div>
        <div class="code">${code}</div>
      </div>
    </section>`;
}

const bg = theme.colors['editor.background'] ?? '#1F1F1F';
const fg = theme.colors['editor.foreground'] ?? '#CCCCCC';
const gutterFg = theme.colors['editorLineNumber.foreground'] ?? '#6E7681';

const panes =
  pane('platform.repl', await renderFile('source.renode-repl', 'samples/preview.repl')) +
  pane('run.resc', await renderFile('source.renode-resc', 'samples/preview.resc'));

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Renode syntax highlighting preview</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px; background: #0D1117;
    font-family: ui-monospace, "DejaVu Sans Mono", "Liberation Mono", Menlo, Consolas, monospace;
  }
  .wrap { display: flex; gap: 20px; align-items: stretch; width: max-content; }
  .pane {
    flex: 0 0 auto; background: ${bg}; color: ${fg};
    border: 1px solid #30363D; border-radius: 8px; overflow: hidden;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
  }
  .tab {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 14px; font-size: 12.5px; color: #C9D1D9;
    background: #252526; border-bottom: 1px solid #30363D;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #519ABA; }
  .body { display: flex; padding: 12px 0 16px; }
  .gutter {
    flex: none; text-align: right; padding: 0 14px 0 16px;
    color: ${gutterFg}; font-size: 12.5px; line-height: 1.55;
    user-select: none;
  }
  .code { flex: 0 0 auto; width: max-content; font-size: 12.5px; line-height: 1.55; }
  .line { white-space: pre; padding-right: 16px; }
</style></head>
<body><div class="wrap">${panes}</div></body></html>`;

fs.mkdirSync(path.dirname(htmlOut), { recursive: true });
fs.writeFileSync(htmlOut, html);
console.log(`wrote ${path.relative(root, htmlOut)}`);

if (pngOut) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright is not installed; skipping the PNG step');
    process.exit(0);
  }
  // Honour a pre-installed browser (PLAYWRIGHT_CHROMIUM_PATH or the standard
  // /opt/pw-browsers symlink) so a version skew between the npm package and
  // the bundled browser does not force a download.
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium'
  ].filter(Boolean);
  const executablePath = candidates.find((p) => fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(`file://${htmlOut}`);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({
    width: Math.ceil(box.width) + 56,
    height: Math.ceil(box.height) + 56
  });
  const target = path.resolve(root, pngOut);
  await page.screenshot({ path: target, fullPage: true });
  await browser.close();

  // A code screenshot uses a handful of distinct colours, so a quantized
  // palette cuts the file by ~60% with no visible loss. Optional: skipped
  // when sharp is not installed.
  try {
    const sharp = require('sharp');
    const before = fs.statSync(target).size;
    const buffer = await sharp(target).png({ palette: true, effort: 10 }).toBuffer();
    if (buffer.length < before) {
      fs.writeFileSync(target, buffer);
      console.log(`compressed ${(before / 1024) | 0}KB -> ${(buffer.length / 1024) | 0}KB`);
    }
  } catch {
    /* sharp is optional */
  }
  console.log(`wrote ${pngOut}`);
}
