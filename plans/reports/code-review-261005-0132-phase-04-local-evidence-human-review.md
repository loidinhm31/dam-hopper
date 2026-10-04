# Code Review Report: Phase 04 — Local Evidence and Human Review

**Date:** 2026-10-05  
**Reviewer:** Phase04Reviewer  
**Plan Reference:** [Phase 04 — Local evidence and human review](../261004-1639-frontend-test-restructure/phase-04-local-evidence-and-human-review.md)  
**Score:** 9.4 / 10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `packages/ui/e2e/fixtures/capture-policy.ts` (39 LOC)
  - `packages/ui/e2e/fixtures/capture-evidence.ts` (313 LOC)
  - `packages/ui/e2e/fixtures/capture-evidence-types.ts` (34 LOC)
  - `packages/ui/e2e/fixtures/capture-png-validator.ts` (25 LOC)
  - `packages/ui/e2e/fixtures/capture-source-fingerprint.ts` (74 LOC)
  - `packages/ui/e2e/fixtures/application-fixture.ts` (84 LOC)
  - `packages/ui/e2e/fixtures/application-data.ts` (130 LOC)
  - `packages/ui/e2e/fixtures/application-services.ts` (236 LOC)
  - `packages/ui/e2e/fixtures/image-builder.ts` (4 LOC changed)
  - `packages/ui/vitest.browser.config.ts` (2 LOC changed)
  - `packages/ui/vitest.advisor-routing.browser.config.ts` (2 LOC changed)
  - `packages/ui/src/lib/capture-policy.test.ts` (47 LOC)
  - `packages/ui/src/lib/capture-evidence.test.ts` (114 LOC)
  - `packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.spec.ts` (1 LOC changed)
  - `.gitignore` (added `packages/ui/.e2e-staging/`)
  - `packages/ui/e2e/e2e-capture-helper.ts` (deleted, 0 lingering references)
  - Generated evidence & reviews:
    - `packages/ui/e2e/advisor-model-dropdown-theme/` (`screenshot.png`, `evidence.json`, `review.md`)
    - `packages/ui/e2e/counsel-evaluations-responsive/` (`screenshot.png`, `evidence.json`, `review.md`)
    - `packages/ui/e2e/privacy-heavy-blur/` (`screenshot.png`, `unmasked-before.png`, `evidence.json`, `review.md`)
- **Lines of code analyzed:** ~1,200 LOC
- **Review focus:** Architectural integrity, security (zero credential leakage, strict path traversal guards), robustness, performance, YAGNI/KISS/DRY adherence.
- **Updated plans:**
  - `plans/261004-1639-frontend-test-restructure/phase-04-local-evidence-and-human-review.md` (completed todos, status updated)
  - `plans/261004-1639-frontend-test-restructure/progress.md` (reconciled Phase 04 to DONE, Phase 05 next)

---

## Overall Assessment

Phase 04 successfully completes the local evidence, provenance, and human visual review lifecycle:
1. **Single Node Policy:** Pure `capture-policy.ts` governs Playwright and both Vitest browser runners (`screenshotFailures: shouldCaptureE2E()`). Correct precedence (`E2E_CAPTURE` overrides > `CI` fallback) tested thoroughly.
2. **Atomic Evidence Publication:** Complete application viewport PNGs staged in `.e2e-staging/<runId>`, validated before promotion, and published only upon passing test assertions AND clean backend/container teardown. Failed/skipped runs wipe staging without modifying case dirs.
3. **Strict Path & URL Traversal Prevention:** `resolveCaseDestination` enforces allowlisted subdirectories under `packages/ui/e2e`, rejecting directory escapes (`..`, `/`, `\\`) in checkpoint names. Screenshot captures assert local fixture origin (`http://127.0.0.1:` / `http://localhost:`).
4. **Zero Credential Leakage:** Sensitive tokens and MFA keys are hashed into deterministic `seed_digest`. `evidence.json` contains no raw credentials or workstation paths.
5. **Source Fingerprint Invalidation:** Records git HEAD + dirty status hash at session start and verifies stability at completion, preventing drift or self-invalidating test runs.
6. **Human Visual Review Enforcement:** Fresh runs generate `review.md` with status `PENDING_HUMAN_REVIEW` and exact SHA-256 digests matching `evidence.json`. Automation cannot forge human approval.

