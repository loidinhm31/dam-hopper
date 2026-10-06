# Editor Git blame — phase index

Planning: **reconciled; ready for Phase01**. Implementation: **pending, not started**. [Full plan](./plan.md).

## Start here

- Product contract: [accepted brainstorm](../reports/brainstorm-261005-2106-editor-git-blame-annotations.md).
- Frozen decisions: [contracts](./contracts.md).
- Proof gates and commands: [verification](./verification.md).
- [Validated decisions and completed revision map](./reports/validation-interview.md): container-sized compact annotations; focus/manual external refresh, no feature-added polling; read-only inspection.

## Implementation phases

| Phase | Status | Progress | Dependency |
|---|---|---|---|
| [01 Native semantics](./phase-01-native-semantics-and-contract-proof.md) | pending | 0% | none |
| [02 Native/API reads](./phase-02-native-blame-and-read-only-git-api.md) | pending | 0% | 01 |
| [03 Client/freshness](./phase-03-owner-bound-client-and-buffer-lifecycle.md) | pending | 0% | 01–02 |
| [04 Monaco gutter/menu](./phase-04-monaco-annotation-gutter-and-context-menu.md) | pending | 0% | 03 |
| [05 Workspace Git reveal](./phase-05-workspace-git-reveal-and-full-commit-details.md) | pending | 0% | 02–03 |
| [06 Source-host integration](./phase-06-editor-host-integration-and-edge-states.md) | pending | 0% | 03–05 |
| [07 Qualification/docs](./phase-07-qualification-evidence-and-documentation.md) | pending | 0% | 01–06 |

04/05 may run independently after contracts fixed; shared files need one integration owner. Native proof and actual browser/full-app evidence mandatory. No implementation permitted by plan creation alone.

## Research

- [Backend](./research/backend-native-blame.md).
- [Frontend lifecycle/navigation](./research/frontend-lifecycle-navigation.md).
- [Planning workflow and runtime limitations](./reports/planning-workflow.md).

## Unresolved questions

No product questions. Native semantic proof, runtime prerequisites and human visual review remain future execution gates.
