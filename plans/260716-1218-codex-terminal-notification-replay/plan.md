---
title: "Prevent replayed Codex terminal notifications"
description: "Suppress OSC 9 delivery during retained xterm-buffer replay while preserving later live notifications."
status: completed
priority: P2
effort: 3h
branch: main
tags: [bugfix, frontend, terminal, notifications]
created: 2026-07-16
---

# Prevent replayed Codex terminal notifications

## Overview

Prevent historical PTY scrollback from re-alerting when Workspace remounts or a terminal reconnects. Render historical bytes unchanged; deliver every subsequent live OSC 9 event, including identical payloads.

## Design decision

Use a per-`TerminalPanel` replay gate. It starts before xterm receives `terminal:buffer` data and closes only in xterm's write completion callback. Live PTY data that arrives during that callback window queues in arrival order and flushes only after the gate closes. No notification fingerprint persistence, no server filtering, no WebSocket changes.

## Phases

| #   | Phase                              | Status                         | Effort | Plan                                                              |
| --- | ---------------------------------- | ------------------------------ | -----: | ----------------------------------------------------------------- |
| 1   | Replay-safe delivery lifecycle     | completed 2026-07-16 13:14 +07 |     2h | [phase-01](./phase-01-replay-safe-notification-lifecycle.md)      |
| 2   | Regression coverage and validation | completed 2026-07-16 13:38 +07 |     1h | [phase-02](./phase-02-replay-notification-regression-coverage.md) |

## Dependencies

- Existing xterm write completion callback; no package or server dependency change.
- Existing Vitest UI package test setup.

## Scope

In: Codex OSC 9 delivery while processing `terminal:buffer` replay. Out: OSC 10 color handling, persisted notification history, generic payload deduplication, server protocol changes.

## Unresolved questions

None.
