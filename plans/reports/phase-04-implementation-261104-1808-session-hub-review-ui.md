## Phase Implementation Report

### Executed Phase
- Phase: P04 — Session Hub, shared Close policy and Review
- Plan: plans/261104-1529-os-session-management-and-interactions/phase-04-session-hub-review-ui.md
- Status: completed

### Files Modified
- `packages/ui/src/os/terminal-close-context.tsx` (Created, 250 LOC)
- `packages/ui/src/os/TerminalCloseDialog.tsx` (Created, 230 LOC)
- `packages/ui/src/os/agent-hub.ts` (Modified, +380 LOC)
- `packages/ui/src/os/apps/AgentHubApp.tsx` (Modified, +185 LOC)
- `packages/ui/src/os/apps/SystemMonitorApp.tsx` (Modified, +54 LOC)
- `packages/ui/src/api/session-changes-queries.ts` (Modified, +111 LOC)
- `packages/ui/src/os/apps/SessionChangesApp.tsx` (Modified, +67 LOC)
- `packages/ui/src/components/organisms/SessionChangesPanel.tsx` (Modified, +35 LOC)
- `packages/ui/src/os/agent-hub.test.ts` (Modified, +164 LOC)
- `packages/ui/src/api/session-changes-queries.test.tsx` (Modified, +126 LOC)
- `packages/ui/browser-tests/os-agent-hub.browser.tsx` (Modified, +222 LOC)
- `packages/ui/browser-tests/os-system-monitor.browser.tsx` (Modified, +161 LOC)
- `packages/ui/browser-tests/os-review-apps.browser.tsx` (Modified, +94 LOC)
- `packages/ui/browser-tests/session-changes-panel.browser.tsx` (Modified, +61 LOC)
- `plans/261104-1529-os-session-management-and-interactions/phase-04-session-hub-review-ui.md` (Updated status & tasks)

### Tasks Completed
- [x] Task `hub-and-close-ui`:
  - Created `terminal-close-context.tsx` and `TerminalCloseDialog.tsx` supporting frozen `TerminalCloseRequest`.
  - Exited/restartCancelled close view immediately without prompt; live/restartPending present Close view, End session, Cancel with initial safe Cancel focus.
  - Live 202 awaits exit and retains view; pending 200 immediately completes and invokes view close.
  - Reconciles loss strictly via `reconcileTermination`: live on exact `exited`, pending on exact `restartCancelled`.
  - Modal registration isolated via `ShellInputContext` ("confirm-dialog").
  - AgentHubApp refactored to inventory-first model from `useAggregatedTerminalSessions()`.
  - Agent evidence joined by owner profileId, terminalId, and lossless numeric safe integer incarnation proof (`proveNumericEvidenceJoin`). Unsafe numbers leave Review unavailable while inventory remains End-eligible.
  - Exact runtime target window membership matching across all desktops; unviewed sessions classified as Background.
  - Emits frozen `terminal:place-existing` intent carrying source Hub window ID, captured `TerminalTarget`, and action.
  - SystemMonitorApp migrated from bare kill to guarded termination protocol (`requestGuardedTermination`) and exact placement intent.
  - Unsupported metadata prompts clear server upgrade guidance.
- [x] Task `review-authority-retirement`:
  - Extended `session-changes-queries.ts` with `matchesReviewTargetQuery`, `cancelReviewQueries`, `removeReviewQueries`, and `purgeOwnerReviewQueries`.
  - Normal single-window close purges only its own exact review identity, preserving sibling review caches under the same owner.
  - SessionChangesApp requires complete immutable 8-tuple `ReviewTarget` without guessed root (`.`) or ambient generation fallbacks.
  - Disabled/disconnected/retired connections unmount live viewer and purge owner data while retaining content-free explanation UI.
  - SessionChangesPanel accepts verified `ReviewTarget`/exact metadata and detects status disagreement.
  - Unit and browser test suites updated and expanded.

### Tests Status
- Mid-flight qualification constraint: Builds and tests deferred to P08 qualification phase per architecture contract.

### Issues Encountered & Cross-Phase Notes
- Outside P04 allowlist: In `packages/ui/src/api/queries.ts` (owned by P03/P07), `terminalInventoryQueryOptions(...).queryFn` has an unbound `transport` reference where `const transport = owner ? getBoundTransport(owner) : getTransport();` was removed during refactoring. Flagged for P07/P08 finalizer.
- Strict allowlist adherence maintained: zero out-of-boundary file edits.

### Next Steps
- P04 is complete and ready for P07 integration wiring (OsShell, frame/window-list Close hooks, root hidden-window retirement observer) and P08 full test qualification.
