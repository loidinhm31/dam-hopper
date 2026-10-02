# Phase 01: Freeze native contract and source parity baseline

## Context links

- [Parent plan](./plan.md); [frozen architecture and migration boundaries](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions](./reports/validated-decisions.md); decisions already incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: None.

## Overview

- Date: 2026-10-02. Priority: P2.
- Status: Implementation/finalization settled; durable completion pending (not DONE).
- Owner: Integration owner. Estimated implementation effort: 4h.
- Review evidence: code review 9.5/10; reviewer reports 16/16 parity checks passed and no critical issues.

## Key Insights

User decisions: full plugin-platform retirement; per-server admin toggle default off; no path-hash utility; real history directory required; native-only automatic rollback. Existing Advisor has eight read/refresh operations, not policy/history editing. `plugin/ui/plugin-main.tsx` is only a bootstrap; real UI lives in Evcrate `viewer/src/`. Producer history is `advisor-history`, not `avisor-history`. Remove `/home` scanning and canonical-equals-input admission; retain the explicitly confirmed final-root symlink rejection.

## Requirements

Freeze every observable read, filter, metric, comparison, detail, stale/error state and UI interaction before deleting source. Preserve producer/core Advisor and any currently supported non-plugin viewer behavior; do not restore a removed historical standalone picker. No path hash field, generation/copy utility or root-identity admission. Preserve producer project_id, checkpoint, document-revision and cursor integrity hashes. No new writable history/policy/evaluation feature. Default native setting disabled.

## Architecture

Contract owner defines native DTOs, operation endpoints, owner keys, source discovery and one setting. API input/output camelCase; unchanged on-disk Evcrate snake_case documents. Transport-independent domain models belong in native Advisor modules, never plugin SDK. Contract freeze enables backend and UI workers to work independently.

## Related code files

READ /home/loidinh/WS/evcrate/plugin/{manifest.json,backend/provider.cjs,backend/data-api.cjs,backend/history-scanner.cjs,backend/history-detail.cjs,backend/evaluation-provider.cjs,backend/policy-provider.cjs}.
READ /home/loidinh/WS/evcrate/viewer/src/{app.tsx,app-state-types.ts,app-state-reducer.ts,app-state-selectors.ts,providers/advisor-data-provider.ts,styles.css,views/}.
READ /home/loidinh/WS/evcrate/src/{protocol/,advisor-settings/coordinator.ts}; keep core source.
CREATED /home/loidinh/WS/dam-hopper/plans/261002-0246-native-advisor-migration/reports/native-contract-and-parity.md as Phase 01 contract/parity evidence.
UPDATE /home/loidinh/WS/dam-hopper/docs/architecture/native-advisor.md only when contract details change.

## Implementation Steps

1. Read research reports, validated decisions and the frozen architecture/migration boundaries. Recheck current working files before acting; unrelated edits are user-owned. Include the validated contract in every worker handoff; no unresolved override work remains.
2. Enumerate eight operations and their fields, version discrimination, revision/cursor ownership, limits, filters/sort, status unions, aggregation/comparison rules and source file paths. Record source symbol → native symbol → acceptance scenario for each.
3. Preserve V2 root inventory and All/project scope as native DTO behavior; native source authority replaces plugin history_identity. Build synthetic, non-sensitive golden documents matching current producer formats, including malformed/unsupported versions, two projects, two evaluation groups and changed detail revisions. Reuse existing fixtures where possible; no private HOME history in committed fixtures.
4. Capture existing plugin-visible results/UI in an isolated fixture environment before platform removal. Reference provider functions directly for read-domain comparisons; do not set up production registration.
5. Freeze root = process HOME/.evcrate/advisor-history; unset HOME means unavailable, never CWD, /root or /home scanning. Require a real final root directory using symlink_metadata; reject a final-root symlink with an explicit source issue. Do not require canonical-equals-input or prohibit symlink ancestors. A readable empty real root is available; unreadable root is reported, not silently empty. Status DTO: `{enabled,available,path,sourceError}`; no pathSha256/rootIdentity.
6. Freeze policy source HOME/.evcrate/advisor-routing.json. Evaluations reuse current context-table discovery of HOME/.evcrate/{advisor-evaluations,evaluations} and registered selected project tests/fixtures/advisor-evaluations; no worker-CWD fallback, binding UI, new picker or invented producer path.
7. Freeze settings/status exceptions: admin may read status and enable toggle while disabled/missing history; data requires enabled. Persist `server.advisor.enabled` default false, directory arrival does not flip setting.
8. Freeze retirement rollback policy: new manager only activates plugin-free releases; reject legacy rollback before mutation with explicit reason. Back up old manager/state; operators may deliberately restore the complete legacy toolchain outside the new manager. No runtime compatibility shim or resurrected runner.
9. Assign one integration owner for shared client/router/state/manifests, all deletion gates and final checks. Freeze contracts before worker editing begins.

