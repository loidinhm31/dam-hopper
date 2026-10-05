# Diagnostic Report: Cloudflared Port Forwarding Failure on Port 25001

- **Date:** 2026-10-05 11:15 Asia/Saigon
- **Target Component:** `server/src/tunnel/cloudflared.rs`, `server/src/tunnel/manager.rs`, `packages/ui/src/components/organisms/PortsPanel.tsx`, `packages/ui/src/hooks/use-ports.ts`
- **Report Path:** `plans/reports/debugger-261005-1057-cloudflared-port-forwarding.md`
- **Status:** Complete (Root Cause Identified; No code modifications applied per instructions)

---

## 1. Executive Summary

- **Incident:** User forwarded port 25001 via quick tunnel (`https://belief-auctions-ratings-curriculum.trycloudflare.com`), but navigating to the URL produced Chrome browser error: `"No webpage was found for the web address: https://belief-auctions-ratings-curriculum.trycloudflare.com/"`. UI PortsPanel continued displaying green dot, `PUBLIC` badge, and active URL despite dead tunnel process.
- **Root Causes:**
  1. **Dual Process Configuration Collision:** `CloudflaredDriver::start` executes `cloudflared tunnel --url http://127.0.0.1:{port}` without isolating config or overriding host headers.
     - System has existing `/etc/cloudflared/config.yml` configuring named tunnel `eigencrate-clean` with credentials file and ingress rules. `cloudflared` defaults `--config /etc/cloudflared/config.yml` automatically.
     - Loading named tunnel credentials on an anonymous quick tunnel triggers Cloudflare edge connection teardowns with QUIC `Application error 0x0 (remote)`, terminating the tunnel connector (`ERR no more connections active and exiting`).
     - Furthermore, ingress rules in `config.yml` override `--url`, routing non-matching hostnames to catch-all `- service: http_status:404`.
  2. **Vite 6 Host Header Rejection:** Port 25001 hosts `@eigen-air-ui/web` running on Vite 6 (PID 1165150). Vite 6 DNS rebinding protection (`server.allowedHosts`) blocks requests with external Host header (`belief-auctions-ratings-curriculum.trycloudflare.com`) returning `403 Forbidden`. Without `--http-host-header localhost`, valid tunnel traffic cannot reach Vite dev server.
  3. **Driver Lifecycle Event Drop Bug:** In `server/src/tunnel/cloudflared.rs`:
     - Inner stderr reader task drains stderr to EOF after URL emission, but never emits `TunnelDriverEvent::Exited` on EOF.
     - Outer reaper task waits for `child.wait()` and assumes inner task emitted `Exited`.
     - When `cloudflared` dies, `TunnelDriverEvent::Exited` is never sent. Channel closes without event.
     - `TunnelSessionManager::watch_events` never broadcasts `tunnel:stopped`.
     - Frontend `use-ports.ts` React Query cache never receives stop event, leaving PortsPanel UI in `TunnelStatus::Ready` (green dot, `PUBLIC` badge, clickable link).
  4. **User Visible Symptom:** When Chrome accesses disconnected trycloudflare hostname, Cloudflare edge returns `HTTP/2 530` with `Error 1033 (Cloudflare Tunnel error)`. Chrome renders this network-level 530 / tunnel disconnect as `"No webpage was found for the web address"`.

---

## 2. Technical Analysis

### 2.1 Process Execution & Command Arguments Investigation

#### A. Command Invocation in `server/src/tunnel/cloudflared.rs:35-41`
```rust
let mut child = Command::new(bin)
    .args(["tunnel", "--url", &format!("http://127.0.0.1:{port}")])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::piped())
    .kill_on_drop(true)
    .spawn()
    .map_err(|e| TunnelError::SpawnFailed(e.to_string()))?;
```

#### B. System Configuration Collision: `/etc/cloudflared/config.yml`
- File `/etc/cloudflared/config.yml` exists on host with contents:
  ```yaml
  tunnel: eigencrate-clean
  credentials-file: /etc/cloudflared/03c5ab53-ef50-44c0-8218-c8f721c63871.json

  ingress:
    - hostname: app.qm-hub-v001.cloud
      service: http://localhost:80
    - hostname: api-hop.qm-hub-v001.cloud
      service: http://localhost:3000
      originRequest:
        noTLSVerify: false
        connectTimeout: 30s
    - service: http_status:404
  ```
- `cloudflared tunnel --help` confirms default flag:
  `--config value Specifies a config file in YAML format. (default: "/etc/cloudflared/config.yml")`
- Live reproduction executing `cloudflared tunnel --url http://127.0.0.1:25001`:
  ```
  Settings: map[cred-file:/etc/cloudflared/03c5ab53-ef50-44c0-8218-c8f721c63871.json credentials-file:/etc/cloudflared/03c5ab53-ef50-44c0-8218-c8f721c63871.json ha-connections:1 protocol:quic url:http://127.0.0.1:25001]
  ```
