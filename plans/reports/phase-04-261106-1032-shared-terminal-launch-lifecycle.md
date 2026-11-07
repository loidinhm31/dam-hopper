# Phase 04 — Shared Terminal Launch Lifecycle Report

## Executed Phase
- Phase: phase-04-shared-terminal-launch-lifecycle
- Plan: plans/261106-0334-agent-hub-terminal-first-workspace
- Status: completed

## Files Modified
- `packages/ui/src/os/terminal-launch-lifecycle.ts`: +644 lines (new)
- `packages/ui/src/os/terminal-launch-lifecycle.test.ts`: +1095 lines (new)
- `packages/ui/src/os/apps/TerminalsApp.tsx`: -100 / +108 lines
- `packages/ui/src/os/apps/TerminalsApp.test.tsx`: +487 lines (new)
- `packages/ui/src/os/action-executor.ts`: -25 / +15 lines
- `packages/ui/src/os/action-executor.test.ts`: +122 lines
- `packages/ui/src/os/persistence.ts`: +23 lines (read-only `getLaunchAttempt` export only)
- `packages/ui/src/os/app-launch-journal.test.ts`: +78 lines

## Tasks Completed
- [x] `p04-launch-lifecycle-module`: Window-agnostic terminal launch lifecycle module
  * Implemented `buildTerminalLaunchIdentity` reproducing identical canonical parameters for workspace, explicit cwd, and project targets.
  * Implemented page-scoped in-flight registry with separate reservation marker (`reservedAttempts`) and execution reference counts (`executingAttemptCounts`), preventing premature deactivation while supporting overlapping executions.
  * Implemented `executeTerminalLaunch` preserving all pre-send snapshot/generation fences, exact HTTP status code settlement matrix (400, 401, 403, 404, 413, 422 -> `confirmed-not-created`), canonical epoch/incarnation target construction, Contract C3 Rule 3 post-create owner change (`confirmed-success` in journal, failed outcome to caller), and guaranteed `terminalId` return.
  * Implemented `reserveAndExecuteTerminalLaunch` for composite launch callers with blocked reason passthrough and `existingAttemptId`.
- [x] `p04-adopt-lifecycle`: TerminalsApp and action-executor adopt shared lifecycle, claim key and reveal
  * Adopted `buildTerminalLaunchIdentity` and `reserveTrackedTerminalLaunch` in `action-executor.ts` and `TerminalsApp.tsx`.
  * Adopted `executeTerminalLaunch` in `TerminalsApp.tsx` maintaining identical UI states (`isLaunching`, `launchError`, `updateAppState` writes).
  * Adopted P01 `buildTerminalClaimKey` for target and untargeted branches.
  * Replaced denied button action with atomic `revealWindow(holderId)` (B1 parity: switch desktop, restore if minimized, focus).
  * Implemented F2 presentation management: acquired `acquireTerminalPresentation` only upon actual renderer attachment, released symmetrically on claim loss / unmount, and wrapped presenter cleanup in `runIfCurrentPresenter`.
- [x] `p04-stuck-launch-resolution`: Manual stuck-launch resolution helper and read-only journal getter
  * Added read-only `getLaunchAttempt(attemptId)` in `persistence.ts` returning `{ status: "ok" } | { status: "missing" } | { status: "unreadable" }` without mutation.
  * Implemented `resolveStuckLaunch` adhering strictly to R8.2–R8.7: in-flight checks, fresh owner-qualified observation for the target profile only (network query, never cached), classification (present-canonical, present-unresolvable, definitely-absent, unknown), confirmation-time re-observation, active check re-validation before not-created settlement, and F9 durable re-read verification for state, provenance, and failure reason.

## Tests Status
- Unit tests: 78 tests passed across 6 test suites:
  * `src/os/terminal-launch-lifecycle.test.ts`: 29 passed
  * `src/os/app-launch-journal.test.ts`: 15 passed
  * `src/os/action-executor.test.ts`: 8 passed
  * `src/os/apps/TerminalsApp.test.tsx`: 6 passed
  * `src/os/terminal-close-context.test.tsx`: 11 passed
  * `src/os/persistence.test.ts`: 9 passed
- Type check: Passed for all files in `src/os` (0 errors).
- Integration / browser tests: Blocked by concurrent workspace compile error in `packages/ui/src/stores/editor.ts` (Phase 02 in progress by peer `Phase02Developer`).

## Issues Encountered
- Full repo typecheck and browser suite execution are temporarily blocked by concurrent editing in `src/stores/editor.ts` owned by Phase 02. Verified complete type safety and unit test coverage across all Phase 04 files.

## Next Steps
- Unblocks Phase 06 (`use-hub-terminal-launch.ts` and `HubStuckLaunchNotice` consuming `buildTerminalLaunchIdentity`, `reserveAndExecuteTerminalLaunch`, and `resolveStuckLaunch`).
- Sequential ownership of `packages/ui/src/os/persistence.ts` transfers to Phase 06.
