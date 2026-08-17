# Phase 01: Terminal Font Size and Shortcuts

## Context Links

- [Overview](./plan.md)
- [Server UI config](../../server/src/config/schema.rs)
- [CamelCase to TOML normalization](../../server/src/config/global.rs)
- [Server config API validation](../../server/src/api/config.rs)
- [UI API contract](../../packages/ui/src/api/client.ts)
- [UI config compatibility](../../packages/ui/src/lib/ui-config.ts)
- [Settings persistence](../../packages/ui/src/stores/settings.ts)
- [xterm lifecycle](../../packages/ui/src/components/organisms/TerminalPanel.tsx)
- [Terminal shortcut adapter](../../packages/ui/src/lib/terminal-keyboard-shortcuts.ts)
- [Fit scheduler](../../packages/ui/src/lib/terminal-fit-scheduler.ts)
- [Appearance Settings](../../packages/ui/src/components/organisms/SettingsAppearanceSection.tsx)
- [Keyboard Shortcut Settings](../../packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx)
- [System architecture](../../docs/system-architecture.md)

## Overview

- **Date:** 2026-08-16
- **Priority:** P2
- **Status:** Completed 2026-08-16
- **Goal:** persist one shared terminal font size and two editable zoom chords,
  apply them immediately to every mounted xterm, and preserve terminal sessions.

## Key Insights

- Feasible without terminal recreation. `TerminalPanel` constructs xterm at 13
  px, holds `termRef`, registers a `FitAddon`, and already routes terminal resize
  events to the PTY. xterm's `options.fontSize` is mutable.
- Font metrics affect rows, columns, cursor geometry, overlays, and the backend
  PTY. Mutation must therefore invalidate suggestion geometry and schedule a fit;
  direct CSS scaling is incorrect.
- The Zustand settings store already gives optimistic local application,
  bounded setters, default hydration, patch-only debounced save, and rollback.
- `withUiConfigDefaults` is the old-server/old-config compatibility seam. New
  client config properties should stay optional at the wire boundary but become
  required after normalization and in the store.
- Existing shortcut parsing matches physical `KeyboardEvent.code` plus exact
  modifiers. `Ctrl+Alt+` is invalid because `+` is the separator, not a key.
  The plus default must persist as `Ctrl+Alt+Shift+Equal`; minus is
  `Ctrl+Alt+Minus`.
- `TerminalPanel` reads shortcut settings from `useSettingsStore.getState()` for
  each key event, so changed bindings can take effect without replacing the
  xterm custom handler.
- The existing `ShortcutCapture` records physical codes and the `NumberStepper`
  owns bounded numeric entry, but both need contextual accessible names for the
  new controls.
- No `docs/design-guidelines.md` exists. Preserve current Settings component
  vocabulary and obtain `ui-ux-designer` review during `/code`.

## Requirements

### Functional

1. Add global UI config fields:
   - `terminalFontSize` / `terminal_font_size`, default `13`, valid `10..=32`.
   - `terminalFontSizeIncreaseShortcut` /
     `terminal_font_size_increase_shortcut`, default
     `Ctrl+Alt+Shift+Equal` (the actual `+` character chord).
   - `terminalFontSizeDecreaseShortcut` /
     `terminal_font_size_decrease_shortcut`, default `Ctrl+Alt+Minus`.
2. Missing fields in existing JSON/TOML hydrate to defaults; camelCase updates
   serialize to the snake_case global TOML keys without changing the API shape.
3. Appearance Settings exposes a `Terminal font size` number stepper, 10–32 px.
4. Keyboard Shortcuts exposes independently editable Increase terminal font size
   and Decrease terminal font size capture rows, including explicit +/Equal
   semantics and reset-to-default controls.
5. A Settings change applies optimistically to every mounted/open terminal. New
   terminals start at the current value. Save rejection rolls UI and terminals
   back through the existing store behavior.
6. After each effective size change, invalidate terminal-dependent suggestion
   geometry and schedule one fit. Let the existing xterm resize listener send
   the resulting rows/columns to the PTY. Do not emit a parallel resize call.
7. A page-level exact configured keydown consumes browser input, adjusts one step
   within bounds, and uses debounced persistence. The xterm handler also consumes
   the same event before PTY input.
   Extra/missing modifiers, keyup, and unrelated keys remain unchanged. Repeated
   or composing matches must not leak to the PTY; composition must not change size.

### Non-functional

- No xterm disposal/recreation, scrollback loss, focus steal, output mutation,
  duplicate per-terminal global listener, new dependency, or per-terminal
  persisted state.
- Strict TypeScript; additive serde defaults/aliases; current camelCase API and
  snake_case TOML conventions remain intact.
- Controls have contextual names for numeric input, increment/decrement, capture,
  and reset actions. Error text remains visible to assistive technology.
