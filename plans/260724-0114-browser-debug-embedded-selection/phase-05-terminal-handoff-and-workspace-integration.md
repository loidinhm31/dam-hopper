# Phase 05 — Terminal Handoff and Workspace Integration

## Context links

- Parent: [plan.md](./plan.md)
- Frontend scout: [terminal surface](./scout/scout-01-frontend-browser-terminal-surface.md)
- PTY architecture: [system architecture](../../docs/system-architecture.md)
- Transport: `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/transport.ts`

## Overview

- Date: 2026-07-24
- Description: Attach an approved bundle to a chosen live xterm session without
  raw DOM insertion or implicit command submission.
- Priority: P1
- Implementation status: Complete (2026-07-25 15:18 +07)
- Review status: Approved after origin-bound extension review (2026-07-25 15:18 +07)

## Key Insights

- `useTerminalManager` exposes active tab/session state; the registry is only
  needed for optional focus.
- `Transport.terminalWrite` is fire-and-forget and existing suggestion/history
  flows reject multiline/control input.
- Generated paths are safer than copying page text into an agent prompt.

## Requirements

- Preview first, explicit terminal choice/confirmation.
- Require selected stable `sessionId` mounted/live in the frontend and alive on
  the server.
- Insert one bounded single-line reference containing generated JSON/PNG paths
  and an untrusted-page warning.
- Strip CR/LF, C0/C1, ESC/CSI/OSC/DCS; never append Enter.
- Focus selected xterm only when it is mounted and safe.
- Browser state must not create, clone, or remount PTYs.
- The keep-alive iframe owner must not be nested inside a conditional shell or
  recreated when Browser is opened, closed, maximized, or mode-switched.

## Architecture

Create a pure handoff helper that accepts artifact metadata and session state,
builds a single-line reviewable reference, and calls an authenticated one-time
handoff endpoint exactly once after confirmation. The server validates and
writes the same bounded control-free reference before acknowledging success.
`WorkspacePage` owns the keep-alive host and passes
viewport registrations plus `activeTab`, session map, and browser content to
IDE/terminal/compact shells. Browser overlay additions to
`TerminalWorkspacePanelId` remain session-only and reset on close.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-terminal-handoff.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-terminal-handoff.test.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugPanel.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-workspace-panel.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/ide-shell-layout.ts` only if Browser gets activation exclusivity.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.test.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`.

## Implementation Steps

1. Define artifact response and terminal target DTOs.
2. Add selected-terminal list with dead/unmounted disabled states.
3. Build shell-safe, single-line path reference with no page text.
4. Require confirmation, then invoke `terminalWrite` once without Enter.
5. Optionally call terminal registry focus after write.
6. Reparent the existing iframe host when switching shell/viewport; park it on
   close and stop capture tracks without losing bridge state.
7. Handle server expiry/delete, terminal close, transport reconnect, and
   cancellation without stale writes.
8. Verify Browser panel maximize/restore leaves iframe and xterm lifecycles
   untouched.

## Todo list

- [x] Test no active session, dead session, stale ID, and terminal close race.
- [x] Test exact one-time handoff acknowledgement and no CR/LF/escape bytes.
- [x] Test reactive terminal registration and Browser panel shell/mode state.
- [x] Keep the reference prefix shell-neutral on Windows; it is bounded inert
  text and handoff never appends Enter or executes it. Revisit with remote
  agent/resource transport in Phase 6 if required.

## Success Criteria

- User can select any live terminal and attach approved JSON/PNG references.
- Raw DOM/page text never enters PTY input.
- No auto-submit, duplicate write, or PTY remount occurs.
- Expired/deleted artifact and stale session produce safe UI errors.

## Risk Assessment

- Agent TUI may not understand arbitrary paths without user instruction.
- Server and PTY may run in different containers/hosts in future deployments.
- Browser panel placement can reduce terminal space on compact screens.
- Imperative iframe reparenting can conflict with React ownership if a viewport
  unmounts without unregistering.

## Security Considerations

- Treat bundle contents as untrusted prompt data; label paths clearly.
- Never interpolate user/page text into shell syntax.
- Do not expose bearer tokens or artifact URLs in inserted text.

## Next steps

Run the Phase 6 hostile/manual browser gate, then document the agent workflow
and artifact retention. Consider an MCP resource only after V1 usage validates
path insertion.

## Unresolved questions

- Cross-host/container agent handoff needs a future authenticated resource API.
- Final path-reference wording for shell and agent TUI compatibility.
