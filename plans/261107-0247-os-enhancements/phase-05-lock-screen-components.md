# Phase 05: Lock Screen & PIN Setup Components
Status: Completed

## Objective
Build the standalone `LockScreenOverlay` and `PinSetupDialog` components for client-side workspace locking.

## Target Files
- `packages/ui/src/os/LockScreenOverlay.tsx` (new)
- `packages/ui/src/os/LockScreenOverlay.test.tsx` (new)
- `packages/ui/src/os/PinSetupDialog.tsx` (new)
- `packages/ui/src/os/PinSetupDialog.test.tsx` (new)

## Changes
1. **`LockScreenOverlay.tsx`**:
   - Render portal into `document.body` when `isLocked` is true.
   - `z-[9990]` backdrop with `backdrop-blur-xl`, frosted dark glass, subtle hologram background.
   - Large live digital clock (hours:minutes) and localized date string.
   - Identity: Lock emblem and "Enter PIN to unlock".
   - PIN dots: Render dots matching configured PIN length (4-8). Error shake animation via `.os-lock-shake`.
   - Numeric keypad: 3x4 grid (1-9, CLR, 0, Backspace). 44px+ touch targets.
   - Keyboard listener in window capture phase:
     - Digits 0-9 input.
     - Backspace deletes last digit.
     - Escape clears entered digits.
     - All other keys suppressed from reaching underlying terminal/editor/canvas while locked.
     - Focus trap within overlay.
   - Cooldown display: Shows countdown when in cooldown state (after 5 failed attempts).
   - Smooth unlock fade transition and trailing event consumption.
2. **`PinSetupDialog.tsx`**:
   - Radix Dialog modal for setting up, changing, or removing the PIN.
   - Modes: `"setup"`, `"change"`, `"remove"`.
   - Inputs:
     - New PIN (password input with numeric keypad pattern `[0-9]{4,8}`).
     - Confirm PIN.
     - Current PIN (for change and remove modes).
   - Validates matching PINs, non-numeric characters, and length bounds.
   - Honest labeling: "Stored locally in this browser for quick screen locking. Not a replacement for server authentication."
3. **Tests**:
   - `LockScreenOverlay.test.tsx`:
     - Test clock and date rendering.
     - Test entering digits via keypad and keyboard.
     - Test backspace and clear.
     - Test shake animation and error message on incorrect PIN.
     - Test successful unlock.
     - Test cooldown display when locked out.
   - `PinSetupDialog.test.tsx`:
     - Test setup validation (mismatched PINs, short PIN).
     - Test successful PIN save.
     - Test change and remove PIN flows.

## Acceptance Criteria
- Unit tests pass.
- Focus trap and input isolation verified.
