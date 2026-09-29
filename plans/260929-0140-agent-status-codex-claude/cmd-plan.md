# Codex and Claude status rollout

Workflow: `/cmd-plan__hard`; skills loaded explicitly. Planning only.

[Full plan](./plan.md) · [Design contract](./design-contract.md) · [Acceptance](./acceptance-scenarios.md)

| Phase | Status | Progress |
|---|---|---|
| [01 — Capabilities and observation contract](./phase-01-capabilities-and-observation-contract.md) | Pending | 0% |
| [02 — Private hook ingress](./phase-02-private-hook-ingress.md) | Pending | 0% |
| [03 — Managed hook installation](./phase-03-managed-hook-installation.md) | Pending | 0% |
| [04 — Native event adapters](./phase-04-native-event-adapters.md) | Pending | 0% |
| [05 — Settings and notification cutover](./phase-05-settings-and-notification-cutover.md) | Pending | 0% |
| [06 — Linux qualification](./phase-06-linux-qualification.md) | Pending | 0% |

## Approved boundary
Native hooks; ordinary CLI usage; explicit Unknown for evidence gaps. No screen parser, model calls, prompt injection, or task-success inference. Complete managed uninstall after agent restart; preserve user hooks/settings.

## Dependencies
Keep OMP's existing persistent reporter. New one-shot ingress and native adapter contracts precede installer/UI wiring. Phases 03/04 can overlap once contracts stabilize. Linux qualification targets locally observed Codex 0.158.0 and Claude 2.1.250; neither integration is qualified yet.

## Unresolved questions
Exact-version runtime qualification gates are listed in the full plan; no remaining architecture choice.
