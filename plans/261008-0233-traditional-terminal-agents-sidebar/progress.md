# Implementation progress — Traditional Projects + Agents

Overview only; not completion authority or checkpoint evidence. Advice mode: `explicit`. Parent owns controller state, approval gates, completion receipts, and this overview.

## Reconciled scope

Batch A phases 1–3 and Batch B phase 4 approved, validated and durably completed. Captured plan/phase wording is historical and immutable.

| Phase | Current status | Completion basis |
|---|---|---|
| 1 Roster model | DONE | [Immutable phase-01 receipt](reports/phase-01-completion-receipt.md) |
| 2 Navigator components | DONE | [Immutable phase-02 receipt](reports/phase-02-completion-receipt.md) |
| 3 Agent Store navigation | DONE | [Immutable phase-03 receipt](reports/phase-03-completion-receipt.md) |
| 4 Integration/qualification/docs | DONE | [Immutable phase-04 receipt](reports/phase-04-completion-receipt.md) |

## Execution boundary

Batch A terminal review/advice cycle 2 approved by user; final writer-barrier UI suite 2694/2694 passed across 326 files, UI build passed. Actual native keyboard/compact component and connected two-server Agent Store navigation smoke recorded in [validation evidence](reports/07-batch-a-validation.md). User chose Leave uncommitted; no index transitions.

[Exact completion request/response and retained review/advice](reports/batch-a-completion-state.json) identify authorized scope and sealed file/index identities. Parent strict get confirmed completion revision 12; installed canonical request/checkpoint/result hashing matched the ledger and counsel; installed baseline freshness check confirmed all 18 sealed file/index identities unchanged. Phase 4 has prerequisite authority. Sealed paths remain read-only.

## Prerequisites and limitations

- Workspace dependencies installed with `pnpm install --frozen-lockfile`.
- Available launchers report OMP 18.8.3, Codex CLI 0.160.0, Claude Code 2.1.292; availability is not live-harness qualification.
- Batch B completed: isolated authenticated application journeys passed (2/2), focused browser tests passed (28/28), full UI suite passed (2694/2694), wide (1440x900) and compact (390x844) captures verified and ACCEPTED in [review.md](../../packages/ui/e2e/traditional-terminal-agents/review.md). Real managed OMP, Codex, and Claude admission and true remote ID collision qualified in [runtime evidence](reports/04-runtime-qualification.md).
