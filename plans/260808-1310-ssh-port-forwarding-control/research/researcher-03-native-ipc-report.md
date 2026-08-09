# Research Report: Desktop-local SSH port-forwarding control

Date: 2026-08-08

> **Supersession note (accepted v1):** The architecture correction and current plan are authoritative.
> This report's suggestions for arbitrary private-key paths, passphrase UI/keychain, IPv6 loopback,
> port `0`, broad remote targets, and its smaller conceptual command list are rejected for v1.
> Accepted v1 uses desktop/remote `127.0.0.1`, fixed ports, remote-loopback target only, OS agent or
> opaque contained unencrypted-key inventory, exact 12-command ACL, and no passphrase/keychain/path IPC.

## Executive summary

Recommended boundary: React shared UI invokes a small Tauri v2 command API; a Rust
`ForwardingManager` owned by `apps/native/src-tauri` owns SSH sessions, local listeners,
and cancellation. Axum remains unaware of forwarding CRUD/lifecycle. Browser and native mobile
receive no forwarding host, route, navigation, invoke/listen, REST, or WebSocket forwarding call.

`russh` is a candidate, not an accepted dependency. Its client API exposes `direct-tcpip`,
public-key authentication, and channel handles, but Phase 01 must pin a crate/crypto backend only
after native agent, cancellation, trust callback, platform, license, and advisory proof.

## Primary sources consulted

