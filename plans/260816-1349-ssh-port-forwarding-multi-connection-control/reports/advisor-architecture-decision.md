# Architecture decision: established SSH connections own forwarding

## Brief

- **Question:** How should Windows SSH forwarding reuse authentication across many ports and servers while preserving current trust, scope, stale-client, and secret-handling boundaries?
- **Kind:** security + architecture
- **Evidence:**
  - `apps/native/src-tauri/src/ssh_forward/manager.rs`
  - `apps/native/src-tauri/src/ssh_forward/ssh_client.rs`
  - `packages/ui/src/lib/ssh-forward-host.ts`
  - `packages/ui/src/hooks/use-ssh-forward-page-controller.ts`

## Decision

Use a native, active-scope connection registry. Persist credential-free connection profiles and forwarding rules separately. A connection profile identifies endpoint, SSH user, and auth mode/key reference; the existing endpoint-first trust store remains the sole durable host-key authority. An established connection runtime owns one reusable `SshSession`, a memory lease, and multiple forwarding children. Passwords and encrypted-key passphrases are saved for 30 days in Windows Credential Manager after successful authentication.

Forward enable/disable requires the connection profile ID plus current connection generation. Native code rejects absent, stale, non-established, or wrong-scope connections before opening a listener. Port operations never accept credential material and never trigger authentication UI.

Keep the existing one-active-DamHopper-scope boundary. Support many SSH server connections inside that active scope. Scope switch, client/session invalidation, app shutdown, or explicit disconnect closes child listeners, SSH sessions, and memory leases while retaining the unexpired vault entry. Scope purge deletes it.

## Credential boundary

- Reuse the authenticated transport for port toggles; no credential lookup needed.
- Save only a successfully authenticated password or encrypted-key passphrase in Windows Credential Manager with a fixed 30-day `expiresAt`; silent use does not extend it.
- Bind the opaque vault target to app + scope + connection profile + endpoint + user + auth identity. Keep trust separate so a host-key change retains the credential but blocks its use until explicit repair/approval.
- Disconnect, scope switch, trust change, manager shutdown, and app exit clear live memory but retain the vault entry. Forget, profile delete, scope purge, successful replacement, or expiry owns vault mutation/deletion.
- Never persist decrypted private keys. Never put a secret or vault target in TOML, snapshots, events, logs, diagnostics, or browser storage.
- On terminal auth failure, quarantine automatic reuse and require replacement/explicit action; do not loop the rejected credential.

## Alternatives rejected

- **Keep one SSH session per forwarding profile:** low code churn but repeats authentication and fails efficient multi-port reuse.
- **App-encrypted/DPAPI side file:** duplicates secure-storage and filesystem lifecycle logic; reject in favor of Windows Credential Manager.
- **Allow registry entries across inactive DamHopper scopes:** increases lifecycle and identity complexity; many target servers already fit inside one active scope.

## Required safeguards

- Preserve endpoint-first host-key verification and explicit approval before establishment.
- Verify/approve host trust before sending a retrieved vault secret; vault persistence never bypasses trust.
- Expose safe `saved`/`expiresAt`/`rejected` metadata plus explicit Forget; reads at/after expiry return nothing and trigger deletion.
- Use numeric wire counters and expected connection/forward generations for stale-operation rejection.
- Serialize transport lifecycle per connection; isolate port failures from sibling ports.
- Keep loopback-only binds/targets and bounded connection, forward, handshake, and channel limits.
- Test prompt count, identity isolation, reconnect, concurrent toggles, teardown, secret absence, migration, and packaged Windows listener cleanup.

## Unresolved Questions

None. Product selected 30-day Windows vault persistence. Target caps remain 16 established connections, 64 enabled rules, and four concurrent handshakes.