- Hidden/split/keep-alive terminals remain safe: a hidden fit may no-op, while
  existing visibility/layout fits reconcile it when shown.
- Keep implementation inside existing modules unless a pure helper is necessary
  for testability; do not introduce a font-size service or alternate registry.

## Architecture

```text
global config TOML
  -> GET global config -> withUiConfigDefaults -> Zustand settings
  -> Appearance NumberStepper / ShortcutCapture rows
  -> optimistic saveDebounced patch -> PUT UI config -> TOML normalization
  -> TerminalPanel size subscriber -> xterm.options.fontSize
                                   -> invalidate geometry
                                   -> scheduleTerminalFit
                                   -> xterm onResize -> existing PTY resize

page or focused xterm keydown
  -> shared terminal key handler -> exact persisted shortcut match
  -> preventDefault + return false -> store size +/- 1 -> same live path
```

Recommended approach: each mounted `TerminalPanel` subscribes to
`terminalFontSize`, initializes xterm from the current store snapshot, and uses a
small post-mount effect to mutate only its own live terminal. This respects panel
lifecycle ownership and naturally reaches all keep-alive terminals.

Rejected alternatives:

| Option | Rejection |
|---|---|
| Recreate xterm on every change | Loses/replays state, risks duplicate PTY attach and focus changes. |
| CSS transform or container zoom | Visual size diverges from xterm grid and backend PTY rows/columns. |
| Global registry subscriber/service | Adds cross-terminal lifecycle ownership when each panel already owns its instance. |
| Duplicate per-terminal keyboard listeners | Can apply one page shortcut once per mounted terminal. |

Architecture invariant: global UI config owns one shared terminal presentation
preference; `TerminalPanel` remains the xterm/PTY adapter and the existing resize
listener remains the only transport resize path. Record this concise dataflow in
`docs/system-architecture.md` during implementation, after UI design review.

## Related Code Files

| Action | File | Change |
|---|---|---|
| Modify | `server/src/config/schema.rs` | Defaults, serde fields, `UiConfig::default`, terminal size validation. |
| Modify | `server/src/config/global.rs` | Normalize three camelCase update keys to TOML snake_case. |
| Modify | `server/src/config/tests.rs` | Missing-field, JSON/TOML key, round-trip, and bound coverage. |
| Modify | `packages/ui/src/api/client.ts` | Add optional wire-compatible UI config fields. |
| Modify | `packages/ui/src/lib/shortcuts.ts` | Add stable default shortcut constants; keep parser format. |
| Modify | `packages/ui/src/lib/ui-config.ts` | Add 13 px and shortcut defaults; normalize absent/legacy values. |
| Modify | `packages/ui/src/lib/ui-config.test.ts` | Default, preserve, normalize, and invalid literal coverage. |
| Modify | `packages/ui/src/stores/settings.ts` | Add persisted fields, hydrate/pick/set/save; clamp terminal size 10–32. |
| Modify | `packages/ui/src/stores/settings.test.ts` | Default hydration, clamp, patch persistence, reload, rollback. |
| Modify | `packages/ui/src/lib/terminal-keyboard-shortcuts.ts` | Consume exact zoom chords and invoke size callbacks. |
| Modify | `packages/ui/src/lib/terminal-keyboard-shortcuts.test.ts` | Exact modifiers, + code, minus, bounds callback, non-leak cases. |
| Modify | `packages/ui/src/components/organisms/TerminalPanel.tsx` | Initialize current size; reactively mutate, invalidate, fit; wire callbacks. |
| Modify | `packages/ui/src/components/atoms/NumberStepper.tsx` | Optional contextual accessible label for input and step buttons. |
| Modify | `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` | Add terminal font-size row. |
| Modify | `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx` | Render, accessible names, and save interaction. |
| Modify | `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx` | Add two labeled capture/reset rows and descriptions. |
| Modify | `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx` | Render, capture, reset, + semantics, accessible names. |
| Create/Modify | `packages/ui/browser-tests/terminal-font-size-shortcuts.browser.tsx` | Chromium focused-key and live option/refit regression using repository harness. |
| Modify | `docs/system-architecture.md` | Add concise config-to-xterm-to-PTY dataflow/invariant. |

No files deleted. Do not add a separate API endpoint, database migration, asset,
mobile keyboard control, or dependency.

## Implementation Steps

1. Run `/code` with this plan. Before frontend edits, delegate Settings review to
   `ui-ux-designer`; require a terminal response covering placement, wording,
   keyboard capture, focus, error announcement, and contextual accessible names.
   Apply repository conventions because no design-guideline file exists.
