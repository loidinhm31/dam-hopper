# Phase 04: OS Dock 4-Way & Settings Appearance
## Status: Completed

## Objective
Support 4-way configurable positioning (`left`, `right`, `top`, `bottom`) for the OS application dock and provide Settings controls.

## Target Files
- `packages/ui/src/os/Dock.tsx`
- `packages/ui/src/os/Dock.test.tsx`
- `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`
- `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx`

## Changes
1. **`Dock.tsx`**:
   - Accept optional `position?: DockPosition` prop, defaulting to `useSettingsStore((s) => s.dockPosition) ?? "left"`.
   - `isHorizontal = dockPosition === "top" || dockPosition === "bottom"`.
   - Vertical (`left` / `right`):
     - `aside` width `${gutterSize}px`, `flex flex-col items-center justify-center h-full`.
     - `dock-panel` max-height `calc(100% - ${2 * dockOuterSpacing}px)`, `flex flex-col`.
     - Apps trigger at bottom with `border-t`.
     - Running indicator pip on left (`left-1 top-1/2 -translate-y-1/2`) for left dock, or on right (`right-1 top-1/2 -translate-y-1/2`) for right dock.
   - Horizontal (`top` / `bottom`):
     - `aside` height `${gutterSize}px`, width `100%`, `flex flex-row items-center justify-center`.
     - `dock-panel` max-width `calc(100% - ${2 * dockOuterSpacing}px)`, `flex flex-row`.
     - Items scroller `overflow-x-auto overflow-y-hidden flex-row h-full`.
     - Apps trigger at right end with `border-l`.
     - Running indicator pip on top (`top-1 left-1/2 -translate-x-1/2`) for top dock, or on bottom (`bottom-1 left-1/2 -translate-x-1/2`) for bottom dock.
2. **`SettingsAppearanceSection.tsx`**:
   - Add `"Dock position"` row with a segmented control or Select (options: Left, Right, Top, Bottom).
   - Calling `saveDebounced({ dockPosition })`.
   - Update `"Reset appearance defaults"` button to include `dockPosition: "left"`.
3. **Tests**:
   - `Dock.test.tsx`:
     - Test rendering in `"left"`, `"right"`, `"top"`, and `"bottom"` positions.
     - Verify correct orientation and testids.
   - `SettingsAppearanceSection.test.tsx`:
     - Test selecting dock position triggers `saveDebounced`.
     - Test reset defaults restores `"left"`.

## Acceptance Criteria
- `Dock.test.tsx` and `SettingsAppearanceSection.test.tsx` pass.
