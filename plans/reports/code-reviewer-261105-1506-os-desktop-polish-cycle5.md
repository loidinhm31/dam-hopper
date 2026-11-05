# OS Desktop Polish — Cycle 5 Code Review

- **score: 4/10**
- **critical_count: 2**
- **Disposition: request changes.** Search mode, Settings delivery and DoubleShift capture/IME reset are fixed. The terminal fix creates a new way to kill live PTYs, and leaked launch-journal records can permanently block New Terminal.

## Scope / evidence

Reviewed the Cycle 5 changes in `TerminalsApp.tsx`, `OsResourceHost.tsx`, `SearchPanel.tsx`, `SearchApp.tsx`, `OsShell.tsx` (search/terminal producers), `SettingsApp.tsx`, `action-dispatch.ts` and `TerminalPanel.tsx`. Traced the call paths through `persistence.ts` (journal and sanitize), `action-executor.ts`, `DesktopContextMenu.tsx`, `terminal-registry.ts`, `terminal-host-attachment.ts`, `browser-shortcut-guard.ts` and `server/src/pty/manager.rs`. Also checked the server config diff and docs.

Checks run by the reviewer: `tsc --noEmit` in `packages/ui` passed with no errors. `vitest run` on `SettingsApp.test.tsx`, `action-dispatch.test.ts`, `app-launch-journal.test.ts` and `action-executor.test.ts` passed 4 files and 22 tests. Not run: cargo, browser, E2E and lint. There is no test file for TerminalsApp. Runtime consequences below come from reading the source and have not been reproduced live; the DOM-stacking claim is marked [INFERENCE].

## Critical

### C1 — "Inactive/Launch" overlay shown for live terminals; Launch kills the running PTY
- `packages/ui/src/os/apps/TerminalsApp.tsx:83,342-384` decides whether to show the overlay from `target?.incarnation || appState.incarnation`. It no longer checks whether the renderer is registered.
- Several kinds of window never carry an incarnation:
  - `agent:focus` opens the window with only sessionId/terminalId (`OsShell.tsx:1381-1395`).
  - Windows restored after a reload keep only `sessionId` and `cwd` (`persistence.ts:43-49`).
  - `terminal:open` drops the incarnation when serverEpoch is not canonical (`OsShell.tsx:416-424`).
  - Palette OMP windows and template windows have neither (`CommandPalette.tsx:287-296`, `desktop-templates.ts:64-73`).
- None of these windows has an attempt ID or target, so the overlay offers "Launch Terminal Session". That button calls `terminal.create({id: <live id>})`, and the server first kills any existing session with that ID: "Kill any existing session with this ID before recreating" (`server/src/pty/manager.rs:1635-1636`). **Impact:** a running shell or agent process is killed and replaced.
- The overlay has no z-index. The xterm element is reparented as `position:absolute` and appended to the same host (`terminal-host-attachment.ts:19,48`). Which layer is on top therefore depends on DOM order. After a disconnect and reconnect, React re-appends the overlay after the xterm, so the overlay covers the live terminal [INFERENCE]. When the xterm sits on top instead, a fresh window's Launch/Retry/error UI is hidden behind it.
- **Fix:** keep "is the stream attached" separate from "was this created by this attempt". Only show the create overlay when the window holds a reserved attempt ID and inventory has shown the ID is absent. Never offer create for an ID that inventory reports as live. Give the overlay an explicit stacking order. Add tests for the agent:focus, reload and reconnect cases.

### C2 — Launch journal leaks unresolved records → New Terminal blocked permanently and silently
- `persistence.ts:1108-1120` blocks any reservation whose identity matches a record in `reserved-dispatch-capable` or `uncertain` state. Nothing expires these records, reconciles them against inventory, or lets the user clear them, and they persist in localStorage.
- Ways a record gets stuck:
  - The window is closed before auto-launch runs; auto-launch needs a connection and a successful claim (`TerminalsApp.tsx:208-218`).
  - The window is closed or replaced while create is in flight; the code returns without settling (`TerminalsApp.tsx:138-144`).
  - The create response has no `serverEpoch`, so settlement is skipped (`:156`).
  - A reload drops `attemptId`, because sanitize keeps only sessionId/cwd (`persistence.ts:43-49`).
  - Errors raised before anything is sent ("not connected", "generation changed before launch") contain "connected"/"generation" and are classified `uncertain` (`TerminalsApp.tsx:178-182`).
- The default workspace identity (profile, `default-endpoint`, workspace, null cwd) is the same for every default New Terminal on a profile. One leaked record therefore blocks Desktop-menu and Dock New Terminal for that profile. `DesktopContextMenu.tsx:202-221` ignores the `blocked` result, so the user sees nothing happen.
- **Fix:** settle on every exit path, including unmount/close via a cleanup or window-close hook that records `uncertain` or `confirmed-not-created` based on whether the request was sent. Decide the classification from a `dispatched` flag set immediately before `await create`, not from error text. Reconcile `uncertain` records against `terminal list` (by ID and epoch) so they can resolve. Show blocked results to the user.

