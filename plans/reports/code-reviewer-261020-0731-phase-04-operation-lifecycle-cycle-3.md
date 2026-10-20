# Code Review Cycle 3: Phase 04 Operation Lifecycle

**Score: 7/10.** Cycle-2 fix list verified applied. Backend slice sound, tests green. Phase 04 gate still not closed: non-success outcome state, process-tree/cancel semantics, docs, one EOL hygiene leftover.

## Scope
- Files: `server/src/git/{types,operation,cli_fallback,conflict,mod}.rs`, `server/src/api/{git_diff,router}.rs`, `packages/ui/src/api/client.ts`, `server/tests/git_conflict_operation_{lifecycle,api}.rs`.
- Plan updated: `phase-04-operation-lifecycle.md` (cycle 3 status; no checkbox flipped).

## Cycle-2 claimed fixes — verification
| # | Claim | Result |
|---|---|---|
| 1 | Unrelated fmt churn reverted | **Mostly.** `git status` = 14 entries, all Phase 04 + plan/reports (was 174). Leftover: `api/git_diff.rs` index=CRLF/worktree=LF ⇒ 1020-line diff, real change 78 lines (`git diff -w`). See W1. |
| 2 | `kill_on_drop(true)` | Applied (`operation.rs:351`). Partial mitigation, see W2. |
| 3 | `spawn_blocking` for precheck + post-continue refresh | Applied (`operation.rs:419`, `503`). Remaining sync: `Repository::open` + abort-path `repo.index()` + conditional requery at L547 run inline (small). |
| 4 | Exit-0 `Continued` test | Present (`lifecycle.rs:718`): cherry-pick continue ⇒ `Continued`, op `None`, no continue/abort. |
| 5 | UI `"unsupported"` union | Applied (`client.ts:2275`). No other `"bisect"` string consumer found in UI. |
| 6 | Tests | Re-run: see Validation. |

## Critical issues
None new. No security/data-loss defect found in diff.

## Warnings (gate items; carried unless noted)
1. **W1 EOL leftover (new/hygiene).** `git ls-files --eol`: `server/src/api/git_diff.rs` `i/crlf w/lf`. Restore CRLF so diff = ~78 lines. `router.rs`/`mod.rs`/`conflict.rs`/`types.rs` carry cosmetic rustfmt reflow inside touched files (import re-sort, line wraps, `conflict.rs` ~100 lines of fmt-only hunks). Acceptable but noisy; prefer reverting fmt-only hunks.
2. **W2 Cancellation/kill semantics (partial fix).** `kill_on_drop` SIGKILLs the direct `git` child only, not the process group (group kill exists only in timeout branch). Hook/GPG descendants survive; SIGKILL mid-`continue` can leave `index.lock`/half-written sequencer state, and coordinator guard drops immediately. Client disconnect now mutates-then-kills instead of completing. Prefer detached `tokio::spawn` for the action (result via join) or killpg in a drop guard. [INFERENCE, not reproduced]
3. **W3 Post-attempt requery missing on non-success branches (carried C1, downgraded).** `Blocked(MessageEditRequired|HookBlocked)`, `Failed`, abort non-zero carry no status; timeout/spawn error ⇒ `OutcomeUnknown{requiredRefresh:true}` (client can refresh, so recoverable, but no fresh facts on wire, plan step 8/9). `Aborted.worktreeCleaned` means "no op + no conflicts".
4. **W4 Hook substring classification before requery** (`"pre-commit"`/`"commit-msg"` in combined output; a rebase stop printing `CONFLICT … .githooks/pre-commit` ⇒ misreported `HookBlocked`) [INFERRED]. Classify from requeried state; hook text as hint only.
5. **W5 Runner:** `join!(drain)` before `child.wait()` (pipe-holding daemon ⇒ false timeout); 15 s hard deadline on continue unqualified (slow hooks/signing); `status.code().unwrap_or(-1)` hides signal kills; sentinel searched in 64 KB-truncated stderr; `libc::kill(pid)` redundant after `kill(-pgid)`; Windows `child.kill()` root only, `cmd /c` editor string unverified.
6. **W6 Handoff contract:** outcome `Blocked.terminal_handoff_required: bool` vs status `TerminalHandoffRequired{reason,worktreeRoot}`; no owner identity. Merge `Continue` always returns handoff in this API because `GIT_EDITOR` is the sentinel (test `lifecycle.rs:316-328` asserts it) — status advertises `canContinue:true` + `MessageEditRequired`; document as intended so UI does not present a one-click Continue for merge.
7. **W7 Test gaps vs plan proofs:** no direct test for `run_bounded_git_command` (timeout, hanging descendant, output cap), no kill_on_drop/cancel test, no revert continue/abort, no signing, no conflictless `edit/exec/empty` rebase stop, no `OutcomeUnknown` branch test, repeated-stop test advances via external `git rebase --continue`.
8. **W8 Docs not updated:** `docs/api/rest-endpoints.md` (no `/operation`), `docs/CHANGELOG.md`, `docs/codebase-summary.md`, `docs/project-roadmap.md`, `docs/system-architecture.md`.
9. **W9 Legacy parallel model:** `GitRecoveryState/Operation` (+ `Unsupported` variant) still parallel to `OperationKind`; wire-visible via `recovery`. `conflict::get_active_operation` string for am/bisect changed `"rebase"/"bisect"` → `"unsupported"` (intentional; snapshot fingerprint inputs change).
10. **W10 Unredacted diagnostics:** `Failed{error}` embeds up to 64 KB raw stdout/stderr incl. paths.
11. **W11 Fail-open edges:** `active_operation_kind` reads metadata via `exists()`/`read_to_string` (errors ⇒ absent); `OperationStoppedReason::Unknown` reused for Unsupported.

