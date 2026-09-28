# Phase 01 — semantic contract and reducer

## Context links

- [Plan](./plan.md), [architecture](../../docs/architecture/agent-status.md), [review](./reports/report-review.md).
- Existing ownership: [system architecture](../../docs/system-architecture.md), `server/src/pty/activity.rs`, `packages/ui/src/api/ownership.ts`.
- Dependencies: none. This phase freezes contracts consumed by all later phases.

## Overview

Date: 2026-09-28. Priority: P2. Status: Complete. Completed: 2026-09-28. Implementation: complete. Review: reviewed (8.5/10).
Define one bounded state reducer and versioned wire contract, not a generic plugin platform. No screen detection or process-output inference.

## Key Insights

- Existing PTY/output/shell states have different meanings; preserve them.
- An idle snapshot cannot distinguish startup, reconnect, interruption or settled work.
- OMP `agent_end.willContinue` is explicit continuation evidence; keyed tool IDs permit idempotent blocker accounting.
- Server epoch, terminal incarnation and reporter epoch solve different replacement races; keep each boundary explicit.

## Requirements

- States `unknown | idle | working | blocked`; outcomes `ended | interrupted | error | unknown` only on explicit turn ends.
- State/turn/session identity and increasing reporter sequence; safe-integer bounds, strict validation, no raw agent content.
- Notifications require observed turn start + matching settled turn end, or explicit transition into approval/question/error blocking.
- Initial/reconnect snapshots, session changes, close/expiry/PTY exit never emit successful-looking completion.
- One active reporter; old connection close/timer/message cannot mutate new epoch. Duplicate same-sequence same-content report idempotent; conflicting duplicate rejected.
- Separate semantic availability from absent agent: ordinary shells have no semantic badge.

## Architecture

Implement pure reducer independent of socket/UI. Runtime supplies identity, monotonic time and events. Reducer emits changed snapshot and optional typed attention event. No timers/I/O inside reducer, no inference from output silence.

Canonical v1 schema, field limits, heartbeat semantics and event/state combinations are in the architecture doc. Keep checked-in Rust and TypeScript mirrors small; use shared behavior fixtures rather than code generation or publishing a new SDK package.

Transitions:
- Start => working/current turn; same active start is idempotent.
- Block/unblock => blocked/working according to outstanding blocker state.
- Explicit ended => idle + one turn-ended attention; interrupted => idle without normal finish; error => blocked/error attention; unknown => unknown without finish.
- Continuation/retry progress => working, no end.
- Session replace => clear turn and blocker history, snapshot only.
- Authority loss => unknown; terminal retirement removes row; no completion.

## Related code files

Create:
- `server/src/agent_status/mod.rs` — scoped module exports.
- `server/src/agent_status/types.rs` — private/public v1 DTOs and validated identities.
- `server/src/agent_status/reducer.rs` — pure transition logic.
- `server/src/agent_status/tests.rs` — deterministic reducer/identity tests.
- `packages/ui/src/api/agent-status-types.ts` — public decoder/types only.
Modify:
- `server/src/lib.rs` — module export.
- `packages/ui/src/api/client.ts` — agent kind includes OMP; keep existing kinds for existing consumers.
- `docs/architecture/agent-status.md` — refine only if implementation evidence changes contract; retain planned label until complete.
Delete: none. Do not refactor unrelated `agent_store`, telemetry or suspend models.

## Implementation Steps

1. Pin schema version, state/outcome/reason unions, opaque ID bounds and exact accepted event/state combinations.
2. Implement terminal-incarnation/reporter-epoch scoped reducer, monotonic snapshot and attention revisions, checked sequence limits.
3. Distinguish snapshot updates from live attention. Store bounded current state plus last attention metadata, not an unbounded event history.
4. Define public serializer to omit capabilities, internal connection handles, arbitrary text and session file paths.
5. Implement TypeScript decoding for same public contract; malformed/unknown schema cannot display idle or trigger notification.
6. Add focused tests for scenarios C01–C05, C09–C11 in the acceptance matrix. Test consumer-visible transitions/errors; no snapshots of source/wiring.

## Todo list

- [x] Freeze v1 private/public payloads and state semantics.
- [x] Implement pure reducer with stale identity/sequence fences.
- [x] Implement strict public decoder and OMP agent identity.
- [x] Cover valid transitions, duplicates, continuation, interruption and unknown outcomes.

## Success Criteria

- Same event sequence yields deterministic state/attention outputs under a fake clock.
- Duplicate/out-of-order/foreign-epoch events cannot regress state or duplicate attention.
- Initial idle, lost authority and unmatched end emit no normal completion.
- Schema supports another real agent producer later without OMP fields in the public state machine.

## Risk Assessment

Confusing transport reconnection with a new logical turn causes false alerts. Separate reporter epoch from agent session/turn IDs; reconstruct with silent snapshot after reconnect. Do not guess outcome from last screen text.

## Security Considerations

Strict bounded fields and closed reason codes. Unknown agent/protocol payloads fail closed. Semantic state is advisory UI data; never a permission or task-success claim.

## Next steps

Phase 02 owns runtime/PTY integration; phase 03 owns OMP event translation. Use this completed, frozen contract before either writes transport-specific code.
