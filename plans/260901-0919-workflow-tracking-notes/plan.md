---
title: "Workflow Tracking and Continuity"
description: "Add durable project, task, phase, session, and note continuity inside the existing workspace shells."
status: in-progress
priority: P2
effort: 88h
branch: feat/workflow-tracking-notes
tags: [feature, frontend, backend, database, api, workflow]
created: 2026-09-01
---

# Workflow Tracking and Continuity

## Outcome
A profile- and workspace-isolated context surface answers what is active, where it runs, what changed, and how to resume without replacing project, target, terminal, editor, or URL state.

**Plan status:** In progress overall; Phase 01 Complete / DONE (2026-09-02), Phase 02 Complete / DONE (2026-09-02, 100%), Phase 03 Complete / DONE (2026-09-02, 100%), Phase 04 Complete / DONE (2026-09-02, 100%), Phase 05 Complete / DONE (2026-09-02, 100%), Phases 06–07 pending.
Phase 04 handoff: Strict client DTOs, domain helpers, transport mapping for all 13 workflow operations, and React Query hooks with profile and transport generation isolation verified with 100% pass rates across 51 targeted UI tests, 1,452 full UI tests, and 907 executed Rust tests (2 ignored). See [test report](../reports/tester-260902-1139-phase-04-client-types-transport-query-state.md) and [review report](../reports/code-reviewer-260902-1144-phase-04-client-types-transport-query-state.md).
Phase 05 handoff: Responsive workflow context surface implementation complete and review approved (9.8/10). Targeted Phase 05 UI tests passed 62/62 (100%); full UI suite passed 1,493/1,493 (100%). See [test report](../reports/tester-260902-1243-phase-05-responsive-workflow-context-surface.md) and [review report](../reports/code-reviewer-260902-1245-phase-05-responsive-workflow-context-surface.md). Ready for Phase 06.

## Scope Decisions
- **MVP:** server-owned snapshot state plus bounded typed activity events; Plan-first organization with optional Phase/Task breakdown and standalone Tasks; durable notes; manually timed sessions with **Now** fill; validated terminal links; manual harness label/run ID; terminal lifecycle observations; one overview DTO; top ambient row + desktop deck/mobile sheet.
- Existing configured project name + `ProjectTargetRef` is identity; no duplicate workflow-project or active-worktree model.
- A Plan is useful alone: status, notes, sessions, terminals, and harness links can attach directly without phases/tasks. Phase is optional under Plan; Task may be standalone or belong directly to a Plan/Phase.
- Server SQLite is source of truth. Manual semantic edits and session timestamps are authoritative; automatic observations update only resource/link health and append activity, never work-session times or status. Every DTO exposes provenance.
- Manual sessions may overlap across projects, Plans, work items, and terminals. Elapsed time is orientation data, not human-focus or billing time.
- **Deferred:** automatic harness producers/integrations, search, dependencies/DAGs, offline queue, exports, reminders, aggregate analytics, collaboration, AI summaries.
- **Non-goals:** required breakdown maintenance, fake completion percentages, route/navigation/search-param changes, terminal replacement, raw PTY/prompt/argv/env capture, filesystem watcher, automatic task inference or timing, issue tracker/calendar.

## Phases
| # | Phase | Status | Progress | Effort | Depends on |
|---|---|---:|---:|---:|---|
| 01 | [Domain and relational persistence](./phase-01-domain-and-relational-persistence.md) | Complete / DONE (2026-09-02) | 100% | 14h | — |
| 02 | [Service and REST API](./phase-02-workflow-service-and-rest-api.md) | Complete / DONE (2026-09-02) | 100% | 14h | 01 |
| 03 | [Lifecycle correlation and adapters](./phase-03-terminal-lifecycle-correlation-and-agent-adapter.md) | Complete / DONE (2026-09-02) | 100% | 12h | 01–02 |
| 04 | [Client state and query contracts](./phase-04-client-types-transport-and-query-state.md) | Complete / DONE (2026-09-02) | 100% | 10h | 02 |
| 05 | [Responsive context surface](./phase-05-responsive-workflow-context-surface.md) | Complete / DONE (2026-09-02) | 100% | 16h | 04 |
| 06 | [Workspace shell integration](./phase-06-workspace-page-and-shell-integration.md) | Pending | 0% | 10h | 03–05 |
| 07 | [Verification, rollout, and docs](./phase-07-verification-rollout-observability-and-docs.md) | Pending | 0% | 12h | 01–06 |

## Key Dependencies
- `SessionStore` migration/transaction boundary and `AppState` initialization.
- `ProjectTargetRef`, `useProjectTarget`, PTY stable session ID/incarnation, terminal exit/restart events.
- Protected Axum router, transport operation mapping, profile-scoped TanStack Query hash.
- Existing `toolbarActions` seam in `IdeShell`, `TerminalWorkspaceShell`, and `MobileWorkspaceShell`.

## Success Outcomes
- Refresh, profile switch, workspace switch, server restart, terminal restart/crash, and stale links preserve manual timestamps and truthful observed state without losing terminal buffers/input.
- Mutations are transactional/idempotent; target ownership is server-validated; event/note retention and purge are bounded.
- Desktop and mobile expose loading/error/empty/attention states; focus and shortcuts never steal terminal/editor input.
- Existing IDE, terminal, compact/mobile, project-target, and `useSearchParams` behavior remains unchanged.

## Validation Summary
**Validated:** 2026-09-01  
**Questions asked:** 7

### Confirmed Decisions
- Organization: Plan-first; phases/tasks optional. A Plan directly owns notes and manual sessions. Direct Plan → Task and standalone Task are allowed.
- Progress: Plan status stays manual. Without a maintained breakdown show status/last activity/session context—not `0%`; with children show factual `x/y tracked tasks done`, never inferred total completion.
- Harness MVP: explicit manual harness label/run ID plus adapter boundary; automatic harness producers deferred.
- Timing: user-owned start/end timestamps with one-tap **Now**; terminal lifecycle is observed context/suggestion and never overwrites manual times.
- Data scope: current server profile only; no client-global or cross-profile aggregation.
- Workspace UX: existing top 40px `toolbarActions` companion row, desktop deck, mobile safe-area sheet.
- Retention: 90-day activity events, durable current records/notes, 7-day purge grace after note deletion.

### Action Items
- [x] Review the [interactive responsive prototype](./workflow-context-prototype.html) and choose Plan-first optional breakdown.
- [x] Revise Phase 03 so terminal lifecycle only records observations/suggested end times and never writes manual work timestamps.
- [x] Revise hierarchy constraints, API contracts, UI semantics, and verification for Plan-first optional breakdown.

## Unresolved Questions
None.
