# Project Manager Terminal Report — Phase 08: Evcrate Plugin and Release Removal

**Date:** 2026-10-02  
**Plan:** `plans/261002-0246-native-advisor-migration/phase-08-evcrate-plugin-and-release-removal.md`  
**Status:** Phase 08 implementation and scoped validation are reported settled. Advisory terminal status only; **not** a durable completion receipt and does not claim controller completion. The project-wide Phase 09 gates remain open.

## Executive status

Phase 08 removes Evcrate's plugin product and Dam-Hopper's obsolete parity harness while preserving core Advisor data contracts, general release tooling, and seven public release assets. The tester report records **2,627 passing tests, 0 failures, and 24 expected Windows-only skips** across its scoped Dam-Hopper/Evcrate commands. Code review scored **9.6/10**. Parent-provided counsel status is **ADVICE_READY with 0 must-fix items**, and user approval is recorded in the assigned scope.

This report does not certify the migration as a whole or mark Phase 08 durably complete. The current protected [progress overview](../261002-0246-native-advisor-migration/progress.md) says Phases 06/07 are durably complete, Phase 08 is settled, and Phase 09 is Ready/Next. The protected [parent plan snapshot](../261002-0246-native-advisor-migration/plan.md) still lists Phases 06–09 pending and 0/9 durable phases. Parent must reconcile these administrative views through its authorized lifecycle; this report changes neither.

## Phase 08 accomplishments

- Removed the Evcrate `plugin/` product, plugin packaging/build scripts, plugin-only tests, SDK/runtime dependencies, release workflow steps, archive checks, and artifact upload/download requirements.
- Removed Evcrate viewer's Dam-Hopper port provider, bridge contract, and plugin-mode construction. Renamed `advisor-plugin-data-api` to neutral `advisor-data-api` and migrated callers without a compatibility alias.
- Removed Dam-Hopper `scripts/test-native-advisor-parity.mjs`; the reviewer reports that native Rust unit/API tests now carry the relevant domain assertions.
- Preserved general Evcrate release tooling and the seven public assets: Linux archive + checksum, Windows archive + checksum, release JSON, `install.sh`, and `install.ps1`. Historical published GitHub plugin assets were not requested for remote deletion; new builds should no longer produce or require the plugin archive.
- Phase 08 contract todos are checked and its scope/review status is recorded as complete in the phase file. That is implementation status, not durable plan completion.

## Scoped validation evidence

PM did not rerun tests or project-wide checks. Results below are from the [tester report](./tester-261002-1645-phase-08-plugin-removal.md), not independently executed in this reporting task.

| Repository | Recorded command | Result |
|---|---|---:|
| Dam-Hopper | `cargo test advisor --manifest-path server/Cargo.toml` | 34 passed |
| Dam-Hopper | `pnpm --filter @dam-hopper/ui test` | 2,206 passed; 293/293 files |
| Evcrate | `npm run build` | Passed (build; not counted as tests) |
| Evcrate | `npm run test:advisor-metrics` | 6 passed |
| Evcrate | `npm run test:advisor-controller` | 234 passed; 24 Windows-only skips |
| Evcrate | `npm run test:protocol` | 53 passed |
| Evcrate | `npm run test:release` | 34 passed |
| Evcrate | `node --test tests/viewer/*.test.mjs` | 60 passed |
| **Total** | **2,651 reported test cases** | **2,627 passed; 0 failed; 24 skipped** |

The 34 Rust matches are filtered results, not the full Rust suite. The Evcrate build is not a test count. Tester-noted non-failing diagnostics and the Windows-only skips are detailed in its report. Do not present these scoped gates as Phase 09's integrated build/lint/test or live runtime qualification.

The [code review](./code-review-261002-1700-phase-08-plugin-removal.md) confirms the removal/rename scope and reports exact-seven public assets preserved; it also records four warning-level findings and three suggestions. No critical finding is reported. Phase 09 should verify these observations against the current tree, especially the viewer's residual plugin labels, nullable `activeProvider.cancel` call, stale `providerKind` union, and Evcrate docs naming the deleted protocol file. These are reviewer cautions, not counsel must-fix findings.

## Documentation status and remaining updates

**Phase 08 documentation edits reported by code review:** Evcrate's README plugin installation/packaging guidance was removed, and plugin-only `docs/advisor-plugin-ui.md` and `docs/advisor-plugin-worker.md` were deleted. The Phase 08 review still found Evcrate documentation referencing the deleted `src/protocol/advisor-plugin-data-api.ts` filename; see its warning list.

**Current Dam-Hopper documentation still needs Phase 09 reconciliation.** Read-only inspection found examples of obsolete present-tense plugin instructions and source maps in:

