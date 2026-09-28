# Agent status — OMP first

Status: **pending; implementation not started**.

Canonical plan: [plan.md](./plan.md). Design: [agent-status architecture](../../docs/architecture/agent-status.md).

| Phase | Status | Progress |
|---|---|---|
| [01 — Semantic contract/reducer](./phase-01-semantic-contract-and-reducer.md) | Pending | 0% |
| [02 — Reporter transport/PTY lifecycle](./phase-02-reporter-transport-and-pty-lifecycle.md) | Pending | 0% |
| [03 — OMP adapter/installer](./phase-03-omp-adapter-and-installer.md) | Pending | 0% |
| [04 — Profile-safe UI/notifications](./phase-04-profile-safe-ui-and-notifications.md) | Pending | 0% |
| [05 — End-to-end qualification](./phase-05-end-to-end-qualification.md) | Pending | 0% |

Scope: existing Rust server bundles runtime and OMP extension; explicit per-profile install; agent-neutral status, Linux-first qualification, per-browser notifications. Codex/others later. No implementation, screen parser, task-success automation, host suspend change or new daemon.

[Acceptance scenarios](./acceptance-scenarios.md) · [Report review](./reports/report-review.md) · [Plan validation](./reports/plan-validation.md)

Unresolved questions: no product blockers; live OMP ordering/reload and packaged installer are implementation gates. Active-plan helper could not persist because `EVCRATE_SESSION_ID` is missing; pass canonical path explicitly.
