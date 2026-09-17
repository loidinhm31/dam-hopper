# DamHopper Codebase Summary

**Generated:** 2026-09-17 from `repomix-output.xml` (Repomix v1.18.0; 2,025
files, 4,538,673 tokens, 18,898,951 characters; five security-flagged files
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

## Unified-profile workbench frontend (Phases 00–02)

Phase 00 froze the profile/generation ownership contract. Phase 01 implements
qualified refs, keyed `connections.ts` runtimes, owner-bound API clients,
generation-aware query/event boundaries, and protocol-2 status gating. Phase
02 completes the shell/profile migration:

- `packages/ui/src/embed/dam-hopper-app.tsx` mounts routes independently of any
  one profile and starts supported `autoConnect` profiles independently.
- `packages/ui/src/api/server-config.ts` migrates `autoConnect`, endpoint-bound
  `ProfileAuthV2` records, and legacy single-server credentials without
  sending an unbound bearer to a new URL. `isSameOriginProfile` enforces
  non-Windows native same-origin support.
- `ServerProfilesDialog` owns per-profile Connect/Disconnect/Login/Logout/Edit/
  Remove/Auto-connect actions. `ServerSettingsDialog` edits one profile and
  nests backend `WorkspaceSwitcher` under Server configuration.
- `workspace.ts` persists qualified `ProjectRef | null`; `ProjectSwitcher`
  aggregates successful per-profile project queries into Profile → Project
  groups and uses JSON tuple keys. `workbench-selections.ts` keeps preference,
  Settings, and Browser target profile IDs independent.
- `fresh-state-reset.ts` drops enumerated old resource stores idempotently,
  preserves profiles/auth/native/server state, and rejects unqualified links.
- Web/native entrypoints each create one ordinary `QueryClient` and render
  once. Native profile support is explicit; unsupported rows remain editable
  and produce no fallback request.

These are frontend ownership boundaries only. Server project names, workspace
configuration, PTYs, workflow/usage history, and remote data remain
server-authoritative. The unified-profile backend-workspace proposal below is
not part of this implementation.

## Unified-profile files, editor, search, and Git (Phase 03)

Phase 03 completes the profile-qualified IDE workbench. The browser target is
`{ profileId, project, worktreePath? }`; the owner-bound client projects it to
the server wire target `{ project, worktreePath? }` only after checking the
captured connection owner. Root and registered worktree targets remain distinct.

| Area               | Source boundary                                                        | Invariant                                                                                                  |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Target selection   | `stores/project-target.ts`                                             | A missing or prunable worktree is unavailable; requests do not fall back silently.                         |
| Editor models      | `stores/editor.ts`, `components/organisms/MonacoHost.tsx`              | Tab/model keys and in-memory Monaco URIs include profile and target scope.                                 |
| File tree/watchers | `stores/explorer-tree.ts`, `hooks/use-fs-subscription.ts`              | Tree state, events, language scans, and invalidations are target-scoped.                                   |
| CRUD/upload        | `hooks/use-fs-ops.ts`, `hooks/use-fs-upload.ts`, `api/ws-transport.ts` | CRUD, mtime-guarded writes, and acknowledged chunk uploads use the owning transport.                       |
| Bounded previews   | `components/organisms/LargeFileViewer.tsx`, image/video ticket clients | Large files use read-only 64 KiB range reads; media previews use scoped capabilities.                      |
| Federated search   | `hooks/use-file-search.ts`, `components/organisms/SearchPanel.tsx`     | Project-target and all-connected-profile scopes preserve origin metadata and cap aggregate results at 500. |
| Search replace     | `hooks/use-search-panel-replace.ts`, `lib/search-replace-next.ts`      | Replacement captures the match target; dirty tabs are isolated by profile/project/worktree/path.           |
| Git retry          | `hooks/use-git-with-ssh-retry.ts`, `api/queries.ts`                    | Authentication retry retains successful results and retries only failed targets after owner validation.    |

Filesystem `fs:event` handling updates or refetches only the matching target.
Clean editor tabs reload after external/Git mutations; dirty tabs preserve local
content and become stale. Connection generation checks prevent old profile
responses from publishing after disconnect or endpoint replacement.

Search workspace scope queries eligible connected profiles independently (up to
four concurrent profile requests), exposes per-profile status, deterministically
sorts results, and warns when server truncation or the 500-result aggregate cap
may make the result incomplete. `Replace Next` and `Replace All` re-read and
mtime-check before writing, skip dirty files without overwriting them, and
reload only clean open tabs.

The focused contract coverage is in
`packages/ui/src/api/phase-03-files-editor-search-git.test.ts`. The full source
and behavior map is [Phase 03: Files, Editor, Search, and Git](./phase-03-files-editor-search-git.md).

## Unified-profile terminal continuity and owner navigation (Phase 04)

Phase 04 completes profile-qualified terminal continuity, workflow reveal, and
owner-directed diagnostics in `packages/ui`. A terminal identity is
`{ profileId, id }`; a live process adds `incarnation`. `ownership.ts` owns
`terminalKey()` and `terminalInstanceKey()`, and the registry, mounted-session
list, activity tracker, incarnation fence, and terminal layout tree consume
those qualified keys. Raw session IDs remain compatibility aliases only when
unambiguous.

| Boundary              | Source modules                                                                                                         | Contract                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Registry and lifetime | `terminal-registry.ts`, `terminal-incarnation-state.ts`, `terminal-mounted-sessions.ts`, `TerminalKeepAliveHost.tsx`   | Register, attach, remove, and preserve sessions by profile plus session ID; reject stale incarnations.     |
| Owner transport       | `api/client.ts`, `api/queries.ts`, `hooks/use-terminal-manager.ts`                                                     | Capture profile/generation and route terminal operations through the owning API client/transport.          |
| Layout and pins       | `terminal-layout-tree.ts`, `use-terminal-layout.ts`, `traditional-terminal-projects.ts`, `terminal-pin-persistence.ts` | `terminal-layout:v3` keys owner/group state with payload v2; `terminal-pins:v2` partitions IDs by profile. |
| Local history         | `command-history.ts`                                                                                                   | Persist `{ version: 3, entries }`; salt IDs with profile where supplied and keep exact command text local. |
| Workflow navigation   | `workflow-queries.ts`, `workflow-workspace-integration.ts`, `terminal-notification-navigation.ts`                      | Qualify query keys and reveal targets; reject missing, cross-profile, or incarnation-mismatched links.     |
| Diagnostics and reset | `diagnostics-export.ts`, `diagnostics-client.ts`, `fresh-state-reset.ts`                                               | Filter exports by profile/terminal IDs, bound terminal tails, and remove only unqualified legacy stores.   |

The focused contract suite is
`packages/ui/src/lib/terminal-continuity-unified-profile.test.ts`; the full
source map and compatibility cautions are in the dedicated
[Phase 04 terminal continuity guide](./phase-04-terminal-continuity-workflow-navigation.md).

These boundaries remain frontend ownership rules. PTYs, workflow persistence,
terminal output, and remote project data remain server-authoritative; an
unqualified browser link is not silently attributed to a profile.

## Unified-profile agents, ports, and Browser (Phase 05)

Phase 05 completes the owner boundary for Agent Store operations, detected
ports/tunnels, Browser Debug targets, and terminal handoff. It keeps server
catalogs, projects, PTYs, tunnels, and artifact files server-local; the
frontend never merges same-named data or routes a delayed operation through the
active profile.

| Boundary             | Source modules                                                           | Contract                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Store owner    | `components/pages/AgentStorePage.tsx`, `api/queries.ts`, `api/client.ts` | Explicit profile selector; owner/generation-qualified catalog, project, matrix, health, memory, and import operations.                   |
| Memory draft         | `components/organisms/MemoryEditor.tsx`                                  | Draft identity `{ profileId, projectName, agent }`; clean-only refresh; dirty content cannot be replaced by another target.              |
| Import lifecycle     | `components/organisms/ImportDialog.tsx`                                  | Opening owner binds server `tmpDir`/local path; `scanRevision` rejects late results; profile change closes stale dialogs.                |
| Port aggregation     | `hooks/use-ports.ts`, `hooks/use-tunnels.ts`                             | Detected identity `(profileId, port, terminalId, incarnation)`; tunnel identity `(profileId, tunnelId)`; equal numbers remain distinct.  |
| Browser target       | `hooks/use-browser-debug.ts`, `lib/browser-debug-origin.ts`              | Target carries owner, exact origin/source, optional tunnel, and revision; only loopback or ready owner-local tunnel origins are trusted. |
| Handoff pipeline     | `components/pages/WorkspacePage.tsx`, `lib/browser-terminal-handoff.ts`  | Same-profile mounted/live terminal only; owner, target revision, and terminal incarnation rechecked after each await.                    |
| Artifact admission   | `server/src/api/browser_debug.rs`, `server/src/browser_debug/store.rs`   | Required `terminalIncarnation`, private expiring metadata, one claim, structured mismatch conflict.                                      |
| PTY admission        | `server/src/pty/manager.rs`                                              | `write_if_incarnation` keeps lookup/check/input-revision/write under one lock and rolls back failed writes.                              |
| Feature availability | `hooks/use-feature-flag.ts`                                              | Owner-local `unknown`/`loading`/`available`/`unavailable` state derived from the selected connection snapshot.                           |

The Browser handoff sequence captures `{ profileId, generation }`, target
revision, and `TerminalInstanceRef` before artifact creation. It rejects a
cross-profile target before create, deletes artifacts after owner/revision/
incarnation drift, and requires `inserted: true` from the handoff response.
On the server, a reused public terminal ID returns
`TERMINAL_INCARNATION_MISMATCH`; the replacement PTY receives no bytes and the
manager input revision remains unchanged. Artifact claim release permits a
retry after a write failure.

The Phase 05 focused gate recorded 44/44 targeted tests, a successful UI
TypeScript build, and `cargo check`. Phase 09 subsequently qualified the
integrated web S01–S12 and live Browser boundaries; Windows-native S13 remains
blocked. The maintained implementation guide is
[Phase 05: Agents, Ports, and Browser](./phase-05-agents-ports-and-browser.md).

These are ownership and admission boundaries, not a new server workspace
model. `ConnectionRef` generation fences asynchronous UI work; server
identifiers remain valid only on their captured connection.

## Unified-profile preferences, Settings, usage, and host (Phase 06)

Phase 06 completes the browser ownership boundary for settings and host
surfaces. It keeps one explicit preference source separate from the Settings
target and from project/Browser selection. Server configuration, Codex usage,
host metrics, idle-suspend state, fleet counts, revisions, and resource IDs
remain local to their owning profile.

| Boundary                | Source modules                                                                                                            | Contract                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preference source       | `stores/settings.ts`, `stores/workbench-selections.ts`                                                                    | Allowlisted UI state hydrates through captured `{ profileId, generation }`; debounced writes bind the original client/source/edit revision; unavailable or removed sources keep a safe snapshot.               |
| Settings target         | `components/pages/SettingsPage.tsx`, `settings-page/*`, `GlobalConfigEditor.tsx`, `ConfigEditor.tsx`                      | Global/workspace config, maintenance, import/export, usage setup, and idle-suspend timing receive explicit target owner; import rejects target/generation drift before dispatch.                               |
| Owner-qualified queries | `api/queries.ts`, `api/client.ts`, `hooks/use-sse.ts`                                                                     | Usage, host metrics/snapshots/alerts, idle-suspend, config, and invalidation keys use `profileQueryKey(owner, ...)`; events patch only the event owner's cache.                                                |
| Usage surface           | `components/pages/UsagePage.tsx`, `components/usage/*`                                                                    | URL `profileId` selects the owner; summary/session/health/setup/delete operations remain profile-local; visible session views poll at 15 seconds.                                                              |
| Host presentation       | `HostResourcePopover.tsx`, `HostIdleSuspendStatus.tsx`, `ForceSleepDialog.tsx`, `use-host-resource-alert-presentation.ts` | Pinned mount is owner-local presentation state; incidents are keyed by `incidentId`; unread state is partitioned by profile; destructive host intent captures generation/revision and never replays ambiguity. |

The preference save chain coalesces only allowlisted fields and rolls back only
when its captured source and edit revision still match. Host alert transport
events are strictly validated, while REST snapshots/history remain the
reconciliation authority. The browser never averages duplicate profile hosts or
merges usage totals.

The Phase 06 gate recorded 87/87 targeted tests, 1,760/1,760 full Vitest
tests, clean TypeScript/modified-file ESLint checks, and a 9.5/10 code review.
The maintained implementation guide is
[Phase 06: Preferences, Settings, Usage, and Host Resources](./phase-06-preferences-settings-usage-and-host.md).

## Unified-profile media isolation and encryption (Phase 07)

Phase 07 extends unified profile ownership through native media capabilities,
remote cleanup, and encrypted filesystem writes. The browser keeps media as
opaque native streams and keeps encryption material in memory; neither path
silently changes owner or falls back to a weaker capability.

| Boundary              | Source modules                                                                                                                   | Contract                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Media client identity | `api/connections.ts`, `api/media-session.ts`                                                                                     | One in-memory UUIDv4 `mediaClientId` per exact `{ profileId, generation }`; issue, revoke, and logout carry it explicitly.                                                                                                                                                     |
| Session cookie        | `fs/media_session.rs`, `fs/media_ticket.rs`                                                                                      | Cookie name is `damhopper-media-session-<canonical-uuidv4>` with `HttpOnly`, `SameSite=Lax`, `/api/fs`, and an eight-hour maximum. The old fixed name is ignored; duplicate selected cookies fail closed.                                                                      |
| Ticket authorization  | `api/fs_image.rs`, `api/fs_video.rs`, `api/media_stream_response.rs`                                                             | Tickets bind actor, client namespace, session digest, target, kind/purpose, file identity/version, and incarnation. Stream authorization selects the cookie namespace from the stored binding, then revalidates after asynchronous file checks.                                |
| Session revocation    | `api/media_session.rs`, `fs/media_ticket.rs`                                                                                     | Logout/profile retirement removes only the matching `(actor.subject, mediaClientId)` sessions and tickets. Shared store generation changes invalidate stale capabilities.                                                                                                      |
| Native lifecycle      | `api/image-tickets.ts`, `api/video-tickets.ts`, `components/organisms/ImagePreview.tsx`, `components/organisms/VideoPreview.tsx` | Credentialed `HEAD` probes precede direct native URLs. `RemoteCleanupHandle` captures the original owner/endpoint/credentials, detaches native sources before best-effort bounded revoke, and never provides general transport access.                                         |
| Owned encryption      | `contexts/EncryptContext.tsx`, `hooks/use-encrypted-write.ts`, `lib/opaque-session.ts`                                           | State/session keys use `profileId@generation:project`; prompts queue with explicit owner labels; mutable keys are zeroed on disable/retirement; OPAQUE, WebCrypto, and the final filesystem write use one captured `WsTransport` with freshness fences and no plaintext retry. |

Image and video ticket issue/revoke routes use camelCase request bodies and
`authorizationMode: "session-cookie-v2"` responses. Stream routes sit outside
bearer middleware so same-origin native requests can send credentials. An
exact configured origin may use ticket-only fallback; an absent or untrusted
origin cannot. Unknown, expired, revoked, wrong-kind, or stale capabilities
remain non-disclosing `404` responses, while a changed file identity returns
`410` and revokes the ticket.

The maintained implementation guide is
[Phase 07: Media Isolation and Encryption](./phase-07-media-isolation-and-encryption.md).
The phase plan records 50 UI tests, 29 server media tests, and zero TypeScript
diagnostics as phase runtime evidence; these are not a release-wide coverage
claim.

## Unified-profile native scope concurrency and platform integration (Phase 08)

Phase 08 gives Windows desktop native SSH forwarding an explicit concurrent
scope lifecycle. `openClient` establishes a global client epoch and performs
true all-scope teardown; `openScope` loads or reuses one scope; `closeScope`
tears down one scope; `reconcileKnownScopes` updates retention metadata without
changing the epoch or opening/closing scopes.

| Boundary | Source modules | Contract |
| --- | --- | --- |
| Rust lifecycle | `apps/native/src-tauri/src/ssh_forward/manager.rs`, `model.rs` | `HashMap<scopeId, ActiveScope>`; every scoped command carries context, token, scope ID, and scope generation. |
| Runtime isolation | `apps/native/src-tauri/src/ssh_forward/connection_runtime.rs` | Registry keys are `(scopeId, connectionProfileId)`; child rules remain under their parent connection; equal IDs across scopes cannot collide. |
| IPC and ACL | `commands.rs`, `command_names.in.rs`, `permissions/ssh-forward.toml`, `capabilities/ssh-forward.json`, `src/lib.rs` | Exactly 21 Windows commands; every handler requires the `main` webview. |
| Frontend adapter | `apps/native/src/native-ssh-forward-host.ts` | One client context, `Map<scopeId, ScopeHandle>`, per-scope mutation queues, strict DTO/counter/identity checks, refetch-only event hints. |
| React lifecycle | `packages/ui/src/contexts/SshForwardHostContext.tsx`, `hooks/use-ssh-forward.ts` | Profile list drives known-scope reconciliation; explicit `NativeScopeRef` reaches every snapshot/mutation; focus does not switch scope. |
| Browser owner | `packages/ui/src/lib/browser-debug-origin.ts`, `apps/native/src/native-browser-debug-host.ts` | Native child receives Phase 05 `BrowserDebugTarget.owner`; one child lease, stale relay rejection, no SSH-scope inference. |
| Persistence and trust | `scope_retention.rs`, `store.rs`, `known_hosts.rs` | Per-scope hashed store, unavailable-vs-empty retention distinction, endpoint-first trust, scoped secret/challenge cleanup. |

Scope teardown removes live admission before aborting workers, canceling and
closing registry entries, clearing scope-keyed credentials, and clearing host
challenges. Global limits remain 16 live connections, four concurrent
handshakes, 64 enabled rules, and 64 channels per connection. Loopback ports
remain exclusive across scopes. Non-Windows/native mobile/browser hosts receive
no SSH-forward host or alternate transport.

Linux Phase 08 evidence is 135/135 focused tests: shared 15/15, native 48/48,
UI 25/25, and Cargo 47/47. Windows S13 remains unverified and must cover
Windows-gated runtime/DPAPI/WebView2 behavior, two concurrent scopes, equal IDs,
global port/limit enforcement, scoped and epoch teardown, stale/permission
negatives, and Browser target/relay behavior.

The maintained guide is
[Phase 08: Native Scope Concurrency and Platform Integration](./phase-08-native-scope-concurrency.md).

## Unified-profile integration and qualification (Phase 09)

Phase 09 is complete for the qualified web/Linux cutover and keeps native
release status explicit. Integration removed remaining ambient callers and
preserved one ordinary host `QueryClient`; feature state is keyed by
`ConnectionRef { profileId, generation }`, while server identifiers remain
server-local.

| Boundary | Current implementation and invariant |
| --- | --- |
| Media lifecycle | `api/connections.ts` stores one in-memory UUIDv4 `mediaClientId` per owner tuple, supplies a stable disconnected-profile fallback, and removes serialized `[profileId, generation]` keys on profile retirement. `api/media-session.ts` bounds a generated ID to the legacy cleanup boundary. |
| Owner-bound shell | `TopNav`, `DashboardPage`, `WorkspacePage`, `use-aggregated-projects`, `use-command-search`, and `use-ports` bind API/transport work to an explicit owner; import dialogs capture their opening owner; idle-suspend fleet reads remain nullable-safe. |
| Browser gate | `vitest.browser.config.ts` defines the strict API/fixture port `15173`, defaults the live server URL to A `14801`, and accepts one Chromium channel or executable path. |
| Linux release tests | `server/src/linux_release/api_runtime.rs` uses `tests::FAKE_FD_BASE` to distinguish injected fake descriptors from real descriptors during `Drop`. |
| Live qualification | `scripts/qualify-phase09-workbench.mjs` creates isolated A/B roots, repositories, markers, PTYs, media fixtures, and configs; checks S01–S12 on ports `14801`/`14802`; runs four embedded browser assertions; and tears down only owned processes and temporary paths. |

The reconciled execution ledger is **3,504 passed / 9 skipped or ignored**:
Rust server 1,416, UI unit 1,769, UI browser 209, shared 15, Browser bridge
19, native host 48, live harness 24, and embedded browser 4. The harness uses
isolated `--no-auth` fixtures for deterministic remote-effect checks; it does
not replace normal-auth actor-isolation evidence. G2-Web passed. G2-Native
remains blocked until real Windows S13 runtime, SSH, WebView2/DPAPI, and Browser
relay evidence is recorded.

Release cutover ships matching frontend/backend builds with
`workbenchProtocol: 2`, media `session-cookie-v2`, and terminal-incarnation
admission. The allowlisted fresh browser-resource reset is idempotent and
deliberately lossy; rollback uses a mutually compatible pair and may require
fresh login. See the [Phase 09 plan](../plans/260916-2137-unified-profile/phase-09-integration-and-qualification.md),
[verification matrix](../plans/260916-2137-unified-profile/verification-matrix.md),
and [multi-server guide](./user-guide-multi-server-profiles.md).

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

## Workspace settings import/export

The Settings page and protected Rust API exchange only the active workspace
TOML. `GET /api/settings/export/workspace.toml` returns the file's exact bytes
with an attachment filename and `Cache-Control: no-store`; browser code
downloads the raw text through a Blob. `POST /api/settings/import/workspace.toml`
accepts raw `application/toml` under a
route-local 1 MiB cap, validates UTF-8/TOML/schema/path rules, and rejects
changes to startup-authoritative idle-suspend or telemetry settings. It
serializes with workspace switching, creates an exclusive mode-`0600`
`dam-hopper.toml.bak.<UTC>` containing old bytes, atomically publishes the
request bytes, reloads runtime dependents, and atomically restores the prior
file bytes while reapplying prior runtime state on reload failure. Successful
imports best-effort retain only the five newest server backups with the exact
timestamp form; manual backups with other names are preserved. Non-TOML media
returns `415` and workspace admission changes return `409`. Transport, query, and
Settings UI modules use raw text, browser file input, Blob download, and
workspace-derived query invalidation. Focused endpoint, transport, and page
tests cover byte fidelity, headers, validation, backup, retention, and feedback.

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

| Module                                 | Responsibility                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `policy.rs`                            | Startup-owned automatic policy and bounded timing configuration.                                                    |
| `protocol.rs`                          | Version-1 helper frames, request IDs, wake validation, and REST DTOs.                                               |
| `coordinator.rs`                       | Single-flight automatic/manual state machine, semantic event emission, and reconciliation.                          |
| `status.rs`                            | Private measurement/status DTOs and warning projection.                                                             |
| `server_audit.rs`                      | Legacy untagged timing/manual audit JSONL.                                                                          |
| `audit.rs`                             | In-place helper audit v2 records, typed milestones/codes, producer identity/sequence, and legacy-compatible reader. |
| `backend.rs`, `executor.rs`            | RTC and fixed suspend execution seams.                                                                              |
| `preflight.rs`, `peer_auth.rs`         | Inhibitor, capability, RTC, and peer checks.                                                                        |
| `helper_client.rs`, `helper_server.rs` | Unix-socket client and root helper service.                                                                         |
| `event.rs`                             | Canonical semantic event model, identity/correlation validation, and synchronized writer.                           |
| `tests.rs`                             | Focused policy, protocol, audit, helper, event, and coordinator behavior tests.                                     |

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

Phase 07 media preview remains a native URL capability: the UI does not read
image/video bytes into Blobs or object URLs. Encryption is profile/generation
qualified and owner A cannot consume owner B's passphrase, session, or
transport. Prompt and cleanup queues are bounded lifecycle mechanisms, not
general-purpose request dispatch.

## Security and data handling

Authentication, CSRF/same-origin checks, project sandbox containment, fixed
allowlisted commands, no-follow filesystem operations, bounded request/output
sizes, and sanitized error types are enforced at backend boundaries. Durable
logs omit credentials, tokens, terminal content, commands, environment, and
raw IPC. Phase 05–06 diagnostics keep evidence local, apply explicit privacy
projection before sizing, and never infer authority from latest probes or
terminal text. Phase 07 media cookies, ticket URLs, and encryption session
material remain bounded, non-persistent capabilities.

## Verification map

- Rust unit/integration tests live beside backend modules and under
  `server/tests/`; focused fixtures use temporary files, fake clocks, fake
  helpers/backends, and deterministic identities.
- Frontend unit tests live beside components/stores; browser tests live under
  `packages/ui/browser-tests/` and exercise actual rendered behavior.
- Linux release and target-host smoke scripts are under `server/tests/deploy/`
  and `deploy/`; real RTC/suspend canaries remain explicit host-owner gates.
  Phase 02–06 diagnostics behavior is covered by schema/serde, validation,
  identity, path safety, bounded readers/adapters, malformed-line recovery,
  privacy projection, exact UUID correlation, sequence gaps/duplicates,
  restart boundaries, whole-record cap reduction, source immutability, role
  applicability, atomic output semantics, cross-layer chains, and the ignored
  read-only Linux smoke. Phase 07 media and encryption coverage includes
  namespace isolation, duplicate-cookie rejection, binding-selected cookies,
  owner-qualified prompt/session state, key zeroing, and single-transport
  freshness fences.

## Documentation map

- [System Architecture](./system-architecture.md) — live data flow and
  security boundaries, including completed Phase 07 media/encryption and
  Phase 08 native-scope ownership paths.
- [Phase 08 Native Scope Concurrency and Platform Integration](./phase-08-native-scope-concurrency.md) —
  lifecycle, scope isolation, IPC/ACL, platform gate, and Browser owner contract.
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
