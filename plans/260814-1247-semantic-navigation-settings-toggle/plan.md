---
title: "Global semantic navigation Settings toggle"
description: "Add a protected, workspace-persisted semantic navigation toggle with live supervisor lifecycle control."
status: completed
priority: P2
effort: 13h
branch: feat/semantic-code-navigation-lsp
tags: [feature, frontend, backend, api, security]
created: 2026-08-14
---

# Global Semantic Navigation Settings Toggle

## Overview
Global server/workspace control for Rust/JS/TS semantic navigation; default off, fail-closed, persisted only in the active `dam-hopper.toml` `[server.semantic].enabled`.

## Preflight contract
- Acceptance: visible Settings switch; off by default; invalid/missing signed bundle disables it with a clear reason; active TOML persistence; live apply; off cleans sessions/prewarm/results; on admits new work; auth/trust/bundle fences remain.
- In scope: existing semantic Rust/JS/TS + Settings/API/query tests, browser flow, minimal docs. No Java enablement, profile/project toggle, bundle/deployment redesign, or unrelated Settings refactor.
- Guardrails: protected settings API, authenticated `/ws/semantic`, no host `PATH` fallback, no production port `4800` contact.

## Architecture decision
| Option | Decision |
|---|---|
| A. Dedicated protected semantic settings endpoint + active TOML + mutable supervisor | **Choose**: narrow mutation, atomic ownership, live lifecycle fence, smallest blast radius. |
| B. Reuse full `PUT /api/config` and sync supervisor | Reject: replacement semantics can overwrite unrelated config and couples semantic lifecycle to broad reload side effects. |
| C. UI/global-config-only preference | Reject: backend cannot enforce admission or clean server sessions. |

Wire contract: `GET/PATCH /api/settings/semantic-navigation`; PATCH `{enabled:boolean}`; response `{enabled, available, disabledReason}`. `available` derives from verified bundled Rust/JS/TS descriptors, never PATH; enabling while unavailable returns a stable conflict without writing TOML.

## Phases
| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Runtime/config/API lifecycle | completed | 4h | [phase-01](./phase-01-runtime-config-api-lifecycle.md) |
| 2 | Client query and Settings control | completed | 3h | [phase-02](./phase-02-client-query-settings-control.md) |
| 3 | Lifecycle fences and integration behavior | completed | 3h | [phase-03](./phase-03-lifecycle-fences-and-integration.md) |
| 4 | Tests, docs, validation, review | completed | 3h | [phase-04](./phase-04-tests-docs-validation-review.md) |

## Side-effect review checklist
- [x] Auth/authorization: route protected; `/ws/semantic` auth/origin/trust unchanged.
- [x] Data/migrations: no migration; atomic active-TOML edit; no global/per-project storage.
- [x] Security: signature verification and safe reason mapping; no PATH/host detail; fail closed.
- [x] Concurrency: workspace guard + supervisor lifecycle gate; generation/epoch fences; rollback on write/reload failure.
- [x] Performance: no polling; bounded cleanup; no restart; existing process/session caps retained.
- [x] Config/workspace: reload and switch synchronize mutable enabled state; default false survives missing field.
- [x] Docs/deployment: update config/API/architecture semantics only; no bundle or deployment redesign.

## /code handoff
Implement phases in order. Before code, obtain ui-ux-designer review using existing `SettingsAppearanceSection` + `SettingRow` + `Switch` patterns (no `docs/design-guidelines.md` exists). Update `docs/system-architecture.md` architecture sections before implementation, then reconcile implementation drift during review.

## Completion record
- **Completed:** 2026-08-14 15:28 +07:00; Phases 01–04 implemented and approved.
- **Evidence:** protected server-owned GET/PATCH, active-TOML persistence, mutable supervisor fencing, WS invalidation, Settings control, architecture/API/config docs; Rust 813 passed (1 ignored), UI 1,038 passed, TypeScript/build/lint/format/diff checks passed; review approved 8/10.
- **Approved residuals:** TOML comments/trivia may be rewritten; availability may be stale after bundle mutation; live browser and signed-bundle enable/editor validation incomplete; production port `4800` not contacted.

## Unresolved questions
None.
