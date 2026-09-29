# Phase 04 — Codex and Claude native event adapters

## Context links
[Plan](./plan.md) · [Event matrix](./design-contract.md) · [Phase 01](./phase-01-capabilities-and-observation-contract.md) · [Phase 02](./phase-02-private-hook-ingress.md)

## Overview
Date: 2026-09-29. Priority P1. Estimate 8h. Status DONE / 100% (2026-09-29 Asia/Saigon); Cycle 1 review Approved (9.5/10).
Implement the approved limited native mappings, not OMP parity through guessed transitions.

## Key Insights
PermissionRequest can auto-resolve; Stop can continue. Claude Escape lacks a general documented hook. Native session ID alone does not identify root process or current logical turn. Tool failures are not automatically terminal failures.

## Requirements
Passive, content-free, per-provider allowlists. No native Stop completion alerts. Root/subagent fences; conservative handling of session switches, compact, delayed startup and missing turn IDs. Codex provides native-hook status only; Phase 05 removes OSC9 completely.

## Architecture
Small concrete Rust normalizers behind private ingress; native event names map to existing reducer operations only after identity/causality validation. Unknown invalidation must remain within current native claim, never affect other agent/turn. Event evidence is leased, not cached forever.

## Related code files
Create:
- `server/src/agent_status/codex_hooks.rs`, `claude_hooks.rs`: allowlisted native DTO parsing and state normalization.
Modify:
- `server/src/agent_status/{mod.rs,hook_reporter.rs,hook_ingress.rs,reducer.rs}`: integrate concrete adapters, use shared ownership/lease rules.
- `server/tests/agent_status_hooks.rs`: behavioral timelines, missing IDs, mixed root/child and stale callbacks.
- `server/src/agent_status/codex_integration.rs`, `claude_integration.rs`: consume exact qualified hook registration inventory (coordinate phase 03).
Delete: no OMP extension behavior; Phase 05 owns obsolete OSC9 removal.

## Implementation Steps
1. Use Phase 01 evidence to select actual supported event registrations; never install unknown hooks merely because newest docs list them.
2. Codex: observe correlated UserPromptSubmit/tool activity as Working, Interrupt as interrupted/Idle without completion, SessionEnd as release. SessionStart silent Unknown; PermissionRequest/Stop candidates become Unknown; no generic question/error claim.
3. Claude: observe prompt/tool/compaction activity; explicit visible-wait notification may become Blocked/approval; qualified StopFailure becomes Blocked/error. PermissionRequest/AskUserQuestion pre-tool events alone are candidates, not proof of waiting. Escape gaps expire.
4. Ignore all child events for root state, including child StopFailure. Do not overwrite root state from inherited capabilities in nested agent launches.
5. Maintain exact turn/session fences for all resolutions. Multiple tool blockers cannot be cleared by an unrelated successful parallel tool. Without correlation, prefer Unknown.
6. Stop handling invalidates certainty only for the matching current turn; no fixed settle timer. A continuation starts/refreshes observed work only with its own qualified event.
7. Deduplicate attention on qualified blocked entry; no repeated alerts from duplicate notifications. Interrupted/error outcomes never become ordinary turn-ended success.
8. Exercise actual installed native callbacks through the reporter/collector under isolated homes; record bounded event names/IDs and visible state, never transcript text. Keep deterministic regressions for continuation, Escape expiry, stale turn and child contamination.

## Todo list
- [x] Codex qualified mapping and conservative gaps.
- [x] Claude qualified mapping and conservative gaps.
- [x] Root/turn/parallel blocker regression timelines plus real-hook smoke.

## Success Criteria
Agent status reflects only qualified event evidence and returns Unknown after 15s without renewal. Other hooks can continue/approve/deny without DamHopper influencing them. No native Stop creates normal semantic completion; Codex supplies status only, with no OSC9 fallback.

## Risk Assessment
Hook delivery may be concurrent; timestamp ordering alone is insufficient. Different versions may omit fields. Disable uncertain mapping rather than invent IDs or read transcripts. Approved limited coverage must be visible in UI/docs.

## Security Considerations
Silently ignore text fields and unknown properties without logging. No user text in notification titles/bodies. No approval or context JSON is emitted to native agent.

## Next steps
Phase 05 displays truthful readiness/source/capabilities; Phase 06 verifies real interactive sequences and coexistence with user hooks.
