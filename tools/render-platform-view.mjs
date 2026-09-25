#!/usr/bin/env node
// Render the platform routing view for a .repl outside the editor, so the
// webview can be developed and reviewed without launching VS Code.
//
//   node tools/render-platform-view.mjs <file.repl> [--png out.png]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadPlatform } = require('../src/core/platformRef.js');
const { renderPlatformView } = require('../src/core/graph.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('usage: node tools/render-platform-view.mjs <file.repl> [--png out.png]');
  process.exit(2);
}
const pngOut = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;

const platform = loadPlatform(path.resolve(input));
const html = renderPlatformView(platform, { title: path.basename(input) });

const htmlOut = path.join(root, 'images', 'platform-view.html');
fs.mkdirSync(path.dirname(htmlOut), { recursive: true });
fs.writeFileSync(htmlOut, html);
console.log(
  `${path.basename(input)}: ${platform.peripherals.length} peripherals from ${platform.files.length} file(s)` +
    (platform.missing.length ? `, ${platform.missing.length} unresolved import(s)` : '')
);
console.log(`wrote ${path.relative(root, htmlOut)}`);

if (pngOut) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('playwright is not installed; skipping the PNG step');
    process.exit(0);
  }
  const executablePath = ['/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(`file://${htmlOut}`);
  const size = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    return {
      w: svg ? svg.getBoundingClientRect().width : 900,
      h: svg ? svg.getBoundingClientRect().height : 600
    };
  });
  await page.setViewportSize({
    width: Math.min(2200, Math.ceil(size.w) + 360),
    height: Math.min(1700, Math.ceil(size.h) + 460)
  });
  const target = path.resolve(root, pngOut);
  await page.screenshot({ path: target });
  try {
    const sharp = require('sharp');
    const before = fs.statSync(target).size;
    const buf = await sharp(target).png({ palette: true, effort: 10 }).toBuffer();
    if (buf.length < before) fs.writeFileSync(target, buf);
  } catch { /* optional */ }
  await browser.close();
  console.log(`wrote ${pngOut}`);
}
