# Research Report: Native SSH Port-Forwarding Control

> Superseded: its server/Axum ownership recommendation is rejected after user clarification.
> Native Rust/Tauri IPC owns forwarding. See `researcher-04-native-codebase-delta.md` and
> `../reports/02-native-ipc-architecture-correction.md`.

**Date:** 2026-08-08
**Scope:** desktop/Tauri-only first release; shared React UI must remain browser-safe.

## Executive summary

The repository already has a server-side detected-port registry, persistence, events, and a transport abstraction. The least-complex safe design is to add SSH forwarding as a server capability exposed through the existing `Transport.invoke`/WebSocket event path, then gate the shared UI by a runtime capability (`sshPortForwarding`) advertised by the native bootstrap. Do not put forwarding logic in React or expose arbitrary Tauri commands. Tauri should only provide optional OS integration (secure credential prompt/keyring adapter); the Rust server owns validation, process lifecycle, and authorization.

Use two distinct models: durable, non-secret profiles (host/user/ports/key reference/auto-start) and ephemeral runtime forwards (state, PID, error, timestamps). Persist profiles in existing server config/session storage; keep passphrases in the existing OS credential-store pattern (`server/src/ssh.rs`) and memory only while needed. Runtime state is reconstructed on startup and never treated as durable success.

## Repository evidence

- `server/src/port_forward/manager.rs`: in-memory `PortForwardManager`, max 100 entries, `/proc/net/tcp` confirmation, persistence of detected candidates, `port:discovered`/`port:lost`, tunnel cleanup.
- `server/src/api/port_forward.rs` + `server/src/api/router.rs`: protected `GET /api/ports`; no CRUD/control endpoints yet.
- `server/src/api/ws_protocol.rs`: typed push variants for port discovery/loss; `packages/ui/src/hooks/use-ports.ts` already merges detected ports and tunnels and invalidates on reconnect.
- `packages/ui/src/api/transport.ts` and `ws-transport.ts`: channel-to-REST mapping is the shared browser/native seam. Add typed channels here; browser transport can return an explicit unsupported error.
- `apps/native/src/main.tsx`: native uses the same UI with `WsTransport`; capability context already exists for browser-debug (`packages/ui/src/contexts/BrowserDebugHostContext.tsx`, `apps/native/src/native-browser-debug-host.ts`). Extend this pattern, not a second UI.
- `apps/native/src-tauri/src/lib.rs`: Tauri invoke allowlist currently only browser-debug commands. Keep forwarding out of generic invoke; if keyring UX needs native command, add narrowly scoped commands and capability permission.
- `server/src/ssh.rs`: existing `secret-tool`/OS credential-store abstraction, passphrase zeroization, redacted debug behavior. Reuse it.

## Recommended boundary and API

Server owns SSH subprocesses (prefer `ssh -N -L/-R/-D` with argv, no shell), bind validation, cancellation, restart policy, and profile authorization. Native-only availability is a UI/product capability, not a security check; every endpoint remains authenticated and validates local/remote addresses and ports.

Suggested types (camelCase at API boundary):

```ts
type SshForwardProfile = { id: string; name: string; host: string; user?: string;
  port: number; identityRef?: string; forwards: Array<{ direction: "local"|"remote";
  bindHost: string; bindPort: number; targetHost: string; targetPort: number }>;
  autoStart: boolean; };
type SshForwardRuntime = { profileId: string; state: "stopped"|"starting"|"running"|"failed";
  pid?: number; startedAt?: number; error?: string; };
```

Add protected REST routes (and corresponding `Transport` channels):

- `GET/POST /api/ssh/forward-profiles`, `PATCH/DELETE /api/ssh/forward-profiles/{id}` (CRUD; responses never contain secrets).
- `GET /api/ssh/forwards` (profiles plus runtime snapshot).
- `POST /api/ssh/forwards/{profileId}/start`, `/stop`, `/restart` (idempotent start/stop; restart = stop then start with one operation ID).
- Push `ssh-forward:changed` with complete redacted runtime record; clients invalidate/refetch after reconnect. Avoid per-process log streaming initially.