---

## Critical Issues (MUST FIX)

**None.** No security vulnerabilities, credential leaks, path traversal vectors, or breaking changes.

---

## Warnings (SHOULD FIX)

1. **Hardcoded Browser Version in Evidence Metadata:**
   - **Location:** `packages/ui/e2e/fixtures/capture-evidence.ts:263`
   - **Details:** `browser_version: "1.61.1"` is static. While matching current `@playwright/test` version, future engine updates could cause drift in `evidence.json`.
   - **Recommendation:** Retrieve runtime browser version dynamically via `page.context().browser()?.version()` during checkpoint capture and store it in `EvidenceSession`.

---

## Suggestions (NICE TO HAVE)

1. **Git Porcelain Quoted Path Handling in Fingerprint:**
   - **Location:** `packages/ui/e2e/fixtures/capture-source-fingerprint.ts:43`
   - **Details:** `git status --porcelain=v1` wraps paths containing spaces in double quotes (`"path/to file.png"`).
   - **Recommendation:** Strip wrapping quotes (`filePath.replace(/^"(.*)"$/, "$1")`) before running extension/prefix filters to avoid edge-case filter bypasses.
2. **Dynamic Device Pixel Ratio Measurement:**
   - **Location:** `packages/ui/e2e/fixtures/capture-evidence.ts:266`
   - **Details:** `device_pixel_ratio: 1` is hardcoded.
   - **Recommendation:** Query `await page.evaluate(() => window.devicePixelRatio)` to record authentic DPR under high-DPI emulation runs.
3. **Stale Staging Directory Pruning:**
   - **Location:** `packages/ui/e2e/fixtures/capture-evidence.ts:88`
   - **Details:** Staging uses temporary folders in `.e2e-staging/<runId>`. If a run is killed with `SIGKILL`, staging dirs might linger.
   - **Recommendation:** Add a fast startup purge of `.e2e-staging` folders older than 1 hour on runner initialization.

---

## Positive Observations

- **Zero-Dependency PNG Validator:** `validatePngBuffer` uses raw Buffer parsing for 8-byte magic numbers and big-endian IHDR width/height decoding, avoiding external image parsing dependencies.
- **Strict Teardown Ordering:** `finalizeEvidenceSession` is invoked in the outermost `finally` of `appServices` fixture after child fixtures (`authenticatedPage`, `authenticatedContext`) and `services.dispose()` conclude.
- **Byte-for-Byte Checkpoint Parity:** Generated PNGs for all 3 cases match SHA-256 digests in `evidence.json` and `review.md` exactly.
- **Clean Legacy Cutover:** `e2e-capture-helper.ts` deleted cleanly with zero dangling imports or dead code.

---

## Validation Commands & Results

1. **TypeScript E2E Typecheck:**
   - `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
   - **Result:** PASSED (0 errors)
2. **TypeScript UI Build Typecheck:**
   - `pnpm --filter @dam-hopper/ui exec tsc -p tsconfig.json`
   - **Result:** PASSED (0 errors)
3. **ESLint Linting:**
   - `pnpm exec eslint packages/ui/e2e/fixtures/capture* packages/ui/src/lib/capture*`
   - **Result:** PASSED (0 errors, 0 warnings)
4. **Vitest Capture Unit Tests:**
   - `pnpm --filter @dam-hopper/ui test src/lib/capture`
   - **Result:** PASSED (2 test files, 18 tests passed in 181ms)
5. **Checksum & Dimensions Validation:**
   - `sha256sum packages/ui/e2e/**/screenshot.png packages/ui/e2e/**/unmasked-before.png`
   - **Result:** PASSED (exact match against `evidence.json` and `review.md`)
6. **Prior Verification Suite (Re-verified):**
   - Playwright fixture probes: 7/7 passed
   - Playwright journeys (`E2E_CAPTURE=1`): 3/3 passed
   - Playwright journeys (`CI=true / E2E_CAPTURE=0`): 3/3 passed, 0 file modifications

---

## Unresolved Questions

**None.** Implementation and test coverage are complete. Visual reviews remain in `PENDING_HUMAN_REVIEW` as designed pending human visual inspection signoff.
