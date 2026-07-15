# Inline Terminal Suggestions — Brainstorm Summary

Date: 2026-07-16  
Status: agreed direction; planning not started

## Decision

Recommend a **shell-aware hybrid**:

- verified shell lifecycle, never PTY-silence guessing
- passive, cursor-adjacent ghost suffix for the best true-prefix match
- suffix-only insertion; never rewrite the whole shell line
- explicit list mode for fuzzy/history reuse
- desktop first; mobile suggestions explicitly unsupported until input paths unify
- local history retained with clear/disable controls and verified-submission-only recording

This is not a positioning-only cleanup. Current behavior has correctness, portability, privacy, and potential secret-retention defects. Safety gates must land before visual polish.

## Gate contract

### Final artifact

Deep findings report plus chosen UX/technical direction. No implementation in this brainstorm.

### Acceptance boundary

Work is correct only when suggestions cannot alter ordinary terminal typing, execute unexpectedly, accept stale text, or record interactive secrets; reuse and position must then satisfy the observable criteria below.

### In scope

- desktop xterm input and PTY output lifecycle
- prompt/command lifecycle detection
- command shadow state, search, ranking, debounce, acceptance, dismissal
- overlay/ghost geometry across resize, split, reparent, wrap, and scroll
- local history fidelity, retention, clearing, and privacy copy
- accessibility and automated integration coverage
- explicit fallback behavior for unsupported shells and mobile

### Out of scope

- implementing changes during this brainstorm
- full mobile support in first delivery
- AI/network-generated suggestions
- cross-device/cloud history synchronization
- replacing the terminal with a general command editor

### Constraints

- preserve native shell/TUI semantics across bash, zsh, fish, PowerShell, vi/readline modes, SSH, sudo, REPLs, and alternate screen programs
- use public xterm APIs where possible; isolate any dependency on xterm DOM structure
- keep browser package independent from server types
- retain current local-first architecture; no new backend store
- current worktree contains unrelated user changes, including `TerminalPanel.tsx`, settings, API, and server config
- `/mnt/data` is 100% full; Vitest could not start because Vite hit `ENOSPC`

## Evidence and root causes

### P0 — silence heuristic can capture interactive secrets

`PromptDetector` treats 100 ms without PTY output as a ready shell prompt, and ignores output while input is active (`packages/ui/src/lib/prompt-detector.ts:27-37`). The hook records the shadow line on Enter (`packages/ui/src/hooks/use-terminal-suggestions.ts:208-215`), and history persists plaintext to localStorage (`packages/ui/src/lib/command-history.ts:100-150`).

Failure sequence: a password prompt becomes quiet, the user types a secret, then Enter persists it as command history. The same false-ready state can occur in SSH, sudo, REPLs, silent commands, and interactive TUIs.

Root cause: terminal silence is not command lifecycle. Input after a command starts is opaque interactive input and must never become shell history.

### P0 — terminal input is hijacked

While visible, the feature consumes the first Tab, cycles suggestions, and only forwards a synthetic rapid double-Tab (`use-terminal-suggestions.ts:159-180`). Enter replaces the line rather than executing it (`:189-197`). Escape dismisses and is also sent to the PTY (`:199-203`) although the UI says “Esc dismiss” (`TerminalSuggestionOverlay.tsx:91-94`).

Root cause: a passive suggestion is implemented as an active, preselected menu. Native terminal keys lose precedence.

### P0 — accepted text can be stale or semantically changed

Rendered results are not cleared/versioned immediately when input changes. A user can type `gi`, wait for results, type `t`, then press Enter before the next 150 ms search and accept the old `gi` result (`use-terminal-suggestions.ts:233-245`). Acceptance sends Ctrl+U plus the complete stored command (`:267-273`), which assumes shell-specific line editing.

History recording collapses all whitespace (`command-history.ts:125-127`), altering quoted strings, indentation, and multiline commands. Unicode tokenization is ASCII-only and ignores one-character tokens (`:23-28`), making reuse unpredictable.

Root cause: unversioned asynchronous results plus destructive full-line replacement. Stored command text is treated as normalized search data instead of immutable user data.

### P1 — browser shadow line diverges from the shell

`TerminalInputBuffer` models simple append, backspace, Ctrl+U, and Ctrl+W, but cursor movement, shell completion, history navigation, bracketed/multiline paste, IME, and grapheme deletion can diverge or mark the line permanently unclean (`packages/ui/src/lib/terminal-input-buffer.ts:6-93`). Double-Tab changes the actual shell line without updating the shadow buffer. UTF-16 slicing can corrupt emoji/graphemes.

Root cause: the browser tries to reconstruct a shell editor from outgoing bytes without authoritative shell state.

### P1 — placement is neither inline nor reactive

Positioning computes cell width and cursor X but ignores both, hard-coding `x = 4`; it assumes five rows when choosing above/below (`use-terminal-suggestions.ts:47-64`). It recomputes only when debounced results appear (`:233-245`), not on cursor movement, fit, resize, reparent, scroll, wrap, or font changes.

