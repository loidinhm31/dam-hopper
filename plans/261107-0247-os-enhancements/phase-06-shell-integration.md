# Phase 06: Shell Integration & TopBar

## Objective
Sequentially integrate the 5 enhancements into the main shell chrome: TopBar lock button, OsShell flex layout, Git float intent handling, input arbiter guard, and overlay mounting.

## Target Files
- `packages/ui/src/os/TopBar.tsx`
- `packages/ui/src/os/TopBar.test.tsx`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/input-arbiter.ts`
- `packages/ui/src/os/input-arbiter.test.ts`
- `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` (connect PIN status badge / lock actions)

## Changes
1. **`TopBar.tsx`**:
   - Add `onOpenPinSetup?: () => void;` to `TopBarProps`.
   - Add Lock button immediately after the Notifications Bell (`Bell`) in the right action cluster.
   - Icon: `Lock` from `lucide-react`.
   - Clicking locks immediately if PIN is configured (`useLockScreenStore.getState().hasPin`); otherwise invokes `onOpenPinSetup`.
   - Accessible label and title: "Lock screen" (or "Set up lock screen PIN").
2. **`OsShell.tsx`**:
   - Subscribe to `dockPosition = useSettingsStore((s) => s.dockPosition) ?? "left"`.
   - Workspace container: apply `flex-row` (left), `flex-row-reverse` (right), `flex-col` (top), or `flex-col-reverse` (bottom) classes.
   - Keep `<Dock />` and `<main>` child order stable in JSX to prevent unmounting!
   - In `registerIntentHandler("git:status", ...)`:
     - Check `intent.payload.mode`. If `"float"` and window already exists in `"tile"` mode, convert to `"float"` via `toggleWindowMode`. If opening a new window, pass `mode: intent.payload.mode ?? getPlacement()`.
   - Mount `<LockScreenOverlay />` at the root of `OsShell`.
   - Mount `<PinSetupDialog open={isPinSetupOpen} onClose={() => setIsPinSetupOpen(false)} />`.
3. **`input-arbiter.ts`**:
   - In `InputArbiterContext`, add `isLockScreenActive?: boolean;`.
   - If `isLockScreenActive` is true, arbiter returns `"lock-screen-blocked"` (just after `isCognitoActive` check).
4. **`SettingsAppearanceSection.tsx`**:
   - Wire the Screen Lock PIN setting row showing PIN status ("PIN Active" or "Not Set"), "Lock Now", "Change PIN…", "Remove PIN…", or "Set Up PIN…".
5. **Tests**:
   - `TopBar.test.tsx`:
     - Test lock button presence after bell.
     - Test lock action triggering lock or setup dialog.
   - `input-arbiter.test.ts`:
     - Test `lock-screen-blocked` decision.

## Acceptance Criteria
- TopBar and OsShell tests pass.
- End-to-end integration verified.
