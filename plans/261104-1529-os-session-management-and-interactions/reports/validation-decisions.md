# Final validation interview — accepted revisions

Planning only. Native plan/parallel invocation owns this interview; no take caller. After independent initial plan review, user opted into optional validation. Three material engineering questions asked; user requested explanations for two, then answered both clarified questions. These are three decision topics, not five independent decisions.

## Confirmed choices

- V1: **Wait for all parallel branches.** Preserve conservative G1 barrier before P04 session UI and single P07 integration owner.
- V2: **Cancel captured pending restart.** End must atomically cancel exact pending-restart/backoff identity, not merely reject because old process exited. A newer already-admitted replacement remains protected; refusal never targets it. Close view remains non-destructive. This supersedes draft live-only/backoff refusal.
- V3: **Add exact decimal-string field.** Preserve existing numeric incarnation and array compatibility for unrelated clients, but add canonical `incarnationExact` inventory identity. Safe web consumes exact original response string; do not disable valid End merely because legacy number is unsafe. Malformed/missing exact identity is fail-closed; never bless rounded downstream agent/review/replay identity.

## Revision design constraints after source/Advisor screening

Source read: `server/src/pty/fleet_state.rs:111-125,304-307`; `server/src/pty/manager.rs:827-845,3218-3291,3574-3577,4302-4348,4355-4387,4554-4608`. Existing exact tombstone and fleet pending/creating identities support a narrow guarded cancellation without new scheduler/runtime. Review entire participating functions before later implementation.

1. Original same-response inventory capability+manager epoch remains. API-only additive row `incarnationExact` and flat `terminationState` derive from the same inner snapshot; preserve numeric field and array/detailed compatibility. State explicitly distinguishes live, terminationRequested, restartPending, restartCancelled, observed exited, unavailable as applicable. No persisted DTO authority.
2. Guarded POST live -> 202 `terminationRequested`; exact dead+pending -> 200 `restartCancelled`, preserve tombstone/history, no signal. Pending replacement takes precedence and refuses with zero effect. Canonical string identity in all responses.
3. Cancellation atomically disables that source restart, exact-cancels fleet pending, records completion for retained tombstone lifetime; no raw-ID killed marker that can suppress later explicit create. Queued/timer wakeups must revalidate admission and become no-op after cancellation.
4. Split admission predicate (exact source + restart enabled + matching fleet pending, no replacement) from publication predicate (exact source+reservation+creating and lifecycle). Publication must not require a pre-reservation pending entry. Preserve lock order/no await under sync locks. Cancellation-before-reservation wins; reservation-before-cancellation refuses. No cancellation of admitted spawn promised.
5. Restart-pending `alive:false` is not session ended. It receives Close/End/Cancel policy. 200 exact cancellation or later exact `restartCancelled` observation resolves cancellation; mere exited state/absence cannot resolve lost cancellation response. Live 202 still needs exact observed process exit. Distinguish operation origin in state machine.
6. Exact inventory does not repair numeric agent/Review/replay fields. Join only when equality is losslessly proven; unsafe downstream numeric proof means unavailable rather than coercion/rebinding. No broad protocol rewrites.
7. Deterministic checks: both cancellation/reservation orderings, stale queued wakeup, same-ID create after cancellation, successful normal respawn publication, response loss; max-u64/malformed/exact-vs-safe-number disagreement/unsafe legacy numbers. Real PTY/full app gates remain future.

## Independent review triage

Initial review `reports/independent-plan-review.md` COMPLETE, one medium M1 capture retention mismatch. Accepted and coordinator-corrected; [targeted follow-up](targeted-plan-followup.md) subsequently confirmed M1 resolved at design level. P08 retains 64 distinct state/size/zoom checkpoints plus four primary images, one publishing session and complete manifest per case; historical artifacts/helper unchanged. Targeted follow-up found medium M2 pre-reservation validation-failure fencing omission; coordinator verified source and incorporated its exact guard and deterministic regression into C2/P02/P08/acceptance/ownership. M2 correction not independently reapproved. See [final disposition](planning-validation.md).

Validation complete: V1–V3 propagated into all affected contracts/phases/tasks/acceptance/docs instructions. One initial and one targeted review complete; M1/M2 dispositioned. No additional product question established; M2 correction preserves accepted choices. Future runtime/human gates and all implementation tasks remain pending. No implementation authorization.
