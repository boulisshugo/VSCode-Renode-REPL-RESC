'use strict';

const path = require('path');
const vscode = require('vscode');

const { findPlatformPaths, loadPlatform } = require('./core/platformRef');
const { proposalsFor, peripheralDoc } = require('./core/completion');
const { lookup } = require('./core/commands');
const { renderPlatformView } = require('./core/graph');

const KIND = {
  peripheral: vscode.CompletionItemKind.Variable,
  command: vscode.CompletionItemKind.Keyword,
  method: vscode.CompletionItemKind.Method,
  object: vscode.CompletionItemKind.Class
};

/** Parsed platforms, keyed by .repl path, dropped when a file changes. */
const cache = new Map();

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
    vscode.workspace.onDidChangeTextDocument((e) => invalidate(e.document.uri))
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
