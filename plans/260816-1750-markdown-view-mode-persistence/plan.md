---
title: "Markdown View Mode Persistence"
description: "Persist one global Markdown Edit, Split, or Preview mode across projects and workspaces."
status: completed
priority: P2
effort: 3h
branch: main
tags: [feature, frontend, persistence]
created: 2026-08-16
---

# Markdown View Mode Persistence

## Outcome

Markdown files use one browser-local Edit, Split, or Preview mode across projects and workspaces; new, invalid, unavailable, or malformed state safely uses Split.

## Preflight Contract

- **Output:** focused versioned browser-storage helper, `MarkdownHost` integration, unit tests, Chromium cross-project/workspace test.
  - **Acceptance:** all modes survive remount, tab close/reopen, and in-place switching between project/workspace identities; the localStorage-backed mount path remains reload-safe; one global mode is shared; controls expose `aria-pressed`; storage failures never block editing.
- **In scope:** `packages/ui` helper, host, focused tests. **Out:** per-file/per-project mode maps, `Tab`/Zustand projection change, backend/API/database/config/auth, cross-device or cross-tab sync.
- **Risk/contracts:** private non-sensitive local state only; no public or server contract change.
  - **Testing:** targeted Vitest helper suite; Chromium `test:browser` fixture for remount/in-place switching; UI TypeScript build and lint. Full-page reload is not claimed as automated evidence.
- **Open questions:** none; use the requested localStorage-helper design as the implementation decision.

## Decision and Trade-offs

| Option | Decision | Trade-off |
|---|---|---|
| Versioned localStorage scalar shared by the app origin | Chosen | Smallest design; every project and workspace sees the same mode and reloads smoothly. |
| Versioned localStorage map keyed by `tabKey` | Reject | Incorrectly creates per-file/per-project behavior. |
| Add mode to persisted `Tab` | Reject | Creates tab-scoped state and expands editor-store persistence. |
| Server/project config | Reject | Adds unnecessary public/state contract. |

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Persistence helper and host integration | Completed | 2h | [phase-01](./phase-01-persistence-helper-and-host-integration.md) |
| 2 | Focused test coverage and validation | Completed | 1h | [phase-02](./phase-02-focused-test-coverage-and-validation.md) |

## Side-Effect Review

- [x] Auth/session/permissions/roles: no effect; this is not auth or session state.
- [x] API/public compatibility: no requests, responses, transports, or public exports change.
- [x] Database/data/config: no schema, migration, backend, project-file, or config change.
- [x] Business behavior: only Markdown presentation preference changes; default remains Split.
- [x] Security/privacy/logging: store only mode and existing non-sensitive key; no logs, secrets, or content.
- [x] Performance/concurrency: one small write per toggle; no storage-event or synchronization protocol.
- [x] Docs/onboarding/deploy: architecture invariant is already documented; no deployment/onboarding work.

## Handoff

Implemented [Phase 01](./phase-01-persistence-helper-and-host-integration.md) and [Phase 02](./phase-02-focused-test-coverage-and-validation.md). Keep malformed or blocked storage fail-open to Split and never add mode to `Tab`.

## Unresolved Questions

- None.
