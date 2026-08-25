# UI/UX design decision: floating terminal key controls

Date: 2026-08-06
Scope: read-only gate for `Floating Terminal Key Controls`
Decision: approved with the guardrails below

## Evidence reviewed

- `plan.md`, `phase-01-implement-and-verify.md`, and scout report.
- `TerminalScrollButtons.tsx`, `MobileTerminalAccessoryBar.tsx`, `TerminalRuntimeOutput.tsx`, `MultiTerminalDisplay.tsx`, `MobileWorkspaceShell.tsx`.
- `SplitLayout.tsx`, `PaneContainer.tsx`, `TerminalWorkspaceShell.tsx`, relevant tests, keyboard children, `index.css`, and `docs/frontend-components.md`.

The existing direction is appropriate: dark/OLED developer-tool surface, blue focus/accent treatment, layered local overlays, and progressive disclosure for the expanded key surfaces. The current accessory is in-flow and mobile-gated; the scroll rail is already host-local, absolute, translucent, and keyboard-aware.

## Decisions

### 1. Lower-right placement and reserved lane

Use the same positioned terminal host as `TerminalScrollButtons`.

- Scroll controls own the outermost lower-right rail.
- Keys/Type sits immediately to the left of that rail, with an 8px lane gap.
- Both controls share the same bottom and right edge insets. Do not stack them vertically or let the accessory occupy the scroll rail.
- When `terminalScrollButtonsEnabled` is false, reclaim the rail and place Keys/Type at the normal safe-area right inset. In split mode, no scroll rail currently exists, so use the normal right inset.
- The outer floating wrapper is pointer-inert; only the compact control surface and open panel receive pointer events. This prevents a large invisible overlay from stealing xterm or docking input.

Recommended placement tokens:

```text
--terminal-float-edge:       max(0.75rem, var(--safe-area-right))
--terminal-float-left-edge:  max(0.75rem, var(--safe-area-left))
--terminal-float-bottom:     max(0.75rem, var(--safe-area-bottom))
--terminal-scroll-width:     2.5rem       /* existing 40px scroll trigger */
--terminal-lane-gap:         0.5rem       /* scroll-to-Keys separation */
```

With the scroll rail enabled, the Keys/Type right edge is `edge + scroll-width + lane-gap`. The left edge must remain at least `--terminal-float-left-edge`; this gives a maximum panel width of approximately 248px at 320px, 303px at 375px, and the cap below on wide screens.

### 2. Stacking relationship

Keep both terminal control surfaces in the local terminal overlay tier (`z-10`), above normal xterm content. The lane, not source order, prevents collision.

- `z-10`: scroll and Keys/Type controls.
- `z-20`: active docking preview / terminal floating tool surfaces may temporarily cover the controls during an intentional drag or panel interaction.
- `z-40`: `MobileWorkspaceShell` Panels trigger and Select content.
- `z-50`: TopNav and dialogs.

If the implementation needs a shared utility class, apply the same local tier to scroll and Keys/Type. Do not raise the controls to `z-40` or `z-50`; shell panels and dialogs must win.

### 3. Visual surface and compact tokens

Use the scroll-button visual language, not the current full-width accessory bar:

- Surface: `var(--color-surface)` at roughly 90–96% opacity, `border-[var(--color-border)]`, `shadow-lg`, `backdrop-blur-md`, and `rounded-xl`.
- Button: 44px square on all widths. This is the mobile touch-target floor and is close enough to the existing 40px scroll trigger to read as one control family. Use 16px icons; keep text visually hidden but available to assistive technology.
- Inner button gap: 4px. Surface padding: 4px. Scroll-to-Keys lane gap: 8px.
- Keys active state and open Type state: existing primary border/tint language (`primary` border at about 35%, primary surface at about 14%). Resting Type state: `surface-2` with border. Hover changes color/surface only; no layout-shifting scale.
- Focus: visible 2px `var(--color-ring)` ring, with sufficient contrast against the dark surface. Preserve reduced-motion behavior; any open/close transition stays in the 150–300ms range.

The expanded panel should be the same bounded surface, not a second full-width bottom bar.

### 4. Safe-area and viewport behavior

Apply the bottom and right safe-area values once at the floating overlay anchor:

```text
right:  max(0.75rem, var(--safe-area-right)) [+ reserved scroll rail]
bottom: max(0.75rem, var(--safe-area-bottom))
```

Remove the old in-flow `pb-[max(...)]` dependency from the floating root. Do not add safe-area padding to both host and overlay. Use `dvh` for panel bounds so an OS keyboard changes the visual viewport without forcing a terminal layout row.

### 5. Expanded panel geometry

