# Independent review triage

Canonical plan unchanged. Initial review retried with explicit user authorization; retry COMPLETE, revision required. No implementation approval.

## F1 — Accept (High, evidence-backed scheduling deadlock)
- Existing installed completion contract requires compile/tests/smoke/review before prerequisite completion. Deferring every check until transitively dependent P08 is unschedulable.
- Retain stable task IDs and existing helper. One coordinator runs applicable scoped compile, focused behavioral regressions, meaningful task-local smoke and independent review AFTER all writers in a coherent task/wave stop, BEFORE completion/releasing dependents. No checks during sibling editing; full integrated/live/device release qualification remains P08.
- Author explicit finite implementation/verification waves in ownership/overview; hold successors through stop/check/evidence-completion barrier. Encode necessary wave barriers in blocked_by or exact selected-wave policy, no new scheduler/runtime/flags. Sequential P01/P02/P07 tasks also require evidence-backed completion, not just terminal author report.
- Separate task-local observable acceptance from later root/release acceptance: a provider/task cannot depend on unimplemented downstream P07/P08 behavior to complete. Preserve final full-surface/live/device obligations without making task-local requirements vacuous.
- Propagate every P01–P07 constraint, verification entry, downstream barrier, C9, ownership, acceptance command timing, and final qualification description. No test waiver, fabricated pass, relaxed assertions or implementation now.

## F2 — Accept (High, missing canonical native-document lifetime contract)
Source confirms session/tab/workspace close currently owns native disposal; shared lookup map alone is insufficient.
- Existing retained owner owns canonical holder/document; alias sessions/tabs are leases/view bindings, never independent native-document owners. No new registry/runtime.
- Alias close releases only its lease/listeners/exact view; another alias or retained dirty/in-flight-save holder stays usable with undo. Final alias close consults existing canonical dirty save/discard/cancel guard; no unreachable silently retained dirty document or implicit discard. Owner retirement withdraws authority synchronously, retains recoverable in-process dirty state, and rejects stale callbacks; process death still has no draft-recovery guarantee.
- Final disposal requires no live alias/view lease, no dirty retention and no in-flight snapshot/save using the holder. Retire token first; close native document exactly once only by retained owner. Alias/workspace closure never disposes a holder still used elsewhere.
- Reload/discard/tier change is one canonical operation, not alias-local replacement: capture canonical revision/owner, refuse/defer while save is in flight, explicit discard consent when dirty, revalidate after consent, publish successor to every alias and rotate instance/incarnation guards together. Failed/stale operation leaves original dirty/undo state intact; no mixture of old/new canonical authority.
- Single active native view per canonical document. Attach/detach uses exact widget+lease token; late old-view release cannot unsubscribe successor receipt, overwrite its view state, disable its input or close its document. Detach only releases the old widget's own resources.
- Freeze ports/lifetime invariants P01; migrate session/document/factory callers atomically P02; implement alias/lifetime behavior P06; retained-owner lifecycle wiring P07. Exact existing file allowlists already contain relevant files; amend only if evidence requires it, preserve disjoint G-A ownership.
- Required behavior: edit A -> open alias B -> close A tab/workspace -> undo/save B; reverse close; final dirty alias close save/discard/cancel; in-flight save vs close/reload; tier replacement across aliases; late old-view detach after successor attachment. Include task-local and full MainActivity device assertions.

## Minor action classification correction
P02/P07 files created by P01 are Modify after ownership transfer, not another Create/overwrite. Update phase action lists without changing first-ownership matrix semantics.

## Review/validation gate
Terminal planner revision propagated F1/F2 and passed source-only structural checks. The single targeted follow-up completed in [independent-plan-followup.md](independent-plan-followup.md): both High findings resolved by design, no remaining targeted High blocker. Final two-question user validation confirmed existing defaults; no material task/ownership change. Earlier runtime/device/secret isolation limitations retained; no implementation approval.

## Unresolved questions
None for product design. User confirmed adaptive Hub navigator and all already-connected profiles. Future native/device/auth/crypto-fixture and WS retirement evidence remains required; see [final validation receipt](final-plan-validation.md).
