# Code Review — Phase 01: Server config and managed extension lifecycle

## Summary

**Score: 5/10. Disposition: changes required; Phase 01 acceptance incomplete.**

Default-off schema, separate managed extension, bounded ownership checks, entry-point gating and generation-checked publication are sound directions. Lifecycle transactions are duplicated rather than centralized; configured paths, error reporting, lock safety and failure atomicity remain incomplete.

Review only: no product/test/plan/task-state edits. Applied the installed `code-review` skill and development rules. Approximately 3,000 changed/context lines examined. Phase 02 engine and Phase 04 UI implementation not demanded by this review.

## Critical issues

### C1 — Recursive lifecycle read can deadlock OFF/purge (high confidence)

- Evidence: `server/src/session_changes/capture.rs:300-323`; `server/src/session_changes/store.rs:134-149`.
- Capture holds `service.lifecycle.read()` while calling `release_storage_for_generation()`, which acquires the same parking_lot read lock again. The CAS-loss path at capture line 310 and replacement path at line 322 are reachable when a concurrent from-now/replacement changes the initializing record.
- If OFF queues for the write lock between these reads, parking_lot's writer-preferring policy blocks the nested read; the outer read cannot be released. OFF cannot finish, and capture also retains the records mutex. This is a static concurrency finding, not a reproduced hang.
- Correction: under an already validated lifecycle read guard, call the non-locking accounting primitive; do not recursively acquire lifecycle locks. Add a deterministic queued-writer/CAS-loss regression.

## Warnings

### W1 — Configured OMP agent directory ignored; path changes unreconciled (high)

- Evidence: `server/src/api/config.rs:53,779,817,841`; `server/src/api/settings.rs:222`; resolver `server/src/api/agent_status.rs:124-144`; configured-path handling `server/src/api/config.rs:372-375,394-413,479-480`.
- Every new lifecycle call supplies `None`, selecting only environment/default home. The persisted `ui.agentSettingsPaths.ompAgentDir` is never consulted. A configured custom installation receives no extension while the wrong default directory is modified; missing default directory can reject enable even when the configured directory is valid.
- Global path updates also neither reconcile the old/new owned file nor reject a change while ON, contrary to Phase 01 ordered step 7.
- Correction: resolve the authoritative configured path plus effective-home fallback once; serialize path updates with lifecycle changes and migrate safely or reject before mutation.

### W2 — Successful ON reconciliation unnecessarily changes generation and leaks reservations (high)

- Evidence: `server/src/api/config.rs:778-785`; `server/src/session_changes/store.rs:127-131,143-157`; `server/src/session_changes/capture.rs:236,300-304`.
- Every cache-clear, project config reload or unrelated config save with ON calls `enable()`, which always increments generation without clearing records/accounting. A capture reserving bytes just before that reload fails publication afterward; its generation-aware release does nothing because generation changed, leaving allocated bytes orphaned. Initializing placeholders also survive.
- Correction: enabling an already enabled, unchanged owner must be idempotent. If an actual owner transition requires invalidation, purge/account reservations atomically as part of that transition. Cover ON-to-ON reload during capture, not only ON-to-OFF.

### W3 — Disable cleanup conflicts/errors disappear behind HTTP success (high)

- Evidence: `server/src/api/config.rs:72-76,794-811`; `server/src/api/settings.rs:220-224`; `server/tests/session_changes_lifecycle.rs:394-405`.
- Modified, symlink, permission and directory-resolution failures are ignored or only logged; reconciliation returns success and callers return `{ok:true}` or `imported:true`. Runtime correctly remains OFF and the file is preserved, but operators cannot discover the required cleanup from the response. The conflict test explicitly expects success rather than actionable cleanup status.
- Correction: keep OFF authoritative and persist it, but return a structured cleanup conflict/result after publication. Do not short-circuit OFF persistence merely to surface the error. Reuse that result at startup/import/config/workspace boundaries.

### W4 — Config update mutates installation/disk before validating candidate; rollback ownership is wrong (high)

