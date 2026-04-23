# Phase 03 — Web UI

## Context Links

- Parent plan: `plans/20260422-tunnel-exposer/plan.md`
- Depends on: Phase 02 complete (REST + WS endpoints live)
- Research: `research/researcher-02-ui-patterns.md`
- Pattern refs: `packages/web/src/components/organisms/TerminalTreeView.tsx`
- Hook patterns: `packages/web/src/hooks/useSSE.ts`, `useTerminalTree.ts`
- Transport: `packages/web/src/api/ws-transport.ts`

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-22 |
| Description | TunnelPanel organism + useTunnels hook + Sidebar integration. First-use warning banner, installer prompt, QR popover. |
| Priority | P2 |
| Status | done |
| Effort | ~8h |

## Key Insights

- WS push events already arrive via `useSSE.ts` `PUSH_EVENT_CHANNELS` (added in Phase 02). `useTunnels` subscribes via `subscribeIpc` and patches `queryClient` in-place with `setQueryData` — no `invalidateQueries` on events (payloads are complete objects per research).
- `onEvent` transport method already handles unknown `kind` via `default` case dispatch — no transport changes needed beyond what Phase 02 added.
- `TerminalTreeView.tsx` is the shape reference: `group-hover` action icons, status dots, collapsible sections. Replicate, don't invent.
- QR: `react-qr-code` (~5KB, SVG, native TS). Install with `pnpm --filter @dam-hopper/web add react-qr-code`.
- First-use warning: `localStorage` flag `tunnel_warning_acknowledged` — show once, not on every open.
- Installer progress: inline row below the "+ New Tunnel" button, not a modal. Simpler, no overlay focus trap.
- All optimistic removes: stop action removes row immediately; WS `tunnel:stopped` is a no-op if already gone.

## Requirements

1. `useTunnels` hook: `useQuery(["tunnels"])` + `subscribeIpc` for 4 tunnel events → `setQueryData`.
2. `TunnelPanel` organism: header with "+ New Tunnel" button, list of `TunnelRow` entries, installer prompt row.
3. `TunnelRow`: status dot, port, label, truncated URL (ready only), Copy + QR actions (group-hover), PUBLIC pill, Stop button.
4. `NewTunnelDialog`: port input (number, 1-65535), label input (text, max 64), submit calls `tunnel:create` invoke.
5. First-use warning banner: shown above list on first `useTunnels` mount if `!localStorage.tunnel_warning_acknowledged`. Dismiss sets flag.
6. Installer prompt: when `GET /api/tunnels` returns 503 (binary missing), show "Install cloudflared" row with progress.
7. QR popover: click icon on ready row → `react-qr-code` SVG in small floating div.
8. Integrate `TunnelPanel` into `Sidebar.tsx` between project list and terminal tree.

## Architecture

### File Layout

```
packages/web/src/
├── hooks/
│   └── useTunnels.ts          (new)
└── components/
    └── organisms/
        └── TunnelPanel.tsx    (new)
```

**Modify:**
- `packages/web/src/components/organisms/Sidebar.tsx` — import + render `TunnelPanel`
- `packages/web/src/api/client.ts` — `TunnelInfo` already added in Phase 02; verify present

### useTunnels.ts

```typescript
export function useTunnels() {
  const qc = useQueryClient();
  const transport = getTransport();

  // Initial fetch
  const query = useQuery({
    queryKey: ["tunnels"],
    queryFn: () => transport.invoke<TunnelInfo[]>("tunnel:list"),
  });

  // WS push — patch in-place, no round-trip
  useEffect(() => {
    const unsubs = [
      subscribeIpc("tunnel:created", ({ data }) => {
        const next = data as TunnelInfo;
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.some((t) => t.id === next.id) ? prev : [...prev, next]);
      }),
      subscribeIpc("tunnel:ready", ({ data }) => {
        const { id, url } = data as { id: string; url: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.map((t) => t.id === id ? { ...t, status: "ready" as const, url } : t));
      }),
      subscribeIpc("tunnel:failed", ({ data }) => {
        const { id, error } = data as { id: string; error: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.map((t) => t.id === id ? { ...t, status: "failed" as const, error } : t));
      }),
      subscribeIpc("tunnel:stopped", ({ data }) => {
        const { id } = data as { id: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.filter((t) => t.id !== id));
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  const createTunnel = useCallback(async (port: number, label: string) => {
    await transport.invoke("tunnel:create", { port, label });
    // WS tunnel:created will patch the list; no manual invalidate
  }, [transport]);

  const stopTunnel = useCallback(async (id: string) => {
    // Optimistic remove
    qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) => prev.filter((t) => t.id !== id));
    await transport.invoke("tunnel:stop", { id });
  }, [qc, transport]);

  return { tunnels: query.data ?? [], isLoading: query.isLoading, createTunnel, stopTunnel };
}
```

