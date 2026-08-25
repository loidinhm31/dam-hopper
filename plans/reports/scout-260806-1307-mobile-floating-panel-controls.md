# Scout report: mobile floating panel controls

## Request

- Make the mobile `Panels` floating trigger draggable.
- Reduce excess padding around that trigger.
- Make the bottom `Keys` and `Kbd`/`Type` controls as compact as practical.

## Existing implementation

- `packages/ui/src/components/templates/MobileWorkspaceShell.tsx`
  - Owns the mobile surface selector.
  - Uses Radix `Select` with a fixed, safe-area-aware trigger.
  - Current trigger has `h-11`, `px-3`, `min-w-24`, and a fixed left/bottom placement.
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx`
  - Owns the bottom `Keys` and keyboard controls.
  - Current row uses `flex-wrap`, `gap-1`, `py-2`; both buttons use `h-10` and `px-3`.
- `packages/ui/browser-tests/mobile-workspace-shell.browser.tsx`
  - Existing Chromium coverage checks trigger/menu viewport bounds, short terminal viewports, surface switching, focus restoration, and accessory clearance.
- `packages/ui/src/components/templates/MobileWorkspaceShell.test.tsx`
  - SSR coverage checks labels, active surface, fallback, and empty state.
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx`
  - jsdom coverage checks native/custom keyboard paths.

## Relevant conventions

- `packages/ui/src/index.css` provides safe-area variables and mobile viewport helpers.
- Existing UI uses pointer events for mobile terminal controls and Lucide icons.
- `docs/frontend-components.md` documents the mobile selector and its safe-area behavior.
- Browser tests run through Vitest's Playwright provider; package build is TypeScript-only.

## Constraints / risks

- Preserve Radix Select keyboard, dismissal, focus restoration, and menu anchoring.
- A drag gesture must not accidentally select a menu item or leave the menu open.
- Keep the visible control compact without shrinking its usable touch target below 44px.
- Dragging must clamp to the viewport and remain usable after viewport resize/orientation changes.
- Keep changes local to mobile UI; no API, data, auth, or persistence changes.

## Recommendation

- Add a small pointer-drag state machine to the existing mobile shell trigger, with a movement threshold so taps still open the menu. Store the position in component state only and clamp it to viewport bounds after movement and resize.
- Reduce the trigger's visual padding while retaining its 44px hit height.
- Render the accessory controls in one non-wrapping compact row with reduced visual padding, icon-only affordance where the accessible label already carries the meaning, and visible text labels only when needed.
- Add focused browser assertions for drag behavior/bounds and compact row geometry/classes; retain current accessibility names and menu tests.