2. Extend Rust `UiConfig` with the three additive fields and dedicated default
   functions. Add snake_case aliases, initialize them in `Default`, include
   terminal size in `validate_font_sizes`, and map all three camelCase update keys
   in `normalize_ui_json_for_toml`. Keep `server/src/api/config.rs` flow unchanged:
   it already calls `validate_font_sizes()`.
3. Extend server tests. Parse `[ui]` without new keys and assert 13/default
   chords; round-trip explicit snake_case TOML; exercise camelCase UI update
   normalization; assert terminal sizes 10 and 32 pass, 9 and 33 fail. Update any
   full `UiConfig` literals only as required by compilation.
4. Add optional fields to the browser `UiConfig` contract. Define the two
   physical-code defaults in `shortcuts.ts`; do not store `Ctrl+Alt+` because the
   parser treats `+` as a delimiter and correctly rejects that string. Extend
   `DEFAULT_UI_CONFIG` and `withUiConfigDefaults` so old servers/configs produce
   required normalized values.
5. Add the three values throughout `PersistedSettingsState`, default state,
   `pickPersistedSettings`, hydration, setter, and debounced patch handling.
   Reuse the 10–32 font clamp. Shortcut strings remain validated by
   `ShortcutCapture`, consistent with existing shortcut settings. Verify partial
   saves do not overwrite unrelated config and rejected saves restore the last
   confirmed size/bindings.
6. Extend the shared font shortcut helper with increase/decrease shortcut values
   and callbacks. Check page-level font shortcuts before general workspace /
   panel suppression. For a recognized keydown, call `preventDefault()` and
   return `false`; invoke the callback only for an allowed non-composing action.
   Ensure a repeated/composing recognized chord is still consumed rather than
   becoming `+`, `=`, or `-` PTY input. Continue exact code/modifier matching.
7. In `TerminalPanel`, read the current size for `new Terminal(...)`. Add a
   separate reactive effect that, when `termRef.current` exists and size differs,
   assigns `terminal.options.fontSize`, calls the existing entry geometry
   invalidation hook, and `scheduleTerminalFit(entry, { focus: false })`. Do not
   add the size to the terminal creation effect dependencies or remount xterm.
8. Wire handler callbacks to the current settings snapshot: calculate one-step
   bounded size and call `saveDebounced` only when it changes. Pass current
   shortcut strings on every event as existing terminal shortcuts do. This makes
   edited bindings live immediately without handler reattachment.
9. Add `Terminal font size` under Appearance near editor font size. Use 10–32,
   13 default, and a contextual NumberStepper label. Add two Keyboard Shortcuts
   rows with `ShortcutCapture`, reset defaults, accessible change/reset names,
   and descriptions that say the increase default represents the actual `+` key
   (`Shift+Equal`) while both bindings are user-editable.
10. Add unit/component tests. Cover old-config compatibility, clamping,
    persistence/reload/rollback, `Ctrl+Alt+Shift+Equal`, `Ctrl+Alt+Minus`, wrong
    modifiers, invalid `Ctrl+Alt+`, keyup/repeat/composition, preventDefault,
    `false` return, no PTY callback, Settings capture/reset, and accessible names.
11. Use the `web-testing` skill to add/run Chromium proof. Mount a terminal with
    controlled store/transport; change size and assert the live xterm option plus
    fit/resize path, then focus xterm and dispatch both default chords. Assert one
    bounded step, browser default prevented, no terminal data write, and all open
    terminals converge. Use actual keyboard events when harness support permits;
    document any browser reservation limitation rather than weakening assertions.
12. Update the relevant terminal/config paragraph in `docs/system-architecture.md`
    only. Run format-sensitive diff review, then tester and code-reviewer gates.
    Fix critical security, accessibility, lifecycle, compatibility, or geometry
    findings and rerun impacted checks. Present evidence and request user approval.

## Todo List

- [x] Add backward-compatible server/UI config fields and defaults.
- [x] Persist and clamp terminal font size plus both shortcut bindings.
- [x] Apply font size live to every mounted xterm and refit without remount.
- [x] Consume exact page-level zoom shortcuts without PTY leakage; user-selected
      bindings may intentionally override other page shortcuts.
- [x] Add accessible Appearance and Keyboard Shortcut controls.
- [x] Add server, unit, component, and Chromium regression coverage.
- [x] Update architecture invariant and complete tester/reviewer gates.
- [x] Obtain user approval before project/docs finalization.

## Validation Evidence

- UI tests: 1,079 passed.
- Chromium tests: 124 passed.
- UI build and lint passed.
- Rust config tests: 74 passed.

## Success Criteria

- A missing config loads 13 px and the two specified default physical chords;
  explicit values survive save, server reload, and UI hydration.
- Values below 10 or above 32 cannot persist; Settings and shortcuts stop at the
  bounds without emitting redundant updates.
