# Phase 06 — Frontend: Status Dots, Restart Badge, Exit Banner, Reconnect Indicator

## Context
- Parent: [plan.md](./plan.md)
- Sources: [f01-feasibility-plan.md § Phase 5](./f01-feasibility-plan.md), [terminal-crash-debug.md Fixes C + D](./terminal-crash-debug.md)
- Dependencies: Phase 5 (wire events), Phase 2 (type mirrors).

## Overview
- Date: 2026-04-16
- Description: Surface lifecycle state in the UI. Add inline xterm banners for exit and reconnect.
- Priority: P1
- Implementation status: pending
- Review status: pending

## Key Insights
- Banner text branches on `willRestart`: `"[Process exited, restarting in 2s…]"` vs `"[Process exited with code 1]"`.
- Reconnect indicator uses WS transport status events. `WsTransport` already has reconnect backoff; add a status listener API if not present.
- Status dot colors:
  - 🟢 alive
  - 🟡 restarting (dead with `willRestart=true`, within backoff window)
  - 🔴 dead + crashed (exit≠0, no restart — either policy=never or retries exhausted)
  - ⚪ dead + clean (exit=0, policy=never)

## Requirements
- `SessionInfo` in `client.ts` mirrors Phase 3 fields: `restartPolicy`, `restartCount`, `lastExitAt`, `willRestart`, `restartInMs`.
- `DashboardPage.tsx` `SessionRow` renders dot + optional `↻ N` badge when `restartCount > 0`.
- `TerminalPanel.tsx` writes banner on `onTerminalExit`, coloring green/red by exit code; shows yellow restart banner when `willRestart`.
- `TerminalPanel.tsx` writes `[Reconnecting…]` dim banner when WS status goes disconnected; clears line on reconnect (or simply writes `[Reconnected]`).
- Transport: `onTransportStatus(cb: (s: "connected"|"reconnecting"|"disconnected") => void)` accessor.
- Listen for `process:restarted` → invalidate session queries / refresh list.

## Architecture
No new components; existing `SessionRow`, `TerminalPanel`, `WsTransport`. Dot is a `<span>` with Tailwind color class driven by a `getSessionStatus(sess)` helper.

## Related Code Files
- `packages/web/src/api/client.ts` — type additions
- `packages/web/src/api/ws-transport.ts` — `onTransportStatus`, `onProcessRestarted` plumbing
- `packages/web/src/components/pages/DashboardPage.tsx` — `SessionRow` dot + badge
- `packages/web/src/components/organisms/TerminalPanel.tsx` — banners
- `packages/web/src/components/organisms/TerminalTreeView.tsx` — mirror dot in tree header

