# Phase 01 — Recovery controller

## Context links

- [Plan](plan.md)
- `packages/ui/src/components/organisms/TerminalPanel.tsx:529-635`
- `packages/ui/src/api/ws-transport.ts:1816-1830`

## Overview

Date: 2026-07-18 · Priority: high · Completed: 2026-07-18 22:52 +07 · Status: completed

## Key insights

`attachToSession()` currently creates an independent timeout each call. Its timeout can re-enter `attachToSession()` after a live-session probe, while reconnect status can call it too. The effect has only a timeout cleanup, not ownership for in-flight liveness promises or a retry budget.

## Requirements

- Expose a small pure controller in `terminal-attach-recovery-controller.ts` with injected clock/scheduler and callback actions.
- Permit at most one active attach/recovery flight, timeout, liveness probe, and creation path per mounted session.
- Retry an alive session after exponential backoff with a capped maximum interval; reset successful recovery state only when a buffer is received.
- Cancel and invalidate timers/promises on buffer receipt, disconnect, and dispose. A reconnect may schedule/continue recovery but must not duplicate it.
- Report state transitions through bounded callbacks so integration can emit one accurate diagnostic per recovery episode rather than one per recursive attempt.

## Architecture

The helper owns only lifecycle decisions: `start`, `onBuffer`, `onConnectionStatus`, `dispose`, attach-timeout handling, liveness result handling, and retry scheduling. Dependencies are callbacks (`sendAttach`, `checkAlive`, `create`, diagnostic event) and injected timers. A monotonically increasing generation makes late timers and promises harmless. It has no React, xterm, transport, or storage dependency.

## Related code files

- New: `packages/ui/src/lib/terminal-attach-recovery-controller.ts`
- New: `packages/ui/src/lib/terminal-attach-recovery-controller.test.ts`
- Existing integration target: `packages/ui/src/components/organisms/TerminalPanel.tsx`

## Implementation steps

1. Define explicit controller state and callback contract, including a single retry timer and generation token.
2. Implement attach dispatch only when connected and no flight is active; treat unavailable transport as deferred rather than a retry storm.
3. On timeout, start one liveness check. Alive schedules exponential retry at a capped maximum interval; dead invokes guarded creation once; check failure schedules the same bounded retry and emits no repeated outage diagnostic.
4. Make buffer receipt terminal for the current recovery generation and cancel all delayed work.
5. Implement disconnect/dispose cancellation and reconnect re-entry safeguards.

## Todo list

- [x] Add pure controller with private, documented retry constants.
- [x] Add fake-timer unit tests before integration.
- [x] Keep helper focused and under repository size guidelines.

## Success criteria

Repeated timeout, reconnect, and late promise events never create overlapping attaches, probes, creates, or timers for one controller instance.

## Risk assessment

Too aggressive an in-flight lock can block recovery after a dropped attach; controller must release/advance only through timeout, explicit unavailable send, buffer, or cancellation. The retry delay cap must limit background work while still allowing eventual automatic recovery.

## Security considerations

Do not capture terminal data, command text, tokens, or unredacted errors in the new event metadata.

## Next steps

Integrate controller at the terminal effect boundary in Phase 02.

## Completion record

Completed 2026-07-18 22:52 +07. Recovery controller delivered and covered by the focused controller/restoration test run (20 passed); reviewed and approved.