- `README.md` — plugin-runner identities, ACL grants over `$HOME/.evcrate`, Plugin Management history-root setup, and SHA-256 path identity instructions remain.
- `docs/README.md` — links to retired Trusted Plugin Platform D01/D02/D03/D05 guides remain.
- `docs/system-architecture.md` and `docs/api-reference.md` — describe the retired runner/platform and `/api/plugins` endpoints as current.
- `docs/frontend-components.md` and `docs/codebase-summary.md` — still describe `usePluginHost`, plugin SDK/runtime sources, and plugin APIs.
- `docs/project-overview-pdr.md` — contains historical plugin-platform requirements that should be clearly labeled/archived rather than represented as the current product contract.
- `docs/architecture/native-advisor.md` — still names the deleted `scripts/test-native-advisor-parity.mjs`, says Phases 04/05 are not durably done, and its status text predates Phase 06–08 retirement. Reconcile wording only with qualified evidence.
- `docs/CHANGELOG.md` — its current 2026-10-02 entries do not yet include Phase 08. Phase 09 requires an accurate entry in both repositories.

The Docs Manager's assigned destination is a separate report under `plans/reports/`; that role was authorized to inventory/report only, not edit shared documentation. This PM report makes no roadmap/changelog or shared-doc edits. In particular, do not edit the protected roadmap, `plan.md`, `progress.md`, or sealed receipts here. Phase 09 owns authorized current-doc/changelog updates after qualification evidence is established.

## Remaining phase: Phase 09 — qualification and documentation

The Phase 09 contract is still **Pending / 0%**, planning-only, with all 11 checklist items unchecked. It is the remaining implementation/qualification phase identified by the current progress overview. Its required gates go beyond Phase 08's scoped tests:

1. After all writers settle, Main runs the project's final build/lint/test gates once and records exact commands/results. No PM rerun was made.
2. Reconcile the outstanding **G1** handoff before claiming it passed. Phase 05 still records live operator smoke and browser/API parity for eight operations and four views as pending; Phase 08's tester/reviewer evidence does not close those behaviors. G1 was a stated prerequisite to source deletion, so parent should explicitly resolve that sequencing/evidence discrepancy. Do not infer a pass from the original source-parity baseline.
3. Qualify the real authenticated admin server/browser path: status/settings and all eight data operations; four tabs, owner/profile transitions, authorization and late-result boundaries, source-root edge cases, and Workspace IDE/Terminal/compact flows. `dev:server --no-auth` is explicitly not valid admin proof.
4. Complete G2 in a disposable Linux host/session: native install, committed state migration, rollback/recovery and fail-closed boundaries; manual cleanup dry-run/apply/idempotence, system and user scope, history preservation, shared IPC, and no orphan runner descendants. Do not apply destructive cleanup to production. The Phase 07 PM report records an earlier host smoke stopped at an unmet legacy-unit prerequisite and no separate user-scope qualification; keep those gates explicit until current evidence closes them.
5. Complete G3 across both repositories: build/inventory retained release assets in scratch output, demonstrate plugin artifacts/dependencies absent and all seven public assets retained, smoke the core Evcrate producer with native Dam-Hopper consumption, and verify no cross-checkout imports, retired runtime APIs, SDK, registration paths, or public aliases.
6. Update current documentation and both changelogs from qualified behavior; classify historical plans/requirements and unrelated ecosystem plugins separately from active instructions. Correct the obsolete README permissions/hash directions and current plugin API/source maps. Record unavailable platform gates as blocked, never passed, and remove qualification scratch fixtures/services afterward.
7. Triage the Phase 08 review warnings against the actual final tree and record any fixes or reasoned dispositions in Phase 09 evidence.

A01–A20 and their G1/G2/G3 assignments are enumerated in [native-design-contract.md](../261002-0246-native-advisor-migration/reports/native-design-contract.md). The Phase 09 contract names authenticated MongoDB/session fixtures, a disposable systemd/user-manager environment, and supported native toolchains as prerequisites; unavailable gates must be stated exactly, not simulated.

## Handoff to Main

**Please finish Phase 09 before representing the migration as project-complete.** It is the final delivery gate for native-only behavior, safe deployment/cleanup, release assets, and current docs; Phase 08's passing scoped suite is not a substitute. Preserve the Phase 08 test/review evidence, reconcile protected status views through the parent workflow, resolve the G1 evidence gap explicitly, then publish the authorized qualification/docs result and any durable completion record only through the parent lifecycle.

## Unresolved questions

- What authorized observed evidence will close or explicitly disposition the still-pending G1 live parity/manual-smoke criteria after Phase 08 removed the old source integration?
- Will the Phase 09 run provide both disposable systemd and user-manager environments, or must either scope remain an explicitly blocked external gate?
- What final-tree dispositions are chosen for the code-review warnings and the remaining historical plugin requirements/docs?
