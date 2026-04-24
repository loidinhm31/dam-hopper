# Phase 05 — Ports UI (List, Open in Browser, Split-Pane Integration)

## Context Links

- Parent plan: `plans/20260424-terminal-split-and-port-forward/plan.md`
- Depends on: `phase-03-port-detection-backend.md` (`GET /api/ports`, WS events) and `phase-04-proxy-route-backend.md` (`GET /api/proxy-token`, `/proxy/:port/`)
- Scout: `scout/scout-01-codebase-touchpoints.md` §AppState + WS protocol
- Research: `research/researcher-02-proxy-portdetect.md` §7
- Pattern refs: `packages/web/src/hooks/useSSE.ts`, tunnel `useTunnels.ts` pattern

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Description | Frontend: `usePorts` hook (REST + WS), `PortsPanel` sidebar component, "Open in Browser" button (fetches proxy token, opens `/proxy/:port/`), optional "Open in Split Pane" button (Phase 01 integration). |
| Priority | P2 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~4h |

## Key Insights

- Follow `useTunnels` pattern from tunnel plan: TanStack Query for `GET /api/ports`, WS subscription for `port:discovered`/`port:lost` push events (researcher-02 §7, tunnel plan Phase 03 reference).
- "Open in Browser" requires proxy token: `GET /api/proxy-token` → short-lived JWT → `window.open("/proxy/:port/?token=<jwt>")`. Token must be fetched fresh per click (5min TTL).
- `port:discovered` / `port:lost` WS events use existing `subscribeIpc` / `WsTransport` push mechanism (matches tunnel `tunnel:ready` pattern, scout §AppState + WS protocol).
- WS reconnect resync: on `ws:connected` event, invalidate `["ports"]` query (same pattern as tunnel `useTunnels` reconnect).
- `PortsPanel` placement: between `TunnelPanel` and `TerminalTreeView` in `Sidebar.tsx` (matches tunnel placement pattern).

## Requirements

### Functional
1. `PortsPanel` shows all detected ports with: port number, project name, state badge (provisional/listening/lost), "Open in Browser" button, "Copy proxy URL" button.
2. "Open in Browser": fetch `GET /api/proxy-token`, open `window.open("/proxy/${port}/?token=${token}", "_blank")`.
3. "Open in Split Pane" (optional, if Phase 01 done): copy proxy URL to clipboard or open in new browser pane — not an embedded iframe (CSP complexity, out of MVP scope).
4. WS push: `port:discovered` adds port to list; `port:lost` greys out / removes entry.
5. Empty state: "No ports detected yet. Start a service in a terminal session."
6. On WS reconnect, refetch `GET /api/ports`.

### Non-Functional
- Token fetch is a React `async` handler — no pre-fetching (token expires, must be fresh).
- List auto-updates via WS events without full page refresh.
- `provisional` state shown with amber badge; `listening` green; `lost` grey (strikethrough).

## Architecture

### `usePorts` Hook

```typescript
// packages/web/src/hooks/usePorts.ts
export function usePorts() {
  const qc = useQueryClient();
  // REST baseline
  const { data } = useQuery({
    queryKey: ["ports"],
    queryFn: () => transport.invoke("GET", "/api/ports").then(r => r.ports as DetectedPort[]),
  });

  // WS push — port:discovered
  useEffect(() => {
    const unsub = transport.subscribeIpc("port:discovered", (payload) => {
      qc.setQueryData<DetectedPort[]>(["ports"], (prev = []) =>
        prev.some(p => p.port === payload.port) ? prev : [...prev, payload]
      );
    });
    return unsub;
  }, [qc]);

  // WS push — port:lost
  useEffect(() => {
    const unsub = transport.subscribeIpc("port:lost", (payload) => {
      qc.setQueryData<DetectedPort[]>(["ports"], (prev = []) =>
        prev.filter(p => p.port !== payload.port)
      );
    });
    return unsub;
  }, [qc]);

  // Reconnect resync
  useEffect(() => {
    const unsub = transport.subscribeIpc("ws:connected", () => {
      qc.invalidateQueries({ queryKey: ["ports"] });
    });
    return unsub;
  }, [qc]);

  return data ?? [];
}
```

### `openInBrowser` Action

```typescript
async function openInBrowser(port: number) {
  const { token } = await transport.invoke("GET", "/api/proxy-token");
  window.open(`/proxy/${port}/?token=${token}`, "_blank", "noopener");
}
```

### `DetectedPort` TypeScript Type

```typescript
// packages/web/src/api/client.ts — add:
export interface DetectedPort {
  port: number;
  session_id: string;
  project: string | null;
  detected_via: "stdout_regex" | "proc_net";
  proxy_url: string;      // "/proxy/{port}/"
  state: "provisional" | "listening" | "lost";
}
```

### File-level Changes

