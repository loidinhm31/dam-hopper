---
title: "Separate component coverage from application E2E"
description: "Retain Vitest browser regressions; add isolated Playwright application journeys and authentic local evidence gates."
status: pending
priority: P2
branch: main
tags: [refactor, frontend, infra, testing]
created: 2026-10-04
---

# Frontend testing restructure

## Decision
Plan only; **no implementation authorized or performed**. Implement the [confirmed advisor direction](../reports/advise-261004-1527-frontend-test-evidence.md) without wholesale component migration.

- Keep useful Vitest unit/browser-component coverage. Inventory: 53 browser files / 259 source-declared cases; three additional E2E-labelled files are component mounts, not app journeys.
- Add matching `@playwright/test` 1.61.1 with separate discovery, commands and typecheck. Convert only privacy, Advisor routing/theme and Evaluations responsive cases to `.spec.ts`.
- Run actual built `apps/web` + production `dam-hopper-server` in fixture-owned app container, with separate isolated Mongo/AuthStore; deterministic policy/evaluation/files and model fallback. Controlled `/etc` is required because effective Advisor HOME can override `$HOME`. Preauthenticated session bootstrap is setup, **not login/MFA qualification**.
- Interact through real app controls. No fake shell, React mounts, AppState/store injection or mocked app APIs. Independently read persisted routes; assert privacy input isolation and real narrow-docked layout bounds.
- Require fresh local full-application viewport PNGs + revision/seed/checkpoint provenance + actual human inspection. Existing images do not satisfy freshness.
- One capture policy covers Playwright and Vitest automatic failure images. CI runs unchanged functional assertions with zero screenshot/video/image-trace generation by default; no required CI visual job.
- Update `docs/testing.md`, root `AGENTS.md`, existing changelog, aggregate scripts and required PR gate. Record additional workflow gaps; do not implement them mechanically.

## Phases
| # | Phase | Status / progress | Dependency |
|---|---|---|---|
| 1 | [Inventory and runner separation](./phase-01-inventory-and-runner-separation.md) | Pending / 0% | None |
| 2 | [Isolated application services](./phase-02-isolated-application-services.md) | Pending / 0% | 1 |
| 3 | [Three actual application journeys](./phase-03-real-application-journeys.md) | Pending / 0% | 2 |
| 4 | [Local evidence and human review](./phase-04-local-evidence-and-human-review.md) | Pending / 0% | 3 |
| 5 | [CI, docs and qualification](./phase-05-ci-docs-and-qualification.md) | Pending / 0% | 1–4 |

Capture policy may be developed with runner setup; canonical captures/review happen only after journeys and relevant final source are stable. Keep integration owner responsible for shared config/scripts.

## Evidence and acceptance
- [Complete application/authenticity/cleanup/CI acceptance matrix](./acceptance-checks.md): A01–A08, E01–E07, L01–L06, C01–C05; commands and negative scenarios.
- [Project-wide suite/workflow inventory](./research/browser-coverage-inventory.md): retained suites, external gates, source counts and prioritized gaps.
- [Application fixture feasibility](./research/application-fixture-feasibility.md): current startup/auth/storage/seed/navigation seams and limitations.
- [Enhanced hard-planning brief](./reports/planning-brief.md): full scope, loaded workflow/skills and plan-state limitation.

## Acceptance invariants
1. Three cases navigate actual app + production backend under isolated auth/data; all retained meaningful component checks remain component-labelled.
2. Local enabled capture errors fail; passing fresh images show complete application, measured checkpoint/viewport and matching source identity.
3. Human reviews name exact image/run/source identities; CI success alone cannot certify visual acceptance.
4. Success, assertion/startup failure, timeout and catchable cancellation dispose owned children/containers/ports/temp roots; never unrelated resources. Host death/SIGKILL limitations stated.
5. Default CI and explicit disabled runs execute same scenarios, preserve existing evidence/review bytes+mtimes and generate no images even on failure.
6. Docs/AGENTS use real runner commands, `.spec.ts` convention and evidence/review gate; inventory distinguishes historical/manual/native qualification from current app E2E.

## Boundaries and dependencies
- Prerequisites: pnpm install, exact Playwright Chromium, compatible Docker/Podman image build/runtime (production Dockerfile supplies pinned Rust/web toolchains), current-source app/auth-seed images + Mongo. No personal service reuse.
- Retire old `.e2e.tsx` harnesses, arbitrary-buffer capture helper and absolute/component-to-E2E image writes; no aliases/shims.
- No blanket visual baseline system, retries, sharding, login/MFA feature work, legacy plugins or conversion of every browser component suite.
- Research performed statically; no application tests, new captures or human reviews claimed during planning.

## Unresolved questions
None blocking implementation design. Real human review must occur after fresh final-source application captures. Hook active-plan metadata could not persist (`EVCRATE_SESSION_ID` absent); use this plan directory explicitly.

## Validation Summary
Validated: 2026-10-04. Three material decisions confirmed via user interview; implementation remains pending.
- Production app + Mongo containers; controlled `/etc`, no production home/auth bypass.
- Real persisted authenticated-session seed; login/MFA UI stays an explicit workflow gap.
- Colocated `review.md` records genuine human inspection tied to exact fresh run/source/image identities.
- No phase revision needed; all selected options match the written design.
- [Validation answers and disposition](./reports/validation-answers.md).
