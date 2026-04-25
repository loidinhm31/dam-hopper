# Feasibility — Port Forwarding for Remote Dev Sessions

**Date:** 2026-04-25
**Scope:** Why current `/proxy/{port}/*` reverse-proxy + `openPortInBrowser` works only locally, whether sub-path proxying can be salvaged, and which alternative mechanisms actually fit DamHopper's architecture.
**Verdict up front:** Sub-path reverse-proxy is a **dead end** for modern dev servers (Vite/webpack/Next.js). Two viable paths: **wildcard-subdomain proxy** (web-only, requires DNS+TLS infra) or **multiplexed TCP-over-WebSocket** (requires a local helper, but works inside the existing auth channel).

---

## 1. What Is Actually Implemented Today

| Layer | File | State |
|---|---|---|
| Port detection (stdout regex + `/proc/net/tcp` poll) | `server/src/port_forward/detector.rs` | DONE, Linux-only |
| `PortForwardManager` + WS events `port:discovered` / `port:lost` | `server/src/port_forward/manager.rs` | DONE |
| `GET /api/ports` | `server/src/api/router.rs:95` | DONE |
| `GET /api/proxy-token` (5-min JWT, `scope: "proxy"`) | `server/src/api/proxy_token.rs` | DONE |
| `/proxy/{port}` + `/proxy/{port}/{*path}` HTTP + WS bridge | `server/src/api/proxy.rs` | DONE — auth, allowlist, header strip, 30s timeout, 100-concurrency, origin check, WS idle 600s |
| `PortsPanel` UI (list, copy, "open in browser") | `packages/web/src/components/organisms/PortsPanel.tsx` | DONE |
| **`openPortInBrowser`** | `packages/web/src/hooks/usePorts.ts:60-62` | **`window.open("http://localhost:${port}/")`** — bypasses the proxy entirely |

### The Disconnect

`openPortInBrowser` opens `http://localhost:PORT` directly. Works only when the user's browser is on the **same machine** as `dam-hopper-server`. The proxy route `/proxy/5173/` is wired and authenticated but **the UI never sends users there**. So the implemented proxy is plumbing that no UI surface uses.

Even fixing the URL to `${serverUrl}/proxy/${port}/?token=${jwt}` would only get a few minutes of life before breaking — see §2.

---

## 2. Why Sub-Path Reverse Proxy Fails for Dev Servers

### 2.1 Absolute path assumption

Vite/webpack/Next.js HTML output references `/assets/main.js`, `/favicon.ico`, `/@vite/client`. The browser resolves these against the **document origin**, not the proxy prefix. From `https://server.example/proxy/5173/`, the browser fetches `https://server.example/assets/main.js` → 404 (the proxy only matches `/proxy/{port}/*`).

### 2.2 Vite HMR WebSocket

`@vite/client` opens `new WebSocket("ws://" + location.host + "/")` (or `import.meta.hot.url`). Even with `Sec-WebSocket-Protocol: vite-hmr` correctly forwarded by the proxy bridge, the **path is wrong** — connection goes to the DamHopper server root, not `/proxy/5173/`. HMR silently dies.

### 2.3 Available workarounds and why each fails

| Workaround | Why it fails |
|---|---|
| Set `server.base = "/proxy/5173/"` in `vite.config.ts` | Forces user-side config that hard-codes a server-side detail. Port number is dynamic — config value would have to be re-written on every restart. Pollutes user's repo. |
| HTML/JS rewrite (regex-substitute `/assets` → `/proxy/5173/assets`) | Breaks dynamic `import("./" + name)`, string-concatenated URLs, inlined SVGs, source-maps, `fetch("/api/...")`. Brittle. Same battle code-server fought for years. |
| Service Worker shim that prefixes all requests | Conflicts with user-built PWAs. Doesn't catch first-paint requests before SW registers. |
| `<base href="/proxy/5173/">` injection | Fixes some assets, breaks `fetch()`, doesn't fix HMR WS path, breaks SPA router that uses `pushState` with absolute paths. |

**This isn't a "bit more engineering" problem.** code-server burned 3+ years on rewriting tricks before officially recommending users switch to the subdomain proxy mode.

References: `coder/code-server#2202`, `vitejs/vite#2245`, `vitejs/vite#10396`.

### 2.4 What the implemented proxy *can* still serve

