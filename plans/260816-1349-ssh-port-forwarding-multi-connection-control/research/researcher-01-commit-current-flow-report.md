# SSH forwarding history/current-flow research

## History

- `5b0195a` introduced the native Windows-oriented SSH forwarding surface: Tauri IPC, Rust `SshForwardManager`, persisted scopes/profiles/trust, local loopback listeners, SSH `direct-tcpip`, and UI host/adapter. The manager is intentionally single-active-scope (`active_scope`) and stores runtime entries by `profile_id`.
- `1db0216` added the desktop control surface around that native contract (profile cards/dialog, start/stop/restart, trust and credential UI).
- `3fa7b226` (Git resolves this to `3fa7b22`) completed Windows forwarding/credential UX. It added `load_key`/`load_password` IPC, Windows credential storage plumbing, encrypted-key inventory, retry attempt IDs, native manager credential caches, Windows packaging gates, and extensive UI/native tests. It also made auto-start concurrent (four handshake permits) while retaining an `ACTIVE_FORWARD_LIMIT` of 16.
- `e3cad6c8` only closes/re-scopes the documentation/release plan to Windows-only; it does not change forwarding behavior. `docs/project-roadmap.md`, `docs/CHANGELOG.md`, and `plans/260808-1310-ssh-port-forwarding-control/*` explicitly defer broader authentication/product scope.
- Current `HEAD` is merge `91fbce5`; no later forwarding implementation commit follows `3fa7b22` in the inspected ancestry. Relevant original design remains in `5b0195a`.

## Current flow and gaps

1. `NativeSshForwardHost.openClient()` (`apps/native/src/native-ssh-forward-host.ts:401`) opens a desktop context; `activateScope()` (`:434`) selects one persisted scope. Rust `SshForwardManager::activate_scope` stops all workers when switching scope, clears runtimes, loads profiles/trust, then `auto_start_scope` starts `auto_start` profiles.
2. UI `use-ssh-forward-page-controller.ts` starts a profile first. Failure codes (`AGENT_UNAVAILABLE`, `KEY_ENCRYPTED_USE_AGENT`, `AUTH_FAILED`) trigger `requestPassphrase`; the dialog then calls `loadKey` or `loadPassword`, followed by `start`/`restart`. Thus authentication is currently coupled to starting an individual forward, not an explicit target-server connection establishment.
3. Rust manager fields `loaded_keys` and `loaded_passwords` (`manager.rs:213-214`) are keyed by `(scope_id, profile_id)`, not by SSH target/session. `load_password` (`:1307`) caches only a credential attempt; `start_inner` consumes it via `take_loaded_password` and `run_profile` creates an `SshSession`. `LoadedPasswordCleanup` removes the secret when the worker ends. A successful SSH worker therefore does not expose a reusable authenticated connection object to sibling ports/profiles.
4. `run_profile` (`manager.rs:1568`) establishes one SSH session per profile and forwards that profile's one configured local/remote port. Reconnect repeats authentication/credential selection. `ssh_client.rs` accepts optional loaded credentials but no manager-level authenticated-session registry.
5. Port controls are profile lifecycle controls (`SshForwardHost.start/stop/restart`), with optimistic generation checks. `auto_start_scope` (`manager.rs:1862`) only starts profiles marked `auto_start`; it reserves deterministic candidates and skips beyond `ACTIVE_FORWARD_LIMIT=16`. This is useful fan-out but is not “known established connections only”: auto-start can attempt unknown/unestablished targets and may prompt/fail independently.
6. Scope activation is the main multi-server limitation: `active_scope: Mutex<Option<ActiveScope>>`, `stop_all_workers()`, and one runtime map mean only one scope is active at once. Even within a scope, credentials and SSH sessions are profile-scoped, so multiple ports to the same server cannot share one authenticated transport.

## Security/reliability implications for the requested enhancement

- Do not persist plaintext passwords in the profile store. Existing `Zeroizing` cleanup and `dispose/force_close` clearing are useful boundaries, but a reusable connection/session registry needs explicit TTL, disconnect, scope/client-epoch invalidation, and zeroization rules.
- “Known established connection” should be a native runtime fact (authenticated session state plus target identity/trust generation), not merely a saved profile or `auto_start` flag. Opening a port should reject unknown/disconnected connection IDs before any credential prompt.
- Preserve host-key challenge/approval binding (`approve_host`) and generation/context checks when introducing connection IDs; a credential must never be reused across target, user, key, scope, or trust revision.
- Existing limits/tests cover 16 auto-start entries and four concurrent handshakes (`manager.rs` tests around `partition_auto_start_candidates` and handshake semaphore), but there are no tests proving session reuse, many ports sharing one SSH connection, connection teardown, or “no prompt after establish.”

## Suggested plan boundaries

- Add a first-class target connection model/state (target endpoint + username/auth identity + trust state + authenticated/failed/disconnected lifecycle), separate from port profiles.
- Add establish/disconnect/reconnect commands that perform the existing key-passphrase or username/password prompt once and retain only an in-memory authenticated session/credential handle.
- Change port start/stop to require a known established connection ID; make per-port enable/disable cheap and independent while sharing the connection transport where supported.
- Replace single active scope assumptions with a connection registry keyed by stable connection ID, while retaining bounded handshake/channel concurrency and deterministic snapshots/events for many servers.
- Extend native/UI contracts and tests first around credential prompt count, session reuse, cross-target isolation, connection loss, shutdown clearing, and many-connection/port fan-out. Keep Windows-only constraints unless a separate platform plan is approved.

## Unresolved Questions

- Should one connection permit multiple independent `direct-tcpip` channels, or must each server connection still own one SSH session worker with multiplexed channels?
- Is “save credential” intended only for process-lifetime memory, or should Windows Credential Manager/keychain-backed persistence be added (a security review is required)?
- Can one UI scope contain many server targets, or should scopes remain profile groups while the new connection registry spans scopes?
- What user-visible action establishes a connection before selecting ports, and how should host-key approval be sequenced?
