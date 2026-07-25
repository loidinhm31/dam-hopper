# Phase 03 — Browser Tool, Iframe, and Origin Policy

## Context links

- Parent: [plan.md](./plan.md)
- Frontend scout: [browser/terminal surface](./scout/scout-01-frontend-browser-terminal-surface.md)
- Bridge contract: [phase 01](./phase-01-feasibility-and-bridge-contracts.md)
- Architecture: [system architecture](../../docs/system-architecture.md)

## Overview

- Date: 2026-07-24
- Description: Add a global Browser UI surface and securely host the controlled
  target iframe.
- Priority: P1
- Implementation status: Done (2026-07-24 17:27 +07)
- Review status: User approved (2026-07-24 17:27 +07)

## Key Insights

- `WorkspacePage` is the composition root for desktop, terminal, and compact
  surfaces.
- `IdeShell` is generic; `TerminalWorkspaceShell` needs an explicit Browser
  overlay branch.
- The iframe must not be owned by transient tool panels; one keep-alive owner
  reparents the same DOM node between visible and parked containers.

## Requirements

- Maximizable bottom Browser tool in IDE mode.
- Draggable/resizable Browser overlay in terminal mode.
- Compact Browser surface in IDE and terminal arrays.
- URL input accepts only exact loopback or active ready tunnel origins.
- Clear loading, framing, bridge, navigation, capture, and unsupported states.
- Preview is text-safe and never renders target HTML.
- Closing Browser stops capture tracks but leaves the iframe parked/alive.

## Architecture

Create a `BrowserDebugKeepAliveHost` outside conditional shells. It owns one
iframe DOM node, bridge handlers, URL/navigation state, and a hidden parking
container for tool-close/mode-switch states. Visible Browser panels register a
viewport; the host reparents the same node into it. A separate state store/hook
holds allowed origin, nonce, bridge status, selection, capture result, error,
and pending artifact. Leaving Workspace, changing server profile, or changing
URL disposes the host and invalidates the nonce.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugPanel.tsx`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugKeepAliveHost.tsx`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-debug-keep-alive.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-browser-debug.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-debug-origin.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/browser-debug-origin.test.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/templates/TerminalWorkspaceShell.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/terminal-workspace-panel.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/transport.ts`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts`.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/BrowserDebugPanel.test.tsx`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/WorkspacePage.test.tsx`.

## Implementation Steps

1. Add exact-origin parser: `http://localhost`, `127.0.0.1`, `::1`, or an
   exact `url` from a ready `TunnelInfo`; reject credentials, fragments,
   unexpected ports/schemes, and redirects after navigation.
2. Add typed REST create/delete and specialized binary screenshot upload.
3. Render URL toolbar, iframe, bridge status, selection preview, and errors.
4. Wire handshake/parser from Phase 01 and clear selection on navigation.
5. Mount the keep-alive host once per WorkspacePage and expose viewport
   registration/reparenting to each Browser panel.
6. Stop capture tracks on visible Browser close while preserving iframe state.
7. Register Browser in all desktop and compact surfaces.
8. Add active-tunnel query/event invalidation so stopped tunnels become invalid.

## Todo list

- [ ] Decide whether Browser is left-bottom or right-bottom tool placement.
- [ ] Verify no iframe or PTY remount when Browser opens/closes/maximizes.
- [ ] Verify compact hidden/inert behavior keeps state safe.
- [ ] Add accessible labels and keyboard escape to exit picker.

## Success Criteria

- Only approved exact origins load.
- Wrong-origin iframe messages are ignored and visibly diagnosed.
- Browser appears in IDE, terminal, and compact workspace modes.
- The same iframe DOM node survives mode/tool/compact transitions and remains
  functional after reparenting.
- Preview renders bounded text and metadata as inert React text.

## Risk Assessment

- Parent app origin differs between web, native, dev, and tunnel deployments.
- `X-Frame-Options` and CSP failures are target configuration issues, not
  reasons to add a proxy.
- Browser panel can compete with terminal viewport; maximize/resize affordances
  must remain obvious.

## Security Considerations

- Exact `targetOrigin`, `event.origin`, `event.source`, nonce, and request ID.
- Never use `*`, `innerHTML`, target-provided URLs as links without validation,
  or target-provided iframe permissions.
- Keep server bearer tokens out of iframe URL/query and bridge messages.

## Next steps

Once panel and protocol tests pass, implement capture as a separate service so
permission failures do not destabilize iframe selection.

## Validation evidence

- Exact-origin parser tests pass for loopback, ready tunnel, malformed, and disallowed targets.
- Component/workspace tests cover panel states, singleton iframe lifecycle, reparenting, and surface registration.
- Chromium browser checks cover bridge/keep-alive behavior and screenshot assertions.

## Unresolved questions

- Final keyboard shortcut and activity-bar placement are intentionally deferred.
- Whether target apps need a documented CSP helper for common dev servers.
