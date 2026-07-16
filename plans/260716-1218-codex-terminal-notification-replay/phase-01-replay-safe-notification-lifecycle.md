# Phase 01 — Replay-safe notification lifecycle

## Context links

- Parent: [plan.md](./plan.md)
- Decision record: [brainstorm report](../../reports/brainstorm-260716-1218-codex-terminal-notification-replay.md)
- Architecture: [xterm notifications](../../docs/system-architecture.md#xterm-agent-notifications-phase-2)

## Overview

- Date: 2026-07-16
- Description: distinguish historical buffer replay from live PTY output for OSC 9 delivery.
- Priority: P2
- Implementation status: completed 2026-07-16 13:14 +07
- Review status: approved 2026-07-16 13:14 +07

## Key insights

- `TerminalPanel` installs the OSC 9 handler before `terminal:attach` writes retained scrollback.
- xterm dispatches OSC handlers while parsing `term.write`; replay bytes therefore look live without an explicit lifecycle boundary.
- `OSC 10;rgb...` is color-query traffic, not a notification matcher. The handler is registered only for OSC 9.
- `term.write` is asynchronous. Resetting a boolean immediately after the call races with parsing; suppressing the whole attach interval would incorrectly hide genuine live OSC 9 events.

## Requirements

- Historical replay creates no in-app record, toast, sound, or native browser notification.
- Terminal visual output, buffer offset semantics, and attach/reconnect protocol stay unchanged.
- A newly emitted OSC 9, even with an identical payload, notifies once after replay completes.
- No raw terminal payload enters client diagnostics or browser storage.

## Architecture

`terminal:buffer` → mark replay active → write retained data → xterm completion → mark replay inactive → flush queued live data in order. The OSC 9 handler consumes the sequence in both states but calls delivery only when replay is inactive. Data that arrives before any attach buffer retains the existing fail-closed diagnostic path; data during an active replay queues instead of dropping or misclassifying it.

## Related code files

- Modify: `packages/ui/src/components/organisms/TerminalPanel.tsx` — own attach/replay state and ordered live-data queue.
- Modify: `packages/ui/src/lib/terminal-agent-notification-integration.ts` — add a narrow replay-delivery gate to the OSC 9 path.
- Modify: `packages/ui/src/lib/terminal-buffer-replay.ts` — pass through xterm write completion without altering raw replay content.

## Implementation steps

1. Extend the replay target's `write` contract to accept the optional xterm completion callback. Keep `clear()` and offset-return behavior intact.
2. Add a replay-state setter or equivalent explicit gate to `TerminalAgentNotificationIntegration`. In the OSC 9 handler, return handled but skip `notifyTerminalAgent` while replay state is active. Do not add payload IDs, storage, or server calls.
3. In `TerminalPanel`, replace the single synchronous initial-buffer flag with explicit attach-buffer-received, replay-writing, and ready/queued-live states. Preserve the timeout and reconnect checks using the received-buffer state.
4. Before every `applyTerminalBufferReplay` call, activate the notification gate. In its completion callback, deactivate the gate, mark the stream ready, and flush queued live chunks in original order while updating offsets and suggestion output hooks exactly once per chunk.
5. Keep cleanup safe: invalidate the callback/queue on effect teardown so a late xterm completion cannot write to a disposed terminal or re-enable a disposed integration.
6. Keep diagnostics metadata-only; optionally record queue count/state but never raw replay or OSC payload text.

## Todo list

- [x] Add replay-aware delivery state.
- [x] Make replay completion xterm-write-aware.
- [x] Queue and flush concurrent live terminal data.
- [x] Preserve timeout, reconnect, offset, and teardown behavior.

## Success criteria

- Replayed OSC 9 does not deliver any notification channel.
- The same live OSC 9 after replay delivers normally.
- Existing terminal rendering and reconnect behavior retain their offsets and ordering.

## Risk assessment

- Risk: live output arrives before xterm finishes parsing replay. Mitigation: queue it, then flush after replay completion.
- Risk: a delayed callback fires after unmount. Mitigation: liveness/disposal guard and queue cleanup.
- Risk: attach timeout mistakes a slow parser for a missing server response. Mitigation: record buffer receipt separately from replay completion.

## Security considerations

- No new API, persistence, privilege, or terminal data export.
- Retain safe diagnostics: session IDs and state counts only; never record OSC bodies or commands.

## Completion

- Implemented an xterm-write-completion replay gate, ordered concurrent-live-data queue, and teardown guard.
- Validation passed for focused replay lifecycle coverage and affected UI package checks.

## Next steps

Implement focused unit tests before and alongside the lifecycle change in Phase 02.

## Unresolved questions

None.