### TunnelPanel.tsx Structure

```
<section>
  <header>  TUNNELS  [+]  </header>
  {!warned && <WarningBanner onDismiss={...} />}
  {binaryMissing && <InstallerRow onInstall={...} progress={...} />}
  <ul>
    {tunnels.map(t => <TunnelRow key={t.id} tunnel={t} onStop={stopTunnel} />)}
  </ul>
  {showDialog && <NewTunnelDialog onSubmit={createTunnel} onClose={...} />}
</section>
```

### TunnelRow States (ASCII from research)

```
Starting:  ◌ (amber animate-pulse)  :3000  label  Starting…            [×]
Ready:     ● (green)                :3000  label  https://…            [⎘][⊞] PUBLIC⚠  [×]
Failed:    ✕ (red)                  :4000  label  error message        [↺ Retry]        [×]
```

- Status dot: `className={cn("h-2 w-2 rounded-full shrink-0", dotColor)}` — matches `StatusDot` in `TerminalTreeView.tsx`.
- Actions hidden until `group-hover` (parent div has `className="group"`).
- URL: `<a href={url} target="_blank" className="truncate max-w-[180px]" title={url}>`.
- PUBLIC pill: `<span className="text-xs bg-amber-500/20 text-amber-600 px-1.5 py-0.5 rounded">PUBLIC</span>`.

### Copy Hook

```typescript
function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), resetMs);
  }, [resetMs]);
  return { copied, copy };
}
```

### QR Popover

Simple controlled `<div>` positioned relative to button — no Radix dependency:

```tsx
{showQr && (
  <div className="absolute z-50 right-0 top-6 bg-[var(--color-surface)] border rounded p-2 shadow-lg">
    <QRCode value={tunnel.url!} size={160} bgColor="transparent" fgColor="currentColor" />
    <button onClick={() => setShowQr(false)} className="absolute top-1 right-1"><X size={12}/></button>
  </div>
)}
```

### Installer Row

```tsx
{installing ? (
  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
    <span className="animate-spin">◌</span>
    Downloading cloudflared… {progress}%
  </div>
) : (
  <button onClick={startInstall} className="...">
    Install cloudflared to continue
  </button>
)}
```

Installer calls `POST /api/tunnels/install` (or detect from 503 on list endpoint). Use streaming progress via EventSource or poll `GET /api/tunnels/install/progress`. Simpler: poll every 500ms until `GET /api/tunnels` no longer returns 503.

### Warning Banner

```tsx
const WARNED_KEY = "tunnel_warning_acknowledged";
const [warned, setWarned] = useState(() => !!localStorage.getItem(WARNED_KEY));

function dismiss() {
  localStorage.setItem(WARNED_KEY, "1");
  setWarned(true);
}

// Render (if !warned):
<div role="status" className="bg-amber-500/10 border border-amber-500/30 text-amber-700 text-xs p-2 rounded mx-2 mb-1">
  Public URL — anyone with the link can reach your port. Stop when done.
  <button onClick={dismiss} className="ml-2 underline">Got it</button>
</div>
```

## Related Code Files

**Create:**
- `packages/web/src/hooks/useTunnels.ts`
- `packages/web/src/components/organisms/TunnelPanel.tsx`

**Modify:**
- `packages/web/src/components/organisms/Sidebar.tsx` — import + render `<TunnelPanel>` between project list and `<TerminalTreeView>`
- `packages/web/src/api/client.ts` — verify `TunnelInfo` present (added in Phase 02)
- `packages/web/package.json` — `react-qr-code` dependency

## Implementation Steps

