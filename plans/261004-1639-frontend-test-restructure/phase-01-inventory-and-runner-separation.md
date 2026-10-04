# Phase 01 — Inventory and runner separation

## Context links
- [Plan](./plan.md), [confirmed direction](../reports/advise-261004-1527-frontend-test-evidence.md).
- [Coverage inventory](./research/browser-coverage-inventory.md); current `packages/ui/package.json`, both Vitest browser configs, `packages/ui/vite.config.ts`.

## Overview
- Date: 2026-10-04. Priority: P2. Implementation: pending. Review: pending.
- Establish truthful execution scopes; retain targeted browser regressions. No blanket conversions.

## Key Insights
- General Vitest browser config currently includes both `browser-tests/**/*.browser.{ts,tsx}` and `e2e/**/*.e2e.{ts,tsx}`.
- `advisor-routing.browser.tsx` runs separately against a loopback backend but mounts `AdvisorPanel`; still backend-backed component coverage.
- UI `test` uses Vitest's default discovery. New Playwright `.spec.ts` files would also match Vitest unless explicitly excluded.
- UI `tsconfig.json` includes only `src`; new runner/fixture/spec TypeScript requires an explicit typecheck scope.

## Requirements
- Unit/logic, browser component, application E2E commands have disjoint test discovery.
- Keep both useful browser-component runners. Backend-backed component tests do not become application evidence by relabeling.
- Add `@playwright/test` pinned to existing `playwright` version `1.61.1`; update pnpm lockfile. Declare Node types where runner compilation needs them.
- Chromium initial target; one worker, no retries, no sharding or pixel-baseline infrastructure.
- Every inventory row names runner, setup, meaningful behavior, workflow and retain/migrate/gap disposition.

## Architecture
- Vitest unit: existing `.test.ts(x)` behavior coverage; exclude E2E fixtures/specs and browser suites from unit discovery.
- Vitest browser: only `.browser.ts(x)` under `browser-tests`; specialized advisor config unchanged in scope.
- Playwright Test: `packages/ui/playwright.config.ts`, `testDir: ./e2e`, `testMatch: **/*.spec.ts`; actual web application only.
- Proposed commands: `test:e2e`, `test:e2e:typecheck`; keep `test` and `test:browser` names/scopes.
- Browser choice honors existing `BROWSER_CHANNEL` / `BROWSER_EXECUTABLE_PATH` exclusivity and Chromium fallback behavior. Do not create a generic cross-runner abstraction just for small launch-option duplication.

## Related code files
- Modify `packages/ui/package.json`, `pnpm-lock.yaml`, `packages/ui/vitest.browser.config.ts`, `packages/ui/vite.config.ts` (Vitest unit discovery).
- Create `packages/ui/playwright.config.ts`, `packages/ui/tsconfig.e2e.json`.
- Retain `packages/ui/vitest.advisor-routing.browser.config.ts` and existing browser suites.
- Publish maintained workflow classification in `docs/testing.md`; detailed source inventory stays in this plan's research report.
- Later phase removes obsolete `.e2e.tsx` cases; never retain compatibility aliases or old E2E commands.

## Implementation Steps
1. Refresh the source inventory; compare discovered suites with the research report. Distinguish source test counts from executed pass counts; flag historical reports separately.
2. Add matching Playwright Test dependency and Node types; regenerate lockfile through pnpm.
3. Create runner config with independent discovery, Chromium, fixed viewport/locale/timezone, `workers: 1`, `retries: 0`, CI `forbidOnly`, bounded test/expect/startup deadlines. Fixture owns dynamic application URL; no `reuseExistingServer`.
4. Remove `e2e` from Vitest browser includes. Explicitly exclude `e2e/**` from unit discovery using Vitest's existing/default exclusions plus the new scope boundary, not a replacement that admits node_modules.
5. Add E2E typecheck config covering config, fixtures and specs without changing production TS scope.
6. Run list/discovery commands after real specs land. Verify exactly three application cases and no `.browser` imports into Playwright or `.spec` imports into Vitest.
7. Preserve component behavior for focus, cancellation, owner/generation fences, native browser APIs, terminal geometry and media boundaries. Port only unique consumer-visible checks lost by removal; delete redundant/incidental class, exact-style or wording assertions in touched cases rather than re-pinning them.

## Todo list
- [ ] Complete project-wide suite/workflow matrix.
- [ ] Separate dependencies, commands, discovery and typecheck.
- [ ] Preserve both useful component runners.
- [ ] Document integration gaps without mass migration.

## Success Criteria
- `pnpm --filter @dam-hopper/ui exec playwright test --list` discovers only the three real journeys.
- `pnpm --filter @dam-hopper/ui exec vitest list --config vitest.browser.config.ts` discovers only general browser suites; specialized config lists advisor-routing only.
- Unit discovery does not load Playwright `.spec.ts` or Node service fixtures.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck` passes; application specs use no React mounting, Vitest imports, frontend store mutation or mocked app APIs.
- Inventory accounts for all current suites and other browser/native smoke surfaces; every removed assertion has a redundancy or incidental-behavior rationale.

## Risk Assessment
- Accidental double-discovery: list all three scopes before executing full verification.
- Loss of focused regression coverage: explicit disposition per touched behavior, not file relocation by naming.
- Extra dependency/version skew: match Playwright Test and Playwright exact versions.

## Security Considerations
- Runner must never attach to developer's running services or browser profile.
- Test reports do not contain credentials. Generated Playwright output belongs in ignored output directories, not alongside reviewed evidence.

## Next steps
Phase 02 provides isolated application services; Phase 03 supplies actual runnable specs. Definition checks are not runtime acceptance. Unresolved questions: none.
