# Phase 03: SSH Transport, Credentials, Host Trust, and Error Contract

## Context links

- [Plan](./plan.md)
- [Phase 01 feasibility gates](./phase-01-dependency-platform-gates.md)
- [Phase 02 contracts/storage](./phase-02-native-contracts-persistence.md)
- [Native IPC research](./research/researcher-03-native-ipc-report.md)
- [Architecture correction](./reports/02-native-ipc-architecture-correction.md)
- [System architecture](../../docs/system-architecture.md#ssh-port-forwarding-control-planned-native-desktop-v1)

## Overview

- **Priority:** P1
- **Status:** Pending
- **Effort:** 14h
- **Description:** Implement the pinned desktop SSH client, OS-agent/safe-key/password authentication, endpoint-first multi-algorithm trust, exact fingerprint approval, remote-loopback direct-TCP/IP, and one fixed redacted error table.

## Key Insights

- Trust lookup starts at canonical endpoint. Looking up by offered algorithm first can misclassify an algorithm change as a new host.
- Once any key exists for an endpoint, a new algorithm is a change, not TOFU. Multiple algorithms are accepted only when each exact algorithm/key record already exists.
- V1 has no arbitrary remote target: every SSH channel targets remote `127.0.0.1:<targetPort>`.
- Encrypted key files can be unlocked by the Windows desktop through an ephemeral passphrase IPC
  request; the decrypted key remains in memory only. The Windows lifecycle prompt also supports
  ephemeral username/password SSH authentication for a requested retry. There is no path picker,
  keychain, password persistence, or subprocess `ssh` fallback.
- Long-lived database/debug channels must not be broken by a surprising app idle timer; resource caps and SSH keepalive handle liveness.

## Requirements

### Fixed error code, retryability, and message table

`retryable` means the same command may succeed after transient state changes without weakening policy. Messages below are exact public defaults; no raw suffix/source chain.

| Code | Retryable | Fixed message |
|---|---:|---|
| `INVALID_ARGUMENT` | No | Invalid SSH forwarding request. |
| `UNSUPPORTED_PLATFORM` | No | SSH forwarding requires the desktop app. |
| `IPC_UNAVAILABLE` | Yes | Native SSH forwarding is temporarily unavailable. |
| `DESKTOP_INSTANCE_MISMATCH` | No | This request belongs to another desktop installation. |
| `MANAGER_SESSION_MISMATCH` | Yes | The native runtime restarted; reload forwarding state. |
| `CLIENT_EPOCH_STALE` | Yes | A newer desktop view owns forwarding control. |
| `ACTIVATION_SUPERSEDED` | Yes | A newer server-profile activation replaced this request. |
| `SCOPE_NOT_ACTIVE` | Yes | The requested server-profile scope is not active. |
| `SCOPE_GENERATION_CONFLICT` | Yes | The server-profile scope changed; reload forwarding state. |
| `SCOPE_ACTIVE` | No | Stop and deactivate this scope before purging it. |
| `SCOPE_PURGE_FAILED` | Yes | The inactive forwarding scope could not be removed. |
| `PROFILES_REVISION_CONFLICT` | Yes | Forward profiles changed; review the latest version and retry. |
| `TRUST_REVISION_CONFLICT` | Yes | Trusted host records changed; review and retry. |
| `GENERATION_CONFLICT` | Yes | Forward runtime changed; reload its latest state. |
| `COUNTER_EXHAUSTED` | No | A native forwarding counter is exhausted; reset requires maintenance. |
| `PROFILE_NOT_FOUND` | No | The forward profile no longer exists. |
| `PROFILE_ACTIVE` | No | Stop the forward before editing or deleting it. |
| `PROFILE_LIMIT` | No | This server profile already has the maximum number of forwards. |
| `ACTIVE_FORWARD_LIMIT` | Yes | Stop another forward before starting this one. |
| `AUTO_START_SKIPPED_LIMIT` | Yes | Auto-start was skipped because the active-forward limit was reached. |
| `KEY_NOT_FOUND` | No | The selected key is no longer in the safe key inventory. |
| `KEY_UNSAFE` | No | The selected key file does not meet native safety checks. |
| `KEY_ENCRYPTED_USE_AGENT` | No | Enter the encrypted key passphrase in the Windows desktop prompt to continue. |
| `KEY_PASSPHRASE_INVALID` | No | The passphrase did not unlock the selected SSH key. |
| `AGENT_UNAVAILABLE` | No | Start the OS SSH agent and load an identity before retrying. |
| `HOST_KEY_APPROVAL_REQUIRED` | No | Verify and approve the SSH host fingerprint before starting again. |
| `HOST_KEY_CHANGED` | No | SSH host identity changed. Connection blocked; use stopped-app trust repair. |
| `HOST_KEY_ALGORITHM_CHANGED` | No | SSH host-key algorithm changed. Connection blocked; use stopped-app trust repair. |
| `HOST_KEY_ALGORITHM_UNSUPPORTED` | No | The SSH server offered an unsupported host-key algorithm. |
| `HOST_KEY_CHALLENGE_NOT_FOUND` | Yes | The host-key approval request is no longer current; start again. |
| `HOST_KEY_CHALLENGE_EXPIRED` | Yes | The host-key approval expired; start again to request a new fingerprint. |
| `SSH_CONNECT_TIMEOUT` | Yes | The SSH connection timed out. |
| `SSH_CONNECT_FAILED` | Yes | The SSH server could not be reached. |
| `AUTH_FAILED` | No | SSH authentication failed for the selected method. |
| `LOCAL_PORT_IN_USE` | Yes | The desktop loopback port is already in use. |
| `BIND_FAILED` | Yes | The desktop loopback listener could not start. |
| `CHANNEL_OPEN_TIMEOUT` | Yes | The remote target channel timed out. |
| `TARGET_CONNECT_FAILED` | Yes | The remote loopback target refused the connection. |
| `TARGET_NOT_ALLOWED` | No | V1 forwards only to remote 127.0.0.1. |
| `SHUTDOWN_TIMEOUT` | Yes | Native forwarding exceeded its shutdown grace period. |
| `SHUTDOWN_IN_PROGRESS` | No | The desktop app is shutting down. |
| `STORE_CORRUPT` | No | Native forwarding storage is invalid and requires maintenance. |
| `STORE_IO` | Yes | Native forwarding storage is temporarily unavailable. |
| `INTERNAL` | No | Native SSH forwarding failed safely. |

- Command errors serialize `{code,message,retryable,scopeId?,profileId?,currentProfilesRevision?,currentTrustRevision?,currentScopeGeneration?,currentGeneration?}` with all counters as decimal strings.
- Operational connect/auth/bind/channel errors update runtime `errorCode`; admitted start/restart returns authoritative snapshot. Message/detail cap 512 characters.

### Credential providers

- Agent is default. Support only Phase 01-proven protocols; try at most 64 bounded identities without exporting key material.
- Inventory scans only the desktop SSH directory through trusted root handle: inspect <=256 entries, return <=64 safe private keys, mark encrypted candidates, and ignore symlink/reparse/irregular/public-only/>1MiB/unsafe candidates.
- Inventory returns opaque stable `keyId`, bounded label, algorithm, fingerprint, and encrypted status; no path. At use, resolve current inventory, open root-relative no-follow, verify same regular identity/size, parse from that handle's bytes.
- Encrypted detection returns `KEY_ENCRYPTED_USE_AGENT`; the Windows desktop can then send a bounded passphrase through Tauri IPC, decrypt only in native memory, and retain no passphrase or persisted credential.

### Endpoint-first host trust

- Canonicalize SSH endpoint before profile persistence/trust lookup: trim ASCII whitespace, parse IPv4 to canonical dotted decimal or validate ASCII DNS labels, lowercase DNS, remove all trailing dots, reject Unicode/IDNA input, empty labels, wildcard, bracket, IPv6, control/NUL, and >253 bytes. Port remains `1..=65535`.
- Trust lookup key first is canonical `(sshHost,sshPort)`. Each endpoint stores <=8 records keyed by an allowlisted host-key algorithm and full public key; fingerprint format is canonical `SHA256:<unpadded-base64>`.
- No endpoint records -> unknown challenge. Existing endpoint + offered algorithm + exact full key -> accept. Same algorithm/different key -> `HOST_KEY_CHANGED`. New/unrecorded algorithm at existing endpoint -> `HOST_KEY_ALGORITHM_CHANGED`. Unsupported algorithm -> `HOST_KEY_ALGORITHM_UNSUPPORTED`.
- Multiple algorithms are supported only as pre-existing exact records. IPC TOFU approval can create the first endpoint record only; it never appends a new algorithm to an already-trusted endpoint.
- Unknown challenge is memory-only, 5 minutes, bound to desktop/manager/client/activation/scope/profile/runtime generation, canonical endpoint, full offered key, algorithm, and fingerprint. Snapshot exposes no full key.
- Approval input includes `challengeId`, `algorithm`, exact `fingerprint`, expected runtime generation, and expected trust revision. Rust requires byte-for-byte canonical algorithm/fingerprint match to held challenge before persisting the held full key.
- Unknown failure leaves runtime failed. Repeated Start/Restart while its unexpired challenge exists returns the same snapshot/challenge without generation bump. Stop clears it. Expiry clears it; next Start admits a new generation/challenge. Approval consumes it but never auto-starts; explicit Start admits the next generation.

### Safe changed-key remediation

- No IPC/UI “trust anyway,” replace, delete, bypass, or approval path exists for changed key/algorithm.
- Canonical trust file is `<Tauri app_config_dir>/ssh-forward/scopes/<lowercase sha256(ServerProfile UUID)>/known-hosts.toml`. Resolve the root with `app.path().app_config_dir()`/the same Tauri directories API, never a hardcoded username. With identifier `com.damhopper`, expected roots are `%APPDATA%\com.damhopper` on Windows, `$HOME/Library/Application Support/com.damhopper` on macOS, and `${XDG_CONFIG_HOME:-$HOME/.config}/com.damhopper` on Linux; runtime displays the resolved path and refuses a root that differs from Tauri resolution.
- Ship no trust-edit IPC. A pre-webview maintenance mode of the same signed executable accepts only `--ssh-forward-trust-repair remove-endpoint --scope <uuid> --host <canonical-host> --port <port>` or `restore --scope <uuid> --backup-id <opaque-id>`—never a filesystem path or replacement key. Normal SSH manager holds the feature runtime lock; repair requires it exclusively and refuses while DamHopper is running.
- Removal flow: Stop every forward; quit DamHopper; verify the process and old listeners are gone; verify the expected replacement fingerprint out of band; run the displayed maintenance command. Through retained contained handles, it backs up the whole valid trust document to `ssh-forward/trust-backups/<scopeHash>/<utc>-<fileSha256>.toml`, optionally quarantines removed public endpoint records under `ssh-forward/trust-quarantine/<scopeHash>/<utc>-<endpointHash>.toml`, removes all records for only the exact canonical host/port, checked-increments `trustRevision`, fsyncs, and permission-preserving atomically replaces `known-hosts.toml`.
- Backup/quarantine creation, active-file read/replace, and recovery use the Phase 02 no-follow/symlink/junction/reparse/single-link/descendant checks. Failure before commit leaves the active file unchanged. `restore --backup-id` verifies checksum/scope and unchanged post-repair revision, imports the backed-up records into a newly validated document, increments the current revision again, and atomically replaces; it never rolls revision backward.
- Reopen DamHopper and Start: the endpoint must return an unknown challenge. Compare its exact algorithm/fingerprint with the separately verified value, explicitly approve, then explicitly Start again. Direct insertion/replacement of a new key remains prohibited.
- Exact remediation copy: “Connection blocked because the saved SSH host identity no longer matches. Do not approve it yet. Stop all forwards, quit DamHopper, verify the expected fingerprint with the server administrator, then run the displayed trust-repair command. Reopen DamHopper, start the forward, compare the fingerprint exactly, approve it, then start again.”

### SSH/direct-TCP-IP policy

- One SSH session/profile. Connect+auth timeout 15s; channel open 10s. Session keepalive every 30s; three unanswered keepalives mark transport lost and invoke bounded reconnect.
- Each accepted desktop socket opens `direct-tcpip("127.0.0.1", targetPort, "127.0.0.1", localPort)` and uses backpressured Tokio bidirectional copy.
- Max 64 channels/profile. No application channel idle timeout in v1: channels remain until peer EOF, SSH loss, Stop/scope switch/exit, or cap enforcement. This intentionally supports long-idle databases/debuggers.
- No channel/per-packet event or whole-stream buffering. Reconnect re-verifies host endpoint/key policy.

## Architecture

```text
canonical endpoint (host,port) -> endpoint records?
  none -> bounded unknown challenge -> exact fingerprint approval -> explicit Start
  present + exact algorithm/key -> authenticate
  present + changed key/algorithm -> hard fail -> stopped-app removal -> unknown flow

agent (preferred) OR opaque local key (ephemeral unlock when encrypted) -> SSH session
desktop 127.0.0.1 socket -> direct-tcpip remote 127.0.0.1:targetPort
```

Traits expose only identity/signing, host-key decision, connect/auth, direct-TCP/IP channel, keepalive, close. No shell/SFTP/remote/SOCKS/path methods; password auth is limited to the ephemeral lifecycle retry.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credentials.rs` - agent and opaque safe inventory.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credentials\unix.rs` - Unix handle/agent adapter.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credentials\windows.rs` - Windows reparse-safe handle/agent adapter.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\known_hosts.rs` - canonical endpoint-first trust/challenge/remediation parsing.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\trust_repair.rs` - stopped-app maintenance mode, backup/quarantine, and recovery.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\ssh_client.rs` - pinned SSH/direct-TCP-IP adapter.

### Modify

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\mod.rs` - export transport/credential/trust modules.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` - auth, canonical endpoint, inventory, challenge shapes.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\error.rs` - exact table above.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\store.rs` - endpoint-first trust records/revision validation.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\main.rs` - dispatch signed stopped-app maintenance mode before starting Tauri/webview.

### Delete

- None.

## Implementation Steps

1. Wrap accepted crate behind minimal SSH client/session/channel traits; enforce timeouts, keepalive, close, and fixed errors.
2. Implement proven OS agents and safe inventory contained-handle flow; add swap/encrypted/unsafe/oversize tests.
3. Implement canonical endpoint parser and versioned supported algorithm allowlist from Phase 01 evidence.
4. Implement endpoint-first record matching, exact multi-algorithm behavior, unknown challenge, hard changed key/algorithm failures, and exact fingerprint approval.
5. Implement challenge repeat/expiry/Stop/approval/explicit-restart semantics without duplicate generations or challenges.
6. Implement remote `127.0.0.1`-only direct-TCP/IP and backpressured copy; reject any other target in DTO/TOML defense-in-depth.
7. Implement no-idle-timeout channel lifecycle, 64-channel cap, keepalive loss, and reconnect trust recheck.
8. Implement the stopped-app maintenance mode, Tauri-resolved platform paths, runtime lock, protected backup/quarantine, atomic exact-endpoint removal, revision-monotonic recovery, and exact UI copy.
9. Add tests with real temporary SSH/target: agent/key auth, canonical aliases/trailing dots/case, exact/multiple algorithms, key/algorithm changes, app-running repair refusal, symlink/junction/reparse/hard-link swaps at every trust path component, failed-edit unchanged file, backup recovery, remediation removal then unknown approval, remote non-loopback rejection, long-idle channel, cancellation.

## Todo list

- [ ] Full error/retry/message table mirrored in Rust/TypeScript tests.
- [ ] Agent and contained local-key flows pass supported OSes; encrypted local keys are unlocked only through the Windows desktop Tauri prompt.
- [ ] Endpoint canonicalization/trailing-dot/case tests pass.
- [ ] Multiple exact algorithms work; new algorithm/key hard-fails.
- [ ] Approval matches exact canonical fingerprint and never auto-starts.
- [ ] Stopped-app remediation returns through unknown-key flow only.
- [ ] Platform path display comes from Tauri resolution; backup/quarantine/recovery stay contained and revision-monotonic.
- [ ] Remote target is always `127.0.0.1`; no arbitrary host/IPv6.
- [ ] Long-idle channels survive; keepalive detects dead SSH transport.

## Success Criteria

- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::credentials`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::known_hosts`
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml ssh_forward::ssh_client`
- Rust/TypeScript fixtures match every error code, retryable boolean, and fixed message exactly.
- `Example.COM.` and `example.com` resolve to one trust endpoint; unrecorded algorithm at trusted endpoint never creates challenge.
- Real SSH proves only remote `127.0.0.1:<port>` and long-idle channel remains until explicit lifecycle/network close.

## Risk Assessment

- **Legitimate host rotation:** Conservative hard fail plus offline removal/unknown reapproval; no transparent rotation.
- **Agent variance:** Support only Phase 01-proven protocols and report exact platform scope.
- **Idle resource retention:** 64-channel cap, OS backpressure, keepalive, explicit Stop; no surprising application idle timeout.
- **Canonicalization alias:** Safe ASCII/IPv4-only parser and one canonical persisted representation.

## Security Considerations

- Loopback target policy reduces the desktop into a gateway only to services on the SSH server itself, not its LAN.
- Loopback desktop listener is still usable by other local processes; product acceptance remains a Phase 07 release gate.
- Full host key stays native; IPC gets public fingerprint/algorithm only. Errors/logs omit endpoints, usernames, paths, labels, payload, source chains.
- Offline remediation removes trust through a stopped-app locked helper, keeps protected recoverable backup/quarantine, then re-enters explicit TOFU; it never injects/overrides a replacement key.

## Next steps

- Phase 04 owns manager-authoritative activation and shutdown around these transport/trust seams.
- Phase 06 presents exact error/remediation/idle/loopback policies without raw detail.

### Unresolved Questions

- Exact supported host-key algorithm allowlist and Windows agent protocol list come from the Phase 01 gate.
- Exact packaged executable invocation/path display and file-protection behavior on all three OSes remain gated on Phase 07 evidence; documentation uses runtime-resolved values.
