## Phase Implementation Report

### Executed Phase
- Phase: P07 — One sequential shell/resource/action integration owner
- Plan: plans/261104-1529-os-session-management-and-interactions/phase-07-sequential-integration.md
- Status: completed

### Files Modified
- `packages/ui/src/os/review-retirement.tsx` (Created, 150 LOC)
- `packages/ui/src/os/OsShell.tsx` (Modified, +250 LOC)
- `packages/ui/src/os/OsResourceHost.tsx` (Modified, +30 LOC)
- `packages/ui/src/os/apps/TerminalsApp.tsx` (Modified, +45 LOC)
- `packages/ui/src/os/window-store.ts` (Modified, +125 LOC)
- `packages/ui/src/os/types.ts` (Modified, +5 LOC)
- `packages/ui/src/os/intents.ts` (Modified, +5 LOC)
- `packages/ui/src/os/intents.test.ts` (Modified, +45 LOC)
- `packages/ui/src/os/deep-links.ts` (Modified, +30 LOC)
- `packages/ui/src/os/deep-links.test.ts` (Modified, +20 LOC)
- `packages/ui/src/os/resource-registry.ts` (Modified, +5 LOC)
- `packages/ui/src/os/resource-registry.test.ts` (Modified, +15 LOC)
- `packages/ui/src/os/persistence.ts` (Modified, +15 LOC)
- `packages/ui/src/os/persistence.test.ts` (Modified, +115 LOC)
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx` (Modified, +15 LOC)
- `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx` (Modified, +35 LOC)
- `packages/ui/src/components/organisms/TerminalPanel.tsx` (Modified, +95 LOC)
- `packages/ui/src/components/organisms/TerminalPanel.test.tsx` (Modified, +80 LOC)
- `packages/ui/src/os/WindowFrame.tsx` (Modified, +45 LOC)
- `packages/ui/src/os/WindowList.tsx` (Modified, +40 LOC)
- `packages/ui/src/os/terminal-close-context.tsx` (Modified, +60 LOC)
- `packages/ui/src/api/client.ts` (Modified, -5 LOC)
- `packages/ui/src/api/ws-transport.ts` (Modified, -10 LOC)
- `packages/ui/src/lib/terminal-input-policy.ts` (Modified, +25 LOC)
- `packages/ui/src/lib/terminal-input-policy.test.ts` (Modified, +20 LOC)
- `packages/ui/src/lib/terminal-buffer-replay.ts` (Modified, +35 LOC)
- `packages/ui/src/lib/terminal-buffer-replay.test.ts` (Modified, +75 LOC)
- `plans/261104-1529-os-session-management-and-interactions/phase-07-sequential-integration.md` (Updated status & tasks)

### Tasks Completed
- [x] Task `integrate-qualified-session-routing`:
  - Routed frozen `terminal:place-existing` in `OsShell.tsx` with fresh snapshot and inventory epoch/incarnation validation.
  - Implemented `"focus-existing"`, `"open-beside"`, and `"move-beside"` without fallback to `terminal.create`.
  - Enforced full 8-tuple `ReviewTarget` in `session-changes:open` and deep links; rejected incomplete tuples with upgrade guidance.
  - Refined `terminal:focus` to pure locator discovery without auto-creation.
  - Added atomic `placeExistingTerminal` in `window-store.ts` splitting source Hub pane and reusing adjacent terminal panes as tabs.
  - Propagated exact string `TerminalTarget` across `OsResourceHost` -> `MountedSession` -> `TerminalKeepAliveHost` -> `TerminalPanel` + `TerminalsApp` claim without `Number` coercion.
  - Removed inactive-adoption launch button fallback from `TerminalsApp.tsx` for `existing-only` windows; bound full authority tuple into resource claim key.
  - Updated `TerminalPanel.tsx` to use typed captured-owner observation/cache for restart probes, enforce positive safe integer equality for replay and exit events, and refuse mismatched incarnations.
  - Explicitly stripped `runtimeIdentity` and protected Review tuple fields from `persistence.ts` on save, load, and import.
- [x] Task `integrate-close-input-retirement`:
  - Mounted ONE shared `TerminalCloseProvider` in `OsShell.tsx` wrapping desktop canvas.
  - Created `packages/ui/src/os/review-retirement.tsx` with root `ReviewRetirementGuard` and `ReviewRetirementHost` per protected Review window across all desktops, purging queries and stripping runtime authority on disconnect/disable/retirement.
  - Wired Frame X, WindowList, and keyboard Close in `WindowFrame.tsx` and `WindowList.tsx` to `requestTerminalClose` with captured runtime identity and exact 5-tuple equality revalidation before closing view.
  - Fed shell modal/Cognito suppression into `syncTerminalInputSuppression` and added per-xterm instance tokens at creation/dispose.
  - Recorded actual buffer resets at `terminal-buffer-replay.ts` reset boundary.
  - Deleted obsolete `terminal.kill`, `terminal.remove`, `terminal:kill`, `terminal:remove` from `ApiClient` and `ws-transport.ts`.
  - Updated unit test suites across all allowed test files.

### Tests Status
- Type check: Deferred to P08 per architecture barrier contract (no mid-flight builds/tests).
- Unit tests: Updated all 8 unit test suites in allowed test files; execution deferred to P08.
- Integration tests: Deferred to P08.

### Issues Encountered & Cross-Phase Notes
- In `packages/ui/src/hooks/use-ports.ts:504`, a legacy call `await getBoundTransport(conn).invoke("terminal:kill", sessionId)` remains from unowned P03 scope. Because `use-ports.ts` and `PortsPanel.tsx` are outside P07's strict file ownership list, they were not edited. Flagged for P08 qualification/resolution.
- Strict ownership boundary maintained with zero out-of-boundary file edits.

### Next Steps
- P07 implementation is complete and ready for P08 integrated qualification run (`pnpm --filter @dam-hopper/ui test -- src/os/intents.test.ts src/os/deep-links.test.ts src/os/resource-registry.test.ts src/os/persistence.test.ts src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/TerminalPanel.test.tsx src/lib/terminal-input-policy.test.ts src/lib/terminal-buffer-replay.test.ts`).