| File | Action |
|------|--------|
| `packages/web/src/api/client.ts` | Add `DetectedPort` type, `ProxyTokenResponse` type |
| `packages/web/src/hooks/usePorts.ts` | Create — REST + WS push + reconnect resync |
| `packages/web/src/components/organisms/PortsPanel.tsx` | Create — list + Open in Browser + Copy URL |
| `packages/web/src/components/organisms/Sidebar.tsx` | Modify — add `<PortsPanel>` between TunnelPanel + TerminalTreeView |

## Related Code Files

- `packages/web/src/hooks/useSSE.ts` — `subscribeIpc` pattern reference
- `packages/web/src/api/client.ts` — add `DetectedPort` type
- `packages/web/src/components/organisms/Sidebar.tsx` — insertion point for PortsPanel (after TunnelPanel)
- `plans/20260422-tunnel-exposer/phase-03-web-ui.md` — `useTunnels` + `TunnelPanel` pattern to follow
- `server/src/api/ws_protocol.rs:~175-205` — `PortDiscovered`, `PortLost` event `kind` strings

## Implementation Steps

1. Add `DetectedPort` and `ProxyTokenResponse` types to `packages/web/src/api/client.ts`.
2. Create `packages/web/src/hooks/usePorts.ts` as described in Architecture:
   - `useQuery` for `GET /api/ports`.
   - `subscribeIpc("port:discovered", ...)` — optimistic add to cache.
   - `subscribeIpc("port:lost", ...)` — remove from cache.
   - `subscribeIpc("ws:connected", ...)` — invalidate `["ports"]`.
3. Create `packages/web/src/components/organisms/PortsPanel.tsx`:
   - Call `usePorts()`.
   - Render header "Detected Ports".
   - For each port: row with port number, project badge, state badge (provisional=amber, listening=green, lost=grey).
   - "Open in Browser" button: calls `openInBrowser(port)` async handler; show spinner while fetching token.
   - "Copy proxy URL" button: `navigator.clipboard.writeText("/proxy/${port}/")`.
   - Empty state paragraph.
4. Modify `packages/web/src/components/organisms/Sidebar.tsx`:
   - Import `PortsPanel`.
   - Render `<PortsPanel />` after `<TunnelPanel />` and before `<TerminalTreeView />`.
5. Verify `ws:connected` event name matches existing reconnect signal in `ws-transport.ts` (may need to emit if not already present — check tunnel `useTunnels` reconnect implementation).
6. Manual smoke test: start Vite in PTY → panel shows port 5173 → click "Open in Browser" → new tab opens Vite app.
7. Kill Vite → port 5173 entry disappears from panel (or greys out) within 4s.
8. `pnpm lint && pnpm build` green.

## Todo List

- [ ] Add `DetectedPort`, `ProxyTokenResponse` to `client.ts`
- [ ] Create `usePorts.ts` hook (query + WS events + reconnect)
- [ ] Create `PortsPanel.tsx` (list, state badges, Open in Browser, Copy URL)
- [ ] Modify `Sidebar.tsx` (insert PortsPanel)
- [ ] Verify `ws:connected` event name in `ws-transport.ts`
- [ ] Manual smoke test: detect → open → lose → update
- [ ] `pnpm lint && pnpm build` green

## Success Criteria

- Start Vite in PTY → `PortsPanel` shows port 5173 with green "listening" badge within 2s
- "Open in Browser" → new tab opens Vite app without auth error
- Kill Vite → panel removes entry within 4s (one poll cycle)
- Page reload → panel repopulates from `GET /api/ports`
- WS disconnect + reconnect → panel resyncs via query invalidation
- Empty state shown when no ports detected

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `ws:connected` event name mismatch with `ws-transport.ts` | Reconnect resync broken | Check tunnel `useTunnels` for exact event name before implementing |
| Proxy token expires before user clicks "Open in Browser" | 401 in new tab | Token fetched on click (not pre-cached); 5min TTL ample for click latency |
| CSP blocks `window.open` | Open fails silently | Test in browser; DamHopper controls its own CSP via tower-http headers |
| `port:discovered` and `port:lost` kind strings mismatch server | Events not received | Confirm exact `kind` values from `ws_protocol.rs` once Phase 03 merged |

## Security Considerations

- Proxy token fetched via authenticated REST call — no unauthenticated token issuance.
- Token passed as `?token=` URL param — visible in browser history. Acceptable: 5min TTL, scope-limited to proxy.
- `window.open(..., "noopener")` — prevent opened tab from accessing opener's `window` object.
- No iframe embedding of proxy content — avoids CSP and clickjacking complications.

## Next Steps

Phase 05 merged → F-14 + F-15 MVP complete. Remaining: Phase 02 (drag-to-split) as post-MVP polish.

## Unresolved Questions

1. Should `lost` ports be kept in the list (greyed out / strikethrough) or removed immediately? UX preference — decide before implementation.
2. "Open in Split Pane" button: out of MVP scope, but what would it do? Open proxy URL in a new `PaneContainer` as an iframe? Blocked by CSP concerns — document as future work.
3. Exact `ws:connected` event name in `ws-transport.ts` — verify during implementation (Phase 03 may have already established this for tunnel reconnect).
