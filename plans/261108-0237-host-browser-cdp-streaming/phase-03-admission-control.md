# Phase 03 — Authorize sessions attachments and ordered input

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `reports/backend-boundaries.md:7–25; reports/design-direction.md:29–37,49–52,61`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-08). Effort: not-estimated.
- Deliverable: Authorize sessions attachments and ordered input. Review completed in plans/reports/code-review-261108-2055-phase-03-authorization-input.md (Cycle 1) and plans/reports/code-review-261108-2117-phase-03-cycle-2.md (Cycle 2 - Approved; Score: 9.8/10; 86 tests passed [39 focused Phase 03 tests across 5 targets + 52 regression tests across 5 targets, 2 ignored]). Ready to proceed to Phase 04.

## Key insights
Existing /ws revalidates sessions every5s with2s DB timeout; Browser must additionally evaluate current enabled Admin role. Dev actor is User: exception is Browser-local and requires actual listener, peer and Origin checks.

## Requirements
Freeze REST identity/idempotency, live authorization, purpose-bound tickets, bounded control and cooperative lease. Never reuse fs media cookies or existing /ws writer. Define navigation/HTTP policy without claiming egress containment.

## Architecture
Core REST routes share Browser admission and principal manager. Tickets bind live auth session/version/deadline and exact target/viewer/incarnation; independent auth cancellation supervises every future socket. Input serializes against the owned target and geometry epoch.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — authorize-browser-sessions
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/auth.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/session.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/network_policy.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/mod.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_admission.rs` | Implement admin admission and idempotent target REST; exact responsibilities in numbered steps below. |

### File map — bind-browser-attachments
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/attachments.rs` | Implement purpose tickets and independent live-auth cancellation; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/auth.rs` | Implement purpose tickets and independent live-auth cancellation; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement purpose tickets and independent live-auth cancellation; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement purpose tickets and independent live-auth cancellation; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_auth.rs` | Implement purpose tickets and independent live-auth cancellation; exact responsibilities in numbered steps below. |

### File map — dispatch-leased-input
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/input.rs` | Implement bounded reliable input and authoritative viewport; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/session.rs` | Implement bounded reliable input and authoritative viewport; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement bounded reliable input and authoritative viewport; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement bounded reliable input and authoritative viewport; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_input.rs` | Implement bounded reliable input and authoritative viewport; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### authorize-browser-sessions
- Dependencies: integrate-host-lifetime.
- Bounded outcome: Implement admin admission and idempotent target REST.
1. Implement production live actor+enabled current Admin evaluation; Browser-only dev bypass requires state.no_auth, bound listener loopback, peer loopback and exact configured web Origin. Origin-less native requests only loopback in dev; forwarded headers never authority.
2. Expose exact capabilities/session/navigation/history/reload/viewport/lease/dialog routes in contract. Stable logical session UUID, incarnation and creation key are not URLs/native target IDs. Bound create records and reconcile ambiguous responses before retry; authenticated list/get never reveals another subject. Add only required `X-Browser-Lease` to existing explicit CORS header list for selected-text command; retain exact allowed origins/credentials and test approved-origin preflight, never wildcard CORS.
3. Apply URL and Fetch/Network HTTP request policy including redirects/subresources/popups: reject credentials and forbidden schemes; dev target+asset allowlists, production management/metadata/private deny with explicit project-origin exceptions. Deny file chooser/download/permissions by default with actionable events; raw CDP remains trusted bypass.
4. Track native target creation/destruction and navigationRevision independently of viewportEpoch. New popup becomes bounded server session; cap overflow closes newly created target and reports popupBlocked, never leaves invisible untracked targets.
- Consumer-visible acceptance:
  - Unauthenticated/ordinary/demoted users cannot create/list/get/control host targets; mixed Origin/listener/peer dev requests fail closed.
  - Lost create response retried with same key produces one target; same URL with different key intentionally creates another; popup overflow is visible.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_admission -- --nocapture`
  - `cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture`
  - Smoke: real admin creates frame-denying page; ordinary user and foreign principal receive denied/not-found; project asset redirects are checked.

