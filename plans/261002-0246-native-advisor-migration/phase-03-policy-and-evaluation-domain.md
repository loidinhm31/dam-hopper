# Phase 03: Port current policy and evaluation discovery/read/compare

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions](./reports/validated-decisions.md); decisions already incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phase 01; Phase 02 service/error/DTO skeleton.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: Rust policy/evaluation worker. Estimated implementation effort: 10h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

Current policy is account-wide/current, not selected-project historical policy. Core producer destination HOME/.evcrate/advisor-routing.json. Evaluations provider consumes descriptors; plugin context-table auto-discovers HOME candidate directories and project fixture directory. No documented evaluation writer was found; auto-discovery is viewer behavior, not producer guarantee.

## Requirements

Preserve policy inspection status and evaluation list/read/compare semantics; no permission grant, registered descriptor paths or evaluation editor. All admin access automatic under enabled feature. Document revisions/digests remain required for changed/compare behavior; they are not the removed path-hash utility. Do not ship evaluations as always not_configured or introduce new picker/upload scope.

## Architecture

CREATE server/src/advisor/{policy.rs,evaluations.rs,evaluation_comparison.rs}; add endpoints through native api/advisor.rs: POST /api/advisor/policy/current; POST /api/advisor/evaluations/list, /read, /compare. Policy fixed HOME path. Evaluation candidates in order: HOME/.evcrate/advisor-evaluations, HOME/.evcrate/evaluations, selected registered project/worktree tests/fixtures/advisor-evaluations. Deduplicate identical directories and first-wins descriptor refs, as source. Remove worker-CWD fixture lookup; no ambient process-CWD authority.

## Related code files

READ /home/loidinh/WS/evcrate/plugin/backend/{context-table.cjs:171-225,policy-provider.cjs,evaluation-provider.cjs,advisor-lib/policy-schema.cjs,protocol-lib/advisor-evaluation-comparison.js}.
READ /home/loidinh/WS/evcrate/src/protocol/{advisor-evaluation.ts,advisor-evaluation-validation.ts,advisor-evaluation-comparison.ts,advisor-evaluation-primitives.ts,advisor-settings.ts} only existing source counterparts named by report.
CREATE /home/loidinh/WS/dam-hopper/server/src/advisor/{policy.rs,evaluations.rs,evaluation_comparison.rs}.
MODIFY /home/loidinh/WS/dam-hopper/server/src/api/advisor.rs through integration owner; reuse workspace target resolver, not plugin bindings.
CREATE /home/loidinh/WS/dam-hopper/server/tests/advisor_policy_evaluations.rs.

## Implementation Steps

1. Port current policy parser/status: not_configured/missing, ready, v1 migration_required, unsupported, invalid, unreadable with explicit issue codes. Source max policy 16 KiB. Show current account scope; never filter it to history's selected project or modify producer policy files.
2. Reuse current WorkspaceTargetResolver/registered project resolution to derive selected project/worktree path for evaluation discovery; no raw arbitrary path or plugin binding request. HOME candidates work without a selected project.
3. Port bounded directory listing, deterministic JSON ordering, duplicate refs and revision/digest behavior from context-table/evaluation-provider. Preserve source exclusion of mismatch/invalid fixture filenames for baseline; contract must state these discovery rules rather than hide them in a helper.
4. Port evaluation validation and descriptor stats: candidate/case/observation counts, source revision/digest; <=8 MiB per file, list default32/max100, serial parsing/hashing rather than unbounded task fan-out.
5. Read compares expected revision to actual digest: changed/missing status remains visible. Validate refs against server-discovered source table, not client-supplied paths. Snapshot source resolution for each operation so project switches cannot reroute in-flight read.
6. Port comparison grouping and provenance exactly: compatible routes/cases/candidates, non-comparable reasons and denominators, order and cursor behavior, <=1 MiB result page. Do not average already-aggregated metrics or mix incompatible groups.
7. Remove plugin allowCurrentAccountPolicy and capability guards; current admin guard protects every endpoint. Preserve bounded parse/schema/path safety, but no owner UID/link-count/root hash admission restriction beyond ordinary access.
8. Build fixtures with HOME + registered project discovered documents, duplicate refs, differing expected revisions and comparable/non-comparable groups; compare visible values against source baseline. Validate policy global while history project filters change.
9. Real native API smoke: policy returns fixture model/route values; discovered evaluation list→detail→compare returns named fixtures and expected score/group counts; alter a source file and observe changed. Empty directories legitimately not_configured; existing fixtures must never be hidden by a fake fallback.

## Todo list

- [ ] Port current policy parser/status: not_configured/missing, ready, v1 migration_required, unsupported, invalid, unreadable with explicit issue codes. Source max policy 16 KiB. Show current account scope; never filter it to history's selected project or modify producer policy files.
- [ ] Reuse current WorkspaceTargetResolver/registered project resolution to derive selected project/worktree path for evaluation discovery; no raw arbitrary path or plugin binding request. HOME candidates work without a selected project.
- [ ] Port bounded directory listing, deterministic JSON ordering, duplicate refs and revision/digest behavior from context-table/evaluation-provider. Preserve source exclusion of mismatch/invalid fixture filenames for baseline; contract must state these discovery rules rather than hide them in a helper.
- [ ] Port evaluation validation and descriptor stats: candidate/case/observation counts, source revision/digest; <=8 MiB per file, list default32/max100, serial parsing/hashing rather than unbounded task fan-out.
- [ ] Read compares expected revision to actual digest: changed/missing status remains visible. Validate refs against server-discovered source table, not client-supplied paths. Snapshot source resolution for each operation so project switches cannot reroute in-flight read.
- [ ] Port comparison grouping and provenance exactly: compatible routes/cases/candidates, non-comparable reasons and denominators, order and cursor behavior, <=1 MiB result page. Do not average already-aggregated metrics or mix incompatible groups.
- [ ] Remove plugin allowCurrentAccountPolicy and capability guards; current admin guard protects every endpoint. Preserve bounded parse/schema/path safety, but no owner UID/link-count/root hash admission restriction beyond ordinary access.
- [ ] Build fixtures with HOME + registered project discovered documents, duplicate refs, differing expected revisions and comparable/non-comparable groups; compare visible values against source baseline. Validate policy global while history project filters change.
- [ ] Real native API smoke: policy returns fixture model/route values; discovered evaluation list→detail→compare returns named fixtures and expected score/group counts; alter a source file and observe changed. Empty directories legitimately not_configured; existing fixtures must never be hidden by a fake fallback.

## Success Criteria

All four policy/evaluation operations functional without bindings/grants. Current policy unchanged by project history selection. HOME/project discovery and duplicate precedence deterministic; no worker-CWD source leak. Comparison values/statuses match source. Files unchanged after all reads.

## Risk Assessment

Automatic evaluation directories are implementation fallback, not guaranteed producer format location. Preserve observed behavior and clearly document missing-directory status. Concurrent producer writes can change revisions; status must not conceal invalid/missing sources.

## Security Considerations

No arbitrary path input or automatic editing of policy/evaluations. Keep source size bounds and schema validation. Project roots server-resolved; refs cannot traverse or cross another owner's cached source table.

## Next steps

Integration owner merges API endpoints; Phase 04 consumes complete native provider methods, Phase 05 proves visible parity.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
