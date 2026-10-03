---
title: "Fix PR 41 review findings and add PR quality gate"
description: "Resolve Cognito Heavy Blur review findings and replace slow packaging-first PR CI with parallel deterministic quality gates."
status: in-progress
priority: P1
branch: fix/cognito-privacy-blur
created: 2026-10-03
---

# PR 41 review fixes and PR quality gate

## Acceptance criteria
- Heavy Blur feature query probes the exact filter value it applies.
- Reduced-transparency docs/tests state only the cascade behavior actually proven.
- Remove content-dependent screenshot luminance thresholds from the regression.
- PR metadata no longer claims pixel-sampling evidence.
- Every PR to main runs deterministic lint, builds/typechecks, all JS/Rust/browser test suites, native platform checks, and release-contract checks.
- Expensive desktop installer packaging remains tag/manual release work, not PR quality evidence.
- One stable `Quality Gate` job fails unless all required PR jobs succeed.

## Parallel phases

| Phase | Ownership | Depends on |
| --- | --- | --- |
| 01 Cognito review fixes | `packages/ui/src/index.css`, `packages/ui/browser-tests/cognito-mode.browser.tsx`, `docs/frontend-components.md`, `docs/CHANGELOG.md`, prior Cognito plan metadata | none |
| 02 PR CI | `.github/workflows/pr-quality-gate.yml`, `.github/workflows/release.yml` | none |
| 03 Integration | PR body + validation/review | 01, 02 |

## Phase 01
1. Probe `blur(20px) saturate(140%)` in both standard and prefixed `@supports` alternatives.
2. Remove screenshot pixel sampling and arbitrary RGB thresholds.
3. Rename reduced-transparency regression to describe forcing/verifying the production CSS override, not OS preference emulation.
4. Qualify reduced-transparency docs with "where supported".
5. Correct prior plan branch metadata to `fix/cognito-privacy-blur`.

Validation:
- UI typecheck/build.
- UI unit suite.
- Full UI browser suite.
- Lint changed TS/CSS-adjacent sources through repo lint.

## Phase 02
1. Add `PR Quality Gate` on every PR to `main`, with concurrency cancellation.
2. Run in parallel:
   - lint + TS/Vite builds/typechecks for all workspace apps/packages;
   - shared, browser-bridge, UI, and native Vitest suites;
   - full Chromium browser suite;
   - server Rust fmt/clippy/test on Linux plus Windows server tests;
   - native Rust fmt/clippy/test/build on Linux;
   - mandatory Windows SSH-forward/native gates;
   - Linux and Windows release-contract syntax/asset-gate checks.
3. Add terminal `Quality Gate` aggregator requiring all jobs.
4. Remove `pull_request` from desktop release packaging workflow; preserve tag/manual triggers.

Non-goals:
- Publishing releases.
- Android/iOS runtime builds.
- Privileged systemd install/rollback tests.
- macOS qualification not represented by current release workflows.

## Phase 03
- Re-read diff against findings.
- Inspect the new GitHub Actions run created by the branch update.
- Report exact completed/queued/failed evidence; never infer success from config alone.

## Risks
- Stronger CI may expose pre-existing failures; keep failures blocking and fix/root-cause them rather than weakening checks.
- Parallel runners trade more compute for lower wall-clock latency.
- Browser mode must install Chromium/dependencies explicitly.

## Unresolved questions
None blocking.
