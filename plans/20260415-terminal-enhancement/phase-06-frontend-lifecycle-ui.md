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

## Todo
- [ ] `SessionInfo` type additions
- [ ] `getSessionStatus` helper + tests (if test harness exists)
- [ ] `SessionRow` dot + badge
- [ ] `TerminalTreeView` dot mirroring
- [ ] `TerminalPanel` exit banner (willRestart-aware)
- [ ] `TerminalPanel` restart banner
- [ ] WS transport status listener + banner
- [ ] Query invalidation on restart

## Success Criteria
- Manual: crash a process with `on-failure` → yellow banner appears, yellow dot shown, after backoff new shell starts, badge shows `↻ 1`.
- Manual: kill WS (stop server briefly) → `[Reconnecting…]` banner; resume → `[Reconnected]`.
- Banner colors render correctly in xterm.

## Risk Assessment
- Low-Medium. UX only. xterm ANSI sequences are well-understood.
- Risk: banner interleaves with live output awkwardly. Mitigation: always prefix `\r\n` and suffix `\r\n`.

## Security Considerations
- Avoid injecting server-controlled strings unescaped into xterm — exit code is a number, restart count is a number, banners use fixed templates.

## Next Steps
Phase 7 simplifies the reconnect logic further (server-side idempotency).
