# Phase 01 — Syntax Highlighting and Editor Decorators

## Context and Goals
- **Objective:** Transform the native Sora `CodeEditor` into a dark-themed, syntax-highlighted IDE code surface with line numbers, bracket matching, current-line highlight, and indentation guide lines using a lightweight table-driven lexer.
- **Authority:** [Plan](plan.md) | [Sora Capabilities Report](../reports/research-261024-1627-sora-editor-capabilities.md)
- **Target Files:**
  - Create: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/UniversalLanguage.kt`
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt`
  - Modify: `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt`

---

## Detailed Implementation Tasks

### 1. UniversalLanguage Implementation
Create `UniversalLanguage.kt` implementing `io.github.rosemoe.sora.lang.Language`:
- Extend `AsyncIncrementalAnalyzeManager<Int, Token>` where the state is a packed integer (lexer state mode + string/comment flags).
- Group syntax rules into:
  - **C-Family:** Kotlin (`.kt`, `.kts`), Java (`.java`), JavaScript / TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`), Rust (`.rs`). Comments `//` and `/* */`, strings `"`, `'`, template literals, keywords, numbers, operators.
  - **Hash-Comment Family:** Python (`.py`), Shell (`.sh`, `.bash`, `.zsh`), TOML (`.toml`), YAML (`.yaml`, `.yml`), Dockerfile (`Dockerfile`, `*.dockerfile`). Comments `#`, strings `"`, `'`, triple quotes, keywords.
  - **Data / Markup:** JSON (`.json` with keys vs string literals by lookahead `:`), Markdown (`.md`, `.markdown` with headings, lists, code fences, blockquotes).
- Map tokens to Sora style IDs:
  - `EditorColorScheme.KEYWORD`
  - `EditorColorScheme.COMMENT`
  - `EditorColorScheme.LITERAL`
  - `EditorColorScheme.OPERATOR`
  - `EditorColorScheme.FUNCTION_NAME`
  - `EditorColorScheme.IDENTIFIER_NAME`
- **Long-Line State Preservation (>10,000 characters):**
  When a line exceeds 10,000 characters (e.g. minified JS/JSON), run a fast state-only scan across the line to update and preserve the outgoing multiline comment/string state without allocating per-character `Span` objects, emitting a single `EditorColorScheme.TEXT_NORMAL` span covering `[0, line.length]`.
- **Bracket Matching & Cancellation in `computeBlocks(content, delegate)`:**
  - For brace-delimited languages: walk stored per-line tokens to collect matching `{`, `[`, `(` braces into `SimpleBracketsCollector`, strictly ignoring brackets occurring inside strings or comments.
  - For indentation-scoped languages (Python, YAML): compute `CodeBlock` lines from leading whitespace indentation levels.
  - Check `delegate.isNotCancelled()` in the line loop; abort promptly on edit invalidation.
  - Call `withReceiver { it.updateBracketProvider(this, collector) }`.
- Provide `UniversalLanguage.forFile(filename: String): Language`:
  - Recognizes filenames such as `Dockerfile` as well as standard extensions.
  - Fallback to `EmptyLanguage()` for unknown extensions.

### 2. Editor Decorators & Degradation-First Language Selection
In `AndroidEditorSurface.kt`:
- Set `colorScheme = SchemeDarcula()` on `CodeEditor`.
- Configure visual aids:
  ```kotlin
  isLineNumberEnabled = true
  setPinLineNumber(true)
  isHighlightCurrentLine = true
  isHighlightBracketPair = true
  isBlockLineEnabled = true
  isHighlightCurrentBlock = true
  setCursorAnimationEnabled(true)
  ```
