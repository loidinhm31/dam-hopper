# Research: Sora Editor 0.23.4 syntax highlighting & visual decorations

Evidence: `javap` on cached `editor-0.23.4.aar` / `language-java-0.23.4.aar` (Gradle cache), Maven Central POMs/listings, `language-textmate-0.23.4-sources.jar`, vscode grammar byte counts. `[INFERENCE]` = not measured.

## 1. Module landscape (pin 0.23.4)

| Module | Size | Deps / runtime | Verdict |
|---|---|---|---|
| `editor` | AAR 661,428 B (classes.jar 698 KB) | androidx.annotation, collection, kotlin-stdlib | in use |
| `language-java` | AAR 27,563 B, 9 classes | none | in use; `.java` only |
| `language-textmate` | AAR 260,203 B + gson 283 KB + jcodings 1.74 MB + joni 230 KB + snakeyaml-engine 293 KB + jdt.annotation 28 KB ≈ **2.83 MB jars** + grammars | JVM regex (joni/Oniguruma port), no `.so` | reject (size, licences, perf) |
| `language-treesitter` | needs `com.itsaky.androidide.treesitter:android-tree-sitter:4.0.1` | per-ABI per-grammar JNI `.so` | reject (native binaries) |
| `language-monarch` | first published **0.23.6** | — | unavailable at pin |
| `language-python/-universal/-base/-html` | latest 0.8.4 | pre-0.2x `lang` API | dead, incompatible |
| `editor-lsp` | — | LSP4J, needs server | out of scope |

TextMate grammar weight (vscode `main`, raw JSON): TS 231,555; TSX 227,983; JS 227,247; Python 101,610; Markdown 79,877; Shell 56,349; Java 40,196; Rust 25,373; JSON 5,084; YAML 3,151 (+split includes); Docker 2,576 → **≈1.0 MB raw** without Kotlin/TOML (not in vscode; third-party grammars needed).

TextMate licensing trap: `language-textmate` sources embed `org.eclipse.tm4e.*` with header `SPDX-License-Identifier: EPL-2.0` (not LGPL). Adds EPL-2.0 (tm4e + jdt.annotation), MIT (joni, jcodings, each grammar), Apache-2.0 (gson, snakeyaml-engine) notices. Perf: `TextMateAnalyzer.tokenizeLine` is `synchronized`, calls `grammar.tokenizeLine2(..., Duration.ofSeconds(2))` per line; regex per token is far slower than a hand lexer `[INFERENCE]`. `GrammarRegistry`/`ThemeRegistry` are process-global singletons.

## 2. Recommendation: one in-repo table-driven lexer on `AsyncIncrementalAnalyzeManager`

Zero new deps, pure DEX, no assets, project-owned code (only *uses* LGPL API — do not copy/modify Sora sources such as `JavaTextTokenizer`, which would make the copy LGPL).

