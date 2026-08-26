# Architecture Correction: Native IPC Owns SSH Forwarding

- **Decision:** Tauri desktop Rust owns SSH local forwarding end to end.
- **Reason:** Browser/shared transport cannot provide native SSH/raw TCP, safe key handles, or desktop listener lifecycle.
- **Supersedes:** `01-architecture-decision.md`, researcher 01/02 server assumptions, and conflicting key-path/passphrase/keychain advice in researcher 03/04.

## Accepted boundary

```text
Shared React UI -> browser-safe SshForwardHost -> apps/native Tauri adapter
  -> 12-command main-window desktop IPC -> native Rust manager
  -> desktop 127.0.0.1 listener -> SSH direct-tcpip -> remote 127.0.0.1 target
```

- `apps/native/src-tauri` owns SSH, listeners, profile/trust/meta persistence, credentials, ordering, lifecycle, purge, and shutdown.
- `apps/native/src/native-ssh-forward-host.ts` is the only SSH-forwarding frontend Tauri importer.
- Browser/mobile get no host/route/nav/call. Axum/shared query/WS transports get no forwarding change.
- Existing server `port_forward`, PTY detection, `/api/ssh/*`, Git credentials, and WS behavior remain protected/unrelated.

## Ordering and wire decisions

- Stable persisted `desktopInstanceId`; random per-process `managerSessionId`; Rust-issued `clientEpoch`; caller-monotonic `activationToken`.
- Rust strict-parses canonical wire counters to `u64`, compares epoch/token numerically—never lexicographically—and records latest `(clientEpoch,activationToken)` before waits. Tests cross 9/10 and 99/100 for activation/revision/generation; delayed A/B cannot overwrite C.
- New reload client epoch + same scope rehydrates existing listener without stop/start/generation change. Native process restart changes manager session and safely resets memory-only counters/runtime.
- IPC revisions/generations/epochs/tokens are canonical decimal strings on the wire only; Rust `u64`/TypeScript `BigInt` owns numeric comparison. Checked overflow fails closed. Timestamps are RFC3339 UTC with exact milliseconds.
- Event hint carries desktop/manager/client epoch/activation/scope context. Exact identity match is required before numeric freshness can refetch; Rust remains authoritative.

## Exact IPC/ACL decisions

- Twelve commands: open client, activate scope, snapshot, profile create/update/delete, start/stop/restart, key inventory, host approval, inactive scope purge.
- Tauri `AppManifest::commands` activates app ACL. Checked-in `permissions/ssh-forward.toml` allows exactly those names; `ssh-forward-main` capability grants that permission only to `main` on Linux/macOS/Windows.
- Existing main `default.json` grants `core:default`, already including event listen/unlisten/emit. Capabilities merge; SSH feature adds no core permission and makes no false minimal-core claim.
- SSH/agent/native-handle Cargo dependencies are desktop-target gated; Android/iOS trees/handlers contain none.

## V1 policy

- Local forwarding only. Desktop bind and remote target host are exact IPv4 `127.0.0.1`; ports fixed `1..=65535`. No IPv6/wildcard/remote LAN target/port 0.
- Active DamHopper profile hostname + SSH port 22 are create-form defaults only; user reviews/saves. Saved endpoint never follows HTTP URL.
- OS agent preferred. Optional key mode selects opaque safe unencrypted inventory ID opened through contained no-follow handle. Encrypted keys must be loaded in agent. No path/passphrase/keychain/password/subprocess fallback.
- No per-channel idle timeout; max 64 channels/profile. SSH keepalive detects transport loss. Connect/auth 15s, channel open 10s, shutdown 5s.

## Host trust

- Canonical endpoint lookup first: lowercase/trailing-dot-normalized safe ASCII DNS or canonical IPv4 + SSH port.
- Endpoint with no records -> bounded unknown challenge. Approval echoes exact canonical algorithm/fingerprint and persists held full key; explicit subsequent Start required.
- Existing endpoint accepts exact pre-recorded algorithm/full key only. Same algorithm/new key or new algorithm hard-fails without challenge/override.
- Changed trust remediation is a stopped-app signed-executable maintenance mode. It resolves `<Tauri app_config_dir>/ssh-forward/scopes/<scopeHash>/known-hosts.toml`, requires the feature runtime lock exclusively, creates protected contained backup/optional quarantine, removes the exact endpoint, increments revision, and atomically replaces. Recovery verifies opaque backup/checksum/scope/current revision and increments again. Reopen, unknown exact approval, explicit Start; never inject replacement directly.

## Scope retention and shutdown

- Per-scope profiles/trust/meta live under hashed `app_config_dir` directories. Observed `ServerProfile` deletion deactivates then invokes inactive `purge_scope`.
- Unobserved absent scope quarantines 30 continuous days; unavailable browser storage never advances aging. Active/staged scope cannot purge.
- Every profile/trust/meta read/write/backup/quarantine/tombstone/purge uses retained contained no-follow/reparse-safe handles; link/hard-link/component swaps fail closed.
- `WindowEvent::CloseRequested` and `RunEvent::ExitRequested` feed one idempotent bounded shutdown coordinator. It prevents close/exit, rejects new commands, disposes SSH plus existing Browser Debug cleanup, force-closes leftovers, then exits. `RunEvent::Exit` is fallback.
- Runtime updater/relaunch is blocked in v1; `createUpdaterArtifacts` is metadata only. Future enablement must enter this coordinator and pass packaged pre-relaunch listener-closure proof.

## Product/release consequence

- Any local process can use the loopback listener; generic TCP forwarding adds no client authentication. Product owner must explicitly accept this and UI copy before release.
- Automated package build and packaged runtime evidence are separate. Runtime stays manual-pending until named release engineer evidence is hash-bound and security/product reviewers approve.
- Packaged proof must show listener unreachable after Stop, scope switch, and graceful exit on Windows/macOS/Linux.
- The 88h estimate is conditional on Phase 01/platform proofs; a failed mandatory gate or second platform implementation triggers stop/replan/re-estimate.

## Unresolved questions

- Exact SSH crate/crypto/host-algorithm allowlist and Windows agent protocols await dependency gate.
- Named evidence owners/protected environment and final macOS signing/runtime claim await release setup.