The overlay uses `minWidth: 220` with no terminal clamp (`packages/ui/src/components/atoms/TerminalSuggestionOverlay.tsx:49-58`), so narrow panes/mobile can clip. xterm exposes cursor cells and lifecycle events, but not stable public pixel-cell geometry. Its DOM-decoration API could track a cell, but is experimental.

Root cause: geometry is a one-time estimate based on the full host box, rather than a measured terminal-screen anchor with lifecycle subscriptions.

### P1 — controls and input paths are inconsistent

- close maps to `notifyOutput` (`TerminalPanel.tsx:636-641`), which returns without dismissing during active input (`use-terminal-suggestions.ts:257-264`)
- turning the setting off does not explicitly cancel/hide current suggestions
- initial terminal replay does not prime the prompt detector
- mobile accessory/native/custom keyboard writes bypass the suggestion hook (`MobileTerminalAccessoryBar.tsx:55-129`)
- mouse-down prevention and immediate acceptance block selecting/copying truncated commands (`TerminalSuggestionOverlay.tsx:67-82`)

### P1 — accessibility and privacy contract are missing

The list lacks listbox/option/selected semantics, the close control lacks an accessible label, and recency uses color/title only (`TerminalSuggestionOverlay.tsx:60-103`). There is no discovered UI caller for `clearHistory()` (`command-history.ts:203-209`), and configuration docs omit `terminal_suggestions_enabled` (`docs/configuration-guide.md:184-218`).

### Test gap

Only the input buffer and prompt detector have feature-adjacent unit tests. No hook, history, overlay, key-priority, stale-result, xterm geometry, password/TUI, paste, IME, Unicode, resize, reparent, mobile, or accessibility integration tests were found.

## Evaluated approaches

### A. Shell-aware hybrid — chosen

Use supported-shell integration to emit prompt-start, command-start, and command-finished lifecycle markers. Allow suggestions only during a verified editable shell prompt. Freeze and optionally record the exact command at verified command submission; all later input is opaque until the next verified prompt.

Interaction:

- show only the best true-prefix candidate as muted suffix at the cursor
- Right/End accepts the remaining suffix; optional modifier+Right accepts the next token
- insertion writes only the accepted suffix to the PTY; it does not execute
- Tab, Enter, Ctrl+R, arrows, Esc, paste, and TUI keys pass through unchanged in passive mode
- any unmodelled edit, completion, paste, IME ambiguity, alternate buffer, or lifecycle uncertainty suppresses suggestions
- fuzzy/non-prefix results live in an explicitly invoked accessible list with no implicit selection
- unsupported shells fall back to explicit history mode, not silence detection

Pros:

- fixes the lifecycle root cause
- best balance of fast reuse, accurate placement, and native terminal behavior
- suffix insertion avoids Ctrl+U portability problems
- enables trustworthy history recording boundaries

Cons:

- shell integration matrix and installation/launch behavior need careful design
- prompt markers are protocol signals, not authentication; lifecycle must be stateful and fail closed
- cursor pixel anchoring needs an isolated geometry adapter and browser coverage

### B. Explicit history mode

Remove automatic suggestions and recording based on silence. Let users deliberately open a history picker/composer, then copy or insert a selected command through a clearly scoped action.

Pros: safest smaller change; excellent inspect/copy/accessibility; no false prompt activation.  
Cons: slower reuse; full-line replacement remains non-portable unless the composer owns submission or shell integration is later added.

Use as the fallback for unsupported shells and as an emergency safety mode.

### C. Harden current popup

Fix dismissal, result versioning, geometry, clamping, copy affordances, and tests while retaining silence detection, shadow-line reconstruction, and Ctrl+U replacement.

Pros: smallest visual migration.  
Cons: leaves the main privacy and portability architecture intact; repeated edge-case patches likely. Rejected.

## Recommended behavior contract

### Passive ghost

- appears only at a verified normal-buffer shell prompt
- candidate must byte-for-byte start with the current clean input
- renders only the remaining suffix; never covers typed cells
- has no focused/preselected menu state and does not announce on every keystroke
- is invalidated synchronously on every input revision before a new search starts
- full accept inserts exactly the suffix; partial accept inserts the next token boundary
- never accepts or executes on Enter or Tab

### Explicit list

- deliberate trigger/button enters list mode; native keys are owned only while mode is explicitly active
- supports fuzzy and project-aware results, full text inspection, copy, and clearly named “use” action
- listbox/option semantics, labelled dismissal, selected state, keyboard help, contrast compliance
- measured size, terminal-edge clamping, scroll for overflow, no fixed five-row flip estimate

### History

- record only the command captured at verified shell command-start/submission
- preserve exact raw command; derive separate normalized/tokenized search fields
- never record input while a command, password prompt, REPL, TUI, SSH session, or alternate screen is active
- local-only, documented retention limit, immediate clear action, enable/disable control
- validate every persisted field; corrupted storage degrades to empty history

