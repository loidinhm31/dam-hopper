# Code Review Cycle 2: Phase 04 Operation Lifecycle

**Score: 6/10.** Implementation quality ~7/10 (cycle-1 guard regression fixed, DRY/authority consolidated); readiness for Phase 04 gate: NOT ready — post-attempt state, process/cancel lifecycle, proof coverage still short of plan go/no-go.

## Scope
- Files: `server/src/git/{types,operation,cli_fallback,conflict}.rs`, `server/src/api/{git_diff,router}.rs`, `server/tests/git_conflict_operation_{lifecycle,api}.rs`.
- Focus: cycle-1 fix verification + security/perf/architecture/YAGNI-KISS-DRY vs `phase-04-operation-lifecycle.md`.
- Plan updated: `phase-04-operation-lifecycle.md` (review status cycle 2).

## Cycle-1 criticals — status
| # | Cycle-1 critical | Cycle 2 |
|---|---|---|
| 1 | Mutation-guard regression (`active_git_operation` → None for unsupported) | **Fixed.** `GitRecoveryOperation::Unsupported`, Unsupported/Unknown map to `Some(..)`; `repo.open` errors propagated (except NotFound→None, see W3). Test `test_active_git_operation_blocks_on_unsupported_mailbox`. |
| 2 | No authoritative post-attempt state | **Partial.** Continue exit 0 → requery fail ⇒ `OutcomeUnknown` (good); abort checks no-conflicts+no-op. Still no status attached to `Blocked`/`Failed`/`OutcomeUnknown`/`Aborted`; timeout/spawn-error path never requeries. See C1. |
| 3 | Terminal handoff contract | **Partial.** Status now populates `terminalHandoffRequired{reason,worktreeRoot}`; outcome `Blocked` still carries bare `bool` — two shapes; no owner identity. See W2. |

