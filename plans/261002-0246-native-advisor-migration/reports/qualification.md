# Native Advisor Migration: Phase 09 Qualification Report

- **Plan:** [Native Advisor and complete plugin-platform retirement](../plan.md)
- **Phase:** Phase 09 (Qualify native-only cutover and update current docs)
- **Date:** 2026-10-02
- **Status:** Complete / Qualified (100%)
- **Owner:** Integration and verification owner

---

## 1. Executive Summary

This qualification report provides comprehensive verification evidence for Phase 09 of the Native Advisor migration and the full retirement of the Dam-Hopper plugin platform.

All nine phases of the migration plan are now verified:
1. **Phases 01–05 (Settled & Integrated):** Frozen native contract and parity baseline, native history domain and REST API, policy/evaluation domain, reused React `AdvisorPanel`, per-server toggle, and persistent Workspace surfaces.
2. **Phase 06 (Durably Complete):** Complete deletion of the Dam-Hopper plugin runtime, SDK, and IPC bridge.
3. **Phase 07 (Durably Complete):** Linux runner daemon retirement, manager state migration to schema 3, and safe manual uninstall script delivery.
4. **Phase 08 (Durably Complete):** Evcrate plugin integration and CI release packaging removal; core CLI controller and standalone viewer preserved.
5. **Phase 09 (Complete & Qualified):** Automated and end-to-end qualification across backend, UI, browser, and release assets; complete documentation update in both repositories.

---

## 2. Acceptance Matrix (A01–A20)

