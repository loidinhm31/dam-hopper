# Phase 02: Runtime row presentation

## Context links

- [Parent plan](./plan.md)
- [Phase 01 dependency](./phase-01-activity-store-and-lifecycle.md)
- [Architecture gate](../../docs/system-architecture.md#browser-local-terminal-output-activity)
- [Accepted brainstorm](../reports/brainstorm-260816-1854-terminal-output-activity-indicator.md)

## Overview

- Date: 2026-08-16
- Description: Subscribe each Runtime terminal row to its session snapshot and render the accepted four-state indicator accessibly.
- Priority: P2
- Implementation status: DONE
- Review status: DONE
- Completed: 2026-08-17 00:44:18 +07:00
- Validation: Passed; code review 9.5/10, no warnings
- Effort: 2h

## Key Insights

- Process liveness and recent output are independent; `alive === false` always wins.
- Yellow means quiet/no output observed in the window, not idle, failed, or finished.
- `useSyncExternalStore`-style subscription prevents unrelated session updates and needs stable snapshots.
- Color needs matching text/title or screen-reader label.

## Requirements

- Subscribe by Runtime row session ID; do not lift chunk state into the terminal manager tree.
- Precedence: stopped > stream unavailable > recent output > quiet.
- Green receiving, yellow quiet, gray connecting/disconnected/replaying, red or muted stopped.
- Apply to selected and background mounted Runtime terminals without changing selection behavior.
- Reuse existing design tokens/classes where semantics fit; choose consistent accessible wording.

## Architecture

`TerminalRuntimeNavigatorItem` combines server-derived `alive` with the browser-local activity snapshot. It derives one presentation object containing visual class and accessible text. The row never reads timestamps or output data. Its subscription is exact-ID and transition-only, so high-volume output while already green does not rerender the row.

## Related code files

- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.tsx` — Modify; subscribe, derive precedence, render visual and accessible state.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx` — Modify; four states, precedence, labels, exact-ID updates, render/notification regression.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/lib/terminal-output-activity.ts` — Consume; immutable per-session snapshot API from Phase 01.

## Implementation Steps

1. Add a small hook or direct external-store subscription keyed by `session.id`, with stable server snapshot handling.
2. Derive presentation in fixed precedence; treat attach/replay/disconnected forms as gray stream unavailable.
3. Replace the alive-only dot with receiving/quiet/unavailable/stopped styling while preserving row selection, click, and layout behavior.
4. Add visible tooltip/title and screen-reader-readable status; avoid “idle,” “healthy,” or “running command.”
5. Verify status class/text changes only for the matching session and only on store transitions.

## Todo list

- [x] Subscribe Runtime item by exact session ID.
- [x] Implement precedence and four visual states.
- [x] Add accessible text/title for every state.
- [x] Preserve row interaction and selection styling.
- [x] Add focused component tests.

## Success Criteria

- `alive === false` renders stopped regardless of recent output or stream state.
- Unavailable stream renders gray before recent/quiet states.
- Recent live output renders green; expiry renders yellow with explicit quiet meaning.
- Selected/background rows display their own state without cross-ID updates.
- State remains understandable without color and meets existing keyboard/screen-reader behavior.

## Risk Assessment

- Existing stopped dot uses warning colors: select a separate stopped token without confusing quiet.
- Snapshot identity churn could loop/rerender: cache stable snapshots per transition.
- Overlong wording could disturb compact rows: use concise visual text plus tooltip/screen-reader detail.

## Security Considerations

- Presentation consumes booleans/enums only, never terminal output.
- Do not expose server paths, commands, or output excerpts in labels/tooltips.
- No change to auth, transport, persistence, or diagnostic capture.

## Next steps

- Phase 03 expands replay, hidden-session, lifecycle, accessibility, and render-frequency regression coverage.

## Unresolved questions

- None. Final labels/tooltips are consistent across tests and UI: Stopped, Output unavailable, Receiving output, and Quiet; the stopped state uses the danger token.
