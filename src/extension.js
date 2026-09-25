'use strict';

const path = require('path');
const vscode = require('vscode');

const { findPlatformPaths, loadPlatform } = require('./core/platformRef');
const { proposalsFor, peripheralDoc } = require('./core/completion');
const { lookup } = require('./core/commands');
const { renderPlatformView } = require('./core/graph');
const { buildIndex } = require('./core/peripheralIndex');
const { replTargetAt, rescTargetAt, locatePeripheral, locateType } = require('./core/definitions');

const KIND = {
  peripheral: vscode.CompletionItemKind.Variable,
  command: vscode.CompletionItemKind.Keyword,
  method: vscode.CompletionItemKind.Method,
  object: vscode.CompletionItemKind.Class
};

/** Parsed platforms, keyed by .repl path, dropped when a file changes. */
const cache = new Map();

/** C# type index, built on first use because scanning a source tree is slow. */
let sourceIndex;

function sourceRoots() {
  const configured = vscode.workspace.getConfiguration('renode').get('peripheralSourceRoots') || [];
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const resolved = [];
  for (const entry of configured) {
    if (!entry) continue;
    if (path.isAbsolute(entry)) resolved.push(entry);
    else for (const folder of folders) resolved.push(path.join(folder, entry));
  }
  return resolved.filter((p) => { try { return require('fs').statSync(p).isDirectory(); } catch { return false; } });
}

function getSourceIndex() {
  if (sourceIndex) return sourceIndex;
  const roots = sourceRoots();
  if (!roots.length) return undefined;
  sourceIndex = buildIndex(roots);
  return sourceIndex;
}

function readPlatform(file) {
  const cached = cache.get(file);
  if (cached) return cached;
  let result;
  try {
    result = loadPlatform(file, {
      readFile: (f) => {
        // Prefer an editor buffer so completion follows unsaved edits.
        const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === f);
        return open ? open.getText() : require('fs').readFileSync(f, 'utf8');
      }
    });
  } catch {
    result = { peripherals: [], files: [], missing: [file] };
  }
  cache.set(file, result);
  return result;
}

/** The platform a .resc loads, or the document itself when it is a .repl. */
function platformForDocument(document) {
  if (document.languageId === 'renode-repl') {
    return { file: document.uri.fsPath, platform: readPlatform(document.uri.fsPath) };
  }
  const dir = path.dirname(document.uri.fsPath);
  const [first] = findPlatformPaths(document.getText(), dir);
  if (!first) return { file: undefined, platform: { peripherals: [], files: [], missing: [] } };
  return { file: first, platform: readPlatform(first) };
}

function activate(context) {
  const invalidate = (uri) => {
    if (!uri || /\.repl$/i.test(uri.fsPath)) cache.clear();
  };
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((d) => invalidate(d.uri)),
    vscode.workspace.onDidChangeTextDocument((e) => invalidate(e.document.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('renode.peripheralSourceRoots')) sourceIndex = undefined;
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'renode-resc',
      {
        provideCompletionItems(document, position) {
          const linePrefix = document.lineAt(position).text.slice(0, position.character);
          const { platform } = platformForDocument(document);
          return proposalsFor(linePrefix, platform.peripherals).map((p) => {
            const item = new vscode.CompletionItem(
              p.label,
              KIND[p.kind] || vscode.CompletionItemKind.Text
            );
            item.detail = p.detail;
            if (p.documentation) item.documentation = new vscode.MarkdownString(p.documentation);
            if (p.insertText) item.insertText = p.insertText;
            // Peripherals first: they are the file-specific answer.
            item.sortText = (p.kind === 'peripheral' ? '0' : '1') + p.label;
            return item;
          });
        }
      },
      '.',
      ' '
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider('renode-resc', {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_.]*/);
        if (!range) return undefined;
        const word = document.getText(range);
        const bare = word.includes('.') ? word.split('.').pop() : word;

        const matches = lookup(word).concat(word === bare ? [] : lookup(bare));
        if (matches.length) {
          const md = new vscode.MarkdownString(
            matches.map((m) => `**${m.name}** — _${m.detail}_\n\n${m.documentation}`).join('\n\n---\n\n')
          );
          return new vscode.Hover(md, range);
        }

        const { platform } = platformForDocument(document);
        const peripheral = platform.peripherals.find((p) => p.name === bare);
        if (peripheral) return new vscode.Hover(new vscode.MarkdownString(peripheralDoc(peripheral)), range);

        return undefined;
      }
    })
  );

  // Ctrl+click: a peripheral name opens its .repl declaration, a type opens the
  // C# that implements it.
  const definitionProvider = {
    provideDefinition(document, position) {
      const line = document.lineAt(position).text;
      const target =
        document.languageId === 'renode-repl'
          ? replTargetAt(line, position.character)
          : rescTargetAt(line, position.character);
      if (!target) return undefined;

      if (target.kind === 'peripheral') {
        const { platform } = platformForDocument(document);
        const found = locatePeripheral(platform, target.name);
        if (!found) return undefined;
        return new vscode.Location(vscode.Uri.file(found.file), new vscode.Position(found.line, 0));
      }

      const index = getSourceIndex();
      if (!index) {
        vscode.window.setStatusBarMessage(
          'Renode: set "renode.peripheralSourceRoots" to your Renode sources to jump to peripheral implementations.',
          6000
        );
        return undefined;
      }
      return locateType(index, target.type).map(
        (c) => new vscode.Location(vscode.Uri.file(c.file), new vscode.Position(c.line, 0))
      );
    }
  };

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider('renode-repl', definitionProvider),
    vscode.languages.registerDefinitionProvider('renode-resc', definitionProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('renode.rebuildPeripheralIndex', () => {
      sourceIndex = undefined;
      const index = getSourceIndex();
      vscode.window.showInformationMessage(
        index
          ? `Renode: indexed ${index.files} source files, ${index.byClass.size} types.`
          : 'Renode: set "renode.peripheralSourceRoots" to a directory of Renode sources first.'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('renode.showPlatformView', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Open a .repl or .resc file first.');
        return;
      }
      const { file, platform } = platformForDocument(editor.document);
      if (!file) {
        vscode.window.showWarningMessage(
          'No platform description found. A .resc needs a LoadPlatformDescription line pointing at a .repl.'
        );
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        'renodePlatformView',
        `Routing — ${path.basename(file)}`,
        vscode.ViewColumn.Beside,
        { enableScripts: false }
      );
      panel.webview.html = renderPlatformView(platform, { title: path.basename(file) });
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
