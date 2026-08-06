# Phase 02 — Terminal and custom-keyboard integration

## Context links

- [Plan](plan.md)
- `packages/ui/src/components/organisms/TerminalPanel.tsx:114-133,222-256,495-497,711-713`
- `packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx:38-132`
- `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx:59-173`
- `packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx:45-193`
- `packages/ui/src/components/pages/WorkspacePage.tsx:980-997,1313-1371`

## Overview

Priority: high · Status: pending · Owner: implementation agent

Make the root policy authoritative for every xterm instance. The current failure is a contradictory prop: `WorkspacePage` mounts `TerminalKeepAliveHost` with `suppressAutoFocus` but explicitly passes `suppressNativeKeyboard={false}`, restoring xterm’s editable textarea (`inputMode="text"`, `tabIndex=0`).

## Key insights

- The hidden keep-alive host owns the terminal instances used by runtime displays; changing only the visible runtime component is insufficient.
- `scheduleTerminalFit`, notification activation, pane focus, click handlers, history, and find-close all have focus paths.
- The native mobile input is intentional today; Android policy must override the persisted `mobileCustomKeyboardEnabled=false` path.

## Requirements

- Pass one derived suppression decision through every `TerminalKeepAliveHost`/`TerminalPanel` owner, including the hidden host in `WorkspacePage`.
- In suppressed mode, keep xterm `disableStdin`, `inputMode="none"`, `tabIndex=-1`, and blur behavior synchronized after mount, reparent, attach, remount, and policy changes.
- Gate every direct terminal `.focus()` path with the same decision; do not rely on callers remembering separate flags.
- Force the custom accessory keyboard on Android Chrome and do not render/focus `MobileTerminalNativeKeyboardInput` there.
- Preserve native terminal typing and all existing focus behavior when policy is inactive on desktop.
- Set Monaco editor read-only while policy is active, including regular, diff-modified, and merge-result editors; retain scrolling and non-editing actions.
- Disable text-dependent Save/Apply/Submit actions where the corresponding mobile text field/editor is unavailable; retain Close/Cancel/Copy/navigation actions.
- Do not disable file inputs or non-text controls through the terminal policy.

## Architecture

Use the policy hook in the terminal display/host boundary and keep `TerminalPanel` as the low-level xterm invariant. Replace duplicated compact/coarse/setting derivations with a shared `shouldSuppressTerminalNativeInput` decision where practical. Avoid adding `virtualKeyboard.show/hide`; it is not needed once editable targets are not focusable and has limited support.

## Related code files

- `TerminalPanel.tsx`, `terminal-fit-scheduler.ts`, `terminal-host-attachment.ts`
- `TerminalRuntimeOutput.tsx`, `MultiTerminalDisplay.tsx`, `TerminalKeepAliveHost.tsx`, `PaneContainer.tsx`
- `MobileTerminalAccessoryBar.tsx`, `MobileTerminalNativeKeyboardInput.tsx`
- `WorkspacePage.tsx`
- `MonacoHost.tsx`, `DiffViewer.tsx`, `MergeConflictEditor.tsx`

## Implementation steps

1. Fix the hidden-host override and centralize the terminal suppression decision.
2. Add a terminal focus helper/guard so fit, pane, notification, click, history, and find paths cannot re-enable native focus on Android Chrome.
3. Make accessory-bar mode resolve to custom keyboard whenever the policy is active.
4. Pass policy state into Monaco options and guard programmatic editor focus.
5. Remove or bypass the native mobile input only under the Android policy; keep the existing desktop/native-mobile setting behavior outside it.
6. Add predictable focus fallback for dialogs/editors so blocked fields never receive autofocus or trap the user.

## Todo list

- [ ] Add a regression test for `WorkspacePage`/host prop propagation.
- [ ] Add tests for each direct focus path or the shared focus helper.
- [ ] Add editor read-only tests for all three Monaco surfaces.
- [ ] Check persisted `mobileCustomKeyboardEnabled=false` cannot override Android policy.

## Success criteria

- No xterm or native mobile input becomes focusable in Android Chrome.
- Custom terminal buttons still send expected PTY sequences.
- Desktop xterm/Monaco editing remains unchanged.
- Reparenting, terminal selection, notification navigation, find/history close, and layout refits do not open the IME.

## Risk assessment

High: terminal usability depends on custom-keyboard coverage; an omitted focus call can regress the requirement. Keep one shared policy and add focused tests before broad test execution.

## Security considerations

No new input capture or transport path. Keep PTY writes on existing typed key-sequence functions and never add raw keystroke logging.

## Next steps

Run unit/browser tests, then validate on a real Android Chrome device/emulator.
