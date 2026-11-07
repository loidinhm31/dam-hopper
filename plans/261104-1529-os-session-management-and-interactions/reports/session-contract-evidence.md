# OS Session Management, PTY Contract & Review Evidence

## 1. Incarnation Minting, Lifetime Identity & PTY State
- Incarnation Minting: `Inner.next_incarnation: u64` (`server/src/pty/manager.rs:631`) initialized to `now_ms() * 1024` (`:697`), restored via `advance_past(persisted_max)` (`:859-865`). Allocated via `allocate_incarnation(&mut self) -> u64` (`:803-806`), invoked during:
  * Initial spawn/replacement: `Inner::begin_replacement` (`:809-815, 1528-1533`).
  * Restart/respawn: `supervisor_loop` -> `respawn_internal` (`:4325`).
  * Durable removal: `remove_with_expected` (`:2278`).
- Lifetime Identity: Inside server: `(session_id, incarnation: u64)` (`SessionMeta.incarnation`: `server/src/pty/session.rs:100`; tracked in `fleet_state.rs:27-31`). Distributed OS identity across web clients: `(profileId, generation, terminalId, incarnation)`. Server process epoch tracked via `SessionChangesService.server_epoch` (`server/src/session_changes/store.rs:96, 123`) and `AgentStatusRuntime.server_epoch` (`server/src/agent_status/runtime.rs:207, 250`).
- Reuse/Restart Policy: Incarnations are strictly monotonic and NEVER reused. Recreating or restarting an existing session ID always allocates a fresh incarnation.

## 2. Lock, Select & Kill Races
- Current `kill`: `PtySessionManager::kill` (`manager.rs:2234-2242`) -> `kill_internal` (`:2951`) -> `kill_internal_impl(id, false)` (`:2956-2991`).
- Lock Hierarchy: Acquires `persistence_gate.lock()` then `inner.lock()`.
- Flaws & Races:
  * TOCTOU target collision: `kill_internal_impl` unconditionally sets `inner.killed.insert(id)` and terminates whichever session is in `inner.live.remove(id)`. If incarnation $I_1$ exits and respawns/recreates as $I_2$, a late kill intended for $I_1$ silently terminates $I_2$!
  * Pending restart cancellation: If $I_1$ is in supervisor backoff delay, `inner.killed.insert(id)` aborts respawn without validating incarnation.
  * Missing guarded kill: `remove_with_expected(id, expected_incarnation)` exists (`manager.rs:2270-2294`), but NO `kill_with_expected` exists.
  * Route gap: Axum `DELETE /api/terminal/:id` (`server/src/api/terminal.rs:370-376`) accepts only bare ID, ignoring incarnation.

## 3. Dedicated Guarded Route & Capability Discovery
- Minimal Dedicated Guarded Route: `POST /api/terminal/{id}/terminate` (or `DELETE /api/terminal/{id}/guarded`) with body `{ "expectedIncarnation": u64 }`.
  * Atomicity: Under `inner` lock, check `live.get(id)`. If absent, return `404 Not Found`. If `session.incarnation != expected_incarnation`, return `409 Conflict` (`SESSION_INCARNATION_MISMATCH`) and perform NO state mutation. If matched, terminate child process group and record tombstone.
  * Compatibility: Retain existing `DELETE /api/terminal/:id` for un-migrated scripts; guarded route is dedicated.
- Explicit Capability Discovery: Expose `"guardedTerminalTermination": true` in `GET /api/system/actions/v1/capabilities` (`server/src/api/host_actions.rs:50`) or connection handshake.
- Safe Web Client Rule: Safe web verifies capability before displaying or executing "End session". If unsupported, "End session" is disabled with "Server upgrade required for guarded termination". Safe web NEVER falls back to bare-ID deletion.

## 4. Web Destructive Callers Audit (Kill / End / Remove)
- `packages/ui/src/os/apps/SystemMonitorApp.tsx:425`: `await client.terminal.kill(confirmKill.sessionId)`. Attempts client-side TOCTOU check (`:415-422`), then sends bare-ID delete. Must migrate to guarded terminate.
- `packages/ui/src/hooks/use-terminal-manager.ts:1551`: `handleKillTerminal` -> `client.terminal.kill(rawId)`. Bare-ID kill.
- `packages/ui/src/hooks/use-terminal-manager.ts:724`: `removeSessionDurably` -> `client.terminal.remove(rawId)`. Bare-ID remove.
- `packages/ui/src/hooks/use-ports.ts:408`: `killPortSession` -> `invoke("terminal:kill", sessionId)`. Bare-ID kill.
- `packages/ui/src/components/organisms/PortsPanel.tsx:696`: `killPortSession(sessionId, entry.profileId)`.
- `packages/ui/src/api/client.ts:3352-3353`: `client.terminal.kill`, `client.terminal.remove`.
- `packages/ui/src/api/ws-transport.ts:748-757`: Maps `"terminal:kill"` -> `DELETE /api/terminal/:id`, `"terminal:remove"` -> `DELETE /api/terminal/:id/remove`.
- Secondary Callers to Add: `WindowFrame.tsx` and `WindowList.tsx` close prompts on running terminals (3-way "Close view / End session / Cancel").

