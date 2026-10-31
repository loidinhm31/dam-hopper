# Phase 01 — Server config and managed extension lifecycle

Priority P1 · pending · 0.35d · owner: server lifecycle implementer.
Context: [approved design](../reports/design-261031-0949-lightweight-session-changes-refactor.md), [overview](plan.md), `server/src/config/schema.rs::ServerConfig`, `server/src/api/config.rs::update_config`, `server/src/agent_status/integration.rs::{check_extension_status,install_extension,uninstall_extension}`.

## Existing behavior and architecture

`ServerConfig` serializes camelCase and accepts snake_case aliases; `config/parser.rs` explicitly emits TOML server fields. `SettingsPage` already calls owner-bound config APIs. Agent integration uses managed SHA-256 headers and safe-path/atomic-write helpers. `AppState` currently creates `SessionChangesService` unconditionally, `main.rs` attaches it to PTY and Agent Status runtime, and collector routes retain a service handle. Merely hiding the UI or detaching one handle cannot disable outstanding requests.

Introduce a shared enabled/generation gate in the existing service, initialized false, plus purge/invalidation operations. Keep the single service handle so existing PTY root bindings remain usable when enabling on an already running terminal; no second tracking service or background task. Producer/public handlers check the gate on entry; every asynchronous publication rechecks its captured generation under publication synchronization. OFF clears records, baseline/current buffers, accounting and any TempDir payloads; no retained capture/comparison data may survive through a cloned Arc. Authorization-only PTY bindings may remain until existing PTY cleanup; they must contain no file snapshots.

