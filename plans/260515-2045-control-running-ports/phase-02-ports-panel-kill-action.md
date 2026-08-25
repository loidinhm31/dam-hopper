# Phase 02: PortsPanel Kill Action

## Context links

- Parent plan: [plan.md](./plan.md)
- Phase 01: [phase-01-port-session-control-data-flow.md](./phase-01-port-session-control-data-flow.md)
- Panel component: `packages/web/src/components/organisms/PortsPanel.tsx`
- Workspace page: `packages/web/src/components/pages/WorkspacePage.tsx`

## Overview

- Date: 2026-05-15
- Priority: P1
- Implementation status: Done
- Description: Add a confirmed destructive action that kills the terminal session responsible for a detected port.

## Key Insights

- `PortsPanel` already has row-level action controls and inline error display.
- User selected confirmation before killing.
- No direct edit is expected in `WorkspacePage.tsx` because it already renders `PortsPanel`.

## Requirements

- Add an `onKillSession` prop to `PortRow`.
- Show a kill button only when `entry.sessionId` is not null and `entry.state !== "lost"`.
- On click, confirm before kill with copy that states the terminal session will stop.
- Disable the kill button while the request is in flight.
- Show an inline error if kill fails.
- Keep tunnel stop and kill terminal as distinct actions.

## Architecture

- `PortsPanel` gets `killPortSession` from `usePorts` and passes it to each `PortRow`.
- `PortRow` owns transient UI state: `isKilling`, `killError`, and confirm-dialog visibility.
- Use a Lucide destructive icon already available in the dependency set.
- Confirmation uses the shared app dialog components to keep destructive UX consistent and accessible.

## Related code files

- Modify: `packages/web/src/components/organisms/PortsPanel.tsx`
- No expected change: `packages/web/src/components/pages/WorkspacePage.tsx`

## Implementation Steps

1. Import a suitable Lucide icon for session kill, such as `Power` or `CircleStop`.
2. Add `onKillSession: (sessionId: string) => Promise<void>` to `PortRow` props.
3. Add `isKilling` and `killError` state in `PortRow`.
4. Implement `handleKillSession`:
   - Return early if `entry.sessionId` is null.
   - Open a confirm dialog that names the target port and project when available.
   - Set loading state, call `onKillSession(entry.sessionId)`, catch errors into `killError`, and clear loading in `finally`.
5. Render the kill button in the action bar for eligible detected ports.
6. Pass `killPortSession` from `PortsPanel` into `PortRow`.
7. Verify action visibility for detected, provisional, lost, and tunnel-only rows.

## Todo list

- [x] Add kill-session row prop and handler.
- [x] Add confirmation before kill.
- [x] Add loading and inline error behavior.
- [x] Wire `killPortSession` from `usePorts`.
- [x] Verify no page-level changes are needed in `WorkspacePage.tsx`.

## Success Criteria

- User can kill a detected free-terminal port from `PortsPanel`.
- Confirmation appears before terminating the session.
- Port disappears after backend reports loss or cache invalidates.
- Tunnel-only rows do not show a misleading kill-terminal action.
- Existing open-localhost, start-tunnel, copy, QR, and stop-tunnel actions still work.

## Risk Assessment

- Risk: action bar becomes crowded.
- Mitigation: keep icon-only button with clear title and destructive hover color.
- Risk: `window.confirm` is visually basic.
- Mitigation: acceptable for v1; replace with app dialog later if design system requires it.

## Security Considerations

- UI copy must clearly communicate process termination.
- No new privileged backend capability is added.

## Validation

- Run `pnpm --filter @dam-hopper/web build`.
- Run `pnpm --filter @dam-hopper/web test`.
- Manual test with a free terminal running a local dev server.
