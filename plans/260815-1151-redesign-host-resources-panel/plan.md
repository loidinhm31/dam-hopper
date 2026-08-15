---
title: "Redesign Host Resources Panel"
description: "Reorder Host resources into a glance-first meter panel with pinned storage and one diagnostic disclosure."
status: completed
priority: P2
effort: 13h
branch: main
tags: [feature, frontend, backend, accessibility]
created: 2026-08-15
---

# Redesign Host Resources Panel

## Overview

Make the popover useful at a glance without changing host collection: Memory used, CPU, pinned storage with the compatibility/default disk in parentheses, every temperature, then battery/power. Keep active status visible; place all diagnosis and pin controls in one disclosure.

## Design Contract

- Reuse `useHostMetrics`, `useHostResourceSnapshot`, `useHostResourceAlerts`, and their current polling/cache ownership. No endpoint, sampler, alert, or remediation changes.
- Persist only optional exact mount point: API `hostResourcePinnedMount`, TOML `host_resource_pinned_mount`; no pin defaults to `HostMetrics.disk`.
- Missing saved mount remains named and missing. Never rebind it or use a different mount as if selected.
- Use visible numbers plus bounded meters for real percentages. Temperature shows `°C` in the same row grammar without percentage/range semantics.
- Missing, stale, invalid, or unsupported data stays explicit; never coerce to zero.

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Config and preference contract | **Completed** | 100% | 3h | [phase-01](./phase-01-config-preference-contract.md) |
| 2 | Glance and diagnostic disclosure UI | **Completed** | 100% | 6h | [phase-02](./phase-02-glance-disclosure-ui.md) |
| 3 | Automated/browser validation and docs | **Completed** | 100% | 4h | [phase-03](./phase-03-validation-docs.md) |

Completion evidence: Phase 1 backend nullable preference, validation, aliases, TOML mapping, null-clear persistence, and frontend default normalization were delivered with focused Rust tests (17 + 4) and UI Vitest coverage (169 files / 1064 tests). Phases 2–3 added the glance projection, exact pin resolution, single disclosure, semantic meters, temperature semantics, pin controls, and regression/browser fixtures. Final UI validation passed (171 files / 1073 tests), the dedicated host-resource browser file passed (13/13), `pnpm test`, TypeScript build, lint, and `git diff --check` passed. `pnpm check` reached native packaging but could not sign artifacts because `TAURI_SIGNING_PRIVATE_KEY` is not configured. Architecture and frontend component docs were updated; configuration/API reference docs remain a follow-up.

## Dependency Flow

Phase 1 precedes Phase 2. Phase 3 validates both. UI implementation may begin against the agreed TypeScript shape while backend tests are being completed, but merge only after the persistence contract passes.

## Release Gates

- Backend config round-trip, alias, null-clear, and bound rejection pass.
- UI unit/component tests prove stable ordering, exact pin resolution, missing/stale states, and no fake temperature percentage.
- Chromium covers semantic selectors, pin persistence/missing mount, keyboard/focus/Escape, all sensors, and 320px/desktop layouts.
- `pnpm test`, UI test/build/browser scripts, `pnpm lint`, then `pnpm check` pass.

## Unresolved Questions

1. Should “overall” retain the current workspace/default `HostMetrics.disk` meaning, as designed, or become a true cross-mount aggregate requiring a separate telemetry contract?
2. Is the proposed temperature treatment—numeric Celsius plus neutral meter-like track, with no percent or invented threshold—acceptable?
3. Should disclosure open state remain session-local React state, as planned, or persist across reloads?

## Completion Notes

- Phase 2 delivered fixed glance order, finite-value handling, exact storage pin/missing behavior, temperature rows without meter semantics, and one keyboard-accessible diagnostic disclosure.
- Phase 3 delivered pure/component regression coverage and Chromium fixture updates; focused validation passed as recorded above.
- No source files were changed by the finalization pass; architecture and frontend component documentation were updated to describe the shipped behavior.

## Non-blocking Follow-ups

- Re-run `pnpm check` in a signing-configured release environment.
- Align configuration/API reference docs with the shipped preference/UI ownership.
- Obtain product confirmation on “overall” terminology, neutral temperature treatment, and session-local disclosure persistence.
