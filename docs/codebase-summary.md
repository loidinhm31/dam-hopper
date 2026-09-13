# DamHopper Codebase Summary

**Generated:** 2026-09-13 from `repomix-output.xml` (Repomix v1.18.0; 1,847
files, 4,058,705 tokens, 16,750,620 characters; five security-flagged files
excluded).
The compaction is a read-only analysis aid; source files and focused tests are
authoritative. Binary files, ignored files, and files excluded by Repomix
security scanning are not represented in full.

## Repository shape

- `server/` — Rust/Axum backend, workspace/file APIs, PTY management, workflow
  persistence, telemetry, idle suspend, Linux release management, and tests.
- `apps/web/` — browser Vite host.
- `apps/native/` — Tauri host, native capability bridges, and platform smoke
  scripts.
- `apps/browser-extension/` — optional browser-extension host.
- `packages/ui/` — shared React components, stores, API/WS clients, terminal
  surfaces, and browser tests.
- `packages/shared/` — dependency-light shared runtime utilities, including
  logger and redaction helpers.
- `deploy/` — release scripts, systemd templates, installer assets, and role
  staging support.
- `plans/` — feature plans, research, phase records, and verification reports.
- `docs/` — operator, API, architecture, standards, and product-requirement
  documentation.

## Backend boundaries

`server/src/main.rs` starts the HTTP/WebSocket service and assembles `AppState`.
The router exposes authenticated project, filesystem, PTY, Git, workflow,
browser-debug, host-resource, and idle-suspend surfaces. Shared state owns
configuration, project sandboxes, PTY sessions, event sinks, media tickets,
workflow services, and feature-specific managers. Root-sensitive filesystem
operations resolve through project/target sandbox validation rather than a
request-provided working directory.

The PTY subsystem creates and restores isolated sessions, streams output over
WebSocket, retains bounded scrollback, and coordinates resize, attach, write,
kill, restart, and disposal lifecycle. PTY activity evidence is private and
content-free; terminal bytes, commands, arguments, and environment are not
used as idle-suspend identity.

The workflow subsystem persists Plan/Phase/Task hierarchy, scoped sessions,
resource links, notes, and bounded events in SQLite. The telemetry subsystem is
separate and opt-in, with private SQLite storage and bounded aggregate queries.
Media tickets and browser-debug artifacts use authenticated, scoped, expiring
capabilities rather than project-path access.

## Terminal idle suspend

`server/src/idle_suspend/` is the server-authoritative suspend boundary:

| Module | Responsibility |
| --- | --- |
| `policy.rs` | Startup-owned automatic policy and bounded timing configuration. |
| `protocol.rs` | Version-1 helper frames, request IDs, wake validation, and REST DTOs. |
| `coordinator.rs` | Single-flight automatic/manual state machine, semantic event emission, and reconciliation. |
| `status.rs` | Private measurement/status DTOs and warning projection. |
| `server_audit.rs` | Legacy untagged timing/manual audit JSONL. |
| `audit.rs` | In-place helper audit v2 records, typed milestones/codes, producer identity/sequence, and legacy-compatible reader. |
| `backend.rs`, `executor.rs` | RTC and fixed suspend execution seams. |
| `preflight.rs`, `peer_auth.rs` | Inhibitor, capability, RTC, and peer checks. |
| `helper_client.rs`, `helper_server.rs` | Unix-socket client and root helper service. |
| `event.rs` | Canonical semantic event model, identity/correlation validation, and synchronized writer. |
| `tests.rs` | Focused policy, protocol, audit, helper, event, and coordinator behavior tests. |

The configured-agent policy consumes private PTY, bounded process-discovery,
and owned TCP observation seams. Later sampler/admission and status/UI layers
remain distinct from the suspend helper and cannot grant host power authority.

### Phase 02 canonical event foundation

`event.rs` implements the producer foundation for the production diagnostics
contract:

- `IdleSuspendEventEnvelopeV1` is a camelCase, deny-unknown-fields envelope
  with `eventSchemaVersion = 1`, 14 closed event types, typed payload variants,
  and 26 closed reason codes.
- `ProducerIdentity::load` validates the canonical boot UUID from
  `/proc/sys/kernel/random/boot_id` and creates one UUID v4
  `producerInstanceId`; deterministic tests use injected IDs and paths.
- `ActionCorrelationId` accepts only canonical lowercase UUID v4 values and
  checks compatibility with protocol-v1 request IDs.
- `IdleSuspendEventWriter` starts `producerSequence` at one per producer and
  reserves checked non-wrapping sequences under one mutex. Serialization or
  file I/O failures consume the sequence, making later gaps observable;
  overflow permanently disables the writer.
- The fixed event path is
  `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`.
  The writer refuses unsafe parent/target metadata, writes bounded JSONL to a
  regular mode-`0600` file with no-follow flags, and calls `sync_data()` before
  success. It does not provision or repair the parent.

