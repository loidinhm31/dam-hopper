# Phase 02 — TerminalPanel integration

## Context links

- [Plan](plan.md)
- [Phase 01](phase-01-recovery-controller.md)
- `packages/ui/src/components/organisms/TerminalPanel.tsx:353-396, 508-653, 664-722`
- `packages/ui/src/lib/terminal-stream-replay-gate.ts`

## Overview

Date: 2026-07-18 · Priority: high · Completed: 2026-07-18 22:52 +07 · Status: completed

## Key insights

An attach resets the replay gate, and buffer receipt opens it. Integration must preserve that ordering but allow only controller-authorized attach sends. Existing startup still probes detailed sessions to decide whether to attach or create; the controller should be used only after that initial choice, avoiding behavior change to auto-restoration.

## Requirements

- Replace `attachTimeout`, `clearAttachTimeout`, and recursive timeout recovery with one controller instance created inside the mount effect.
- Keep replay-gate reset and `suggestionsRef.current.handleReplay()` immediately before each authorized attach send.
- Call controller buffer completion before/with current replay processing; dispose it before terminal cleanup.
- Route WebSocket status events to the controller rather than calling `attachToSession` directly.
- Retain startup discovery and `createSession` semantics, but make creation controller-guarded for a confirmed-dead recovery.
- Correct log wording to describe a timeout/retry rather than falsely claiming a new session is being created; emit bounded state-transition diagnostics.

## Architecture

`TerminalPanel` remains the adapter for React state, xterm replay, and `WsTransport`. It supplies callbacks to the controller: attach invokes `transport.terminalAttach`, liveness invokes `terminal:listDetailed`, and creation invokes existing `terminal:create`. The controller decides when callbacks may run; the panel applies UI state and replay-gate operations only for approved attach attempts.

## Related code files

- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/lib/terminal-attach-recovery-controller.ts`
- `packages/ui/src/lib/diagnostics-client.ts` (consume existing API; change only if bounded event support is genuinely needed)
- `packages/ui/src/api/ws-transport.ts` (no expected change)

## Implementation steps

1. Instantiate the controller after transport/listener setup with panel-local callbacks and session metadata.
2. Change initial alive-session startup and creation completion to request recovery through the controller.
3. Forward buffer receipt and every transport status change to controller methods, preserving existing replay offset behavior for confirmed attached reconnects.
4. Remove recursive attach and manual timeout logic; ensure effect cleanup disposes controller before disposing xterm and subscriptions.
5. Confirm UI attach/creating state remains meaningful when the retry cap is reached; do not spin forever.

## Todo list

- [x] Wire controller without changing WS message shape or server calls.
- [x] Remove duplicate timer/probe ownership from panel.
- [x] Replace noisy warning text and diagnostic events.
- [x] Audit strict-mode remount and unmount paths.

## Success criteria

All live sessions mounted by the keep-alive host still restore. A missing buffer produces bounded, delayed retry behavior at a capped maximum interval; refresh/unmount leaves no pending attach work.

## Risk assessment

Buffer can arrive after timeout or across reconnect. Generation/cancellation must prevent it from settling a newer attach incorrectly. Creation must stay limited to confirmed dead sessions and never occur twice due to late liveness results.

## Security considerations

No auth, permissions, server endpoints, or persisted data changes. Continue using existing diagnostic redaction.

## Next steps

Add regression coverage and run quality gates in Phase 03.

## Completion record

Completed 2026-07-18 22:52 +07. Integration completed with the client/server contract unchanged; focused tests, UI TypeScript build, and full UI Vitest passed; reviewed and approved.
