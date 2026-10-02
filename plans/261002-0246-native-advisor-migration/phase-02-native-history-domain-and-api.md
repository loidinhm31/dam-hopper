# Phase 02: Port history domain, status, admin guard and native API

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions](./reports/validated-decisions.md); decisions already incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phase 01 contract frozen.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation/finalization: settled. Durable completion: pending (not DONE).
- Owner: Rust history worker; integration owner wires shared files. Estimated implementation effort: 12h.
- Review/validation: code review 9.6/10; 8/8 API integration tests, 23/23 Advisor unit tests, 16/16 parity tests; compilation/Clippy reported 0 errors and 0 Advisor warnings.

## Key Insights

History refresh/summary/page/detail share snapshots and query identity. Existing Rust app uses Axum AppState, global config and real-filesystem tests. Current admin middleware already checks enabled MongoDB users; its name/messages are plugin-specific. No LSP configured in this planning session; implementation must recheck tooling before exported-symbol edits.

## Requirements

Native implementation, not Node subprocess or generic plugin invoke. Admin-only status/settings/data. HOME-only real-directory discovery; reject final-root symlink, no path-hash utility or root-identity admission. Server toggle defaults false, including upgrades. Preserve V1 durable history with V2 checkpoint and V2 root-inventory/query behavior, summary calculations, provenance, filtering, pagination and detail revision transitions.

## Architecture

CREATE server/src/advisor/{mod.rs,types.rs,error.rs,history.rs,history_scan.rs,metrics.rs,snapshots.rs}; split by actual domain concerns, no duplicate validator framework. CREATE server/src/api/advisor.rs. ApiClient routes map directly to protected REST. Proposed routes: GET /api/advisor/status; PATCH /api/advisor/settings; POST /api/advisor/history/refresh; POST /api/advisor/history/summary; POST /api/advisor/history/page; POST /api/advisor/history/detail. Retain request bodies from frozen domain contract without plugin envelopes.

## Related code files

CREATE /home/loidinh/WS/dam-hopper/server/src/advisor/ modules above and /home/loidinh/WS/dam-hopper/server/src/api/advisor.rs.
MODIFY /home/loidinh/WS/dam-hopper/server/src/{lib.rs,state.rs,api/mod.rs,api/router.rs,api/auth.rs,config/schema.rs,config/global.rs} through integration owner.
CREATE /home/loidinh/WS/dam-hopper/server/tests/advisor_history_api.rs and source-shaped fixtures under server/tests/ using existing fixture convention.
READ /home/loidinh/WS/dam-hopper/server/src/{utils/,api/usage_sessions/,config/tests.rs} for atomic persistence/error/query patterns.

## Implementation Steps

1. Generalize `require_plugin_admin` to native `require_admin`, migrate every current caller and neutralize messages. Keep fresh enabled-user role lookup, authenticated actor checks and no-auth denial. Native routes use ordinary validated sessions, not plugin-only static subjects or bearer-only admission.
2. Add `AdvisorConfig { enabled: bool }` under ServerConfig with default false and correct TOML/camelCase normalization; preserve read-modify-write locking and write disk atomically before publishing successful setting change.
3. Add an Advisor service to AppState owning captured HOME and bounded snapshots; inject explicit source roots/time into tests rather than racing process-global environment variables.
4. Implement status DTO `{enabled,available,sourceError,path}`. Use symlink_metadata to require a real final history-root directory; report explicit source issue for a final-root symlink. No root setter, UID equality, single-link requirement, grant check, /home scan, canonical-equals-input/ancestor-symlink admission or root identity comparison. Do not calculate/return pathSha256 or expose hash generation/copy. Preserve producer project_id/checkpoint/content-revision/cursor integrity hashes.
5. Port source scanner/schema discrimination, malformed/unsupported record accounting and metrics. Use bounded blocking work off Tokio workers; scan once per refresh, reuse immutable normalized snapshots for summary/page/detail. Do not allocate whole-history copies per page or clone payloads needlessly.
6. Port source filters and `started_at_desc` tie-breaking, default page 100/max 500, query-bound cursor identity, missing/changed detail statuses. Limit caches/lifetimes according to frozen source bounds; wrong-user/stale/expired snapshot fails explicitly.
7. Wire admin-protected routes, structured native errors and input size limits. Status/toggle available when disabled; data returns AdvisorDisabled until enabled. Disable clears native active snapshots so late reads cannot publish retained data.
8. Add behavior regressions for durable V1/V2-checkpoint variants, metrics/filter boundaries, cursor continuation/query mismatch, late detail change, unreadable/missing/empty real roots, explicit final-root symlink rejection and role downgrade. Run checks only after the integration wave finishes; no tests asserting source text/wiring.
9. Smoke real authenticated server with a temporary HOME fixture; read refresh→summary→page→detail and compare exact consumer-visible values to Phase 01 baseline. Show no runner socket, Node worker or plugin registry needed.

