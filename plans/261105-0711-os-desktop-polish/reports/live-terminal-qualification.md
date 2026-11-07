# Live Terminal Boundary Qualification Report — OS Desktop Polish (P08)

Date: 2026-11-05
Status: PASSED (Automated Verification)

## Terminal Boundary and Physical PTY Invariants

1. **Root Input Coordinator & Terminal Input Policy**:
   - The single root coordinator in `packages/ui/src/os/action-dispatch.ts` intercepts window-level key events.
   - Handled events are recorded in a WeakMap (`isEventHandledByCoordinator`).
   - `TerminalPanel.tsx` reads `isEventHandledByCoordinator(e)` at the entry of `baseKeyEventHandler(e)` and immediately returns `false` (suppressing event bytes from entering the xterm input pipeline and backend PTY).
   - Ordinary characters and Enter pass through cleanly to the terminal session.

2. **Context Menu Input Suppression**:
   - Synchronous context menu snapshotting via `subscribeContextMenu` in `packages/ui/src/lib/context-menu-coordinator.ts` is subscribed directly in `TerminalPanel.tsx`.
   - When a context menu (dock context menu or desktop background context menu) is active, `shouldSuppressNativeKeyboard` evaluates to `true` synchronously without waiting for React re-render cycles, blocking accidental stdin leakage.

3. **Cognito Privacy Mode Isolation**:
   - `useCognitoModeInputGuard` supplies its physical keyboard policy to the root coordinator.
   - Upon Cognito activation, all physical keyboard codes are consumed and marked handled, preventing any bytes from being emitted to live terminal streams or backends.

4. **Zero Attach / Replay / Reset Across Maximize**:
   - `DesktopCanvas.tsx` maintains stable presentation container slots (`data-os-presentation-container`) across tile, float, and maximized layers.
   - Windows promoted to the maximized plane do not unmount or recreate the xterm instance, guaranteeing zero additional WebSocket attachment, stream replay, or process restart.
