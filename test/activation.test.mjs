import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Stand in for the editor host so the entry point can be loaded and activated
// here. This does not prove VS Code behaves as expected, but it does prove the
// module loads, the API surface it touches exists, and activate() registers
// what the manifest promises.
function withMockVscode(run) {
  const registered = { completion: [], hover: [], commands: [], subscriptions: 0 };
  const vscode = {
    CompletionItemKind: { Variable: 5, Keyword: 13, Method: 1, Class: 6, Text: 0 },
    ViewColumn: { Beside: -2 },
    CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind; } },
    MarkdownString: class { constructor(value) { this.value = value; } },
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    languages: {
      registerCompletionItemProvider: (selector, provider, ...triggers) => {
        registered.completion.push({ selector, provider, triggers });
        return { dispose() {} };
      },
      registerHoverProvider: (selector, provider) => {
        registered.hover.push({ selector, provider });
        return { dispose() {} };
      }
    },
    commands: {
      registerCommand: (id, handler) => {
        registered.commands.push({ id, handler });
        return { dispose() {} };
      }
    },
    window: { activeTextEditor: undefined, createWebviewPanel: () => ({ webview: {} }), showInformationMessage() {}, showWarningMessage() {} },
    workspace: {
      textDocuments: [],
      onDidSaveTextDocument: () => ({ dispose() {} }),
      onDidChangeTextDocument: () => ({ dispose() {} })
    }
  };

  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return load.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('../src/extension.js')];
    const extension = require('../src/extension.js');
    const context = { subscriptions: [] };
    extension.activate(context);
    registered.subscriptions = context.subscriptions.length;
    return run({ extension, registered, vscode, context });
  } finally {
    Module._load = load;
  }
}

test('activate registers the providers and the command', () => {
  withMockVscode(({ registered }) => {
    assert.equal(registered.completion.length, 1);
    assert.deepEqual(registered.completion[0].selector, 'renode-resc');
    assert.deepEqual(registered.completion[0].triggers, ['.', ' ']);
    assert.equal(registered.hover.length, 1);
    assert.deepEqual(registered.commands.map((c) => c.id), ['renode.showPlatformView']);
    assert.ok(registered.subscriptions >= 4);
  });
});

test('the registered command id matches the manifest', () => {
  const manifest = require('../package.json');
  const declared = manifest.contributes.commands.map((c) => c.command);
  withMockVscode(({ registered }) => {
    assert.deepEqual(registered.commands.map((c) => c.id), declared);
  });
  assert.equal(manifest.main, './src/extension.js');
});

test('completion proposes peripherals from the .repl the .resc loads', () => {
  withMockVscode(({ registered }) => {
    const document = {
      languageId: 'renode-resc',
      uri: { fsPath: path.join(root, 'samples/preview.resc') },
      getText: () => 'machine LoadPlatformDescription @preview.repl\n',
      lineAt: () => ({ text: 'showAnalyzer sysbus.' })
    };
    const items = registered.completion[0].provider.provideCompletionItems(document, { character: 20 });
    const labels = items.map((i) => i.label);
    // preview.repl declares these; they can only come from following the load line.
    assert.ok(labels.includes('uart0'), `expected uart0, got ${labels.join(', ')}`);
    assert.ok(labels.includes('spi0'));
  });
});

test('hover explains a Monitor command', () => {
  withMockVscode(({ registered }) => {
    const document = {
      languageId: 'renode-resc',
      uri: { fsPath: path.join(root, 'samples/preview.resc') },
      getText: (range) => (range ? 'showAnalyzer' : ''),
      getWordRangeAtPosition: () => ({ start: 0, end: 12 })
    };
    const hover = registered.hover[0].provider.provideHover(document, {});
    assert.ok(hover, 'expected a hover');
    assert.match(hover.contents.value, /showAnalyzer/);
  });
});
