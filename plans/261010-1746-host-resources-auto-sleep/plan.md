---
title: "Host Resources: agent-aware automatic sleep"
description: "Suspend after more than three hours of free agents in DamHopper terminals, with immediate first-answer client consent and existing RTC wake safety."
status: pending
priority: P2
effort: 56h
branch: feat/host-resources-auto-sleep
tags: [feature, backend, frontend, api, auth]
created: 2026-10-10
---

# Host Resources — agent-aware automatic sleep

**Planning only. No application implementation, tests or host suspend performed.**

## Workspace
- Branch: `feat/host-resources-auto-sleep`.
- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-host-resources-auto-sleep`.
- Base: `main`, `538da1d39dafb3455d0cc61d4eb94032227b0969`.
- Estimate: 56h implementation/qualification; native source feasibility and operator window may change it.

## Frozen user decisions
- Free = **Idle + Blocked**; Working and Unknown/stale/unobserved in-scope agents block.
- Track **DamHopper-managed terminals only**, including traditional UI mode/retained managed lineage. **External SSH/tmux/headless agents do not prevent machine sleep.**
- Require continuously qualified free state for **strictly more than three hours**.
- Zero public client WebSockets: automatic final check/sleep. Connected clients: explicit UI prompt.
- **Any enabled authenticated user** may approve. **First valid Yes/No accepted by server wins. Approval proceeds immediately to final checks**; later contrary answers cannot override it.
- Accepted refusal or unanswered request: another full three-hour wait. Preserve existing automatic RTC wake.

## Design
- Opt-in startup policy `agent-free`; legacy policies/manual force separate. New-mode quiet fixed at 10800s, explicitly configured.
- Reuse managed-root process discovery; verify every independent agent's current semantic evidence. Complete in-scope zero qualifies; partial/unobserved coverage does not. No host-wide inventory/enrollment.
- Track authenticated public `/ws`, excluding private OMP reporter sockets/SSE. Bind request/socket capability/actor/session and client profile generation.
- Recommended **unanswered** timeout 60s; approval never waits for it. Last disconnect while pending/approved defers three hours. Approval bypasses no fresh semantic/helper safety check.
- Detailed API/invariants/races: [contracts](contracts.md). Proposed design: [system architecture](../../docs/system-architecture.md#proposed-semantic-agent-free-automatic-sleep).

## Phases

| # | Phase | Status | Progress | Estimate | Detail |
|---|---|---|---|---|---|
| 01 | Contracts/configuration/admission interfaces | Completed | 100% | 6h | [Phase 01](phase-01-contracts-and-configuration.md) |
| 02 | Managed agent inventory and semantic authority | Completed | 100% | 12h | [Phase 02](phase-02-agent-inventory-and-semantic-evidence.md) |
| 03 | WebSocket presence/liveness/session binding | Completed | 100% | 8h | [Phase 03](phase-03-websocket-presence-and-session-binding.md) |
| 04 | Timer, immediate consent and final handoff | Completed | 100% | 10h | [Phase 04](phase-04-coordinator-consent-and-final-handoff.md) |
| 05 | Host Resources and shared consent UI | Completed | 100% | 10h | [Phase 05](phase-05-host-resources-and-consent-ui.md) |
| 06 | Runtime/security/visual qualification and rollout | Completed | 100% | 10h | [Phase 06](phase-06-verification-security-and-rollout.md) |

Dependencies: 01 → (02 and 03 independently) → 04 → 05 → 06. UI layout may start after DTO freeze; integrated proof waits for APIs. One integration owner handles shared coordinator/status changes.

## Evidence and acceptance
- [Agent research](reports/agent-eligibility-research.md), [client research](reports/client-consent-research.md): source findings retained; initial host-wide/delayed-veto proposals superseded by validation below.
- [Acceptance matrix](acceptance-matrix.md): 53 observable scenarios, pending implementation evidence.
- [Planning validation](reports/plan-validation.md): document checks/interview only, not runtime/provider/hardware qualification.
- Safe proof uses real routes/sockets/auth/providers with recording executor; actual suspend requires separate explicit operator maintenance gate.

## Validation Summary
**Validated:** 2026-10-10. **Questions asked:** 3 (additional to initial policy clarification).
- Confirmed: immediate approval; first valid server-accepted decision wins; managed-terminal-only agent scope.
- [x] Updated contracts, phases, acceptance scenarios and proposed architecture for all three answers.
- [x] Removed host-wide discovery/enrollment and post-approval denial window from implementation scope.
- Recommendation: begin later implementation in Phase 01; pass Phase 02 native evidence gate before automatic enablement. No implementation started now.

## Unresolved prerequisites
- **Native Codex/Claude current-state freshness:** existing hooks cannot prove three hours free. Phase 02 must establish a real source; never stretch leases or infer Idle from Stop/silence.
- Managed multiple/subagent coverage, proc visibility, process peer identity and final lock/session-revocation fence require qualification.
- No unanswered product-policy questions. External work exclusion is intentional user choice; unsupported live agents **inside managed scope** remain blockers, not permission for silent OMP-only delivery.
