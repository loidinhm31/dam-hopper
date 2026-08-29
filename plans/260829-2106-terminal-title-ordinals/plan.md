---
title: "Terminal Title Ordinals"
description: "Add structured current global ordinals to every open-tab terminal title without changing session identity or backend contracts."
status: completed
priority: P2
effort: 4h
branch: develop
tags: [feature, frontend, accessibility]
created: 2026-08-29
---

# Terminal Title Ordinals

## Overview

Show every current open-tab title with its global 1-based `openTabs` ordinal while keeping the base label and `#N` as separate display parts. Render the base in a truncating region and the ordinal in a non-shrinking region, with one full `<base> #N` accessible string. This is display-only: stable navigation, actions, PTY attachment, diagnostics, and browser handoff continue to use `sessionId`.

## Chosen semantics

- Current global 1-based `openTabs` position; recalculated after attach, hydration, close, removal, or reorder. Pane-local sequences may therefore be non-contiguous.
- Never raw `sessionId`, PTY `incarnation`, per-profile count, or durable creation number. Never recover title parts or identity by regex-parsing a label.
- Internal `openTabs` retain unsuffixed base labels. One outward `DisplayTabEntry` projection adds structured `{ baseLabel, ordinal, fullText }` title data.
- Every open-tab title renderer keeps `#N` visible at narrow widths by truncating only `baseLabel`; `fullText` remains the accessible name/text.
- A free terminal missing its transient `freeTerminalIndexMap` entry uses the deliberate readable base `Terminal (starting…)`, never `Terminal ?`; once indexed it returns to `Terminal X`.
- Mounted-only browser handoff fallback entries are not current open-tab titles and may remain readable, unsuffixed `${project} · ${command}` labels. Any browser target backed by an open tab carries the same structured title for suffix-safe rendering plus its ordinal-bearing `fullText` string label.
- Matches the notification convention already documented in `docs/frontend-components.md` and `docs/system-architecture.md`; display order may change while navigation identity remains stable.
- Preserve existing control hit targets, keyboard behavior, cwd tooltip precedence, and base-label truncation. No visual redesign.

## Phase

| # | Phase | Status | Priority | Effort | Link |
|---|---|---|---|---|---|
| 1 | Terminal title ordinal display | Completed | P2 | 4h | [phase-01](./phase-01-terminal-title-ordinal-display.md) |

## Scope

Frontend presentation and focused UI coverage only. No server, REST/API, WebSocket, PTY lifecycle, database, migration, config, dependency, or visual-asset changes.

## Dependencies

- Existing global `openTabs` ordering, base-only `TabEntry.label`, and outward `tabsWithLiveSession` flow.
- Existing UI test infrastructure (Vitest plus browser-mode Vitest/Playwright) for structured title rendering, narrow-width visibility, and browser-target union behavior.
- Existing frontend guidance in `docs/frontend-components.md`, `docs/code-standards.md`, and `docs/system-architecture.md`; `docs/design-guidelines.md` is absent.

## Handoff

Implementation follows the linked phase. Validation, review, documentation, and project finalization are explicit separate responsibilities inside that phase.

## Unresolved questions

None.
