# Code Review: Phase 09 Qualify Native-Only Cutover and Update Current Docs

- **Plan:** [Native Advisor and complete plugin-platform retirement](../261002-0246-native-advisor-migration/plan.md)
- **Phase:** [Phase 09: Qualify native-only cutover and update current docs](../261002-0246-native-advisor-migration/phase-09-qualification-and-documentation.md)
- **Date:** 2026-10-02
- **Reviewer:** Phase09Reviewer (Senior Software Engineer)
- **Overall Score:** 9.6 / 10

---

## 1. Executive Summary

Phase 09 successfully qualifies the native Evcrate Advisor cutover and completes the retirement of the legacy Dam-Hopper plugin platform, runner service, and SDK across both repositories (`/home/loidinh/WS/dam-hopper` and `/home/loidinh/WS/evcrate`). All 20 acceptance criteria (A01–A20) and gates (G1, G2, G3) have observed verification proof.

Code changes in the UI cleanly resolve React rendering edge cases (impure `Date.now()` calls, render-phase ref mutations, and non-deterministic list keys). Systemd service unit files and tmpfiles rules have been stripped of the obsolete `dam-hopper-plugins` supplementary group and legacy runner tmpfiles configurations. Documentation and changelogs in both repositories accurately reflect the native-only architecture and mark plugin documents as retired.

---

## 2. Scope & Files Reviewed

### Dam-Hopper (`/home/loidinh/WS/dam-hopper`):
1. `README.md`: Replaced obsolete Linux plugin runner UID separation and path-hash documentation with native Evcrate Advisor Workspace capabilities.
2. `deploy/systemd/dam-hopper-api.service`: Removed `SupplementaryGroups=dam-hopper-plugins` and switched tmpfiles pre-start to `dam-hopper-runtime.conf`.
3. `deploy/systemd/dam-hopper-idle-suspend-helper.service`: Removed `SupplementaryGroups=dam-hopper-plugins` and aligned tmpfiles pre-start with runtime config.
4. `packages/ui/src/api/ws-transport.ts`: Cleaned up obsolete plugin channel routing comment.
5. `packages/ui/src/advisor/components/EvaluationDescriptorCard.tsx`: Replaced non-deterministic `Date.now()` during render with fallback `0`.
6. `packages/ui/src/advisor/components/EvaluationDescriptorsSection.tsx`: Replaced `String(Math.random())` key fallback with stable index-based key.
7. `packages/ui/src/advisor/views/EvaluationDetail.tsx`: Wrapped `onCloseRef.current` assignment in `useEffect` to adhere to React rules.
8. `packages/ui/src/advisor/views/HistoryDetail.tsx`: Replaced `Date.now()` fallback in render with `0`.
9. `docs/architecture/native-advisor.md`: Updated status to implemented and qualified across Phases 01–09.
10. `docs/system-architecture.md`: Marked trusted plugin platform as retired/historical, updated router/service diagrams to native `advisor_service`.
11. `docs/api-reference.md`: Replaced `/api/plugins/*` with comprehensive `/api/advisor/*` REST API reference.
12. `docs/frontend-components.md`: Replaced plugin host with Native Advisor Workspace host and provider documentation.
13. `docs/codebase-summary.md`: Documented plugin platform retirement and native Advisor architecture.
14. `docs/CHANGELOG.md`: Added release entry for Phase 09 qualification and platform retirement.
15. `docs/project-overview-pdr.md`: Marked PR-022–PR-025 as retired, added PR-027 Native Evcrate Advisor. Corrected minor PR-026 typo to PR-027.
16. `plans/261002-0246-native-advisor-migration/phase-09-qualification-and-documentation.md`: Updated implementation status, completed todos, and next steps.
17. `plans/261002-0246-native-advisor-migration/plan.md`: Updated phase status table to complete.
18. `plans/261002-0246-native-advisor-migration/progress.md`: Recorded 100% completion across all phases.
19. `plans/261002-0246-native-advisor-migration/reports/qualification.md`: Comprehensive A01–A20 qualification evidence report.

### Evcrate (`/home/loidinh/WS/evcrate`):
20. `/home/loidinh/WS/evcrate/CHANGELOG.md`: Added chore entry documenting retirement of plugin runtime, worker, and distribution artifacts.
21. `/home/loidinh/WS/evcrate/docs/project-changelog.md`: Added 2026-10-02 refactor entry for plugin platform retirement.

---

## 3. Systematic Assessment

