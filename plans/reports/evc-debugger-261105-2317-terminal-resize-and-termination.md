# Diagnostic Report: Terminal Panel Resizing and OMP Session Termination

**Status**: Root Cause Identified (Read-Only Investigation; No Files Modified)
**Date**: 2026-11-05
**Reference**: `agent://EvcDebuggerTerminalInvestigate`

---

## 1. Issue 1 — Terminal Panel Resizing: Root Cause Analysis

### Primary Defect: Observer Mount-Race In `TerminalsApp.tsx`
- **Location**: `packages/ui/src/os/apps/TerminalsApp.tsx:357-373`
- **Mechanism**:
  1. `TerminalsApp` mounts. `useResourceClaim` (`resource-registry.ts:104-112`) initializes with `status: "pending"` (claim acquisition executes asynchronously in a layout effect).
  2. While claim is pending, lines 375-393 render a fallback placeholder container without `slotRef`.
  3. The `ResizeObserver` effect (lines 357-373) executes on initial render:
     ```tsx
     const host = slotRef.current;
     if (!host) return; // slotRef.current is null! Exits immediately without installing observer.
     ```
  4. The effect dependencies are `[sessionId, target, owner.profileId]`. `claim.success` is **not** in the dependency list.
  5. When the claim resolves to `success: true`, `TerminalsApp` re-renders and mounts `<div ref={slotRef} ...>`, but the resize observer effect **never re-runs**.
  6. **Observable Failure**: The outer floating window or split-tile DOM element visually resizes, but xterm's `ResizeObserver` is never attached to `slotRef`. `FitAddon.fit()` is never scheduled, leaving xterm's rows/cols frozen and the terminal canvas clipped or showing dead margins.

### Secondary Contributing Factors
- **Separate Parking Surface**: `TerminalPanel`'s own internal observer (`TerminalPanel.tsx:1402-1410`) watches its offscreen React keep-alive parking container (`TerminalKeepAliveHost.tsx:40-53`, fixed `1024x768`), not the active reparented host in `TerminalsApp`.
- **Tiled Windows vs Split Panes**: In OS Desktop mode, tiled windows are rendered via `GenericTileRenderer` (`SplitLayout.tsx:137-172`) with `react-resizable-panels`. Once the observer in `TerminalsApp` is missing, both floating and tiled resizing fail to adapt xterm.

---

## 2. Issue 2 — OMP Terminal "End Session" Just Closes View: Root Cause Analysis

### Primary Defect: Authority Header Name Spelling Mismatch
- **Location**:
  - Frontend: `packages/ui/src/api/terminal-session-contract.ts:19-20`
    ```ts
    export const TERMINATION_VERSION_HEADER = "X-Dam-Hopper-Termination-Version";
    export const PTY_EPOCH_HEADER = "X-Dam-Hopper-PTY-Epoch";
    ```
  - Backend: `server/src/api/terminal.rs:221-229`, `server/src/api/router.rs:716-751`, `docs/api-reference.md:129-143`
    ```rust
    header("x-damhopper-termination-version", "1")
    header("x-damhopper-pty-epoch", pty_manager.epoch().to_string())
    ```
- **Discrepancy**: Notice the extra hyphen in frontend: `Dam-Hopper` vs backend `DamHopper`.
- **Mechanism**:
  1. Header lookup is case-insensitive, but hyphen placement alters the header name.
  2. `ws-transport.ts:57-65` checks `headers.get(TERMINATION_VERSION_HEADER)`. Because backend sends `x-damhopper-*`, the lookup returns `null`.
  3. The transport classifies the server as `"unsupported"` and yields `serverEpoch: null`.
  4. Without `serverEpoch`, `TerminalsApp.tsx:144-174` cannot construct a valid `TerminalTarget`.
  5. When the terminal window is closed via the `X` button, `resolveWindowTerminalObservation` (`terminal-session-contract.ts:558-675`) cannot verify epoch against inventory and returns `availability: "unknown"`, `target: null`.
  6. In `WindowFrame.tsx:303-312`:
     ```tsx
     if (win.appId === "terminals" && (availability !== "live" && availability !== "restartPending")) {
       closeWindow(window.id);
       return;
     }
     ```
     Because `availability` is `"unknown"`, it bypasses the `TerminalCloseDialog` and directly calls `closeWindow(window.id)`.
  7. `closeWindow` only cleans up client store state; it never calls `/api/terminal/:id/terminate`.
  8. **Observable Failure**: The window vanishes from the UI (giving the illusion of closing), but the terminal PTY and `omp` process remain running in the backend.

### User UX Expectation vs Current Code
- User requirement: Closing a terminal window (via `X` or "End session") must terminate/kill the underlying process as before.
- Hiding a terminal without killing it is the exclusive role of **Minimize**, not Close/End.

---

## 3. Recommended Architectural Fixes (For Subsequent Implementation)

1. **Fix Resize Observer Lifecycle (`TerminalsApp.tsx`)**:
   - Include `claim.success` in the `ResizeObserver` effect dependencies (or use a callback ref on `slotRef`), ensuring the observer attaches the moment the host DOM node renders.
2. **Standardize Header Spelling (`terminal-session-contract.ts`)**:
   - Align frontend constants with backend contract:
     - Change `"X-Dam-Hopper-Termination-Version"` → `"X-DamHopper-Termination-Version"`
     - Change `"X-Dam-Hopper-PTY-Epoch"` → `"X-DamHopper-PTY-Epoch"`
3. **Restore True Terminal Termination on Close (`WindowFrame.tsx` & `terminal-close-context.tsx`)**:
   - Remove the silent `closeWindow` downgrade for `"unknown"` terminals. When `X` is clicked on a terminal, if the session is alive or unknown, trigger the guarded termination flow to kill the server process rather than closing presentation only.

---

## 4. Unresolved Questions
1. Does the user want the close button (`X`) on terminal windows to directly terminate the PTY without a confirmation dialog, or should it open the confirmation dialog with "End Session" as the default action?
2. Are there any detached/daemonized sub-processes spawned by `omp` that need explicit process-group tree signals beyond `SIGKILL` to the PTY leader?
