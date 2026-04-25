# Phase 03 — Web Client Implementation

## Context Links

- Parent plan: `plans/20260425-port-detection-tunnel-combined/plan.md`
- Depends on: Phase 02 (design contract)
- Scout: `plans/20260425-port-detection-tunnel-combined/reports/00-scout-existing-code.md`
- Old patches: `/tmp/old-ports-panel.tsx.patch`, `/tmp/old-use-ports.ts.patch` (from Phase 00)

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-25 |
| Description | isLocalServer helper, usePorts hook rebuild, PortsPanel rebuild |
| Priority | P1 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~5h |

## Key Insights

- `usePorts` must merge two data sources: `port:list` (DetectedPort[]) and `tunnel:list` (TunnelInfo[]) into `PortEntry[]`.
- Both sources subscribe to WS push events — usePorts subscribes to port events, useTunnels to tunnel events. The combined hook subscribes to all six event types.
- `isLocalServer()` is a pure sync function — no hooks, no state. Safe to call at render time.
- `WarningBanner` and `InstallerRow` sub-components can be lifted from `TunnelPanel.tsx` verbatim.
- `useCopyToClipboard` from `@/hooks/useClipboard.js` handles copy state.
- QR code: `react-qr-code` package — already used in TunnelPanel.
- The `PortsPanel` is a full replacement for both `TunnelPanel` and `PortsPanel`; both old components are deleted in Phase 04.

## Requirements

**Functional:**
- `isLocalServer()` exported from `server-config.ts`; returns true when `getServerUrl()` host equals `location.host`.
- `usePorts()` returns merged `PortEntry[]` and tunnel action callbacks.
- Port rows render state badge, status dot, project label.
- "Open localhost" button visible only when `isLocalServer()` true AND port has state != "lost".
- "Start tunnel" button: calls `POST /api/tunnels {port, label}`, shows loading spinner.
- "Stop tunnel" button: visible only when active tunnel on this port.
- Tunnel URL: inline link when `tunnel.status === "ready"`.
- "Copy URL", QR popover: same as current TunnelPanel.
- Custom port form: number input + "Start tunnel" button; validates port range and not danger ports.
- cloudflared installer row (from TunnelPanel) reused when binary missing.
- Warning banner (public URL notice) shown once per browser.
- WS reconnect triggers re-fetch of both ports and tunnels.

**Non-Functional:**
- No new packages (react-qr-code, lucide-react, @tanstack/react-query all already installed).
- TypeScript strict; no `any` without justification.
- Follow existing CSS var conventions (`--color-surface-2`, `--color-primary`, etc.).

## Architecture — File Changes

| File | Action | Detail |
|---|---|---|
| `packages/web/src/api/server-config.ts` | EDIT | Add `isLocalServer()` export after `isCrossOriginServer` (line 164) |
| `packages/web/src/hooks/usePorts.ts` | REWRITE | Combined hook merging ports + tunnel state |
| `packages/web/src/components/organisms/PortsPanel.tsx` | REWRITE | Combined panel using new hook |
| `packages/web/src/api/client.ts` | EDIT | Add JSDoc `"(vestigial, ignored)"` to `DetectedPort.proxy_url` field |

## Code Shapes

### `isLocalServer()` — server-config.ts

```ts
/**
 * Whether the configured server is running on the same host as the browser.
 * When true, "Open localhost" shortcuts are shown in the Ports panel.
 *
 * Dev-mode caveat: in Vite dev mode, getServerUrl() returns location.origin,
 * so this always returns true. Correct behavior — server IS local in dev.
 */
export function isLocalServer(): boolean {
  try {
    return new URL(getServerUrl()).host === location.host;
  } catch {
    return true;
  }
}
```

### `PortEntry` interface — usePorts.ts

```ts
export interface PortEntry {
  port: number;
  project: string | null;
  state: "provisional" | "listening" | "lost";
  tunnel: TunnelInfo | null;  // null if no active tunnel
}
```

### `usePorts()` return shape — usePorts.ts

```ts
export function usePorts(): {
  ports: PortEntry[];
  isLoading: boolean;
  createTunnel: (port: number, label: string) => Promise<void>;
  stopTunnel: (id: string) => Promise<void>;
  installCloudflared: () => Promise<void>;
  installState: InstallState;
}
```

Implementation strategy:
1. `useQuery(["ports"])` → `GET /api/ports` → `DetectedPort[]`
2. `useQuery(["tunnels"])` → `GET /api/tunnels` → `TunnelInfo[]`
3. `useMemo` to merge: for each DetectedPort, attach matching TunnelInfo (by port). Then append tunnel-only entries (tunnels for ports not currently detected).
4. Subscribe to `port:discovered`, `port:lost` → patch `["ports"]` cache.
5. Subscribe to `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped` → patch `["tunnels"]` cache.
6. Subscribe to `install:progress`, `install:done`, `install:failed` → installState.
7. `onStatusChange` reconnect → invalidate both query keys.
8. Reuse `installCloudflared`, `stopTunnel` logic from `useTunnels.ts` verbatim.

### `PortsPanel` component skeleton