- `LanguageSpec` (data): line comment(s) (`//`, `#`), block comment (`/* */`, nested for Kotlin/Rust), string delimiters (`"`,`'`,`` ` ``, `"""`, Python `'''`, Rust `r#"`), keyword/type/literal sets, bracket pairs, number rule, flags (e.g. Kotlin/JS template `${}`; Rust lifetime `'a` ≠ char).
- Line-mode specs (same tokenizer, tiny extra rules): Markdown (heading/fence/quote/list/inline code by line), YAML (`key:`, `- `, `&anchor`/`*alias`, `#`), TOML (`[table]`, `key =`, `#`), Dockerfile (instruction keyword at line start + `#` + shell-ish strings), Shell (`#`, `$var`, `${}`, quotes, heredoc state), JSON (strings vs keys by lookahead `:`).
- Mapping: Kotlin, Java(optional; keep `JavaLanguage`), JS/TS(+JSX lite), Rust = C-like spec; Python, Shell, TOML, YAML, Dockerfile = hash spec; JSON; Markdown.
- Classes:
  - `SpecLanguage(spec) : Language` → `getAnalyzeManager()` returns its own `SpecAnalyzeManager`; `getSymbolPairs()` non-null; `getFormatter()` = `EmptyLanguage.EmptyFormatter.INSTANCE`; `getNewlineHandlers()` = `emptyArray()`; `requireAutoComplete` no-op; `getInterruptionLevel()` `INTERRUPTION_LEVEL_STRONG`.
  - `SpecAnalyzeManager : AsyncIncrementalAnalyzeManager<Int, Token>`: state = packed `Int` (mode + nesting depth) → `stateEquals` = `a == b`, no per-line state objects; `tokenizeLine(line, state, idx)` returns `LineTokenizeResult(newState, tokens)`; `generateSpansForLine` → `SpanFactory.obtain(col, TextStyle.makeStyle(colorId))`.
  - `computeBlocks(content, delegate)`: walk stored per-line tokens via `getState(line).tokens` (do **not** re-lex like Java's impl), push/pop `{[(` → `CodeBlock` (`startLine/startColumn/endLine/endColumn`), add pairs to `SimpleBracketsCollector.add(open, close)` (char indices), publish via protected `withReceiver { it.updateBracketProvider(this, collector) }`; poll `delegate.isNotCancelled()` in loop. Indent languages (Python/YAML): blocks from indentation or skip (YAGNI).
- Size `[INFERENCE]`: ~1.5–2.5 kLOC Kotlin, <100 KB DEX vs ≈2.8 MB + ~1 MB assets for TextMate.
- Fallback: `EmptyLanguage` for unknown ext / DEGRADED tier.

## 3. Core API (verified signatures)

- `Language`: `getAnalyzeManager()`, `getInterruptionLevel()` (`INTERRUPTION_LEVEL_STRONG/SLIGHT/NONE`), `requireAutoComplete(ContentReference, CharPosition, CompletionPublisher, Bundle)`, `getIndentAdvance(ContentReference, int, int)`, `useTab()`, `getFormatter()`, `getSymbolPairs()`, `getNewlineHandlers()`, default `getQuickQuoteHandler()`, `destroy()`.
- `AnalyzeManager`: `setReceiver(StyleReceiver)`, `reset(ContentReference, Bundle)`, `insert/delete(CharPosition, CharPosition, CharSequence)`, `rerun()`, `destroy()`. Alternatives: `SimpleAnalyzeManager<V>` (full re-analysis), `IncrementalAnalyzeManager<S,T>` (interface).
- `AsyncIncrementalAnalyzeManager<S,T> extends BaseAnalyzeManager`: abstract `getInitialState()`, `stateEquals(S,S)`, `tokenizeLine(CharSequence,S,int)`, `generateSpansForLine(LineTokenizeResult)`, `computeBlocks(Content, CodeBlockAnalyzeDelegate)`; hooks `onAddState/onAbandonState`; `getManagedStyles()`; protected `withReceiver(ReceiverConsumer)`.
- `StyleReceiver`: `setStyles`, `updateStyles(.., StyleUpdateRange)`, `setDiagnostics(.., DiagnosticsContainer)`, `updateBracketProvider(.., BracketsProvider)`.
- `TextStyle.makeStyle(fg)` / `makeStyle(fg, bg, bold, italic, strike[, noCompletion])`; `COLOR_ID_BIT_COUNT = 19` → custom color ids up to 524,287.
- `Styles`: `spans`, `blocks`, `addCodeBlock`, `obtainNewBlock`, `setSuppressSwitch`, `setIndentCountMode`, `addLineStyle/eraseLineStyle` (per-line bg, e.g. git/diagnostic lines).
- Brackets: `BracketsProvider.getPairedBracketAt(Content, int)`; `SimpleBracketsCollector` (precomputed, token-aware); `OnlineBracketsMatcher(char[] pairs /*even length else IAE*/, int limit)` scans raw text on demand — **matches inside strings/comments** (TextMate uses it with limit 100000).
- `SymbolPairMatch`: `putPair(char|char[]|String, SymbolPair(open, close[, SymbolPairEx]))`, `matchBestPair(...)`, `removeAllPairs()`; `SymbolPairMatch.DefaultSymbolPairs`; editor-level override `editor.props.overrideSymbolPairs` (set as parent of language pairs); toggle `props.symbolPairAutoCompletion`. Returning `null` from `getSymbolPairs()` logs "It is a mistake." and substitutes empty.

## 4. Color schemes

- Built-ins (`io.github.rosemoe.sora.widget.schemes`): `SchemeDarcula` (dark), `SchemeVS2019` (dark), `SchemeGitHub`, `SchemeEclipse`, `SchemeNotepadXX` (light), base `EditorColorScheme` (light default). Map `WorkbenchTheme.DARK/LIGHT` → custom subclass, one instance per theme.
- Custom: `class DamHopperScheme(dark) : EditorColorScheme(dark)` (protected `EditorColorScheme(boolean)`), override `applyDefault() { super.applyDefault(); setColor(ID, argb) }`.
  - Pitfall: base ctor calls `applyDefault()` **before** subclass fields initialise → in Kotlin use only constants/companion values inside `applyDefault`.
  - Syntax ids: `KEYWORD 21, COMMENT 22, OPERATOR 23, LITERAL 24, IDENTIFIER_VAR 25, IDENTIFIER_NAME 26, FUNCTION_NAME 27, ANNOTATION 28, HTML_TAG 32, ATTRIBUTE_NAME 33, ATTRIBUTE_VALUE 34, TEXT_NORMAL 5`. Built-in range `START_COLOR_ID 1..END_COLOR_ID 64`; custom token ids (e.g. string, number, type, markdown heading) use ≥256, set via `setColor` (backed by `SparseIntArray`).
  - `setColor` no-ops on equal value, else calls `CodeEditor.onColorUpdated(id)` on every attached editor (weak refs). Shared scheme across editors OK; `release()` calls `detachEditor`.
- `editor.colorScheme = scheme` (`setColorScheme`); `EditorColorScheme.setDefault(...)` is global static — avoid.

## 5. Visual aids (setter → color id; default from `initialize`/`DirectAccessProps` bytecode)

| Aid | API | Default | Colors |
|---|---|---|---|
| Current line | `setHighlightCurrentLine(b)` | true | `CURRENT_LINE 9`; `props.drawCustomLineBgOnCurrentLine` false |
| Current block | `setHighlightCurrentBlock(b)` | true | `BLOCK_LINE_CURRENT 15` |
| Indent/block guides | `setBlockLineEnabled(b)`, `setBlockLineWidth(f)` | true, 1f | `BLOCK_LINE 14`; needs `CodeBlock`s from analyzer |
| Side block line | `props.drawSideBlockLine` | true | `SIDE_BLOCK_LINE 38` |
| Bracket pair | `setHighlightBracketPair(b)`; `props.highlightMatchingDelimiters`, `boldMatchingDelimiters` | true/true/true | `HIGHLIGHTED_DELIMITERS_FOREGROUND 39/UNDERLINE 40/BACKGROUND 41`; needs `BracketsProvider` |
| Line numbers | `setLineNumberEnabled`, `setPinLineNumber(true)` (gutter fixed on h-scroll), `setFirstLineNumberAlwaysVisible`, `setLineNumberAlign`, `setTypefaceLineNumber`, `setDividerWidth/Margin`, `setLineNumberMarginLeft` | enabled; pin false | `LINE_NUMBER 2`, `LINE_NUMBER_CURRENT 45`, `LINE_NUMBER_BACKGROUND 3`, `LINE_DIVIDER 1`, `LINE_NUMBER_PANEL 16/_TEXT 17` |
| Sticky scroll | `props.stickyScroll`, `stickyScrollMaxLines`, `stickyScrollIterationLimit`, `stickyScrollPreferInnerScope`, `stickyScrollAutoCollapse` | false, 3, 1000, false, true | `STICKY_SCROLL_DIVIDER 62`; needs `CodeBlock`s |
| Selection/search | — | — | `SELECTED_TEXT_BACKGROUND 6`, `SELECTION_HANDLE 8`, `MATCHED_TEXT_BACKGROUND 29`, `WHOLE_BACKGROUND 4` |
| Diagnostics | `setDiagnostics`, `setDiagnosticIndicatorStyle` | — | `PROBLEM_ERROR 35/WARNING 36/TYPO 37` |

Also: `setTypefaceText` (JetBrains Mono already bundled, OFL), `setLigatureEnabled`, `setNonPrintablePaintingFlags`, `setLineSpacing`. `EmptyLanguage` yields **no** block lines, bracket highlight or sticky scroll.

## 6. Memory / thread pitfalls (verified in bytecode)

1. `rerun()` (triggered by `reset` ← `setText`/`setEditorLanguage`) runs `Content.copyText(false)` **on the caller (UI) thread** → O(doc) main-thread copy; analyzer keeps this shadow `Content` → ≥2× text memory per open editor, plus per-line `LineTokenizeResult` + span lists.
2. One `Thread` named `AsyncAnalyzer-N` (`BlockingQueue<Message>` loop) per manager instance; `destroy()` only `interrupt()` + `abort=true`. Leak if `release()`/`setEditorLanguage` never called. Current code (`AndroidEditorDocument.attachEditor` sets language before `setText`, `detachEditor` calls `release()`) is correct — keep that order (reset on empty content is cheap).
3. `CodeEditor.release()` and `setEditorLanguage(new)` call `analyzeManager.destroy()` + `language.destroy()` → never reuse a `Language` across attaches/editors; create per attach.
4. `tokenizeLine`/`computeBlocks` run on analyzer thread: no shared mutable state (Java impl uses `ThreadLocal` tokenizer); never touch View/Compose from them.
5. Java's `computeBlocks` re-tokenizes the full doc after every edit (O(n) bg work per keystroke); custom impl should reuse stored tokens and check `delegate.isNotCancelled()`.
6. Long single lines (minified JS/JSON) → huge span/token lists, slow `measureText`; cap per-line tokenization (e.g. >10k chars → single `TEXT_NORMAL` span) `[INFERENCE threshold]`.
7. Tier gate: highlight only `FileTierPolicy.NORMAL_MAX_BYTES` (1 MiB); `EmptyLanguage` for DEGRADED (≤5 MiB).
8. `SpanFactory.obtain` pools spans; don't retain `Styles`/spans outside receiver callbacks.
9. If minification is enabled: `-keep class io.github.rosemoe.sora.** { *; }` (already documented) — custom subclasses of `AsyncIncrementalAnalyzeManager` rely on its protected API.

## 7. Licensing summary

- Recommended path: no new third-party code; existing LGPL-2.1 notices suffice; custom lexers are original work using the library (keep them out of `io.github.rosemoe.*` packages).
- TextMate path would add EPL-2.0 (tm4e, jdt.annotation), MIT (joni, jcodings, grammars), Apache-2.0 notices + grammar provenance inventory to `editor-language-assets.txt`.
- Tree-sitter path adds native `.so` per ABI (arm64-v8a, x86_64) → violates "no unstable native binaries", complicates LGPL relink runbook.

## Unresolved questions

1. Keep `JavaLanguage` for `.java` or unify all languages on the spec lexer for consistent token colours/visual aids?
2. JSX/TSX depth: tag-aware highlighting or treat as TS only?
3. Is sticky scroll wanted (needs accurate `CodeBlock`s for Python/YAML indentation scopes)?
4. Exact per-line cap and whether highlighting should also be disabled for >N lines inside NORMAL tier — needs device memory measurement (API 29 / arm64 qualification still open).
