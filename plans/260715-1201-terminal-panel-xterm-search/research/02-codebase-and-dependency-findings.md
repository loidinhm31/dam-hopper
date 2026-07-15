# Research: Codebase and Dependency Findings

## Current architecture

- Shared terminal UI lives in `packages/ui`; `packages/web` in the brainstorm is stale.
- `TerminalPanel.tsx` creates xterm, loads addons, streams/replays output, registers PTY input, and disposes the terminal.
- `TerminalKeepAliveHost` keeps panels mounted in a hidden host.
- `terminal-host-attachment.ts` moves each xterm element into the active pane without remounting.
- `PaneContainer.tsx` installs the authoritative custom key handler on the active terminal and overwrites the base handler from `TerminalPanel`.
- `terminal-registry.ts` provides imperative session-keyed access to terminal and fit addon.
- Existing suggestion UI portals into `term.element`; the find bar should use the same mechanism.

## Likely change set

Modify:

- `packages/ui/package.json`
- `pnpm-lock.yaml`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/components/organisms/PaneContainer.tsx`
- `packages/ui/src/lib/terminal-keyboard-shortcuts.ts`
- `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts`
- optionally `terminal-registry.ts` and `terminal-host-attachment.ts` for controller access/deactivation

Create:

- `packages/ui/src/components/atoms/TerminalFindBar.tsx`
- `packages/ui/src/lib/terminal-find-controller.ts`
- `packages/ui/src/lib/terminal-find-controller.test.ts`
- minimal Playwright config/fixture/spec files, location to be finalized in Phase 04

No Rust, REST, WebSocket, PTY, `MultiTerminalDisplay`, or `TerminalKeepAliveHost` behavior changes are required.

## Risks

- The active-pane handler takes precedence over `TerminalPanel`; both paths must route Find.
- `handleSharedTerminalKeyEvent` currently returns `false` without always calling `preventDefault`; Find must explicitly prevent browser Find.
- xterm reparenting means the UI must be portaled to `term.element` and the terminal must not be remounted.
- SearchAddon result counts require the result-change event and decorations option.
- Existing Vitest setup is Node-oriented; real xterm focus/rendering belongs in a focused browser test.

## Dependency evidence

Official xterm typings expose `findNext`, `findPrevious`, `clearDecorations`, `onDidChangeResults`, and `ISearchResultChangeEvent`. The npm package currently publishes `@xterm/addon-search` 0.16.0 and declares xterm v4+ compatibility. Verify the exact package peer/install behavior before pinning.

- https://github.com/xtermjs/xterm.js/blob/master/addons/addon-search/typings/addon-search.d.ts
- https://www.npmjs.com/package/@xterm/addon-search