1. Install `react-qr-code`: `pnpm --filter @dam-hopper/web add react-qr-code`.
2. Verify `TunnelInfo` in `client.ts` (Phase 02 should have added it; add if absent).
3. Create `useTunnels.ts` with `useQuery` + 4 `subscribeIpc` listeners + `createTunnel` + `stopTunnel`.
4. Create `TunnelPanel.tsx` skeleton: header, empty list, "+ New Tunnel" button stub.
5. Implement `TunnelRow` sub-component inside `TunnelPanel.tsx`:
   - Status dot based on `tunnel.status`.
   - Conditional URL display (`status === "ready"` only).
   - `group-hover` action icons (Copy, QR, Stop).
   - PUBLIC amber pill.
6. Implement `useCopyToClipboard` hook (inline in file or shared util).
7. Implement QR popover state + `react-qr-code` rendering.
8. Implement `NewTunnelDialog` sub-component: port number input (validate 1-65535), label text input (max 64), submit button calling `createTunnel`.
9. Implement `WarningBanner` with `localStorage` flag.
10. Implement `InstallerRow`: detect 503 from `GET /api/tunnels`; show download button; poll until resolved.
11. Wire `TunnelPanel` into `Sidebar.tsx`: import, render between project list section and `TerminalTreeView` section.
12. Manual smoke test against running server:
    - New tunnel → Starting dot → Ready with URL
    - Copy URL → clipboard
    - QR popover opens/closes
    - Stop → row removed
    - Refresh → list comes back empty (no persistence)
13. `pnpm lint` + `pnpm check` green.

## Todo List

- [ ] `pnpm --filter @dam-hopper/web add react-qr-code`
- [ ] Verify / add `TunnelInfo` in `client.ts`
- [ ] Create `useTunnels.ts`
- [ ] Create `TunnelPanel.tsx` skeleton
- [ ] Implement `TunnelRow` (dot + URL + actions)
- [ ] Implement copy hook
- [ ] Implement QR popover
- [ ] Implement `NewTunnelDialog`
- [ ] Implement `WarningBanner`
- [ ] Implement `InstallerRow`
- [ ] Wire into `Sidebar.tsx`
- [ ] Manual smoke test
- [ ] `pnpm lint` green
- [ ] `pnpm check` (tsc) green

## Success Criteria

- Click "+ New Tunnel" → dialog opens, submit → row appears with amber spinner
- Within 5s, spinner → green dot + URL (on machine with cloudflared available)
- Copy button → checkmark for 2s; URL is in clipboard
- QR icon → popover with scannable QR; close button dismisses
- Stop button → row removed immediately (optimistic); WS `tunnel:stopped` is no-op
- Warning banner shows once, dismissed state persists across page reload
- 503 from server shows Install row instead of empty list
- `pnpm lint` 0 errors on new/modified files
- TypeScript `strict: true` — 0 type errors

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Sidebar.tsx complex render tree — wrong insert point | Layout regression | Read file fully, insert between clearly-labeled comment blocks |
| `react-qr-code` types not compatible with TS strict mode | Type error | Check peer deps; fallback to `qrcode.react` if needed |
| `navigator.clipboard` unavailable on HTTP | Copy fails silently | Already served over same-origin HTTPS or localhost — both allow clipboard API |
| Installer 503 detection: list endpoint vs dedicated endpoint | API mismatch | Agree with Phase 02: list returns 503 when binary missing; catch in query `onError` |
| `setQueryData` with stale initial data on WS reconnect | Diverged state | On WS `connected` event, call `qc.invalidateQueries({ queryKey: ["tunnels"] })` to resync |

## Security Considerations

- No token or credential rendered in UI.
- Warning banner ensures user explicitly acknowledges public exposure.
- URL opens in new tab (`target="_blank" rel="noopener noreferrer"`) — no `opener` access.
- QR code renders URL only — no auth data embedded.

## Next Steps

Feature complete after Phase 03 smoke test passes. Follow-up candidates (deferred):
- Audit log (`~/.config/dam-hopper/tunnel-audit.log`)
- Auth overlay (Basic / passcode via internal reverse proxy)
- Second driver (Dev Tunnels) to prove trait abstraction

## Unresolved Questions

- Installer progress: poll `GET /api/tunnels` until non-503 vs dedicated `GET /api/tunnels/install/progress` SSE endpoint? Polling is simpler for MVP; progress bar granularity irrelevant for a 5s download.
- Confirm `Sidebar.tsx` has clearly delineated sections for project list vs terminal tree, or if refactoring is needed to insert `TunnelPanel` cleanly. Read file at Phase 03 start.
