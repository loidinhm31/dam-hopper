# Codex terminal notification replay

## Problem

After reload or returning to Workspace, retained PTY scrollback is written into xterm again. Historical Codex OSC 9 messages are therefore handled as new notifications. The user sees duplicate toast/native/sound events.

`OSC 10;rgb...` prompt color traffic is not the notification matcher. The UI registers xterm only for OSC 9. Its presence confirms raw terminal control data is replayed; a historical OSC 9 in the same retained buffer is the event that re-alerts.

## Agreed behavior

- Render the entire retained terminal buffer unchanged after attach/reconnect.
- Do not create notification history, toast, sound, or browser notification while that buffer is being replayed.
- After replay finishes, every new live OSC 9 emits a notification, including an identical payload from the same Bash session.
- No browser-storage or server-persisted deduplication.

## Evidence and touchpoints

- `packages/ui/src/components/organisms/TerminalPanel.tsx`: installs OSC 9 integration before `terminal:attach`, then calls `applyTerminalBufferReplay()` for the returned buffer.
- `packages/ui/src/lib/terminal-buffer-replay.ts`: writes raw retained output to xterm.
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`: xterm `registerOscHandler(9, ...)` immediately records, sounds, and delivers each parsed event.
- `server/src/pty/manager.rs`: retains PTY output for attach buffer replay.
- Existing coverage: `terminal-agent-notification-integration.test.ts` and `terminal-buffer-replay.test.ts`; no replay-does-not-notify regression.

## Options considered

1. Replay-aware notification suppression — recommended. Correctly distinguishes history from live events; keeps valid repeated OSC 9 events.
2. Persist payload fingerprints — rejected. Cannot reliably distinguish an old replay from a valid new identical event; needs expiry/lifecycle policy.
3. Strip OSC from server replay — rejected. Alters terminal replay semantics and is vulnerable to sequence chunking; broader protocol work.

## Recommended implementation shape

Expose a short-lived replay gate to the notification integration (or equivalent lifecycle state). `TerminalPanel` opens the gate before writing the attach buffer and closes it only after xterm has consumed that queued write. The OSC 9 handler returns normally but does not call notification delivery while the gate is active. Live `onTerminalData` remains ungated.

The completion boundary must be xterm-write-aware; a synchronous boolean reset immediately after `term.write()` may race with queued parser work.

## Acceptance and validation

1. Feed a retained buffer containing prompt OSC 10 traffic and an old valid OSC 9; it renders but creates zero notification records, sounds, or native notifications.
2. Immediately feed a live OSC 9 with the same payload; exactly one notification record, sound, and native notification is produced.
3. Remount/reload and repeat attach; no historical alert returns.
4. Existing repeated-live-OSC 9 test remains valid.
5. Run focused UI unit tests, then the package test suite/type check appropriate to changed files.

## Scope and risks

In scope: Codex OSC 9 notification delivery during `terminal:buffer` replay. Out of scope: persisting notification center history, changing shell OSC 10 color handling, server protocol changes, and generic notification deduplication.

Main risk: clearing the replay gate before xterm has parsed the buffer. Mitigate with a completion callback/promise from the write path and a focused regression test.

## Unresolved questions

None.