- **Consequences:**
  1. **Edge Drop via `Application error 0x0 (remote)`:** Tunnel attempts trycloudflare quick tunnel registration while transmitting named tunnel credentials for account-bound tunnel `eigencrate-clean`. Cloudflare edge terminates QUIC stream with application error 0 (`Application error 0x0 (remote)`), triggering:
     ```
     ERR Connection terminated connIndex=0
     ERR no more connections active and exiting
     INF Tunnel server stopped
     ```
  2. **Ingress Rule Override (404 Fallback):** When connection briefly stays open, ingress rules from `config.yml` take precedence over `--url`. Any `*.trycloudflare.com` request fails hostname matching on `app.qm-hub-v001.cloud` and `api-hop.qm-hub-v001.cloud`, falling into catch-all `- service: http_status:404` (confirmed via live curl: `HTTP ERROR: 404 Not Found`).

#### C. Vite 6 Host Header Rejection (`server.allowedHosts`)
- Process listening on port 25001:
  `node .../vite/bin/vite.js --host` (`@eigen-air-ui/web` on port 25001).
- Testing origin directly with external Host header:
  ```bash
  $ curl -i -H "Host: belief-auctions-ratings-curriculum.trycloudflare.com" http://127.0.0.1:25001
  HTTP/1.1 403 Forbidden
  Blocked request. This host ("belief-auctions-ratings-curriculum.trycloudflare.com") is not allowed.
  To allow this host, add "belief-auctions-ratings-curriculum.trycloudflare.com" to `server.allowedHosts` in vite.config.js.
  ```
- Testing origin with `Host: localhost`:
  `HTTP/1.1 200 OK` (serves index.html).
- `cloudflared` forwards incoming Host header by default unless `--http-host-header localhost` is explicitly configured.

---

### 2.2 Tunnel Lifecycle Bug in `server/src/tunnel/cloudflared.rs`

#### A. Code Inspection
In `server/src/tunnel/cloudflared.rs:52-101`:
```rust
// Inner task:
let event_tx_inner = event_tx.clone();
tokio::spawn(async move {
    let reader = BufReader::new(stderr);
    let mut lines = reader.lines();
    let event_tx_timeout = event_tx_inner.clone();

    let url_search = async {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(m) = CF_URL_RE.find(&line) {
                let _ = event_tx_inner
                    .send(TunnelDriverEvent::UrlReady(m.as_str().to_owned()))
                    .await;
                return true;
            }
        }
        false
    };

    match timeout(Duration::from_secs(30), url_search).await {
        Ok(true) => {
            // URL found — drain remaining stderr to avoid buffer pressure
            while let Ok(Some(_)) = lines.next_line().await {}
            // BUG: Exits loop on EOF and terminates task WITHOUT sending TunnelDriverEvent::Exited!
        }
        Ok(false) => {
            let _ = event_tx_inner.send(TunnelDriverEvent::Exited).await;
        }
        Err(_) => {
            let _ = event_tx_timeout.send(TunnelDriverEvent::Failed(...)).await;
            while let Ok(Some(_)) = lines.next_line().await {}
        }
    }
});

// Outer task:
tokio::spawn(async move {
    tokio::select! {
        _ = stop_rx => {
            graceful_kill(&mut child, pid).await;
        }
        _ = child.wait() => {
            // BUG: Child exited naturally; comment claims "stderr task detects EOF and sends Exited".
            // Outer task does nothing and terminates!
        }
    }
});
```

#### B. Chain of Failure:
1. `cloudflared` emits URL. Inner task sends `TunnelDriverEvent::UrlReady(url)`.
2. `TunnelSessionManager::watch_events` (in `server/src/tunnel/manager.rs:386-394`) sets `sess.status = TunnelStatus::Ready` and broadcasts `sink.broadcast("tunnel:ready", ...)`.
3. Frontend `use-ports.ts` receives `tunnel:ready`, patches React Query cache:
   ```ts
   qc.setQueryData<TunnelInfo[]>(profileTunnelsQueryKey(conn), (prev = []) =>
     prev.map((t) => t.id === id ? { ...t, status: "ready", url } : t)
   );
   ```
4. `PortsPanel.tsx:202-270` evaluates `isReady = true`:
   - `dotColor = "bg-green-500"`
   - Badge renders `<span ...>PUBLIC</span>`
   - Active anchor tag renders `<a href={entry.tunnel.url}>{url}</a>`
5. `cloudflared` process dies (due to edge QUIC error, unhandled signal, or process crash).
6. Child stderr pipe closes. `lines.next_line().await` returns `Ok(None)`.
7. Inner task exits `while let Ok(Some(_))` drain loop and terminates. Sender `event_tx_inner` dropped.
8. Outer task `child.wait()` resolves, executes no-op comment, drops child, terminates.
9. Channel `event_tx` has 0 senders. `event_rx.recv().await` in `watch_events` returns `None`.
10. `watch_events` exits the `while let Some(event)` loop without hitting `TunnelDriverEvent::Exited`.
11. `sink.broadcast("tunnel:stopped", ...)` is **NEVER broadcast**.
12. Backend removes session from map at `sessions.write().await.remove(&id)`, but never transitions `sess.status` to `TunnelStatus::Stopped`.
13. Frontend never receives `tunnel:stopped`. No polling exists (`useQuery` has no `refetchInterval`).
14. PortsPanel remains indefinitely stuck displaying green dot, `PUBLIC`, and dead URL.

