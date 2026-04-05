# Researcher 02: Rust Ecosystem Recommendations

## Web Framework

| Crate | Pros | Cons | Verdict |
|-------|------|------|---------|
| **Axum** | Tower middleware, first-class WS, Tokio-native, largest ecosystem growth | 10-15% slower than Actix under extreme load | **Recommended** |
| Actix-web | Highest raw throughput, actor model for WS state | Actor complexity unnecessary here, smaller ecosystem momentum | Good but overkill |
| Warp | Filter composition | Stagnant development, smaller community | Skip |

**Pick: Axum** — WebSocketUpgrade extractor, shared state via `Extension<Arc<AppState>>`, Tower middleware for auth/CORS/rate-limit.

## PTY Handling

| Crate | Pros | Cons | Verdict |
|-------|------|------|---------|
| **portable-pty** | Cross-platform (Linux/macOS/Windows), part of wezterm, runtime impl selection, spawn+resize | Heavier dependency (wezterm ecosystem) | **Recommended** |
| pty-process | Tokio AsyncRead/Write native, lighter | Less cross-platform maturity | Good alternative |
| Raw nix::pty | Full control, minimal deps | Linux/macOS only, manual everything | Too low-level |

**Pick: portable-pty** — proven in wezterm (production terminal emulator), supports all required ops (spawn, write, resize, kill). Scrollback buffer must be implemented manually (same as current Node impl).

## Git Operations

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **git2** (libgit2) | Battle-tested, full API (status, fetch, push, branches, worktrees) | C dependency (libgit2), not pure Rust | **Recommended for now** |
| gix (gitoxide) | Pure Rust, 2-11x faster, no C deps | Missing push, incomplete merge/rebase, API still evolving | Future migration target |
| Git CLI shell-out | 100% feature parity, familiar | Subprocess overhead, output parsing fragile | Fallback for missing features |

**Pick: git2 + CLI fallback** — git2 for core ops (status, fetch, branches, worktrees). Shell out to `git` CLI for operations git2 handles poorly (complex merges). This mirrors how GitButler and other production tools work. Migrate to gix when push lands.

## WebSocket

| Approach | Pros | Cons |
|----------|------|------|
| **Axum built-in WS** | Integrated with router, no extra deps, handles upgrade | Sufficient for our needs |
| tokio-tungstenite | More control, standalone | Extra dependency, unnecessary here |

**Pick: Axum built-in** — `axum::extract::ws` handles upgrade + message streaming. Broadcast to multiple clients via `tokio::sync::broadcast` channel.

## TOML + Config

| Crate | Notes |
|-------|-------|
| **toml** + **serde** | Standard approach. `#[serde(rename_all = "snake_case")]` handles naming. No gotchas. |
| **serde** `rename_all` | Can do snake_case on disk, camelCase in Rust structs via `#[serde(rename_all = "camelCase")]` |

**No issues** — TOML crate handles the existing `dev-hub.toml` format directly.

## Recommended Cargo.toml Dependencies

```toml
[dependencies]
axum = { version = "0.8", features = ["ws", "json"] }
tokio = { version = "1", features = ["full"] }
tower = "0.5"
tower-http = { version = "0.6", features = ["cors", "fs"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
git2 = "0.19"
portable-pty = "0.8"
uuid = { version = "1", features = ["v4"] }
tokio-stream = "0.1"
tracing = "0.1"
tracing-subscriber = "0.3"
```
