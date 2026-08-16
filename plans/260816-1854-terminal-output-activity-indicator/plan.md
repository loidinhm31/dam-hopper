---
title: "Terminal Output Activity Indicator"
description: "Add browser-local recent-output state to every mounted Runtime terminal row without changing server transport."
status: in-progress
priority: P2
effort: 9h
branch: feat/terminal-output-activity-indicator
tags: [feature, frontend, terminal, accessibility]
created: 2026-08-16
---

# Terminal Output Activity Indicator

## Overview

Observe non-empty live terminal chunks at the post-replay xterm write seam. Publish content-free per-session transitions to Runtime rows: green receiving, yellow quiet after 3 seconds, gray stream unavailable, stopped red/muted. No backend, SSE, protocol, persistence, or configurable threshold.

## Accepted design

- Source: existing `/ws` `terminal:output` after `TerminalPanel` replay gating.
- Scope: every mounted panel, including hidden kept-alive terminals.
- Store: memory-only, session-keyed, timestamp-aware, transition notifications only.
- Precedence: stopped > stream unavailable > recent output > quiet.
- Window: fixed 3,000 ms; replay and synthetic banners do not count.

## Phases

Plan progress: Phases 01–02 complete (2/3 phases, 67%); Phase 03 pending.

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Activity store and lifecycle publisher | DONE 2026-08-16 22:52:22 +07:00 | 100% | 4h | [phase-01](./phase-01-activity-store-and-lifecycle.md) |
| 2 | Runtime row presentation | DONE 2026-08-17 00:44:18 +07:00 | 100% | 2h | [phase-02](./phase-02-runtime-row-presentation.md) |
| 3 | Regression coverage and validation | Pending | 0% | 3h | [phase-03](./phase-03-regression-coverage-and-validation.md) |

## Dependencies

- Existing `WsTransport` per-ID listener dispatch and `TerminalPanel` replay gate.
- Existing mounted-session identity and `TerminalKeepAliveHost` lifecycle.
- Existing Runtime row `alive` metadata and UI test/browser harnesses.

## Scope boundary

- In: frontend store, panel lifecycle integration, Runtime row UI/a11y, focused tests, post-implementation architecture reconciliation.
- Out: backend, SSE, transport/protocol fields, persistence, server timers, unmounted-session telemetry, command-running or health inference.

## References

- [Architecture gate](../../docs/system-architecture.md#browser-local-terminal-output-activity)
- [Accepted brainstorm](../reports/brainstorm-260816-1854-terminal-output-activity-indicator.md)

## Completion gate

Focused unit/browser tests, type-check, UI test suite, build, docs validation, and architecture-vs-implementation review pass with no per-chunk subscriber notifications or output-content retention.

## Unresolved questions

- Exact accessible wording/tooltips and stopped color token; implementation may choose one consistent set matching the accepted four-state semantics.