## 5. Hub Inventory, Membership & Open Beside
- Current Hub Defect (`agent-hub.ts:114-165`, `traditional-terminal-agents.ts:134-135`): Only sessions having an agent status row (`profile.rows.get(ref.id)`) are emitted. Ordinary background shells and non-agent build tasks are dropped completely.
- Hub Membership Classification against `session.windows` (`packages/ui/src/os/types.ts:48-60`):
  * Active Desktop Open View: `w.appId === "terminals" && w.desktopId === activeDesktopId && !w.minimized`.
  * Active Desktop Minimized: `w.minimized && w.desktopId === activeDesktopId`.
  * Other Desktop: `w.desktopId !== activeDesktopId` (affordance: "Go to window" or "Move beside Hub").
  * Background (No Open View): Session exists in `rawSessions` (`useAggregatedTerminalSessions`) but no matching `OsWindow` in `session.windows`.
- Open Beside Intent:
  * Uses standard tile splitting (`dockWindowInDesktopTree`) to place terminal pane beside Hub on active desktop.
  * Reuses and focuses existing window if present on active desktop; unminimizes if minimized.
  * If window exists on another desktop: presents "Go to window" or "Move beside Hub".
  * If background session (no view): opens new ordinary `terminals` window bound to existing `(profileId, sessionId)` tiled beside Hub. Multiple sessions tab in that pane.

## 6. SessionChanges Review Root Authority, Availability & Cache Scoping
- Full Metadata Tuple: `(profileId, generation, terminalId, terminalIncarnation, ompSessionId, serverEpoch, rootId, baselineId)`.
- Captured Generation: Frozen from `window.ctx.generation` on open (`SessionChangesApp.tsx:24-29`). If `windowOwner.generation !== capturedGeneration`, owner is retired. Never rebind to a newer generation.
- Root Authority: `server/src/session_changes/root.rs:25-90`. Canonical verified project root; never default blindly to "." or guess ambient cwd.
- Availability & Explicit Reasons: Current `SessionChangesApp.tsx:90, 102` silently closes window (`closeWindow(window.id)`). Must keep window open and render explicit, content-free explanation (Disabled in Settings, Retired Generation, Unsupported OMP Capture, Missing Baseline) with link to Server Settings.
- Cache Retirement Scoping:
  * Window Close Defect (`SessionChangesApp.tsx:108-111`): `handleClose` purges `profileQueryKey(owner, "session-changes")`, destroying ALL reviews for that owner. Fix: cancel and remove queries scoped ONLY to that specific review tuple (`terminalId`, `terminalIncarnation`, `ompSessionId`, `rootId`).
  * Owner Retirement / Config Disable: Purges `profileQueryKey(owner, "session-changes")` across the entire owner.

## 7. Placement Continuity vs Dispose-on-Close/Reopen
- Placement Continuity: `OsResourceHost.tsx:184-209` maintains `<TerminalPanel>` in `TerminalKeepAliveHost`. `TerminalsApp.tsx:88-94` reparents the DOM node into the window slot via `attachTerminalsToHost`. Floating, tiling, maximizing, or switching desktops preserves the SAME xterm instance with ZERO attach/replay/reset.
- Dispose-on-Close vs Reopen: `closeWindow` removes `OsWindow` from `sessionWindows`. `OsResourceHost` unmounts `<TerminalPanel>`, calling `removeTerminal` (`TerminalPanel.tsx:1131`) and disposing local xterm. Backend PTY survives in `manager.live`. Reopening creates a fresh renderer and replays history. Close is NOT placement.

## 8. File & Test Map
- Backend: `server/src/pty/manager.rs`, `server/src/pty/session.rs`, `server/src/pty/fleet_state.rs`, `server/src/api/terminal.rs`, `server/src/api/router.rs`, `server/src/api/host_actions.rs`.
  * Tests: `server/src/pty/tests.rs` (kill/restart/races), `server/src/api/tests.rs` (terminal routes, capabilities), `server/src/session_changes/capture_tests.rs`.
- Frontend: `packages/ui/src/os/apps/AgentHubApp.tsx`, `SessionChangesApp.tsx`, `SystemMonitorApp.tsx`, `TerminalsApp.tsx`, `WindowFrame.tsx`, `WindowList.tsx`, `packages/ui/src/os/agent-hub.ts`, `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/hooks/use-ports.ts`, `packages/ui/src/hooks/use-terminal-manager.ts`.
  * Tests: `packages/ui/browser-tests/os-system-monitor.browser.tsx`, `packages/ui/src/os/agent-hub.test.ts`, `packages/ui/src/lib/traditional-terminal-agents.test.ts`, `packages/ui/src/api/ws-transport.test.ts`.

COMPLETE: plans/261104-1529-os-session-management-and-interactions/reports/session-contract-evidence.md
