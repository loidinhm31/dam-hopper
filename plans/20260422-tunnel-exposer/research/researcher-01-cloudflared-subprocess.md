# Research 01 — cloudflared Subprocess Integration

**Date:** 2026-04-22
**Scope:** Spawn + parse + reap `cloudflared` Quick Tunnels from a Rust/tokio server.

## 1. CLI invocation

Canonical command for anonymous Quick Tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:<PORT> --no-autoupdate --metrics 127.0.0.1:0
```

Flag rationale:
- `--url` — required. Without it, cloudflared connects but never forwards anywhere (see [issue #866](https://github.com/cloudflare/cloudflared/issues/866)).
- `--no-autoupdate` — prevents the daemon from self-updating during a dev session.
- `--metrics 127.0.0.1:0` — binds the Prometheus/metrics endpoint to a random free loopback port; avoids port-clash if several tunnels run simultaneously.
- `127.0.0.1` (not `localhost`) — avoids DNS resolution surprises on misconfigured `/etc/hosts`.

Optional but useful:
- `--loglevel info` — default. Use `debug` only when troubleshooting.
- `--logfile /tmp/cloudflared-<uuid>.log` — writes **JSON lines** to a file (default format for `--logfile`, per [issue #1033](https://github.com/cloudflare/cloudflared/issues/1033)). Useful as a secondary parse path if stderr regex is unreliable.

## 2. URL emission — parse strategy

Default cloudflared writes human-readable logs to **stderr** (stdout reserved for user-facing content that doesn't exist in tunnel mode). Tunnel URL shows up in log lines like:

```
2026-04-22T10:15:03Z INF +--------------------------------------------------------------------------------------------+
2026-04-22T10:15:03Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-04-22T10:15:03Z INF |  https://random-words-abc123.trycloudflare.com                                              |
2026-04-22T10:15:03Z INF +--------------------------------------------------------------------------------------------+
```

**Recommended regex** (compiled once, applied to each stderr line):

```rust
static CF_URL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com").unwrap()
});
```

Stability: the banner text has shifted across cloudflared releases, but the URL substring is structural (subdomain + trycloudflare.com TLD) and has been stable for years. Match the URL, not the banner text.

**Typical latency from spawn → first URL:** 2–5 seconds. Emit `Starting` status on spawn, flip to `Ready` on first regex hit. Timeout of 30s before declaring `Failed`.

**Fallback (JSON log):** add `--logfile <tempfile>` and tail it line-by-line if the stderr capture proves flaky. JSON shape per line includes `{"level":"info","msg":"...","time":"..."}`. Not needed for MVP — stick with stderr regex.

## 3. Release artifacts + install

Canonical download URL template (public, no auth):

```
https://github.com/cloudflare/cloudflared/releases/latest/download/<asset>
```

| Host | Asset filename | Handling |
|---|---|---|
| Linux amd64 | `cloudflared-linux-amd64` | Raw ELF; `chmod +x` |
| Linux arm64 | `cloudflared-linux-arm64` | Raw ELF; `chmod +x` |
| macOS arm64 | `cloudflared-darwin-arm64.tgz` | `tar -xzf` then `chmod +x` |
| macOS amd64 | `cloudflared-darwin-amd64.tgz` | `tar -xzf` then `chmod +x` |

**Checksums:** Cloudflare publishes SHA256 digests **inside the release notes body** (Markdown table), not as separate `.sha256` files. Retrieve via GitHub API:

```
GET https://api.github.com/repos/cloudflare/cloudflared/releases/latest
→ body field contains "| cloudflared-linux-amd64 | <sha256> |"
```

Parsing the Markdown table in Rust is fragile. **Pragmatic recommendation for MVP:** rely on GitHub's HTTPS + the standard `https://github.com/...` redirect (CDN-backed, tamper-resistant in practice). Document in README that advanced users can install via package manager (`brew install cloudflared`, `apt install cloudflared`, etc.) to get PGP-verified artifacts.

