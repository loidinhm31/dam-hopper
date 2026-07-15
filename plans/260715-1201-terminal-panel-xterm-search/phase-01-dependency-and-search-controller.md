# Phase 01 — Dependency and Search Controller

## Context links

- Parent: [plan.md](./plan.md)
- Scope research: [research/01-product-scope-and-decisions.md](./research/01-product-scope-and-decisions.md)
- Codebase research: [research/02-codebase-and-dependency-findings.md](./research/02-codebase-and-dependency-findings.md)
- Existing terminal registry: `packages/ui/src/lib/terminal-registry.ts`
- Official API typings: https://github.com/xtermjs/xterm.js/blob/master/addons/addon-search/typings/addon-search.d.ts

## Overview

- Date: 2026-07-15
- Priority: P2
- Status: Completed 2026-07-15
- Review status: Approved
- Description: Add the matching search addon and isolate search state/imperative calls from React and PTY transport code.
- Estimate: 2h

## Key Insights

- `SearchAddon` is an xterm addon and must be loaded once per `TerminalPanel`.
- `findNext`/`findPrevious` return a boolean, while `onDidChangeResults` supplies result index/count when decorations are enabled.
- A controller avoids putting `Terminal` or addon instances in React state and gives `PaneContainer` a safe active-session callback.
- Do not scan raw PTY data or server history; xterm's buffer semantics handle wrapping, unicode, and scrollback boundaries.

## Requirements

- Add `@xterm/addon-search` to `packages/ui/package.json`; update `pnpm-lock.yaml` with the exact compatible version selected after install/peer verification.
- Define a focused controller API: `open`, `close`, `setQuery`, `findNext`, `findPrevious`, `getSnapshot`, `subscribe`, and `dispose` (names may follow repository conventions).
- Track only UI/search state: open flag, query, result index, result count, and an empty/no-match status.
- Configure plain-text, case-insensitive, whole-buffer search with match and active-match decorations. Do not expose regex/case/whole-word controls.
- Clear decorations when query is empty, closed, deactivated, or disposed.
- Do not rescan automatically on every terminal output event; next query/navigation action refreshes the search.

## Architecture

```text
TerminalPanel
  ├─ Terminal + SearchAddon (one pair per session)
  ├─ TerminalFindController (imperative session-local state)
  └─ terminal registry entry/controller access
       ↑
PaneContainer active-terminal key handler → controller.open()
       ↓
TerminalFindBar subscribes to controller snapshot
```

Prefer extending the existing `TerminalEntry` with a controller reference only if it keeps lifecycle ownership clear. Otherwise create a small session-keyed find-controller registry; do not mix search state into fit scheduling or layout state. The controller owns the addon event disposable and calls `clearDecorations` during cleanup.

## Related code files

Modify:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/package.json` — dependency.
- `/mnt/data/ws/sharing/dam-hopper/pnpm-lock.yaml` — resolution/importer entries.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-registry.ts` — only if controller access belongs in the entry.

Create:

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-find-controller.ts` — controller and state types.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-find-controller.test.ts` — addon-double/controller unit coverage.

Delete: none.

## Implementation Steps

1. Check the addon package metadata and peer behavior against `@xterm/xterm` 6.0.0; choose the compatible release and install with pnpm.
2. Add a narrow controller around `SearchAddon`; keep `Terminal`/addon types out of React state.
3. Subscribe to `onDidChangeResults`; normalize xterm's zero-based `resultIndex` to the one-based UI status.
4. Implement search options once, including decoration colors and no regex/case/whole-word overrides.
5. Make `setQuery` clear empty searches and perform one deliberate search for non-empty queries.
6. Make next/previous no-op for empty query and otherwise call the addon and let the result event update status.
7. Make close/dispose idempotent and remove all addon event subscriptions.
8. Add pure/unit tests for query transitions, result events, navigation, no-match, clear, dispose, and independent controller instances.

## Todo list

- [x] Verify addon version/peer compatibility.
- [x] Add dependency and lockfile entries.
- [x] Implement controller and snapshot/subscriber contract.
- [x] Define empty/no-match status constants.
- [x] Add controller tests.

## Success Criteria

- `pnpm --filter @dam-hopper/ui build` type-checks the new dependency/controller.
- Controller tests pass without a DOM or PTY.
- No server, WebSocket, or raw-output parser changes are introduced.
- Disposing a controller removes its addon listener and decorations.

## Verification Evidence

Validated 2026-07-15:

- `@xterm/addon-search@0.16.0` installs beside the single `@xterm/xterm@6.0.0` dependency; pnpm reports no addon peer conflict.
- `pnpm --filter @dam-hopper/ui test`: 85 files and 428 tests passed, 0 failed.
- `pnpm --filter @dam-hopper/ui test -- src/lib/terminal-find-controller.test.ts`: 1 file and 6 tests passed, 0 failed.
- `pnpm --filter @dam-hopper/ui build`: TypeScript build passed.

## Risk Assessment

- Risk: version mismatch or duplicate xterm packages. Mitigation: inspect pnpm dependency tree and use the repository's existing xterm version; fail this phase before UI work if peer resolution is invalid.
- Risk: result count stays stale. Mitigation: use `onDidChangeResults`, not the boolean return value alone.
- Risk: memory leaks across keep-alive sessions. Mitigation: controller disposal is part of `TerminalPanel` cleanup and is unit-tested.

## Security Considerations

- Search never leaves the browser and never sends query text to the server.
- Do not log query contents; terminal output may contain secrets.
- Keep all state session-local and ephemeral.

## Next steps

Expose the controller from `TerminalPanel`, render the find bar, and wire lifecycle cleanup in Phase 02.
