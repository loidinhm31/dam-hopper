---
title: "Terminal diagnostics context-menu refactor"
description: "Move workspace diagnostics export to session title context menus with one terminal-panel time window."
status: pending
priority: P2
effort: 6h
branch: main
tags: [refactor, frontend]
created: 2026-07-15
---

# Terminal Diagnostics Context-Menu Refactor

## Overview

Replace the workspace-wide diagnostics toolbar action with `Export Diagnostics` on terminal title context menus in traditional and runtime modes. Keep one time-window selector in the shared terminal header and preserve the current export JSON/download contract.

## Preflight Contract

- **Output:** session-scoped terminal diagnostics export from title right-click menus.
- **Acceptance:** both modes expose the item; clicked session is the sole `terminalIds` value; header window drives export; filename/schema/tail settings stay unchanged.
- **In scope:** workspace UI, shared diagnostics controls, prop wiring, focused tests, architecture text correction.
- **Out of scope:** Rust/backend changes, API/type changes, new diagnostics fields, touch long-press, terminal lifecycle changes.
- **Risk/public contracts:** `POST /api/diagnostics/export` remains unchanged; auth and redaction remain server-owned; exported terminal output remains potentially sensitive.
- **Expected systems:** `packages/ui` terminal headers, runtime navigator, diagnostics export UI/library, related tests, `docs/system-architecture.md`.
- **Testing:** focused Vitest, UI package tests/build, lint, manual right-click/export in both modes.
- **Open questions:** none; treat session scope as exact backend terminal selection while retaining current global/browser-error frontend semantics.

## Design Decision

Use workspace-owned menu/window state and explicit callbacks through both terminal trees. Per-mode export state duplicates behavior; a new React context adds unnecessary indirection. Extract only reusable selector/menu UI.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Shared controls and export state | Pending | 2h | [phase-01](./phase-01-shared-session-export-controls.md) |
| 2 | Traditional/runtime menu wiring | Pending | 2.5h | [phase-02](./phase-02-wire-terminal-title-context-menus.md) |
| 3 | Tests, review, docs | Pending | 1.5h | [phase-03](./phase-03-validation-review-and-docs.md) |

## Side-Effect Review

- Auth/session/permissions: unchanged; existing protected mutation used.
- API/client/database: no request, response, schema, or migration changes.
- Business meaning: terminal portions become exactly clicked-session scoped; frontend global errors stay current behavior.
- Security/privacy: retain warnings and redaction; never log export content.
- Performance/concurrency: one mutation; disable duplicate selection while pending; no terminal hot-path work.
- Config/deployment: none. Docs: correct workspace export entry point.

## Handoff

Run `/code plans/260715-2027-terminal-diagnostics-context-menu/plan.md`. For frontend review, use `frontend-design`/UI-UX review; `docs/design-guidelines.md` is absent, so preserve existing CSS variables, dimensions, and context-menu patterns.

## Unresolved Questions

- None.
