# Phase 03 — Session lifecycle

## Context links
- [Overview](./plan.md); [triage F10/F11/F13](../reports/review-261025-0731-pr74.md); [runtime review](../reports/code-reviewer-261025-0731-pr74-runtime.md); [backend execution](../reports/tester-261025-0731-pr74-backend.md).
- [Containment research, pinned-source caveats](../reports/researcher-261025-0731-pr74-containment.md); [architecture](../../docs/architecture/semantic-websocket-gateway.md); [documented upgrade deadline](../../docs/semantic-lsp-protocol-guide.md#handshake-requirements).
- Original phases 04/05/08 overlap actor/recovery/auth; no activation or edits to that plan.

## Overview
Date: 2026-10-25. Priority: P2. Status: pending, 0%. Owner: actor implementer for recovery/idle; upgrade implementer may work independently on disjoint paths; one integration coordinator.

## Key Insights
- F10: `do_did_open` initializes whenever `child_handle` is absent, including after budget exhaustion; retained actor overlays do not prove a replacement child received them.
- F11: Initialization replies bypass ordinary navigation-response cleanup, leaving empty sessions without the timer. Socket Ping is not document activity and can keep them occupying both slots.
- F13: Settings/live-watcher two-second bounds do not cover public pre-upgrade `evaluate_claims`. Timeout is an availability repair, not an auth bypass claim or guarantee of cancelled underlying blocking SQLite work.
- Test environment disambiguation (R3): `server/tests/fixtures/lsp-test-server.mjs` is an isolated Node mock server used in `server/tests/semantic_supervisor.rs`. Real-tuple replay and WebSocket ping capacity checks are assigned to dedicated regression test file `server/tests/semantic_lifecycle_replay.rs` using `PackagedToolchain` and real loopback WebSocket connections, ensuring disjoint file ownership from Phase 01/02 tests.

## Requirements
- F10: Preserve legitimate first lazy startup; every permitted replacement consumes existing budget/backoff and completes all accepted overlay replay before Ready. Exhaustion is terminal for that actor; `didOpen` must not revive it. Prove with both mock server and real-tuple replay.
- F11: Post-initialize/replay zero-document/zero-request state arms 60-second eviction; actual valid document/request activity cancels it. Expiry releases registry/tree capacity and reaps children. Prove supervisor capacity and reap under real loopback WebSocket Pings.
- F13: Bound the complete semantic-upgrade `evaluate_claims` future with `AUTH_STORE_LOOKUP_TIMEOUT`; expiration fails closed with HTTP 503 `AUTH_UNAVAILABLE` before presence reservation or child/session creation. Document that already-started SQLite blocking work may outlive future cancellation.
- Preserve two restarts per 300 seconds, revocation-first shutdown, existing portable controls and no forced daemon restart.

## Architecture
Keep recovery within the existing actor. Separate first-start eligibility from replacement recovery, rather than treating missing child as permission. Automatic crash handling owns replacement budget/backoff/launch/replay. `didOpen` with an already-used missing/crashed child returns existing not-ready/crashed behavior, not another launch. Exhausted actor stays terminal until a genuinely fresh supervisor session is admitted under ordinary capacity/auth rules; never reset counters from document traffic. Session exposure can use existing error/state mapping; no new transport error taxonomy required.

During a permitted restart, retain accepted overlay identities/versions and send each full `didOpen` to the new child in FIFO order before user work and Ready. Do not publish `successful_restarts`/Ready on handshake-only success. If any replay write fails, revoke/reap that replacement, settle pending work, remain non-ready and count the attempted restart; do not admit a partly reconstructed child. Retain actor serialization and cancellation checks; borrow existing overlay data where possible instead of cloning all texts into an intermediate replay vector when not required across awaits.

Call the existing idle predicate at successful initial initialization and after completed replay, plus existing close/request completion/cancellation boundaries. Arm only after a complete Ready transition; ensure commands arriving around a replay cancel/re-evaluate the timer correctly. Timer generation plus actor/session identity fences stale expiry; supervisor removal is the capacity authority, not just a timer event. Ping frames do not reset actor idle state. Include temp pins in eligibility if they can remain after work, rather than evicting active pin/requery work.

At `semantic_ws.rs`, wrap only the complete existing `evaluate_claims` operation with `tokio::time::timeout(AUTH_STORE_LOOKUP_TIMEOUT)`. Match timeout to the existing unavailable response shape, preserve authenticated/MFA/revoked decision branches and exact Origin/subprotocol/token policy. No new store abstraction, global middleware or longer timeout. Already-started SQLite blocking work may outlive future cancellation; document that limitation, not a claimed backend resource bound.

## Related code files
Paths rooted at `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration/`.
- Modify `server/src/semantic/session.rs`: first-start/restart/replay barrier and idle predicate transition points.
- Modify `server/src/semantic/supervisor.rs` only where terminal/idle actor removal must return capacity; reuse current registry/reaper flow.
- Modify `server/src/api/semantic_ws.rs`: bounded complete upgrade evaluation using existing constant/response convention.
- Extend `server/tests/semantic_supervisor.rs`, `server/tests/fixtures/lsp-test-server.mjs`, and `server/tests/semantic_ws_auth_containment.rs`.
- Create dedicated `server/tests/semantic_lifecycle_replay.rs` for real-tuple lifecycle replay and WebSocket ping capacity checks.

## Implementation Steps
### enforce-budgeted-child-replay — F10
1. Distinguish unused initial session from crashed/exhausted session in existing state/child ownership. Remove the `do_did_open` replacement bypass; keep first lazy initialization.
2. Consolidate permitted replacement launch and full replay into the existing recovery path. Publish Ready only after complete successful replay; handle send failure/revocation with teardown and settled work.
3. In `server/tests/semantic_supervisor.rs` using `lsp-test-server.mjs`: exercise crash handling, budget exhaustion, and rejection of `didOpen` revival.
4. In `server/tests/semantic_lifecycle_replay.rs` using `PackagedToolchain` real tuple: open dirty A differing from disk, crash recorded child group, verify automatic replacement sees A before navigation. Consume two allowed restarts, crash next child, then open B without editing A. Exhausted actor must reject B; fresh session replays A+B.
### evict-initialized-empty-sessions — F11
5. Evaluate idle after first successful initialize and completed replay; cancel/rearm under valid activity and token identity. Preserve cancellation-first session teardown.
6. Deterministic timer tests in `semantic_supervisor.rs`: cover empty initialize, activity just before expiry, `didClose`-to-empty, request cancellation/completion, replay-to-empty and old timer after replacement.
7. Real loopback WebSocket fixture in `semantic_lifecycle_replay.rs`: initialize two distinct semantic identities, no `didOpen`, send Ping every 20 seconds, wait beyond 60 seconds (bounded scheduler tolerance); assert both supervisor registry/tree slots reclaimed and third initialization succeeds. Pings must not substitute for document activity. Reap recorded PGIDs and verify zero fixture descendants.
### bound-semantic-upgrade-auth — F13
8. Wrap full claims evaluation in existing two-second timeout `AUTH_STORE_LOOKUP_TIMEOUT` and fail closed before presence reservation, matching settings route's unavailable shape; retain invalid-credential and normal admission controls.
9. Extend existing disposable Mongo stall-proxy pattern in `semantic_ws_auth_containment.rs`: obtain valid fixture token, stall only fixture DB replies, attempt new semantic upgrade with required subprotocol/origin policy and three-second external deadline. Assert 503 `AUTH_UNAVAILABLE` near two seconds, no presence/session/tree allocation; release stall and terminate fixture resources.
10. Verify normal credential success, store error, expiry/MFA/revocation and malformed token retain expected rejection codes; document SQLite blocking cancellation limitations.

## Todo list
```evcrate-tasks
[
  {
    "id": "enforce-budgeted-child-replay",
    "title": "Prevent exhausted revival and complete budgeted overlay replay (F10)",
    "blocked_by": [
      "record-remediation-architecture"
    ],
    "allowed_files": [
      "server/src/semantic/session.rs",
      "server/src/semantic/supervisor.rs",
      "server/tests/semantic_supervisor.rs",
      "server/tests/fixtures/lsp-test-server.mjs",
      "server/tests/semantic_lifecycle_replay.rs"
    ],
    "constraints": [
      "Preserve initial lazy start and existing two-per-300-second budget/backoff; same exhausted actor cannot launch from didOpen.",
      "No Ready or successful restart before full replay; replay failure/revocation reaps replacement and settles pending work.",
      "Disambiguate test environments: lsp-test-server.mjs mock for unit supervisor tests, semantic_lifecycle_replay.rs for real-tuple PackagedToolchain replay."
    ],
    "acceptance": [
      "Permitted real-child replacement receives full dirty A before later work; navigation sees A's unsaved marker, not disk.",
      "After exhausted budget, didOpen B causes no new child; partial replay failure never exposes Ready and leaves no fixture descendants.",
      "Mock server and real-tuple replay tests both pass deterministically."
    ],
    "verification": [
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_supervisor using disposable disk-backed TMPDIR; record actual child IDs, replay observations, counters and cleanup.",
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_lifecycle_replay test_real_tuple_budgeted_replay.",
      "Retain initial failures/retries; actor overlay count alone is not proof of replacement-child replay."
    ]
  },
  {
    "id": "evict-initialized-empty-sessions",
    "title": "Reclaim empty initialized session capacity on idle deadline (F11)",
    "blocked_by": [
      "enforce-budgeted-child-replay"
    ],
    "allowed_files": [
      "server/src/semantic/session.rs",
      "server/src/semantic/supervisor.rs",
      "server/tests/semantic_supervisor.rs",
      "server/tests/semantic_lifecycle_replay.rs"
    ],
    "constraints": [
      "Use existing 60-second timer and generation fencing; valid document/request activity cancels it, socket Ping does not.",
      "Prove supervisor capacity and reap, not merely timer creation or actor state.",
      "Exercise real loopback WebSocket connections with regular Pings in semantic_lifecycle_replay.rs."
    ],
    "acceptance": [
      "Two Ping-kept initialized empty sessions are evicted after the existing idle deadline and a third session initializes.",
      "Active document/request and stale timer controls cannot evict current work; fixture child groups are fully reaped."
    ],
    "verification": [
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_supervisor, including deterministic timer tests.",
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_lifecycle_replay test_empty_session_ping_eviction; record elapsed time/tolerance, registry count, third-admission result and fixture descendant cleanup."
    ]
  },
  {
    "id": "bound-semantic-upgrade-auth",
    "title": "Bound complete pre-upgrade claims evaluation (F13)",
    "blocked_by": [
      "record-remediation-architecture"
    ],
    "allowed_files": [
      "server/src/api/semantic_ws.rs",
      "server/tests/semantic_ws_auth_containment.rs"
    ],
    "constraints": [
      "Reuse AUTH_STORE_LOOKUP_TIMEOUT and existing 503 AUTH_UNAVAILABLE; no auth policy/global middleware changes.",
      "Stall only disposable test backend and never claim cancellation of already-started blocking store work."
    ],
    "acceptance": [
      "Stalled complete claims evaluation returns 503 AUTH_UNAVAILABLE around two seconds and before three-second client deadline, with no presence/session/child admission.",
      "Normal admission and Origin/subprotocol/invalid-token/MFA/revocation decision behavior remains unchanged."
    ],
    "verification": [
      "Run cargo test --manifest-path server/Cargo.toml --test semantic_ws_auth_containment with its existing isolated backend prerequisites; record exact pass/fail/skip and elapsed response.",
      "If fixture backend unavailable, report that unexercised gate rather than treating static timeout inspection as runtime qualification."
    ]
  }
]
```
- [ ] <!-- evcrate-task:enforce-budgeted-child-replay --> Enforce budgeted complete child replay.
- [ ] <!-- evcrate-task:evict-initialized-empty-sessions --> Evict initialized empty sessions.
- [ ] <!-- evcrate-task:bound-semantic-upgrade-auth --> Bound upgrade authentication.

## Success Criteria
Task commands are planned only; no runs by this author. Require actual replacement-child contents, elapsed idle capacity release under Ping, and delayed-upgrade HTTP response evidence. Existing restart-count and watcher tests alone are insufficient. Final integration runs scoped Rust compile once and repeats real Linux-server/web reconnect without losing dirty state; supplemental parent evidence may strengthen triage but cannot prove an unimplemented fix.

## Risk Assessment
Replay may await backpressured stdin; retain current finite startup/write/reap bounds and cancellation checks. Arming idle too early can race initialization/replay; arm only complete Ready with no documents/requests/pins and use identity-fenced cleanup. Never relax restart limits to make tests pass. Rollback via OFF/prior release, not bypassing crash budget or reconstructing server sessions after failed OFF.

## Security Considerations
Kill only recorded fixture-owned child groups; no host-wide process matching. Preserve secret-free child environment and trusted-workspace assumptions; PG/cgroup controls are not a filesystem sandbox. Timeout repairs availability, not RBAC; no new credentials/logging/content persistence.

## Next steps
Phase 04 integrated acceptance depends on all three tasks and Phase 01 socket recovery. Parent retains supplemental runtime-result synthesis and any plan review/interview.

## Unresolved questions
No design interview required: this proposal selects terminal exhausted actors and the existing 60-second empty-session deadline. Supplemental actor evidence is collected; future fixed-behavior acceptance and fixture Mongo availability remain pending gates, not assumed passes.
