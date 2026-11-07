# Phase 02: Hologram Background & Battery Display
Status: Completed


## Objective
Implement the theme-adaptive hologram background in `DesktopCanvas.tsx` and battery display in `MonitorTray.tsx`.

## Target Files
- `packages/ui/src/os/DesktopCanvas.tsx`
- `packages/ui/src/os/DesktopCanvas.test.tsx`
- `packages/ui/src/os/MonitorTray.tsx`
- `packages/ui/src/os/MonitorTray.test.tsx` (new)

## Changes
1. **`DesktopCanvas.tsx`**:
   - Render decorative background layer inside the root container, with `aria-hidden="true"`, `data-testid="desktop-hologram-bg-${desktop.id}"`, `className="os-hologram-bg pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"`.
   - Include `.os-hologram-grid` child and central focal reticle SVG with outer dashed ring, segmented arc, cardinal crosshairs, center micro-reticle, and coordinate text `DH//OS · SYS.GRID // {desktop.name}`.
   - Include corner cybernetic HUD reticle brackets.
   - Keep `DesktopContextMenu`, tiled, float, and maximized window layers functioning identically.
2. **`MonitorTray.tsx`**:
   - Validate battery reading from `activeEntry?.snapshot?.battery`:
     - Checks integer `count > 0`.
     - Checks availability state is `"available"` or `"stale"`.
     - Checks finite `capacityPercent` between 0 and 100.
   - When valid, render `B: <value>%` or `B: ⚡<value>%` (with `isCharging` indicator) right beside `MEM` meter in the pill.
   - Threshold colors: `< 20%` danger, `< 30%` warning, normal otherwise.
   - When Cognito mode is active, mask battery telemetry along with CPU/MEM into Protected status.
   - When host reports no battery hardware or unsupported state, omit the `B:` section cleanly without false zeros.
   - Update `aria-label` and `title` to include battery reading.
3. **Tests**:
   - Add unit tests verifying battery display rendering in `MonitorTray.test.tsx`:
     - Present battery displays percentage and charging icon.
     - Absent or 0 count battery hides `B:` meter.
     - Low battery triggers warning/danger color classes.
     - Cognito mode masks battery telemetry.
   - In `DesktopCanvas.test.tsx`, verify hologram decorative layer is present with `aria-hidden="true"`.

## Acceptance Criteria
-[x] Unit tests pass (22/22 passed in MonitorTray and DesktopCanvas tests).
-[x] No layout shifts or performance regressions (static CSS + zero-alloc SVG).
