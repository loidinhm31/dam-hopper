# DamHopper Codebase Summary

**Generated:** 2026-09-14 from `repomix-output.xml` (Repomix v1.18.0; 1,930
files, 4,260,856 tokens, 17,591,533 characters; five security-flagged files
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

## Workflow tracking

`server/src/workflow/` is a domain-first service over the shared SQLite
`sessions.db`; migration `010_workflow_tracking.sql` adds bounded Plan/Phase/Task
items, scoped manual sessions, terminal/agent resource links, notes, and activity
events without changing existing terminal-session tables.

- `model/` owns closed enums, camelCase DTOs, and validation for hierarchy,
  limits, timestamps, and transitions.
- `store/` owns synchronous transactional repositories, bounded overview/event
  reads, keyset history, idempotent request handling, and retention purge.
- `service.rs` snapshots current workspace/profile scope, validates configured
  projects and registered worktrees, and dispatches SQLite work through
  `spawn_blocking`.
- `observation.rs` and `reconcile.rs` keep PTY lifecycle correlation off hot
  paths: allowlisted lifecycle facts use non-blocking `try_send` to a bounded
  `sync_channel(256)`, then reconcile `(sessionId, incarnation)` links after PTY
  restore. Queue/storage failures never block terminal I/O; manual workflow
  session status and timestamps remain user-controlled.
- `server/src/api/workflow/` exposes protected overview, event, item, session,
  link, note, and history routes with strict camelCase DTOs, request UUIDs,
  optimistic `updatedAt` checks, bounded payloads, and sanitized errors.

The shared UI mirrors this contract through typed `api.workflow`, generation- and
profile-scoped React Query keys, and success-only `['workflow']` invalidation.
Workflow data stays memory-only; selection, notes, edits, and elapsed clocks stay
component-local. `WorkflowSelectedItemBar` and its notes/edit molecules use the
selected DTO `updatedAt` for CAS and refresh authoritative overview data after a
successful mutation.

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

Phase 05 owns the pure read-only bundle-v1 model, four bounded JSONL
compatibility readers, allowlist/redaction projectors, exact-UUID correlation
and gap analysis, and whole-record final-cap reduction. Phase 06 composes it
with fixed role, EUID, host-command, local-API, current-probe, and output
adapters. Phase 07 completes cross-layer qualification, architecture
reconciliation, the read-only Linux smoke, and rollout documentation.
These adapters do not widen the pure engine.

### Phase 05 pure diagnostics engine

`server/src/linux_release/diagnostics/` is a pure assembly boundary:

- `model.rs` defines `DiagnosticBundleV1`, source envelopes, completeness,
  bounds, privacy, correlation, projected-record DTOs, typed errors, and fixed
  limits. Bundle serde is camelCase and rejects unknown top-level fields.
- `file_sources.rs` shares one no-follow, read-only bounded JSONL scanner across
  `read_server_events`, `read_server_audit`, `read_helper_audit`, and
  `read_backend_diagnostics`. Each source has independent status, coverage,
  malformed/retention/truncation/drop indicators, and bounded errors.
- `redaction.rs` validates closed schemas/UUIDs and projects explicit
  allowlists. Actors, terminal/PTY data, argv/environment, credentials,
  addresses, journal text, raw helper details, and unbounded stderr are
  excluded or mapped to bounded codes.
- `correlation.rs` joins exact validated UUIDs only; it reports deterministic
  chains, open/orphan records, sequence gaps/duplicates, and restart
  boundaries. Time, epochs, revisions, and PIDs never infer identity.
- `collector.rs` assembles the trailing 60-minute bundle, evaluates required
  historical-source completeness, and reduces whole records until serialized
  output is at most 8,388,608 bytes, then recomputes correlations.

Readers cap each source at 16 MiB, each JSONL line at 16 KiB, and 10,000
accepted records. Missing and readable-empty files remain distinct. Malformed
middle/tail evidence preserves valid neighboring records while marking the
source partial. Source reads never compact, repair, truncate, rotate, lock, or
write producer files. Fixture tests compare bytes, length, and permissions
before/after reads to verify zero disk mutation.

### Phase 06 Linux diagnostic CLI and adapters

`cli.rs` accepts only the required `diagnose --json` form. `collector.rs`
loads role from the fixed host configuration, applies server/both versus web
applicability, preserves independent source statuses, and records host EUID.
`host_commands.rs` runs only fixed systemd/journal/inhibitor commands with
locale `C`, null stdin, discarded stderr, five-second deadlines, and bounded
stdout. `local_api.rs` reads the fixed token and queries only the loopback
idle-status endpoint with no redirects and a 256 KiB body cap.

`host_probes.rs` projects fixed RTC, power-state, enrollment/PID, and inhibitor
evidence as non-historical data. `output.rs` resolves root or safe user-state
destinations, enforces directory `0700` and bundle `0600`, and performs
exclusive no-follow temp-file write, sync, rename, and directory sync.
`dam-hopper.rs` prints only the absolute final path after output and maps
complete/partial/fatal results to exits `0`/`2`/`1`; non-root never escalates.

### Phase 07 diagnostics verification, architecture reconciliation, and rollout

`server/tests/idle_suspend_phase07.rs` contains two deterministic cross-layer
tests for automatic quiet admission/cancellation and manual admission,
rejection, UUID propagation, and server-audit correlation. The
`server/tests/idle_suspend_diagnostics.rs` entrypoint delegates to six focused
modules (`fakes.rs`, `fault_matrix.rs`, `redaction.rs`, `bounds.rs`, `roles.rs`,
and `output.rs`) covering malformed/unknown/gapped records, the redaction
corpus, fixed record caps, role and EUID behavior, local API faults, and
atomic output. `server/tests/idle_suspend_diagnostics_linux_smoke.rs` is an
ignored Linux-only smoke using production read adapters and temporary output;
before/after snapshots prove no mutation of host/configuration/audit files,
RTC wakealarm content, or API/helper unit state.

The five-command focused gate recorded 223/223 aggregate executed tests with
zero failures (counts are invocation executions, not unique coverage), and the
separate Phase 07 cross-layer target passed 2/2. The latest cycle-2 review
approved the change at 10.0/10. No coverage percentage or real suspend canary
is claimed.

### Explorer HTML preview

The shared UI routes `.html`, `.htm`, and `.xhtml` files through
`isHtmlFile`/`isHtmlPreviewCandidate` and lazy `HtmlHost` before generic Monaco
fallbacks. `HtmlHost` preserves the editor callback/view-state contract while
switching among full Edit, 50/50 Split, and full Preview layouts. `HtmlPreview`
feeds debounced content to one iframe, exposes reload, and omits
`allow-same-origin` from its explicit sandbox; `html-preview-transform.ts` adds
only in-memory storage and in-frame alert shims. `FileTree` exposes Preview from
`TreeContextMenu` only for live HTML files smaller than 5 MiB. Mode state is a
browser-local `dam-hopper:html-view-mode:v1` value and the
`dam-hopper:html-view-mode-changed` event synchronizes mounted tabs.

## Linux release and deployment

`server/src/linux_release/` owns manifest validation, role projection, unit
staging, systemd lifecycle, health, rollback, recovery, and release evidence.
Systemd templates define API, helper, web, and recovery services. The API
runtime identity is taken from the finalized unit's `User=`/`Group=` pair;
release tooling refuses unsafe path ownership or symlink substitutions rather
than repairing them. The helper remains root-owned and uses a restricted Unix
socket with peer credentials.

### Phase 00 merge boundary (2026-09-14)

The merge reconciliation kept refusal-based descriptor provisioning and
excluded recursive string-path `chown`, while incorporating the workflow and
Explorer HTML preview surfaces. The API unit renders
`--config /var/lib/dam-hopper/dam-hopper.toml`; the merge boundary is complete.

### Phase 01 runtime-state boundary (2026-09-14)

`server/src/linux_release/api_runtime.rs` now provisions the descriptor-relative
API state root, canonical `/var/lib/dam-hopper/dam-hopper.toml`, and server
`/var/lib/dam-hopper/idle-suspend-audit.jsonl`. A validated legacy
`/etc/dam-hopper/dam-hopper.toml` is an optional exact-byte, copy-once source
only when canonical state is absent. Staging uses an exclusive no-follow
temporary sibling and Linux `renameat2(RENAME_NOREPLACE)`; mismatches, unsafe
legacy state, races, and post-publication failures remain refusal/reporting
boundaries. See [Linux API Runtime State Provisioning](./linux-release-runtime-provisioning.md).

### Phase 02 systemd unit/policy boundary (2026-09-14)

`deploy/systemd/dam-hopper-api.service.in` renders
`--config @API_HOME@/dam-hopper.toml`; the checked-in unit resolves that
operand to `/var/lib/dam-hopper/dam-hopper.toml` and must stay synchronized
with the production-default rendering. `validate_api_unit_policy` requires
exactly one canonical `ExecStart` and one zero-operand privileged
`provision-api-runtime` prestart. Staging renders, parses, and policy-checks
the same unit; duplicate directives, legacy/alternate paths, and extra
arguments fail closed. Focused unit-policy/staging evidence records 29/29.

### Phase 03 preflight, installer, and reset boundary (2026-09-14)

`activate_preflight.rs` gates SQLite holder checks only for `server`/`both`
roles. It inspects canonical `/var/lib/dam-hopper/dam-hopper.toml` first and
the extant `/etc/dam-hopper/dam-hopper.toml` migration source second, using
no-follow regular-file descriptors, a 64 KiB bound, UTF-8/TOML parsing, and
fixed API `HOME`/working-directory path semantics. Unsafe presence fails closed;
missing is the only absence state. Missing keys use the schema default for that
config; when both TOMLs are absent, the canonical default is included. Results
retain the migration-window `/etc/dam-hopper/sessions.db` fallback, with
stable-deduplicated DB, `-wal`, and `-shm` holder checks without filesystem mutation.

The bootstrap installer stages release-manager bytes only. It does not create,
copy, chmod, chown, or repair daemon TOML; first `server`/`both` start invokes
the runtime provisioner, while `web` remains API-state-free. The reset tool
defaults to the canonical config, refuses unsafe metadata, and performs a
same-directory atomic replacement as the exact API identity, preserving
`0600` ownership/mode and parseable TOML. Dry-run is observation-only; helper
units, audits, and foreign RTC alarms remain preserved. Clean-install,
security, and reset smoke journeys pin these boundaries.

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
raw IPC. The Phase 05–07 diagnostics path keeps evidence local, applies
explicit privacy projection before sizing, and never infers authority from
latest probes or terminal text.

## Verification map

- Rust unit/integration tests live beside backend modules and under
  `server/tests/`; focused fixtures use temporary files, fake clocks, fake
  helpers/backends, and deterministic identities.
- Frontend unit tests live beside components/stores; browser tests live under
  `packages/ui/browser-tests/` and exercise actual rendered behavior.
- Linux release and target-host smoke scripts are under `server/tests/deploy/`
  and `deploy/`; real RTC/suspend canaries remain explicit host-owner gates.
  Phase 02–07 diagnostics behavior is covered by schema/serde, validation,
  identity, path safety, bounded readers/adapters, malformed-line recovery,
  privacy projection, exact UUID correlation, sequence gaps/duplicates,
  restart boundaries, whole-record cap reduction, source immutability, role
  applicability, atomic output semantics, cross-layer chains, and the ignored
  read-only Linux smoke.

## Documentation map

- [System Architecture](./system-architecture.md) — live data flow and
  security boundaries, including the completed Phase 07 diagnostics path.
- [Code Standards](./code-standards.md) — Rust/TypeScript patterns,
  canonical writer, diagnostics adapters, and coordinator lifecycle rules.
- [Project Overview PDR](./project-overview-pdr.md) — product requirements and
  phase acceptance criteria.
- [Configuration Guide](./configuration-guide.md) — configuration and runtime
  setup.
- [Linux API Runtime Provisioning](./linux-release-runtime-provisioning.md) —
  canonical/legacy config migration, audit state, descriptor safety, and
  no-replace publication.
- [API Reference](./api-reference.md) — REST and WebSocket contracts.
- [Terminal Idle Suspend Security](./terminal-idle-suspend-security.md) —
  suspend/helper threat model and fail-closed rules.

**Maintenance note:** Regenerate this summary after substantial module or
architecture changes, then verify every claim against the source and focused
validation evidence.
