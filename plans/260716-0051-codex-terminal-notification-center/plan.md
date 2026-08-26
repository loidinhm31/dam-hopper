---
title: "Codex terminal notification center"
description: "Add a session-only bell, unread feed, and top-right toasts for existing Codex OSC 9 notifications."
status: completed
priority: P2
effort: 4h
issue: null
branch: main
tags: [feature, frontend]
created: 2026-07-16
completed: 2026-07-16T01:36:24+07:00
---

# Codex Terminal Notification Center

## Overview

Fan the existing normalized Codex OSC 9 event into a bounded in-memory notification center while preserving native browser delivery.

## Preflight Contract

- Output: top-right bell/feed and toast viewport in `@dam-hopper/ui`.
- Acceptance: unread badge (`99+` cap); newest-first feed; item read, mark-all-read, clear; max 3 toasts; 6-second auto-dismiss; manual dismiss; item/toast selects terminal; native-denied still delivers in-app.
- Scope: session-only, max 50 history records, Codex OSC 9 only, existing master setting gates all channels.
- Non-goals: persistence, backend/API/database, service workers, cross-device sync, new dependencies, generic agent-activity signals.
- Public risks: responsive header placement, duplicate events, stale terminal targets, focus/accessibility, timer cleanup.
- Tests: store/integration unit tests, browser component/navigation tests, UI build and lint.
- Open questions: none.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Implement and validate | Completed 2026-07-16 01:36 +07 | 4h | [phase-01](./phase-01-implement-and-validate.md) |

## Side-Effect Review

- Auth/session/roles: unchanged. Native browser permission remains native-channel only.
- API/client/database: no contract or schema changes.
- Security/privacy: sanitized terminal text retained only in process memory; bounded to 50.
- Performance/concurrency: bounded arrays and three toast timers; cleanup on dismissal/unmount.
- Config/deploy/onboarding: no changes. Existing Codex notification toggle remains master switch.
- Docs/architecture: existing system architecture remains valid; this is a local UI event fan-out.

## Dependencies

- Existing `TerminalAgentNotification` parser/type.
- Existing terminal selection dispatcher.
- Existing Zustand, Lucide, React, Tailwind design tokens.
