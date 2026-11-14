# Completion Report: present-terminal-lifetime (P03 / W06) [Approved with Noted Issues]

## Status: APPROVED_WITH_NOTED_ISSUES
- **Implementation Status**: Code, presentation policy, and regression tests complete.
- **Review Status**: Reviewed across 3 interactive review cycles (final score: 6/10). Admitted under explicit user approval with noted issues.
- **Qualification Prerequisites**: Physical device qualification and live daemon process termination remain future release gates.

## Implemented Behaviors
1. **Local Close View vs Destructive End**:
   - `ProjectTerminalScreen` displays a 3-action dialog: Cancel (initial focus via FocusRequester), Close View (local only, zero server mutation), and End Session / Cancel Restart (guarded destructive termination).
   - Local close hides the session view while preserving the live session and controller.
   - Pinned close is refused until explicit unpin in both dialog and exited session banner.
2. **Hidden Inventory & Reopen**:
   - `hiddenSessions` and `fallbackHiddenSessions` tracked using `TerminalQualifiedKey`.
   - Hidden sessions filtered from selectable session lists and tab rows.
   - `TerminalHiddenSessionsDialog` allows explicit reopen restoring exact instance identity.
3. **Truthful Uncertain Create & Termination**:
   - `resolveCreateStatusPresentation` explains PENDING, CONFIRMED, and REFUSED states without offering Launch Again (`canLaunchAgain = false`).
   - `resolveTerminationOutcomePresentation` treats 202, 200, 0, and 5xx as pending / uncertain awaiting observed process exit.
   - 409 mismatch preserves original target without retargeting.
4. **Input Fencing & Responsive Controls**:
   - Touch targets guaranteed >= 48dp on accessory controls.
   - Accessory collapse mode adjusts between expanded, single-row, and hidden under constrained viewports.
   - Input blocked when session is hidden, covered, or pending termination.

## Verification Evidence
- **Shared JVM Compilation**: `compileKotlinJvm` exit 0 (SUCCESS).
- **Android Debug Compilation**: `compileDebugKotlin` exit 0 (SUCCESS).
- **Focused Regression Tests**: 52/52 passed:
  - `TerminalPresentationPolicyTest`: 17/17 passed.
  - `TerminalConnectionPresentationTest`: 10/10 passed.
  - `ProjectTerminalVisibilityTest`: 16/16 passed.
  - `TerminalScreenBindingTest`: 5/5 passed.
  - `TerminalAttachQueueBindingTest`: 4/4 passed.

## Known Residual Issues (Noted for downstream P07/P08)
1. Pending termination lock is in-memory; remount/lifecycle recreation uses authoritative process state.
2. Viewport budget formula uses outer constraints budget rather than dynamic IME inset callback.
