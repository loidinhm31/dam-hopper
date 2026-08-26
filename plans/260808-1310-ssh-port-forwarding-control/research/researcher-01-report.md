# Research Report: SSH Port-Forwarding Control (Rust/Axum/Tauri)

> Superseded: the user clarified that Tauri-owned native Rust must run the SSH client and desktop
> listener. Retain this report only for SSH-library/lifecycle background. See
> `researcher-03-native-ipc-report.md` and `../reports/02-native-ipc-architecture-correction.md`.

Conducted: 2026-08-08

## Executive summary

Recommend an in-process Rust SSH engine behind a backend `ForwardManager`, with one supervised Tokio task per configured tunnel and a registry keyed by tunnel ID. Expose CRUD/status through existing Axum APIs and Tauri commands/events. Keep transport/auth/host-key policy behind a trait so an OpenSSH subprocess remains a testable fallback, not the default.

Russh exposes client channels that can tunnel TCP and supports SSH authentication/key-exchange internally ([russh client docs](https://docs.rs/russh/latest/russh/client/), [russh crate docs](https://docs.rs/russh/latest/russh/)). This avoids platform-dependent binaries and shell argument handling. OpenSSH is operationally mature and feature-rich, but introduces executable discovery, differing Windows/macOS/Linux packaging, process supervision, stderr parsing, and credential-agent behavior.

## Scope and criteria

Evaluate local (`-L`), remote (`-R`), and dynamic SOCKS (`-D`) forwarding; CRUD persistence; start/stop/reconnect; host-key verification; credentials; port collisions; observability; tests. Primary/official documentation only; claims verified against upstream Rust/Tokio/Tauri/OpenSSH references.

## Findings

### Recommended backend shape

* Persist a declarative `ForwardProfile` (id, kind, bind host/port, target host/port or SOCKS policy, SSH endpoint, auth reference, host-key policy, reconnect policy, enabled).
* Runtime registry stores `ForwardRuntime { state, task_handle, cancel_token, observed_local_port, last_error, counters }`; never persist task handles or secrets.
* CRUD validates addresses and policy, writes profile, then emits an event. Start/stop are idempotent commands. A single manager serializes transitions per ID, preventing duplicate workers and stale stop races.
* Worker owns the SSH session and all forwarding channels. On cancellation, stop accepting/listening, close channels/session, and await task with a bounded shutdown timeout. Tokio documents cloned `CancellationToken` plus `select!` for cooperative shutdown ([Tokio graceful shutdown](https://tokio.rs/tokio/topics/shutdown)).
* Tauri can hold `Arc<AppState>`/manager as managed `Send + Sync` state and invoke async Rust commands; use typed commands for CRUD and events for state changes ([Tauri calling Rust](https://v2.tauri.app/develop/calling-rust/), [Tauri Builder::manage](https://docs.rs/tauri/latest/tauri/struct.Builder.html)).

### Forwarding semantics

* Local: bind local listener; each accepted TCP stream opens an SSH direct-tcpip channel to target, then bidirectionally copies bytes.
* Remote: request server-side listener; each forwarded connection opens a local outbound TCP connection. Require explicit server policy/permission and report server refusal distinctly.
* Dynamic: bind local SOCKS5 listener; resolve destination according to explicit profile policy (remote resolution is usually safer for private DNS); reject unsupported commands and unauthenticated clients.
* Port `0` may request an ephemeral local port; return the actual port in runtime status. For fixed ports, bind before declaring `Running`; map `AddrInUse` to a stable conflict error.

### Host keys and credentials

Default to strict known-host verification. Never silently accept a changed key. Support an explicit first-use flow that returns presented fingerprint for user approval, then persists only the approved public key/fingerprint. Avoid `accept-any` except a visibly unsafe development option.

Credential references, not private-key/password material, belong in profiles. Resolve secrets at start from OS credential storage/agent; redact usernames, paths where sensitive, command lines, and all secret-bearing errors. For OpenSSH, pass options as argv (never shell strings), use `BatchMode=yes`, and define identity/config paths explicitly.

### Reconnect and failure policy

Classify failures: configuration/auth/host-key/permission (terminal until edited), local bind/target resolution (retry only where useful), and transport loss (bounded exponential backoff with jitter). On reconnect, tear down old listeners/channels first; avoid two workers racing for the same port. Add `max_attempts`/backoff caps and a manual stop that cancels pending sleeps.

## Option comparison

| Criterion | In-process Rust (recommended) | OpenSSH subprocess |
|---|---|---|
| Cross-platform | One Rust implementation; no binary discovery | Excellent SSH behavior if installed, but packaging/path/agent differences |
| Host keys/auth | Direct policy and structured errors; library API must be audited | Mature OpenSSH config/agent ecosystem; parse exit/stderr carefully |
| Cancellation | Token + task/channel ownership | Kill child/process-tree; platform-specific edge cases |
| Forward types | Direct channels; SOCKS listener is app-owned | `-L/-R/-D` built in |
| Port collision | Structured bind error before Running | `ExitOnForwardFailure` makes initial failure observable ([ssh_config(5)](https://man7.org/linux/man-pages/man5/ssh_config.5.html)); still parse child lifecycle |
| Reconnect | Explicit supervisor and state machine | Restart process; avoid ControlMaster complexity |
| Observability | Counters/events at accept/connect/copy boundaries | Child status plus stderr; less granular |
| Tests | Deterministic in-process fakes + integration SSH server | Requires installed OpenSSH and OS-specific process tests |

OpenSSH can be a fallback adapter for deployments needing OpenSSH-specific algorithms, smartcards, or existing config semantics. If selected, enforce `ExitOnForwardFailure=yes`, bounded keepalives/reconnect supervision, no shell interpolation, and process-group cleanup. Do not rely on `ControlMaster` for the first implementation; multiplexing complicates ownership and stop semantics.

## Security and reliability requirements

1. Bind local forwards to loopback by default; require explicit confirmation for non-loopback binds. For remote forwards, default server bind semantics conservatively and document exposure.
2. Validate target hosts/ports, reject privileged ports where platform policy disallows, cap SOCKS clients/connections, and apply idle/read/write timeouts as appropriate.
3. Enforce per-profile and global limits (active tunnels, accepted channels, bytes/connection) to prevent resource exhaustion.
4. Emit structured, non-secret events: `Starting`, `Running`, `Degraded`, `Stopped`, `Failed`; include reason code, attempt count, actual bind address, timestamps, and byte/channel counters.
5. Add crash/restart recovery: persisted `enabled` profiles may be reconciled at app startup, but require host-key/auth policy checks exactly as manual start.

## Test strategy

* Unit-test profile validation, state transitions, retry backoff, idempotent start/stop, cancellation, redaction, and port-0 reporting.
* Integration-test with a real temporary SSH server/repository fixture: successful local/remote forwarding, host-key mismatch, auth failure, remote forwarding denied, target refusal, reconnect after server drop, and cancellation while connect/copy is blocked.
* Run collision tests with two profiles on one fixed local port and assert one `Running`, one stable conflict result.
* Cross-platform CI: Windows/macOS/Linux for socket binding and process behavior. If OpenSSH adapter exists, gate it behind installed-binary checks and test argv construction without shell execution.

## Implementation recommendation

Phase 1: in-process local forwarding + strict host keys + key/agent auth + lifecycle/status events. Phase 2: remote forwarding. Phase 3: SOCKS5 dynamic forwarding with limits and remote-DNS policy. Keep an `SshTransport` trait to isolate Russh and permit a future OpenSSH adapter.

Rejected for initial implementation: OpenSSH-only control (platform/process complexity); accepting unknown host keys by default (MITM risk); one global SSH session for all profiles (failure coupling and difficult ownership); unbounded auto-reconnect (resource/availability risk).

## Unresolved questions

* Which Rust SSH crate/version is acceptable under project licensing and maintenance policy, and does its current API expose all required global/remote forwarding primitives?
* Which OS credential store/agent integration is required (Windows Credential Manager, macOS Keychain, Linux Secret Service/SSH agent)?
* Should remote forwards bind loopback, wildcard, or server-configured default, and what UX confirmation is required?
* Are Axum and Tauri in one process in production, or does the desktop host proxy to a separate backend process?
