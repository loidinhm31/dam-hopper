# Phase 02: Client Transport and Test Infrastructure Removal

## 1. Context links

- Plan Root: [plan.md](./plan.md)
- Scope and Architecture Decisions: [reports/00-scope-and-design.md](./reports/00-scope-and-design.md)
- Scout Inventory Report: [scout/scout-01-advisor-removal-report.md](./scout/scout-01-advisor-removal-report.md)
- Frontend Research Report: [research/researcher-01-ui-removal-report.md](./research/researcher-01-ui-removal-report.md)
- Ownership Manifest: [reports/01-ownership-manifest.json](./reports/01-ownership-manifest.json)
- User Validation: [confirmed decisions](./plan.md#validation-summary).

## 2. Parallelization Info

- **Group:** Parallel Group B (client transport, public exports, package scripts, browser tests, E2E fixture and scenario removal)
- **Concurrent Siblings:** Group A ([Phase 01](./phase-01-ui-presentation-removal.md)), Group C ([Phase 03](./phase-03-native-server-removal.md)), Group D ([Phase 04](./phase-04-feature-documentation-removal.md))
- **Editing Pre-requisites:** None. Can start editing immediately in parallel.
- **Validation Pre-requisites:** All editing groups (A, B, C, D) must complete before typecheck, test runners, or builds execute.
- **Unblocks:** [Phase 05](./phase-05-integration-verification.md) (Group E).

## 3. Overview

- **Date:** 2026-10-11
- **Description:** Remove Advisor client/transport/exports, dedicated browser/E2E scenarios and synthetic fixtures; preserve mixed auth and service-isolation journeys using the existing `/api/agent-status/paths` response (`effectiveHome`).
- **Priority:** P2
- **Status:** completed
- **Review:** User validation decisions reflected 2026-10-11; implementation review and runtime verification remain pending.

## 4. Key Insights

- In `packages/ui/package.json`, `"test:browser"` currently chains `vitest.browser.config.ts` and `vitest.advisor-routing.browser.config.ts`. Deleting the latter requires simplifying the script to `"test:browser": "vitest run --config vitest.browser.config.ts"`. Also, public exports `"./advisor"` and `"./advisor/*"` must be deleted.
- General `packages/ui/vitest.browser.config.ts:418` excludes the specialized Advisor suite; delete this obsolete exclusion after deleting the suite, preserve all surviving fixture/server setup and screenshot exclusions.
- In `packages/ui/src/api/client.ts`, all Advisor DTO re-exports and the `advisor` sub-client (methods and interface) must be removed.
- In `packages/ui/src/api/ws-transport.ts`, all `advisor:*` cases in the REST invoke switch table must be removed; dedicated Advisor tests in `ws-transport.test.ts` are excised.
- The two E2E journeys `packages/ui/e2e/counsel-evaluations-responsive/` and `packages/ui/e2e/advisor-model-dropdown-theme/` are Advisor feature-only journeys and must be deleted entirely (including specs, evidence.json, review.md, and screenshots).
- In `packages/ui/e2e/fixtures/application-data.ts`, Advisor directory seeding (`advisorHistoryDir`, `advisorEvaluationsDir`), routing policy seeding, evaluations directory copy, and `[server.advisor]` in generated `dam-hopper.toml` must be cleanly removed.
- `application-readiness.ts` currently uses Advisor status to detect host HOME leakage. Replace it with authenticated `GET /api/agent-status/paths`, asserting `effectiveHome === "/e2e/home"`; current route evidence: `server/src/api/router.rs:296-297`, wire casing: `server/src/agent_status/integration.rs:166-170`.
- In `packages/ui/e2e/fixtures/application-services.ts`, `readPolicyFile(): Promise<unknown>` on `AppServices` and its implementation are removed.
- `application-services.spec.ts` L01 and L06 retain container HOME containment checks via `/api/agent-status/paths` and `effectiveHome`; remove the feature-only `readPolicyFile` assertion.
- In `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`, the journey is mixed: it must retain registration disabled-by-default, admin promotion/login, Settings inspection, Workspace workbench render, and evidence capture, while excising the Native Advisor accordion click/toggle and Workspace Advisor activity button/configuration tab.
- Entire `__fixtures__/native-advisor/` (19 files) is owned exclusively by Phase 02 and deleted.

## 5. Requirements

- R02.1: Update `packages/ui/package.json` to simplify `test:browser` and remove `./advisor` exports.
- R02.2: Remove Advisor DTO imports/exports and `ApiClient.advisor` property/type from `packages/ui/src/api/client.ts`.
- R02.3: Remove `advisor:*` cases from `packages/ui/src/api/ws-transport.ts` and excise Advisor tests from `packages/ui/src/api/ws-transport.test.ts`.
- R02.4: Delete `packages/ui/vitest.advisor-routing.browser.config.ts`, `packages/ui/browser-tests/advisor-routing.browser.tsx`, and `packages/ui/browser-tests/workspace-advisor.browser.tsx`.
- R02.14: Remove obsolete Advisor suite exclusion from `packages/ui/vitest.browser.config.ts`.
- R02.5: Delete entire directory `packages/ui/e2e/counsel-evaluations-responsive/` (all 4 files).
- R02.6: Delete entire directory `packages/ui/e2e/advisor-model-dropdown-theme/` (all 4 files).
- R02.7: Scrub Advisor directory creation, policy file seeding, evaluation copying, and `[server.advisor]` TOML from `packages/ui/e2e/fixtures/application-data.ts`.
- R02.8: Replace Advisor status safety probe with existing `/api/agent-status/paths`, reading camelCase `effectiveHome`.
- R02.9: Remove `readPolicyFile` from `AppServices` in `packages/ui/e2e/fixtures/application-services.ts`.
- R02.10: Update `packages/ui/e2e/fixtures/application-services.spec.ts` tests L01 and L06 to use the surviving safety probe and remove policy readback.
- R02.11: Update `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` to remove Advisor accordion and configuration panel interactions while preserving the full auth and workbench journey.
- R02.12: Delete entire `__fixtures__/native-advisor/` directory (all 19 files).
- R02.15: Delete repository-owned synthetic fixtures only; other-project OMP/Evcrate tooling, policies and histories remain untouched.

## 6. Architecture

Clean cutover at the transport and test fixture boundary:
```
[ApiClient / WsTransport]
       │
       └── ✕ ApiClient.advisor
       └── ✕ WsTransport 'advisor:*' cases
       └── ✕ packages/ui/package.json ./advisor exports

[Test Infrastructure]
       ├── ✕ vitest.advisor-routing.browser.config.ts
       ├── ✕ browser-tests/advisor-routing.browser.tsx
       ├── ✕ browser-tests/workspace-advisor.browser.tsx
       ├── ✕ e2e/counsel-evaluations-responsive/
       ├── ✕ e2e/advisor-model-dropdown-theme/
       ├── ✕ __fixtures__/native-advisor/
       └── Shared Safety Probe: /api/advisor/status ➔ /api/agent-status/paths
```

## 7. Related code files (exclusive)

All paths relative to `ROOT=/home/loidinh/WS/dam-hopper-ws/remove-advisor`:

### Deleted Files (30 files)
- `packages/ui/vitest.advisor-routing.browser.config.ts`
- `packages/ui/browser-tests/advisor-routing.browser.tsx`
- `packages/ui/browser-tests/workspace-advisor.browser.tsx`
- `packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.spec.ts`
- `packages/ui/e2e/counsel-evaluations-responsive/evidence.json`
- `packages/ui/e2e/counsel-evaluations-responsive/review.md`
- `packages/ui/e2e/counsel-evaluations-responsive/screenshot.png`
- `packages/ui/e2e/advisor-model-dropdown-theme/advisor-model-dropdown-theme.spec.ts`
- `packages/ui/e2e/advisor-model-dropdown-theme/evidence.json`
- `packages/ui/e2e/advisor-model-dropdown-theme/review.md`
- `packages/ui/e2e/advisor-model-dropdown-theme/screenshot.png`
- `__fixtures__/native-advisor/advisor-routing.json`
- `__fixtures__/native-advisor/advisor-routing-invalid.json`
- `__fixtures__/native-advisor/advisor-routing-v1.json`
- `__fixtures__/native-advisor/models/codex.json`
- `__fixtures__/native-advisor/models/omp.json`
- `__fixtures__/native-advisor/models/pi.txt`
- `__fixtures__/native-advisor/models/claude.json`
- `__fixtures__/native-advisor/advisor-evaluations/eval-group-a.json`
- `__fixtures__/native-advisor/advisor-evaluations/eval-group-b.json`
- `__fixtures__/native-advisor/advisor-evaluations/eval-invalid.json`
- `__fixtures__/native-advisor/advisor-history/project-metadata.json`
- `__fixtures__/native-advisor/advisor-history/13aea919e60e23089352d6284e556087ee1441c73b9ac30c076010741051bd0c/project-metadata.json`
- `__fixtures__/native-advisor/advisor-history/13aea919e60e23089352d6284e556087ee1441c73b9ac30c076010741051bd0c/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000014/execution.json`
- `__fixtures__/native-advisor/advisor-history/13aea919e60e23089352d6284e556087ee1441c73b9ac30c076010741051bd0c/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000014/outcome.json`
- `__fixtures__/native-advisor/advisor-history/fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998/project-metadata.json`
- `__fixtures__/native-advisor/advisor-history/fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000012/execution.json`
- `__fixtures__/native-advisor/advisor-history/fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000011/execution.json`
- `__fixtures__/native-advisor/advisor-history/fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000011/outcome.json`
- `__fixtures__/native-advisor/advisor-history/fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000013/execution.json`

### Modified Files (10 files)
- `packages/ui/package.json`
- `packages/ui/vitest.browser.config.ts`
- `packages/ui/src/api/client.ts`
- `packages/ui/src/api/ws-transport.ts`
- `packages/ui/src/api/ws-transport.test.ts`
- `packages/ui/e2e/fixtures/application-data.ts`
- `packages/ui/e2e/fixtures/application-readiness.ts`
- `packages/ui/e2e/fixtures/application-services.ts`
- `packages/ui/e2e/fixtures/application-services.spec.ts`
- `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`

## 8. File Ownership

Phase 02 exclusively owns all 40 files listed in Section 7. No other phase modifies these files.

## 9. Implementation Steps

1. Edit `packages/ui/package.json`:
   - Change `"test:browser"` script to: `"vitest run --config vitest.browser.config.ts"`.
   - Remove `"./advisor"` and `"./advisor/*"` entries from `"exports"`.
   - In the owned general `vitest.browser.config.ts`, remove only `browser-tests/advisor-routing.browser.tsx` from exclusions (line418); retain general browser runner configuration.
2. Edit `packages/ui/src/api/client.ts`:
   - Delete lines 7–30 (Advisor DTO imports from `../advisor/advisor-types.js`).
   - Delete lines 31–54 (Advisor DTO type re-exports).
   - Delete lines 3568–3671 (`advisor: { ... }` sub-client implementation in `createApiClient`).
   - Delete lines 4185–4231 (`advisor: { ... }` interface definition in `ApiClient`).
3. Edit `packages/ui/src/api/ws-transport.ts`:
   - Delete all `case "advisor:*":` branches in the `invoke` method REST route mapping (lines 1610–1655).
4. Edit `packages/ui/src/api/ws-transport.test.ts`:
   - Delete the `describe("WsTransport Advisor endpoints (Phase 03)", ...)` suite (lines 2166–2330).
5. Delete `packages/ui/vitest.advisor-routing.browser.config.ts`.
6. Delete `packages/ui/browser-tests/advisor-routing.browser.tsx` and `workspace-advisor.browser.tsx`.
7. Delete entire directory `packages/ui/e2e/counsel-evaluations-responsive/` (4 files).
8. Delete entire directory `packages/ui/e2e/advisor-model-dropdown-theme/` (4 files).
9. Edit `packages/ui/e2e/fixtures/application-data.ts`:
   - Remove lines 44–47 (`advisor: { primary: ..., backup: ... }` from initial policy config).
   - Remove lines 80–81, 87–88 (`advisorHistoryDir`, `advisorEvaluationsDir` creation).
   - Remove lines 103–116 (copying `advisor-routing.json` to `.evcrate`).
   - Remove lines 117–133 (copying evaluation documents).
   - Remove `\n[server.advisor]\nenabled = false` from line 160 `tomlContent`.
10. Edit `packages/ui/e2e/fixtures/application-readiness.ts`:
    - In `verifyServiceSafety(appOrigin, token)`, replace lines 41–50 (fetching `/api/advisor/status` and checking `/e2e/home/.evcrate/advisor-history`) with:
      ```ts
      const pathsRes = await fetch(`${appOrigin}/api/agent-status/paths`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!pathsRes.ok) {
        throw new Error(`Paths verification check failed: ${pathsRes.status}`);
      }
      const pathsData = (await pathsRes.json()) as { effectiveHome?: string | null };
      if (pathsData.effectiveHome !== "/e2e/home") {
        throw new Error(`Server resolved unsafe home path: ${pathsData.effectiveHome}`);
      }
      ```
11. Edit `packages/ui/e2e/fixtures/application-services.ts`:
    - Remove `readPolicyFile(): Promise<unknown>;` from `AppServices` interface (line 44).
    - Remove `readPolicyFile` method implementation (lines 304–310).
12. Edit `packages/ui/e2e/fixtures/application-services.spec.ts`:
    - In L01: use `/api/agent-status/paths`, assert `effectiveHome === "/e2e/home"`; remove feature-only policy readback.
    - In L06: use that same existing route and camelCase field; exact containment assertion must reject poisoned host HOME.
13. Edit `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`:
    - Remove lines 86–102 (Native Advisor accordion click and toggle switch).
    - Remove lines 106–116 (Advisor activity button, configuration tab, and `.policy-card` visibility).
    - In their place, assert that Settings rendered healthy surviving controls, navigate to `/workspace`, assert that Workspace workbench rendered healthy root tools (`explorer` / `terminal`), and capture the visual checkpoint.
14. Delete entire `__fixtures__/native-advisor/` directory (all 19 files).

## 10. Todo list

- [x] Update `packages/ui/package.json`
- [x] Remove obsolete Advisor suite exclusion from `packages/ui/vitest.browser.config.ts`
- [x] Modify `packages/ui/src/api/client.ts`
- [x] Modify `packages/ui/src/api/ws-transport.ts` and `ws-transport.test.ts`
- [x] Delete `vitest.advisor-routing.browser.config.ts` and browser test suites
- [x] Delete `counsel-evaluations-responsive/` and `advisor-model-dropdown-theme/`
- [x] Modify `application-data.ts`, `application-readiness.ts`, `application-services.ts`, `application-services.spec.ts`
- [x] Modify `sqlite-auth-lite-mode.spec.ts`
- [x] Delete `__fixtures__/native-advisor/`

## 11. Success Criteria

- Zero Advisor DTOs exported from `packages/ui/src/api/client.ts`.
- `ApiClient.advisor` is completely gone from TypeScript types and runtime instances.
- `WsTransport` has no mapping for `advisor:*`.
- Shared readiness and L01/L06 probes preserve real container HOME isolation via `/api/agent-status/paths` and `effectiveHome`, with no new server route.
- SQLite lite mode journey passes without Advisor interactions.
- All test fixtures in `__fixtures__/native-advisor/` removed cleanly.

## 12. Conflict Prevention

- Do not edit any files in `packages/ui/src/advisor/` or `packages/ui/src/components/` (owned by Phase 01).
- Do not edit `server/` source/test files (owned by Phase 03).
- Do not run E2E test containers or Vitest runners mid-flight.

## 13. Risk Assessment

- **Risk:** Type checking fails before Phase 01 deletes imports from `advisor/`.
  - **Mitigation:** Expected during concurrent editing. Validated as a combined batch in Phase 05.
- **Risk:** Safety loss in E2E container isolation check.
  - **Mitigation:** Existing authenticated path-verification API resolves the server's effective HOME; assert exact `/e2e/home`, including the poisoned-runner-HOME scenario.

## 14. Security Considerations

- Ensures no dead endpoints remain in client transport tables that could lead to unexpected requests.
- Preserves container isolation safety invariants in E2E fixtures without regressions.

## 15. Next steps

- Sibling Phase 03 executes Rust native backend and configuration removal in parallel.
- Hand qualified client/UI artifacts to Phase 05 for the confirmed coordinated UI/server release; do not ship client/server versions independently.