## Implementation Steps
1. Extend `SessionInfo` type.
2. Add `getSessionStatus(sess): "alive" | "restarting" | "crashed" | "exited"` helper.
3. `SessionRow`: dot + optional `↻ N` badge next to uptime; tooltip shows policy + last exit code.
4. `TerminalPanel` exit handler:
   ```ts
   transport.onTerminalExit(id, (e) => {
     const color = e.willRestart ? "\x1b[33m" : e.exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
     const text = e.willRestart
       ? `[Process exited (code ${e.exitCode}), restarting in ${Math.round((e.restartIn ?? 0)/1000)}s…]`
       : `[Process exited with code ${e.exitCode ?? "?"}]`;
     term.write(`\r\n${color}${text}\x1b[0m\r\n`);
     onExit?.(e.exitCode);
   });
   ```
5. `TerminalPanel` `onProcessRestarted` handler: `\x1b[33m[Process restarted (#N)]\x1b[0m\r\n` then `term.clear()` is optional.
6. `WsTransport.onTransportStatus` listener invoked on connect/reconnecting/disconnect.
7. `TerminalPanel` writes `\x1b[2m[Reconnecting…]\x1b[0m` on disconnect; `\x1b[2m[Reconnected]\x1b[0m` on connect.
8. Invalidate TanStack queries for terminal list on `process:restarted`.

## Implementation Complete ✓

### Key Implementation Details

#### 1. Session Status Helper (`session-status.ts`)

New module at `packages/web/src/lib/session-status.ts` centralizes session lifecycle logic.

**Types:**
```ts
export type SessionStatus = "alive" | "restarting" | "crashed" | "exited";
```

**Functions:**
- `getSessionStatus(sess: SessionInfo): SessionStatus` — Determines UI status from session metadata
  - `"alive"`: `sess.alive === true`
  - `"restarting"`: `sess.alive === false && sess.willRestart === true` (within backoff window)
  - `"crashed"`: `sess.alive === false && (sess.exitCode !== 0 && sess.exitCode !== null)` and no restart
  - `"exited"`: `sess.alive === false && sess.exitCode === 0` (clean exit, no restart)
- `getStatusDotColor(status): string` — Maps status to Tailwind class
  - `"alive"` → `"bg-green-500"` (+ `status-glow-green` effect)
  - `"restarting"` → `"bg-yellow-500"` (+ `status-glow-orange` effect)
  - `"crashed"` → `"bg-red-500"`
  - `"exited"` → `"bg-[var(--color-text-muted)]/30"`
- `getStatusGlowClass(status): string` — Optional glow effect for alive/restarting states

**Unit Tests:**
- `session-status.test.ts` validates all status transitions and color mappings

#### 2. Frontend Component Updates

**StatusDot Component** (`TerminalTreeView.tsx`)
```tsx
function StatusDot({ session }: { session?: SessionInfo | null }) {
  if (!session) return <span className="h-2 w-2 rounded-full bg-[...]/30" />;
  const status = getSessionStatus(session);
  const dotColor = getStatusDotColor(status);
  return <span className={`h-2 w-2 rounded-full ${dotColor}`} />;
}
```
- Placed in `TerminalTreeView` for project commands and free terminals
- Uses `session-status` helper to determine color
- Optional glow effect for active states

**Restart Badge** (`DashboardPage.tsx` or `SessionRow`)
- Badge only shows when `restartCount > 0`
- Format: `↻ N` with yellow background (`bg-yellow-500/10`)
- Positioned next to uptime or session status
- Tooltip: "Restarted N time(s)"

#### 3. Terminal Panel Banners (`TerminalPanel.tsx`)

**Exit Banner** — Fired on `onTerminalExit` event:
```ts
// Green for clean exit, red/yellow for failure
const color = sess.willRestart ? "\x1b[33m"        // yellow (restart pending)
            : sess.exitCode === 0 ? "\x1b[32m"     // green (clean)
            : "\x1b[31m";                           // red (crashed)

const text = sess.willRestart
  ? `[Process exited (code ${sess.exitCode}), restarting in ${Math.round((sess.restartInMs ?? 0)/1000)}s…]`
  : `[Process exited with code ${sess.exitCode ?? "?"}]`;

term.write(`\r\n${color}${text}\x1b[0m\r\n`);
```

**Restart Banner** — Fired on `process:restarted` event:
```ts
term.write(`\r\n\x1b[33m[Process restarted (#${session.restartCount})]\x1b[0m\r\n`);
```

**Reconnect Indicators** — Fired on WS transport status changes:
- Disconnect: `\x1b[2m[Reconnecting…]\x1b[0m` (dim gray)
- Reconnect: `\x1b[2m[Reconnected]\x1b[0m` (dim gray)
- Always prefix and suffix with `\r\n` to prevent output interleaving

#### 4. Event Subscriptions

**Exit Event Handler:**
```ts
transport.onTerminalExit(sessionId, (event) => {
  // event has: id, exitCode, willRestart, restartInMs, restartCount
  // Write banner as above
  onExit?.(event.exitCode);
});
```

**Restart Event Handler:**
```ts
transport.onProcessRestarted(sessionId, (event) => {
  // event has: id, restartCount, previousExitCode
  // Write restart banner
});
```

**Transport Status Handler:**
```ts
transport.onTransportStatus((status) => {
  // status: "connected" | "reconnecting" | "disconnected"
  if (status === "disconnected") term.write("\r\n\x1b[2m[Reconnecting…]\x1b[0m\r\n");
  if (status === "connected") term.write("\r\n\x1b[2m[Reconnected]\x1b[0m\r\n");
});
```

#### 5. Query Invalidation

On `process:restarted` event:
```ts
// Invalidate terminal list queries to refresh UI
queryClient.invalidateQueries({ queryKey: ["terminal:list"] });
```

### SessionInfo Type Extensions

```ts
export interface SessionInfo {
  id: string;
  project?: string;
  command: string;
  cwd: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
  // Phase 3 restart policy fields
  restartPolicy?: "never" | "on-failure" | "always";
  restartCount?: number;
  lastExitAt?: number;
  // Phase 5 exit event fields
  willRestart?: boolean;
  restartInMs?: number;
}
```

## Todo
- [x] `SessionInfo` type additions
- [x] `getSessionStatus` helper + tests
- [x] `StatusDot` in TerminalTreeView
- [x] Restart badge in SessionRow
- [x] `TerminalPanel` exit banner (willRestart-aware)
- [x] `TerminalPanel` restart banner
- [x] WS transport status listener + banner
- [x] Query invalidation on restart

## Success Criteria ✓ VALIDATED

- ✓ Status dots display correct colors:
  - 🟢 Green for alive processes
  - 🟡 Yellow during restart backoff
  - 🔴 Red for crashed (exit≠0, no restart)
  - ⚪ Light gray for clean exit (exit=0)
- ✓ Restart badge appears and increments after each restart
- ✓ Exit banner shows correct text and color based on exit code and willRestart flag
- ✓ Restart banner appears with correct restart count
- ✓ Reconnect indicator shows on WS disconnect/reconnect
- ✓ Dashboard auto-refreshes when process restarts
- ✓ Banner text does not interleave with normal output

## Risk Assessment
- **Low.** UX-only changes using well-established xterm ANSI sequences.
- **Mitigations:**
  - Banner interleaving: always prefix/suffix with `\r\n` to isolate banners
  - Color rendering: use standard ANSI codes tested across major terminals
  - Event ordering: relies on Phase 5 event ordering (already validated)

## Security Considerations
- ✓ Session status fields are numbers and booleans (no injection risk)
- ✓ Banner templates use fixed strings, exit codes/restart counts are injected as numbers
- ✓ No HTML/ANSI escaping needed (xterm.js handles raw sequences)
- ✓ Transport status only reflects internal state (no user input)

## Test Coverage

**Manual Tests** (`phase-06-test-plan.md`):
- T1: Status dot colors (all four states)
- T2: Restart badge (increment, tooltip)
- T3: Exit banner (green/red/yellow branches)
- T4: Restart banner (appears with correct count)
- T5: Reconnect indicator (dim banners on WS events)
- T6: Query invalidation (dashboard auto-refresh)
- T7: TerminalTreeView status dot (mirrors DashboardPage)

**Unit Tests** (`session-status.test.ts`):
- All status transitions covered
- Color mapping validated for each status
- Glow class logic verified

## Related Documentation

- [WebSocket Protocol Guide](../../docs/ws-protocol-guide.md) — Phase 5 events
- [System Architecture](../../docs/system-architecture.md) — Frontend component structure
- [Frontend Components](../../docs/frontend-components.md) — Detailed component API

## Next Steps

**Phase 7** (Create Idempotency) — Server-side optimization:
- Auto-clean dead session tombstones on terminal creation
- Simplifies client reconnect logic (no need for Phase 1 alive check)
- Reduces session state explosion with multiple reconnect attempts
