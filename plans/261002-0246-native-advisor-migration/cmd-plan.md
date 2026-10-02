# Native Advisor plan navigation

Status: in-progress; Phase 01 implementation/finalization settled; durable completion pending (not DONE).

[Full plan](./plan.md) · [Design contract / acceptance](./reports/native-design-contract.md) · [Architecture: Phase 01 frozen; runtime work later](../../docs/architecture/native-advisor.md)

Read [validated decisions](./reports/validated-decisions.md) for the decision/evidence audit trail; all phase instructions are directly synchronized.

## Phases

| Phase | Contract | Status / progress | Estimate |
|---|---|---|---|
| 01 | [Freeze native contract and source parity baseline](./phase-01-contract-and-parity-baseline.md) | Implementation/finalization settled; durable completion pending / not DONE | 4h |
| 02 | [Port history domain, status, admin guard and native API](./phase-02-native-history-domain-and-api.md) | Pending / 0% | 12h |
| 03 | [Port current policy and evaluation discovery/read/compare](./phase-03-policy-and-evaluation-domain.md) | Pending / 0% | 10h |
| 04 | [Reuse Advisor UI and replace plugin provider](./phase-04-reuse-native-advisor-ui.md) | Pending / 0% | 10h |
| 05 | [Wire per-server toggle and all Workspace surfaces](./phase-05-settings-and-workspace-cutover.md) | Pending / 0% | 6h |
| 06 | [Delete Dam-Hopper plugin runtime, SDK and bridge](./phase-06-remove-dam-hopper-plugin-platform.md) | Pending / 0% | 6h |
| 07 | [Retire Linux runner and deliver safe manual uninstall](./phase-07-linux-deployment-and-manual-uninstall.md) | Pending / 0% | 10h |
| 08 | [Remove Evcrate plugin integration and release assets](./phase-08-evcrate-plugin-and-release-removal.md) | Pending / 0% | 5h |
| 09 | [Qualify native-only cutover and update current docs](./phase-09-qualification-and-documentation.md) | Pending / 0% | 7h |

## Gates

- G1: native API + four-view Workspace parity before source/platform deletion.
- G2: native release + state migration + API/helper runtime before manual service removal.
- G3: final plugin-free builds/releases/core producer/browser and disposable-host proof.

## Confirmed defaults

- Entire Dam-Hopper plugin platform retired.
- Per-server admin-only enabled toggle, default off.
- HOME/advisor-history discovery requires a real directory; no hashing UI or access prerequisite.
- Core Evcrate Advisor/history remains; no historical standalone feature restoration.

## Unresolved questions

See full plan. No open user scope decision; external runtime qualification prerequisites remain for implementation.
