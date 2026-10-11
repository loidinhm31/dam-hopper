# Plan artifact validation

Date: 2026-10-11. Parent validation, planning only.
Worktree: `/home/loidinh/WS/dam-hopper-ws/remove-advisor`.
Branch: `refactor/remove-advisor`; fetched origin/main and fast-forwarded to `abba947c`.

## Result
PASS: throwaway Python artifact validator exercised the actual plan and ownership JSON.
- Overview: 76 lines after interview; required YAML fields; pending implementation status.
- Five phases; required 15 sections in order.
- Dependency matrix/graph: four independent editing phases, integration gate waits for all four.
- 158 exclusive owned paths: phase01 66, phase02 40, phase03 28, phase04 23, phase05 1.
- Zero duplicate/overlapping owners; source modify/delete paths exist; create paths absent.
- Both workflow rename paths owned by phase04.
- Existing artifact links resolve; quoted implementation examples excluded from link checking.
- Effort sum: 5+4+3+2+4=18h.
- Two researcher reports <=150 lines; both agents reported five tool calls.
- Post-interview synchronization verified across all five pending phase files: confirmed scope boundaries, historical-doc scrub, coordinated release, privileged legacy-runner inspection, separate operator approvals and service absence/health checks. Ownership and dependencies unchanged.

## Parent corrections before validation
- Wrong proposed endpoint `/api/agent-status/paths-verification` replaced by actual `GET /api/agent-status/paths` (`server/src/api/router.rs:296-297`).
- Correct response field is `effectiveHome`, established by `#[serde(rename_all="camelCase")]` and field declaration (`server/src/agent_status/integration.rs:166-170`).
- `require_admin` and `get_user_role` lose all production consumers with Advisor deletion; remove them from auth.rs and update mixed auth tests to exercise surviving session/storage/credential behavior, no artificial admin test route.
- Added actual overview ownership matrix and phase effort breakdown.
- Added workflow rename destination to ownership manifest.
- Verification phase includes built web/native hosts, explicit manifest-path Rust commands, isolated legacy-config startup/read/write smoke, stale actual layout state, no Advisor requests and live visual evidence.
- General Vitest browser config contains an obsolete specialized Advisor suite exclusion (`packages/ui/vitest.browser.config.ts:418`); added cleanup to phase02 and the exclusive ownership manifest.

## Validation limits
No implementation performed. No app build, tests, backend startup, browser smoke or native runtime qualification run; these are declared implementation gates, not planning claims.
LSP status returned no configured language servers; current textual reference inventory supports planned removal, recheck before implementation.
Initial artifact-link validator incorrectly treated a quoted Markdown implementation example as a live plan link; corrected checker and passed. No production change was needed.
Active-plan session persistence unavailable because EVCRATE_SESSION_ID is unset; all agents received explicit plan directory paths.

## Unresolved questions
Validation interview completed: scrub historical feature docs, coordinated UI/server release, other-project tooling excluded. User requested service re-audit; actual installed legacy runner and dry-run limitation recorded in [service audit](./03-linux-service-audit.md). Privileged inspection and destructive cleanup approval remain deployment gates; no implementation or service mutation authorized/performed.