- Plain HTTP backends with relative URLs (a `cargo run` Axum API on `:8080` returning JSON from a frontend that's already opened by the user via local subdomain): yes.
- Tools whose web UI was authored to live behind a path prefix (Grafana with `root_url`, Jupyter with `--ServerApp.base_url`): yes, with config.
- Vite/webpack/Next.js dev: **no**.

---

## 3. Industry-Standard Approaches

| # | Approach | Effort | Vite/HMR | NAT/firewall | UX | Verdict for DamHopper |
|---|---|---|---|---|---|---|
| A | **Wildcard subdomain proxy** (`5173.dev.example.com`) | High | Yes | Yes (needs public IP) | 1-click | Best for web-only access |
| B | **TCP-over-WS multiplexing** (VS Code Remote pattern) | High | Yes | Yes (uses existing auth WS) | 1-click *if* helper installed | Best fit if a local CLI is acceptable |
| C | **Sub-path reverse proxy** (current) | Done | **No** | Yes | 1-click broken | Keep for non-Vite tools only |
| D | SSH `-L` local forwarding | Low | Yes | Needs SSH access + no NAT | Manual / scripted | Low-tech fallback |
| E | Cloudflare Tunnel per port | Medium (already have driver) | Yes | Yes (outbound-only) | 1-click | Good for occasional sharing, not 50 ports |
| F | ngrok / bore / frp | Low | Yes | Yes | 1-click | Public exposure; security risk |
| G | Tailscale / WireGuard | Medium | Yes | Yes (UDP holepunch) | Manual VPN install | Heavy client dependency |

### 3.1 Wildcard subdomain (A) — what Codespaces / Gitpod / code-server actually do

Pattern: parse port from `Host` header (`5173.dev.example.com` → 5173) → forward to `http://127.0.0.1:5173/`. App sees itself at `/`, all absolute paths resolve, HMR WS points to `wss://5173.dev.example.com/` which the proxy upgrades.

**Requirements:**
- Wildcard DNS (`*.dev.example.com → server IP`)
- Wildcard TLS cert (Let's Encrypt DNS-01 challenge — needs DNS API access, e.g. Cloudflare/Route53)
- Routing layer (Axum can do this; `Host` header → port lookup)
- **Auth challenge:** browsers won't send the existing Bearer token to a different subdomain. Need cookie-based auth set on the parent domain (`Domain=.dev.example.com`) or redirect-based OAuth flow.

**Cost:** owning a domain + paying for a public-routable host. Not viable for "developer runs the server on their laptop and uses it from a tablet on the same LAN" use cases.

### 3.2 TCP-over-WS multiplexing (B) — what VS Code Remote / JetBrains Gateway do

Pattern:
1. Server detects `LISTEN` on port 5173 (already done — current `/proc/net/tcp` poller).
2. Server emits `port:discovered` over WS (already done).
3. **New:** small local helper (CLI or browser extension) connects to DamHopper WS, receives the event, and `bind`s `127.0.0.1:5173` on the user's laptop.
4. When user's local browser hits `http://localhost:5173/`, helper accepts the TCP stream and tunnels raw bytes over the existing authenticated WebSocket to the server.
5. Server-side: tunnel endpoint pipes bytes to `127.0.0.1:5173` of the dev server.

**Why it works for HMR:** the app sees itself at `localhost:5173`, exactly as if it were running locally. No path prefix, no Host rewriting, no HMR-WS confusion. The sub-domain problem is sidestepped because the browser never sees the remote at all — it only ever talks to the local helper.

**Requirements:**
- Local helper on user's machine (CLI binary, Tauri sidecar, or browser extension with `chrome.sockets.tcp`).
- WS framing for multiplexed streams (stream-id, open, data, close, error). ~200 LOC each side.
- Server-side endpoint: `WS /api/port-tunnel/{port}` that opens a TCP socket and bridges.
- Permission: server must allowlist the port (already enforced via `port_forward_manager`).

**Why this is actually attractive for DamHopper:**
- Reuses existing JWT auth on the WS layer. No DNS, no TLS certs.
- Works through NAT/firewalls (outbound WS only).
- Multiple ports, no domain-per-port costs.
- Same UX as VS Code Remote.

**The catch:** users must install something. For a self-hosted IDE that's already a CLI install (Tauri/Electron desktop or `dam-hopper-cli`), this is fine. For pure-web users (open the web app, no install), this won't fly.

### 3.3 Cloudflare Tunnel (E) — already in the codebase

`server/src/tunnel/` already shells out `cloudflared tunnel --url http://127.0.0.1:{port}`. For ports the user wants to share (especially with non-DamHopper users), this is a one-button "share" button. URL is `https://random-words.trycloudflare.com` (ugly) or named tunnel (requires Cloudflare account + DNS).

**Position it as a separate feature:** "Share this port" (creates a tunnel) ≠ "Open in browser" (gets the user accessing it themselves).

---

## 4. Recommendation — Pragmatic Path Forward

### Tier 1: Stop pretending the current proxy works for "open in browser"

Two acceptable options:

**Option A — make `openPortInBrowser` honest about being local-only.**
- Detect cross-machine access: if `getServerUrl()` host !== `location.host`, show a tooltip "Port forwarding requires running DamHopper locally. Use Cloudflare Tunnel to share." and disable the button (or open the existing tunnel UI).
- Keep `/proxy/{port}/*` for non-Vite tools (Storybook static, Grafana with base path, JSON APIs).

**Option B — wire `openPortInBrowser` to the proxy properly with a known-broken warning.**
- Fetch `/api/proxy-token`, open `${serverUrl}/proxy/${port}/?token=${jwt}` in a new tab.
- Document loudly that Vite/webpack HMR won't work via this path.
- Accept the bug reports.

**Recommended: A.** Option B sets a user expectation that doesn't hold up.

### Tier 2: Pick one of the two real solutions for Vite-class apps

**Path 1 — Subdomain proxy.** Add a `--proxy-domain` flag (mirroring code-server). When set, server matches `Host: {port}.{proxy-domain}` and proxies. Cookie auth scoped to `.{proxy-domain}` for cross-subdomain SSO. Documented requirement: wildcard DNS + wildcard TLS cert.
- Best if DamHopper is going to be installed on a public server with a domain.

**Path 2 — TCP-over-WS multiplex + local helper.** Add `WS /api/port-tunnel/{port}` server endpoint. Add a CLI subcommand `dam-hopper-cli forward 5173` (or a Tauri sidecar in the desktop build) that subscribes to `port:discovered` and binds local sockets.
- Best if DamHopper is mostly used from a desktop client or via a CLI install.
- Reuses the existing JWT/WS auth — security story is the simplest of all options.

The two are not mutually exclusive — Codespaces does both (subdomain for browser users, "Forward port" via VS Code Remote for editor users).

### Tier 3: Keep Cloudflare Tunnel as the "share with others" feature

Already implemented in `server/src/tunnel/`. Don't conflate it with self-access.

---

## 5. Effort Estimates

| Path | Backend | Frontend | Helper / Infra | Total |
|---|---|---|---|---|
| Tier 1 (A) — gate `openPortInBrowser` to same-host | none | ~2h | none | ~2h |
| Tier 1 (B) — wire to existing proxy | minor (verify token TTL) | ~3h | none | ~3h |
| Tier 2 Path 1 — subdomain proxy | ~10h (Host parsing, cookie auth) | ~2h | DNS + cert (one-time) | ~12h + ops |
| Tier 2 Path 2 — TCP-over-WS multiplex | ~12h (WS endpoint, framing, allowlist hookup) | ~3h | local helper CLI ~15h | ~30h |

---

## 6. What Actually Caused the "It Only Works Locally" Symptom

Two layered issues, only the first of which the user noticed:

1. **UI bug:** `openPortInBrowser` calls `window.open("http://localhost:${port}/")` instead of going through the proxy. From a remote browser, `localhost` resolves to the user's own laptop, where nothing is listening.
2. **Architectural ceiling:** even fixing #1 would only work for tools that tolerate sub-path serving. Vite/webpack/Next.js (the actual dev servers users run) don't.

Fixing #1 alone gives a worse experience (proxied URL appears to work, then HMR is silently broken). That's why the practical fix is Tier 1A (be honest) plus a Tier 2 plan if remote browser access is a real requirement.

---

## 7. Unresolved Questions

1. **Is "remote browser to remote dev server" actually a target use case?** If DamHopper is desktop-first (user runs the server on the same laptop as the browser), Tier 1A is sufficient and the existing `/proxy/*` is enough for Grafana/Storybook-class tools. Worth a stakeholder check before sinking time into Tier 2.
2. **Does the team have a domain available?** Tier 2 Path 1 needs `*.dev.example.com` and a wildcard cert. If yes → subdomain proxy is the cheaper end state. If no → TCP-over-WS is forced.
3. **Acceptable to require a CLI install for full port-forward UX?** Determines Tier 2 Path 1 vs Path 2.
4. **Cloudflare Tunnel UX for "open my own dev server"** — could repurpose existing tunnel manager: spawn a tunnel scoped to `*.localhost.damhopper.dev` per session (needs named tunnel + Cloudflare account). Possible middle ground but increases ops dependency.

---

## 8. Sources

- `coder/code-server` — issue #2202, `--proxy-domain` flag history
- `vitejs/vite` — issue #2245 (HMR behind reverse proxy), #10396 (base path interaction)
- `cdr/code-server` blog: "Why we moved from path-based proxy to subdomain proxy"
- VS Code Remote architecture (microsoft/vscode-remote-release): port-forwarding internals
- GitHub Codespaces port-forwarding docs (subdomain pattern: `*.app.github.dev`)
- Gitpod docs: per-port subdomain `<port>-<workspace>.<region>.gitpod.io`
- Existing project: `server/src/api/proxy.rs`, `server/src/api/proxy_token.rs`, `server/src/port_forward/detector.rs`, `packages/web/src/hooks/usePorts.ts`
