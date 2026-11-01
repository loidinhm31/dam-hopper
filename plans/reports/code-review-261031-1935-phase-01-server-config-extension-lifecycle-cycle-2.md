# Code Review — Phase 01, Cycle 2

## Overall assessment

**Score: 6.5/10. Disposition: changes required; Phase 01 acceptance incomplete.**

Cycle 2 removes the previously identified recursive lifecycle-read pattern, makes already-enabled `enable()` generation-stable, resolves configured OMP paths, validates rendered PUT candidates before mutation, and limits failed-write uninstall rollback to files absent before enable. Workspace lifecycle preparation now precedes workspace-directory mutation. These are substantive improvements. Remaining gaps concern cleanup visibility, configured-path transitions, actual in-flight byte purge, durable-OFF failure handling, and a newly exposed workspace-disposal ordering failure.

Applied installed `code-review` skill and repository/home development rules. Review only: no product, test, plan, or task-state edits. Report is the only created artifact. Approximately 3,000 implementation/test/context lines examined. Failure scenarios below are static deductions **[INFERENCE]**, not runtime reproductions. Phase 02 engine replacement and Phase 04 UI work are not demanded at this phase boundary.

## Critical issues

**None identified in this cycle.** Previous C1's specific nested-read deadlock pattern is absent: under the lifecycle read guard, capture CAS/replacement paths now call non-locking `release_storage()` (`server/src/session_changes/capture.rs:300-325`). No deterministic queued-writer regression was added, so this is a source-level conclusion, not a reproduced concurrency result.

## Warnings

### W1 — Configured path resolution fixed, but live path transitions still unmanaged — High

- Evidence: `server/src/api/config.rs:362-392,486-488,818-827`; lifecycle install/remove at `782-813`.
- Global UI updates still persist a new `ompAgentDir` without acquiring the workspace lifecycle guard, reconciling the extension owner, or rejecting a change while tracking is ON.
- Scenario: enable at directory A, change configured path to B, then disable. Cleanup targets B; A's managed extension survives. ON reload may also install a second copy at B while leaving A untouched. A concurrent path edit can change the resolver between PUT preinstallation and reload.
- Impact: wrong physical lifecycle/ownership and misleading successful settings changes. This is the unfinished half of previous W1; configured directory selection itself is now corrected.
- Correction: under the same serialized transition boundary, compare effective old/new paths and reject ON path changes before persistence, or safely migrate owned installations. Rejection is the smaller acceptable design. Add A-to-B and concurrent update coverage.
- Confidence: high.

### W2 — OFF cleanup failures still return success — High

- Evidence: `server/src/api/config.rs:80-84,799-815`; `server/src/api/settings.rs:220-224,269-275`; test explicitly accepts success at `server/tests/session_changes_lifecycle.rs:394-405`.
- Modified-file uninstall conflicts and other cleanup errors are discarded or logged; directory-resolution failure is silently skipped. PUT/cache-clear/import/workspace callers can report success without conveying that the extension remains installed.
- Impact: operators cannot discover the manual cleanup required by the approved design. Runtime OFF and preservation of user modifications are correct, but do not satisfy the actionable conflict contract.
- Correction: carry a typed cleanup outcome through publication/persistence; keep OFF authoritative and durable where possible, then expose the conflict/partial-cleanup status. Do not return early and thereby skip OFF persistence. Reuse the same outcome for startup diagnostics.
- Confidence: high. Previous W3 remains open.

### W3 — Purge does not revoke in-flight captured buffers or stop file reads — High

- Evidence: `server/src/session_changes/store.rs:136-143`; `server/src/session_changes/comparison.rs:25-64,275-277`; `server/src/session_changes/capture.rs:187-190`; `server/src/session_changes/inventory.rs:13-29,36-62`; `server/src/api/session_changes.rs:227-252`.
- `disable_and_purge()` clears only service-owned records, accounting and TempDir. Comparison deep-clones baseline `Vec<u8>` data before awaiting a blocking inventory scan. Capture/scan closures do not receive a revocation/cancellation signal. Their buffers can outlive OFF and scanning can continue while the counter reports zero.
- Impact: generation fencing prevents late publication, but does not fulfill Phase 01's explicit requirement to purge actual retained bytes, including outstanding workers/cloned ownership. Memory/accounting and privacy semantics diverge.
- Correction: make worker byte ownership revocable/cancellable and include worker drain/drop in disable completion. Stop scans at cancellation checkpoints; fence admission/publication and wait until retained worker buffers are released before claiming completed purge. Keep this in the existing service, without a second tracker/background subsystem.
- Confidence: high. Previous W6 remains open.

