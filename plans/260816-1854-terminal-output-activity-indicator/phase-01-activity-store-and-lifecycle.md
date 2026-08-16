# Phase 01: Activity store and lifecycle publisher

## Context links

- [Parent plan](./plan.md)
- [Architecture gate](../../docs/system-architecture.md#browser-local-terminal-output-activity)
- [Accepted brainstorm](../reports/brainstorm-260816-1854-terminal-output-activity-indicator.md)
- Dependency: existing `WsTransport` per-ID dispatch and `TerminalPanel` replay barrier.

## Overview

- Date: 2026-08-16
- Description: Add a narrow content-free per-session activity store and publish post-replay xterm writes plus lifecycle availability.
- Priority: P2
- Implementation status: DONE
- Review status: DONE
- Completed: 2026-08-16 22:52:22 +07:00
- Validation: Passed
- Effort: 4h

## Key Insights

- `writeLiveData` is the correctness seam: raw frames and retained replay are too early.
- Timer callbacks must compare timestamps because background tabs delay timers.
- Frequent chunks update timestamps; only visible state transitions notify subscribers.
- Hidden kept-alive panels remain mounted, so no separate global transport observer needed.

## Requirements

- Fixed 3,000 ms recent-output window; ignore empty data.
- Isolate state, timers, and subscribers by exact session ID.
- Track stream unavailable during disconnect, attach, and replay; ready only after replay gate opens.
- Clear stale recent activity on attach reset, disconnect, transport replacement, exit, and panel cleanup.
- Never store output content or add network/server behavior.

## Architecture

`terminal:output {id,data}` -> `WsTransport.onTerminalData(id)` -> replay gate -> `writeLiveData`/xterm -> `markTerminalOutput(id)` -> session snapshot/subscriber. Store API stays framework-neutral and follows terminal-registry external-store conventions: read immutable snapshot, subscribe by ID, mark accepted output, set stream readiness, and dispose a session. One timer per active session; first chunk schedules it, bursts only refresh `lastOutputAt`, expiry reschedules remaining time or emits quiet once.

## Related code files

- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/lib/terminal-output-activity.ts` — Create; memory-only state, timer, snapshot, subscription, clear API.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/lib/terminal-output-activity.test.ts` — Create; deterministic fake-timer unit coverage.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/components/organisms/TerminalPanel.tsx` — Modify; publish post-replay writes and lifecycle availability/cleanup.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/lib/terminal-registry.ts` — Reference only; reuse external-store conventions, do not merge responsibilities.
- `/home/loidinh/WS/dam-hopper-ws/feat-terminal-output-activity-indicator/packages/ui/src/api/ws-transport.ts` — Reference only; no protocol or dispatch change.

## Implementation Steps

1. Define minimal immutable snapshot (`recentOutput`, stream availability) and fixed timeout constant; keep timestamps/timers private.
2. Implement per-ID `getSnapshot`/`subscribe`, `markOutput`, availability transition, and disposal APIs with stable quiet defaults.
3. On first accepted output transition to recent and schedule expiry; on burst update timestamp only; on callback compare `now`, reschedule remaining duration, or transition quiet.
4. In `TerminalPanel`, invoke mark only for non-empty chunks passed through `writeLiveData`, alongside the xterm write path and never replay/synthetic writes.
5. Mark stream unavailable before attach/replay and on disconnect/transport replacement; mark ready only when replay drains; clear on exit and effect cleanup.
6. Keep cleanup ownership safe under remount/replacement so an obsolete panel cannot clear newer session state; use the panel's exact lifecycle token/registration pattern if needed.
7. Add fake-timer tests before UI integration.

## Todo list

- [ ] Create activity store and typed public API.
- [ ] Integrate post-replay output publisher.
- [ ] Integrate disconnect/attach/replay/exit/replacement/cleanup transitions.
- [ ] Test per-ID isolation, burst coalescing, expiry, timestamp refresh, and disposal.
- [ ] Assert subscriber counts do not increase for chunks while already recent.

## Success Criteria

- Terminal A output never mutates or notifies terminal B.
- First live chunk emits one recent transition; a burst emits no additional recent notifications.
- Quiet occurs no earlier than 3 seconds after latest chunk, including delayed timer execution.
- Replay alone stays unavailable/quiet; queued live data activates only after `writeLiveData` drains it.
- Lifecycle boundaries cannot leave stale recent state; store retains no output string.

## Risk Assessment

- Stale cleanup races with replacement panel: bind cleanup to current registration/lifecycle ownership.
- Timer throttling: derive expiry from timestamp, never callback count.
- Per-chunk React churn: separate timestamp mutation from externally visible snapshot transition.
- False semantics: name state as observed recent output, never busy/healthy/idle.

## Security Considerations

- Output bytes must not enter the store, logs, diagnostics, persistence, labels, or test snapshots.
- No new authenticated surface, cross-origin behavior, listener scope, or server broadcast.
- Explicit cleanup bounds memory and prevents cross-session state reuse.

## Next steps

- Phase 02 subscribes Runtime rows by session ID and applies accepted precedence.

## Unresolved questions

- None for store behavior.
