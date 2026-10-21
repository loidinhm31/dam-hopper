# Code Review: Phase 04 Operation Lifecycle

**Score: 6/10** — core detection/roles/guarded REST sound; plan go/no-go gates (post-attempt state, process qualification, proof coverage, guard regression) not met.

## Scope
- Files: `server/src/git/operation.rs` (544), `types.rs`, `mod.rs`, `conflict.rs`, `cli_fallback.rs`, `api/git_diff.rs`, `api/router.rs`, tests `git_conflict_operation_lifecycle.rs` (608), `git_conflict_operation_api.rs` (358).
- Focus: security, performance, architecture, YAGNI/KISS/DRY, plan `phase-04-operation-lifecycle.md` conformance.
- Plan updated: phase-04 overview + review status.

## Critical
1. **Mutation-guard regression** — `cli_fallback::active_git_operation` now maps `Unsupported|Unknown|None` to `Ok(None)`. Before, `rebase-apply` (incl. `git am`) returned `Some(Rebase)` and blocked commit/cherry-pick/revert/etc. (callers `commit_file_ops.rs:176,508`, `commit_message_rewrite.rs:143`, `repository.rs:1588`). Now those writers run during git am / bisect / contradictory metadata. Also open error → `Ok(None)` (was propagated). Fix: return a recovery state (or a block) for Unsupported/Unknown; keep fail-closed.
2. **No authoritative post-attempt state in outcomes** (plan step 8/9, go/no-go). Only `Continued` carries `new_status`. `Aborted`, `Blocked` (editor/hook/conflict), `Failed`, `OutcomeUnknown` return no requeried operation/index facts. Success path `get_authoritative_operation_status(..)?` after exit 0 turns a failed refresh into an HTTP error instead of `OutcomeUnknown` (plan: failed refresh ⇒ unknown). Non-zero path swallows requery error silently (`if let Ok`). `Aborted.worktree_cleaned` = whole-worktree `status --porcelain` empty — false for any pre-existing untracked/dirty file, so misleading. Fix: every attempted-command branch requeries once and attaches `Option<OperationStatusResponse>`; refresh failure ⇒ `OutcomeUnknown`.
3. **Terminal handoff contract incomplete** (plan: exact owner profile/generation/server/project/worktree/root). `TerminalHandoffRequired{reason, worktree_root}` is never populated in status (branch is dead: status never yields `MessageEditRequired`); the outcome carries only `terminal_handoff_required: bool`. Two inconsistent shapes. Fix: single struct in `Blocked` outcome populated with captured owner identity, drop the dead status branch/field or populate it.

## Warnings
1. **Hard 15 s SIGKILL on mutating Git** (`SUBPROCESS_TIMEOUT`). Real pre-commit hooks/pinentry routinely exceed this; kill mid-`rebase --continue`/`commit` can leave `index.lock`/partial sequencer state; outcome is only `OutcomeUnknown` with no lock/state inspection. No qualified policy recorded (plan Phase 01 gate). Suggest longer deadline for continue (e.g. 120 s, configurable const), abort 15 s, and report lock leftover.
2. **Pipe-drain blocks wait**: `join!(stdout, stderr)` precedes `child.wait()`; a surviving hook daemon holding the pipe makes a successful `git` look like a timeout (kill + `OutcomeUnknown`). Wait for child and drain with bounded grace after exit. Descendants that `setsid` escape the `-pgid` kill; Windows `child.kill()` kills root only — undocumented limitation vs plan "documented cleanup outcome".
3. **Hook detection by substring** (`"pre-commit"`, `"commit-msg"`, `"hook failed"` in lowercased output): locale/format fragile; false positives (any message mentioning pre-commit) and misses other hooks (pre-rebase, prepare-commit-msg, custom `core.hooksPath` names). Diagnostics lost: `HookBlocked` outcome returns no bounded stderr text. Return bounded diagnostic with the blocked outcome.
4. **Editor sentinel overrides user editor policy**: `GIT_EDITOR` forced for every continue, so a user's non-interactive editor config/`GIT_MERGE_AUTOEDIT=no` is replaced and merge/rebase continue almost always hands off. Safe (git aborts commit), but plan says preserve editor policy; document that handoff is conservative. Windows sentinel (`cmd /c ...` through Git-for-Windows `sh`) is untested [INFERENCE: path/quote mangling likely]. Sentinel in stderr is spoofable by a hook echoing the token (low).
5. **Blocking I/O on async runtime**: `get_operation` and `execute_operation_action` call sync `git2` open/index load/full-index SHA-256 and `fs` reads directly on tokio workers (3 times per continue). `resolve` handler uses `spawn_blocking`; follow it.
6. **Unredacted diagnostics**: `Failed{error}` embeds up to 64 KB raw stderr/stdout (paths, hook output). Plan: bounded/redacted. Cap response diagnostic (e.g. 4–8 KB) and strip absolute worktree path.
7. **Test coverage vs plan gates**: no test for successful `--continue` (exit 0 → `Continued`), continue/abort for rebase/cherry-pick/revert via `execute_operation_action` (only merge abort), unconfirmed-abort, `OutcomeUnknown`/timeout/hanging descendant, full-pipe output bound, signing, failed requery, unsupported-op action rejection. Tester report: 14 new tests pass, but those are the missing proofs.
8. **Docs not updated**: `docs/api/rest-endpoints.md`, `docs/CHANGELOG.md`, `docs/codebase-summary.md`, `docs/project-roadmap.md` still say operation endpoints are "proposed"/Phase 04 deferred (`system-architecture.md:212-214`).
9. **Legacy duplication**: `GitRecoveryState/GitRecoveryOperation` still parallel to `OperationKind` and `OperationStatusResponse` (plan: no parallel legacy names). `active_git_operation` also changes `can_continue` for merge to `!has_conflicts` while status for same state is computed separately — two authorities.
10. **Fingerprint gaps**: swallows read errors (unreadable file ≡ empty); no field delimiters (concat ambiguity); omits `REBASE_HEAD`, `rebase-merge/git-rebase-todo`, `sequencer/head`; `repo.head()` called twice. Index fingerprint includes stat mtime/size so a terminal `git status` refresh can cause spurious stale (acceptable, note).
11. `Unsupported` with conflicts: blockers/stopped reason say Conflicts and hide the unsupported blocker (ordering in `get_authoritative_operation_status`).