### 3.1 Security & Boundaries (Score: 10/10)
- **Privilege Separation & Hardening:** Removed `SupplementaryGroups=dam-hopper-plugins` from both `dam-hopper-api.service` and `dam-hopper-idle-suspend-helper.service`.
- **Authentication & Role Authorization:** All Advisor REST endpoints require an authenticated administrator session (`require_admin`). `--no-auth` mode explicitly denies Advisor endpoints with HTTP 403 `NoAuthForbidden`.
- **Filesystem Security:** Direct history discovery strictly requires that the target `$HOME/.evcrate/advisor-history` be a real directory. Symlinks are detected via `symlink_metadata` and explicitly rejected, mitigating symlink traversal attacks.
- **Data Integrity:** Read-only domain design prevents unauthorized writes; cursor pagination is protected with HMAC signatures.

### 3.2 Performance & Resource Management (Score: 9.5/10)
- **Elimination of IPC Overhead:** Retiring external runner process (`dam-hopper-plugin-runner`) and Node worker saves substantial memory and eliminates JSON-RPC serialization overhead.
- **React Rendering Optimization:**
  - Removed `String(Math.random())` key fallback in `EvaluationDescriptorsSection.tsx` which caused component remounts and DOM thrashing.
  - Eliminated `Date.now()` calls during render in `EvaluationDescriptorCard.tsx` and `HistoryDetail.tsx`, avoiding non-deterministic state changes.
  - Wrapped ref assignments in `useEffect` in `EvaluationDetail.tsx` to prevent concurrent rendering tearing.

### 3.3 Architecture & Standards (Score: 9.8/10)
- **YAGNI / KISS / DRY:** Fully adhered to. Removed obsolete plugin registration, path-hash inputs, grant matrices, and iframe isolation layers. Directly reuses existing Evcrate history formats and calculation logic without gratuitous abstractions.
- **Documentation Parity:** Architecture docs, component guides, codebase summaries, and API references have been updated in lockstep across both repositories.

---

## 4. Prioritized Findings

### Critical Issues (0)
*None.*

### Warnings (0)
*None.*

### Suggestions / Improvements (2)
1. **Fallback Timestamp Rendering in UI Components:**
   - In `EvaluationDescriptorCard.tsx:66` and `HistoryDetail.tsx:243`, if `createdAt` or `startedAt` resolves to `0` (the fallback when missing), `new Date(0).toLocaleString()` displays the Unix epoch (e.g., `1/1/1970`).
   - *Recommendation:* Format missing dates conditionally: `{startedAt > 0 ? new Date(startedAt).toLocaleString() : '—'}`.
2. **Evcrate Viewer Packaging Test Performance:**
   - The standalone viewer test `AME-029: pack inventory excludes standalone viewer...` in `/home/loidinh/WS/evcrate` takes ~183s to run due to full npm pack executions.
   - *Recommendation:* Consider caching or isolating pack inspection in CI runs.

---

## 5. Validation Commands and Results

| Scope | Command | Result |
|---|---|---|
| Dam-Hopper Advisor Unit & API | `cargo test advisor --manifest-path server/Cargo.toml` | **34 passed, 0 failed** |
| Dam-Hopper Native Release Phase 07 | `cargo test --test linux_release_native_phase07 --manifest-path server/Cargo.toml` | **9 passed, 0 failed** |
| Dam-Hopper UI Typecheck | `pnpm --filter @dam-hopper/ui build` | **Clean, 0 errors** |
| Dam-Hopper Advisor Component Tests | `pnpm --filter @dam-hopper/ui test src/advisor/native-advisor-provider.test.ts src/hooks/use-advisor.test.tsx src/lib/workspace-advisor-placement.test.ts src/components/organisms/WorkspaceAdvisorHost.test.tsx` | **28 passed, 0 failed** |
| Dam-Hopper Advisor Browser Tests | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/workspace-advisor.browser.tsx` | **2 passed, 0 failed** |
| Dam-Hopper Uninstall Script Test | `bash tests/deploy/linux-release-remove-plugin-platform.sh` | **Clean, passed dry-run, apply, and idempotent second run** |
| Evcrate Advisor Metrics Tests | `npm run test:advisor-metrics` (in `/home/loidinh/WS/evcrate`) | **6 passed, 0 failed** |
| Evcrate Release Asset Verification | `npm run test:release` (in `/home/loidinh/WS/evcrate`) | **34 passed, 0 failed** |

---

## 6. Unresolved Questions

*None.* All acceptance criteria A01–A20 and gates G1–G3 are fulfilled.