## Todo list

- [x] Generalize `require_plugin_admin` to native `require_admin`, migrate every current caller and neutralize messages. Keep fresh enabled-user role lookup, authenticated actor checks and no-auth denial. Native routes use ordinary validated sessions, not plugin-only static subjects or bearer-only admission.
- [x] Add `AdvisorConfig { enabled: bool }` under ServerConfig with default false and correct TOML/camelCase normalization; preserve read-modify-write locking and write disk atomically before publishing successful setting change.
- [x] Add an Advisor service to AppState owning captured HOME and bounded snapshots; inject explicit source roots/time into tests rather than racing process-global environment variables.
- [x] Implement status DTO `{enabled,available,sourceError,path}`. Use symlink_metadata to require a real final history-root directory; report explicit source issue for a final-root symlink. No root setter, UID equality, single-link requirement, grant check, /home scan, canonical-equals-input/ancestor-symlink admission or root identity comparison. Do not calculate/return pathSha256 or expose hash generation/copy. Preserve producer project_id/checkpoint/content-revision/cursor integrity hashes.
- [x] Port source scanner/schema discrimination, malformed/unsupported record accounting and metrics. Use bounded blocking work off Tokio workers; scan once per refresh, reuse immutable normalized snapshots for summary/page/detail. Do not allocate whole-history copies per page or clone payloads needlessly.
- [x] Port source filters and `started_at_desc` tie-breaking, default page 100/max 500, query-bound cursor identity, missing/changed detail statuses. Limit caches/lifetimes according to frozen source bounds; wrong-user/stale/expired snapshot fails explicitly.
- [x] Wire admin-protected routes, structured native errors and input size limits. Status/toggle available when disabled; data returns AdvisorDisabled until enabled. Disable clears native active snapshots so late reads cannot publish retained data.
- [x] Add behavior regressions for durable V1/V2-checkpoint variants, metrics/filter boundaries, cursor continuation/query mismatch, late detail change, unreadable/missing/empty real roots, explicit final-root symlink rejection and role downgrade. Run checks only after the integration wave finishes; no tests asserting source text/wiring.
- [x] Smoke real authenticated server with a temporary HOME fixture; read refresh→summary→page→detail and compare exact consumer-visible values to Phase 01 baseline. Show no runner socket, Node worker or plugin registry needed.

## Success Criteria

All four history operations match baseline metrics/detail/statuses. Alternate HOME real directory works; final-root symlink explicitly rejected; neighboring /home data never discovered. No path-hash field/action/prerequisite. Admin allowed; non-admin/disabled/MFA-invalid/no-auth denied. Toggle defaults off and persists after restart; unrelated TOML intact. Smoke output includes expected fixture record IDs and totals, not merely HTTP 200.

## Risk Assessment

Blocking filesystem scans and unbounded snapshot retention risk responsiveness. Global config updates can clobber other settings without serialized read-modify-write. Root replacement during reads requires stable descriptor/source revision, not copied plugin admission machinery.

## Security Considerations

No raw absolute path input; opaque validated record IDs cannot traverse outside source. Content rendered as data; no secret/log dumping. Final-root symlink rejection is the user-confirmed directory rule, not a plugin identity check. Producer partition/revision/checkpoint/cursor hashes are domain integrity, not feature entitlement. Use normal auth revocation and current-role policy.

## Next steps

Validated history/status/setting contract is ready for Phase 04 UI; Phase 03 fills policy/evaluation endpoints. Keep the old platform until native UI parity evidence exists.

No Phase 02 review questions remain. The parent plan's qualification prerequisites still apply; do not claim those gates passed.
