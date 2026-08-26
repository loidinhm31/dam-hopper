# Codex Notification Terminal Navigation

**Status:** Completed
**Date:** 2026-07-15
**Priority:** High

## Goal

Show `Project · Bash #N` in Codex native notifications and let selecting a
notification reveal, select, and focus the originating xterm.

## Preflight Contract

- **Output:** richer Codex notification metadata plus direct terminal navigation.
- **Acceptance:** preserve Codex title/body; show current project and 1-based open-terminal order; click focuses the app, reveals Terminal, selects the live session, and focuses xterm; stale sessions no-op.
- **Scope:** `packages/ui` frontend and frontend architecture docs only.
- **Non-goals:** Rust, WebSocket, auth, persistence, permission, or agent recognition changes.
- **Public risk:** native Notification click lifecycle and concurrent `WorkspacePage` diagnostics edits.
- **Testing:** focused Vitest, Chromium browser integration, UI typecheck, web build, and feature-scoped lint.
- **Open questions:** none.

## Design

Use a typed window-event bridge keyed by stable `sessionId`. Pass current open-tab
order to mounted terminal panels for display only. `WorkspacePage` owns reveal and
focus because it already owns workspace/surface and terminal-manager state.
Notification metadata has its own budget so the original body retains its full
180-character allowance. A session may use the mounted-and-registered fallback
only when `alive` is undefined; an explicit `alive: false` is always rejected.

Rejected: broad callback prop plumbing; shared navigation store for one event.

## Phases

- [x] [Phase 01: Implement and validate](./phase-01-implement-and-validate.md) (completed)

## Completion

- Codex notifications include sanitized `Project · Bash #N` context while preserving the original title/body.
- Popup selection reveals the originating live session and focuses its xterm; stale sessions remain a no-op.
- Chromium coverage verifies the actual OSC9-to-Notification-to-click-to-`WorkspacePage`-to-xterm path, including compact/coarse-pointer behavior without forcing the native keyboard.
- Focused tests, Chromium tests, UI typecheck, production web build, feature-scoped lint, and `git diff --check` passed. Repository-wide lint still reports unrelated pre-existing errors outside this feature.
- Final review scored 9.5/10 with no critical findings or warnings; user approved on 2026-07-15.

## Side-Effect Review

- Auth/session/permissions: unchanged.
- API/client/database: unchanged.
- Security/privacy: no terminal output added; only project label and ordinal.
- Performance/concurrency: one window listener; stale session guarded.
- Docs/config/deployment: frontend docs only; no config or deployment change.
