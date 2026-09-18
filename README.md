# Renode `.repl` / `.resc` for VS Code

Syntax highlighting, bracket matching, folding and snippets for
[Renode](https://renode.io/) files:

* **`.repl`** — platform descriptions (peripherals, registration points, IRQ wiring)
* **`.resc`** — Renode Monitor scripts

The extension is purely declarative: two TextMate grammars, two language
configurations and two snippet sets. There is no activation code, no language
server and no dependency on a local Renode install.

## Features

### `.repl` — platform descriptions

```repl
// UART wired to interrupt line 5
uart0: UART.PL011 @ sysbus 0x40011000
    -> nvic@5

spi: SPI.MyController @ sysbus <0x40013000, +0x1000>
    IRQ -> nvic@35
    mode: TransferMode.FullDuplex
```

Highlighted constructs:

| Construct | Example |
| --- | --- |
| Entry declarations | `uart0:` gets its own scope, distinct from the type |
| Qualified type names | `UART.PL011`, `IRQControllers.NVIC` |
| Registration points | `@ sysbus 0x40011000`, `@ none` |
| Address ranges | `<0x40013000, +0x1000>` |
| Multi-registration blocks | `@ { sysbus 0x40010000; spiBridge1 }` |
| IRQ connections | `-> nvic@5`, `IRQ -> nvic@35`, `[0-3] -> nvic@[6-9]` |
| Properties | `size:`, `cpuType:`, `systickFrequency:` |
| Values | strings, `0x`/`0b`/decimal numbers, `true`/`false`/`none`/`empty`, enum values, `new Type { ... }` |
| `using` directives | `using "a.repl" prefixed "pfx_"` |
| `init:` / `reset:` blocks | including `init add:` |
| Paths | `@svd/stm32f4.svd` |
| Comments | `//` to end of line |

Because `.repl` is indentation-sensitive, the extension also enables
indentation-based folding, auto-indent after an entry declaration, and
`<`/`>`, `{`/`}`, `[`/`]` bracket matching.

### `.resc` — Monitor scripts

```resc
:name: Demo board
:description: Sample script.

$bin?=@$ORIGIN/firmware/app.elf

mach create "demo"
machine LoadPlatformDescription @platforms/cpus/stm32f4.repl
sysbus LoadELF $bin

macro reset
"""
    sysbus LoadELF $bin
"""
```

Highlighted constructs:

| Construct | Example |
| --- | --- |
| Script metadata | `:name:`, `:description:` |
| Comments | `#` to end of line |
| Variables | `$bin`, plus `$ORIGIN` / `$CWD` as language variables |
| Assignment | `=` and the conditional `?=` |
| Path arguments | `@platforms/cpus/stm32f4.repl`, `@$ORIGIN/app.elf` (with `$var` interpolation) |
| Built-in objects | `sysbus`, `machine`, `mach`, `emulation`, `connector`, `cpu`, `host`, `monitor`, `plugins` |
| Peripheral paths | `sysbus.uart0` — the member is scoped separately |
| Commands | `start`, `pause`, `include`, `using`, `runMacro`, `showAnalyzer`, `logLevel`, … |
| Method calls | `LoadELF`, `LoadPlatformDescription`, `StartGdbServer`, … |
| Macros | `macro reset` names the macro; commands inside the `"""…"""` body stay highlighted |
| Embedded Python | `python """…"""` bodies are handed to VS Code's Python grammar |
| Literals | strings, `0x`/`0b`/decimal numbers (including negative log levels), `true`/`false` |

Single-letter Monitor aliases (`s`, `p`, `q`, `i`, `h`, `e`) are only treated as
commands at the start of a line, so they are not highlighted when they appear as
arguments.

### Snippets

Type the prefix and press <kbd>Tab</kbd>.

`.repl`: `periph`, `periphrange`, `multireg`, `cpum`, `cpuriscv`, `nvic`, `mem`,
`irq`, `using`, `usingprefixed`, `init`

`.resc`: `resc` (full script skeleton), `mach`, `loadelf`, `loadbin`, `macro`,
`uartsocket`, `uartpty`, `analyzer`, `gdb`, `loglevel`, `include`

## Installing

### From a packaged VSIX

```bash
npm install
npx @vscode/vsce package
code --install-extension renode-repl-resc-0.1.0.vsix
```

### For development

Clone the repository and open it in VS Code, then press <kbd>F5</kbd> to launch
an Extension Development Host. Open `samples/demo.repl` or `samples/demo.resc`
to see every supported construct at once.

To iterate on the grammars, run **Developer: Inspect Editor Tokens and Scopes**
from the Command Palette — it shows the exact scope applied at the cursor.

## Testing

The grammars are tested by tokenizing real snippets with the same libraries VS
Code itself uses (`vscode-textmate` + `vscode-oniguruma`) and asserting on the
resulting scopes:

```bash
npm install
npm test
```

The suite covers each documented construct and asserts that no token in
`samples/` is left unclassified, which catches rules that silently stop matching.

## Theming notes

The grammars use standard TextMate scope names (`entity.name.class`,
`variable.other.property`, `keyword.operator.*`, `constant.numeric.*`, …), so
any theme colors them without extra configuration. To override a specific
scope, add to your `settings.json`:

```jsonc
"editor.tokenColorCustomizations": {
  "textMateRules": [
    {
      "scope": "entity.name.type.peripheral.renode-repl",
      "settings": { "foreground": "#4EC9B0", "fontStyle": "bold" }
    }
  ]
}
```

## Scope reference

Every scope ends in `.renode-repl` or `.renode-resc`, so they can be targeted
without affecting other languages. Run **Developer: Inspect Editor Tokens and
Scopes** on `samples/demo.repl` and `samples/demo.resc` for the full list.

## Limitations

This is a syntax-highlighting extension. It does not validate platform
descriptions, resolve peripheral type names against a Renode build, or provide
completion for C# peripheral properties — Renode itself remains the source of
truth for whether a `.repl` is correct.

## License

MIT — see [LICENSE](LICENSE).
