# Phase 01: Remove Issuance Capacity Gates

## Context Links

- [Plan overview](./plan.md)
- [`media_ticket.rs`](../../server/src/fs/media_ticket.rs)
- [`api/tests.rs`](../../server/src/api/tests.rs)
- [`system-architecture.md`](../../docs/system-architecture.md)

## Overview

- **Date:** 2026-08-15
- **Priority:** P1
- **Status:** Complete
- **Effort:** 2h
- **Goal:** make all ticket issuance paths count-independent without weakening ticket validation or lifecycle security.

## Key Insights

- Capacity rejection exists in bound and non-bound issuance paths near the store mutations; a shared admission helper centralizes some checks.
- API tests currently encode capacity-derived `429`, `Retry-After`, and capacity error behavior.
- Architecture docs state a 256-ticket cap and shared image/video capacity, so those exact claims become stale.
- The target file already has unrelated in-progress cap-value edits. Implementation must use a minimal diff and never revert them wholesale.
- Directly deleting admission gates is simpler and less error-prone than replacing limits with sentinel values or very large constants.

## Requirements

### Functional

1. Non-bound issuance succeeds regardless of total live ticket count.
2. Bound issuance succeeds regardless of global, actor, session-ticket, or session count.
3. Expired entry cleanup remains available and must not reject valid issuance.
4. Ticket consumption/revocation, actor/session checks, idle/absolute expiry, workspace generation invalidation, and collision retry rules remain unchanged.
5. Tests prove issuance beyond former thresholds succeeds for both issuance modes.

### Non-functional

- Preserve existing lock discipline and atomic store mutation behavior.
- Avoid new configuration, storage types, dependencies, background work, or abstractions.
- Keep changes localized and compatible with unrelated dirty edits.

## Architecture

Issuance continues to lock the in-memory store, prune expired state as currently required, generate a random ticket with bounded collision retries, and insert ticket/session metadata. The only removed decision is count-based admission. Streaming and revocation paths are unchanged.

Recommended approach: remove calls/branches/constants/helpers used exclusively for capacity admission, then replace cap-rejection tests with above-former-cap success tests. Rejected alternative: set caps to `usize::MAX` or inflate constants; this retains misleading dead policy and can preserve overflow/error paths.

## Related Code Files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/fs/media_ticket.rs` — remove issuance capacity gates and update colocated unit tests; preserve unrelated dirty changes.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` — replace capacity/429 assertions affected by the behavior change; retain unrelated API error coverage.
- **Modify if exact claims are stale:** `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — remove ticket/session cap and capacity-rejection claims; preserve TTL/security descriptions.
- **Create:** none.
- **Delete:** none; remove obsolete individual test cases/functions in place.

## Implementation Steps

1. Capture `git diff -- server/src/fs/media_ticket.rs server/src/api/tests.rs docs/system-architecture.md`; identify user-owned edits before patching.
2. Trace all count-based issuance checks in both non-bound and bound paths, including shared admission helpers and cap constants.
3. Remove only global/per-actor/per-session ticket and session-count admission decisions. Retain expiry pruning and lifecycle cleanup even if formerly called before admission.
4. Remove private constants/helpers/imports that become unused solely because admission is gone. Keep public/defensive capacity error variants and API mappings inert unless the compiler or an explicit compatibility contract requires change.
5. Replace unit tests expecting capacity errors with regression tests that preload counts beyond each former boundary and assert issuance succeeds. Cover non-bound, actor-bound, session-bound, and new-session issuance.
6. Update API tests that expect `429`, `Retry-After`, or capacity codes so they verify successful issuance past former limits. Do not weaken auth/session tests.
7. Correct exact cap statements in architecture docs. Do not rewrite unrelated media-ticket documentation.
8. Review the final diff for accidental cap-value reversions or changes to TTL, validation, revocation, generation, cookie, authorization, or collision logic.
9. Format touched Rust and run focused validation; expand only when failures or shared API impact justify it.

## Todo List

- [x] Preserve unrelated dirty edits with a before/after scoped diff.
- [x] Remove every issuance count gate for tickets and sessions.
- [x] Retain cleanup, expiry, binding, authorization, generation, and collision safeguards.
- [x] Replace obsolete unit capacity failures with unthrottled success regressions.
- [x] Align affected API tests and exact architecture claims.
- [x] Run formatting and focused tests.
- [x] Review final diff for side effects and stale cap references.

## Completion Evidence

- `cargo fmt --check` passed.
- Focused media-ticket tests passed.
- Image and video API threshold tests passed beyond former ticket/session thresholds.
- Final review: 9.5/10, no critical findings; approved by user.

## Success Criteria

- Bound and non-bound issuance succeeds above every former stored-count threshold.
- No issuance path returns a capacity-derived error based on ticket/session counts.
- Consume-once, session/actor binding, auth, revocation, expiry, generation invalidation, and collision tests continue to pass unchanged or equivalently.
- `cargo fmt --check` passes after formatting touched Rust.
- Focused media-ticket tests pass, followed by affected API tests; run broader `pnpm test` only if targeted coverage is insufficient or failures indicate wider impact.
- Final scoped diff contains no unrelated user-edit reversions.

## Risk Assessment

- **Memory growth:** ticket/session count is no longer capped. Mitigate by preserving TTL pruning, revocation, workspace invalidation, and existing cleanup cadence; explicitly document the behavior.
- **Partial removal:** one hidden actor/session helper could continue throttling. Mitigate with call-site search and threshold-crossing tests for every issuance mode.
- **Security regression:** over-broad helper deletion could remove lifecycle checks. Mitigate with narrow edits plus existing security regression tests.
- **Dirty worktree conflict:** constants may have user modifications. Mitigate with scoped diff inspection and no wholesale file replacement.
- **Contract drift:** stale `429` and cap claims may mislead clients. Mitigate by updating only direct tests/docs claims while leaving defensive mappings compatible.

## Security Considerations

- Authentication and permission middleware remain unchanged.
- Ticket IDs remain opaque and randomly generated; bounded collision retry/failure stays intact.
- Actor/session binding, consume-once behavior, revocation, generation invalidation, file revalidation, and indistinguishable unauthorized stream responses remain intact.
- No database, secrets, logging, cookie, CORS, TTL, or deployment changes.
- Removal of abuse throttling is intentional; resulting resource-exhaustion exposure is accepted within current expiry/cleanup semantics.

## Next Steps

Complete. No follow-up implementation work is required for this plan.

## Unresolved Questions

None.
