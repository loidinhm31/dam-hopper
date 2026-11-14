# Completion Report: preserve-focused-git-safety (P06 / W07) [Verification Scoped]

## Status: VERIFICATION_SCOPED
- **Implementation Status**: Code, safety guards, and regression tests complete.
- **Verification Status**: Shared JVM compilation verified; 32/32 focused JVM regression tests passing. Full Android debug compilation, live Git server disposable smoke, and independent review remain scoped/pending integration verification.

## Implemented Behaviors
1. **Registered Project Target Confinement**:
   - Changes, OID DAG History, Branches/Worktrees, diff review, CAS and separate leased publication are confined strictly to registered exact project targets.
   - Unmarked whole-workspace target (`project = "workspace"` or `project == "*"`) produces zero Git dispatch and refuses Git operations.
2. **Cross-Alias Dirty & PTY Blocker Fencing**:
   - Active, hidden, restart-pending, and uncertain PTYs block worktree switch, branch deletion, detach, or reset with exact reason.
   - Retained dirty documents across aliases block worktree mutations.
3. **Leased Publication & Scope Invariants**:
   - Secondary VCS roots require authoritative discovery and refuse fetch/pull operations before network dispatch.
   - Worktree removal safely switches away from the active worktree before executing deletion.
   - Read-only conflict review preserves terminal CLI handoff (`openRecoveryTerminal`) without TS engine addition.

## Demonstrated Evidence
- **Shared JVM Compilation**: `compileKotlinJvm` exit 0 (SUCCESS).
- **Automated Regressions (JVM Test)**: 32/32 passed:
  - `GitWorkspaceSafetyTest`: 12/12 passed.
  - `GitFocusedIntegrationTest`: 7/7 passed.
  - `GitWorkspaceNavigationTest`: 6/6 passed.
  - `GitSyncWorktreeSafetyTest`: 7/7 passed.

## Scoped / Pending Verification Items
1. **Android Debug Compilation**: `:androidApp:compileDebugKotlin` to be rerun after current active integration worker finishes.
2. **Disposable Server Git Smoke**: Real Git CLI fixture against live Axum backend (`git-workspace-fixture.mjs`) scheduled at P08 qualification.