## Warnings

1. **High — Cmd/Ctrl+Shift+C copy in terminals broken.** For terminal targets, `browser-shortcut-guard.ts:46-47` returns `prevent-default`. `action-dispatch.ts:357-360` then marks the event handled, and `TerminalPanel.tsx:1076-1078` returns early. The early return skips `handleSharedTerminalKeyEvent`, which is where copy happens (`terminal-keyboard-shortcuts.ts:156-158`). The old guard did not stop the event, so this is a regression. Fix: only mark `block` suppressions as handled by the coordinator, or exempt terminal copy.
2. **High — Placeholder authority `"canonical-epoch"`.** `TerminalsApp.tsx:154` builds the target with `serverEpoch ?? "canonical-epoch"`. The panel's epoch checks (`TerminalPanel.tsx:666,1228,1332`) then fail, which disables stdin permanently. The window becomes existing-only with no retry, and the journal record stays unresolved (feeds C2). Fix: without a canonical epoch, do not publish a target; settle `uncertain` and say why.
3. **Medium — Retry can create orphan PTYs.** Error messages from HTTP 5xx, "Failed to fetch" and closed sockets after the request was sent are classified `confirmed-not-created` (`TerminalsApp.tsx:178-186`). Retry then reserves a new ID while the first PTY may already exist.
4. **Medium — Manual Launch bypasses the journal.** When there is no `attemptId`, `handleLaunchSession` still sends the create (`TerminalsApp.tsx:92,362-369`). This covers restored, template and palette windows. Carried over from Cycle 4 W4.
5. **Medium — Retry fences.** Retry records `activeDesktopId` instead of the window's own desktop (`TerminalsApp.tsx:231`). After the reservation await it does not re-check the window, owner or generation (`:251-266`).
6. **Medium — Stale closure and wasted renders.** The attach effect reads `target` but its deps are only `[sessionId, claimStatus.success, owner.profileId]` (`TerminalsApp.tsx:280-303`). It works only because the panel keeps a ref-key alias (`TerminalPanel.tsx:1527-1547`). `hasRendererRegistered` is set but never read (`:80-82,290`), so every registry change re-renders every TerminalsApp. The `generateUUID` import is unused (`:16`).
7. **Medium — Docs contradict each other and overclaim.** `system-architecture.md:385` says "Planned Design, Not Implemented", while `CHANGELOG.md` and `project-roadmap.md` claim implementation plus "automated qualification complete". There are no TerminalsApp tests and no fresh-PTY attach/IO evidence. The CHANGELOG says `useBrowserShortcutGuard` was removed, but a no-op stub remains.
8. **Low — Shim left after cutover.** `use-browser-shortcut-guard.ts` is a no-op "kept for backward compatibility", and its import in `dam-hopper-app.tsx:45` is unused. Delete both.
9. **Low — DoubleShift not reset in modal/menu stage.** The modal/menu stage returns early without resetting DoubleShift (`action-dispatch.ts:202-239`). Shift inside the palette followed by Shift after it closes can fire filename search.
10. **Low — Search mode duplication.** The mode is written to both `mode` and `searchMode` (`OsShell.tsx:1185-1186,1204-1205`) and read from both (`SearchApp.tsx:22`). Toggling scope remounts with the originally delivered mode, so the user's chosen mode is lost (`SearchApp.tsx:148,155`).

## Suggestions (security / perf / arch / YAGNI-KISS-DRY)
- Use one small terminal attempt state machine (reserved → dispatched → confirmed/uncertain/not-created) and keep it separate from stream-attached. Drive the overlay from that state.
- Use the response's `incarnationExact` instead of `String(sessionRes.incarnation)` (`TerminalsApp.tsx:153,169`). There is no practical precision risk today (now_ms×1024 < 2^53), but the field exists for exactly this.
- KISS: drop the `"initial"` sentinel in `SettingsApp.tsx:34-38` by treating a missing deliveryId as a single mount-time request. Drop the defensive noise at `SearchPanel.tsx:109,358` (`queries && mode`, `query?.length`).
- Performance: in `action-dispatch.ts:329-344`, resolve the action context lazily, only after a binding matches.
- DRY across languages: `EXTRA_ACTION_IDS` (`server/src/api/config.rs:611-626`) duplicates the UI catalog. Add a cross-check test. Consider a length bound on `appShortcuts` values.
- Positives: the Search mode fix keys on deliveryId and remounts correctly. Settings consumes each delivery once. DoubleShift resets on capture/IME/blur. `mountKey` includes sessionId, so retry remounts cleanly. The browser keep-alive host no longer mounts a default `localhost:5173` iframe, which is a security improvement. The server validates `appShortcuts` keys and value types.

## Unresolved questions
- Does every server create response include a canonical `serverEpoch`? If not, W2 affects every create.
- Who owns the plan-status correction? `plan.md` says `status: completed`, but C1 and C2 block release. The reviewer did not edit the plan.