## Suggestions
- Replace `(i32,String,String,bool)` with `BoundedOutput{code,stdout,stderr,editor_invoked,truncated,signaled}`.
- `OperationActionRequest.project` accepted & ignored — remove or validate. Handler double-validates (manual key checks then serde `deny_unknown_fields`); missing fields reported as `LegacyPayloadRejected` — use `InvalidInput`.
- `compute_operation_fingerprint` calls `repo.head()` twice; read once.
- `active_operation_kind` duplicated `else if applying … else Unsupported` arms (both return Unsupported): collapse.
- Revert stage labels unverified against real revert conflict [INFERENCE]; add fixture or hedge.
- Pre-existing clippy warnings in `conflict.rs` (`unwrap_or_default` L37, needless borrows L267/268/403) are Phase 02 code; not Phase 04.

## Positives
- Single authority for operation detection; `git_path_exists` removed; mutation guard fails closed for unsupported/unknown.
- Fingerprint covers op + HEAD + sequencer/rebase/merge metadata, re-validated under coordinator guard; full-index oracle.
- Fixed allowlisted argv, no skip/reset/clean, stdin null, GIT_TERMINAL_PROMPT=0, process group + killpg on timeout, bounded drain, no hook/sign bypass; routes under auth; abort requires explicit confirmation.
- Both GET and POST precheck/refresh now off async workers.
- Real-git integration tests incl. linked worktree, staged-index oracle, hook block, am/bisect/contradictory metadata.

## Validation
| Command | Result (observed) |
|---|---|
| `cargo test --test git_conflict_operation_lifecycle --test git_conflict_operation_api --test git_conflict_operation_metadata --test git_conflict_exact_staging --test git_conflict_discovery_api` (server) | 11+10+5+11+2 = **39 passed, 0 failed** (lifecycle 11, api 5 per cycle-2 labels) |
| `cargo test --lib git::` | **204 passed, 0 failed** |
| `cargo clippy --all-targets` filtered to touched files | only pre-existing `conflict.rs` Phase 02 lines (L37, 267, 268, 403); none in `operation.rs`, `git_diff.rs`, new tests; overall exit status not checked |
| `npx tsc --noEmit -p .` (packages/ui) | no diagnostics printed (output limited to first 5 lines; exit status not captured) |
| `git status --short` / `git ls-files --eol` | 14 entries; only `git_diff.rs` i/crlf w/lf among touched |
| `git diff -w --ignore-cr-at-eol --stat` git_diff.rs | 74+/4− vs raw 1020-line diff |

## Unresolved questions
1. Should the action be detached from request cancellation (spawn) or is kill-on-drop acceptable for Phase 04 qualification?
2. Who owns terminal owner identity (profile/generation) capture/fencing — Phase 05 client?
3. Supported-server OS matrix for Continue deadline/process cleanup (Windows-native in scope)?
4. Is merge Continue intended to be handoff-only in UI (sentinel always wins)?
5. Docs update in Phase 04 or deferred to Phase 09?