**Install path:** `~/.dam-hopper/bin/cloudflared` (0o755). Resolve order:
1. `$PATH` (user's existing install)
2. `~/.dam-hopper/bin/cloudflared`
3. Emit `driver_unavailable` event → UI shows Install button

## 4. tokio child process hygiene

Spawn pattern:

```rust
use tokio::process::Command;
use std::process::Stdio;

let mut child = Command::new(binary_path)
    .args(&["tunnel", "--url", &format!("http://127.0.0.1:{port}"),
            "--no-autoupdate", "--metrics", "127.0.0.1:0"])
    .stdout(Stdio::null())   // nothing useful on stdout
    .stderr(Stdio::piped())  // parse URL from here
    .kill_on_drop(true)      // if TunnelSession drops, child dies
    .spawn()?;
```

Critical settings:
- `kill_on_drop(true)` — tokio sends SIGKILL on handle drop. Safety-net for panics.
- `stderr(Stdio::piped())` — needed to read logs; we consume lines via `tokio::io::AsyncBufReadExt::lines()`.

Graceful shutdown sequence (on explicit Stop or server shutdown):

```rust
async fn stop(&mut self) {
    // 1. SIGTERM — request clean shutdown
    if let Some(pid) = self.child.id() {
        #[cfg(unix)] {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
    }
    // 2. Wait up to 2s for clean exit
    let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
    // 3. Force kill if still alive (idempotent)
    let _ = self.child.kill().await;
    // 4. Reap zombie explicitly
    let _ = self.child.wait().await;
}
```

**Why not rely solely on `child.kill()`:** on Unix `tokio::process::Child::kill()` sends SIGKILL, which doesn't let cloudflared close Cloudflare-edge connections cleanly. Matters little for Quick Tunnels (disposable) but SIGTERM-first is still the courteous default.

**Server-wide shutdown reaping:** store all `TunnelSession` values in `Arc<RwLock<HashMap<Uuid, TunnelSession>>>`. On server `shutdown_signal()` handler, iterate and `stop()` each before returning. Ref: existing `main.rs` drop-order pattern used for `persist_tx` (see `server/src/main.rs`).

Sources: [tokio-rs/tokio#2504](https://github.com/tokio-rs/tokio/issues/2504), [tokio::process::Child](https://docs.rs/tokio/latest/tokio/process/struct.Child.html), [Tokio graceful shutdown guide](https://tokio.rs/tokio/topics/shutdown)

## 5. Edge cases + pitfalls

- **Target port not listening:** cloudflared still creates the tunnel; HTTP requests 502 at the edge. Not our problem — surface as-is.
- **Network down at spawn:** cloudflared retries indefinitely without emitting URL. Enforce a 30s startup timeout; flip status to `Failed` with message `"timed out waiting for tunnel URL"`.
- **Stdio buffering:** cloudflared uses line-buffered stderr by default when piped. Reading via `BufReader::lines()` is safe.
- **SIGPIPE on stderr close:** if we drop the stderr reader while child is alive, cloudflared may get SIGPIPE. Keep the reader task alive for the session's lifetime.
- **Port already in use by metrics:** mitigated by `--metrics 127.0.0.1:0` (ephemeral port).
- **Binary download partial / interrupted:** write to `<path>.download` tempfile, then atomic `rename` to final path. Delete partial on error.
- **macOS Gatekeeper:** `.tgz` extracted binaries may carry quarantine attr. Users typically invoke via Terminal first, which clears it. Document "first run may prompt" in UI.
- **ARM32 / Windows / FreeBSD:** Cloudflare publishes these too; out of MVP scope but trivially added later via asset-name map.

## 6. Existing crate in ecosystem

Searched crates.io: no maintained Rust crate wraps cloudflared Quick Tunnels. `tokio-process-tools` exists for generic child lifecycle helpers; overkill for one driver, consider later if we add ngrok/devtunnel drivers.

## Unresolved questions

- **Exact URL log line format** across cloudflared versions — not documented; code comment should cite regex-based URL extraction as intentionally resilient to banner changes. Verify empirically during Phase A implementation by running latest cloudflared and capturing stderr.
- **SHA256 verification:** implement via GitHub API Markdown parse, or accept TLS-only for MVP? Recommendation: **TLS-only for MVP**, TODO comment for future SHA verification.
- **Windows support:** `cloudflared-windows-amd64.exe` exists. Deferred — dam-hopper is primarily Linux/macOS-targeted; document in installer module but don't test.
