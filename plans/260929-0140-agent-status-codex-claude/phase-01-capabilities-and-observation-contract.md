# Phase 01 — Capabilities and observation contract

## Context links
[Plan](./plan.md) · [Design contract](./design-contract.md) · [Codex evidence](./research/codex-report.md) · [Claude evidence](./research/claude-report.md)

## Overview
Date: 2026-09-29. Priority P1 prerequisite. Estimate 6h. Status: DONE — 100% of approved contract-only scope, completed 2026-09-29 (Asia/Saigon); review approved (8/10, advisor no must-fix).
Define honest native-hook coverage and exact-version gates before expanding public agent enums.

## Key Insights
- Herdr screen classification is not evidence native hooks provide full lifecycle authority.
- Codex 0.158.0 reports hooks stable/enabled; Claude 2.1.250 installed. Neither adapter has been runtime-qualified.
- Stop handlers can continue; a helper heartbeat cannot establish agent state. Unknown is an approved outcome, not an implementation omission.

## Requirements
Preserve OMP behavior, privacy, ordinary native CLIs, and one root per PTY. Specify source/freshness, root/turn correlation, notification exclusions, config migration and readiness independently of file presence.

## Architecture
Contract delivered: OMP remains persistent lifecycle authority; public status DTOs include native agent kinds and source/freshness metadata, and preferences migrate to v2. Matched server/UI rollout is still required. Native event admission and runtime expiry are not implemented in Phase 01.

## Related code files
Contract-only deltas:
- `server/src/agent_status/types.rs`, `reducer.rs`, `tests.rs`: status/source/freshness contract; native collector admission and runtime expiry are not implemented.
- `packages/ui/src/api/agent-status-types.ts` and its tests: matching status DTO and strict readiness/freshness decoding.
- `server/src/config/schema.rs`, `global.rs`, and tests: v1→v2 preference migration; Claude config-path contract added.
- Static exact-version evidence and candidate schemas are recorded in [the capability report](./reports/phase-01-capability-evidence.md); these do not qualify runtime event mappings.
- OMP remains persistent and authoritative. Native status, readiness, or attention is not enabled by this contract-only work.

**Follow-on:** private ingress/root admission and runtime expiry are Phase 02 work. Live hook observations and runtime ordering remain Phase 02/06 gates. The architecture document remains docs-manager-owned and must distinguish the delivered contract from unimplemented runtime behavior.

## Implementation Steps
1. [x] Record exact installed versions and static hook schemas using isolated, unauthenticated probes; no live hook callbacks or model turns.
2. [x] Deliver status/source/freshness DTOs, v1→v2 preference migration, Claude config-path contract, and strict UI decoding.
3. [x] Record candidate mappings, privacy boundaries, and explicit Unknown cases; static schemas are not treated as observed ordering or runtime support.
4. [ ] Implement private ingress/root-incarnation admission and test monotonic 15-second native lease expiry, refresh, and late-event fencing — Phase 02; pending.
5. [ ] Observe live root/session/turn ordering and actual Codex/Claude hook events in an approved PTY/browser qualification environment — Phase 02/06; pending.

## Todo list
- [x] Exact-version static capability evidence and candidate event schemas recorded; runtime support remains unqualified.
- [x] Shared status DTO/source/freshness and preference/path contracts delivered; strict UI decoding implemented.
- [x] Recorded suite verification passed: Rust 1,586 passed/5 ignored; UI unit 1,942 passed; browser 220 passed/4 skipped; UI TypeScript build passed. The skipped browser cases require a server; these results are not native PTY qualification.

**Pending gates:** the 15-second native lease runtime test and ingress/root admission are Phase 02 work. Live hook observations and root/session/turn ordering are Phase 02/06 gates and remain pending. No live native PTY/model turn or browser-native-hook check ran; no hooks were installed and live user configuration was untouched. No live qualification or complete rollout is claimed.

## Success Criteria
Phase 01 is complete only for the approved contract deliverables: exact-version static capability evidence, candidate/unavailable event descriptions, status/source/freshness and configuration contracts, strict decoding, and recorded regression-suite passes. This does not establish hook admission, a running 15-second lease/expiry test, root or event ordering, trust/readiness, live native status/attention, or release qualification. The 15-second runtime test remains Phase 02; actual hook observations and live root/session/turn ordering remain Phase 02/06 gates.

## Risk Assessment
Current docs may describe newer binaries; qualify instead of guessing minimum versions. Too-broad event mapping produces false confidence. A fixed expiry is a staleness bound, not cancellation detection.

## Security Considerations
No prompt, argv, transcript, tool content or raw error fixtures. Temporary native homes must not contain copied credentials in committed reports. Keep process identity private.

## Next steps
Phase 02 implements admission/lifetime. Phases 03/04 share its stable CLI/envelope contract. Any unsupported native transition stays Unknown under the user-approved scope.
