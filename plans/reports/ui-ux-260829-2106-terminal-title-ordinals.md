# UX Review: Terminal Title Ordinals

## Recommendation

Approve current global 1-based `openTabs` ordinal semantics. Keep `sessionId` as action identity. No visual redesign or assets required.

## Must-fix constraints before implementation

1. Appending `#N` inside an existing truncated label can hide the distinguishing suffix at narrow widths (`TabBar` max-w-32, legacy max-w-40, runtime/browser labels). Make the ordinal visually discoverable at constrained widths, or explicitly treat failed narrow-width visibility as a requirement failure. Preserve full DOM/accessibility text.
2. A new/pending free tab can briefly have no `freeTerminalIndexMap` entry and render `Terminal ? #N`. Define an understandable pending/free label or explicitly accept and test that transient placeholder.
3. Browser target data is the union of mounted sessions and open tabs. A mounted-only fallback `${project} · ${command}` has no open-list ordinal; state clearly that only open-tab titles require `#N`, or add a separate ordinal contract.

## Cautions

- Global ordinals are intentionally non-contiguous per pane and shift after attach/remove/reorder; document this.
- Keep cwd tooltip precedence, full label/accessibility text, `min-h-11` target sizing, and raw `sessionId` keys/callbacks.
- No live consumer of legacy `TerminalTabBar` was found; tests still cover it.

## Success checks

Two same-command terminals show distinct visible `#1`/`#2` at normal and narrow widths; removal/reorder updates current open-list ordinals; free pending state is readable; selecting/closing/pinning/diagnostics still receives the raw session ID.

## Unresolved questions

None; mounted-only browser targets are out of the open-title ordinal contract and may retain their readable fallback.
