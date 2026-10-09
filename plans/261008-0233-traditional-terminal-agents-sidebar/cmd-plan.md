# Command plan — Traditional Projects + Agents

**Proposed only; not implemented.** Priority P2; total effort 16h; all phases pending, progress 0%. Review required before application changes. Ordinary plan; no advice-controlled receipts or historical captures initialized.

## Access
- [Implementation overview, graph, dependency and exclusive ownership matrices](plan.md)
- [Frozen APIs, identity/status/Done, notification, click and route contracts](contracts.md)
- [Main planner contract](reports/02-planner-contract.md)
- [Codebase evidence; fresh-summary scout skipped](reports/01-codebase-analysis.md)
- [Herdr UX research](research/researcher-01-report.md)
- [OMP/Codex/Claude status research](research/researcher-02-report.md)
- [Design risk review](reports/03-design-risk-review.md)

## Phase status
| Phase | Implementation | Review | Progress | Parallelization group | Estimate | Link |
|---|---|---|---|---|---|---|
| 1 Pure roster model | pending | pending | 0% | A: independent authoring | 3h | [phase 1](phase-01-roster-model.md) |
| 2 Projects/Agents navigator | pending | pending | 0% | A: independent authoring | 4h | [phase 2](phase-02-navigator-components.md) |
| 3 Profile-qualified Agent Store | pending | pending | 0% | A: independent authoring | 3h | [phase 3](phase-03-agent-store-navigation.md) |
| 4 Display integration/qualification/docs | pending | pending | 0% | B: after 1 + 2 + 3 | 6h | [phase 4](phase-04-integration-qualification.md) |

## Execution groups
1. Review/accept frozen contracts. No backend/DTO/store foundation changes.
2. Group A authors phases 1–3 concurrently, each exclusive file set (2 / 4 / 4 paths). No connected-runtime independence claimed; consume exact planned exports. Do not run builds, tests, lint or formatters mid-flight.
3. Group B integrator owns all remaining 14 paths; waits for all three deliveries, wires desktop+compact, then runs targeted gates once and actual-app smoke with real supported harnesses. Record qualification in the phase-4-owned report, not research reports.
4. Publish real full-viewport wide/compact captures, metadata and human review; reconcile implementation with architecture and amend docs/changelog truthfully. Missing harness credentials/runtime blocks qualification, not the authoring slices.

## Scope guard
- Projects retain all terminals; Agents alternate index of observed OMP/Codex/Claude, not catalog inventory/process launcher.
- Working/Idle/Needs attention/Unknown are semantic presentation. Done is gated explicit last-turn hint, never task success or per-client unseen state.
- Current owner/incarnation/baseline only; Agent Settings targets explicit profile/reactive generation, invalid target fails closed before queries.
- Notification behavior, existing hooks, backend/database and protocol unchanged. No application sources modified during planning; no checks run.

## Validated decisions
User confirmed 2026-10-08: two visible sections, Projects first; all-open-project Agents roster; secondary `Done (turn ended)` hint. [Three-question interview](reports/06-validation-interview.md). No design revisions required; implementation remains pending.
