---
title: "Terminal Pin Reload Persistence"
description: "Preserve terminal pin protection across same-tab browser reloads with bounded client-only storage and stale-state cleanup."
status: completed
priority: P2
effort: 5h
branch: main
tags: [bugfix, frontend, terminal]
created: 2026-08-10
---

# Terminal Pin Reload Persistence

## Outcome

Pinned terminal tabs restore their pin UI and close protection after a full reload while the same server terminal session remains active. Unpinning persists too. No server, API, config, database, or terminal-lifecycle contract changes.

## Preflight contract

- **Output:** same-tab reload-safe pin state for the active terminal session.
- **Acceptance:** restored pin control/hidden close action; unpin survives reload; malformed/unavailable storage never breaks terminal startup; stale/closed IDs are removed.
- **Scope:** `packages/ui` terminal manager, pure persistence/auto-attach helpers, focused tests, current frontend behavior docs.
- **Out:** cross-device/cross-tab sync, server persistence, PTY lifecycle changes, layout persistence changes.
- **Risks:** stale IDs; query/hydration ordering; storage parse/access/quota failures; pending-session races.
- **Testing:** targeted Vitest, Chromium browser-facing remount/storage test, UI package build, manual full reload.
- **Open questions:** none.

## Decision

| Option | Result |
|---|---|
| Versioned `sessionStorage` set of pinned IDs | Chosen: reload-safe, tab-scoped, minimal data |
| `localStorage` | Reject: survives browser-tab lifetime and leaks state across tabs |
| Server/config field | Reject: new public contract and stale-data ownership |

Restore IDs only after/while reconciling an authoritative live-session snapshot. Explicit toggles write through immediately; reconciliation prunes absent IDs. All storage operations fail open to normal unpinned UI.

## Phase

| # | Phase | Status | Effort | Progress | Link |
|---|---|---|---:|---:|---|
| 1 | Persist, hydrate, clean, validate | Completed | 5h | 100% | [phase-01](./phase-01-persist-hydrate-clean-validate.md) |

## Side-effect review

- [x] Auth/session/permissions: browser-tab storage only; not auth session or access control.
- [x] API/client compatibility: no request, response, transport, or server changes.
- [x] Database/config/data: no schema/migration/config; storage payload versioned and IDs-only.
- [x] Business logic: pin remains UI close protection, not process-exit/admin protection.
- [x] Security/privacy/logging: no commands, output, paths, tokens, or new logs stored.
- [x] Performance/concurrency: tiny deduplicated set; no storage event/cross-tab coordination.
- [x] Docs/onboarding/deploy: update current frontend contract only; no deployment work.

## Completion

Completed 2026-08-10 02:55 +07:00. Focused UI Vitest validation passed: 5 files, 37 tests. Implementation, docs, and acceptance criteria complete; no backend/API/config changes in scope.

## Architecture gate

Internal flow remains `useTerminalManager -> TabEntry.isPinned -> Traditional/Runtime renderers`; only a guarded browser-tab persistence adapter joins manager hydration. `docs/system-architecture.md` needs no structural change. Update `docs/frontend-components.md`; preserve completed historical plan/roadmap wording as history.

## Handoff

Implement only [Phase 01](./phase-01-persist-hydrate-clean-validate.md). Stop if authoritative session readiness cannot be distinguished from an initial empty/loading result.

## Unresolved questions

- None.
