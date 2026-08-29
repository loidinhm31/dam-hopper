---
title: "Terminal Touch Keyboard and Smooth Scroll"
description: "Prevent terminal scroll controls from opening the mobile keyboard and provide smooth coarse-pointer xterm touch scrolling."
status: completed
priority: P1
effort: 5h
branch: develop
tags: [feature, frontend, terminal, accessibility]
created: 2026-08-28
---

# Fix: terminal scroll buttons trigger keyboard + janky touch scroll

Status: DONE · Completed: 2026-08-29 16:48:06 +07:00

## Decision
Fix two Android-coarse-pointer regressions without changing desktop behavior: (1) scroll controls open soft keyboard, (2) xterm v6 touch scrolling is janky without buffered line scrolling and bounded fling.

## Phases
Plan progress: Phases 01–02 complete (2/2 phases, 100%); plan DONE 2026-08-29 16:48:06 +07:00.

1. [Scroll controls no longer trigger keyboard](phase-01-scroll-controls-keyboard.md) — DONE 2026-08-28 18:04:32 +07:00
2. [Native smooth touch scroll](phase-02-native-smooth-scroll.md) — DONE 2026-08-29 16:48:06 +07:00

## Preflight contract
- Output: `TerminalScrollButtons` no longer focuses/activates IME on Android Chrome; xterm v6 terminal touch scrolling uses custom `scrollLines` handling with the viewport's `touch-action: none`; desktop mousewheel/keyboard scroll unchanged.
- Acceptance: on Android Chrome (coarse pointer), tapping toggle/scroll buttons does not open keyboard, `document.activeElement` is not xterm textarea, `inputMode` stays suppressed; drag/flick scroll on the terminal is handled through xterm line scrolling and remains visually smooth; desktop mousewheel/keyboard scroll unchanged; existing vitest + browser tests pass.
- Scope: `packages/ui` terminal UI only. In: `TerminalScrollButtons.tsx`, `terminal-touch-scroll.ts`, `TerminalPanel.tsx` callsite, CSS touch handling. Out: server, agent store, tunnel, non-terminal pages, `android-chrome-input-policy` global guard (already correct), xterm config.
- Non-goals: new scroll UI, changing global IME policy, reworking xterm theming.
- Risks/public contracts: touch/pointer event handling affects all mobile terminals; must not break desktop click/keyboard access; `bindTerminalTouchScroll` remains the sole touch-scroll binding in `TerminalPanel.tsx`.
- Affected files: `packages/ui/src/components/organisms/TerminalScrollButtons.tsx`, `packages/ui/src/lib/terminal-touch-scroll.ts`, `packages/ui/src/components/organisms/TerminalPanel.tsx`, `packages/ui/src/index.css`, and focused browser coverage.
- Testing: targeted UI build, full UI Vitest, focused terminal browser regressions, and coarse-pointer Chromium swipe evidence recorded below.
- Open questions: none.

## Delivered implementation and validation

- xterm v6 does not expose a native scroll container contract for this interaction; coarse-pointer touch gestures are translated into buffered, rAF-flushed `terminal.scrollLines(rows)` calls with bounded fling decay.
- `.xterm .xterm-viewport` and `.xterm .xterm-scrollable-element` use `touch-action: none`, with contained overscroll, touch momentum, and smooth programmatic scrolling CSS.
- Scroll controls preserve `scrollToTop`, `scrollLines`, and `scrollToBottom` actions; pointer/touch guards prevent xterm focus and IME activation.
- Validation report: [QA terminal touch scroll](../reports/qa-260829-1552-terminal-touch-scroll-validation.md). UI build PASS (tsc -p tsconfig.json, 5.99s); final full UI Vitest PASS (208/208 files, 1351/1351 tests); final focused terminal browser regression PASS (2/2 files, 10/10 tests); Chromium mobile-emulation swipe moved the xterm scrollbar from 280px to 158px and a temporary 2000px page spacer kept scrollY at 0. Physical Android hardware validation was not performed.

## Side-effect review
- Auth/session: no change.
- API/client compat: no API change; touch behavior is client-only.
- DB/schema: none.
- Business logic: scroll actions same (`scrollToTop/Bottom`, `scrollLines`).
- Security/privacy: no input logging; `preventDefault` scoped to controls only.
- Perf/concurrency: buffer touch deltas and flush through xterm `scrollLines` on animation frames; avoid per-event layout work and keep CSS touch policy explicit.
- Docs/config/deploy: no config; mention in CHANGELOG if needed.

## Research
- CodeGraph scout: `TerminalScrollButtons`, `TerminalRuntimeOutput`, `terminal-touch-scroll`, `MobileTerminalCustomKeyboard`, `android-chrome-input-policy`, `TerminalPanel`
- Prior plan ref: `plans/260805-2058-android-chrome-keyboard-suppression` (global guard pattern)

## Handoff
`/code plans/260828-1430-terminal-touch-keyboard-and-smooth-scroll/plan.md` — phase and parent plan finalized; physical Android hardware validation remains a release follow-up.
