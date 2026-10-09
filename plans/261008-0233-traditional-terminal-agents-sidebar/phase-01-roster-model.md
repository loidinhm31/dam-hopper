# Phase 01 — Pure roster identity and status model

## Context links
- [Overview/ownership](plan.md), [frozen contracts](contracts.md#phase-1-module-proposed-packagesuisrclibtraditional-terminal-agentsts), [main contract](reports/02-planner-contract.md).
- [Code evidence](reports/01-codebase-analysis.md), [harness research](research/researcher-02-report.md), [risk review H1/H2/M3](reports/03-design-risk-review.md).
- Read-only source: `packages/ui/src/stores/agent-status.ts`, `packages/ui/src/api/agent-status-types.ts`, `packages/ui/src/api/ownership.ts`, `packages/ui/src/api/connections.ts`, `packages/ui/src/api/client.ts`, `packages/ui/src/lib/traditional-terminal-projects.ts`, `packages/ui/src/lib/terminal-title.ts`, `packages/ui/src/components/organisms/TerminalTabBar.tsx`, `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`.
- Standards: `docs/code-standards.md`, `docs/project-overview-pdr.md`, `docs/architecture/agent-status.md`. Optional development-rules file absent in evidence; do not invent it.

## Parallelization Info
- Group A; independent authoring alongside phases 2 and 3 against already frozen exports. No implementation-phase predecessor.
- Owns 2 paths only. Phase 2 imports type shapes; phase 4 imports builder. These are consumption dependencies, NOT permission to edit their files.
- Deliver complete model + behavioral tests; do not run tests/build/lint/formatters mid-flight. Phase 4 owns integrated verification.

## Overview
- Date: 2026-10-08. Priority: P2. Estimate: 3h.
- Description: Derive a stable readonly alternate agent index from existing terminal/status/current-connection evidence.
- Implementation status: authored, validated, user-approved; controller completion pending (NOT DONE). Review status: cycle 2 terminal reviewer 9/10 approved, canonical advice ADVICE_READY, user approved.

## Delivered Implementation & APIs
- Exported types and function (`packages/ui/src/lib/traditional-terminal-agents.ts`):
  - `AgentStatusProfilesView`: `ReturnType<typeof useAgentStatusStore.getState>["profiles"]`
  - `TraditionalAgentStatusLabel`: `"Working" | "Idle" | "Needs attention" | "Unknown" | "Unavailable" | "Platform unqualified" | "Unsupported"`
  - `TraditionalTerminalAgentPresentation`: `{ readonly label: TraditionalAgentStatusLabel; readonly reasonLabel: "Approval" | "Question" | "Error" | null; readonly outcomeHint: "Done (turn ended)" | null; readonly sourceLabel: "Lifecycle observation" | "Hook observation"; readonly coverageHint: string | null }`
  - `TraditionalTerminalAgentRow`: `{ readonly key: string; readonly sessionId: string; readonly terminalRef: TerminalRef; readonly incarnation: number; readonly groupId: string; readonly projectLabel: string; readonly profileLabel: string; readonly terminalTitle: string; readonly harnessLabel: "OMP" | "Codex" | "Claude"; readonly statusOwner: ConnectionRef; readonly availability: AgentStatusPresentationAvailability | null; readonly status: TerminalAgentStatusRow; readonly presentation: TraditionalTerminalAgentPresentation }`
  - `BuildTraditionalTerminalAgentsInput`: `{ readonly groups: readonly TraditionalTerminalProjectGroup<DisplayTabEntry>[]; readonly profiles: AgentStatusProfilesView; readonly connections: ReadonlyMap<string, ConnectionSnapshot>; readonly profileLabels: ReadonlyMap<string, string>; readonly nowMs: number }`
  - `buildTraditionalTerminalAgentRows(input: BuildTraditionalTerminalAgentsInput): readonly TraditionalTerminalAgentRow[]`
- Pure readonly builder behavior & current-generation strict hints:
  - Strict indexed identity join: indexes exact mounted sessions once per group; matches canonical `TerminalRef` against qualified `sessionId`; requires registered `profileLabels` membership; validates session is alive with safe non-negative integer incarnation; joins matching status where `status.incarnation === session.incarnation`. Deduplicates instance keys by `terminalInstanceKey`.
  - Current-generation fencing: inspects `input.connections.get(ref.profileId)`. Requires `status === "connected" && connection.owner.profileId === ref.profileId && connection.owner.generation === profile.owner.generation`. Noncurrent connections force `"unavailable"`; semantic readiness additionally requires store availability `"ready"` and non-null baseline epoch. Rebinding's retained `"unavailable"` marker is honored even when the owner matches.
  - Strict outcome hint gating: `"Done (turn ended)"` emitted ONLY when effective availability is `"ready"`, `status.state === "idle"`, `status.lastOutcome === "ended"`, and `status.turnId === undefined` (no active turn). Nonexpired guard: `status.expiresAtMs === undefined || status.expiresAtMs > nowMs`. Expired evidence presents `"Unknown"` and suppresses the hint; the original readonly status DTO remains unchanged.
  - Source observation and hook coverage explanation: `status.source === "hook"` produces `sourceLabel: "Hook observation"` and `coverageHint: "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)"`, vs `sourceLabel: "Lifecycle observation"`.
  - Reason labels: approval -> `"Approval"`, question -> `"Question"`, error -> `"Error"`.
  - Linear stable iteration over groups and tabs; retains original readonly DTO reference; no store mutation, ambient subscriptions, or task-success claims.

## Scoped Validation & Verification Links
- Scoped actual validation links: [Batch A Validation Report — Actual validation](reports/07-batch-a-validation.md#actual-validation) and [Post-correction evidence](reports/07-batch-a-validation.md#post-correction-evidence).
- Test evidence: 83 behavioral unit tests in `packages/ui/src/lib/traditional-terminal-agents.test.ts` passing; verified in full UI suite (326/326 files, 2694/2694 tests pass, UI build exit 0).
- Scoped qualification limits: Covers pure builder logic, identity joins, connection generation fencing, and presentation derivation. Live harness ingress, PTY/split preservation, and integrated application qualification remain phase 4-owned.

## Key Insights
- Agent status store already fences ingress and supplies silent snapshots. Its simple row hooks do not independently fence generation; builder must use captured current connection input.
- Reconnect begin can retain prior rows under a new owner with unavailable marker. Owner equality alone does not certify a ready baseline.
- Project grouping includes bare-ID mounted fallbacks; canonical tab and exact mounted identity must be checked independently.
- OMP/Codex/Claude are admitted kinds. Native hooks have narrower coverage; no new `done` wire state. Plain shell without admitted row is absent; observed Unknown stays visible.

## Requirements
- Implement exact `AgentStatusProfilesView`, `TraditionalAgentStatusLabel`, `TraditionalTerminalAgentPresentation`, `TraditionalTerminalAgentRow`, `BuildTraditionalTerminalAgentsInput`, and `buildTraditionalTerminalAgentRows(input): readonly TraditionalTerminalAgentRow[]` from contracts.
- Pure function: no Zustand writes, ambient getters, API/polling/subscriptions, notification policy reads, commands/output parsing, local success/unseen state or mutation of inputs.
- Canonical qualified owner + terminal metadata incarnation + live tab + exact mounted membership + matching status required. Incarnation 0 valid; undefined/malformed/mismatched excluded.
- Stable group/tab order, one row per `terminalInstanceKey`, linear indexed lookup. Keep source DTO reference readonly; presentation is not a protocol DTO.
- Noncurrent/disconnected baseline overrides semantics. Current unsupported/platform-unqualified/null availability explicit; preserve unavailable known rows only with matching current terminal identity.
- Working/Idle/Needs attention with reason/Unknown. Secondary Done only strict ready idle ended/no-active-turn/nonexpired gate; no task-success or notification meaning.

## Architecture
- Input groups retain `DisplayTabEntry` typing, so title and session metadata exist without adding MountedSession fields.
- Extract readonly store profiles through `ReturnType<typeof useAgentStatusStore.getState>["profiles"]`; do not export private store type or widen to mutable Maps.
- Iterate grouped tabs with exact per-group mounted index; canonical `terminalRef`/qualified key consistency checks precede status lookup. Reject conflicting tab, mounted and group owner context. Registered profile labels are membership evidence, not an ambient fallback.
- Join `(profileId, terminalId, metadata incarnation)`. Use existing tuple helpers for keys; generation/epoch provenance stays in input/statusOwner, never derived from command/title.
- Effective availability: missing/not-connected/current-generation mismatch -> unavailable; then existing profile availability; only connected matching ready baseline can present semantic state. Unknown/expired evidence suppresses stale outcomes.
- `nowMs` captured by caller; pure render-time expiry guard only. Root server invalidation and reconciliation remain authoritative; no separate tick/poller or local freshness promises.
- Return original status row plus context and presentation; human harness names OMP/Codex/Claude and lifecycle/hook explanations. Raw command/cwd/agentSessionId/provider errors never become sidebar copy or logs.

## Related code files
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/traditional-terminal-agents.ts` — complete pure builder/types.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/traditional-terminal-agents.test.ts` — consumer behavior/edge regressions, local test fixtures.

## File Ownership
| Absolute path | Action | Exclusive owner |
|---|---|---|
| `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/traditional-terminal-agents.ts` | Create/proposed | Phase 01 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/traditional-terminal-agents.test.ts` | Create/proposed | Phase 01 |
No deletions; all Context-links sources read-only. No separate shared fixture/type file.

## Implementation Steps
1. Copy frozen export shapes/imports; use named exports and `.js` aliases matching repo. Keep presentation helper private unless contracts require an export.
2. Build exact mounted indexes once per group. Validate owner evidence and qualified sessionId agreement; require registered profile/live `session.id`/safe incarnation before joining status. Deduplicate instance keys without sorting.
3. Resolve effective availability from captured connection and status profile baseline; retain exact-incarnation unavailable observations, exclude removed profiles/unmatched terminals, never restore retired ready semantics.
4. Derive primary text and blocked reason, freshness guard, source explanation and strictly gated outcome hint. Do not inspect `attentionRevision` to invent seen/unseen or require an alert to show snapshot outcome.
5. Write focused table/behavior tests using readonly structural store views/current snapshots or existing store APIs with isolated cleanup. Local fixture builders belong in this test only.
6. Cover identities: duplicate remote IDs across two profiles; exact tab/mounted conflict; bare/unqualified input; missing metadata; incarnation 0; restart/replacement; closed/nonlive terminal; removed profile; duplicate refs; stable order and all three admitted kinds; plain shell exclusion.
7. Cover readiness: generation changes without status/tab change; old ready row vs new connection; begin rebind with unavailable retained data; null baseline/epoch; disconnect; platform-unqualified/unsupported; silent authoritative snapshot membership replacement; state/report authority replacement.
8. Cover semantic negatives: Unknown with stale ended, working/blocked/active turn with ended, expired hook evidence, interrupted/error/unknown/missing outcome, native Stop/authority loss/lease expiry, unavailable. Positive ready idle ended snapshot with `attentionRevision: 0` must show hint silently. Notification-disabled contexts yield identical roster; builder never dispatches alerts.
9. Deliver owned files and exact exports to integrator; do not fix downstream imports by editing phase 2/4 files.

## Todo list
- [x] Implement strict indexed identity join and readonly frozen API.
- [x] Implement availability/source/reason/strict outcome presentation.
- [x] Author focused permanent behavioral tests and clean local fixtures.
- [x] Hand off complete source/test slice without executing checks.

## Success Criteria
- Every inclusion, exclusion and status precedence above is represented in authored behavior cases; inputs unchanged.
- No per-row full-profile/mounted scan, status sort, missing-incarnation fallback or store mutation.
- Explicit last-turn hint cannot imply verified success; silent snapshot stays presentation-only. All admitted harnesses retained independent of notifications.
- Phase 4 later verifies these tests with the integrated consumers; authoring completion is not a runtime qualification claim.

## Conflict Prevention
- Own only 2 listed paths. No generated schema/foundation phase, store export/refactor, shared badge vocabulary change or backend edit.
- Freeze signatures in contracts; ask integration owner before material interface changes. Phase 4 adapts its own glue, not this file.
- Shared repo unexpected edits are user's; preserve them. Other phases' imports/read-only files are not owned modifications.

## Risk Assessment
- False cross-profile join highest risk: exact keys/ref agreement and mounted validation, not group labels.
- Retained row mistaken as fresh: ready marker + connected current owner + epoch baseline all required.
- Stale outcome mistaken as success: precedence and no-active-turn gate; no wording-only test repinning.
- Expiry updates depend on existing bridge/server; wall clock is render-time safety only, not new lease engine.

## Security Considerations
- No credentials, transcripts, command/cwd/session path disclosure or logging added.
- No transport or mutation API exposed. Registered profile validation and owner-qualified instance keys prevent cross-profile context borrowing.
- Availability labels are not authorization or platform certification; unknown evidence remains explicit.

## Next steps
- Phase 4 consumes completed export and executes integrated tests after phases 2/3 land.
- No unresolved technical question. Optional user wording/layout review stays at end of [overview](plan.md#unresolved-product-questions); no semantic constraint negotiable.
