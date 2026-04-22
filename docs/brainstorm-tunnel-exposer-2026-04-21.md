# Brainstorm: Localhost Tunnel Exposer

**Date:** 2026-04-21
**Status:** Phase A (backend core) + Phase B (REST + WS API surface) complete — Phase C (Web UI) pending
**Owner:** @loidinhm31

---

## 1. Problem

dam-hopper runs as a remote IDE. Dev servers (Vite, APIs, etc.) started inside the remote workspace bind to `localhost:PORT` on that remote box — invisible to the developer's laptop browser, teammates, or webhook providers.

Need: **click-and-play expose of a remote `localhost:PORT` to a public HTTPS URL**, with easy dispose. Must work when the remote box has no public IP and may sit behind NAT.

## 2. Constraints (agreed)

| Axis | Decision |
| --- | --- |
| Audience | Teammates on the open internet (public URL) |
| Network | No public IP; likely behind NAT — outbound-only must work |
| 3rd-party setup | No account/domain required on user side |
| Lifecycle | In-memory session, random URL, lives until explicit stop or server shutdown. No disk persistence, no auto-respawn. |
| Auth overlay | None — fully public URL, user-acknowledged risk |
| Port input | Manual: user types `port` + `label` |
| Architecture | Pluggable `TunnelDriver` trait; cloudflared is first impl |

## 3. Reference implementations (prior art)

- **VS Code "Forward a Port" panel** — SSH-forwarded ports (private) + "Make Public" via [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview). Right-click → Stop. This is the UX shape we copy.
- **JetBrains Gateway / Code-With-Me** — similar pattern, tied to JetBrains account.
- **GitHub Codespaces** — auto-forwards ports, private by default, "Change visibility → Public" toggles a public URL.

**Takeaway:** Ports panel + per-entry visibility/stop actions is the battle-tested UX. Don't invent new.

## 4. Approaches evaluated

### A. Cloudflare Quick Tunnels via `cloudflared` ✅ chosen
`cloudflared tunnel --url http://localhost:PORT` → random `https://<x>.trycloudflare.com` URL. Outbound-only HTTP/2 to Cloudflare edge, so NAT-friendly. **No account, no domain, no signup.**

- **Pros:** zero external setup, solid perf, huge CDN, WebSocket supported, single binary, official support
- **Cons:** URL rotates on restart; 200 concurrent request cap; no SSE support (WebSocket fine — covers Vite/Next HMR); no SLA; not for prod (fine — dev-only)

### B. Microsoft Dev Tunnels (`devtunnel`) — secondary driver candidate
Free tier generous, stable URLs, optional auth-gating. **Requires GitHub/MSA sign-in** on the host side — violates "no account" constraint, so not MVP. Worth slotting behind the `TunnelDriver` trait as a future opt-in for users who want persistent URLs with auth.

### C. ngrok
Great DX (request inspector!), but free tier throttles bandwidth and caps sessions. User already flagged speed concern. Slot behind trait as a power-user driver, not default.

### D. Tailscale Funnel / Serve
Elegant and fast, but both sides need tailnet membership to reach the URL — breaks "teammate clicks a link" flow. Skip.

### E. Self-hosted (bore, rathole, frp)
Requires a relay VPS with public IP — back to square one. Skip.

### F. Pure SSH remote forward (serveo, pinggy.io)
Flaky public relays, routinely down. Skip.

### G. Pure-Rust tunnel client
Weeks of protocol reverse-engineering for zero user-visible benefit. Skip.

## 5. Chosen solution

**MVP:** `cloudflared` Quick Tunnels behind a `TunnelDriver` trait, with a Ports panel UI modeled on VS Code.

### 5.1 Server-side (Rust)

```rust
// server/src/tunnel/mod.rs
pub trait TunnelDriver: Send + Sync {
    fn name(&self) -> &'static str;
    async fn start(&self, port: u16, label: &str) -> Result<DriverHandle>;
}

pub struct TunnelSession {
    pub id: Uuid,
    pub port: u16,
    pub label: String,
    pub driver: String,          // "cloudflared" | "devtunnel" | ...
    pub url: Option<String>,     // None until driver emits it
    pub status: TunnelStatus,    // Starting | Ready | Failed | Stopped
    pub started_at: DateTime<Utc>,
    pub pid: Option<u32>,
}

pub struct TunnelSessionManager {
    sessions: Arc<RwLock<HashMap<Uuid, TunnelSession>>>,
    events: broadcast::Sender<TunnelEvent>,
}
```

