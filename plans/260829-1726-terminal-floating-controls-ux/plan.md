---
title: "Terminal Floating Controls UX"
description: "Make floating terminal controls responsive and safe-area aware while preserving Enter and Backspace across Terminal Keys and custom Type."
status: completed
priority: P2
effort: 4h
branch: develop
tags: [frontend, terminal, mobile, accessibility, testing]
created: 2026-08-29
---

# Terminal Floating Controls UX

## Outcome
Small shared-UI cutover: expose the bottom-right terminal corner, keep the scroll rail clear above the floating Keys/Type triggers, and make Enter available through Terminal Keys while retaining the five-row custom Type Enter/Backspace controls. Preserve Del, native Type Enter/Backspace, active-session routing, focus/event isolation, and terminal host height.

## Progress
- Overall: `100%` — completed; focused implementation, browser verification, build, and final review approved
- [Phase 01 — Implement and verify floating-control UX](phase-01-implement-and-verify-floating-controls.md): `100%` — completed; final responsive, accessibility, and transport behavior approved

## Scope
- In: `packages/ui` terminal-control components, keyboard/key definition libraries, focused unit/browser tests.
- Out: backend/server, API, database/schema, auth/permissions, settings/config, deploy, assets, new global state, unrelated keys such as Ctrl-D or duplicate controls.
- No new abstraction unless coordinated positioning cannot remain clear with equivalent local constants.

## Delivery contract
1. `/code` calls `ui-ux-designer` before edits, then implements the phase.
2. Focused tests and UI build/typecheck pass.
3. `tester` checks behavior, `web-testing` records real Chromium geometry/focus/event evidence, then `code-reviewer` performs the final gate.
4. Implementation reports unrelated baseline failures only when reproduced during `/code` verification.

Representative `320x420`, `375x700`, `700x375`, `1280x700`, and `1440x700` geometry proves both triggers are in bounds with a 48px baseline plus additive `var(--safe-area-bottom, 0px)` clearance; the scroll rail reserves `6.25rem` plus its gap and switches to compact two-column controls in short viewports without collision. Expanded panels reserve a `6.875rem` trailing lane plus safe-right, remain bounded by max-height, and contain horizontal overflow. Terminal Keys exposes `Esc`, `Tab`, `Ctrl+C`, `Enter`, `PgUp`, `PgDn`, and arrows; Enter sends CR to the active session. Custom Type uses a five-row US 60%-style physical layout with Enter and Backspace on base and function layers; responsive keycaps range from 24px to 44px widths with 4px to 8px gaps, 44px minimum height, centered/stretching rows, and contained narrow-width scrolling. Shift labels and modifier-aware ARIA remain intact; compact shell avoids double bottom safe-area reservation. Focus/event isolation, native Type behavior, Del/backspace, active-session routing, and terminal host height remain unchanged. Focused UI units (4 files/24 tests), the UI TypeScript build, direct Chromium accessory checks (10/10), and final scroll/pane browser checks (7/7) passed; final code review approved.

## Assumptions
- Enter is available in Terminal Keys and remains present in the custom Type base and function layers.
- No Ctrl-D and no redundant Del are added to Terminal Keys.
- `docs/design-guidelines.md` is absent; implementation follows `docs/code-standards.md` and `docs/frontend-components.md`.

## Completion
Implementation, focused verification, responsive browser evidence, and final review are complete. No follow-up implementation handoff remains.

## Unresolved questions
None.
