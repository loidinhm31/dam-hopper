# Phase 03 — bundled OMP adapter and installer

## Context links

- [Plan](./plan.md), [phase 02](./phase-02-reporter-transport-and-pty-lifecycle.md), [architecture](../../docs/architecture/agent-status.md); [Phase 03 implementation review](../../reports/code-review-260928-1233-phase-03-bundled-omp-adapter-and-installer.md).
- Evidence: installed OMP 18.3.5 `src/extensibility/shared-events.ts:194-204,244-269`, `extensions/types.ts:852-877,978-994`; OMP `extension-loading.md`.
- Dependencies: v1 contract, live private collector and PTY credentials. No Herdr code/runtime dependency.

## Overview

Date: 2026-09-28. Priority: P2. Status: DONE (2026-09-28; 100%). Implementation: completed. Review: completed (Score: 9.2/10).
Ship a complete first adapter plus explicit safe install/update/status/uninstall, embedded in existing Rust server delivery.

## Key Insights

- `agent_end` contains `messages` and optional `willContinue`; extension notification is emitted after runtime maintenance decisions.
- Current OMP has explicit `auto_retry_start/end`; do not copy Herdr's provider-error regex/2.5-second grace.
- `toolCallId` supports keyed idempotent blocker sets; duplicate callbacks must not strand blocked state.
- `session_shutdown` is bounded best effort. Persistent socket/lease is the independent cleanup mechanism.
- `dam-hopper` binary is privileged Linux release management. Add installation commands to `dam-hopper-server`, before normal boot side effects.

## Requirements

- One standalone managed TS extension; no runtime npm dependency or Herdr installation. Root interactive OMP only.
- Factory dormant without injected URL/token; guard `OMPCODE=1`, non-UI sessions, invalid endpoint and unsupported handshake.
- Keep source API independent of browser UI code. Type-only OMP imports may describe event fields; ensure installed standalone module resolves without project node_modules.
- Event mapping, full snapshots, turn/outcome semantics, heartbeat and bounded reconnect follow architecture.
- Installer explicitly targets absolute OMP agent directory, does not guess active remote/named profile, edit OMP settings, remove Herdr integration or need running server/database.
- Qualification target 18.3.5. Earlier/later releases unsupported until exercised; do not infer compatibility from semantic version ordering alone.

## Architecture

Embed `server/src/agent_status/assets/omp-agent-status.ts` in Rust integration module. Installer writes only `extensions/dam-hopper-agent-status.ts` under explicit target with managed version/hash header. Compilation embeds bytes; no OMP or Bun required for Rust build/package.

CLI: `dam-hopper-server integration omp {install|status|uninstall} --agent-dir <absolute-directory>`. Existing no-subcommand server startup remains unchanged. Dispatch local integration branch before token/config/database/listener creation. Existing running OMP sessions need restart to load newly installed extension.

Adapter state: native session ID, stable reporter instance ID, logical turn ID, keyed approvals/ask blockers, active/retry/compaction flags, pending settle timer and bounded protocol queue. Incoming OMP event handler never waits on remote service/provider/network progress.

## Related code files

Create:
- `server/src/agent_status/assets/omp-agent-status.ts` — standalone adapter source.
- `server/src/agent_status/integration.rs` — bundled asset and safe installer/status/uninstaller.
- `server/tests/omp-agent-status.test.ts` — focused adapter state-machine tests, executed with Bun on the OMP qualification host.
- `server/tests/agent_status_integration.rs` — isolated profile filesystem/CLI behavior tests.
Modify:
- `server/src/main.rs` — optional local integration subcommand and early dispatch.
- `server/src/agent_status/mod.rs` — integration exports.
- `docs/configuration-guide.md` and `docs/README.md` — explicit server-host/profile install, opt-in notifications, unsupported modes.
- `docs/CHANGELOG.md` — update only after successful implementation smoke, not during planning.
Intentionally unchanged: release archive composition (asset is embedded), privileged `server/src/bin/dam-hopper.rs`, OMP profile configs, global Node/Bun packages.

## Implementation Steps

1. Verify OMP event payloads and Bun authenticated WebSocket behavior in isolated installed runtime; pin observed version in evidence. Do not send a provider request merely to inspect help/types.
2. Implement root guard and session activation; derive opaque native ID, never session file path. First/reconnect reports are snapshots, not start/end.
3. Implement keyed approval/ask lifecycle, session reset, continuation/retry/compaction state, explicit stop-reason classification and 250-ms cancellable settle debounce.
4. Treat stop/aborted/error distinctly; unknown/length/toolUse cannot emit normal completion without documented evidence. Track normal logical turn across automatic starts/continuations. Late duplicate ends and retry resolution cannot emit twice.
5. Implement one reporter WebSocket, handshake/ack parsing, state heartbeats, bounded transport backoff and queue. On reconnect send current snapshot only, not old turn-ended notifications. Clear/close on shutdown/reload.
6. Implement install/status/uninstall in temporary profile dirs first: managed content hashing, same-directory atomic write, refuse symlink/nonregular/modified/unmanaged target, never mutate unrelated files. Upgrade by repeating install.
7. Add early CLI dispatch; prove no auth token, database, workspace requirement or listener during installer invocation. Document install as OMP's actual OS user on server host.
8. Build/package existing server binary and run installer from that artifact with an empty test profile; extension must be usable without repository-relative imports or separate deploy assets.

## Todo list

- [x] Implement complete OMP event adapter and privacy-safe outcome mapping.
- [x] Implement ordered, bounded reporter connection and shutdown/reload handling.
- [x] Embed asset and add safe explicit profile installer commands.
- [x] Validate outside-host/nested/headless no-op, session switch and retry semantics.
- [x] Validate packaged install/update/uninstall without unrelated file changes.

## Success Criteria

C01–C08, C13–C15 and C18 pass. Plain `omp` in configured managed terminal reports after install; same extension outside dam-hopper does not connect. Nested OMP cannot alter root status. Package contains everything needed to install adapter; server build itself needs neither OMP nor Bun. Interrupted/error outcomes never look successful.

## Risk Assessment

Runtime event ordering and extension reload behavior require real OMP evidence; synthetic handlers alone cannot qualify release. The 2026-09-28 implementation review recorded two high-priority findings: inactive late `agent_end` can emit duplicate `turn-ended` reports, and CRLF line endings can misclassify a managed extension as modified during update. These remain open and must be dispositioned before full end-to-end qualification. Explicit target avoids erroneous installation into a browser user's or service-manager's profile. Installation must refuse destructive overwrite, not hide it behind a force default.

## Security Considerations

Never send prompt/question/error/session-path text. Validate exact loopback endpoint and prohibit redirects/URL credentials before sending token. No dependency on third-party network or install scripts. If any Herdr source is copied rather than independently implemented, retain Apache-2.0 license/notices and mark modifications before packaging; default is independent implementation of verified event semantics.

## Next steps

Phase 04 connects real statuses to UI; phase 05 qualifies whole flow against real OMP. Source compatibility surprises update architecture before rollout, not a heuristic success fallback.
