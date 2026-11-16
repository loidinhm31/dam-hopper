# Phase 04 — Expose authenticated instance-scoped raw CDP

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `research/stream-protocol.md:88–100; reports/design-direction.md:34–37`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-09). Effort: not-estimated.
- Deliverable: Expose authenticated instance-scoped raw CDP. Marked DONE per user approval with noted issues after Cycle 3 (2026-11-09; score 7/10; 57/57 tests and validation gates passing across 5 targets: `browser_host_gateway` [14/14], regressions [33/33 across `lifecycle` 10/10, `shutdown` 3/3, `admission` 7/7, `auth` 6/6, `input` 7/7], `browser_host_qualification` check, TypeScript E2E typecheck clean with 0 errors, and Playwright agent qualification suite `agent.spec.ts` [8/8]). Ready to proceed to Phase 05; Phase 05 unblocked.

## Key insights
Existing Playwright connectOverCDP with Authorization header is the interoperability baseline. Raw browser-level CDP deliberately exposes all owned targets and host file/network privileges, not a target sandbox.

## Requirements
Authenticated discovery rewriting and dedicated upstream per agent; bounded relay; live role/session revoke; no raw endpoint leakage, no new agent tool or runtime Node sidecar.

## Architecture
GET discovery authenticates against principal instance. WS gateway is separate from internal producer actor and media/control, preserving native CDP wire messages within hard limits.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — serve-agent-cdp
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/cdp_gateway.rs` | Implement authenticated discovery and bounded upstream relay; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement authenticated discovery and bounded upstream relay; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement authenticated discovery and bounded upstream relay; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` | Implement authenticated discovery and bounded upstream relay; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_gateway.rs` | Implement authenticated discovery and bounded upstream relay; exact responsibilities in numbered steps below. |

### File map — qualify-agent-interoperability
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-host-browser/agent.spec.ts` | Prove Playwright same-target and revocation isolation; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_gateway.rs` | Prove Playwright same-target and revocation isolation; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/fixtures/browser-host-qualification.ts` | Select actual-gateway mode using inherited absolute-root compiler-artifact/prebuild/readiness/cleanup interface. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/examples/browser_host_qualification.rs` | Add production-gateway qualification mode mounting actual router/auth/manager/gateway, without later producer or SPA. |

## Numbered implementation steps

### serve-agent-cdp
- Dependencies: dispatch-leased-input.
- Bounded outcome: Implement authenticated discovery and bounded upstream relay.
1. Implement /api/browser/cdp/json/version, /json/list and /ws using bearer-header baseline; rewrite every websocketDebuggerUrl to configured server gateway, never Chromium loopback endpoint. All Origin-bearing discovery and WS requests require exact approved Origin; Origin-less permitted ONLY with Authorization-header authenticated clients, not capability-only upgrades.
2. Bind relay to entire authenticated owned incarnation. Dedicated upstream browser WS per agent; bounded message/queue/write time and independent auth cancellation; do not multiplex into internal actor or claim Target.* filtering isolation.
3. Offer agentCdp one-use subprotocol capability only if a concrete existing client requires it; mandatory header path must work without optional capability. No query capability unless selected existing client proves necessity and explicit redaction review; default none.
4. Expose agent attached/lease-bypass warning and register target changes with manager. Enforce2 agent connections globally by default; busy rejects immediately.
- Consumer-visible acceptance:
  - Discovery/WS deny unauthenticated, ordinary and foreign principals; all Origin-bearing discovery AND upgrades require exact approved Origin, and Origin-less requests require bearer-header authentication.
  - Agent native CDP commands reach its owned instance, not a global active target; blocked relay is bounded and cancellable.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
  - Smoke: bearer-authenticated json/version,json/list and returned WS mutate same target; repeat discovery AND upgrade with wrong Origin and Origin-less capability-only, requiring denial.

### qualify-agent-interoperability
- Dependencies: serve-agent-cdp.
- Bounded outcome: Prove Playwright same-target and revocation isolation.
1. Exercise Playwright connectOverCDP(server/api/browser/cdp,{headers:{Authorization}}), proving bearer header on BOTH discovery and WS upgrade. Enumerate native targets/select via admin-only correlation, never separate automation browser. Test wrong-Origin discovery and upgrade fail even with valid bearer; Origin-less capability-only denied.
2. Extend owned real qualification example/helper with production-gateway mode mounting actual production router/auth/manager/CDP gateway, provision synthetic live logins and native engine. Reuse separate Cargo-artifact prebuild deadline, root-derived cwd,20s readiness AFTER binary spawn and bounded startup-failure cleanup from phase01. agent.spec runs this mode without producer/media/UI/human. Playwright mutates exact correlated DOM/title while a separate production-actor native Page session starts screencast with prompt ACK; agent Page.disable/stopScreencast cannot disable independent native session. Native Emulation/zoom mutation checks manager epoch/input fencing via real API. Mandatory human+production stream/same-target interference is phase09, never an early pass condition.
3. Revoke one agent login, demote role, expire ticket and congest relay; show only affected attachments close and sibling login/profile storage persist. Record raw CDP bypass/file/network warning in consumer-visible UI/API documentation contract.
- Consumer-visible acceptance:
  - Actual production gateway qualification mode (no producer/UI/human) proves Playwright target DOM roundtrip, headers BOTH paths, exact Origin and independent native CDP Page-session survival after agent disable/stop; full production-stream/human evidence remains mandatory phase09.
  - Gateway cannot discover another principal; demotion cancels agent connection while cooperative lease is documented as bypassable.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/agent.spec.ts`
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture`
  - Smoke: agent.spec launches owned actual-gateway mode via compiler-artifact executable; native independent session survives agent disable/stop, revoke one login and observe sibling native command/frame roundtrip; no later producer/SPA/human dependency.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "serve-agent-cdp",
    "title": "Implement authenticated discovery and bounded upstream relay",
    "blocked_by": [
      "dispatch-leased-input"
    ],
    "allowed_files": [
      "server/src/browser_host/cdp_gateway.rs",
      "server/src/browser_host/mod.rs",
      "server/src/api/browser_host.rs",
      "server/src/api/router.rs",
      "server/tests/browser_host_gateway.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Discovery/WS deny unauthenticated, ordinary and foreign principals; all Origin-bearing discovery AND upgrades require exact approved Origin, and Origin-less requests require bearer-header authentication.",
      "Agent native CDP commands reach its owned instance, not a global active target; blocked relay is bounded and cancellable."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture",
      "Smoke: bearer-authenticated json/version,json/list and returned WS mutate same target; repeat discovery AND upgrade with wrong Origin and Origin-less capability-only, requiring denial."
    ]
  },
  {
    "id": "qualify-agent-interoperability",
    "title": "Prove Playwright same-target and revocation isolation",
    "blocked_by": [
      "serve-agent-cdp"
    ],
    "allowed_files": [
      "packages/ui/e2e/os-host-browser/agent.spec.ts",
      "server/examples/browser_host_qualification.rs",
      "packages/ui/e2e/fixtures/browser-host-qualification.ts",
      "server/tests/browser_host_gateway.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Actual production gateway qualification mode (no producer/UI/human) proves Playwright target DOM roundtrip, headers BOTH paths, exact Origin and independent native CDP Page-session survival after agent disable/stop; full production-stream/human evidence remains mandatory phase09.",
      "Gateway cannot discover another principal; demotion cancels agent connection while cooperative lease is documented as bypassable."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/agent.spec.ts",
      "cargo test --manifest-path server/Cargo.toml --test browser_host_gateway -- --nocapture",
      "Smoke: agent.spec launches owned actual-gateway mode via compiler-artifact executable; native independent session survives agent disable/stop, revoke one login and observe sibling native command/frame roundtrip; no later producer/SPA/human dependency."
    ]
  }
]
```

- [x] <!-- evcrate-task:serve-agent-cdp --> Implement authenticated discovery and bounded upstream relay
- [x] <!-- evcrate-task:qualify-agent-interoperability --> Prove Playwright same-target and revocation isolation

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Browser CDP compatibility differs from ordinary page WS. Unsupported header/discovery behavior blocks, never falls back to unauthenticated local endpoint.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
Treat capability as instance administrator authority. Loopback reachable by local processes/users is explicitly not isolated; no managed-profile-hostile tenant claim.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase 04 is DONE (2026-11-09). Phase 05 is unblocked. Phase 05 may edit shared module/router files after qualify-agent-interoperability; phase 06 remains independently eligible after phase 03 using its own isolated component/input harness (no writes to this fixture). Later phase 09 full-stream/human failures reopen the originating phase 04 task and affected dependents.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.

## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