### Geometry

- isolate cursor-to-pixel calculation behind one adapter
- measure the xterm screen, use buffer cursor X/Y, then clamp to terminal bounds
- update or dismiss on cursor move, parsed output, resize, fit, host ResizeObserver, scroll, session hide, and reparent
- suppress UI if geometry cannot be measured reliably
- avoid experimental xterm decorations initially unless a spike proves lifecycle and renderer compatibility superior to the measured-screen adapter

## Validation criteria

### Safety and correctness

- zero secret/history capture in sudo, SSH/password prompts, REPLs, silent commands, and alternate-screen TUIs
- unsupported/unverified shells never use the silence heuristic
- Tab and Enter bytes reach the PTY unchanged in passive mode
- Esc dismissal never changes shell editing mode unless explicit list mode owns it
- accepted text belongs to the current input revision and inserts suffix only
- exact whitespace, multiline data, Unicode, and graphemes round-trip without mutation
- paste/IME/cursor edits either remain correct or suppress suggestions until the next verified prompt

### Reuse UX

- top true-prefix match is available without opening a list
- full and token-level acceptance never executes the command
- fuzzy history can be explicitly opened, fully inspected, copied, and used
- search strongly prioritizes exact full-line prefix before token/BM25 signals

### Position and accessibility

- ghost begins at the actual cursor and never covers typed input
- split, resize, reparent, wrap, scroll, zoom, and font changes reposition next frame or dismiss
- no clipping in narrow desktop panes; popup height uses measured content
- passive mode causes no excessive screen-reader chatter
- explicit list has complete semantics, labels, visible focus, and compliant contrast

### Automated coverage

- pure tests: exact history fidelity, Unicode/graphemes, tokenization, result revisioning, sensitive lifecycle states
- hook tests: key pass-through, suffix/partial acceptance, debounce races, close/toggle, paste/IME suppression
- component tests: list accessibility, copy/use, clamp/flip based on measured size
- browser/PTY tests: supported shell lifecycle, password prompt, completion, vi/readline modes, resize/split/reparent, scroll/wrap
- explicit regression assertion that mobile suggestions are unavailable rather than partially active in desktop-first scope

## Touchpoints

- `packages/ui/src/hooks/use-terminal-suggestions.ts`
- `packages/ui/src/lib/prompt-detector.ts`
- `packages/ui/src/lib/terminal-input-buffer.ts`
- `packages/ui/src/lib/command-history.ts`
- `packages/ui/src/components/atoms/TerminalSuggestionOverlay.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
- `packages/ui/src/lib/terminal-host-attachment.ts`
- `packages/ui/src/lib/terminal-registry.ts`
- `packages/ui/src/hooks/use-command-search.ts`
- settings chain in `SettingsAppearanceSection.tsx`, `stores/settings.ts`, `api/client.ts`, and `server/src/config/schema.rs`
- shell launch/session setup in the Rust PTY layer, subject to planning research
- unit, component, and browser/PTY integration tests
- `docs/configuration-guide.md` and user-facing privacy/compatibility docs

## Risks and mitigations

- **Shell support fragmentation:** define an explicit supported-shell matrix; fallback to manual history mode.
- **Marker spoofing/lifecycle drift:** stateful transitions; accept prompt-ready only from the integration contract; freeze input on command-start; fail closed on invalid sequences.
- **xterm geometry instability:** one adapter, no scattered DOM selectors, renderer/zoom/reparent browser tests, suppress on measurement failure.
- **Keybinding conflicts:** passive mode owns only explicit acceptance keys under clean end-of-line conditions; list trigger configurable.
- **History sensitivity:** verified command boundary, clear/disable controls, exact documentation, optional future filtering only after evidence.
- **Concurrent worktree edits:** implementation plan must re-scout overlapping terminal/settings/config changes before coding.
- **Disk exhaustion:** free space before running or claiming tests; current `ENOSPC` blocks fresh Vitest evidence.

## Success metrics

- 0 native-key regressions in supported terminal scenario matrix
- 0 recorded secrets across password/interactive regression scenarios
- 0 stale-result acceptances under debounce/race tests
- 100% exact command-text round trip in fidelity corpus
- ghost remains cursor-adjacent or cleanly hidden across geometry scenarios
- users can accept a prefix suffix in one action and a token in one action
- all new hook/history/component tests pass plus manual real-shell verification

## Next step

Create a detailed implementation plan with a required security stop-gap, shell-integration feasibility spike, interaction/state-machine specification, geometry adapter, history migration/privacy controls, test matrix, and desktop-only release boundary.

## Unresolved questions

- Which shells/platforms are mandatory for first supported release: bash only, bash+zsh+fish, or include PowerShell?
- Choose partial-accept key after platform keybinding audit: Alt+Right, Ctrl+Right, or configurable only.
- Should unsupported shells expose explicit history mode automatically or require user opt-in?
- Should existing normalized history be migrated, retained as legacy, or cleared because original whitespace cannot be recovered?