- [Tauri v2 calling Rust](https://v2.tauri.app/develop/calling-rust/) — typed commands,
  async command execution, `State`, JSON/camelCase IPC arguments, event limitations.
- [Tauri v2 capabilities](https://v2.tauri.app/security/capabilities/) and
  [permissions](https://v2.tauri.app/security/permissions/) — per-window/platform
  capability boundaries and explicit command permissions.
- [russh client docs](https://docs.rs/russh/latest/russh/client/) — async client,
  `Handle`, channel/tunnel model.
- [russh direct-tcpip source](https://docs.rs/russh/latest/src/russh/client/session.rs.html)
  — `channel_open_direct_tcpip(host, port, originator, originator_port)`.
- [russh crate](https://docs.rs/crate/russh/0.54.6) — direct-tcpip, crypto backend,
  agent/public-key support and cross-platform Rust/Tokio positioning.
- [GitHub host-key guidance](https://docs.github.com/en/authentication/troubleshooting-ssh/error-host-key-verification-failed)
  — mismatch is a security warning; safest action is not to connect without trusted
  confirmation.

## Architecture recommendation

```text
React shared UI -> SshForwardHost -> native TypeScript adapter -> 12 Tauri commands
                                                        -> Rust manager
                                                        -> 127.0.0.1 listener
                                                        -> SSH direct-tcpip
                                                        -> remote 127.0.0.1 service
```

### Narrow IPC surface

The earlier five-command sketch and allocated port `0` are superseded. Accepted v1 registers the
exact 12-command set in the current plan: open client, activate scope, snapshot, profile CRUD,
start/stop/restart, key inventory, exact host approval, and inactive scope purge. Commands return
authoritative snapshots; one low-rate scope/generation-bound event only hints a refetch. Every
command uses exact camelCase DTOs, decimal-string counters, stable errors, fixed bind/target
`127.0.0.1`, and integer ports `1..=65535`. Counter strings are parsed to `u64`/`BigInt` and
compared numerically; lexical comparison is invalid. Event hints include exact client epoch,
activation token, and scope context before they may trigger a refetch.

### Rust state/lifecycle

Manage one `Arc<ForwardingManager>` via Tauri `Builder::manage`; commands receive
`State`. Async commands are appropriate for connect/listen/stop work. Manager holds a
map of instance IDs to cancellation tokens and join handles. Start creates one SSH
session per profile, binds a local listener, then opens `direct-tcpip` per accepted socket.
Stop cancels listener/channels under the bounded disposal path. Main `CloseRequested` and Tauri
`RunEvent::ExitRequested` feed one idempotent 5-second shutdown coordinator shared with Browser
Debug cleanup; `RunEvent::Exit` is last-chance fallback.

Keep CRUD persistence separate from live instances. Every profile/trust/meta read, write, backup,
quarantine, and purge in the native config directory uses retained contained no-follow/reparse-safe
handles, permission-preserving atomic replacement, and adversarial component-swap tests. Never
persist passphrases/private-key material.

## Authentication and trust

- Prefer only Phase 01-proven OS SSH agents: Windows OpenSSH named pipe is minimum;
  Pageant remains conditional; macOS/Linux use proven `SSH_AUTH_SOCK` behavior.
- **Superseded for v1:** do not let the user select a path and do not add passphrase/keychain
  integration. Optional key mode exposes only an opaque ID from native safe unencrypted-key
  inventory and loads it through a contained no-follow handle. Encrypted keys must be in the agent.
- Store host key algorithm, fingerprint, hostname, and port in app known-hosts. First
  connection requires explicit user confirmation of the fingerprint; changed key is a
  hard failure with a remediation flow. Do not disable verification in production.
- Stopped-app repair resolves `<Tauri app_config_dir>/ssh-forward/scopes/<scopeHash>/known-hosts.toml`
  through Tauri (`com.damhopper` under roaming AppData, Application Support, or XDG config), never a
  hardcoded user. A signed narrow mode requires exclusive runtime lock, protected backup/optional
  quarantine, exact endpoint removal, monotonic revision, and atomic recovery before unknown
  approval plus explicit Start. It accepts neither filesystem path nor replacement key.
- Use `russh` crypto feature (`ring` or `aws-lc-rs`); pin and regularly update the
  dependency, and test supported OpenSSH server algorithms.

## Tauri security and platform scope

Create a main-window desktop capability (`platforms: [windows, macOS, linux]`) exposing the exact
application permission. Activate command ACL through `AppManifest::commands`; do not add remote
URLs, shell, general filesystem, HTTP, or opener permission. Browser/mobile get a null host and no
route/navigation/call; there is no Axum fallback.

`createUpdaterArtifacts` is metadata only. Runtime updater/restart/relaunch remains absent until it
uses bounded SSH + Browser Debug disposal and passes packaged listener-closure proof.

Windows, macOS, and Linux are provisional until native matrix proof. Agent discovery,
contained handles, and storage protection are OS-specific; keychain UX is out of v1.
Keep supported credential operations behind a small provider trait/platform adapters.

## Tests and operational limits

- Unit-test profile validation, loopback-only defaults, ID/idempotency, state transitions,
  cancellation, and host-key mismatch handling.
- Integration-test with a real temporary OpenSSH server and real local listener: one
  request/response, concurrent clients, remote refusal, server disconnect, stop during
  connect, and app shutdown. Run on Windows/macOS/Linux CI where possible.
- Test Tauri commands from packaged main webview and denial from unauthorized label/origin;
  browser/native mobile must prove zero forwarding calls.
- Bound active forwards/channels and connect/handshake/shutdown waits. V1 has no application-level
  channel idle timeout; SSH keepalive detects transport loss. Never buffer unbounded data or emit
  per-packet events.

## Recommendation

Proceed only if Phase 01 proves a desktop SSH dependency. Accepted v1 uses OS agent or opaque safe
unencrypted-key inventory, endpoint-first exact host trust, manager-authoritative activation,
remote-loopback-only target, exact ACL/purge, and offline changed-key remediation. No key path,
passphrase, keychain, password, IPv6, arbitrary target, browser/mobile fallback, SOCKS, or remote
forwarding enters v1.

## Unresolved questions

- Which SSH crate/crypto backend, host-key algorithm allowlist, and Windows agent protocols pass Phase 01?
- Which Windows/macOS/Linux combinations pass the packaged runtime evidence gate?
