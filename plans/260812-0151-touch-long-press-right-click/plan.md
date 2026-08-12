---
title: "Touch Long-Press Context Menu"
description: "Validate that Explorer rows and editor tabs use existing Radix context menus on touch long-press without adding a gesture runtime."
status: completed
priority: P2
effort: 5h
branch: feat/touch-long-press-right-click
tags: [feature, frontend, accessibility, testing]
created: 2026-08-12
---

# Touch Long-Press Context Menu

## Outcome
Explorer rows and editor tabs must open their existing right-click menus on touch/pen hold. Radix `ContextMenu.Trigger` remains the only long-press owner (700 ms); Monaco text and preview surfaces are not goals.

## Phases

| Phase | Status | Effort | Link |
|---|---|---:|---|
| 1. Preserve trigger contract | Completed 2026-08-12 | 1h | [phase-01](./phase-01-preserve-trigger-contract.md) |
| 2. Add touch regression coverage | Completed 2026-08-12 | 3h | [phase-02-touch-regression-coverage.md](./phase-02-touch-regression-coverage.md) |
| 3. Docs, device matrix, release validation | Completed 2026-08-12 | 1h | [phase-03-docs-device-validation.md](./phase-03-docs-device-validation.md) |

## Preflight contract
- Reuse existing Tree and editor-tab action menus; preserve target identity and one-open coordination.
- No duplicate timer, global gesture listener, gesture dependency, global `touch-action`, or new menu command.
- Cancel behavior, mouse right-click, keyboard ContextMenu/Shift+F10, focus, portal placement, Escape/outside/scroll dismissal remain unchanged.
- Modify shared runtime only after a focused test proves a real defect; otherwise tests/docs are the change.

## Side-effect checklist
- [x] Auth/permissions: no change.
- [x] API/WS compatibility: no change.
- [x] Database/persistence: no change.
- [x] Business semantics: existing actions only; no selection redesign.
- [x] Security: retain marked-trigger/native-suppression boundary.
- [x] Performance: Radix's per-trigger 700 ms timer remains the only long-press timer; no global recognizer.
- [x] Docs/config/deployment: roadmap and plan evidence only; no flags, dependency, backend, or native release changes.

## Validation gate
Run UI build, focused unit tests only if needed, focused Chromium browser tests, then the full UI suites. Record physical Android Chrome/iOS Safari checks separately; Playwright/WebKit emulation is not device certification.

## Completion evidence — 2026-08-12
- Phase 01 contract audit passed: Radix remains the sole 700 ms touch/pen owner; direct `asChild` targets, trigger marker, refs, one-open coordination, focus, portal, dismissal, and existing actions remain intact. No duplicate timer, global listener, gesture dependency, or global `touch-action` added.
- Phase 02 regression evidence passed: focused unit **35/35**, focused Chromium **17/17**, full UI unit **992/992**, and serial full browser **120/120**. Coverage includes Explorer file/folder and real editor-tab targeting, touch/pen hold, movement/up/cancel/scroll/unmount cancellation, nested-control guards, native-fallback deduplication, mouse/keyboard paths, marker/suppression, focus, portal, and dismissal.
- Parallel full browser runs remain nondeterministic (**117–119/120** in latest reported runs; one fresh run also reached 120/120): failures are existing Explorer image/video readiness assertions (`naturalWidth`/`readyState`), not touch coverage; isolated media and serial runs pass. This is retained as a residual risk, not hidden.
- Phase 03 documentation/release evidence recorded the roadmap update, `git diff --check` pass, and no staged files. `coverage-v8` was unavailable because the plugin is not installed; no coverage percentage is claimed. Physical Android Chrome/iOS Safari validation remains follow-up; Linux Chromium synthetic pointer events are not device certification.
- Review approved **8.5/10**, no blockers. No auth, API/WS, database, persistence, security boundary, configuration, deployment, or native bridge change.

## Unresolved questions
Physical-device release matrix and whether long-press on an unselected Explorer row should change selection remain follow-up product decisions; preserve current behavior for this plan.