---

### 2.3 User Visible Symptom: Chrome Error Analysis

1. Tunnel process on host terminates due to config conflict.
2. Cloudflare Edge tries to resolve `belief-auctions-ratings-curriculum.trycloudflare.com` through QUIC connection pool. No active connector exists for this quick tunnel ID.
3. Edge serves Cloudflare Error Page:
   - Status: `HTTP/2 530`
   - CF Error Code: `Error 1033`
   - Heading: `Cloudflare Tunnel error`
   - Description: `The host (...) is configured as a Cloudflare Tunnel, and Cloudflare is currently unable to resolve it.`
4. Chrome browser intercepts HTTP 530 / disconnected edge tunnel response and displays standard network error page:
   `"No webpage was found for the web address: https://belief-auctions-ratings-curriculum.trycloudflare.com/"`.

---

## 3. Reproduction & Verification Matrix

| Test Scenario | Command Args | Edge Response | Local Vite Response | Backend State | Frontend PortsPanel |
|---|---|---|---|---|---|
| **Default (As-is)** | `cloudflared tunnel --url http://127.0.0.1:25001` | Edge drops connection (`App error 0x0`) or returns `404` (config ingress match) | Blocked by Vite (`403 Forbidden`) if reached | Child dead; `watch_events` channel drops without `Exited` | Stuck on `Ready` (Green / PUBLIC / URL) |
| **Bypass Config Only** | `cloudflared tunnel --config "" --url http://127.0.0.1:25001` | Reaches tunnel origin | `HTTP 403 Forbidden` (`server.allowedHosts` blocks external Host) | Running | Starting -> Ready |
| **Bypass Config + Host Header** | `cloudflared --no-autoupdate tunnel --config "" --http-host-header localhost --url http://127.0.0.1:25001` | **`HTTP 200 OK`** (reaches Vite HTML) | `HTTP 200 OK` | Running | Starting -> Ready |
| **Child Exit Event Test** | Process killed after URL | `HTTP 530 / Error 1033` | N/A | Removed without `tunnel:stopped` event | **Stuck on `Ready` (Green / PUBLIC / URL)** |

---

## 4. Actionable Recommendations

### 4.1 Fix 1: Command Arguments Isolation & Host Header (Immediate)
In `server/src/tunnel/cloudflared.rs:35-37`:
- **Current:**
  ```rust
  .args(["tunnel", "--url", &format!("http://127.0.0.1:{port}")])
  ```
- **Recommended:**
  ```rust
  .args([
      "--no-autoupdate",
      "tunnel",
      "--config",
      "",
      "--http-host-header",
      "localhost",
      "--url",
      &format!("http://127.0.0.1:{port}"),
  ])
  ```
- **Rationale:**
  - `--config ""` prevents reading `/etc/cloudflared/config.yml` or user-level config files. Ensures clean ephemeral quick tunnel without named credentials or ingress rule conflicts.
  - `--http-host-header localhost` rewrites Host header forwarded to origin to `localhost`, satisfying Vite 6 `server.allowedHosts` DNS rebinding protection.
  - `--no-autoupdate` prevents background auto-update checks during short-lived quick tunnel execution.

### 4.2 Fix 2: Tunnel Lifecycle Exit Notification (Immediate)
In `server/src/tunnel/cloudflared.rs:72-101`:
- **Inner task:** Send `TunnelDriverEvent::Exited` after draining loop finishes:
  ```rust
  Ok(true) => {
      while let Ok(Some(_)) = lines.next_line().await {}
      let _ = event_tx_inner.send(TunnelDriverEvent::Exited).await;
  }
  ```
- **Outer task:** Ensure reaper task or inner task have single source of truth for `Exited`.
  Alternatively, outer reaper task can send `Exited` when `child.wait()` resolves naturally:
  ```rust
  _ = child.wait() => {
      let _ = event_tx.send(TunnelDriverEvent::Exited).await;
  }
  ```
  (Coordinate sender ownership so `Exited` is guaranteed exactly once when process exits).

### 4.3 Fix 3: Defensive Fallback in `TunnelSessionManager::watch_events` (Defense-in-Depth)
In `server/src/tunnel/manager.rs:434-438`:
- If `event_rx.recv()` returns `None` (channel closed) without explicit terminal event (`Exited` or `Failed`), check if session is still in `Starting` or `Ready` state. If so, broadcast `tunnel:stopped` before removing the session so clients never retain zombie tunnels:
  ```rust
  let mut s = sessions.write().await;
  if let Some(sess) = s.remove(&id) {
      if matches!(sess.status, TunnelStatus::Starting | TunnelStatus::Ready) {
          sink.broadcast("tunnel:stopped", serde_json::json!({ "id": id }));
      }
  }
  ```

---

## 5. Unresolved Questions

- None. All root causes, file locations, reproduction mechanisms, and error paths verified against live processes and codebase.
