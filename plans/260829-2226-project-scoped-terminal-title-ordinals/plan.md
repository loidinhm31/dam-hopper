---
title: "Project-Scoped Terminal Title Ordinals"
description: "Correct open-terminal title numbering so each project owns an independent current sequence."
status: completed
priority: P2
effort: 3h
branch: develop
tags: [bugfix, frontend, accessibility]
created: 2026-08-29
---

# Project-Scoped Terminal Title Ordinals

## Overview

Correct only title ordinal grouping: preserve current global `openTabs` order, but count each exact project key independently. Project A may show `#1/#2` while project B starts at `#1`. Existing `OpenTerminalTitle`, suffix-safe renderers, `fullText`, and `sessionId` identity remain unchanged.

## Status and progress

- **Plan:** Completed
- **Progress:** 1/1 phases complete
- **Preflight:** Complete; no open contract questions
- **Implementation:** Completed; focused validation and review passed

## Phase

| # | Phase | Status | Priority | Effort | Link |
|---|---|---|---|---|---|
| 1 | Project-scoped title ordinals | Completed | P2 | 3h | [phase-01](./phase-01-project-scoped-title-ordinals.md) |

## Scope

- Add optional, production-populated project metadata to frontend `TabEntry`.
- Populate metadata for pending/opened and hydrated/auto-attached tabs.
- Project structured titles with a per-project counter and one stable projectless/free sentinel.
- Update focused title/manager/hydration/browser coverage and existing frontend behavior docs.
- Keep notification `terminalOrder` globally ordered; title grouping is a separate presentation rule.
- No backend, API, WebSocket, PTY, database, persistence, config, dependency, notification-order, or renderer redesign.

## Dependencies

- [Correction preflight](../reports/preflight-260829-2226-project-scoped-terminal-title-ordinals.md)
- [Completed global-title plan](../260829-2106-terminal-title-ordinals/plan.md), now superseded only for title grouping
- Existing `OpenTerminalTitle`/`TerminalTitleText` pipeline and current `openTabs` state order

## Handoff

Implement the linked phase as one frontend correction. Preserve array order and all `sessionId` keys/callbacks; never infer project identity from display labels. Run only focused tests, then an actual Chromium two-project smoke. Treat notification ordering and mounted-only fallbacks as no-change regression boundaries.

## Unresolved questions

None. Preflight fixes per-project semantics and the stable projectless/free grouping policy.