```tsx
export function PortsPanel() {
  const { ports, isLoading, createTunnel, stopTunnel, installCloudflared, installState } = usePorts();
  const localServer = isLocalServer();
  const [showAddForm, setShowAddForm] = useState(false);
  const [binaryMissing, setBinaryMissing] = useState(false);
  const [warned, setWarned] = useState(() => !!localStorage.getItem(WARNED_KEY));

  return (
    <section className="border-t border-[var(--color-border)] pt-1">
      {/* Header */}
      {/* Warning banner */}
      {/* InstallerRow */}
      {/* Port list */}
      {/* AddPortForm */}
    </section>
  );
}
```

### `PortRow` sub-component props

```tsx
function PortRow({
  entry,
  isLocal,
  onStartTunnel,
  onStopTunnel,
}: {
  entry: PortEntry;
  isLocal: boolean;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
})
```

### `AddPortForm` sub-component

```tsx
function AddPortForm({ onSubmit }: { onSubmit: (port: number) => Promise<void> })
```
- Inline form: `text-xs` input + button.
- Validates 1-65535, not in DANGER_PORTS.
- Auto-label: `"port-${portNum}"`.
- No separate label field (simplicity — YAGNI).

### DANGER_PORTS (client-side guard)

```ts
const DANGER_PORTS = new Set([22, 25, 53, 110, 143, 3306, 5432, 6379, 27017]);
```
Server also validates; this is defense-in-depth.

## Related Code Files

| File | Lines | Content |
|---|---|---|
| `packages/web/src/api/server-config.ts` | 158-164 | `isCrossOriginServer` — add `isLocalServer` after this |
| `packages/web/src/hooks/useTunnels.ts` | 1-164 | Source for tunnel subscription + installState logic |
| `packages/web/src/hooks/usePorts.ts` | 1-62 | Current usePorts — will be fully replaced |
| `packages/web/src/components/organisms/TunnelPanel.tsx` | 1-474 | Source for WarningBanner, InstallerRow, TunnelRow patterns |
| `packages/web/src/components/organisms/PortsPanel.tsx` | 1-114 | Source for port row layout, badges |
| `packages/web/src/hooks/useClipboard.ts` | — | `useCopyToClipboard` hook |
| `packages/web/src/api/client.ts` | 83-93, 97-104 | `TunnelInfo` and `DetectedPort` type definitions |

## Implementation Steps

1. Add `isLocalServer()` to `server-config.ts` after `isCrossOriginServer` function.
2. Add JSDoc to `DetectedPort.proxy_url` in `client.ts`: `/** @deprecated vestigial — proxy route removed; ignored by UI */`.
3. Rewrite `packages/web/src/hooks/usePorts.ts`:
   a. Define `PortEntry` and `InstallState` interfaces.
   b. `useQuery` for both `["ports"]` and `["tunnels"]`.
   c. `useMemo` merge logic.
   d. All six WS event subscriptions.
   e. `onStatusChange` double-invalidate.
   f. Return merged `ports`, loading state, and action callbacks.
4. Rewrite `packages/web/src/components/organisms/PortsPanel.tsx`:
   a. Lift `WarningBanner` from TunnelPanel verbatim.
   b. Lift `InstallerRow` from TunnelPanel verbatim.
   c. Write `PortRow` per the behavior matrix in Phase 02.
   d. Write `AddPortForm`.
   e. Write `PortsPanel` main component.
5. `pnpm build` — must pass with zero TS errors.
6. `pnpm lint` — must pass.

## Todo List

- [ ] Add `isLocalServer()` to `server-config.ts`
- [ ] Add `@deprecated` JSDoc to `DetectedPort.proxy_url` in `client.ts`
- [ ] Define `PortEntry` interface in new `usePorts.ts`
- [ ] Implement `usePorts` with merged query + WS subscriptions
- [ ] Implement action callbacks: `createTunnel`, `stopTunnel`, `installCloudflared`
- [ ] Implement WS reconnect double-invalidate
- [ ] Write `WarningBanner` (lifted from TunnelPanel)
- [ ] Write `InstallerRow` (lifted from TunnelPanel)
- [ ] Write `PortRow` — states A/B/C per behavior matrix
- [ ] Write `AddPortForm` with DANGER_PORTS validation
- [ ] Write `PortsPanel` main component
- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes

## Success Criteria

- `isLocalServer()` returns `true` when server URL host matches `location.host`.
- `usePorts()` returns merged port+tunnel entries; mutations update TanStack Query cache.
- `PortsPanel` renders: dot + port + label + badge; actions show per state machine.
- "Open localhost" absent when cross-host.
- Custom port form validates and calls `createTunnel`.
- `pnpm build` zero errors.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| useMemo merge produces duplicate rows when tunnel port not in detected list | Medium | Low | Append tunnel-only entries after detected ports; dedup by port number |
| InstallState type clash if importing from useTunnels | Low | Low | Define InstallState locally in usePorts.ts (it's small) |
| PortRow grows too tall with all actions visible | Low | Low | Group-hover pattern keeps row compact at rest |

## Security Considerations

- "Open localhost" opens `http://localhost:{port}` in new tab with `noopener,noreferrer` — no credentials forwarded.
- DANGER_PORTS client-side validation is defense-in-depth only (server also validates).

## Next Steps

Phase 04: update Sidebar to use combined PortsPanel, delete TunnelPanel file.
