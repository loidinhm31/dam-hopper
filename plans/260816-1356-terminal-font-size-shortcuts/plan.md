---
title: "Terminal Font Size and Shortcuts"
description: "Persist terminal font size and editable zoom shortcuts, then apply changes live to every open xterm terminal."
status: completed
priority: P2
effort: 8h
branch: feat/terminal-font-size-shortcuts
tags: [feature, frontend, backend, accessibility]
created: 2026-08-16
---

# Terminal Font Size and Shortcuts

## Overview

Feasible. xterm has mutable `options.fontSize`; `TerminalPanel` owns xterm,
`FitAddon`, resize, registry, and keys. Mutate, invalidate geometry, then fit so
xterm and PTY resize without recreating sessions.

## Preflight Contract

- **Output:** persisted size/bindings, Settings controls, live terminals, tests.
- **Acceptance:** default 13 px; 10–32 px bounds; old configs hydrate safely;
  save/reload persists; every mounted terminal updates, refits, and sends its
  existing resize path; defaults are actual `Ctrl+Alt+Shift+Equal` (+) and
  `Ctrl+Alt+Minus`; exact page matches are consumed before browser/PTY input; controls are
  accessible and editable.
- **In scope:** server/UI config compatibility, Zustand persistence, xterm
  lifecycle, shared terminal key handler, Appearance and Keyboard Shortcuts,
  unit/component/Chromium proof, manual page-level shortcut check.
- **Out of scope:** system/editor fonts, OS-global capture, per-session or
  terminal-content settings, mobile custom-key keyboard, server API redesign.
- **Risk/public contracts:** additive global UI config fields, plus-key physical
  semantics, browser-reserved chords, exact modifiers, xterm fit/PTY geometry,
  page capture and user-selected shortcut conflicts.
- **Affected systems:** server config, UI API/config/store, terminal, Settings, tests.
- **Testing:** Rust/UI tests and build; Chromium; reload/focus/split manual checks.
- **Open questions:** none.

## Design Decision

Use additive config fields and the existing settings save path. Keep stable
physical-key strings in persistence. Let each mounted `TerminalPanel` apply the
shared size reactively to its own xterm instance, then reuse the fit scheduler;
the existing `onResize` bridge remains the only PTY resize owner. Extend the
shared terminal key handler so matching zoom chords call `preventDefault`, return
`false`, and update the same store. This is smaller and safer than recreating
xterm instances, using CSS transforms, or installing duplicate per-terminal
global listeners.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Config, live xterm update, Settings, validation | Completed 2026-08-16 | 8h | [phase-01](./phase-01-terminal-font-size-shortcuts.md) |

## Side-Effect Review

- [ ] Auth, sessions, permissions, roles: no effect.
- [ ] API/client compatibility: additive optional client fields + server defaults.
- [ ] Database/migrations/data integrity: none; global TOML only.
- [ ] Business logic: terminal presentation and page-level keyboard behavior only.
- [ ] Security/privacy/secrets/logging: no new sensitive data or telemetry.
- [ ] Performance/concurrency/resources: one option mutation and scheduled fit per
  mounted terminal per change; debounced persistence; no remount.
- [ ] Docs/config/onboarding/deployment: document additive config and defaults;
  no setup step or deployment change.

## `/code` Handoff

Run `/code plans/260816-1356-terminal-font-size-shortcuts/plan.md`. Before UI
edits, invoke `ui-ux-designer` for Settings accessibility/style review; no
`docs/design-guidelines.md` exists, so preserve existing `SettingRow`,
`NumberStepper`, and `ShortcutCapture` conventions. Use the `web-testing` skill
for Chromium proof, then require tester and code-reviewer gates. Fix critical
findings, rerun affected checks, and request user approval before docs/project
finalization.

## Unresolved Questions

None.
