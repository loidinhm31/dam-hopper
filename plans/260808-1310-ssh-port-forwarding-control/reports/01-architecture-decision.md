# Architecture Decision: SSH Forward Execution Boundary

> Superseded by `02-native-ipc-architecture-correction.md` after the user clarified that desktop
> Rust must own the SSH protocol and local listener. Do not implement this server-owned decision.

- **Question:** Should desktop-first SSH port forwarding execute in the Tauri host or on the connected DamHopper server?
- **Kind:** architecture + security
- **Evidence:** `docs/system-architecture.md`, `docs/code-standards.md`, `apps/native/src/main.tsx`, `server/src/port_forward/manager.rs`

## Recommendation

Execute forwards in the authenticated Axum server. Expose the shared React control surface only when the native bootstrap provides `sshPortForwarding: true`. Browser bootstrap defaults the capability off.

## Rationale

- Native is intentionally a remote client and already uses `WsTransport`; a Tauri SSH runtime would duplicate transport, credentials, supervision, and persistence.
- Server already owns SSH credential handling, event broadcast, detected-port/tunnel managers, atomic config writes, and graceful shutdown patterns.
- Native-only visibility is product gating, not authorization. All SSH-forward routes remain authenticated and validate every profile/action.
- The server capability is default-off and server-wide. V1 assumes the repository's existing single-operator trust boundary; untrusted multi-user deployments must keep it disabled.
- Bind and target semantics remain unambiguous only if UI labels them as server-side. `127.0.0.1` binds on the connected server.

## Accepted v1 scope

- Durable, non-secret server-scoped profiles plus ephemeral runtime state, behind a default-off server feature flag.
- Local forwarding only (`server bind -> SSH host -> target`) with loopback-only bind.
- Create/read/update/delete profiles; idempotent start/stop/restart controls.
- Strict known-host verification; explicit fingerprint approval; agent or existing key-reference authentication.
- In-process Rust SSH adapter behind a narrow trait; validate crate API/license in the dependency phase.

## Rejected for v1

- Tauri-owned forwarding: changes the native remote-client boundary and produces laptop-local semantics.
- Remote (`-R`) and dynamic SOCKS (`-D`) forwarding: materially larger exposure and policy surface.
- Arbitrary SSH options, wildcard binds, silent TOFU, persisted passphrases, unbounded reconnect.
- UI-only security claims: authenticated API clients can still call server routes directly.

## Consequence

If the desired endpoint is the desktop machine rather than the connected server, this decision must be revisited before implementation; that is a separate Tauri capability and runtime design.