- Evidence: `server/src/api/config.rs:47-88,587-593`; normalizer `630-635`.
- The boolean probe is not full schema validation. Example: candidate enables tracking but has an invalid typed server field: extension installation succeeds, JSON-to-TOML write succeeds, then `read_config` rejects it. Invalid config and installed extension remain; reload failure has no rollback. This violates the explicit validate-before-write/install transaction contract.
- `installed_for_enable` is also true when install returned an already-current or upgraded preexisting file. A subsequent write error uninstalls that preexisting file, not just a newly created owned file.
- JSON PUT also leaves `sessionChangesEnabled` camelCase on disk because only project keys are normalized, contrary to the new snake_case TOML persistence contract.
- Correction: render/parse/validate candidate before any side effect; record absent/current/outdated ownership before installation and roll back only newly created state; canonicalize the new TOML key.

### W5 — Workspace switch/init can publish mixed workspace state on lifecycle error (high)

- Evidence: `server/src/api/workspace.rs:170-172,190-194`; `server/src/api/config.rs:754,779-791`.
- Both handlers write `state.workspace_dir` before fallible reconciliation. A target workspace with ON and a modified/unavailable extension makes reconciliation fail; old `state.config` and filesystem roots remain, while `workspace_dir` identifies the new workspace. Switch also disposes PTYs before this new fallible operation.
- Correction: perform fallible lifecycle preparation before publishing any workspace identity; publish config, directory, sandbox and resolver state together under the existing workspace guard. Test the actual endpoints with extension conflicts, not only direct helper calls.

### W6 — OFF resets accounting but in-flight workers still own/process captured bytes (high; strict purge contract)

- Evidence: `server/src/session_changes/store.rs:134-140`; `server/src/session_changes/comparison.rs:25-53,55-74,275-277`; `server/src/session_changes/inventory.rs:13-29`; `server/src/session_changes/capture.rs:187-193`.
- Comparison deep-clones baseline inventories containing `Vec<u8>` before awaiting a new blocking scan. OFF clears only service records, accounting and TempDir; these worker-local baseline/current buffers remain live, and inventory capture continues reading files while runtime reports OFF/zero retained bytes. Generation checks prevent final publication but do not cancel/drain buffer owners.
- Correction: make in-flight capture/comparison ownership cancellable/revocable and ensure the disable contract covers actual live buffers, not just the records map/atomic counter. Do not simply count zero while work retains snapshot bytes. Preserve the no-new-background-tracker design.

### W7 — Disable persistence failures lack required durable-OFF diagnostics/backup handling (medium)

- Evidence: `server/src/api/config.rs:72-85`; `server/src/api/settings.rs:217-243`.
- Import disables before backup creation. Backup failure or atomic-write failure returns an ordinary error while runtime is OFF but config/disk can remain ON. The write-failure branch also deletes the backup. The special runtime-OFF/backup diagnostic only handles reload errors, not earlier post-disable failures. Config PUT has the same generic persistence-error exit after disable.
- Correction: use one disable-applied latch/result through all post-disable exits, retain available diagnostics/backups, state explicitly that durable OFF failed, and avoid restoring/re-enabling old ON state as recovery.

### W8 — Required acceptance coverage not implemented by current lifecycle tests (medium)

- Evidence: `server/tests/session_changes_lifecycle.rs:141-191,193-250,330-347,408-467`.
- The named publication-race test disables before capture starts. The newer concurrent test yields once on a default single-thread Tokio runtime, ignores join results, and has no barrier proving the worker reached capture/publication; it cannot exercise the queued-writer recursive-lock interleaving reliably.
- Cache-clear/workspace tests invoke helpers, not actual handlers. No actual workspace-init, import/recovery failure, startup/restart, configured-path migration, enable-persistence rollback or cloned-buffer purge regression is present in this lifecycle suite.
- Correction: add deterministic synchronization and endpoint-level real-temp-filesystem regressions for these named acceptance cases; retain the existing happy-path tests.

## Suggestions

