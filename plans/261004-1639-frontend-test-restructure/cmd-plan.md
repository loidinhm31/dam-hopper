# Frontend testing restructure — planning entrypoint

[Full plan](./plan.md) · [Acceptance matrix](./acceptance-checks.md) · [Confirmed direction](../reports/advise-261004-1527-frontend-test-evidence.md)

Status: pending implementation. Planning artifacts only; no runner/test/docs implementation changes.

| Phase | Status / progress | Detail |
|---|---|---|
| 01 Inventory + runner separation | Pending / 0% | [Phase 01](./phase-01-inventory-and-runner-separation.md) |
| 02 Isolated application/backend/auth/data | Pending / 0% | [Phase 02](./phase-02-isolated-application-services.md) |
| 03 Three genuine application journeys | Pending / 0% | [Phase 03](./phase-03-real-application-journeys.md) |
| 04 Fresh local evidence + human inspection | Pending / 0% | [Phase 04](./phase-04-local-evidence-and-human-review.md) |
| 05 CI assertion gate + docs + qualification | Pending / 0% | [Phase 05](./phase-05-ci-docs-and-qualification.md) |

Research: [53-suite project-wide coverage matrix](./research/browser-coverage-inventory.md) · [fixture feasibility](./research/application-fixture-feasibility.md).

Acceptance: actual app controls and production backend; isolated deterministic data; independent route readback; fresh complete-viewport images + genuine human review; owned cleanup on success/failure/startup/cancellation; capture-disabled CI keeps all assertions and writes no images/evidence.

Additional workflow gaps inventoried, not bulk-implemented. Component regressions retained; only three mislabeled cases converted.

Unresolved questions: none blocking design. Hook active-plan persistence unavailable in this session; directory supplied explicitly.

Validation: [three user-confirmed decisions](./reports/validation-answers.md). Production app+Mongo containers, real persisted session seed, colocated human review. No implementation authorization inferred.
