---
title: "Floating Terminal Key Controls"
description: "Float the existing Keys and Type controls over active desktop and mobile terminal surfaces without reducing xterm space."
status: completed
priority: P2
effort: 6h
branch: main
tags: [feature, frontend, terminal, accessibility]
created: 2026-08-06
---

# Floating Terminal Key Controls

## Overview

Reuse `MobileTerminalAccessoryBar` state and write behavior while replacing its mobile-only in-flow placement with one safe-area-aware overlay per active terminal surface. Match `TerminalScrollButtons`, preserve expanded key/keyboard behavior, and keep responsive input-suppression policy independent from control visibility.

## Phase

| # | Phase | Status | Progress | Effort | Link |
| --- | --- | --- | --- | --- | --- |
| 1 | Implement and verify | Completed | 100% | 6h | [phase-01](./phase-01-implement-and-verify.md) |

## Dependencies

- Existing terminal host positioning in `TerminalRuntimeOutput` and `MultiTerminalDisplay`
- Existing `MobileTerminalAccessoryBar` state, transport writes, and keyboard policy
- Existing `TerminalScrollButtons` visual/event conventions and safe-area CSS variables
- `/code` handoff quality gates: `ui-ux-designer`, tester, `web-testing` Chromium validation, then `code-reviewer`

## Scope boundary

- Included: terminal UI mounting/placement, responsive policy separation, focused tests, Chromium desktop/mobile evidence, component docs.
- Excluded: backend, API/client contracts, settings/schema, global state, portals, deployment/config changes.

## Unresolved questions

- None blocking. Review approved 9/10 on 2026-08-06 22:51 +07:00 (Asia/Saigon).