- Width: `min(22rem, available host width before the scroll rail and safe-area margins)`.
- Max height: `min(28rem, calc(100dvh - var(--top-nav-height) - var(--safe-area-bottom) - 5rem))` with `overflow-y: auto`.
- Keep the panel anchored to the Keys/Type surface and open upward. Its right edge must remain in the Keys/Type lane; it must never extend into the scroll rail.
- At 320px: collapsed controls remain fully visible; expanded content uses the approximately 248px available lane, scrolls vertically inside the panel, and must not create page or xterm overflow. If user-selected keyboard padding/font settings make a row wider than the lane, allow the keyboard content to scroll/contain rather than clip keys.
- At 375px: use the approximately 303px lane; default keyboard rows should fit without horizontal page overflow. The expanded panel remains above the bottom controls and safe area.
- At 1280px and 1440px: cap the panel at 22rem; do not scale it with viewport width or drift toward the center. Both scroll and Keys/Type rails stay in the lower-right corner.
- Native Type input remains a normal focusable input. Opening it may invoke the OS keyboard; the panel must follow the reduced `dvh` viewport and must not double-count the home-indicator inset.

### 6. Pointer, focus, and accessibility behavior

Preserve the current real buttons, `aria-label`, `title`, `aria-pressed`, special-key writes, custom-keyboard writes, and native input writes.

- Add one labelled group, e.g. `role="group" aria-label="Terminal keyboard controls"`.
- Keep stable `aria-expanded`/`aria-controls` relationships for Keys and Type. IDs must remain unique per session/surface.
- On control mouse/pointer down, prevent the default xterm focus and stop propagation. On action click/pointer events, stop propagation so pane selection, split drag, and host focus do not fire.
- Exempt the native Type input and its normal focus/change/key-down path from the trigger prevention rule.
- Outside pointer and Escape dismissal should mirror `TerminalScrollButtons`; when closing from keyboard, return focus to the invoking trigger. Do not hide focus rings or depend on hover.
- Tab order: Keys trigger, Type trigger, then open panel controls/input in DOM order. Custom key toggles retain `aria-pressed`.
- Verify keyboard and screen-reader use at 320px and desktop fine-pointer widths, not just touch taps. Do not use color as the only active-state indicator.

### 7. Split surface anchoring

Render exactly one accessory instance for `activeSessionId`; never one per pane. The preferred host is the shared visible split surface inside `MultiTerminalDisplay`, with a relative, overflow-hidden wrapper around `SplitLayout`. This preserves one control owner and follows active-session changes without a new store or PTY path.

Guardrail: the overlay must be scoped to the visible split surface, not the outer keep-alive host or shell. If browser-split validation shows the shared lower-right lane covers a live browser sub-panel or the wrong terminal pane, stop and switch to an active-pane anchor slot before implementation grows further. Do not silently add a portal or duplicate accessory mounts.

## Component/refactor decision

No new behavior component, store, controller, portal, or prop is required. Minimally refactor `MobileTerminalAccessoryBar` so its existing local state/children support a host-local floating presentation; pass a narrowly scoped `placement="floating"` only if preserving an in-flow test fixture or future consumer requires it. Prefer existing `className` plus a presentation branch if no in-flow consumer remains.

`TerminalRuntimeOutput` should render the accessory whenever `activeSessionId` exists, inside `terminal-runtime-output-host`. Keep `suppressTerminalNativeInput` derived only from Android policy and the existing compact/coarse/custom-keyboard policy; rendering desktop controls must not suppress xterm input. `MultiTerminalDisplay` should render one active-session accessory inside its visible split wrapper.

A small related presentation adjustment to `TerminalScrollButtons` is acceptable/required if needed to replace hard-coded `right-4 bottom-4` with the shared safe-area anchor. Its state and interaction behavior remain unchanged.

## Implementation guardrails

- No in-flow row, host height change, terminal refit, PTY write path, global state, or portal.
- No duplicated controls when switching compact/wide modes, panes, browser split, or active session.
- Keep expanded panels bounded by host/visual viewport and safe areas; assert no bounding-box intersection with scroll controls or the Panels trigger.
- Validate `pointer-events`, focus transfer, Escape/outside dismissal, native Type focus, custom-keyboard toggles, and xterm click-through.
- Update `docs/frontend-components.md` to describe desktop/mobile floating ownership and split anchoring. `docs/design-guidelines.md` was not present; creating it is outside this read-only gate.
- Required browser matrix: 320px, 375px, 1280px, 1440px; collapsed/open Keys; native/custom Type; scroll enabled/disabled; compact Panels trigger at default and dragged positions; split and browser-split surfaces.

## Unresolved questions

- If browser-split geometry proves the shared split-surface anchor covers the browser pane, should the implementation accept the active-pane slot refactor or constrain the overlay to the active terminal sub-panel?
- Should `TerminalScrollButtons` receive the same 44px trigger size for strict touch-target consistency, or remain at its current 40px reference size?
- The existing keyboard settings permit rows wider than a 320px lane. Confirm whether contained horizontal scrolling is acceptable or whether a future keyboard-layout redesign is preferred; this gate does not change key content/layout.
