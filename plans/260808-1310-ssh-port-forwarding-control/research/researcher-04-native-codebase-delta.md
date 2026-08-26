# Native SSH port-forwarding control: codebase delta

Timestamp: 2026-08-08

> **Supersession note (accepted v1):** Architecture correction/current plan override conflicting
> suggestions below. V1 has no keyring/passphrase/arbitrary key path, no local-client authentication
> claim, no IPv6/wildcard/port 0, and no broad remote target. It uses OS agent or opaque contained
> unencrypted-key inventory, exact desktop/remote `127.0.0.1`, fixed ports, 12-command Tauri ACL,
> manager-authoritative activation ordering, explicit inactive scope purge, and offline changed-key remediation.
> Decimal strings are wire encoding only: parse to `u64`/`BigInt` for numeric ordering; event hints
> require exact client epoch/activation/scope identity. Runtime updater/relaunch stays blocked in v1.

## Scope and verdict

The corrected ownership is feasible and fits the existing native architecture:

`React shared UI -> SshForwardHost -> native TypeScript Tauri adapter -> narrow invoke/events -> apps/native/src-tauri Rust -> loopback listener + SSH client`

The current server implementation is the wrong boundary for this feature. It
contains SSH credential APIs/state and PTY-detected port forwarding, but those
must not be reused for native forwarding. Keep server SSH APIs only for existing
server-side Git operations unless the product explicitly removes that feature.

## Existing seams to extend

| Area | Existing evidence | Plan delta |
|---|---|---|
| Native bootstrap | `apps/native/src-tauri/src/lib.rs` registers browser-debug commands and managed controller in `run()` | Add an `ssh_forward` module/controller, managed state, and CRUD/start/stop commands to the same registration path. |
| Native capabilities | `apps/native/src-tauri/capabilities/default.json` grants only `core:default`; browser-debug has a separate capability file | Add only required Tauri event/invoke permissions; do not grant arbitrary shell/network permissions. |
| Native persistence | `src-tauri/src/browser_debug/profile_storage.rs` hashes profile IDs and stores under app data | Add separate hashed SSH-forward scope stores. Every profile/trust/meta read/write/backup/quarantine/purge needs retained no-follow/reparse-safe containment; never persist private key/passphrase. |
| Native UI bridge | `apps/native/src/native-browser-debug-host.ts` uses `invoke`, `listen`, generation checks, lifecycle queue, and typed events | Mirror the relevant pattern in `native-ssh-forward-host.ts`; expose a nullable shared host context so browser/mobile make zero calls, never a no-op host. |
| Shared host context | `packages/ui/src/contexts/BrowserDebugHostContext.tsx` provides `kind: web/native` and host capability | Add an SSH forwarding host context/interface (or generalize only if it avoids churn); shared React must call host methods, never native APIs directly. |
| Native app composition | `apps/native/src/main.tsx` creates `NativeBrowserDebugHost` and provides it | Construct/provide the SSH host alongside browser debug; dispose listeners on app teardown. |
| Server profiles | `packages/ui/src/api/server-config.ts` has `ServerProfile {id,name,url,authType,...}` in localStorage and active-profile helpers | Shared UI derives hostname plus port 22 only as reviewed create-form defaults. HTTP URL never crosses forwarding IPC; saved native endpoint remains editable and independent. |
| Existing server SSH | `server/src/api/ssh.rs`, `server/src/ssh.rs`, router `/api/ssh/*`, `AppState.ssh_creds` | Do not route native forwarding through these. They are server-process Git credential facilities, not a desktop credential boundary. |
| Existing server forwarding | `server/src/api/port_forward.rs` `/api/ports`; `server/src/port_forward/*`; `ws_protocol.rs` port events; PTY manager wiring | Exclude from this design and leave untouched: no new Axum forwarding endpoint/event/state/store and no removal/refactor of existing behavior. |

## Files expected to create/modify

Create:

- `apps/native/src-tauri/src/ssh_forward/mod.rs`, controller/listener/SSH client,
  profile storage, credential adapter, and unit tests.
- `apps/native/src/native-ssh-forward-host.ts` and tests.
- Shared UI SSH-forwarding host contract/context, likely under
  `packages/ui/src/lib/ssh-forward-host.ts` and `packages/ui/src/contexts/`.
- UI panel/dialog and tests under `packages/ui/src/components/organisms/`.

Modify:

- `apps/native/src-tauri/src/lib.rs`, `Cargo.toml`, capability JSON.
- `apps/native/src/main.tsx`.
- Native and UI package scripts only if dedicated Rust/TS smoke tests are added;
  existing `pnpm build:native`, `pnpm lint`, and server `cargo test` remain gates.

Do not modify `packages/ui/src/api/queries.ts`, `ws-transport.ts`, server port forwarding, PTY,
or `/api/ssh/*`; protected-diff tests enforce that boundary.

Tests should cover: loopback-only bind, endpoint/host/port validation, profile
CRUD, active-profile defaulting, explicit endpoint override persistence,
start/stop idempotency, listener teardown, malformed/stale event rejection,
credential redaction, and concurrent lifecycle races.

## Active server profile default

Yes, as create-form defaults only. Parse the active `ServerProfile.url` hostname and prefill SSH
port 22, require user review/save, then persist explicit native `sshHost`/`sshPort`. Later URL edits
or profile switches never rewrite the saved endpoint.

## Security pitfalls

- Bind listener to `127.0.0.1` explicitly; never `0.0.0.0`; accepted v1 rejects IPv6/wildcard.
- Accepted v1 destination host is exact remote `127.0.0.1`; only target port is editable.
- Earlier local-client authentication suggestion is not compatible with transparent generic TCP.
  V1 explicitly accepts that other local processes can use the listener; product approval/UI copy gate release.
- Keep private keys/passphrases out of IPC, React, localStorage, persisted profiles, and errors;
  use the OS SSH agent or approved opaque contained inventory only.
- Verify SSH host keys (known_hosts policy), avoid blind acceptance, and expose
  verification failures.
- Changed-key repair is a stopped-app signed-executable mode resolving the `com.damhopper` Tauri
  app-config root, not a manual arbitrary-path edit: exclusive runtime lock, protected backup/
  quarantine, exact endpoint removal, monotonic atomic recovery, then unknown approval.
- Active forward-profile deletion is rejected until explicit Stop. Observed `ServerProfile`
  deletion deactivates then purges; app exit and scope switch close listeners/channels.
- Cap connections, handshake timeouts, buffered bytes, and event payload sizes;
  avoid blocking the Tauri command thread.

## Old-plan assumptions to delete

Delete any plan steps proposing server-owned SSH protocol, Axum `/api/*`
forwarding CRUD, server WebSocket forwarding events, server-side forwarding
stores, or React calls that bypass the host abstraction. Also delete any design
that treats the existing `/api/ssh/*` credential endpoints as the native
credential store.

## Unresolved questions

- Which SSH crate/crypto backend and OS-agent protocols pass the dependency/platform gate?
- Who owns the packaged evidence, security review, and local-process product acceptance in release configuration?
