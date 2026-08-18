# Code Review — project-worktree target switching (second cycle)

## Code Review Summary

### Scope

- Review type: mandatory second-cycle review against `HEAD` (`9376abd8`)
- Files reviewed: 52 tracked diff files plus new target-routing, persistence, lifecycle-test, migration, and browser-test files; focused on backend target/PTY/persistence code, UI target state/terminal lifecycle, all target-bearing surfaces, docs, and tests
- Lines analyzed: approximately 3,500 changed lines (the tracked diff reports 2,996 insertions and 490 deletions)
- Review focus: target identity and isolation, cwd/env routing, PTY replacement/restore, unavailable-target recovery, UI propagation, browser coverage, API/docs consistency, concurrency, and test quality
- Updated plans: none; the user explicitly requested no file edits. This review artifact is the only new review file.
- Evidence reviewed: `plans/reports/tester-gate-260818-1229-project-worktree-switching.md`

### Overall Assessment

The second-cycle changes materially improve target validation, canonical server metadata, environment-file routing, PTY respawn handling, shared SSE/editor reconciliation, and browser coverage. The supplied tester gate is green, and fresh lint, UI type/build, root build, Rust format, and Rust all-target tests also pass.

The implementation is not ready to finalize. Three high-severity lifecycle/UI defects remain: a failed deterministic terminal replacement can leave stale persistent restart state; saved terminal profiles can persist a worktree-absolute cwd; and persisted unavailable target sessions are not reachable from the normal terminal tree after fallback/restart. Two medium-severity identity/persistence risks remain under path aliases and persistence-queue saturation. No critical finding.

### Critical Issues

None found.

### High Priority Findings

#### H-1 — Failed target-scoped replacement can leave a stale persistent session eligible for restart

- Severity: High
- References: `server/src/pty/manager.rs:342-361`, `server/src/pty/manager.rs:955-970`, `server/src/api/terminal.rs:93-123`, `server/src/persistence/mod.rs:127-148`
- Impact: `PtySessionManager::create` kills the existing deterministic-ID session before opening the new PTY. If the worktree disappears after the initial resolve but before spawn, the new create fails. The API performs fresh target validation and returns `Unavailable`, but the old row is not removed or marked `target_unavailable`; the successful `SessionCreated` write is never issued for the replacement. The database can therefore retain `alive=1,target_unavailable=0` for a process that was already killed. A later server restart can respawn the old command when the target reappears, or expose stale identity/scrollback after the failed replacement.
- Recommended fix: make deterministic replacement transactional/two-phase, or on a fresh target-loss failure explicitly convert the replaced tombstone and persistent row to `target_unavailable`/non-respawnable. Add a regression test with an existing same-ID session, target disappearance during replacement, failed create, and restart/recovery.

#### H-2 — Saving a terminal on a worktree persists the display-absolute cwd into project config

- Severity: High
- References: `packages/ui/src/hooks/use-terminal-manager.ts:601-607`, `packages/ui/src/hooks/use-terminal-manager.ts:642-648`, `packages/ui/src/hooks/use-terminal-manager.ts:845-870`, `packages/ui/src/hooks/use-terminal-manager.ts:1165-1189`, `packages/ui/src/lib/terminal-launch-context.ts:71-88`, `docs/configuration-guide.md:20`
- Impact: Target launches correctly send a project-relative `cwd`, but `openTerminalTab` stores `launch.displayCwd`, which is an absolute path inside the selected worktree. Both save-to-profile paths then persist that absolute value. The documented profile contract requires a project-relative cwd. Switching to another worktree later sends the old worktree path; server target validation rejects it as outside the selected target instead of mapping it to the new worktree. The same defect affects saving a free terminal as a profile.
- Recommended fix: retain the launch request cwd separately from display cwd and persist the request/config value; alternatively derive and validate a project-relative cwd from the mounted session's immutable target before writing config. Add tests that save from one worktree and launch the saved profile in a second worktree.

#### H-3 — Persisted unavailable target sessions are retained by the server but hidden from normal recovery UI