## Todo list

- [x] Read research reports, validated decisions and the frozen architecture/migration boundaries. Recheck current working files before acting; unrelated edits are user-owned. Include the validated contract in every worker handoff; no unresolved override work remains.
- [x] Enumerate eight operations and their fields, version discrimination, revision/cursor ownership, limits, filters/sort, status unions, aggregation/comparison rules and source file paths. Record source symbol → native symbol → acceptance scenario for each.
- [x] Preserve V2 root inventory and All/project scope as native DTO behavior; native source authority replaces plugin history_identity. Build synthetic, non-sensitive golden documents matching current producer formats, including malformed/unsupported versions, two projects, two evaluation groups and changed detail revisions. Reuse existing fixtures where possible; no private HOME history in committed fixtures.
- [x] Capture existing plugin-visible results/UI in an isolated fixture environment before platform removal. Reference provider functions directly for read-domain comparisons; do not set up production registration.
- [x] Freeze root = process HOME/.evcrate/advisor-history; unset HOME means unavailable, never CWD, /root or /home scanning. Require a real final root directory using symlink_metadata; reject a final-root symlink with an explicit source issue. Do not require canonical-equals-input or prohibit symlink ancestors. A readable empty real root is available; unreadable root is reported, not silently empty. Status DTO: `{enabled,available,path,sourceError}`; no pathSha256/rootIdentity.
- [x] Freeze policy source HOME/.evcrate/advisor-routing.json. Evaluations reuse current context-table discovery of HOME/.evcrate/{advisor-evaluations,evaluations} and registered selected project tests/fixtures/advisor-evaluations; no worker-CWD fallback, binding UI, new picker or invented producer path.
- [x] Freeze settings/status exceptions: admin may read status and enable toggle while disabled/missing history; data requires enabled. Persist `server.advisor.enabled` default false, directory arrival does not flip setting.
- [x] Freeze retirement rollback policy: new manager only activates plugin-free releases; reject legacy rollback before mutation with explicit reason. Back up old manager/state; operators may deliberately restore the complete legacy toolchain outside the new manager. No runtime compatibility shim or resurrected runner.
- [x] Assign one integration owner for shared client/router/state/manifests, all deletion gates and final checks. Freeze contracts before worker editing begins.

## Success Criteria

Operation matrix covers all eight methods and all four tabs; actual source paths and limits cited. Worker interfaces contain no grants, bindings, frame nonce, plugin generations or path-hash utility. Default-off, real-directory and native-only rollback decisions are frozen. Producer partition/revision hashes remain intact. Synthetic fixture baseline reproducible. No production service or source deletion in this phase.

## Risk Assessment

No evaluation writer convention found; preserve current verified discovery behavior, not a perpetual not_configured placeholder. Legacy rollback incompatibility must be explicit in deployment runbook before cleanup. Review notes `scripts/test-native-advisor-parity.mjs` imports Evcrate plugin backend; replace it with permanent native Rust parity coverage before Phase 08 removes that backend.

## Security Considerations

Admin-only current session authorization; no no-auth bypass. Keep input/document bounds, escaped rendering and ID containment, but remove plugin/root-identity gates.

## Next steps

- Release frozen native DTO/endpoint/state contract to Phase 02 (History backend & API), Phase 03 (Policy & evaluation), Phase 04 (UI reuse), and Phase 07 (Linux deployment).
- Phase 02, 04, and 07 may run in parallel per architecture wave definitions.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