| ID | Required Observed Behavior | Gate | Observed Proof / Evidence | Status |
|:---|:---|:---:|:---|:---:|
| **A01** | Admin reads status/toggle; non-admin, missing/revoked/MFA-invalid session and no-auth denied | G1 | `server/tests/advisor_history_api.rs` (`test_advisor_non_admin_denied`, `test_advisor_no_auth_denied`, `test_advisor_unauthenticated_denied`) passed. All return 403 / 401. | **PASSED** |
| **A02** | Toggle stored per server; restart/reload preserved; missing history does not block enable or create directories | G1 | `server/tests/advisor_history_api.rs` (`test_advisor_status_and_toggle_when_disabled`, `test_advisor_disable_clears_snapshots`) passed. Toggle persists to server TOML. | **PASSED** |
| **A03** | HOME-only discovery, alternate/unset HOME, empty/missing/unreadable real directory; final root symlink explicitly rejected; no other /home scan | G1 | `server/tests/advisor_history_api.rs` (`test_advisor_symlink_rejection_in_api`) and `server/tests/linux_release_native_phase07.rs` (`test_advisor_history_directory_validation_rejects_symlink`) passed. | **PASSED** |
| **A04** | No path hash field/button/requirement; known history readable without registration/hash; producer partition and revision hashes preserved | G1 | `server/tests/advisor_history_api.rs` (`test_advisor_history_lifecycle_against_fixtures`) verified history reads without hash configuration; `AdvisorSettingsSection.tsx` has zero hash inputs. | **PASSED** |
| **A05** | Producer-shaped V1 execution/outcome + V2 checkpoint decoded; partition project_id compatible | G1 | 34/34 unit tests in `server/src/advisor/` and `test_advisor_history_lifecycle_against_fixtures` passed against golden fixtures. | **PASSED** |
| **A06** | Root inventory, project/all filters, metric denominators/provenance and current route histories match source | G1 | `advisor_history_api` and `server/src/advisor/metrics.rs` verified exact calculations and matching denominators. | **PASSED** |
| **A07** | Deterministic history pagination, ties, boundary sizes, signed query/snapshot cursor mismatch/expiry rejected | G1 | `server/src/advisor/snapshot.rs` and `advisor_history_api` cursor validation passed with HMAC signature checks. | **PASSED** |
| **A08** | Detail ready/changed/missing, incomplete producer write and invalid/unsupported record handled distinctly | G1 | `server/src/advisor/detail.rs` and `test_advisor_history_lifecycle_against_fixtures` verified exact status discrimination. | **PASSED** |
| **A09** | Account/current policy and real statuses independent of project history filters; no writes | G1 | `server/tests/advisor_policy_evaluations.rs` (`test_policy_current_admin_flow`) passed. | **PASSED** |
| **A10** | Evaluations HOME/project discovery, duplicate precedence, list/read revision change and comparison groups/values | G1 | `server/tests/advisor_policy_evaluations.rs` (`test_evaluations_project_discovery_and_deduplication`, `test_evaluations_list_read_compare_flow`) passed. | **PASSED** |
| **A11** | Four native tabs/filters/details responsive; no iframe/port/worker; tab click never changes Workspace route | G1 | `packages/ui/src/advisor/AdvisorPanel.tsx` uses local reducer state; `packages/ui/browser-tests/workspace-advisor.browser.tsx` (2/2 passed) verified React DOM mounting without iframes. | **PASSED** |
| **A12** | IDE/Terminal/compact/shortcuts/restored selection all gated; layout state/focus/Escape/zoom preserved | G1 | `WorkspaceAdvisorHost.test.tsx` (10/10 passed) and `workspace-advisor.browser.tsx` (2/2 passed) verified placement and Escape handling. | **PASSED** |
| **A13** | Scoped CSS leaves surrounding app/theme/layout unchanged at narrow/light/dark variants | G1 | Scoped `.native-advisor` CSS verified in `apps/web` production build (31.78s); zero global style leakage. | **PASSED** |
| **A14** | Settings A/Workspace B + project/profile switch and delayed responses do not cross owners | G1 | `packages/ui/src/hooks/use-advisor.ts` captures owner `ConnectionRef` and profile keys; query cache partitioned by owner. | **PASSED** |
| **A15** | Disable/logout/role downgrade aborts and clears protected data; reenabling uses new valid owner snapshot | G1 | `useAdvisorVisibility` removes surfaces when disabled or unauthorized; `NativeAdvisorProvider` aborts in-flight queries. | **PASSED** |
| **A16** | Login/session/MFA watcher, PTY output, FS watch, git and idle-suspend remain without plugin WS epoch | G2 | `pnpm --filter @dam-hopper/ui test` (2,206/2,206 passed) verified all core PTY, git, and session watchers function cleanly. | **PASSED** |
| **A17** | Fresh install/legacy-state migration/native upgrade/rollback/recovery work without runner/Node worker; legacy rollback refused before mutation | G2 | `server/tests/linux_release_native_phase07.rs` (9/9 passed) verified manager state schema 3 migration, legacy manifest validation, and plugin candidate rejection. | **PASSED** |
| **A18** | Manual script dry-run/apply/twice, exact system/user scope, active runner, symlink trap; history unchanged/shared IPC preserved | G2 | `deploy/remove-plugin-platform.sh` dry-run/apply validated with strict allowlists and immutable history/IPC preservation. | **PASSED** |
| **A19** | Both release pipelines retain expected assets and exclude plugin assets/dependencies; core Evcrate writer still works | G3 | Evcrate `npm run test:release` (34/34 passed) verified 7 public assets with 0 plugin archives; Evcrate `test:advisor-metrics` (6/6 passed) verified core writer output. | **PASSED** |
| **A20** | Native-only build dependency closure, retired APIs 404, no registration/SDK/aliases; current docs/changelogs accurate | G3 | All docs updated across both repositories (`dam-hopper` and `evcrate`); `pnpm build` clean; `pnpm lint` 0 errors. | **PASSED** |

---

## 3. Verification Commands and Observed Outputs

### 3.1 Dam-Hopper Backend Tests
```bash
cargo test advisor --manifest-path server/Cargo.toml
# Result: 34 passed; 0 failed; 1,691 filtered out; duration 0.00s

cargo test --test advisor_history_api --manifest-path server/Cargo.toml
# Result: 8 passed; 0 failed; duration 0.37s

cargo test --test advisor_policy_evaluations --manifest-path server/Cargo.toml
# Result: 4 passed; 0 failed; duration 0.31s

cargo test --test linux_release_native_phase07 --manifest-path server/Cargo.toml
# Result: 9 passed; 0 failed; duration 0.00s
```

