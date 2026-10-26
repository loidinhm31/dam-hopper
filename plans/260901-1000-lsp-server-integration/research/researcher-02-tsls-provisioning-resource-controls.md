# Research Report: TSLS provisioning and resource controls

_Research date: 2026-09-01. Scope: pinned Node/TypeScript/TSLS execution under the Rust server; no implementation._

**Historical input; conflicting decisions SUPERSEDED 2026-10-23.** The [current Validation Summary](../plan.md#validation-summary) and [Phase 01 STOP/GO gates](../phase-01-protocol-dependency-real-process-spike.md) govern. Administrator-installed alternatives, unsafe overrides and blocking Windows/native/Android artifacts below are withdrawn. Only bundled Linux x64 engines and web qualify first; startup/ON checks are passive/zero-child, finite initial bounds precede admission, and trusted-workspace result containment is not a child filesystem sandbox.

## Decision summary

Use the accepted architecture: a Rust/Axum supervisor starts a bounded, target-scoped `typescript-language-server` (TSLS) child over stdio. Keep the default tool profile server-owned and pinned; lazy-start it only after an authenticated target attach. The semantic route stays isolated from terminal/filesystem queues, and the core server wins when resources are scarce.

MVP should ship a per-platform tool profile containing an exact Node executable, exact TSLS package tree, exact TypeScript package, lock/integrity data, and a SHA-256 manifest. Build/release obtains this tree offline; runtime never runs npm/pnpm/npx, resolves from `PATH`, downloads, or follows a project-selected package. Invoke the absolute Node path plus the packaged TSLS JavaScript entrypoint with fixed `--stdio` arguments, sanitized environment, and server-derived target root. Probe executable/version/package resolution before marking the profile ready; failure is `missing-tool`/`incompatible`, not fallback to direct `tsserver`.

TSLS's README documents `npm install -g typescript-language-server typescript@6` and `typescript-language-server --stdio`, but that is an install example, not a reproducible release pin [1]. Select one exact Node/TS/TSLS tuple per release, then upgrade the tuple as one compatibility unit. An administrator-managed preinstalled profile may be supported only when its path, version, and digest match the manifest; it is less reproducible than bundling and is not browser-configurable.

## Wrapper versus direct `tsserver`

- TypeScript ships `tsserver` as a Node executable with a custom JSON protocol over stdin/stdout [2]. TSLS is the community-maintained thin LSP interface over TypeScript/VS Code language-feature logic [1].
- Use TSLS for MVP: standard `definition`/`implementation`, LSP lifecycle, LSP cancellation, and capability negotiation avoid a bespoke Rust translation layer.
- Direct `tsserver` is a deliberate later alternative only if TSLS lacks a required feature. It requires translation of custom commands/events, file/project discovery, coordinate conventions, diagnostics suppression, cancellation pipes, and shutdown; it increases test and security surface. Never silently fall back to it.
- TSLS is not Microsoft/VS Code and TypeScript 7's native server may supersede it [1]. Pin and qualify the chosen tuple; do not claim long-term protocol stability from an install command.

## Stdio and child lifecycle

LSP base protocol framing is byte-counted `Content-Length: N\r\n\r\n` followed by exactly N UTF-8 bytes [3]. The owner task must parse partial headers/bodies, multiple messages per read, malformed/oversized lengths, EOF, and child crash. stdout is protocol-only; drain stderr continuously and emit only redacted, bounded diagnostics. WebSocket message boundaries must not be reused as stdio framing.

Use one Tokio owner task per child: bounded command channel in, framed stdout reader and stderr reader out, and one `wait` observer. Sequence `initialize` -> validated capabilities/position encoding -> `initialized` -> requests. `$/cancelRequest` is advisory: send it, but discard any late response by request ID, document version, session generation, and target generation. On teardown stop admission, cancel/drop queued work and overlays, send `shutdown`, await its response, send `exit`, await a bounded grace period, then kill and reap. `kill_on_drop` is a useful last-resort child guard, not proof that descendants/process trees are gone [5]. Never block an Axum executor on stdio or process waits.

Tokio's bounded `mpsc::channel` gives explicit capacity/backpressure [6]. Use it for semantic work and output independently of existing PTY/FS channels. Existing repository supervisor precedent (bounded respawn, backoff, TOCTOU killed state) is reusable [repo-code-standards](../../../docs/code-standards.md); preserve a finite restart budget and explicit `crashed` state.

## Platform policy

| Host | MVP policy and hard-control boundary |
|---|---|
| Linux x64 | Primary release target. Stage the tool profile beside the absolute Rust binary under the existing systemd ownership model; keep user config/workspaces separate. systemd/cgroup can enforce CPU, memory, and task limits; `nice`/`setrlimit` are Unix-specific capabilities, not portable promises [7][8]. |
| Windows x64 | Ship a separate native Node/profile artifact; invoke Node + JS directly, never a package-manager `.cmd` wrapper or shell. Assign the child to a Windows Job Object for hard process-count/memory/CPU controls and use Windows priority APIs; otherwise report controls unavailable and retain app-level bounds [9]. Path/drive/URI normalization needs its own gate. |
| Android | Current accepted native path is shared remote-server transport; Android uses the iframe adapter and must not gain a local semantic sidecar by implication [ADR](../../reports/brainstorm-260901-1000-lsp-server-integration.md). If the Rust server is ever hosted on Android, Node/TSLS executable, child-process, filesystem, battery, and memory behavior require a separate device qualification. Until then return explicit unsupported/missing-tool and keep the browser override from targeting a client device [10]. |

## Controls: portable baseline versus OS hard limits

**Portable/application-enforced (required everywhere):** one process per connection/target initially; global and per-client child caps; max message/document/aggregate-overlay/queue bytes; bounded in-flight requests; initialize/request/shutdown/crash-backoff deadlines; finite restart attempts; idle eviction; lazy start; bounded stderr; explicit overload/timeout/disabled states; cancellation and stale-result drops. Node `--max-old-space-size` can bound V8 old-space but is not an RSS limit [11]. Lower priority is best-effort and must be reported as applied/unavailable.

**Platform-specific hard controls (capability adapter):** Linux cgroup `MemoryMax`/`CPUQuota`/`TasksMax`, rlimits, and nice; Windows Job Object limits and process priority; Android app/system cgroup and OS process policy. RSS and CPU observation likewise need adapters (`/proc`/cgroup on Linux, Windows process/job accounting, device-qualified Android sources). Do not advertise a universal RSS/CPU ceiling; process kill plus measurement is the fallback when a hard control is unavailable. Apply controls before serving requests, and isolate semantic work so terminal, filesystem, build, Git, alerts, and workspace control remain responsive.

## Hot enable/disable

Persist one server-global `enabled` setting. Under a transition lock, OFF first rejects new attach/request work, cancels pending work, notifies clients, gracefully shuts down then force-reaps every semantic child, clears queues/overlays/sessions/backoff, and atomically persists; if persistence fails, restore the prior runtime state where safe. ON validates the pinned profile, persists/applies atomically, publishes enabled-but-idle, and starts no child until an authorized attach. Global OFF release gate: zero semantic children, zero retained overlay bytes, no orphan, and no semantic request accepted without restarting Axum.

## Unsafe browser override (accepted, tightly bounded)

`allowUnsafeLspOverride` must be host-admin configuration unavailable to ordinary browser mutation. Only when true may Settings accept executable/argument values. This is terminal-equivalent arbitrary code execution as the server OS account even with shell=false: a user can select an interpreter, script runner, or hostile executable. Risks include data exfiltration, persistent config abuse, version drift, crash/restart loops, resource exhaustion, and multi-user confused-deputy behavior. It must never silently become a Tauri-local sidecar execution path.

Changing the profile must disable semantics, tear down/reap old children, canonicalize/probe the new command, and persist only after success. Keep target root server-fixed, environment allowlisted/sanitized, no project-file command selection, direct spawn/no shell, bounded resources, actor/time/profile audit, and explicit warning. Default false for shared/remote deployments. Release gate: prove browser cannot enable the host flag, old profile leaves no child, failed probe leaves the prior safe state (or disabled), and audit records contain no command secrets or source text.

## Phased release gates and measurement inputs

1. **Packaging:** offline artifact resolves the manifest tuple and digest on Linux/Windows; version probe, entrypoint probe, and `--stdio` startup pass; no network/package-manager process appears.
2. **Protocol/lifecycle:** fragmented and coalesced framing, malformed/oversized input, initialize capability validation, full-document versions, cancellation/stale drops, shutdown/exit, crash, disconnect, disable, and target invalidation leave no orphan.
3. **Resource:** small/medium/large representative TS/JS fixtures establish server/terminal baseline first. Record child CPU time/peak CPU, RSS/peak RSS, child count, restart count, cold attach-to-ready, warm Definition/Implementation p50/p95, queue wait, timeout/cancel/stale/overload counts, Axum endpoint and terminal output latency during indexing, shutdown/reap duration, and orphan count. Set numeric limits from these measurements, not false precision.
4. **Containment/platform:** auth + exact Origin, target-root/symlink/external-result denial, Windows Job Object evidence, Linux cgroup evidence, and explicit Android unsupported evidence. Telemetry excludes paths, argv, environment, source, stderr, and symbol contents.

## Primary references

[1] TSLS README: https://github.com/typescript-language-server/typescript-language-server/blob/master/README.md  
[2] TypeScript Standalone Server: https://raw.githubusercontent.com/wiki/microsoft/TypeScript/Standalone-Server-%28tsserver%29.md  
[3] LSP 3.17 base protocol/lifecycle: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/  
[4] Node CLI memory flag: https://nodejs.org/api/cli.html#--max-old-space-size-size-in-mib  
[5] Tokio process `Command`/`Child`: https://docs.rs/tokio/latest/tokio/process/struct.Command.html  
[6] Tokio bounded channel: https://docs.rs/tokio/latest/tokio/sync/mpsc/fn.channel.html  
[7] systemd resource control: https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html  
[8] Linux `getrlimit`/`setrlimit`: https://man7.org/linux/man-pages/man2/getrlimit.2.html  
[9] Microsoft Windows Job Objects: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects  
[10] Tauri sidecars and platform packaging: https://v2.tauri.app/develop/sidecar/  
[11] Node V8 heap limit semantics: https://nodejs.org/api/cli.html#--max-old-space-size-size-in-mib

## Unresolved questions

- Exact Node, TypeScript, and TSLS patch versions, artifact signing, and whether every target can carry a bundled Node binary.
- Exact TSLS entrypoint/package resolution contract and required server-owned `workspace/configuration` replies.
- Numeric caps/deadlines/idle/restart thresholds after representative fixture measurements.
- Windows Job Object adapter ownership and the supported Linux non-systemd deployment profile.
- Whether Android server hosting is ever in scope, and if so which Node/child-process/device qualification is acceptable.
- Exact override audit schema and host-admin configuration channel.