The dedicated bundled asset is `server/src/agent_status/assets/omp-session-changes.ts`, installed at the effective/configured OMP agent directory's `extensions/dam-hopper-session-changes.ts`. Execute the unblocked Phase 03 `omp-tool-event-producer` first: it creates/tests the complete real asset against the frozen Phase 02 wire contract. Only its evidence-backed completion releases `managed-extension-lifecycle`, which can then add `include_str!("assets/omp-session-changes.ts")` and compile immediately. No placeholder or descendant-owned file is needed at this boundary.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "managed-extension-lifecycle",
    "title": "Add independently owned Session Changes extension lifecycle",
    "blocked_by": ["omp-tool-event-producer"],
    "allowed_files": ["server/src/agent_status/integration.rs", "server/src/agent_status/mod.rs", "server/src/api/agent_status.rs", "server/tests/agent_status_integration.rs"],
    "constraints": ["Reuse managed-header SHA-256, bounded safe reads, effective-home resolution and atomic writes; never overwrite or unlink modified, unmanaged, symlink or special-file targets.", "Manage dam-hopper-session-changes.ts independently from dam-hopper-agent-status.ts; no change to notification or status enablement.", "Phase 03 owns the actual new TypeScript asset; no temporary stub asset or duplicate installer convention."],
    "acceptance": ["Independent status/install/uninstall helpers distinguish absent/current/outdated/modified and use the dedicated asset/path.", "Install and uninstall are idempotent for absent/current owned files; user modifications and unsafe paths produce actionable conflicts without changing either extension.", "Configured OMP directory and default effective-home directory use the same resolution as existing Agent Status APIs."],
    "verification": ["At this task boundary run cargo check --manifest-path server/Cargo.toml and cargo test --manifest-path server/Cargo.toml --test agent_status_integration; cover absent/current/outdated/modified, CRLF ownership and symlink cases.", "Smoke the actual installer in a temporary agent directory: install/remove only Session Changes and compare Agent Status bytes before/after; collect independent local review and completion evidence before releasing the switch task. The complete bundled asset already exists from its prerequisite."]
  },
  {
    "id": "server-session-changes-switch",
    "title": "Wire default-off server setting to atomic enablement and purge",
    "blocked_by": ["managed-extension-lifecycle"],
    "allowed_files": ["server/src/config/schema.rs", "server/src/config/parser.rs", "server/src/config/tests.rs", "server/src/api/config.rs", "server/src/api/settings.rs", "server/src/api/workspace.rs", "server/src/api/agent_status.rs", "server/src/persistence/restore.rs", "server/src/state.rs", "server/src/main.rs", "server/src/agent_status/runtime.rs", "server/src/session_changes/store.rs", "server/src/session_changes/control.rs", "server/src/session_changes/capture.rs", "server/src/session_changes/comparison.rs", "server/src/session_changes/capture_tests.rs", "server/src/session_changes/comparison_tests.rs", "server/src/api/session_changes.rs", "server/tests/session_changes_lifecycle.rs", "server/tests/session_changes_protocol.rs", "server/tests/session_changes_controls.rs", "server/tests/session_changes_api.rs", "server/tests/session_changes_adversarial.rs", "server/tests/agent_status_integration.rs"],
    "constraints": ["Store enablement in ServerConfig, not UI preferences/localStorage; serialize sessionChangesEnabled and persist session_changes_enabled with false default.", "OFF must invalidate all in-flight producers/comparisons before purge, even when an old collector route or worker holds a service Arc.", "Route config.rs update/reload, settings.rs cache-clear/import/recovery and workspace.rs init/switch through one serialized reconcile/publish helper; no direct config replacement bypass.", "On modified-file uninstall conflict preserve the file but disable/purge immediately; import recovery must never restore an old ON state automatically after disable or cleanup error.", "Update all owned exhaustive ServerConfig constructors, including persistence/restore.rs, and existing test setup that now needs explicit tracking opt-in before this task's local checks."],
    "acceptance": ["Missing field starts false; JSON/TOML export/import/reload retain the flag and every config replacement path reconciles runtime state.", "ON installs the completed managed asset and enables the service gate; startup reconciles persisted ON/OFF without browser involvement. The new capture protocol becomes available in Phase 02, not as a prerequisite to this task's lifecycle checks.", "OFF rejects producers immediately, purges retained snapshot/comparison bytes and TempDir payloads, and removes only an owned extension.", "Cache-clear after externally changing ON/OFF, workspace init/switch to a missing/explicit flag and TOML import all reconcile disk/config/gate consistently; disable/cleanup import errors cannot run automatic old-ON recovery.", "Restore unit-test ServerConfig literal explicitly sets session_changes_enabled false or uses an appropriate default; Rust unit-test compilation and restore tests remain intact.", "Disable raced with capture/comparison cannot repopulate state; enable failures leave tracking OFF with actionable errors and status/notifications remain operational."],
    "verification": ["At this task boundary run cargo check --manifest-path server/Cargo.toml, cargo test --manifest-path server/Cargo.toml config, cargo test --manifest-path server/Cargo.toml persistence::restore and cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle; author cache-clear/workspace-init/workspace-switch/import-recovery regressions in the owned lifecycle suite.", "Smoke default OFF, ON, OFF, restart, cache-clear after external TOML change, workspace init/switch and import cleanup failure against real temp config/agent paths; verify immediate refusal and zero retained bytes. Existing producer-protocol tests explicitly opt in where required and still compile; do not depend on Phase 02 tests or new endpoints.", "Collect local review and fresh compile/test/smoke evidence for this task before completion; final integrated qualification is an additional downstream gate, never this task's evidence source."]
  }
]
```

- [ ] <!-- evcrate-task:managed-extension-lifecycle --> Add independently owned Session Changes extension lifecycle
- [ ] <!-- evcrate-task:server-session-changes-switch --> Wire default-off server setting to atomic enablement and purge

## Ordered implementation

### `managed-extension-lifecycle`

1. Extend existing integration module with dedicated bundle/subpath constants and status/install/uninstall helpers. Factor only genuinely shared header/path logic; retain existing Agent Status API behavior and exports.
2. Verify recorded SHA-256 against actual body, not only bundled version/header text. Owned outdated content can upgrade; modified/unmanaged content cannot. Use bounded file reads and validate extension parent/target before mutation.
3. Reuse `api/agent_status.rs` effective-home and configured OMP path resolution. Return dedicated managed status/conflict information through existing API conventions needed by Settings/config responses; avoid granting client-selected arbitrary filesystem paths.
4. Author focused managed lifecycle tests in the existing integration suite, then run this task's compile/tests/temporary-directory smoke and local review at its coherent completion boundary. Do not wait for downstream implementation.

### `server-session-changes-switch`

1. Add `session_changes_enabled: bool` to `ServerConfig` with serde default/alias, Default implementation and `server_to_toml` serialization. Update exhaustive literals, especially `server/src/persistence/restore.rs:366-375`, to explicit false or a suitable default update; preserve restore unit coverage and telemetry/idle-suspend protections.
2. Centralize serialized reconcile/publish in the config lifecycle. Use it from `config.rs` update/reload and startup, `settings.rs::cache_clear`, TOML import/recovery, and `workspace.rs::{init_workspace,switch_workspace}` before every replacement of `state.config`. Preserve existing workspace lock ordering and unrelated sandbox/monitor reconfiguration. Validate before write; retain atomic config writer, install-before-enable ordering and rollback of newly installed owned files on enable persistence failure.
3. Introduce enabled-generation/purge in `SessionChangesService`. Default-off construction must not allocate baseline buffers, inventory or temp payloads. Keep empty service metadata cheap; do not start tracking tasks while OFF.
4. OFF flips gate and invalidates generation before awaiting disk operations, drains retained state, then safely removes the managed extension and persists OFF. A removal conflict leaves OFF authoritative and surfaces cleanup error/status. If persistence fails after disable, stay runtime OFF, report failure explicitly, and never claim durable OFF; operator must correct config before restart. Do not silently re-enable to compensate a disable error.
   Import recovery must distinguish parse/validation failure before disable from a disable already applied. Once candidate OFF invalidates tracking, cleanup/reload/persistence failure must not execute the existing old-bytes + old-ON reload recovery. Keep runtime OFF, preserve backup/diagnostic information and persist OFF where possible; if unrelated fields require recovery, overlay OFF and run the same helper. No recovery branch may bypass its safety latch or automatically re-enable; report durable-OFF failure explicitly.
5. Startup with OFF safely removes a previously owned Session Changes file if present; conflict is visible but tracking remains OFF. Startup with ON installs/reconciles before publishing enabled; failures remain unavailable/OFF rather than silently tracking with stale packaging.
6. Gate all current private/public Session Changes handlers now; Phase 02 carries this gate into rewritten routes. Update existing `capture.rs` and `comparison.rs` publication paths in this task to recheck enable generation after blocking I/O, so OFF race tests do not depend on the engine successor. Invalidate all retained comparison IDs on OFF, wire initial state in `state.rs`/`main.rs`, and leave Agent Status credentials/notifications unchanged.
7. Author race/accounting, restore compilation, cache-clear reload, workspace init/switch and import/recovery regressions now. Update existing domain/API test setup for the new explicit opt-in so local checks do not depend on Phase 02 migration. Verify this phase's current lifecycle using the existing protocol/service gate; Phase 02 later replaces protocol fixtures. Config path changes while ON must safely reconcile old/new ownership or reject before mutation.

## Failure, rollback and security/bounds

- Filesystem and config are not one transaction: use ordered fail-closed enable/fail-safe disable semantics above; surface partial cleanup instead of hiding it. No claim of successful physical deletion on ownership conflict.
- Operational rollback is OFF plus safe managed removal, not uninstalling Agent Status or restoring scanning. Baselines are ephemeral and intentionally unrecoverable after purge.
- Never log bearer tokens, file content or full patches. Reuse authenticated config authorization, loopback producer auth, configured-root authority and no-store responses.
- Header ownership does not bypass symlink checks. No recursive directory removal, broad extension-directory cleanup, user-file overwrite or CLI-wide integration redesign.
- Sequential ownership: Phase 02 receives domain/API and lifecycle/protocol tests after this task's local compile/tests/smoke/review evidence is accepted; Phase 04 receives client settings work. The finalizer performs additional integrated checks after all prerequisite tasks complete; it is not a predecessor's verification provider.

## Exit criteria

Both task contracts satisfied; dedicated installer behavior, config persistence and disable generation semantics handed to engine/producer/UI owners. No implementation result or verification pass is asserted by this plan.