- **Authoritative Degradation-First Language Selection:**
  Evaluate the UTF-8 byte threshold first (`document.getBudgetMetrics().utf8Length` with conservative fallback `document.length.value.toLong() * 3L`). If the document exceeds `NORMAL_MAX_BYTES` (1 MiB), select `EmptyLanguage()` across all files (including `.java`) to prevent background analyzer overhead. If within normal tier, retain `JavaLanguage()` for `.java` and route all other files through `UniversalLanguage.forFile`:
  ```kotlin
  val utf8Bytes = (document as? AndroidEditorDocument)?.getBudgetMetrics()?.utf8Length
      ?: (document.length.value.toLong() * 3L)
  val isDegraded = utf8Bytes > FileTierPolicy.NORMAL_MAX_BYTES
  val isJava = FileTierPolicy.fileExtension(document.id.relativePath).equals("java", ignoreCase = true)

  val language = when {
      isDegraded -> EmptyLanguage()
      isJava -> JavaLanguage()
      else -> UniversalLanguage.forFile(document.id.relativePath)
  }
  editor.setEditorLanguage(language)
  ```
- **Reassessment on Byte-Size Revision:**
  In `AndroidEditorSurfaceView`, observe `document.revision`. On revision change, recompute `isDegraded = utf8Bytes > NORMAL_MAX_BYTES`. Only reinstall `editor.setEditorLanguage(...)` if the effective degradation state actually flipped (avoiding re-attaching lexers on normal typing).

### 3. Verification & Unit Tests
In `AndroidEditorSurfaceTest.kt`:
- Add unit tests verifying `UniversalLanguage.forFile(...)` for Kotlin, Python, TS, Rust, JSON, Shell, TOML, YAML, Markdown, Dockerfile.
- Test multiline state propagation across incremental line edits.
- Test that brackets occurring inside comments or string literals are not collected as matching pairs.
- Test that lines exceeding 10,000 characters preserve outgoing lexer state while emitting a single span.
- Test that degraded Java and non-Java files (>1 MiB UTF-8) both fallback to `EmptyLanguage`.
- Test degradation reassessment when edits change UTF-8 bytes without changing UTF-16 character length (e.g. replacing ASCII with 3-byte characters across the 1 MiB boundary).

---

## Durable Tasks
```evcrate-tasks
[
  {
    "id": "implement-universal-language-and-decorators",
    "title": "Implement UniversalLanguage table-driven lexer and Sora dark theme decorators",
    "blocked_by": [],
    "allowed_files": [
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/UniversalLanguage.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt",
      "native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt"
    ],
    "constraints": [
      "Zero new third-party dependencies; pure DEX bytecode extending AsyncIncrementalAnalyzeManager.",
      "Degradation evaluated first: any file exceeding NORMAL_MAX_BYTES (>1 MiB UTF-8 bytes) must return EmptyLanguage.",
      "Retain JavaLanguage for normal-tier .java files; unknown extensions must return EmptyLanguage.",
      "Lines exceeding 10,000 characters must scan state only without per-character spans; brackets inside comments/strings must not be matched.",
      "Decorators must include SchemeDarcula, setPinLineNumber(true), isHighlightCurrentLine, isHighlightBracketPair, isBlockLineEnabled."
    ],
    "acceptance": [
      "Kotlin, Python, JS/TS, Rust, JSON, Shell, TOML, YAML, Markdown, and Dockerfile display distinct token colors under SchemeDarcula.",
      "Bracket pairs match correctly excluding strings/comments, block line indent guides render, and line numbers remain visible during horizontal scrolling.",
      "Degraded files (>1 MiB UTF-8) and unknown extensions fallback to EmptyLanguage without throwing exceptions.",
      "Outgoing lexer state is preserved across lines exceeding 10,000 characters.",
      "Language reassessment swaps to EmptyLanguage when UTF-8 bytes cross the 1 MiB threshold even if character count stays constant."
    ],
    "verification": [
      "Run ./gradlew.bat :androidApp:testDebugUnitTest --tests dev.damhopper.nativeapp.platform.editor.AndroidEditorSurfaceTest",
      "Verify clean compilation of :androidApp:compileDebugKotlin"
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-universal-language-and-decorators --> Implement UniversalLanguage table-driven lexer and Sora dark theme decorators (Completed 2026-10-24; 29/29 AndroidEditorSurfaceTest passing; SchemeDarcula and UniversalLanguage verified on emulator)
