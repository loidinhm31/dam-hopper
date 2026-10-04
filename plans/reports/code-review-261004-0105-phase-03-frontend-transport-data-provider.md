# Code Review Report: Phase 03 — Frontend Transport and Data Provider

**Review Date**: 2026-10-04  
**Plan Reference**: `plans/261003-1822-advisor-routing-model-selector/phase-03-frontend-transport-data-provider.md`  
**Reviewer**: Phase03CodeReviewer  
**Score**: 9.8/10  

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `packages/ui/src/advisor/advisor-types.ts`
  - `packages/ui/src/advisor/advisor-data-provider.ts`
  - `packages/ui/src/advisor/index.ts`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/ws-transport.ts`
  - `packages/ui/src/advisor/native-advisor-provider.ts`
  - `packages/ui/src/advisor/AdvisorPanel.test.tsx`
  - `packages/ui/src/advisor/native-advisor-provider.test.ts`
  - `packages/ui/src/api/ws-transport.test.ts`
- **Lines of code analyzed**: ~679 lines modified/added across 9 files.
- **Review focus**: Frontend transport and data provider extensions for native Advisor routing and model discovery (`PATCH /api/advisor/policy`, `POST /api/advisor/models`).
- **Updated plans**: `plans/261003-1822-advisor-routing-model-selector/phase-03-frontend-transport-data-provider.md`.

### Overall Assessment
Exemplary implementation conforming strictly to architecture and frozen contracts. All five requirements and success criteria fully satisfied:
1. Exact camelCase DTOs align 1:1 with server Rust definitions.
2. Owner-bound `ApiClient` and REST channel mapping preserve connection ref and avoid global settings lookup.
3. Native request controller supersession cleanup properly guards against race conditions where older requests delete newer controllers.
4. Capability probe decouples history-directory availability from routing capabilities while correctly revoking capabilities when disabled or unauthenticated.
5. Structured `ApiRequestError` codes (e.g. 409 conflict, `ROUTE_BACKUP_IDENTICAL`, `POLICY_FILE_UNSAFE`) mapped with precedence before regex fallbacks.
6. Test coverage is comprehensive across unit, transport, cancellation/supersession, and edge error cases.

---

## Critical Issues
None. Zero breaking changes, security vulnerabilities, or regressions.

---

## Warnings (High Priority Findings)
None.

---

## Medium Priority Improvements
None.

---

## Low Priority Suggestions
1. **Preserve HTTP status on fallback error mapping**:
   - *File*: `packages/ui/src/advisor/native-advisor-provider.ts:275`
   - *Detail*: If an `ApiRequestError` arrives with an unrecognized `err.code` and non-standard status, it falls through to `throw new AdvisorError(msg, 'UNKNOWN')`, omitting `err.status`.
   - *Suggestion*: Preserve `status` when available on fallback:
     ```ts
     const status = err instanceof ApiRequestError ? err.status : undefined;
     throw new AdvisorError(msg, 'UNKNOWN', status);
     ```
2. **Typo in internal abort reason**:
   - *File*: `packages/ui/src/advisor/native-advisor-provider.ts:192`
   - *Detail*: String `'Superseeded by new request'` has a minor typo; standard English spelling is `'Superseded by new request'`.

---

## Positive Observations
1. **Race-safe controller release**: `releaseRequestController` validates `this.activeControllers.get(requestId) === controller` before deletion, completely eliminating same-ID supersession race bugs. Consistently applied across all 10 provider methods in `finally` blocks.
2. **Strict abort checks before & after `await`**: Every asynchronous provider method checks `checkAborted` immediately before dispatch and after `await`, ensuring cancelled operations never resolve stale data to consumers.
3. **Capability decoupling**: `probeStatus` cleanly separates history directory availability (`status.available`) from policy routing capabilities (`status.enabled`). Disabled or failed authentication cleanly revokes all capabilities to prevent unauthorized write attempts.
4. **DRY & YAGNI**: Reuses `PolicyReadCurrentResultDto` as `updatePolicy` result shape without introducing redundant DTO aliases. No extraneous client caching or synthetic fallbacks.
5. **Clean tests**: 100% test pass rate across all 69 focused tests and 2,259 total UI suite tests. Thorough edge case assertions for 409 conflict, supersession races, and payload structure.

---

## Recommended Actions
1. Proceed with Phase 04 (Frontend UI Inline Card Editor) integration using the implemented `updatePolicy` and `listModels` methods on `AdvisorDataProvider`.
2. Consider applying low-priority suggestions (status preservation on fallback error, spelling fix) during Phase 04 cleanup if convenient.

---

## Metrics
- **TypeScript Typecheck**: 100% pass (`tsc --noEmit` exited 0 with 0 errors).
- **Test Pass Rate**: 100% (2,259 passed, 0 failed, 0 skipped across 297 test files; 69 passed in focused test files).
- **Security & Authorization**: Bounded 16 KiB server payload limit respected; Bearer auth and session credentials forwarded; zero credential leaks.

---

## Validation Commands and Results

| Command | Status | Output / Summary |
|---|---|---|
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json` | Passed | Exit 0, 0 type errors |
| `pnpm --filter @dam-hopper/ui test src/advisor/native-advisor-provider.test.ts src/api/ws-transport.test.ts src/advisor/AdvisorPanel.test.tsx` | Passed | 3 test files, 69 passed, 0 failed (0.79s) |
| `pnpm --filter @dam-hopper/ui test` | Passed | 297 test files, 2,259 passed, 0 failed (17.91s) |

---

## Unresolved Questions
None. Implementation is complete and ready for Phase 04 consumption.
