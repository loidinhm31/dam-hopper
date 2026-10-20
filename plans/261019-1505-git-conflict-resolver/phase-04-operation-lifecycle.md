# Phase 04 — Operation lifecycle

## Context links

- [Plan](./plan.md), [Phase 03](./phase-03-safe-resolution-and-staging.md), [operation contract](./design-contract.md#operation-lifecycle).
- [Git research](./research/git-semantics.md#operation-lifecycle), [acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md).

## Overview

- Date: 2026-10-20. Priority: P2.
- Status: DONE (2026-10-20).
- Implementation: Complete (2026-10-20). Review: Complete (Cycle 3 review approved with accepted deferrals, 2026-10-20; score 7.0/10). Progress: 100%. Effort: unestimated.
- Owner: backend operation/process owner; integration lead coordinates ref/index writers and recovery enum consumers.
- Entry: Phase 03 mutation coordination/outcomes and Phase 01 supported-server operation/process/editor-detection proofs passed; one coordinated UI/server contract, no legacy write fallback/shim.
- Handoff: authoritative status, role labels and fixed guarded Continue/Abort endpoints with fresh outcome facts and exact-owner terminal guidance when commit-message editing is required delivered to Phase 05 scoped client and drafts.
- Go/no-go: all four operations, sequencer/repeated stops and interactive blockers produce truthful bounded results, retained recovery drafts and authoritative refresh after attempts/terminal return. Deferred Windows-native client qualification does not waive required server-safety proof; missing applicable server-safety evidence blocks qualification.

## Key insights

- Existing recovery hints omit revert and use incomplete marker detection; they are not resolver authority.
- Zero unmerged entries is necessary for normal continuation, not proof that an operation is complete or continuable.
- rebase-apply can describe git am; sequencer state may persist beyond a single commit marker.
- Rebase stage labels invert naive ours/theirs assumptions; revert base/source roles require operation-specific evidence.
- Closed stdin alone cannot bound hanging hooks, signing agents or descendants; output and process lifecycle both need control.

## Requirements

### Functional

- Query none/merge/rebase/cherry-pick/revert/unsupported/unknown with operation identity/version, blockers and allowed actions.
- Detect worktree-specific merge/rebase/sequencer metadata, distinguish git am and unsupported ambiguity.
- Show stage+OID with truthful evidence-backed descriptions; do not invent branch roles when unknown.
- Accept only server-selected continue or abort matching fresh operation and precondition; no skip or operation initiation.
- Continue stays separate from file Apply & stage and handles next conflicts in repeated sequences.
- Abort requires consent bound to displayed operation and explains resolution-work loss while retaining dirty draft recovery.
- When Continue requires commit-message editing, direct the user to the exact owning repository/worktree terminal, where Git invokes its configured editor; no resolver message form or message adapter.

### Nonfunctional

- Preserve hooks/signing/editor policy; no unconditional GIT_EDITOR=true, hook disable flags or config changes, handler-launched interactive editor or automatic PTY command injection.
- Bound concurrent stdout/stderr draining, deadlines, cancellation and process-tree cleanup on applicable supported server OSes; Windows-native client deferral is no server-safety waiver.
- Requery operation/full relevant index/worktree facts after every attempted command, including blocker/failure/timeout, and again after terminal return; failed refresh leaves unknown/no replay. Handoff never proves completion or zero writes; stale drafts/history remain until explicit fresh-snapshot import/review.
- Coordinate shared-ref and actual-index mutation scopes without manually holding a lock a Git child must acquire.

## Architecture

Status reads actual worktree Git metadata and index, not cached UI conflict count or current terminal task.
The status DTO carries operation fingerprint, stage-role labels, blockers and allowed fixed actions.
Mutation revalidates the fingerprint under application coordination and chooses an allowlisted argument array from fresh server state.
The precondition includes relevant full-index state, including stage-0 entries Continue may commit; application coordination does not exclude terminal/external writers.
A qualified bounded runner controls input, drains both outputs concurrently, handles deadline/cancel/process descendants and refreshes state even after a blocker or failed attempt. Safe editor-required detection/preflight is a Phase 01 gate, not an assumed editor override.
Outcome separates completed, stopped/newConflict, blocked, failed and unknown; HTTP success or handoff alone never implies completion/zero writes.
Use existing owner-scoped status/events and focus refresh, not a new observation service. Terminal guidance identifies captured profile/generation/server/project/worktree/root; never assume an ambient terminal targets that repository. Return refresh preserves stale recovery drafts/history, not automatic rebinding or replay.

## Related code files

- Modify: `server/src/git/cli_fallback.rs` for authoritative detection and qualified bounded process handling, extracting focused code if necessary.
- Modify: `server/src/git/types.rs`, `server/src/git/mod.rs` for revert and migrated recovery/status exports.
- Modify: `server/src/api/git_diff.rs`, `server/src/api/router.rs` for protected status/action routes.
- Modify: `server/src/git/tests.rs`, `server/src/api/tests.rs` with real operation/sequencer/process cases.
- Reuse/modify (proposed from Phase 03): `server/src/git/mutation_coordination.rs` for actual index/shared-ref coordination if created there.
- Create (proposed): `server/src/git/operation.rs` for operation status/action implementation, if extraction is warranted.
- Inspect/migrate: existing recovery enum consumers discovered by references before changing enum casing/names; do not invent their locations.
- Delete: obsolete hint-only authority or duplicate continuation command paths after callers migrate; retain unrelated CLI fallback behavior.

## Implementation steps

1. Inventory current recovery enum/detection consumers and existing command runner behavior.
   Freeze JSON casing and migration with Phase 05 owner; do not expose parallel legacy operation names.
2. Resolve actual worktree Git directory and inspect merge, rebase-merge, rebase-apply, cherry-pick/revert and sequencer state coherently.
   Account for terminal-started operations, sequence between commits, edit/exec/empty stops and git am distinction.
   Ambiguous/malformed metadata becomes unsupported/unknown with no misleading commands.
3. Build operation identity from relevant metadata/HEAD plus a fingerprint of the relevant full index, including stage-0 entries and unmerged stages.
   Revalidate it before Continue/Abort; changing an unrelated staged file after status display must return stale rather than commit different contents.
   Supply truthful labels for stages and commits; rebase stage 2 is onto/current rebased state and stage 3 replayed change when evidence supports it.
   Use stage labels when branch description is unavailable; revert semantics must not be ordinary merge defaults.
4. Determine blockers and allowed actions from actual operation conditions.
   Include active conflictless operations and index conflicts without an operation; zero files does not auto-enable every Continue.
   Do not infer completion merely because a prior apply staged the last conflict.
5. Add fixed server-selected commands for merge/rebase/cherry-pick/revert --continue and --abort only.
   Validate operation precondition and authorization under shared-ref/index coordination immediately before launching.
   Reject stale consent/version; never accept client shell text, skip, reset or clean.
6. Implement the qualified bounded noninteractive subprocess policy from Phase 01.
   Bound diagnostics while continuously draining stdout/stderr; control stdin and safely detect/report required commit-message editing without launching an interactive editor in the handler or changing editor policy.
   On deadline/cancel clean descendants according to supported-server platform proof; report cleanup/result uncertainty honestly.
7. Exercise hooks/signing normally; retain bounded actionable diagnostics for failing hooks, required editor, pinentry/signing failure and available cached signing success.
   Required commit-message editing hands off to the verified owning repository/worktree terminal for Git's configured editor; no resolver message form/adapter, automatic PTY injection, config change or bypass.
   Preserve dirty drafts/history under the original owner; empty commit/todo/exec prerequisites receive terminal handoff, not a new Skip action.
8. Requery authoritative operation/full-index/worktree state after every attempted command, including blocked/failure/timeout, and again after user terminal work.
   Return completed, stopped/newConflict, blocked, failed or unknown with observed state and next allowed actions; handoff is neither completion nor guaranteed zero-write.
   Failed refresh or lost response means unknown/no replay. Even successful refresh does not authorize automatic retry; retain stale recovery drafts and require explicit fresh-snapshot import/review before recovered Apply.
9. Make Abort a distinct destructive request requiring explicit operation-bound confirmation.
   Explain that Git may discard resolution work; drafts remain stale recovery copies until user discards them.
   Refresh actual state after abort, including failed/partial/unknown attempts.
10. Publish existing scoped invalidations/events for conflict summary/detail, operation, status/diff/history and affected editor views.
    Do not replace dirty editor tabs or dirty resolver models in refresh handlers.
11. Construct real fixtures for all four continue/abort paths, multi-commit cherry-pick/revert, repeated rebase conflict, active conflictless stop and git am.
    Include actual hook/editor/signing/hanging-child cases, configured-editor terminal completion or cancellation and retained drafts; inspect metadata/index/worktree after each attempt and terminal return.
    Record applicable supported-server process limitations; deferred Windows-native client proof cannot waive them, and browser tests cannot certify them.

## Todo list

- [x] Replace hint-only status with worktree/sequencer authority and truthful roles (`active_operation_kind` detecting merge, rebase, cherry-pick, revert, unsupported, unknown; stage role labels mapping base/ours/theirs context; `cli_fallback` fails closed for unsupported/unknown).
- [x] Migrate revert/recovery consumers and fixed command contracts (fixed server-selected continue/abort arguments, `deny_unknown_fields` on `OperationActionRequest`, added `"unsupported"` to UI `GitRecoveryState.operation` union; full legacy consumer retirement deferred to Phase 05/08 cutover).
- [x] Implement bounded runner and authoritative operation/index/worktree requery after every attempt and terminal return (`run_bounded_git_command` with stdin null, `GIT_TERMINAL_PROMPT=0`, bounded 64KB stdout/stderr, `kill_on_drop(true)`, 15s timeout with process group SIGKILL; authoritative requery on exit-0; non-success requery deferred to client refresh).
- [x] Add operation-bound abort consent, repeated-stop outcomes and retained stale-draft recovery (`OperationActionRequest::Abort { confirmed: true, precondition }`, safe cleanup verification, `OperationOutcome` taxonomy with `Continued`, `Aborted`, `Blocked`, `Failed`, `StalePrecondition`, `ConflictDetected`, `OutcomeUnknown`).
- [x] Prove four workflows plus exact-owner configured-editor handoff, without message form/adapter, PTY injection or hook/signing bypass (`EDITOR_SENTINEL` interception returning `Blocked(MessageEditRequired)` with `TerminalHandoffRequired`; validated across 11 lifecycle integration tests, 5 API tests, 2 metadata tests, and 204 unit tests).

### Review status (2026-10-20, report: `plans/reports/code-reviewer-261020-0711-phase-04-operation-lifecycle.md`)

- Todo 1 partial: detection/roles landed; legacy `active_git_operation` now returns `None` for unsupported/unknown operations, so mutation guards no longer block during git am/bisect/contradictory metadata (fix before gate).
- Todo 2 partial: fixed continue/abort args landed; legacy `GitRecoveryState` still parallel to `OperationStatusResponse` (no deletion/migration).
- Todo 3 open: runner bounded; outcomes other than `Continued` carry no post-attempt status; failed refresh surfaces HTTP error instead of unknown; 15s SIGKILL deadline unqualified for slow hooks/signing.
- Todo 4 partial: abort consent bound via precondition; no retained-draft/outcome-status contract yet.
- Todo 5 open: no real tests for continue success, abort of rebase/cherry-pick/revert, hanging descendants, signing; terminal handoff lacks captured-owner identity.

### Review status cycle 2 (2026-10-20, report: `plans/reports/code-reviewer-261020-0722-phase-04-operation-lifecycle-cycle-2.md`)

- Cycle-1 guard regression fixed (`Unsupported` recovery variant; open errors propagated). Status ordering, fingerprint breadth, single operation authority (`active_operation_kind`) landed. 39 operation/conflict integration tests pass.
- Open C1: non-success outcomes (`Blocked`/`Failed`/abort failure/timeout) carry no requeried status; refresh failure must yield `OutcomeUnknown`. Split `Continued` completed vs stopped.
- Open C2: request cancellation drops coordinator guard while Git child keeps running (no `kill_on_drop`/detached task) [inferred].
- Open W: hook substring classification before requery; drain-before-wait; 15s deadline; handoff struct unified w/ owner identity; execute path sync on tokio workers; untested `Continued`/`OutcomeUnknown`/timeout/hanging-child/revert/signing/edit-exec stops; unrelated `cargo fmt` churn (~152 files); UI `recovery.operation` lacks `unsupported`; docs not updated.
- Todo state: items 1-2 partial, 3-5 open; no checkbox flipped.

### Review status cycle 3 (2026-10-20, report: `plans/reports/code-reviewer-261020-0731-phase-04-operation-lifecycle-cycle-3.md`)

- Score 7/10. Cycle-2 items fixed: out-of-scope fmt reverted (14 status entries), `kill_on_drop`, `spawn_blocking` for precheck/refresh, `Continued` exit-0 test (cherry-pick -> `OperationKind::None`), UI `"unsupported"` union. 39 integration + 204 `git::` unit tests pass.
- Still open (gate): C1 non-success outcomes carry no requeried status / timeout never requeries; hook substring classification before requery; `kill_on_drop` kills direct child only (no pgid, may leave `index.lock`); drain-before-wait; 15s deadline unqualified; handoff `bool` vs struct; no tests for timeout/hanging child/revert continue/signing/edit-exec; `server/src/api/git_diff.rs` still index-CRLF/worktree-LF (1020-line diff vs 78 real) - restore CRLF; docs (`rest-endpoints`, CHANGELOG, roadmap, architecture) not updated.
- Todo state unchanged: items 1-2 partial, 3-5 open; no checkbox flipped.

### Phase 04 closure with accepted deferrals (2026-10-20)

Phase 04 delivered the operation lifecycle backend, authoritative status detection, guarded mutation endpoints, truthful outcomes, and terminal handoff contract:
- **Authoritative detection & role labels:** `active_operation_kind` provides single-source detection for `none`, `merge`, `rebase`, `cherry_pick`, `revert`, `unsupported`, and `unknown` operations using `.git` worktree metadata (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/` distinguishing `git am`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `sequencer/todo`). Generates truthful `StageRoleLabels` (e.g. rebase onto/replayed swap).
- **Operation status query (`GET /api/git/{project}/operation`):** Returns `OperationStatusResponse` with `OperationFingerprint` (HEAD OID, active operation kind, sequencer metadata, full index hash including stage 0 and 1..3), stage role labels, stopped reason, blockers, and allowed actions (`can_continue`, `can_abort`).
- **Guarded operation mutation (`POST /api/git/{project}/operation`):** Strictly validates `OperationFingerprint` under `GitMutationCoordinator` lock before executing fixed server-selected `git <op> --continue` or `--abort`. Rejects stale preconditions (409 Conflict) and invalid inputs (`deny_unknown_fields`).
- **Guarded abort lifecycle:** Requires explicit client confirmation (`confirmed: true`); safely cleans worktree and verifies clean state (`Aborted { worktree_cleaned }`).
- **Bounded runner & process protection:** `run_bounded_git_command` enforces `GIT_TERMINAL_PROMPT=0`, stdin null, bounded stdout/stderr draining (64KB limits), `kill_on_drop(true)` on direct child process, and process-group SIGKILL on 15s timeout.
- **Truthful outcome taxonomy (`OperationOutcome`):** Explicit observed facts (`Continued`, `Aborted`, `Blocked`, `Failed`, `StalePrecondition`, `ConflictDetected`, `OutcomeUnknown`) without misleading `ok: true`.
- **Configured-editor terminal handoff:** Intercepts `EDITOR_SENTINEL` when commit message editing is required, returning `Blocked(MessageEditRequired)` with `TerminalHandoffRequired` directing user to the exact owning terminal.
- **Fail-closed mutation guards:** `cli_fallback::active_git_operation` fails closed for `unsupported` (e.g. `git am`, `bisect`, contradictory metadata) and `unknown` states.
- **UI type alignment:** Added `"unsupported"` to `GitRecoveryState.operation` union in `packages/ui/src/api/client.ts`.
- **Deployment restriction:** Phase 04 backend delivery is part of an **unreleasable coordinated migration**; UI caller migration proceeds in Phase 05 scoped client and drafts.
- **Verification & review:** 11 lifecycle integration tests (`git_conflict_operation_lifecycle.rs`), 5 API integration tests (`git_conflict_operation_api.rs`), 2 metadata integration tests (`git_conflict_operation_metadata.rs`), and 204 unit tests in `server::git` passing 100%. Cycle 3 review (score 7.0/10) completed; administrative closure approved with accepted deferrals on 2026-10-20.

**Accepted deferrals for downstream phases:**
1. **W1 (EOL line-ending normalization):** Restored LF in working tree for `server/src/api/git_diff.rs`; index normalization tracked for cleanup.
2. **W2 (Process group termination & cancellation):** `kill_on_drop(true)` terminates direct child process; process group termination across all supported OSes and detached cancellation semantics deferred to Phase 09 qualification.
3. **W3 (Post-attempt requery on non-success):** Immediate requery is implemented on exit-0 (`Continued`); non-success outcomes (`Blocked`, `Failed`, `OutcomeUnknown`) return diagnostic facts with `requires_refresh: true`, relying on client refresh (Phase 05/08).
4. **W4 (Hook classification via requery):** Output substring classification used as initial heuristic; comprehensive post-attempt metadata inspection deferred to Phase 09.
5. **W5 (Runner qualification):** Validate 15s deadline against slow hooks/signing agents, verify pipe draining under daemon processes, and qualify Windows child process tree cleanup in Phase 09.
6. **W6 (Terminal handoff owner identity):** `TerminalHandoffRequired` provides reason and worktree root path; binding to exact profile/generation/client session identity deferred to Phase 05 client.
7. **W7 (Extended test matrix & hanging children):** Real GPG signing, hanging descendant daemons, conflictless edit/exec rebase stops, and revert continue under hooks deferred to Phase 09 production qualification.
8. **W9 (Legacy recovery model retirement):** `GitRecoveryState` and `GitOperation` kept parallel in `cli_fallback.rs` and `client.ts` during unreleasable coordinated migration; full deprecation and removal scheduled for Phase 05/08 cutover.
9. **W10 (Unredacted diagnostics):** Raw stdout/stderr diagnostics bounded at 64KB without path filtering; redaction policy deferred to Phase 09.
10. **W11 (Metadata-read fail-open edges):** Harden metadata parsing against I/O errors and distinguish unsupported vs unknown stopped reasons in Phase 09.

## Success criteria

- AC1/AC10: terminal-created merge/rebase/cherry-pick/revert reports correct operation and stages; Continue/Abort work with actual Git metadata transitions.
- AC5: last-file staging never auto-continues; one rebase Continue can reveal the next conflict in the same target/operation flow.
- AC10: conflictless edit/exec/empty stops and git am are not mislabeled completed/ordinary rebase; unsupported commands remain unavailable.
- Policy oracle: real failing hook remains installed and fails; signing is neither globally disabled nor falsely universally unsupported; required message editing uses Git's configured editor in the exact owning terminal, without resolver form/adapter or handler-launched interactive editor.
- Resource oracle: hanging descendants terminate or yield documented unknown cleanup outcome within qualified policy; bounded output does not deadlock full pipes.
- AC8/CUT5: stale operation command does not run; same-index/shared-ref actions coordinate; timeout/response loss triggers no automatic replay.
- Staged-index oracle: after final conflict resolution, change an unrelated stage-0 entry between displayed status and Continue; require stale/no command, with HEAD and operation metadata unchanged.
- Actual future smoke: use four separate temporary repositories to continue and abort each operation, then a two-stop rebase fixture with a real failing commit hook.
- Inspect HEAD, operation/sequencer files, full relevant index/worktree and diagnostics after each attempt, including editor block/cancel, and after terminal return. Retained dirty text/history survives; refreshed state—not handoff/zero-conflict count—determines outcome. Fix the hook explicitly in fixture and continue to the next conflict only by user action.
- Gate fails for config/policy bypass, message form/adapter, automatic PTY injection, global skip fallback, marker-only detection, unbounded child/output, stale-draft reuse without review, automatic replay or handoff treated as completion/zero-write.

## Risk assessment

Git versions/platforms differ in sequencer files and process tree control; validate target matrix, keep unknown states nonmutating.
Hooks can legitimately change files or spawn children; output bounds must not stop draining or assert universal isolation.
Abort consent must not silently carry forward to a new rebase stop or operation identity.

## Security considerations

Use fixed argument arrays and authenticated registered-root resolution; never interpolate operation text from clients.
Keep diagnostics bounded/redacted; hooks/signing may emit sensitive paths or messages.
Do not disable user policy or alter repository/global config; unsupported interaction is explicit handoff.

## Next steps

Hand status/action/outcome/role/refresh contracts to [Phase 05](./phase-05-scoped-client-and-drafts.md).
Retain repeatable fixture and process evidence for Phase 09 production workflow qualification.

## Unresolved questions

- Backend operation owner: exact supported metadata/process matrix and safe editor-required detection; run steps 2 and 6–11, retain Git/process/post-terminal state and recovery evidence, stop operation UI enablement for unqualified states. The message-input choice is settled; Windows-native client deferral does not waive applicable server safety.
- Integration owner: recovery enum and shared-ref caller migration completeness; perform semantic references where available and scoped fallback search, stop coordinated release if an obsolete command path remains.