## Suggestions
- DRY: extract one generic `drain_bounded<R: AsyncRead>(reader, cap)` (stdout/stderr closures identical, 40 duplicated lines). Replace tuple `(i32,String,String,bool)` with a `BoundedOutput` struct; `status.code().unwrap_or(-1)` hides signal kills.
- `OperationActionRequest.project` is accepted and ignored (path param is authoritative) — remove or validate equal. Handler double-validates (manual `Value` key checks + serde `deny_unknown_fields`); keep one, matching `resolve` pattern only if it requires it.
- Distinguish `completed` (operation None) / `stopped|newConflict` (conflicts) in `Continued`, as plan outcome set specifies (`Continued{new_status}` conflates them for Phase 05).
- Merge `OperationStoppedReason::Unknown` vs `OperationKind::Unsupported` semantics; use `Unsupported` explicit reason.
- `active_operation_kind` marker counting + `repo.state()` fallback is clear but repeats `exists()` calls; fine. Move `StageRoleLabels`/outcome types out of the middle of `types.rs` (inserted before a separator comment).
- Run `rustfmt` on `operation.rs` (5 diffs). Avoid `unsafe libc::kill` duplication by `nix`/`libc` helper wrapper if more users appear.
- `safe.directory=*` matches the existing codebase convention (`main.rs:651` sets it globally); not a new risk, noted only.

## Positives
- Detection verified empirically against real Git 2.55 markers (rebase: `rebase-merge`+`REBASE_HEAD`, no `CHERRY_PICK_HEAD`; cherry-pick: `CHERRY_PICK_HEAD`); worktree-specific gitdir used; contradictory/bisect/am fail closed.
- Fixed allowlisted arg arrays; no client text reaches argv; no skip/reset/clean; routes under `require_auth`; coordinator keyed by common dir with non-blocking acquire avoids self-deadlock; operation + full-index precondition re-validated under guard; stale test for unrelated stage-0 change.
- stdin null, process group, bounded 64 KB per stream, no hook/signing disable, no config writes.

## Validation
| Command | Result |
|---|---|
| Tester report (cargo test lifecycle/api/metadata/exact_staging/discovery_api/`git::`) | 241 passed, 0 failed (per `plans/reports/tester-261020-0707-...md`, not re-run) |
| `cargo clippy --all-targets` (server) | no diagnostics reported for `operation.rs`/`git_diff.rs`/new tests; repo-wide pre-existing warnings (133 lib) |
| `rustfmt --check src/git/operation.rs` | 5 diffs |
| Real git 2.55 marker probe (rebase/cherry-pick conflict) | detection assumptions hold |

## Unresolved questions
1. Should Unsupported/Unknown still block other mutation writers (assumed yes, per plan)?
2. Target Continue deadline and whether hook-time budget is a Phase 01-qualified value?
3. Where is terminal-owner identity (profile/generation/server) sourced — Phase 05 client or server-side here?
4. Is Windows-native server process-tree cleanup in scope for Phase 04 qualification?
