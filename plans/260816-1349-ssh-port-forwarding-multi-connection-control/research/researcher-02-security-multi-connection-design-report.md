# SSH Multi-Connection / Forwarding Security Design

> Product decision update (2026-08-16): the earlier memory-only recommendation below is superseded by the revised architecture decision. Successful Windows passwords/passphrases must use fixed 30-day Windows Credential Manager persistence; host trust remains a separate blocking gate.

## Current architecture evidence

- The native host already has a scope activation token, desktop/session context, monotonically increasing revisions, per-profile runtime generation, and snapshot validation. Preserve these as the anti-stale-client boundary.
- A profile currently identifies one SSH endpoint plus one local port; `start`/`restart` accept an optional credential attempt ID, while `loadKey` and `loadPassword` are separate commands. Runtime states already include `starting`, `running`, `reconnecting`, `stopping`, and `failed`.
- Host-key challenges are explicit, expiring, fingerprinted records. Approval must remain a prerequisite to authentication/forwarding; never add an “accept any” path.
- UI currently blocks edit/delete while a forward is active and describes credentials as memory-only. This is a good security default but does not yet model a reusable authenticated connection shared by multiple ports.

## Recommended lifecycle

Model a connection independently from a forwarding rule:

`disconnected -> authenticating -> established -> degraded/reconnecting -> disconnected`.

Each connection is keyed by a canonical tuple `(scopeId, sshHost, sshPort, sshUser, hostKey identity, auth identity)`. Do not key by profile ID or local port. A profile references one connection key and a target port; several profiles may share one established SSH transport.

Connection establishment is an explicit user action (or an explicitly enabled auto-connect). The first attempt may show the existing host-key approval and passphrase/password dialogs. On success, retain the authenticated SSH client/session in the native manager and issue an opaque `connectionId`; subsequent `open/close forwarding` commands accept only that ID and never credentials. Reject unknown, expired, disconnected, or scope-mismatched IDs server/native-side, not only in UI.

Port toggles should be serialized per connection and deduplicated by `(connectionId, local bind, target)`. Use an operation token/generation so an old stop cannot close a newer start. Each forwarding item reports `off | opening | on | closing | failed`; a failed port must not tear down healthy sibling ports. Local bind remains loopback-only (`127.0.0.1`) and port conflicts are reported without exposing a listener.

When the transport drops, mark the connection degraded, stop/close child channels, and reconnect according to the existing bounded policy. Re-establishing the transport may reuse the in-memory credential material only while its session lease is valid; otherwise transition to `authenticating` and require the user again. Never silently fall back from key/passphrase to password or vice versa. A user “disconnect” must zeroize credential buffers where feasible, close all channels, invalidate the opaque ID, and make all later toggle requests fail closed.

## Credential and trust boundaries

- Keep private-key passphrases and passwords native-side, in memory only, scoped to one connection attempt/session. Do not add them to profiles, snapshots, events, logs, URL state, or browser storage.
- Reuse is allowed only for the exact canonical connection identity and current native manager session. Same host with another username, SSH port, key, or host-key fingerprint must require a new authentication decision.
- If persistent “remember credential” becomes necessary, use an OS credential vault (Windows Credential Manager/DPAPI-backed abstraction), opt-in and per identity; do not invent encrypted files. The initial feature should omit persistence (YAGNI).
- Store/compare host keys by canonical host + SSH port and algorithm/fingerprint. Changed key or algorithm remains a blocking challenge; expiry of a challenge invalidates approval attempts.
- Redact usernames only as appropriate, but never include passwords, passphrases, private-key content, or raw command lines in telemetry/errors.

## API and state shape

Add connection-oriented operations alongside existing profile APIs: `establishConnection(profile/auth context)`, `disconnectConnection(connectionId)`, `listConnections()`, and `setForwarding(connectionId, forwardingId, enabled)`. Return snapshots containing connection status and opaque IDs, plus forwarding status. Keep profile CRUD separate from runtime state. Include context/session/activation token and revisions on every response, as current validators do.

Prefer a native manager-owned map keyed by connection identity, with reference-counted forwarding children. The UI may cache a snapshot but native validation is authoritative. Do not return credential state; return only `authMethod`, `lastEstablishedAt`, `expiresAt` (if applicable), and safe failure codes such as `CONNECTION_REQUIRED`, `AUTH_REQUIRED`, `HOST_KEY_REVIEW_REQUIRED`, `PORT_CONFLICT`, `CONNECTION_EXPIRED`.

## Windows considerations

Bind explicitly to `127.0.0.1`; validate ports as integers 1–65535 and handle Windows `WSAEADDRINUSE`/permission failures as stable error codes. Ensure child listeners and SSH processes/sessions are closed on app shutdown, scope purge, client epoch change, and manager-session change. Avoid shelling out with interpolated credentials; use the existing native SSH library/process boundary and pass arguments structurally. If a native process is used, ensure hidden window/no inherited console and kill-tree cleanup.

## Tests / failure cases

- Establish once, toggle multiple ports without another prompt; wrong/unknown connection ID is rejected natively.
- Two profiles sharing a connection use one authenticated transport; disconnect tears down both; one port failure leaves the other on.
- Same host but different user/key/SSH port does not reuse credentials.
- Host-key challenge approval required, challenge expiry/changed fingerprint blocks forwarding.
- Concurrent start/stop/start ordering cannot resurrect stale listeners; duplicate enable is idempotent.
- Password/passphrase never appears in snapshots, events, logs, persisted profile TOML, or browser state.
- Scope/session/client epoch changes invalidate connection IDs and close listeners.
- Windows local-port conflict, shutdown, reconnect exhaustion, and credential expiry produce deterministic states and cleanup.

## Options and recommendation

1. **Per-profile SSH session (minimal change):** easiest implementation, but does not satisfy many ports/many servers efficiently and still couples authentication prompts to rules.
2. **Shared native connection registry (recommended):** explicit establish/disconnect plus reference-counted forwarding children; strongest reuse and clear fail-closed boundary, moderate API/UI work.
3. **Persistent SSH profiles with vault-backed credentials:** best convenience for repeated launches, but adds OS-vault abstraction, expiry/revocation UX, and migration/security burden. Defer until option 2 is proven.

Recommend option 2. Keep credentials memory-only initially, reuse only inside exact identity + active manager session, and make every forwarding toggle require a native-validated established `connectionId`.

## Unresolved Questions

- Does the current Rust SSH manager expose a reusable multiplexed client/session, or must the first iteration maintain one transport per connection identity?
- Should a reconnect after transport loss be allowed to use cached in-memory credentials automatically, or always require explicit user confirmation?
- Is local-port ownership intended per profile or shareable across profiles (likely reject duplicate binds)?
