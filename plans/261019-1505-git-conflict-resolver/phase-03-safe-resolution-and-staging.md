# Phase 03 — Safe resolution and staging

## Context links

- [Plan](./plan.md), [Phase 02](./phase-02-conflict-discovery-and-snapshots.md), [mutation contract](./design-contract.md#mutation-contract).
- [Acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md), [Git semantics](./research/git-semantics.md).

## Overview

- Date: 2026-10-19. Priority: P2.
- Implementation: Pending. Review: Pending. Progress: 0%. Effort: unestimated.
- Owner: backend mutation owner; integration lead owns cross-writer coordination and public cutover.
- Entry: Phase 02 coherent snapshots and Phase 01 exact-side/conversion/path/locking proofs passed.
- Handoff: typed preconditioned Apply & stage service, generic-stage rejection and truthful mutation facts.
- Go/no-go: exact intended path/index result with unrelated entries preserved; no permissive legacy resolver survives.

## Key insights

- Current direct write then index add has no state precondition and cannot distinguish safe failure from partial mutation.
- Filesystem publication plus index update is not an external-writer transaction; never promise atomicity across arbitrary terminal/editor writes.
- Locking only resolver requests does not coordinate application stage/commit/checkout/ref writers.
- A preexisting index.lock normally proves busy-before-write; it does not prove the required later stage-failure branch.
- Generic stage endpoint must enforce conflicts itself; disabled row controls are insufficient.

## Requirements

### Functional

- Accept only frozen discriminated reviewedText, indexSide or delete actions bound to scope/conflictId/precondition.
- reviewedText represents explicitly reviewed worktree text including EOL/BOM/final-newline/mode; empty text is valid.
- indexSide selects an existing stage 2/3 and yields exact chosen OID/mode plus qualified checkout-compatible bytes.
- delete removes the intended regular/missing path and unmerged index entries, never an empty-file substitute.
- Return applied, stale, unsupported, busy, failedBeforeWrite, worktreeChangedStageFailed or outcomeUnknown with observed phase facts.
- Preflight a generic selected-path stage batch and reject any conflict before staging even an earlier clean path.

### Nonfunctional

- Preserve unrelated staged/conflicted paths and applicable modes; never git add ., hard reset or clean.
- Secure all ancestor/type checks immediately before publication; no following symlink/reparse paths outside root.
- Coordinate actual worktree/index and shared repository/ref scope with fixed lock order.
- No automatic rollback, mutation replay or permissive compatibility alias; lost response/cancel/timeout requires refresh/review.

## Architecture

Protected route -> bounded discriminated body -> registered target/explicit root -> actual index/ref application coordination.
Reopen repository, validate operation/stages/attributes/worktree type and precondition, securely publish qualified action, use native Git locks, then read actual disk/index facts.
Never hold a manually acquired index.lock while executing a Git child that needs it; qualify publication/index mechanism in Phase 01.
Application coordination must cover affected existing writers or reject incompatible active commands; it cannot exclude external writers.
Response reports each completed/failed step and whether refresh is mandatory; partial deletion/index-side sequences are reported as actually observed.
Backend/client cutover remains unreleasable until Phase 05 migrates every caller in the coordinated UI/server upgrade; one new contract, no legacy write fallback, compatibility shim or incompatible intermediate deployment.

## Related code files

- Modify: `server/src/git/diff.rs` for generic stage preflight and removal of unchecked resolve_conflict.
- Modify: `server/src/git/types.rs`, `server/src/git/mod.rs` for typed actions/outcomes and exports.
- Modify: `server/src/api/git_diff.rs`, `server/src/api/router.rs` for bounded request/response contract and protected dispatch.
- Reuse/modify: `server/src/git/vcs_roots.rs`, `server/src/fs/ops.rs` only where existing containment/publication helpers meet the qualified contract.
- Inspect: `server/src/git/commit_message_rewrite.rs`; its index/ref transaction is not a general coordinator to assume safe by name.
- Modify: `server/src/git/tests.rs`, `server/src/api/tests.rs` for real state assertions and later-failure injection.
- Create/modify (proposed): `server/src/git/conflict.rs` from Phase 02 for apply logic or a focused snake_case child module.
- Create (proposed): `server/src/git/mutation_coordination.rs` only after mapping actual existing application writers and lock ownership.
- Delete: old permissive conflict resolver implementation/DTO/reexports after reference migration, not an alias to new unchecked behavior.

## Implementation steps

1. Inventory application Git writers touching actual indices/refs, including generic stage, commit, checkout and operation paths.
   Assign one coordinator integration owner and record acquisition order for common repository then worktree/index scopes as qualified.
   Linked worktrees may use independent indices where safe but still share relevant ref scope.
2. Implement one frozen action union and bounded decoder; reject unknown action fields/types according to the frozen contract.
   Validate scope through existing registration/root resolution; do not accept arbitrary filesystem paths or client shell commands.
3. Acquire application coordination or return busy without write, then reopen actual repository/index and validate precondition.
   Compare stages/OIDs/modes/raw paths, HEAD/operation, attributes and current worktree bytes/type.
   A mismatch returns stale and zero mutation, not an automatic attempt against new state.
4. Revalidate secure ancestors and target type immediately before publishing; reject traversal, symlink/reparse ancestor or changed directory/gitlink.
   Use the qualified publication mechanism with its stated race boundary, not lexical root-prefix checks alone.
5. Implement reviewedText with complete reviewed worktree representation and deliberate mode handling.
   Preserve allowed empty file, EOL/BOM/mixed-ending/final-newline semantics; stage through only qualified conversions.
   No marker-count heuristic can replace explicit review intent or Git safety validation.
6. Implement indexSide with selected descriptor verified against current stage 2/3.
   Materialize checkout-compatible bytes and stage exact selected OID/mode using the qualified algorithm; do not assume add roundtrips filters.
   Verify stage 0 equals selected OID/mode independently from worktree bytes; binary previews must not re-encode content.
7. Implement delete for supported regular/missing targets and corresponding index conflict entries.
   Reject unsafe type changes; preserve distinction between deletion, missing side and empty text throughout the response.
8. Read actual resulting worktree/index/status after every known completed boundary.
   Return applied only when intended stage/path/byte oracle holds; map stale/unsupported/busy/failedBeforeWrite to proven zero-write facts.
   For worktree changed but stage failed, return phase facts and refresh requirement; uncertain command completion is outcomeUnknown.
9. Preserve newer external writes on late failure; do not rollback over them or replay a timed-out mutation.
   Record what is known versus unknown even if final inspection itself fails; UI must retain submitted text for recovery.
10. Add generic stage preflight covering every explicit selected path before any stage mutation.
    Reject a batch containing an unmerged path atomically at the application boundary; nonconflict-only staging retains current behavior.
    Migrate every backend callsite; terminal git add remains outside application enforcement and later discovery sees it as external change.
11. Inject separate failures before write, after worktree publication, during staging and after command completion/response loss.
    Assert raw bytes, stage tuples and untouched paths after each; add concurrency cases for same index and linked-worktree/shared-ref commands.
12. Remove obsolete unchecked backend exports/handlers with the coordinated client migration; prove old write payloads fail closed rather than selecting legacy behavior.
    Provide next owners exact response examples and refresh/review requirements; intermediate incompatible deployment is prohibited.

## Todo list

- [ ] Coordinate actual application index/ref writers without Git lock self-deadlock.
- [ ] Implement three typed actions with secure preconditioned publication.
- [ ] Verify selected OID/mode and exact supported byte outcomes.
- [ ] Reject generic mixed conflict-stage batches before any mutation.
- [ ] Return truthful no-write/partial/unknown outcomes; retire unchecked resolver and reject legacy writes without fallback/shim at coordinated cutover.
- [ ] Add deterministic post-write failure, concurrency and external-writer preservation evidence.

## Success criteria

- AC5: exactly the intended file/deletion changes; unrelated staged and conflicted tuples remain byte/OID/mode-identical; no operation automatically continues.
- AC6/AC7: both binary sides match selected stage-0 OID/mode and qualified checkout bytes; empty reviewed text remains present while delete remains absent.
- AC8: change any precondition input after snapshot and assert zero writes; inject stage failure after a proven successful worktree write and observe partial outcome with retained recovery text.
- CUT1: mixed clean+conflict generic stage batch rejects before the clean file stages; clean-only batch still works.
- CUT4/CUT5: unsafe ancestors/oversized requests fail before write; same-index app commands serialize/reject; no Git child deadlocks under manual index.lock ownership.
- Actual future smoke: temporary repo with two text conflicts, binary conflict, delete/modify and unrelated staged file; apply empty reviewed text, select each binary side in separate fixtures and delete missing-side target.
- Inspect `git ls-files -u/-s -z`, `git cat-file`, selected source OIDs/modes and raw disk bytes; run post-write staging failure then make an external edit and ensure no rollback overwrites it.
- Gate fails for unconditional ok:true, inferred rollback success, replay after uncertainty, leftover permissive resolver/fallback/shim, incompatible intermediate deployment or generic stage bypass.

## Risk assessment

Cross-writer coordination is easy to under-scope; an inventory of actual mutation callsites is required, not a new mutex claim.
Exact-side materialization can break with nonroundtripping filters; unsupported policies must fail before publication.
External filesystem races remain possible despite revalidation; return observed facts and retain drafts rather than claiming isolation.

## Security considerations

Authenticate and authorize every mutation; tokens are preconditions, not capabilities granting arbitrary path access.
Use argument arrays and fixed command vocabulary, bounded bodies and diagnostics, secure ancestor/type checks.
Do not execute unknown filters or expose source text in errors; preserve repository permissions and user hook/signing policy.

## Next steps

Hand apply/outcome/coordination contracts to [Phase 04](./phase-04-operation-lifecycle.md) and retained client owner in Phase 05.
Generic conflict-stage enforcement must land with resolver cutover, not remain a later UI-only fix.

## Unresolved questions

- Backend mutation owner: final qualified secure publication/exact-side algorithm; run steps 4–7 against byte/OID/mode fixtures, attach evidence, stop writable integration on any mismatch.
- Integration lead: complete actual-index/ref writer scope and coordinated caller migration; run step 11 concurrent commands/lock contention and step 12 legacy-write rejection, publish evidence, stop cutover on uncovered writers, self-deadlock or fallback/shim. Applicable server safety is not deferred by separately Pending Windows-native client qualification.