## Critical (gate blockers)
1. **Post-attempt requery missing on all non-success branches** (plan step 8/9, go/no-go). `execute_operation_action`: `Blocked(MessageEditRequired|HookBlocked)`, `Failed`, abort non-zero, and every `Err(timeout/spawn)` → `OutcomeUnknown` return without requerying operation/index state; `Aborted` carries only `worktreeCleaned: bool` (now means "no operation + no conflicts", not clean worktree — rename or drop). Editor/hook failures can follow partial mutation; timeout is inherently uncertain. Fix: after every attempted child (success or not) requery once while guard held; attach `Option<OperationStatusResponse>` to all outcome variants; requery failure ⇒ `OutcomeUnknown`, never a definitive Failed/Blocked. Also split `Continued` into completed (op None) vs stopped/newConflict (plan outcome set) for Phase 05.
2. **Handler cancellation leaves child running after lock release** [INFERENCE from Tokio semantics; not reproduced]. `Command` has no `kill_on_drop`; `execute_operation` awaits `execute_operation_action` inline in the axum handler. Client disconnect drops the future → coordinator guard released, Git `continue/abort` (hooks, signing) keeps mutating, response lost. Fix: run the action in a detached `tokio::spawn` (result returned via join; client drop doesn't cancel), or hold guard in a cleanup scope that kills the process group and settles the child before releasing.

## Warnings
1. **HookBlocked substring classification precedes requery** (`"pre-commit"`/`"commit-msg"`/`"hook failed"` on lowercased stdout+stderr). Concrete [INFERRED, not reproduced]: repeated rebase stop printing `CONFLICT … in .githooks/pre-commit` (or any message containing token) ⇒ misreported as `HookBlocked`, hiding the real new conflict; other hooks (`pre-rebase`, `prepare-commit-msg`, `core.hooksPath` names) missed. No bounded diagnostic returned. Fix: requery first; classify via requeried state; return bounded diagnostic text; hook text only as hint.
2. **Handoff contract incomplete.** Server cannot invent client-owned profile/generation, but must define how the client captures/fences it and combines with server-resolved project/worktree/root. Replace outcome `terminal_handoff_required: bool` with the same `TerminalHandoffRequired` struct as status. `worktreeRoot` exposes absolute server path (auth'd route; acceptable, confirm with Phase 05).
3. **Fail-open edges in `active_git_operation`.** `Repository::open` `NotFound → Ok(None)` (previous CLI `rev-parse` worked from subdirectories; callers pass project path today, so [conditional] only if a caller passes a non-root cwd). `repo.index()` failure → `unwrap_or(false)` ⇒ `can_continue = true` in four copy-pasted arms. Detection ignores metadata read errors (`fs::read_to_string`, `fs::read` ⇒ treated as absent/empty in op kind and fingerprint); `rebase-merge` + `rebase-apply` collapsed into one marker. Collapse the four duplicate arms into one; fail closed on index/read errors.
4. **Process lifecycle** (carried, unchanged). `join!(drain stdout, drain stderr)` before `child.wait()`: surviving pipe-holding hook daemon ⇒ successful Git looks like timeout and group is SIGKILLed. Wait for child, then drain with bounded grace. Hard 15 s SIGKILL on `continue` unchanged (slow hooks/pinentry; kill mid-commit can leave `index.lock`; no lock inspection). `setsid` descendants escape `-pgid`; Windows `child.kill()` root only; `GIT_EDITOR=cmd /c …` Windows path [INFERENCE: MSYS `/c` mangling]. No documented platform limitation record (plan gate). Sentinel searched in 64 KB-truncated stderr: verbose output can push it past cap ⇒ handoff missed (reported `Failed`); sentinel spoofable by hook output (low). `status.code().unwrap_or(-1)` hides signal kills.
5. **Test coverage vs plan proofs.** Verified by grep: no test references `OperationOutcome::Continued` or operation `OutcomeUnknown`; no direct test of `run_bounded_git_command` (timeout, hanging descendant, full-pipe/output cap); no signing case; no conflictless `edit/exec/empty` rebase stop (AC10: currently labeled ordinary Rebase, `can_continue=true`, `stoppedReason=None`). `test_cherry_pick_and_revert_action_lifecycle` exercises **cherry-pick abort only** — no revert, no continue. Repeated-stop test advances via an external `git rebase --continue`, not the API `Continued` branch. Probe: `git cherry-pick --continue` exits 0 with the sentinel editor (no editor invoked) ⇒ `Continued` path is reachable and untested, as is its requery-failure ⇒ `OutcomeUnknown` branch (claimed fix #2).
6. **Blocking I/O on async workers in POST path.** `get_operation` now uses `spawn_blocking` (good) but `execute_operation` calls `resolve_git_request_root` and `execute_operation_action` inline: sync `git2` open/index load + full-index SHA-256 + `fs` reads ×3 per continue on tokio workers (large repos). Move precondition/requery into `spawn_blocking`.
7. **Editor policy override** (carried). `GIT_EDITOR` forced on all continues replaces user `core.editor` (e.g. non-interactive editor) ⇒ handoff where Git would have completed. Sentinel only fires when Git would invoke an editor, so conservative but not policy-preserving; document.
8. **Unredacted diagnostics** (carried). `Failed{error}` embeds up to 64 KB raw stdout/stderr (paths, hook output). Cap response (4–8 KB) and strip worktree path.
9. **Scope/hygiene: `cargo fmt` churn.** `git status`: 174 entries; 169 modified tracked files, ~152 outside Phase 04 (agent_status, idle_suspend, host_resource, ws, fs tests, `system/monitor.rs`, …). `git ls-files --eol`: 20 files index=CRLF/worktree=LF (e.g. `api/git_diff.rs` 1020-line diff, `ws_fs_subscribe.rs`, `system/monitor.rs` 1208/1195); ignoring EOL still 3812+/1918− across 169 files. Pollutes review/blame/merge. Restore unrelated files (user decision; no destructive git run here); keep only Phase 04 fmt, preserve each file's original EOL.
10. **Wire contract drift.** `packages/ui/src/api/client.ts:2275` `recovery.operation` union lacks `"unsupported"` (now emitted by `active_git_operation`); `conflict.rs` `get_active_operation` now returns `"unsupported"` where Phase 02 returned `"bisect"`/`"rebase"` for bisect/am — check Phase 05/UI consumers of the string.
11. **Docs not updated** (carried): `docs/api/rest-endpoints.md` has no `/operation`; `docs/CHANGELOG.md`, `docs/codebase-summary.md`, `docs/project-roadmap.md`, `docs/system-architecture.md` still describe continue/abort as deferred.
12. **Legacy parallel model** (carried): `GitRecoveryState/Operation` still parallel to `OperationKind/OperationStatusResponse`; plan says no parallel legacy names (cycle-2 added a variant rather than migrating). Callers pass through `recovery` on blocked results, so this is wire-visible.

## Suggestions
- `OperationActionRequest.project` accepted and ignored; remove or validate. Handler double-validates (manual `Value` key checks then serde `deny_unknown_fields`); missing fields reported as `LegacyPayloadRejected` — misleading for a new endpoint, use `InvalidInput`.
- Replace `(i32,String,String,bool)` with a `BoundedOutput` struct (also carries `truncated`, `signaled`).
- `OperationStoppedReason::Unknown` for Unsupported ops: add explicit `Unsupported`.
- `StageRoleLabels`: Revert labels ("Commit being reverted" = base, "Parent (reverting to)" = theirs) rest on semantics not verified against a real revert conflict (stage 1/2/3 roles) — add fixture or hedge text [INFERENCE].
- Fingerprint: index entries include mtime/size ⇒ a terminal `git status` refresh may cause spurious stale (acceptable; document). `repo.head()` called twice in fingerprint; unreadable metadata hashed as absent.
- `libc::kill(-pgid)` + `libc::kill(pid)` duplicates: child is group leader, second call is redundant.

## Positives
- Single operation authority: `conflict::get_active_operation` and `active_git_operation` now delegate to `operation::active_operation_kind`; obsolete `git_path_exists` removed (DRY win).
- Unsupported/Unknown ordering precedes conflicts in status; contradictory/bisect/am fail closed and now block other writers.
- Precondition (operation + full-index fingerprints, `\0`-delimited, expanded to `REBASE_HEAD`, `git-rebase-todo`, `sequencer/head`, `abort-safety`) revalidated under coordinator guard; staged-index oracle test; linked-worktree isolation test.
- Fixed allowlisted argv, no skip/reset/clean, stdin null, process group, bounded drain via single generic `drain_bounded`, no hook/signing/config bypass; routes under auth.
- `get_operation` offloaded via `spawn_blocking`; terminal handoff populated on status for `MessageEditRequired`.

## Validation
| Command | Result |
|---|---|
| `cargo test --test git_conflict_operation_lifecycle --test git_conflict_operation_api --test git_conflict_operation_metadata --test git_conflict_exact_staging --test git_conflict_discovery_api` (server) | observed: lifecycle 11, operation_api 5, metadata 2, exact_staging 10, discovery_api 11 = **39 passed, 0 failed** |
| `cargo clippy --all-targets` filtered to touched files | only diagnostic printed: `cli_fallback.rs:237` (`configured_root` chain), outside the Phase 04 hunks; no diagnostics in `operation.rs`, `git_diff.rs`, new tests; run not checked for overall exit status |
| Probe: `git cherry-pick --continue` with sentinel `GIT_EDITOR`, resolved conflict | exit 0, no editor, clean tree (confirms untested `Continued` path reachable) |
| `git ls-files --eol server`; `git diff --stat` | 20 index-CRLF/worktree-LF files; 169 tracked files modified |
| Cycle-1 reported 243 total tests | not re-run (full suite not executed) |

## Unresolved questions
1. Who owns terminal owner identity (profile/generation/server) capture/fencing — Phase 05 client with server-resolved root? Define in contract before enabling UI.
2. Qualified Continue deadline and process-cleanup policy for supported server OSes (is Windows-native server cleanup in Phase 04 qualification)?
3. Should the action survive request cancellation (detached task) and return result via status refresh only?
4. Are the ~152 out-of-scope fmt/EOL changes intended (project-wide format task) or to be reverted before commit?
5. Do Phase 02/05 consumers rely on the old `"bisect"`/`"rebase"` operation strings for am/bisect?