### bind-browser-attachments
- Dependencies: authorize-browser-sessions.
- Bounded outcome: Implement purpose tickets and independent live-auth cancellation.
1. Mint256-bit random single-use tickets with30s expiry clipped by auth deadline; store only hashes and bound purpose, actor/session/version, profileEpoch, instance/incarnation, session, viewer and Origin. Atomic consume occurs before upgrade work; reject replay and purpose swaps.
2. Implement Browser auth supervisor with absolute auth deadline,5s persisted checks/2s timeout and current role; direct cancellation on failure/demotion/revoke/shutdown independent of writer enqueue or CloseAuth delivery.
3. Provide bounded writer/control admission primitives and session-scoped invalidation used by media/control/gateway. Targeted revoke closes only matching login attachments/tickets/held input, not sibling profile; reset cancels principal-wide.
4. Reserve media/control pair for exact same viewer/subscription with distinct tickets. Capture immutable subscription on media admission (never BHJF header); resume/rebind/reconnect opens fresh media socket+one-use ticket/new UUID and matching new control pair, no inherited credit/input sequence. ACK/discard must match originating admitted media socket subscription before any credit mutation. Tickets memory-only, fixed protocol alone echoed.
- Consumer-visible acceptance:
  - Ticket replay/wrong purpose/Origin/deadline/profile epoch or mismatched media/control pair fails; subscription is immutable per admitted media socket, resume/rebind requires fresh socket/ticket/pair, foreign/old-socket credit rejected; no secrets in URL/logs.
  - Role demotion, DB timeout and expiry cancel blocked sockets without waiting on outgoing media/control; sibling login remains attached after targeted revoke.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_auth -- --nocapture`
  - `cargo test --manifest-path server/Cargo.toml --test auth_device_sessions -- --nocapture`
  - Smoke: prove mismatched control/media pair and old-socket ACK rejection plus fresh socket/ticket on resume; block writer and revoke its login within5s+2s allowance, sibling target stays running.

### dispatch-leased-input
- Dependencies: bind-browser-attachments.
- Bounded outcome: Implement bounded reliable input and authoritative viewport.
1. Implement30s cooperative lease/5s renewal and holder-only viewport/DPR mutation. Every input binds session/incarnation/subscription/lease/profileEpoch/viewportEpoch plus strict contiguous decimal input sequence and original target capture.
2. Use cached qualified geometry; version update before resize/agent Emulation or zoom can accept input. Convert validated image fractions to CDP CSS coordinates per frozen mapping, not JPEG pixels/DPR twice; reject uncertain geometry with inputUnavailable.
3. Queue max128 reliable records/256KiB per holder; coalesce adjacent pointerMove/wheel only between ordering barriers. Never drop keyUp/buttonUp/text; on overflow/gap/cancel release all held state on original target and revoke lease.
4. Implement mouse/touch/pointer cancel, modifiers, composition commit Input.insertText without duplicate key events, bounded selected-text read and find commands. Blur/modal/privacy/auth/lease/disconnect cleanup is independently cancellable, not queued behind stalled image sends.
- Consumer-visible acceptance:
  - DPR/scroll/zoom clicks hit intended target; stale epoch/lease/sequence cannot inject input or release keys on replacement target.
  - Saturation and lost connection leave no stuck key/button; agent bypass is surfaced as warning rather than falsely constrained.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_input -- --nocapture`
  - Smoke: hold modifier+drag, saturate reliable queue then disconnect; verify original target receives releases and replacement target receives none.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "authorize-browser-sessions",
    "title": "Implement admin admission and idempotent target REST",
    "blocked_by": [
      "integrate-host-lifetime"
    ],
    "allowed_files": [
      "server/src/browser_host/auth.rs",
      "server/src/browser_host/session.rs",
      "server/src/browser_host/network_policy.rs",
      "server/src/browser_host/mod.rs",
      "server/src/api/browser_host.rs",
      "server/src/api/mod.rs",
      "server/src/api/router.rs",
      "server/tests/browser_host_admission.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Unauthenticated/ordinary/demoted users cannot create/list/get/control host targets; mixed Origin/listener/peer dev requests fail closed.",
      "Lost create response retried with same key produces one target; same URL with different key intentionally creates another; popup overflow is visible."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_admission -- --nocapture",
      "cargo test --manifest-path server/Cargo.toml --test auth_no_auth -- --nocapture",
      "Smoke: real admin creates frame-denying page; ordinary user and foreign principal receive denied/not-found; project asset redirects are checked."
    ]
  },
  {
    "id": "bind-browser-attachments",
    "title": "Implement purpose tickets and independent live-auth cancellation",
    "blocked_by": [
      "authorize-browser-sessions"
    ],
    "allowed_files": [
      "server/src/browser_host/attachments.rs",
      "server/src/browser_host/auth.rs",
      "server/src/browser_host/mod.rs",
      "server/src/api/browser_host.rs",
      "server/tests/browser_host_auth.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Ticket replay/wrong purpose/Origin/deadline/profile epoch or mismatched media/control pair fails; subscription is immutable per admitted media socket, resume/rebind requires fresh socket/ticket/pair, foreign/old-socket credit rejected; no secrets in URL/logs.",
      "Role demotion, DB timeout and expiry cancel blocked sockets without waiting on outgoing media/control; sibling login remains attached after targeted revoke."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_auth -- --nocapture",
      "cargo test --manifest-path server/Cargo.toml --test auth_device_sessions -- --nocapture",
      "Smoke: prove mismatched control/media pair and old-socket ACK rejection plus fresh socket/ticket on resume; block writer and revoke its login within5s+2s allowance, sibling target stays running."
    ]
  },
  {
    "id": "dispatch-leased-input",
    "title": "Implement bounded reliable input and authoritative viewport",
    "blocked_by": [
      "bind-browser-attachments"
    ],
    "allowed_files": [
      "server/src/browser_host/input.rs",
      "server/src/browser_host/session.rs",
      "server/src/browser_host/mod.rs",
      "server/src/api/browser_host.rs",
      "server/tests/browser_host_input.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "DPR/scroll/zoom clicks hit intended target; stale epoch/lease/sequence cannot inject input or release keys on replacement target.",
      "Saturation and lost connection leave no stuck key/button; agent bypass is surfaced as warning rather than falsely constrained."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_input -- --nocapture",
      "Smoke: hold modifier+drag, saturate reliable queue then disconnect; verify original target receives releases and replacement target receives none."
    ]
  }
]
```

- [x] <!-- evcrate-task:authorize-browser-sessions --> Implement admin admission and idempotent target REST
- [x] <!-- evcrate-task:bind-browser-attachments --> Implement purpose tickets and independent live-auth cancellation
- [x] <!-- evcrate-task:dispatch-leased-input --> Implement bounded reliable input and authoritative viewport

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Raw CDP and HTTP interception are not hostile-admin/network isolation. Policy errors fail closed; caps return typed busy without unbounded queue.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
Live auth checks use current account role, never cached UI role. Body/session IDs are fences not authority. Do not register terminal presence for Browser sockets.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
1. Cycle 2 remediation verified and signed off:
   - `network_policy.rs`: `localhost` and bracketed IPv6 `[::1]` denied in production mode unless explicitly allowed project origins.
   - `input.rs`: Added `drain_inputs` and `pop_next_input` to `SessionInputManager`; clipped `renew_lease` to `effective_deadline`.
   - `attachments.rs`: Preserved `auth_version`, `credential_version`, and `effective_deadline` on `ActiveAttachment`; added atomic `supervisor_started` guard; removed dead code `created_at`.
   - `session.rs`: Admission rejects rather than evicts when idempotency capacity is reached.
   - `api/browser_host.rs`: Removed input managers on session deletion and profile reset; invalidated cached selection on session navigation.
2. All Phase 03 integration and regression test suites passing (39 tests total).
3. Advance to Phase 04: Host Browser CDP multiplexing and frame transport gateway.
## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