- Severity: High
- References: `server/src/persistence/restore.rs:97-100`, `packages/ui/src/stores/project-target.ts:124-142`, `packages/ui/src/hooks/use-terminal-tree.ts:178-267`, `packages/ui/src/lib/terminal-auto-attach.ts:118-127`, `packages/ui/src/components/organisms/ProjectTargetWorktreeRow.tsx:37-60`
- Impact: On restart, `restore_unavailable_session` keeps the dead identity and replayable buffer, but the target store starts at the project root. The terminal tree builds project commands only for the active target/root; target-scoped profile instances are filtered against that root and unavailable worktree rows are disabled. Auto-attach also considers live sessions only. Consequently, a persisted unavailable worktree session can exist in SQLite and the detailed session response without any normal tree entry or action to select, close, retry, or inspect it after restart. The documented orphan warning/recovery behavior is therefore unavailable precisely when persistence is needed.
- Recommended fix: expose unavailable target/session metadata in a recoverable tree group independent of the active launch target, with close/retry/scrollback actions, or hydrate a target-aware recovery view from the session snapshot. Keep new operations routed to root until explicit target recovery. Add a browser or UI integration test covering server restart/fallback with a dead `targetUnavailable` profile session.

### Medium Priority Improvements

#### M-1 — Target identity compares raw UI paths against canonical server paths

- Severity: Medium
- References: `server/src/workspace_target.rs:233-246`, `server/src/workspace_target.rs:479-515`, `server/src/workspace_target.rs:439-448`, `packages/ui/src/api/client.ts:896-910`, `packages/ui/src/stores/project-target.ts:124-142`, `packages/ui/src/hooks/use-sse.ts:109-126`, `packages/ui/src/hooks/use-terminal-tree.ts:62-98`
- Impact: Discovery exposes `RegisteredWorktree.target_path` as the raw derived path, while explicit resolution and terminal metadata use the canonical live path. On symlink, lexical-alias, case-variant, or platform path differences, the UI can store one spelling while target-unavailable events and session metadata carry another. Exact comparisons can then fail to clear the active target, mark editor/terminal ownership, count removal blockers, or join sessions to the selected target. Server authorization remains fail-closed, but UI state and removal safety become inconsistent.
- Recommended fix: return one canonical target path from discovery and resolution, or expose a server-issued target key and use it for cache, event, session, editor, and removal comparisons. Add alias/case-sensitive and Windows-path tests across list → select → event → session matching.

#### M-2 — Target-unavailable persistence is dropped when the bounded worker queue is full

- Severity: Medium
- References: `server/src/pty/manager.rs:809-817`, `server/src/pty/manager.rs:1546-1555`, `server/src/main.rs:151-162`, `server/src/persistence/worker.rs:142-146`, `server/src/persistence/mod.rs:164-175`
- Impact: Safety-critical target-loss state uses `try_send` on a 256-entry sync channel. A full queue logs and drops `SessionTargetUnavailable`. The in-memory tombstone remains non-restarting, but the database row can remain `alive=1,target_unavailable=0`; after process restart it may be respawned into a stale or reappeared target. The current gate does not exercise queue saturation or worker failure during target loss.
- Recommended fix: use a durable/retrying persistence path for this transition, coalesce target-state updates by session, or synchronously update the row before publishing the recovery event. Add a saturation/failure test that verifies restart remains fail-closed.

### Low Priority Suggestions

#### L-1 — 32-bit client target discriminator has avoidable collision risk

- Severity: Low
- References: `packages/ui/src/lib/terminal-target-identity.ts:17-31`
- Impact: FNV-1a output is only 32 bits. A collision between two project/worktree inputs makes deterministic command IDs overlap, causing one target's create to replace another target's session. This is unlikely accidentally but does not meet a strong uniqueness guarantee for an isolation boundary.
- Recommended fix: use a 64/128-bit digest or a server-issued canonical target key. Keep the opaque value out of user-facing labels and retain the server's canonical target metadata.

#### L-2 — Direct diff hygiene check flags mixed line endings in the terminal manager diff