### Phase 03 coordinator instrumentation and restart-safe IDs

`AppState::new` derives the event path from the diagnostics log parent and
stores one optional `Arc<IdleSuspendEventWriter>`. Initialization failure is
recorded as a sanitized backend diagnostic and does not stop the server;
missing writer evidence makes later collection partial. Coordinator startup
passes that shared writer through `start_with_sink` into `run_coordinator`.

`run_coordinator` emits `coordinatorStarted` once per producer process and
keeps one `AttemptContext` for each automatic or manual attempt. The context
allocates a UUID v4 before `attemptStarted` and carries mode, fleet/activity/
timing/status revisions, generation, and wake value through the lifecycle.
That exact UUID is reused for attempt event `correlationId`, the helper
protocol-v1 `requestId`, accepted manual responses, and legacy manual audit
records. Epochs and revisions are evidence only; a new process receives a
new producer identity and cannot reuse an earlier action correlation.

Automatic empty-fleet and agent-activity paths emit typed arm, final-check,
handoff, dispatch, terminal-rejection, outcome, and reconciliation events.
Agent measurement emits process-wide unavailable/recovered events only when
availability changes, not for each scheduled sample. Manual admission records
accepted and rejected/conflict/capability/shutdown paths with the same UUID
rules. Semantic write failures are warning-only and never replace a real
suspend outcome or prevent handoff release; existing pre-action server audit
failure remains fail-closed.

Phase 03 coordinator tests cover seven deterministic event scenarios, while
the public `server/tests/idle_suspend.rs` suite covers 19 integration tests.
Phase 04 adds helper audit compatibility, sequence-gap, secure-pruning, and
milestone ordering coverage; the full focused `idle_suspend::` unit filter
passed 172 tests, including 23 focused helper tests. Fixtures use temporary
trusted paths and fake executors; no host suspend or RTC mutation is exercised.

Phases 05–07 still own the read-only helper-v2 collector, fixed-source
projection/redaction, atomic bundle output, mixed-version completeness, and
rollout. These future components are not implied by the Phase 02–04 server
producers.

## Linux release and deployment

`server/src/linux_release/` owns manifest validation, role projection, unit
staging, systemd lifecycle, health, rollback, recovery, and release evidence.
Systemd templates define API, helper, web, and recovery services. The API
runtime identity is taken from the finalized unit's `User=`/`Group=` pair;
release tooling refuses unsafe path ownership or symlink substitutions rather
than repairing them. The helper remains root-owned and uses a restricted Unix
socket with peer credentials.

## Frontend architecture

The shared UI package provides shell/layout, project/worktree targeting,
explorer, editor, Git, workflow, terminal, host-resource, settings, and
browser-debug components. Browser and native hosts supply transport/auth
bootstrapping while preserving shared DTO validation. React Query and Zustand
state is scoped by server profile, project, and target where applicable.
Terminal notification, touch scrolling, media, and workflow features remain
separate from idle-suspend execution authority.

## Security and data handling

Authentication, CSRF/same-origin checks, project sandbox containment, fixed
allowlisted commands, no-follow filesystem operations, bounded request/output
sizes, and sanitized error types are enforced at backend boundaries. Durable
logs omit credentials, tokens, terminal content, commands, environment, and
raw IPC. Diagnostic evidence is intended to remain local and privacy-projected;
future collection must not infer authority from latest probes or terminal text.

## Verification map

- Rust unit/integration tests live beside backend modules and under
  `server/tests/`; focused fixtures use temporary files, fake clocks, fake
  helpers/backends, and deterministic identities.
- Frontend unit tests live beside components/stores; browser tests live under
  `packages/ui/browser-tests/` and exercise actual rendered behavior.
- Linux release and target-host smoke scripts are under `server/tests/deploy/`
  and `deploy/`; real RTC/suspend canaries remain explicit host-owner gates.
- Phase 02–03 event behavior is covered by schema/serde, validation, identity,
  path safety, size bounds, sequence gaps/overflow, protocol-compatible
  correlation, synchronization, legacy-audit compatibility, coordinator
  lifecycle ordering, measurement transition suppression, and restart-safe
  producer/action IDs.

## Documentation map

- [System Architecture](./system-architecture.md) — live data flow and
  security boundaries, including Phase 02–03 diagnostics integration.
- [Code Standards](./code-standards.md) — Rust/TypeScript patterns,
  canonical writer, and coordinator lifecycle rules.
- [Project Overview PDR](./project-overview-pdr.md) — product requirements and
  phase acceptance criteria.
- [Configuration Guide](./configuration-guide.md) — configuration and runtime
  setup.
- [API Reference](./api-reference.md) — REST and WebSocket contracts.
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md) —
  suspend/helper threat model and fail-closed rules.

**Maintenance note:** Regenerate this summary after substantial module or
architecture changes, then verify every claim against the source and focused
validation evidence.
