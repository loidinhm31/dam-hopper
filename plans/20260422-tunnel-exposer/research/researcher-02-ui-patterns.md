# Research 02 — Ports-Panel UX + Web Stack

**Date:** 2026-04-22
**Scope:** Copy-worthy IDE patterns + React libs for the Tunnels panel.

## 1. VS Code Ports panel — states & actions

| State | Visual |
|---|---|
| Forwarding (private) | Green dot + local address |
| Public URL | Amber "Public" pill + globe icon |
| Auto-detected idle | Row dimmed, URL blank |
| Error | Red dot + inline error |

Row columns: `Port · Local Address · Process · Visibility · Origin`.

Hover/context actions:
- Copy address (icon → checkmark 2s)
- Preview in browser (embedded)
- Open in external browser
- Change visibility (Private / Public / Org)
- Stop forwarding (optimistic remove)
- Focus terminal

Public port text: *"This port is publicly accessible from the internet."* — ambient, no modal.

Sources: [VS Code port forwarding](https://code.visualstudio.com/docs/editor/port-forwarding), [Remote Codespaces](https://code.visualstudio.com/docs/remote/codespaces#_forwarding-ports-in-your-codespace)

## 2. GitHub Codespaces visibility UX

Change-visibility = right-click → submenu, **immediate, no confirmation modal**. Amber pill persists; tooltip: *"Anyone on the internet can access this port."*

URL column hidden until `ready` — port number only while starting. Stop action optimistic.

Source: [GitHub docs — forwarding ports](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)

**Steal verbatim:**
1. Ambient amber pill, no blocking gate.
2. URL blank during starting state.
3. Stop = optimistic row remove.

## 3. QR library pick — `react-qr-code`

| Lib | Gzip | Rendering | TS | SSR |
|---|---|---|---|---|
| qrcode.react | ~9 KB | SVG+Canvas | yes | yes |
| **react-qr-code** | **~5 KB** | **SVG** | **native** | **yes** |
| qrcode (pure) | ~18 KB | manual wiring | `@types` | yes |

Pick: **`react-qr-code`**. Smallest, SVG (scales), zero deps.

```bash
pnpm --filter @dam-hopper/web add react-qr-code
```

```tsx
import QRCode from "react-qr-code";
<QRCode value={tunnel.url} size={160} bgColor="transparent" fgColor="currentColor" />
```

## 4. Clipboard + a11y

`navigator.clipboard.writeText()` — requires HTTPS or localhost, both covered here.

Screen-reader pattern: `role="status"` sibling live region flipping between `""` and `"Copied!"` for 2s. Not `role="alert"` (too aggressive).

```tsx
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

Icon swap (Copy → Check) matches VS Code exactly. No toast.

Sources: [MDN Clipboard](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText), [WAI-ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions)

## 5. TanStack Query + WS push

| Approach | Round-trip | Use when |
|---|---|---|
| `setQueryData` | none | Event payload is complete |
| `invalidateQueries` | 1 refetch | Event is trigger-only |

Tunnel events carry full objects — use `setQueryData`. Invalidate only on WS reconnect to resync gaps.

Recipe (wire into existing ws-transport subscribe pattern):

```ts
// tunnel_created — append if new
qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
  prev.some((t) => t.id === next.id) ? prev : [...prev, next]);

// tunnel_ready — patch status + url
qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
  prev.map((t) => t.id === id ? { ...t, status: "ready", url } : t));

// tunnel_failed — patch status + error
qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
  prev.map((t) => t.id === id ? { ...t, status: "failed", error } : t));

// tunnel_stopped — drop
qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
  prev.filter((t) => t.id !== id));
```

Sources: [setQueryData](https://tanstack.com/query/v5/docs/reference/QueryClient#queryclientsetquerydata), [query invalidation](https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation)

## 6. Panel layout — all states (ASCII)

```
TUNNELS                                           [+]
─────────────────────────────────────────────────
  ◌  :3000   Starting…                         [×]

  ●  :3000   https://abc123.trycloudflare.com
             [⎘ Copy] [⊞ QR]          PUBLIC⚠  [×]

  ✕  :4000   Tunnel failed: connection timeout
             [↺ Retry]                          [×]
─────────────────────────────────────────────────
```

Legend: `◌` amber animate-spin (starting), `●` green solid (ready), `✕` red (failed), `PUBLIC⚠` amber pill `bg-amber-500/20 text-amber-600`. Row actions hidden until `group-hover` (matches `TerminalTreeView.tsx`). URL gets `truncate` + `title` attr.

## 7. TunnelInfo wire shape (web side)

```ts
interface TunnelInfo {
  id: string;              // uuid
  port: number;
  label: string;
  driver: string;          // "cloudflared"
  status: "starting" | "ready" | "failed" | "stopped";
  url?: string;            // only once ready
  error?: string;          // only once failed
  startedAt: number;       // unix ms
}
```

## Unresolved

- Confirm existing WS subscribe hook name in packages/web (researcher assumed `useSSE.ts`/`subscribeIpc` — may actually be `useTransport`/`WsTransport.on`).
- Radix `Popover` availability for QR popover — may need headless alt.
- First-time install flow: modal vs inline download progress row. Pick one before implementation.