- Changing size updates every currently mounted terminal, including split and
  keep-alive terminals, without losing scrollback, input, focus, or PTY identity.
- Each effective update invalidates geometry, schedules fit, and reaches backend
  dimensions only through the existing xterm resize listener.
- Exact default or edited chords change one step anywhere on the page, prevent the
  browser default, return `false` to xterm when applicable, and write no bytes to
  the PTY.
- Extra/missing modifiers and unrelated keys keep existing behavior. Repeated or
  composing recognized chords do not leak terminal characters.
- Settings clearly separate terminal/system/editor font sizes and present two
  independently editable, resettable, contextually named shortcut controls.
- Rust tests, `pnpm --filter @dam-hopper/ui test`,
  `pnpm --filter @dam-hopper/ui build`, and
  `pnpm --filter @dam-hopper/ui test:browser` pass. Tester and reviewer report no
  unresolved critical issues; user approves observed behavior.

## Risk Assessment

- **Plus-key ambiguity/layout:** `+` normally means Shift+Equal and cannot be a
  literal token in `+`-delimited storage. **Mitigation:** persist physical
  `Ctrl+Alt+Shift+Equal`, capture `event.code`, explain it in Settings, and test
  wrong-shift/Numpad cases explicitly.
- **Browser-reserved shortcut:** some OS/browser combinations may intercept a
  chord before page dispatch. **Mitigation:** page and focused xterm handlers
  call `preventDefault`; Chromium proves supported delivery; Settings lets users
  replace either chord.
- **Grid/PTY mismatch:** changing glyph metrics without fitting corrupts visual
  wrapping and process dimensions. **Mitigation:** mutate xterm option, invalidate
  geometry, schedule existing fit, retain current `onResize` transport owner.
- **Terminal remount/regression:** adding font size to creation-effect dependencies
  could reattach sessions. **Mitigation:** separate post-mount effect; browser
  proof asserts stable terminal identity/scrollback behavior.
- **Hidden container:** fit may safely no-op while display is none. **Mitigation:**
  update option immediately and rely on existing visibility/layout fit when shown;
  test a keep-alive/hidden-to-visible case where practical.
- **Stale/failed persistence:** optimistic terminal size may differ briefly from
  confirmed server state. **Mitigation:** reuse serialized save/rollback path; the
  rollback triggers the same reactive terminal update.
- **Shortcut collision:** user may choose a browser/app/terminal chord already in
  use. **Mitigation:** exact matching and visible editable bindings; do not invent
  a global conflict registry in this feature. User-selected page shortcuts take
  precedence where the browser delivers the event.
- **Large `TerminalPanel`:** lifecycle code is already complex. **Mitigation:**
  keep mutation effect small, reuse fit/registry utilities, avoid a new service.

## Security Considerations

- No auth, authorization, role, token, cookie, session, database, migration,
  filesystem, terminal-content, secret, logging, or telemetry changes.
- UI config remains authenticated through the existing global-config endpoint;
  server validation rejects out-of-range terminal font sizes.
- Shortcut strings are data, never commands or executable content. Continue the
  existing parser/capture path; do not evaluate strings or install OS hooks.
- Keyboard handling uses a page-level listener plus the active xterm custom
  handler; user-selected bindings may override editor/browser shortcuts.

## Side-Effect Review Checklist

- [ ] Auth, sessions, permissions, roles: unchanged.
- [ ] API/client compatibility: fields additive; client accepts omission; server
  serde defaults/aliases accept old TOML and camelCase JSON.
- [ ] Database, migrations, data integrity: none; bounded global TOML values only.
- [ ] Business logic: only terminal visual grid and page-level zoom behavior.
- [ ] Security, privacy, secrets, logging: no new data collection or execution.
- [ ] Performance, concurrency, resources: O(open terminals) option/fit work per
  user change, animation-frame coalesced; one debounced network write.
- [ ] Docs, config, onboarding, deployment: architecture/config defaults updated;
  no environment variables, dependency, setup, or rollout step.
- [ ] Compatibility: old client/server configs remain usable; physical key codes
  make bindings layout-stable where browsers dispatch them.
- [ ] Accessibility: numeric and shortcut controls have contextual names, keyboard
  capture/cancel/reset behavior, visible validation, and non-color-only labels.
- [ ] Mobile: mobile custom keyboard font size and buttons remain untouched;
  feature applies to xterm rendering only.

## Next Steps

1. Execute `/code plans/260816-1356-terminal-font-size-shortcuts/plan.md`.
2. Complete UI design, tester, web-testing, and code-reviewer blocking gates.
3. Share screenshots/behavior and command evidence; request user approval.
4. After approval, let project/docs managers finalize plan progress and docs if
   the `/code` workflow requires it; offer commit/push separately.

## Unresolved Questions

None.
