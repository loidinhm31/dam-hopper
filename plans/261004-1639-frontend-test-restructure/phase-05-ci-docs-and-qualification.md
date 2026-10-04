# Phase 05 — CI, docs and end-to-end qualification

## Context links
- [Plan](./plan.md), [acceptance checks](./acceptance-checks.md), [capture policy](./phase-04-local-evidence-and-human-review.md).
- [Coverage inventory](./research/browser-coverage-inventory.md), current `docs/testing.md`, root `AGENTS.md`, `.github/workflows/pr-quality-gate.yml`, `scripts/run-all-tests.sh`.
- [Vitest v4 failure screenshot setting](https://v4.vitest.dev/config/browser/screenshotfailures).

## Overview
- Date: 2026-10-04. Priority: P2. Implementation: pending. Review: pending.
- Make functional application E2E required in CI; keep image creation local and human review separate. Publish correct testing commands, inventory and gaps.

## Key Insights
- Existing PR browser job runs only `test:browser`; aggregate `quality_gate` enumerates required jobs explicitly.
- `scripts/run-all-tests.sh` already owns process groups and sets `CI=1`; add E2E there rather than creating a competing aggregate wrapper.
- Browser component `advisor-routing.browser.tsx` currently overwrites canonical E2E evidence with a component capture and uses absolute path + browser-side `import.meta.env.CI`. Remove that capture or relabel it under component-only output.
- Vitest automatically captures failed headless browser tests by default. Set `browser.screenshotFailures` from the same Node capture policy in both browser configs; never bypass component assertions to suppress images.

## Requirements
- Required functional E2E CI job installs compatible Chromium, Rust and fixture-owned container prerequisites; runs all three scenarios with captures off.
- Existing component coverage remains required and distinct. No required CI screenshot-generation/visual-baseline job.
- No image generation on success or failure in capture-disabled mode, including automatic failure screenshots/videos/traces.
- Update requested `docs/testing.md` and root `AGENTS.md`; add brief existing changelog entry after verified permanent implementation.
- Inventory identifies current automated scopes, historical/manual qualification and additional integration gaps explicitly; do not implement unrequested workflows.

## Architecture
- New PR `application_e2e` job: pnpm frozen install, matching Chromium, compatible container engine/build cache, current-source production app image + canonical Rust auth-seed extension, Mongo image prefetch, E2E typecheck and `CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e`. Existing Dockerfile supplies pinned Rust/web/runtime builders; no separate host-built server substituted.
- Fixture—not GitHub's shared DB service—owns app + Mongo containers and private network, then removes exact owned resources. Production app serves real built SPA same-origin; controlled container `/etc` closes effective-HOME override risk. Compatible Docker/Podman subset; local `docker` resolves to rootless Podman.
- Add job to `quality_gate.needs`, result environment and result loop. Failed/cancelled E2E must fail aggregate gate.
- Preserve redacted service logs and assertion reports on failure with bounded retention; screenshot/video/trace defaults off. No auth storageState or tokens in uploads.
- Add `run_suite 'Application E2E tests' pnpm --filter @dam-hopper/ui test:e2e` after UI browser tests in aggregate shell wrapper.
- One shared pure `e2e/fixtures/capture-policy.ts` determines images in Playwright and both Vitest Node configs; capture helper handles only actual-app evidence. Component screenshots, if retained, go exclusively to component output and never an E2E case folder.

## Related code files
- Modify `.github/workflows/pr-quality-gate.yml`, `scripts/run-all-tests.sh`.
- Modify `packages/ui/vitest.browser.config.ts`, `packages/ui/vitest.advisor-routing.browser.config.ts` for automatic failure capture policy only; preserve functional setup.
- Modify `packages/ui/browser-tests/advisor-routing.browser.tsx` to remove misleading canonical-E2E screenshot write and touched incidental style-only assertions while retaining behavioral validation/cancel/save/scoping coverage.
- Modify `docs/testing.md`, root `AGENTS.md`, `docs/CHANGELOG.md`, `.gitignore` for ignored reports only.
- Maintained evidence/reviews and metadata remain in each case folder.

## Implementation Steps
1. Add required application E2E CI job and aggregate-gate dependency. No CI job can pass by collecting zero tests or skipping functional cases on capture-disabled runs.
2. Wire aggregate local script to application E2E under its existing CI/process-group policy.
3. Reuse Node-side capture policy in both component runner configs. Remove browser-side CI screenshot guards and cross-scope/absolute capture paths; do not affect actions/assertions.
4. Rewrite `docs/testing.md`: layer/runner table; `.spec.ts` convention; isolated-service prerequisites, seed ownership, readiness/cleanup, local-capture vs CI commands; viewport/dock checkpoint requirements; provenance/freshness; true human-review gate; forbidden synthetic/stale evidence; capture errors; pending review limitations.
5. Add compact workflow-coverage table and ranked gaps with pointers to source inventory. Distinguish component-based local storage persistence from real-backend persistence. Historical manual qualifications are not current Playwright coverage.
6. Update AGENTS build/test commands with separate `test:browser` and `test:e2e`; point to mandatory fresh local app capture + human review and CI capture-disabled assertion rules. Do not imply component images certify app integration.
7. Execute discovery/typecheck/unit/component checks and actual app journeys. Run explicit capture-enabled local mode; inspect all images and obtain human reviews; then capture-disabled CI default and explicit override, including negative capture/cleanup probes.
8. Use temporary checksum/mtime/artifact-inventory and lifecycle probes from acceptance matrix; remove scaffolds afterward. Preserve real consumer-visible capture-policy regression tests only.
9. Run aggregate command and relevant CI-equivalent commands once after integration; failures diagnosed, not hidden with retries/skips. Publish exact commands/results and unresolved gates in implementation report.
10. After smoke proof, update existing changelog; keep docs consistent with actual final commands/settings and runner behavior.

## Todo list
- [ ] Required functional CI E2E job and aggregate script integration.
- [ ] Shared CI image bypass across component/application runners.
- [ ] docs/testing.md and AGENTS.md updates; inventory/workflow gaps.
- [ ] Acceptance matrix executed; final-source screenshots human-reviewed.
- [ ] Existing changelog updated after verified implementation.

## Success Criteria
- All A/L/C functional gates pass and E gates satisfied; pending human review prevents visual acceptance, not hidden behind CI success.
- `CI=true` without `E2E_CAPTURE` and explicit capture-disabled success/failure runs produce zero images and preserve case evidence/review bytes and mtimes.
- PR gate requires functional application E2E as well as retained component suites; `test:all` includes both.
- Requested docs describe actual `.spec.ts` commands and application evidence policy, with no old Vitest-E2E command or hard-coded workstation capture path.
- Full source-backed inventory and concrete workflow gap priorities published; no wholesale component migration.

## Risk Assessment
- CI cold Rust/image/browser setup: caches and bounded startup; never reuse unrelated live services.
- Artifact leakage/image generation through defaults: turn image/video/trace capture off before Chromium startup, including failure paths.
- Local mandatory human review cannot be inferred from CI: explicit separate acceptance state and records.

## Security Considerations
Loopback-only fixture services; isolated DB names/roots; ephemeral test credentials. CI uploads only sanitized logs/assertion reports, not bearer/session state or image artifacts when disabled. No global container prune/pkill.

## Next steps
Deliver exercised implementation evidence and named residual workflow gaps. No implementation starts from this planning session. Unresolved questions: none blocking implementation; actual human image review remains an execution-time gate.
