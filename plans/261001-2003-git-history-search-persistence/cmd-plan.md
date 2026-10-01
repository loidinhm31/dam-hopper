# Git history search and selection persistence

Status: in progress; Phase 01 complete (2026-10-01 21:12:48 +07:00). Remaining implementation phases pending.

Entry points: [Plan](./plan.md) · [Shared contract](./design-contract.md).

| Phase | Status | Progress | Instructions |
|---|---|---|---|
| 01 Server message search | DONE | 100% (2026-10-01 21:12:48 +07:00) | [Phase 01](./phase-01-server-message-search.md) |
| 02 Transport/query contract | Pending | 0% | [Phase 02](./phase-02-transport-query-contract.md) |
| 03 Persisted selections | Pending | 0% | [Phase 03](./phase-03-persisted-history-selections.md) |
| 04 Shared history view | Pending | 0% | [Phase 04](./phase-04-shared-history-view.md) |
| 05 Workspace Git panel | Pending | 0% | [Phase 05](./phase-05-workspace-git-integration.md) |
| 06 Git page | Pending | 0% | [Phase 06](./phase-06-git-page-integration.md) |
| 07 Qualification/docs | Pending | 0% | [Phase 07](./phase-07-qualification-documentation.md) |

Execution: 01/02/03 independent after frozen contracts → 04 → 05/06 in parallel → 07.
Coordinator owns integration and verification; no shared-file concurrent edits.

Defaults: full-message literal case-insensitive search; server-side filter before pagination; persisted owner-qualified project and branch intent; no checkout on restore; bulk empty=all preserved.

Source implementation is underway; Phase 01 server message search is complete. Full feature delivery and qualification remain pending.
