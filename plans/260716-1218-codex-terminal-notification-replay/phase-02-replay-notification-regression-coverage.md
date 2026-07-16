# Phase 02 — Replay notification regression coverage

## Context links

- Parent: [plan.md](./plan.md)
- Lifecycle design: [phase 01](./phase-01-replay-safe-notification-lifecycle.md)
- Current tests: `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`, `packages/ui/src/lib/terminal-buffer-replay.test.ts`

## Overview

- Date: 2026-07-16
- Description: prove replay is silent and later identical live OSC 9 remains visible.
- Priority: P2
- Implementation status: pending
- Review status: pending

## Key insights

- Current tests validate repeated live OSC 9 and raw replay writes separately; neither covers their interaction.
- Browser native rate limiting alone is insufficient because in-app records and sound are created before it, and its map resets on remount.

## Requirements

- Assert zero store records, sound calls, and native notifications for retained replay containing both OSC 10 color traffic and old OSC 9.
- Assert exactly one of each channel for a subsequent live OSC 9 with the same payload.
- Assert xterm replay completion controls when the gate changes, not merely when write is invoked.
- Keep the existing repeated-live OSC 9 coverage intact.

## Architecture

Use deterministic fake xterm/parser/write callbacks. The test explicitly completes the replay write, then feeds queued and later live events to distinguish historical parsing from live delivery.

## Related code files

- Modify: `packages/ui/src/lib/terminal-agent-notification-integration.test.ts` — replay-gate and identical-live-payload assertions.
- Modify: `packages/ui/src/lib/terminal-buffer-replay.test.ts` — optional completion callback and reset/delta preservation assertions.
- Modify or extend the closest terminal-panel test surface — exercise `terminal:buffer` followed by live transport data and verify ordered release; avoid a full server/browser dependency.

## Implementation steps

1. Update replay-helper tests to capture and invoke the xterm write completion callback; assert clear/write content remains byte-for-byte unchanged.
2. Add integration tests with fake `Notification`, sound mock, and Zustand store: historical OSC 9 is silent while replay gate is set; after completion, the same payload notifies.
3. Add a focused `TerminalPanel` lifecycle regression using mocked transport/xterm: emit buffer replay, emit live output before completion, complete replay, then verify that output is processed after the gate opens and in order.
4. Run focused Vitest tests first, then the UI package suite and applicable type/lint check. Do not claim browser behavior fixed without fresh test output.

## Todo list

- [ ] Cover replay-silent OSC 9.
- [ ] Cover identical post-replay live OSC 9.
- [ ] Cover deferred xterm completion and concurrent live data.
- [ ] Run focused and package-level verification.

## Success criteria

- Reload/navigation replay cannot regenerate notification history, sound, toast, or popup.
- A later real shell/Codex OSC 9 produces one alert even when title/body match history.
- No regressions in existing repeated-live notification behavior.

## Risk assessment

- Risk: mocked xterm callback differs from real scheduling. Mitigation: keep the callback boundary aligned with xterm's public `write` API and include the existing browser test suite in validation.
- Risk: component test setup is heavy. Mitigation: keep parser/service behavior unit-tested and mock only terminal transport for the one lifecycle regression.

## Security considerations

- Tests must use synthetic OSC strings only; no user terminal history or project commands.

## Next steps

After implementation, inspect the code diff against Phase 01 and update architecture documentation only if the final lifecycle differs from this bug-fix design.

## Unresolved questions

None.
