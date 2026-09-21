# Changelog

## 0.2.0

Adapted the grammars to real Renode files. Both file types now classify 100% of
the tokens in every `.repl` and `.resc` file in
[renode/renode](https://github.com/renode/renode) (231 + 137 files); before this
release 2.2% of `.repl` and 1.4% of `.resc` tokens were left unhighlighted.

`.repl` additions:

* `/* … */` block comments, and `#` comments inside `init:`/`reset:` blocks —
  disambiguated from the connector index in `gic#0@29`.
* Connector indices (`gic#0@29`, `gic#0x1@30`), `|`-separated IRQ destination
  lists, and hex IRQ lines (`-> ldma@0x0040`).
* `'''…'''` Python peripheral scripts, highlighted with VS Code's Python grammar.
* Digit separators in numbers (`100_000_000`).
* The `.GICv3` enum shorthand and multi-segment enum values.
* Nested lists (`invertedAFPins: [[1, 5], [7, 2]]`).
* Backtick Monitor expressions (``PC `syscon ResetVector` ``).
* Keyword arguments in Monitor commands (`Tag <…> "X" silent=true`) and
  `sysbus.member` chains.
* CPU registers (`PC`, `SP`, `LR`).

`.resc` additions:

* Metadata continuation lines starting with `:`.
* `//` comments, alongside `#`.
* Single-quoted strings.
* Inline platform fragments passed to `LoadPlatformDescriptionFromString` are
  highlighted as `.repl`, in single-quoted, double-quoted and `"""…"""` form.
* Backtick Monitor expressions (``$id = `next_value 1` ``).
* Peripheral paths with custom roots (`twi0.lsm9ds1_imu`).
* Bare `$ORIGIN`-relative paths given without a leading `@`.
* Address ranges in Monitor commands (`sysbus Tag <0x40080000 0x400> "RADIO"`).
* CPU registers (`PC`, `SP`, `LR`).

Tooling:

* `tools/scan-corpus.mjs` (`npm run corpus -- <dir>`) tokenizes a directory of
  Renode files and reports every unclassified token, ranked by frequency.
* An opt-in test (`RENODE_CORPUS=<dir> npm test`) runs the same check, plus a CI
  job that does it against upstream `renode/renode`.

## 0.1.0

Initial release.

* TextMate grammar for Renode platform descriptions (`.repl`), covering entry
  declarations, qualified type names, registration points and address ranges,
  multi-registration blocks, IRQ connections, properties and value literals,
  `using` directives, `init:`/`reset:` blocks, paths and comments.
* TextMate grammar for Renode Monitor scripts (`.resc`), covering script
  metadata, comments, variables and `?=` assignment, `@` path arguments,
  built-in objects and commands, method calls, macros with `"""…"""` bodies and
  embedded Python blocks.
* Language configurations: comment toggling, bracket matching and auto-closing,
  indentation-based folding and auto-indent for `.repl`.
* Snippets for common `.repl` entries and `.resc` script boilerplate.
* Grammar test suite running on `vscode-textmate` + `vscode-oniguruma`.