1. Consolidate startup, update, import and reload into one lifecycle preparation/publication result. Current repeated installation/disable logic caused the inconsistent rollback/error behavior above. Keep the solution small; no general transaction framework needed.
2. Move synchronous installer filesystem reads, hashing, writes and `sync_all` off Tokio runtime workers, while retaining serialized transition ownership. Current calls perform blocking I/O while the workspace write guard is held (`api/config.rs:38-88,783,797`).
3. Reduce new public internals: `reload_config_locked` and `reconcile_and_publish_config_locked` are public only for integration-test access, and `lifecycle` is public mutable synchronization state. Prefer narrow domain operations/test routing so future callers cannot bypass required locking.
4. Update Phase 01 documentation/task status only after the coordinator accepts fixes and fresh verification. Current pending status is consistent with incomplete acceptance; no plan edits made by this reviewer.

## Positive observations

- Dedicated bundled asset/path and shared header/path helpers avoid a second installation convention.
- Real body hash verification, CRLF normalization, static symlink/special-file checks and a 1 MiB extension bound retained.
- Extension independence test compares actual Agent Status bytes before/after install/removal.
- Default OFF avoids TempDir payload allocation; producer and public entry points now reject OFF.
- Post-blocking-I/O generation checks correctly prevent many stale publication paths; generation-aware accounting helpers themselves hold their read guard through accounting mutation.
- No additional background scanner, database or UI-local enablement authority introduced. Existing protocol tests explicitly opt in.

## Reviewed files

Product changes:
- `server/src/agent_status/{integration.rs,mod.rs}`
- `server/src/api/{config.rs,settings.rs,workspace.rs,session_changes.rs}`
- `server/src/config/{schema.rs,parser.rs,tests.rs}`
- `server/src/main.rs`
- `server/src/persistence/restore.rs`
- `server/src/session_changes/{binding.rs,capture.rs,capture_tests.rs,comparison.rs,comparison_tests.rs,control.rs,store.rs}`

Tests/migrations:
- `server/tests/{agent_status_integration.rs,auth_backend_startup.rs,session_changes_adversarial.rs,session_changes_api.rs,session_changes_controls.rs,session_changes_lifecycle.rs,session_changes_protocol.rs}`

Supporting evidence:
- `server/src/api/agent_status.rs`, `server/src/state.rs`, `server/src/session_changes/inventory.rs`
- `README.md`, `docs/{project-overview-pdr.md,code-standards.md,system-architecture.md}` (relevant sections)
- `plans/261031-0949-lightweight-session-changes-refactor/{plan.md,phase-01-config-and-extension-lifecycle.md}`

## Validation commands/results

Reviewer executed only read-only diff/status inspection (`git diff --stat`, `git status --short`, scoped `git diff`); no build/test/lint reruns or source edits. Main/tester owns execution.

Read `agent://Phase01TesterRerun` terminal evidence. **Peer-reported results, not independently rerun; appear to predate current working tree**: report lists 6 lifecycle tests, whereas current source contains 7; it also reports an unused import already removed in the reviewed diff. Do not treat them as fresh verification of this exact snapshot.

| Command | Peer-reported result |
|---|---|
| `cargo check --manifest-path server/Cargo.toml` | exit 0 |
| `cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle` | 6 passed |
| `cargo test --manifest-path server/Cargo.toml --test agent_status_integration` | 20 passed |
| `cargo test --manifest-path server/Cargo.toml --test session_changes_protocol --test session_changes_controls --test session_changes_api --test session_changes_adversarial` | 6 passed across four targets |
| `cargo test --manifest-path server/Cargo.toml config` | 164 passed, filtered scope |
| `cargo test --manifest-path server/Cargo.toml persistence::restore` | 9 passed |

Build/typecheck for the current snapshot: unverified by reviewer. No TypeScript changes reviewed; type/test coverage percentages not measured. Lint not run. Existing passing tests do not establish the failure/race acceptance cases above.

## Unresolved questions

- Fresh validation evidence for the exact reviewed/current snapshot remains outstanding with the coordinator/tester. No missing repository/design information blocks the proposed corrections.
