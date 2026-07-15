# Research: Product Scope and Decisions

Source: `plans/reports/brainstorm-260715-1107-terminal-panel-xterm-search.md`.

## Decision

Add browser-side Find to the active visible xterm terminal only. `Ctrl/Cmd+F` opens a terminal-local bar in the top-right with a query input, previous/next controls, match status, and close. Escape and close clear the search state and restore focus to the same terminal.

## Included

- Search the client-retained xterm buffer only (current scrollback: 5,000 lines).
- One official `SearchAddon` per `TerminalPanel`.
- Per-session imperative controller; no global search state.
- Portal the bar into `terminal.element` so it follows host reparenting.
- Query changes and explicit navigation trigger search.
- Minimal real-browser verification for xterm decorations and navigation.

## Excluded

- All-terminal or inactive-session search.
- Server transcript/history search.
- Persistence across close/session switch.
- Regex, case-sensitive, or whole-word controls.
- General app/file-search changes.

## Acceptance signals

- Browser Find is suppressed.
- Only the active visible terminal opens/responds.
- Query/navigation keys never reach PTY input.
- Search count/no-match state is visible.
- WebGL and DOM renderer paths show usable decorations.
- Reparenting does not remount the terminal or lose the bar.

## Planning assumptions

- Empty query displays a neutral `Type to search` state and clears decorations.
- No match displays `No matches` and leaves the bar open for correction.
- Match status uses one-based `current of total`, based on xterm's result event.
- Close/deactivation clears query and decorations; no query persistence.

## Unresolved questions

None blocking. Exact copy and colors are implementation details constrained by the above behavior.
