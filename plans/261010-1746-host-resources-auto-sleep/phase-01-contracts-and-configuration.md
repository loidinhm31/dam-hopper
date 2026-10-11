# Phase 01 — Contracts, configuration and admission interfaces

## Context links
- [Overview](plan.md), [frozen contract](contracts.md), [acceptance matrix](acceptance-matrix.md).
- Repository: `docs/api/idle-suspend.md`, `docs/terminal-idle-suspend-security.md`, `docs/code-standards.md`.
- Dependencies: none. Phase 02 and Phase 03 may proceed independently after interfaces freeze.

## Overview
- Date: 2026-10-10. Priority: P2. Estimated effort: 6h.
- Implementation status: complete. Review status: complete.
- Freeze new semantic policy, DTOs, consent rules and lock/ownership contracts before coding consumers.

## Key insights
- Current default is `empty-fleet`, disabled, quiet 900s, wake 600s (`server/src/config/schema.rs`). Startup owns policy; only timing pair is mutable.
- Current coordinator has one 32-message command channel and existing manual/automatic handoff. Reuse it; no parallel sleep service.
- Public snapshots/revisions alone do not prove current semantic authority. Native hooks expire after 15s; eligibility needs private evidence fences.
- Current status decoder uses closed enums. A new policy needs coordinated server/UI release, not a false old-policy projection.

## Requirements
- Add opt-in `agent-free`; Idle+Blocked free, Working/Unknown block; strictly >10800s.
- Scope is all DamHopper-managed terminals/retained managed lineage; independent external agents deliberately do not block machine sleep.
- Fixed three-hour quiet duration in new mode, existing wake pair and manual force behavior preserved.
- Configuration reload/import/workspace changes preserve startup enablement/policy/executable scope.
- Fail-closed fallback before coordinator/inventory/presence initialization; unknown counts are null.
- No global secret or user content in contracts; finite memory and monotonic timing.

## Architecture
- Extend existing policy enum and `StartupIdleSuspendPolicy`.
- Proposed private interfaces: `AgentFreeObservation`, opaque `AgentFreeClaimTicket`, process-owner evidence access, `ClientPresenceSnapshot`/guard and coordinator consent command.
- New status information lives in `agentFree`, `clientPresence` and `consent`; keep top-level coordinator state enum and current routes. `activity` stays exclusive to legacy `agent-activity`.
- Define request/lifecycle revision separately from semantic, inventory, presence and timing generations. Heartbeat refresh must not reset free epoch or invalidate otherwise-current consent.
- Resolve canonical admission lock order by auditing all manager/runtime/credential/report/socket mutation callers. Publish one order; no inverse acquisition, I/O or awaits under synchronous locks. Do not claim an independent revision read closes a TOCTOU race.

## Related code files
All modification paths below are rooted in the new worktree; no files deleted in this phase.

| Action | Full path | Change |
|---|---|---|
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/config/schema.rs` | Policy enum, fixed-duration validation and config serialization |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/policy.rs` | Startup-owned semantic policy and timing validation |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/status.rs` | Aggregate semantic/presence/consent DTOs and fallback |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/protocol.rs` | Strict consent request/response and closed errors |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/event.rs` | New policy/reason/event variants without sensitive payloads |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/api/config.rs` | Preserve startup policy and reject full-config mutation |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/server/src/idle_suspend/timing_store.rs` | Persist only legal timing pair; unrelated TOML preserved |
| Modify | `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep/packages/ui/src/api/client.ts` | Types and strict boundary decoder; final consumer integration Phase 05 |

## Implementation steps
1. Read current config write/read validation and timing API transaction. Before exported symbol edits, use available LSP references; enumerate every exhaustive policy match, constructor, decoder, fixture, settings export and event schema consumer.
2. Implement `AgentFree` serialization as TOML `agent-free` / JSON `agentFree` field container with `automaticPolicy: "agent-free"`. Keep key casing conventions and startup ownership.
3. Require 10800 quiet seconds in new mode at startup and dedicated timing admission. Reject invalid values before persistence or memory change; do not silently alter legacy defaults or overwrite saved wake duration.
4. Freeze DTO fields, closed phase/reason/error enums, nullable counts and consistency rules from `contracts.md`. Represent disabled/unavailable startup truthfully.
5. Freeze first-valid-server-decision wins, immediate approval final checks, recommended 60s unanswered-only timeout, refusal/last-client-disconnect defer and full three-hour reset. Later contrary answers return decisionAlreadySettled; safety invalidation remains independent of answer arbitration.
6. Define content-free connection identity and strict consent decision contract; actor/session derived from authenticated server state. Specify which AuthService epoch/revocation signal can be checked at final admission.
7. Review existing lock acquisition graph and choose shared final gate implementation. Include same-state lease refresh, brief Working→Idle transitions, pending upgrade and claim→dispatch transitions in the contract. Complete this before concurrency code.
8. Add observable config/decoder boundary tests only: legal new mode, non-10800 rejection with zero mutation, partial malformed DTO, null-vs-zero, policy/field mismatch, reload preservation, old-policy behavior unchanged.
9. Update API/config/security design docs as proposed until code lands; remove the proposed marker only after implementation qualification.

## Todo list
- [x] Freeze policy and timing validation.
- [x] Inventory all exported callsites and exhaustive matches.
- [x] Freeze DTO/error/nullability contracts.
- [x] Freeze consent and auth/session bindings.
- [x] Review shared admission lock order.
- [x] Add behavior-boundary coverage and docs.

## Success criteria
- Config selects new mode explicitly with 10800 quiet and preserved wake; wrong quiet value fails without mutation.
- Existing modes/defaults and manual endpoint semantics unaffected.
- Every implementer has one contract for timer/consent ownership, revisions and final linearization.
- Schema fixtures can represent disabled, unknown, tracking, pending, approved, deferred and handed-off states; malformed states fail closed.

## Risk Assessment
- Closed enum rollout: upgrade UI and server together before opt-in; old clients count as connected but cannot silently approve.
- Lock inversion: reject implementation until manager/runtime/socket lock graph and guard lifetime are reviewed.
- Config 900s default conflicts with new mode: explicit operator migration, descriptive startup error; no hidden timer fallback.

## Security Considerations
- Reuse cookie Origin/Bearer guards, current enabled-account authorization and existing capability bounds.
- Profile/generation are local selectors, not server identity. No body-supplied actor or global server signing secret.

## Next steps
- Phase 01 contracts, configuration, DTOs, and admission interfaces verified and frozen. Phase 02 (Managed agent inventory and semantic authority) and Phase 03 (WebSocket presence and session binding) may proceed independently.

## Unresolved questions
- Auth/session in-memory revocation fence and canonical lock implementation are source-review gates, not user-policy questions.