### W4 — New workspace ordering publishes before fallible PTY disposal — High

- Evidence: `server/src/api/workspace.rs:191-195`; publication at `server/src/api/config.rs:758-773`; disposal errors at `server/src/pty/manager.rs:2733-2769`; existing regression `server/src/pty/manager.rs:5380-5425` proves disposal can fail while retaining the old PTY.
- The moved ordering fixes failure during extension preparation, but `switch_workspace()` now publishes the new config, sandbox and monitor before `pty_manager.dispose()?`. On durable session-removal failure, the handler returns before updating `workspace_dir` or emitting `workspace:changed`.
- Impact: new config/sandbox plus old workspace directory and potentially surviving old PTYs; an errored switch has already changed server authority. The existing manager failure path makes this more than a hypothetical infallible operation.
- Correction: split fallible lifecycle preparation from publication. Prepare/check target lifecycle, perform disposal with an explicit failure outcome, then publish config/directory/sandbox as one successful guarded transition. Do not solve this by merely moving disposal before extension preparation, which reinstates the previous destructive failure path.
- Confidence: high. Previous W5 is only partially resolved.

### W5 — Post-disable persistence failures still lack durable-OFF diagnostics and backup retention — Medium

- Evidence: `server/src/api/config.rs:80-95`; `server/src/api/settings.rs:217-246`.
- Import disables before creating its backup. Backup failure returns immediately; atomic-write failure deletes the available backup and returns a generic error. PUT likewise returns the raw write error after disabling. These branches leave runtime OFF while in-memory config/disk may remain ON, without the required explicit durable-OFF failure message. Only import reload failure has special handling.
- Additionally, import's latch describes only the requested ON-to-OFF change, not whether reconciliation actually disabled the service: ON-to-ON install failure calls `disable_and_purge()` at `config.rs:791-795`, yet follows ordinary old-config recovery at `settings.rs:245-246`. A transient installer failure can therefore be followed by automatic old-ON reenablement.
- Correction: propagate an actual disable-applied safety latch/result through every post-disable exit and recovery branch. Retain available backup/diagnostic artifacts, explicitly distinguish runtime OFF from durable OFF, and never automatically restore old ON after disable/cleanup error.
- Confidence: high for error/backup exits; medium-high for transient ON-to-ON recovery scenario. Previous W7 remains open.

### W6 — Regression coverage does not qualify the cycle's failure/race contracts — Medium

- Evidence: `server/tests/session_changes_lifecycle.rs:89-139,141-250,330-347,394-405,408-467`; added installer tests at `server/tests/agent_status_integration.rs:910-1039`.
- No second consecutive `enable()` assertion or ON-to-ON reload-during-capture test. The named race test disables before capture starts. The concurrent test uses `yield_now()` rather than a barrier and discards both join results; it cannot prove capture reached the relevant publication/queued-writer point.
- Cache-clear/workspace tests invoke helpers, not actual handlers. No endpoint-level workspace init/switch conflict or disposal failure, configured-path transition, PUT validation/persistence rollback, startup/restart, import backup/write/recovery failure, or in-flight cloned-buffer drain regression exists in this suite.
- Correction: add deterministic barriers at worker/publication ownership boundaries, assert join results, and exercise the actual endpoints against isolated temporary config/agent paths. Preserve the useful installer independence/ownership tests.
- Confidence: high. Previous W8 remains open.

## Suggestions

1. **KISS/DRY:** consolidate lifecycle preparation/publication/outcomes. Installation and disable/remove policy currently repeat in PUT, import, reload/reconcile and startup. One small transition result is sufficient; no generic transaction framework needed. `_current_cfg` being unused in lifecycle reconciliation also leaves owner transitions unmodelled.
2. **Performance:** move managed file reads/hashing/writes/`sync_all()` off Tokio runtime workers. `install_extension_internal()` performs blocking filesystem work (`integration.rs:595-604`) during workspace-guarded config transitions. Keep serialization without holding hot locks through unnecessary blocking work.
3. **Encapsulation:** prefer narrow lifecycle operations over public mutable synchronization state (`store.rs:82`) and public `_locked` helpers whose lock precondition is unenforced (`api/config.rs:747,753`). Current integration-test access need not become a general bypass API.
4. **Security hardening, existing helper limitation:** managed status/read and later persist/unlink are separate path operations (`integration.rs:442-472,577-604,626-627`). They reject static symlinks but are not race-proof against local path replacement, and metadata-only size checks do not bound a concurrently growing read. If hostile/concurrent local writers are in the supported threat model, use descriptor-relative/no-follow bounded reads and identity-checked replacement. This is inherited shared-helper behavior, not a newly introduced auth bypass.

