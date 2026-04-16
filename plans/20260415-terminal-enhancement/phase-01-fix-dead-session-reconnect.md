# Phase 01 — Bug Fix A: Filter Dead Sessions in Reconnect Check

## Context
- Parent: [plan.md](./plan.md)
- Source: [terminal-crash-debug.md § Failure Mode 4](./terminal-crash-debug.md)
- Dependencies: none (standalone, can land first)

## Overview
- Date: 2026-04-16
- Description: Dead sessions leak into `terminal:list` response; client reconnect path matches on ID only, skipping `terminal:create`, so xterm sits blank.
- Priority: P1 (High severity bug, trivial fix)
- Implementation status: pending
- Review status: pending

## Key Insights
- `PtySessionManager::list()` returns both live and dead tombstones.
- `TerminalPanel` reconnect check: `alive.some(s => s.id === sessionId)` — matches dead tombstone, skips create.
- `SessionMeta.alive: bool` already exists and is serialized.
- This fix unblocks manual test loops for subsequent phases.

## Requirements
- Reconnect only if a **live** session with matching id exists.
- No server changes required (field already present on wire).
- Verify `SessionInfo` type in `packages/web/src/api/client.ts` includes `alive: boolean`.

## Architecture
Pure client-side filter tightening. No protocol change.

## Related Code Files
- `packages/web/src/components/organisms/TerminalPanel.tsx` (reconnect branch around L95–L108)
- `packages/web/src/api/client.ts` (`SessionInfo` type)
- `server/src/pty/manager.rs::list()` (verify shape only)

## Implementation Steps
1. Confirm `SessionInfo` interface exposes `alive: boolean`. Add field if missing.
2. Update predicate in `TerminalPanel.tsx`: `alive.some(s => s.id === sessionId && s.alive)`.
3. Add TODO comment pointing to Phase 7 which deprecates this client-side check.
4. Manual smoke: kill a running session via UI, re-open tab → new shell prompt appears.

## Todo
- [ ] Verify `alive` in `SessionInfo`
- [ ] Tighten predicate
- [ ] Smoke test dead-session reconnect
- [ ] Smoke test live-session reconnect (buffer replay still works)

## Success Criteria
- After a session exits, reopening its terminal tab spawns a new process.
- Live-session reconnect continues to replay scrollback buffer.

## Risk Assessment
- Low. Localized one-line predicate change.
- Regression risk: none — tighter filter cannot match more sessions than before.

## Security Considerations
None.

## Next Steps
Proceed to Phase 2 (config schema).