- Spawns `cloudflared tunnel --url http://127.0.0.1:{port} --no-autoupdate --metrics 127.0.0.1:0` as a child process (reuse PTY-free subprocess path; tokio `Command` is enough).
- Parses stdout/stderr for the URL line (stable regex: `https://[a-z0-9-]+\.trycloudflare\.com`).
- **No disk persistence.** Sessions live in-memory only. Server shutdown → all child processes reaped via Drop / shutdown hook → all tunnels gone. User recreates on next boot.
- Ships `cloudflared` resolution strategy: `$PATH` → `~/.dam-hopper/bin/cloudflared` → prompt user to install (don't auto-download on first launch; let it be explicit).

### 5.2 API surface (minimal)

```
POST   /api/tunnels             { port, label, driver? }  → session
DELETE /api/tunnels/:id
GET    /api/tunnels                                        → list
```

WebSocket events (envelope `kind`):
- `tunnel_created` `{ id, port, label, status }`
- `tunnel_ready`   `{ id, url }`
- `tunnel_failed`  `{ id, error }`
- `tunnel_stopped` `{ id }`

### 5.3 Web UI

- New left-sidebar section: **Tunnels** (between project list and terminal tree).
- Collapsed row per tunnel: `🔗 frontend · :3000 · https://...trycloudflare.com [copy] [stop]`
- "New tunnel" button → dialog with `port` (number) + `label` (text) + `driver` (dropdown, defaults to cloudflared).
- Ready state: click URL to open in new tab; copy button; QR-code popover for mobile testing.
- Failed state: inline error + retry button.
- Warning banner on first use: *"Public URL — anyone with the link can reach your port. Stop when done."*
- On reconnect after server restart: tunnel list comes back empty (intentional). No recovery toast needed.

### 5.4 Binary distribution

- Don't bundle `cloudflared` in the dam-hopper binary (adds 30MB; licensing fine but bloats default build).
- First-time flow: user clicks "New tunnel" → if binary missing, show one-click "Install cloudflared" (downloads official release into `~/.dam-hopper/bin/`, verifies checksum).
- Document the manual install path in the user guide too.

## 6. Security considerations

- **Fully public URL** — user explicitly accepted this. First-use banner makes it loud.
- **Kill-switch:** single button stops all tunnels; bind to keyboard shortcut `Ctrl+Shift+K`.
- **Audit log:** append create/stop events with timestamp + port + url to `~/.config/dam-hopper/tunnel-audit.log`. Cheap, invaluable if something leaks.
- **No bind to `0.0.0.0`** — always target `127.0.0.1` on the remote box. Keeps tunneled service off the remote's own network, only reachable through CF.
- **Future:** optional Basic-auth overlay via a tiny internal reverse proxy between cloudflared and localhost. Design now, ship later.

## 7. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Quick Tunnel URL rotates on every restart | Tunnels don't survive server restart by design — user explicitly recreates, gets fresh URL. Zero reconciliation logic. |
| cloudflared binary absent on host | First-run installer flow; clear error if skipped |
| 200 concurrent request cap hit during team demo | Document limit; escalate path = Dev Tunnels driver (free tier higher) |
| SSE-based dev servers break | Rare (most use WS). Document. Future: add driver-level capability flags. |
| User forgets to kill tunnel | Auto-kill on dam-hopper server shutdown via Drop/shutdown hook. |
| cloudflared child process zombies after crash | Tokio child-watch task marks status=`Failed` and reaps. **No auto-restart** — user clicks retry. |

## 8. Success criteria

- ⏱ Time from click → copyable public URL: **< 5 seconds** on warm binary
- ✅ Works from a home/corporate NATted dev box with zero firewall tweaks
- ✅ Zero Cloudflare/ngrok/GitHub account needed to ship MVP
- ✅ Stop action actually kills the child (verified via `ps` after)
- ✅ Server shutdown reaps all children — no orphaned `cloudflared` processes
- ✅ Second driver (Dev Tunnels or ngrok) can be added without touching UI — trait abstraction proven

## 9. Out of scope (MVP)

- Auth overlay (Basic / passcode)
- Auto port detection
- Stable URLs (named CF tunnels requiring account/domain)
- Multi-port / path-based routing in one tunnel
- TCP/UDP forwarding (cloudflared supports TCP via client, but browsers can't use it — skip)
- Team sharing of tunnel URLs inside dam-hopper itself

## 10. Next steps

1. ~~Validate plan via `/plan:hard` or `/plan:fast`~~ — done
2. Phase split:
   - **Phase A:** `TunnelDriver` trait + `CloudflaredDriver` + `TunnelSessionManager` — **done** (ce9f887)
   - **Phase B:** REST + WS API surface — **done** (3 REST handlers, 4 `ServerMsg` variants, `AppState::tunnel_manager`, graceful shutdown reap, web channel mappings)
   - **Phase C:** Web UI panel + installer flow + warning banners — **pending**
3. ~~Confirm cloudflared install strategy~~ — resolved: lazy download into `~/.dam-hopper/bin/` on first use

---

## Sources

- [Cloudflare Quick Tunnels docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [cloudflared GitHub](https://github.com/cloudflare/cloudflared)
- [Quick Tunnels launch blog (limits & rationale)](https://blog.cloudflare.com/quick-tunnels-anytime-anywhere/)
- [Microsoft Dev Tunnels overview](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/overview)
- [VS Code port forwarding docs](https://code.visualstudio.com/docs/editor/port-forwarding)