## Positive observations / cycle-1 disposition

- Previous C1 recursive read: specific pattern removed; accounting release is non-locking while guarded.
- Previous W2 generation leak: `enable()` is now generation-stable when already ON (`store.rs:127-133`).
- Previous W4 invalid candidate/rollback: PUT renders/parses/validates before installation/write, tracks pre-install absence, and normalizes `sessionChangesEnabled` to TOML snake_case (`config.rs:47-75,87-91,635-638`). Existing current/outdated files are no longer uninstalled merely because persistence failed.
- Configured effective-home resolver reused, not duplicated.
- Dedicated asset/path and shared managed SHA-256 ownership helpers preserve Agent Status independence. Tests compare actual Agent Status bytes before/after Session Changes operations.
- Default OFF avoids TempDir/baseline allocations. Producer/public admission checks and post-I/O generation fencing remain present.
- No new database, background tracker, UI-local enablement authority or speculative abstraction introduced.

## Reviewed files

Product/domain:
- `server/src/agent_status/{integration.rs,mod.rs}`
- `server/src/api/{config.rs,settings.rs,workspace.rs,session_changes.rs}`
- `server/src/config/{schema.rs,parser.rs,tests.rs}`
- `server/src/main.rs` — startup wiring diff
- `server/src/persistence/restore.rs` — exhaustive constructor diff
- `server/src/session_changes/{binding.rs,capture.rs,comparison.rs,control.rs,store.rs}`

Tests/migrations:
- `server/src/session_changes/{capture_tests.rs,comparison_tests.rs}` — opt-in diffs
- `server/tests/{agent_status_integration.rs,session_changes_lifecycle.rs}`
- `server/tests/{auth_backend_startup.rs,session_changes_adversarial.rs,session_changes_api.rs,session_changes_controls.rs,session_changes_protocol.rs}` — scoped diffs

Supporting context:
- `server/src/api/agent_status.rs:71-145`
- `server/src/session_changes/inventory.rs:1-105`
- `server/src/pty/manager.rs:2695-2782,5380-5425`
- `server/src/state.rs` — lifecycle/ownership search context
- `README.md:1-124`, relevant sections of `docs/{project-overview-pdr.md,code-standards.md,system-architecture.md}`
- `plans/261031-0949-lightweight-session-changes-refactor/{plan.md,phase-01-config-and-extension-lifecycle.md}`
- Approved design and cycle-1 review report.

Updated plans: none, per assigned no-task-tracking constraint. Existing pending Phase 01 status remains appropriate.

## Validation commands/results

Reviewer ran read-only inspection commands: `git status --short`, `git diff --stat`, scoped `git diff`, plus report-date lookup. No build/test/lint reruns: coordinator owns execution.

Coordinator transcript `history://Main:1335-1371` records these Cycle 2 validation invocations:

| Command | Recorded result / limitation |
|---|---|
| `cargo check --manifest-path server/Cargo.toml` | Initial run failed: missing `PathBuf` import. Import then added; two later invocations recorded `ok`, including after removal of obsolete writer helper. |
| `cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle --test agent_status_integration ...` | Recorded `ok`; transcript rendering truncates the remaining target list and does not expose assertion counts or full output. Not independently rerun. |
| `cargo test --manifest-path server/Cargo.toml config && cargo test --manifest-path server/Cargo.toml persistence::restore` | Recorded `ok`; full per-suite output/counts unavailable in inspected transcript rendering. Not independently rerun. |

Do not interpret successful command records as qualification of the absent failure/race cases above. Type/test coverage percentages not measured; lint not run. No TypeScript changes in review scope.

## Recommended actions

1. Resolve W1–W4 before accepting Phase 01; retain the corrected default-off/generation/ownership behavior.
2. Carry actual disable outcomes through persistence/recovery and surface cleanup conflicts without undoing OFF (W2/W5).
3. Add deterministic endpoint/race regressions (W6), then coordinator runs phase-prescribed compile, installer/lifecycle, config and persistence scopes once on the final snapshot.

## Unresolved questions

- Exact Cycle 2 test target list, assertion counts and full output remain unavailable in the inspected coordinator transcript rendering; coordinator should attach its retained validation artifacts.
- Is adversarial concurrent local replacement of managed-extension paths inside the supported threat model? This determines whether the inherited helper hardening suggestion is a required security gate.