Use explicit error codes (`INVALID_PROFILE`, `AUTH_REQUIRED`, `BIND_DENIED`, `START_FAILED`, `NOT_FOUND`, `CONFLICT`) instead of leaking command stderr or key material. Use optimistic UI only for stop; rollback on failure, matching `use-ports.ts` tunnel behavior.

## Durable vs ephemeral state

Persist only profile metadata and an opaque `identityRef`; never private keys, passphrases, generated command lines, or PIDs. Store profiles in the existing config schema or a small migration-backed table, scoped to workspace/user. On server start, auto-start only profiles marked `autoStart` after validating the referenced credential; report `failed` rather than retrying indefinitely. Runtime records live in the manager and disappear on shutdown. Existing detected-port persistence is a useful precedent but must not be confused with user intent.

## UX and accessibility

Native-only UI section should be hidden/disabled when capability absent; browser users get no SSH control surface and no unsupported network calls. Show a profile list with status badge, Start/Stop, Restart, Edit, Delete; form validates host, identity, direction, bind/target ports before submit. Confirm destructive delete when running (offer stop-and-delete). Distinguish `starting`, `running`, `failed`, and `stopped`; preserve last error with a retry action. Disable duplicate actions while pending and announce state transitions in an `aria-live="polite"` region. Keyboard-operable dialogs, visible focus, labels/error association, and non-color-only status are required. Never display passphrases; “credential saved” is boolean.

## Security and Tauri capability gating

- Use argv-based `Command`; reject shell metacharacters by construction, constrain ports to 1..65535, reject unsafe bind targets by policy (default loopback), and prevent profile IDs/path traversal.
- Do not accept arbitrary `ssh` options from the client. Allow a small typed option set; server applies `BatchMode`, host-key checking policy, connect timeout, and bounded stderr.
- Reuse `SshCredStore` + OS keyring (`server/src/ssh.rs`); zeroize passphrases and redact errors/logs. Do not use `localStorage` or Tauri frontend storage for secrets.
- Tauri 2 capabilities are allowlists; keep any new command in a dedicated capability file scoped to the main window. Official docs: https://v2.tauri.app/security/capabilities/ and https://v2.tauri.app/plugin/shell/ .
- If native keyring integration is required, prefer a narrow command (`ssh_credentials_status`, `ssh_credentials_forget`) over arbitrary shell/plugin permissions. Browser transport must never be able to invoke Tauri directly.

## Start/stop/restart semantics

`start` idempotent when already running; return current runtime. `stop` idempotent when stopped, sends graceful termination then bounded kill. `restart` obtains a fresh runtime generation and emits one final state; stale process events must be ignored by generation/profile ID. On unexpected exit, mark failed and do not auto-restart unless profile explicitly opts in (with capped backoff).

## Tests and release gates

- Rust unit/integration: profile validation, command argv construction, auth/authorization, bind policy, idempotency, generation race, graceful kill timeout, secret redaction, restart recovery; use temporary dirs and fake SSH executable.
- UI Vitest: capability gating, reducer/query cache transitions, pending/error/rollback, no-secret rendering.
- Browser tests: keyboard dialog flow, ARIA announcements, unsupported browser surface absent; native smoke test for invoke capability only if a Tauri command is added.
- Release: `pnpm check`, `pnpm test`, UI browser tests, native build, and a manual matrix (Linux/macOS/Windows; keyring unavailable; bad host key; occupied bind port; server reconnect). Do not claim native support until each platform’s OpenSSH/keyring behavior is verified.

## Questions raised during research (resolved for v1)

1. Direction: local forwarding only; remote/reverse/dynamic remain out of scope.
2. Durability: server-wide non-secret TOML beneath the platform config directory.
3. Visibility: native desktop UI only; authenticated default-off server API remains the authority.
4. Authentication: SSH agent plus one active/saved passphrase-backed inventory credential.

## Official references

- Tauri capabilities: https://v2.tauri.app/security/capabilities/
- Tauri shell/plugin permissions: https://v2.tauri.app/plugin/shell/
- React accessibility guidance: https://react.dev/reference/react-dom/components/common#accessibility
- TanStack Query invalidation: https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation
