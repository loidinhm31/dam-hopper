# Phase 01 — Implement and verify floating-control UX

## Context links
- [Plan overview](plan.md)
- [Discovery report](../reports/context-260829-1726-terminal-floating-layout.md)
- `docs/code-standards.md`
- `docs/frontend-components.md` — **Floating Terminal Keyboard Controls**
- `docs/design-guidelines.md` is absent; do not create it.
- Predecessor behavior: [terminal touch keyboard and smooth scroll](../260828-1430-terminal-touch-keyboard-and-smooth-scroll/plan.md)

## Overview
- Description: responsive floating controls and custom Type keyboard behavior with safe-area-aware geometry, coordinated scroll clearance, and Terminal Keys Enter/CR support.
- Priority: P2
- Implementation status: completed
- Tester status: completed
- Browser evidence status: completed
- Code review status: approved
- Estimate: 4h

## Key Insights
- The accessory shell and scroll controls are separate absolute `z-10` overlays in the same terminal host. Their bottom calculations move together; changing one alone creates overlap or wasted rail space.
- The implemented accessory baseline is 48px plus `var(--safe-area-bottom, 0px)`, not a fixed 24px offset. The scroll rail reserves `6.25rem` plus its gap and uses compact two-column controls in short viewports.
- The two 40px accessory triggers form one vertical stack. The scroll trigger and opened rail remain above the Keys trigger; expanded panels reserve a `6.875rem` trailing lane plus safe-right, stay bounded by max-height, and contain horizontal scrolling.
- `MobileTerminalAccessoryBar.handlePress` routes special-key sequences through `getTransport().terminalWrite(sessionId, sequence)`. Enter uses this existing active-session path.
- Native Type still handles `Backspace -> \x7f` and `Enter -> \r` directly in `MobileTerminalAccessoryBar`; this behavior remains intact.
- Custom Type is a five-row US 60%-style physical layout. Enter and Backspace are present on both base and function layers; Del remains in the custom key definitions where applicable.

## Requirements

### Preflight contract
- **Output:** this plan directory and linked phase file, followed by implementation and verification.
- **Acceptance:** responsive viewport and safe-area geometry, scroll clearance, Terminal Keys Enter/CR transport, custom/native keyboard behavior, accessibility, event isolation, active-session routing, and host-height invariants are all evidenced below.
- **Scope boundary:** implementation and focused verification were limited to the terminal UI surface and its tests; the relevant frontend behavior documentation was also updated.
- **Risk/public contracts:** mobile touch/accessibility; safe-area and visual viewport behavior; PTY byte sequences and active-session routing; `z-index`/overflow; `TerminalRuntimeOutput`, split, and `PaneContainer` callers. No API contract changes.
- **Testing:** focused UI units, direct Chromium accessory checks, scroll/pane browser checks, UI TypeScript build, and final code review completed.
- **Assumptions:** Enter is available through Terminal Keys and the custom Type layout; no Ctrl-D or unrelated duplicate controls were added. No blocking open questions.

### Functional
1. Terminal Keys includes `Esc`, `Tab`, `Ctrl+C`, `Enter`, `PgUp`, `PgDn`, and arrows in stable visual/tab order; Enter maps to carriage return `"\r"`.
2. Custom Type uses a five-row US 60%-style physical layout with Enter and Backspace on base and function layers; Del/backspace mappings remain preserved.
3. Native input `Enter` and `Backspace` handling in `MobileTerminalAccessoryBar` remains unchanged, including `preventDefault`, value reset, session ID, and byte sequences.
4. The accessory stack uses a 48px baseline plus bottom safe-area inset. The scroll rail reserves `6.25rem` plus its gap and switches to compact two-column controls in short viewports.
5. Expanded panels reserve a `6.875rem` trailing lane plus safe-right, remain bounded by max-height, and contain horizontal overflow.
6. Responsive keycaps use 24px-to-44px widths, 4px-to-8px gaps, 44px minimum height, centered/stretching rows, and contained horizontal scrolling on narrow widths.
7. Preserve labels, focus, modifier-aware ARIA, touch manipulation, pointer isolation, panel dismissal/focus restoration, `z-10`, overflow bounds, and zero host-height change.
### Non-functional
- KISS/YAGNI: local named constants are acceptable in the two positioning owners; do not add a shared layout module for two CSS expressions unless implementation proves drift cannot otherwise be avoided.
- Keep runtime allocation and rendering behavior unchanged: static key definitions only; no effects, store fields, telemetry, or transport changes.
- Do not alter `TerminalRuntimeOutput`, `PaneContainer`, or split callers unless a focused browser reproduction proves the existing host contract cannot satisfy geometry.

## Architecture
- **Data path:** `MobileTerminalSpecialKeys` renders the ordered Terminal Keys set -> `MobileTerminalAccessoryBar.handlePress(id)` -> `getMobileTerminalKeySequence(id)` -> authenticated active-session `terminalWrite(sessionId, sequence)`. Enter uses this existing path.
- **Custom Type path:** the five-row US 60%-style base and function layouts retain Enter and Backspace mappings; keycap rendering supplies responsive widths/gaps and contained narrow-width scrolling.
- **Native Type path:** `MobileTerminalAccessoryBar` keyboard event branch remains unchanged and continues sending CR/DEL.
- **Positioning:** accessory controls use a 48px baseline plus bottom safe-area compensation. `TerminalScrollButtons` coordinates the same baseline with a `6.25rem` reservation and gap; short viewports use compact two-column controls. Expanded panels reserve a `6.875rem` trailing lane plus safe-right, bounded max-height, and horizontal overflow containment.
- No backend, protocol, settings, schema, or public component-prop architecture changes; no architecture diagram/doc change needed.

## Related code files
### Modify
- `packages/ui/src/lib/mobile-terminal-keys.ts` — Terminal Keys definitions, order, and CR mapping.
- `packages/ui/src/lib/mobile-terminal-keyboard-layout.ts` — five-row base/function layouts and Enter/Backspace mappings.
- `packages/ui/src/components/organisms/TerminalFloatingControlShell.tsx` — responsive bottom baseline and safe-area compensation.
- `packages/ui/src/components/organisms/TerminalScrollButtons.tsx` — coordinated baseline/reservation and short-viewport rail.
- `packages/ui/src/components/organisms/MobileTerminalSpecialKeys.tsx` — ordered controls and accessibility semantics.
- `packages/ui/src/lib/mobile-terminal-keys.test.ts`, `packages/ui/src/lib/mobile-terminal-keyboard-layout.test.ts` — focused key/order/sequence contracts.
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` — focused transport/event/native-path assertions.
- `packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` — responsive geometry, safe-area, transport, focus/event, and host-height evidence.
- `docs/frontend-components.md` — updated Floating Terminal Keyboard Controls behavior documentation.

### Inspect, normally unchanged
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` — preserve `handlePress` and native `onKeyDown` branches.
- `packages/ui/src/components/organisms/TerminalAccessoryControls.tsx` — preserve trigger order, dimensions, labels, focus styles, and event behavior.
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx`, `PaneContainer.tsx`, `SplitLayout.tsx` — caller/host-height regression boundary only.

## Implementation Steps
1. **Design gate:** completed before implementation; scoped guidance retained the safe-area, spacing, accessibility, and no-unrelated-controls boundaries.
2. **Terminal Keys and custom layouts:** implemented ordered Terminal Keys with Enter/CR; retained Enter and Backspace on both custom Type layers with exact mappings.
3. **Accessibility and interaction:** preserved keyboard/pointer activation, visible focus, labels, modifier-aware ARIA, propagation isolation, dismissal, and focus restoration.
4. **Responsive geometry:** implemented 48px plus safe-area accessory clearance, coordinated `6.25rem` scroll reservation and gap, short-viewport two-column controls, and expanded-panel `6.875rem` trailing lane with bounded/contained overflow.
5. **Verification:** focused UI units (4 files/24 tests), UI TypeScript build, direct Chromium accessory checks (10/10), scroll/pane browser checks (7/7), and final code review completed.
6. **Documentation:** updated the existing frontend behavior documentation for responsive floating controls, safe-area coordination, and keyboard ownership.

## Todo list
- [x] `ui-ux-designer` gate completed before edits.
- [x] Terminal Keys owns Enter and CR sequence in stable order.
- [x] Custom Type base/function layouts retain Enter and Backspace mappings.
- [x] Accessory and scroll baselines coordinated at 48px plus safe area.
- [x] Scroll reservation and short-viewport compact layout verified.
- [x] Focused unit/accessory tests updated and passed (4 files/24 tests).
- [x] Browser responsive, safe-area, rail, keyboard, native input, event, and height assertions passed (10/10 accessory; 7/7 scroll/pane).
- [x] Frontend behavior documentation updated; no unrelated docs/assets changed.
- [x] UI TypeScript build passed.
- [x] Tester and final code-review gates passed; review approved.

## Success Criteria
- Responsive viewport coverage keeps Keys and Type triggers in bounds with 48px baseline plus additive safe-area clearance; short viewports use compact two-column controls.
- Closed scroll trigger and opened scroll rail remain above the trigger stack with the reserved `6.25rem` lane and intentional gap; expanded panels use the `6.875rem` trailing lane plus safe-right, bounded max-height, and contained horizontal overflow.
- Terminal Keys exposes `Esc`, `Tab`, `Ctrl+C`, `Enter`, `PgUp`, `PgDn`, and arrows in visual/tab order; Enter is keyboard/pointer operable and sends exactly `\r` to the supplied active session.
- Custom Type is a five-row US 60%-style physical layout with Enter and Backspace on base and function layers; responsive keycaps, Shift output labels, and modifier-aware ARIA remain correct.
- Native Type Enter sends `\r` and Backspace sends `\x7f`; native focus remains possible. Pointer/event isolation, focus restoration, labels/ARIA linkage, overflow bounds, and host height remain intact.
- Focused UI units (4 files/24 tests), direct Chromium accessory checks (10/10), scroll/pane browser checks (7/7), UI TypeScript build, and final code review passed.
## Risk Assessment
- **Mobile clipping / visual viewport — addressed:** responsive and safe-area browser evidence covers compact and short viewport behavior; physical device validation remains outside this evidence.
- **Rail collision — addressed:** coordinated reservation/gap and scroll/pane browser checks passed.
- **PTY regression — addressed:** exact CR/DEL mappings and active-session transport checks passed.
- **Accessibility/touch — addressed:** keyboard/pointer activation, focus, labels, modifier-aware ARIA, and event isolation checks passed.
- **Host/split regression — addressed:** bounded overlays and scroll/pane checks preserved host height.
### Side-effect review checklist
- [x] Auth/session/permissions: unchanged; writes retain the active authenticated `sessionId` route.
- [x] API compatibility: no endpoint, transport signature, exported component prop, or response change.
- [x] DB/schema: no database, migration, persistence, or settings-schema change.
- [x] Business logic: only terminal key ownership/layout and overlay geometry changed; terminal lifecycle untouched.
- [x] Security/privacy/logging: no new input capture, logs, telemetry, secrets, or user-content persistence.
- [x] Performance/concurrency: static key/CSS changes only; no added effects, store fields, races, or unrelated writes.
- [x] Docs/config/deploy: frontend behavior documentation updated; no config, CI, environment, assets, or deployment changes.

## Security Considerations
- Authenticated active-session routing and fixed CR/DEL control bytes remain unchanged; no input or session data is logged or persisted.
- Accessory event isolation remains a security/usability boundary; native Type input remains intentionally focusable.

## Next steps
1. Phase complete; no implementation steps remain.
2. Physical Android/iOS hardware validation remains an optional release follow-up, not a blocker for this approved phase.

### Unresolved questions
None.