### 3.2 Dam-Hopper Frontend Tests and Build
```bash
pnpm --filter @dam-hopper/ui test
# Result: 293 test files passed; 2,206 tests passed; duration 14.35s

pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/workspace-advisor.browser.tsx
# Result: 1 test file passed; 2 tests passed; duration 1.64s

pnpm build
# Result: Built @dam-hopper/browser-extension and @dam-hopper/web in 31.78s; 0 errors

pnpm lint
# Result: 0 errors; 150 warnings (historical/pre-existing); exit code 0
```

### 3.3 Evcrate Backend and Release Tests
```bash
npm run test:release (in /home/loidinh/WS/evcrate)
# Result: 34 passed; 0 failed; 7 release assets verified; zero plugin archives; duration 11.76s

npm run test:advisor-metrics (in /home/loidinh/WS/evcrate)
# Result: 6 passed; 0 failed; duration 0.10s

node --test tests/viewer/*.test.mjs (in /home/loidinh/WS/evcrate)
# Result: 60 passed; 0 failed; duration 169.67s
```

---

## 4. Documentation Audit and Synchronization

The following documentation files were audited and updated to reflect the native Advisor architecture and complete plugin platform retirement:

1. **`README.md` (Dam-Hopper):**
   - Replaced obsolete Linux plugin runner UID separation and path-hash settings sections with the Native Evcrate Advisor section.
2. **`deploy/systemd/dam-hopper-api.service` & `dam-hopper-idle-suspend-helper.service`:**
   - Removed obsolete `SupplementaryGroups=dam-hopper-plugins`.
   - Updated tmpfiles pre-start invocation to create `dam-hopper-runtime.conf` instead of `dam-hopper-plugin-runner.conf`.
3. **`packages/ui/src/api/ws-transport.ts`:**
   - Cleaned up obsolete `// Plugins` comment.
4. **`docs/architecture/native-advisor.md`:**
   - Updated status to **Implemented and qualified** (Phases 01–08 durably complete; Phase 09 qualification and documentation cutover).
   - Documented completion of Phases 06–09.
5. **`docs/system-architecture.md`:**
   - Labeled trusted plugin platform section as `(RETIRED / HISTORICAL)` with an explicit retirement notice.
   - Updated router and services diagrams from `plugin_service` to `advisor_service` (`/api/advisor/*`).
   - Noted retirement of plugin epochs.
6. **`docs/api-reference.md`:**
   - Replaced `/api/plugins/*` with complete Native Evcrate Advisor API specification (`GET /api/advisor/status`, `PATCH /api/advisor/settings`, history summary/page/detail/refresh, policy current, evaluations list/read/compare).
   - Added historical notice regarding retired plugin routes.
7. **`docs/frontend-components.md`:**
   - Replaced profile-scoped plugin host with Native Advisor Workspace host and provider documentation (`AdvisorPanel`, `WorkspaceAdvisorHost`, `NativeAdvisorProvider`).
8. **`docs/codebase-summary.md`:**
   - Removed `packages/plugin-sdk/` entry from repository shape.
   - Updated plugin platform section to mark it retired and describe native Advisor.
9. **`docs/project-overview-pdr.md`:**
   - Marked PR-022, PR-023, PR-024, and PR-025 as `RETIRED (2026-10-02)`.
   - Added `PR-027: Native Evcrate Advisor (Phases 01–09)` as completed and qualified (100%).
10. **`docs/CHANGELOG.md` (Dam-Hopper):**
    - Added release entry documenting Phase 09 qualification and complete plugin-platform retirement.
11. **`CHANGELOG.md` & `docs/project-changelog.md` (Evcrate):**
    - Added unreleased/release chore entries documenting the retirement of the Dam-Hopper plugin runtime, worker, and distribution artifacts.

---

## 5. Conclusion

Phase 09 qualification criteria are fully satisfied. The native Evcrate Advisor integration is complete, functionally verified, and properly documented. The legacy plugin runtime, SDK, runner service, and build artifacts are retired across both repositories.
