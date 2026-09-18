# Changelog

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
* Language configurations: `//` and `#` comment toggling, bracket matching and
  auto-closing, indentation-based folding and auto-indent for `.repl`.
* Snippets for common `.repl` entries and `.resc` script boilerplate.
* Grammar test suite running on `vscode-textmate` + `vscode-oniguruma`.
