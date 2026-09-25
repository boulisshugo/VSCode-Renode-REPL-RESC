'use strict';
// Build the platform routing view: an interrupt-routing diagram plus the
// memory map, rendered from a parsed platform. Pure string building so it can
// be produced and inspected outside the editor.

const esc = (s) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NODE_W = 208;
const NODE_H = 46;
const GAP_X = 104;
const GAP_Y = 18;
const GAP_SUB = 22;
const PAD = 28;
// Interrupt routing fans in: a real SoC has dozens of sources feeding one
// controller. Stacked in a single column that is unreadably tall, so wrap a
// crowded layer into side-by-side sub-columns.
const MAX_ROWS = 12;

/** Interrupt edges between peripherals, plus a layering for left-to-right flow. */
function buildRouting(peripherals) {
  const known = new Map(peripherals.map((p) => [p.name, p]));
  const edges = [];
  for (const p of peripherals) {
    for (const irq of p.irqs || []) {
      for (const dest of irq.destinations) {
        edges.push({
          from: p.name,
          to: dest.peripheral,
          signal: irq.signal,
          line: dest.line,
          connector: dest.connector
        });
      }
    }
  }

  // Only peripherals that take part in interrupt routing belong in the diagram.
  const involved = new Set();
  for (const e of edges) {
    involved.add(e.from);
    if (known.has(e.to)) involved.add(e.to);
  }
  // Destinations that are never declared (typos, or defined in a file we could
  // not resolve) are still worth showing, flagged.
  const phantom = new Set(edges.map((e) => e.to).filter((n) => !known.has(n)));
  for (const n of phantom) involved.add(n);

  const nodes = [...involved].map((name) => ({
    name,
    type: known.get(name)?.type,
    address: known.get(name)?.address,
    registeredOn: known.get(name)?.registeredOn,
    line: known.get(name)?.line,
    missing: phantom.has(name)
  }));

  // Longest-path layering: a node sits to the right of everything feeding it.
  const incoming = new Map(nodes.map((n) => [n.name, []]));
  for (const e of edges) if (incoming.has(e.to)) incoming.get(e.to).push(e.from);

  const layer = new Map();
  const resolve = (name, seen = new Set()) => {
    if (layer.has(name)) return layer.get(name);
    if (seen.has(name)) return 0; // cycle guard
    seen.add(name);
    const sources = incoming.get(name) || [];
    const value = sources.length ? Math.max(...sources.map((s) => resolve(s, seen) + 1)) : 0;
    layer.set(name, value);
    return value;
  };
  for (const n of nodes) resolve(n.name);

  const columns = new Map();
  for (const n of nodes) {
    const l = layer.get(n.name) || 0;
    if (!columns.has(l)) columns.set(l, []);
    columns.get(l).push(n);
  }
  for (const list of columns.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const layerKeys = [...columns.keys()].sort((a, b) => a - b);
  const shape = layerKeys.map((l) => {
    const list = columns.get(l);
    const subCols = Math.max(1, Math.ceil(list.length / MAX_ROWS));
    return { l, list, subCols, rows: Math.ceil(list.length / subCols) };
  });

  const tallest = Math.max(1, ...shape.map((s) => s.rows));
  const contentH = tallest * NODE_H + (tallest - 1) * GAP_Y;

  const positioned = new Map();
  let x = PAD;
  for (const { list, subCols, rows } of shape) {
    const span = rows * NODE_H + (rows - 1) * GAP_Y;
    const top = PAD + (contentH - span) / 2;
    list.forEach((n, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      positioned.set(n.name, {
        ...n,
        x: x + col * (NODE_W + GAP_SUB),
        y: top + row * (NODE_H + GAP_Y)
      });
    });
    x += subCols * NODE_W + (subCols - 1) * GAP_SUB + GAP_X;
  }

  return {
    nodes: [...positioned.values()],
    edges,
    width: x - GAP_X + PAD,
    height: PAD * 2 + contentH
  };
}

function truncate(text, max) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

function edgePath(from, to) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const dx = Math.max(36, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function renderDiagram(routing) {
  const byName = new Map(routing.nodes.map((n) => [n.name, n]));
  const paths = [];
  for (const e of routing.edges) {
    const a = byName.get(e.from);
    const b = byName.get(e.to);
    if (!a || !b) continue;
    const label = e.connector ? `${e.signal} #${e.connector} → ${e.line}` : `${e.signal} → ${e.line}`;
    paths.push(
      `<g class="edge" data-from="${esc(e.from)}" data-to="${esc(e.to)}">` +
        `<title>${esc(e.from)} ${esc(label)} ${esc(e.to)}</title>` +
        `<path d="${edgePath(a, b)}" marker-end="url(#arrow)"/>` +
        `</g>`
    );
  }

  const boxes = routing.nodes.map((n) => {
    const sub = n.missing ? 'not declared in this platform' : n.type || 'no type';
    // The name shares its line with the address, so both get a budget; the type
    // owns the second line on its own and is clipped to the node width.
    const nameBudget = n.address ? 18 : 26;
    return (
      `<g class="node${n.missing ? ' missing' : ''}" data-name="${esc(n.name)}" transform="translate(${n.x},${n.y})">` +
        `<title>${esc(n.name)}${n.type ? ` \u2014 ${esc(n.type)}` : ''}${n.address ? ` @ ${esc(n.address)}` : ''}</title>` +
        `<rect width="${NODE_W}" height="${NODE_H}" rx="7"/>` +
        `<text class="n-name" x="12" y="19">${esc(truncate(n.name, nameBudget))}</text>` +
        (n.address ? `<text class="n-addr" x="${NODE_W - 12}" y="19">${esc(n.address)}</text>` : '') +
        `<text class="n-type" x="12" y="35">${esc(truncate(sub, 30))}</text>` +
      `</g>`
    );
  });

  return (
    `<svg viewBox="0 0 ${routing.width} ${routing.height}" width="${routing.width}" height="${routing.height}">` +
      `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>` +
      `<g class="edges">${paths.join('')}</g><g class="nodes">${boxes.join('')}</g>` +
    `</svg>`
  );
}

function renderInterruptTable(peripherals) {
  const rows = [];
  for (const p of peripherals) {
    for (const irq of p.irqs || []) {
      for (const d of irq.destinations) {
        rows.push({
          target: d.peripheral,
          line: d.line,
          sortKey: Number.isNaN(Number(d.line)) ? Number.MAX_SAFE_INTEGER : Number(d.line),
          source: p.name,
          signal: irq.signal
        });
      }
    }
  }
  rows.sort((a, b) => a.target.localeCompare(b.target) || a.sortKey - b.sortKey || a.source.localeCompare(b.source));

  if (!rows.length) return '<p class="empty-note">No interrupt connections.</p>';

  const body = rows
    .map(
      (r) =>
        `<tr data-name="${esc(r.source)}"><td class="tgt">${esc(r.target)}</td>` +
        `<td class="irq">${esc(r.line)}</td><td class="name">${esc(r.source)}</td>` +
        `<td class="sig">${esc(r.signal)}</td></tr>`
    )
    .join('');
  return `<table class="map irqs"><thead><tr><th>Target</th><th>Line</th><th>Source</th><th>Signal</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderMemoryMap(peripherals) {
  const parse = (a) => (a == null ? NaN : Number(a.startsWith('0x') || a.startsWith('0X') ? a : a));
  const mapped = peripherals
    .filter((p) => p.address)
    .map((p) => ({ ...p, sortKey: parse(p.address) }))
    .sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));

  const rows = mapped
    .map(
      (p) =>
        `<tr data-name="${esc(p.name)}"><td class="addr">${esc(p.address)}</td>` +
        `<td class="name">${esc(p.name)}</td><td class="type">${esc(p.type || '')}</td></tr>`
    )
    .join('');

  return `<table class="map"><thead><tr><th>Address</th><th>Peripheral</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * @param {{peripherals: Array, files?: string[], missing?: string[]}} platform
 * @param {{title?: string}} [options]
 */
function renderPlatformView(platform, options = {}) {
  const peripherals = platform.peripherals || [];
  const routing = buildRouting(peripherals);
  const title = options.title || 'Platform';
  const unrouted = peripherals.filter((p) => !(p.irqs || []).length && !routing.nodes.some((n) => n.name === p.name));

  const stats = [
    `${peripherals.length} peripherals`,
    `${routing.edges.length} interrupt connections`,
    `${peripherals.filter((p) => p.address).length} mapped on the bus`
  ];

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)} — routing</title>
<style>
  :root {
    --bg: #1F1F1F; --panel: #252526; --line: #3C3C3C; --fg: #CCCCCC; --dim: #8A8A8A;
    --node: #2D3A45; --node-border: #4EC9B0; --name: #DCDCAA; --type: #9CDCFE;
    --edge: #7A8794; --accent: #4EC9B0; --warn: #D7917B;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, "Segoe UI", system-ui, sans-serif; font-size: 13px;
  }
  header { padding: 16px 20px 12px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
  h1 .file { color: var(--accent); font-family: ui-monospace, monospace; }
  .stats { color: var(--dim); font-size: 12px; }
  .stats span + span::before { content: "·"; margin: 0 8px; color: var(--line); }
  .layout { display: flex; align-items: stretch; height: calc(100vh - 64px); }
  .diagram { flex: 1; min-width: 0; overflow: auto; padding: 8px 0 0 0; }
  aside {
    width: 360px; flex: none; border-left: 1px solid var(--line);
    background: var(--panel); overflow: auto; padding: 14px 16px 20px;
  }
  aside h2.spaced { margin-top: 22px; }
  aside h2 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--dim); font-weight: 600; }
  table.map { width: 100%; border-collapse: collapse; font-family: ui-monospace, "DejaVu Sans Mono", monospace; font-size: 11.5px; }
  table.map th { text-align: left; color: var(--dim); font-weight: 500; padding: 0 8px 6px 0; border-bottom: 1px solid var(--line); }
  table.map td { padding: 3px 8px 3px 0; white-space: nowrap; }
  table.map td.addr { color: #B5CEA8; }
  table.map td.name { color: var(--name); }
  table.map td.type { color: var(--type); overflow: hidden; text-overflow: ellipsis; max-width: 130px; }
  table.map td.tgt { color: var(--accent); }
  table.map td.irq { color: #B5CEA8; text-align: right; padding-right: 12px; }
  table.map td.sig { color: var(--dim); }
  .empty-note { color: var(--dim); margin: 0; }
  table.map tbody tr:hover td { background: #2A2D2E; }
  .legend { margin-top: 18px; color: var(--dim); font-size: 11.5px; line-height: 1.7; }
  .legend b { color: var(--fg); font-weight: 600; }
  svg { display: block; }
  .node rect { fill: var(--node); stroke: var(--node-border); stroke-width: 1; paint-order: stroke; }
  .nodes { filter: drop-shadow(0 0 3px var(--bg)); }
  .node.missing rect { stroke: var(--warn); stroke-dasharray: 4 3; fill: #35292A; }
  .node text { font-family: ui-monospace, "DejaVu Sans Mono", monospace; }
  .n-name { fill: var(--name); font-size: 12.5px; }
  .n-type { fill: var(--type); font-size: 10.5px; }
  .n-addr { fill: #B5CEA8; font-size: 10.5px; text-anchor: end; }
  .node.missing .n-type { fill: var(--warn); }
  .edge path { fill: none; stroke: var(--edge); stroke-width: 1.15; opacity: .5; }
  .edge:hover path { stroke: var(--accent); stroke-width: 2; opacity: 1; }
  marker path { fill: var(--edge); }
  .empty { padding: 40px 24px; color: var(--dim); }
</style></head>
<body>
  <header>
    <h1>Peripheral routing — <span class="file">${esc(title)}</span></h1>
    <div class="stats">${stats.map((s) => `<span>${esc(s)}</span>`).join('')}</div>
  </header>
  <div class="layout">
    <div class="diagram">${
      routing.nodes.length
        ? renderDiagram(routing)
        : '<p class="empty">No interrupt connections found in this platform.</p>'
    }</div>
    <aside>
      <h2>Interrupt lines</h2>
      ${renderInterruptTable(peripherals)}
      <h2 class="spaced">Memory map</h2>
      ${renderMemoryMap(peripherals)}
      <div class="legend">
        <p>Columns follow the interrupt path: a peripheral sits to the right of
        everything that signals it, so sources are on the left and the CPU ends
        up on the right.</p>
        <p><b>Dashed orange</b> marks a destination this platform never declares
        — usually a typo, or a file the editor could not resolve.</p>
        ${unrouted.length ? `<p><b>${unrouted.length}</b> peripherals have no interrupt wiring and are listed in the memory map only.</p>` : ''}
      </div>
    </aside>
  </div>
</body></html>`;
}

module.exports = { renderPlatformView, buildRouting };