- Severity: Low
- Reference: `packages/ui/src/hooks/use-terminal-manager.ts` (added hunks; `git diff --check HEAD` exits 2)
- Impact: The supplied tester report says diff hygiene passed, but the repository's direct `git diff --check HEAD` currently reports trailing-whitespace warnings for CRLF lines in this mixed CRLF/LF file. A CI or pre-commit check using the default Git whitespace rules can reject the change.
- Recommended fix: normalize the file's line endings consistently or explicitly use the repository-approved `cr-at-eol` policy, then rerun the exact diff check.

### Positive Observations

- Server-side target resolution is fresh and fail-closed; PTY cwd validation and sandbox containment prevent arbitrary or foreign worktree access.
- Target-relative env-file loading is now rooted at the resolved target, with request environment values applied afterward; env values are not logged.
- PTY metadata records canonical `worktreePath` and `targetUnavailable`; restore avoids respawning unavailable sessions and retains replayable identity/buffer state.
- Shared editor/SSE reconciliation consistently marks target loss across the workspace instead of silently redirecting operations.
- `WorkspacePage` target propagation covers Explorer, search, Git, editor/diff, media, project status, and terminal launch paths. The new browser scenario exercises the real page routing boundary and direct diff/media target arguments; the browser serial setting is scoped to the browser config and is justified by shared native-media fixtures.
- Backend lifecycle coverage uses real temporary Git repositories/worktrees and covers external disappearance, prune state, target rejection, and concurrent discovery. Fresh gates reported UI 1,168 tests, browser 130, Rust 727 passed + 1 ignored unit test and 74 integration tests.

### Recommended Actions

1. Fix H-1 replacement persistence before finalization; add a regression test for a same-ID create racing target disappearance.
2. Fix H-2 profile/free-terminal save serialization and test cross-worktree reuse.
3. Add an explicit unavailable-session recovery surface or document/confirm a deliberate open-tabs-only policy; test restart behavior (H-3).
4. Canonicalize target identity at the API boundary and cover alias/platform paths (M-1).
5. Make target-unavailable persistence non-droppable and test queue saturation (M-2).
6. Strengthen the client discriminator if it remains client-derived (L-1) and resolve the direct diff-hygiene failure (L-2).
7. After fixes, rerun the full tester gate and reconcile the plan status before final approval.

### Plan and Task Completeness

- `plans/260817-0113-project-worktree-target-switching/plan.md` remains `status: in-progress`, `review_status: changes-requested`, `review_score: 7.5/10`; Phase 06 is still marked deferred and Phase 07 pending.
- `phase-07-lifecycle-integration-and-validation.md` still has all five TODO items unchecked, despite implementation and validation artifacts being present.
- This review intentionally did not edit either plan because the user explicitly requested no file edits. The plan must be reconciled after the findings above are resolved; it should not be marked complete based only on the green gate.

### Metrics

- Type coverage: percentage unavailable; standalone root `type-check` script is not defined. UI `tsc -p tsconfig.json` passed via `pnpm --filter @dam-hopper/ui build`.
- Tests: UI 1,168 passed; browser 130 passed; Rust 727 passed + 1 ignored unit test and 74 integration tests, per tester gate. Fresh Rust all-targets run passed 727 + 1 ignored and all integration targets.
- Linting: 0 ESLint findings; `pnpm lint` passed.
- Build/format: root `pnpm build`, UI build, and `cargo fmt --all -- --check` passed.
- Coverage report: not generated/configured in the supplied gate.
- Readiness: **Not ready to finalize — changes requested.** Score: **6.2/10**.

### Unresolved Questions

- Is the intended product contract that unavailable persisted sessions remain actionable after a server/browser restart, as the architecture/docs imply, or are they intentionally accessible only through already-open tabs? The current implementation and docs disagree.
- What is the required automated coverage threshold for the target-switching feature? The gate reports no coverage percentage.
- Should the plan TODO/status fields be updated by the implementation owner in the next cycle, or remain historical until release approval?
