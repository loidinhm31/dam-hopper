# Code Review — Phase 01, Cycle 3 Final

## Overall assessment

**Score: 6/10. Disposition: changes required; Phase 01 acceptance incomplete.**

No critical issue identified. Five high-priority and two medium-priority warnings remain. Cycle 3 adds a partial configured-path rejection and restores disposal-before-publication ordering, but neither closes its failure contract. Cleanup status, worker-byte purge and disable/recovery diagnostics remain unresolved. A further configuration-writer race exists in telemetry settings.

Applied installed `code-review` skill, published development rules and repository standards. Review-only assignment: no source, test, plan or task-state changes; this report is the only created artifact. Failure scenarios below are static deductions **[INFERENCE]**, not runtime reproductions. Phase 02 engine replacement and Phase 04 UI implementation are not required prematurely by this review.

## Critical issues

None identified. The previous recursive lifecycle-read pattern remains absent: guarded capture publication uses non-locking `release_storage()` at `server/src/session_changes/capture.rs:307-325`.

## Warnings

### W1 — ON path-change rejection is bypassable and not serialized — High

- Evidence: `server/src/api/config.rs:290-298,362-393,496-497`; effective fallback resolution at `server/src/api/agent_status.rs:124-144`; nullable field at `server/src/config/schema.rs:894-902`.
- The new comparison executes only for a nonempty explicit candidate path. Clearing an existing custom path with `ompAgentDir: null`, an empty/whitespace string, or `agentSettingsPaths: null` skips it and changes the effective directory to the default/environment directory while tracking remains ON.
- Neither global UI handler/helper acquires `workspace_context_guard`. A global settings update can observe OFF, then publish a new directory after concurrent enable installed at the old directory. Resolving the current path with `.ok()` also silently removes the rejection on resolution failure.
- Impact: disable targets the wrong directory; the old managed extension survives and later ON reconciliation may produce two installations.
- Correction: under the same serialized transition guard, resolve effective old and candidate directories, including unset/default cases; reject any effective change while ON before persistence. Fail closed on resolution errors. Include global-config replacement writers in this discipline.
- Confidence: high. Cycle 2 W1 only partially addressed.

### W2 — Cleanup conflicts still produce success without actionable status — High

- Evidence: `server/src/api/config.rs:80-84,95-96,808-825`; `server/src/api/settings.rs:11-19,220-224,269-275`; regression explicitly expects success at `server/tests/session_changes_lifecycle.rs:394-405`.
- PUT/import discard the initial uninstall result. Shared OFF reconciliation logs modified-file/other cleanup failures and returns `Ok(())`; directory-resolution errors are silently skipped. Responses contain no conflict or partial-cleanup outcome.
- Impact: runtime OFF and preservation of user content are correct, but operators receive successful disable/import/cache-clear responses without the information needed to remove the retained extension. Approved design explicitly requires surfacing this conflict.
- Correction: propagate a small typed cleanup outcome through reconciliation and persistence, publish/persist OFF despite cleanup conflict, then expose the preserved target, reason and manual action through the server response/status. Do not simply return early before persisting OFF. Reuse the result for startup diagnostics.
- Confidence: high. Cycle 2 W2 unresolved.

### W3 — Purge still leaves in-flight workers holding bytes and reading files — High

- Evidence: `server/src/session_changes/store.rs:136-143`; `server/src/session_changes/comparison.rs:25-64,275-277`; `server/src/session_changes/capture.rs:187-190`; `server/src/session_changes/inventory.rs:13-29,36-62`; `server/src/api/session_changes.rs:227-252`.
- `disable_and_purge()` clears service-owned records/counters/TempDir only. Comparison deep-clones the baseline, including `CapturedFile.bytes: Vec<u8>`, before awaiting a blocking inventory. Capture/from-now workers receive no cancellation signal. These allocations and reads can survive completed OFF; counters report zero meanwhile.
- Impact: generation fencing correctly prevents stale publication, but is not actual purge of outstanding worker-owned content. This violates Phase 01's explicit cloned-ownership/retained-byte contract and creates misleading resource/privacy semantics.
- Correction: fence admission/publication, cancel at scan checkpoints and drain/drop outstanding byte-owning work before reporting purge completion. Keep this within the existing service rather than adding a second tracker/background subsystem.
- Confidence: high. Cycle 2 W3 unresolved.

### W4 — Workspace preflight validates path syntax, not fallible extension preparation — High

- Evidence: `server/src/api/workspace.rs:191-203`; resolver at `server/src/api/agent_status.rs:90-144`; actual installation/failure at `server/src/api/config.rs:792-805`; modified-file rejection at `server/src/agent_status/integration.rs:572-575`.
- The new preflight merely resolves a lexical absolute path. It does not check target ownership, directory existence/type, symlinks, or whether installation can complete. Actual install still runs after `pty_manager.dispose()`.
- Scenario: switch to an ON workspace while the Session Changes target is modified/unmanaged. Lexical resolution succeeds, old terminals are disposed, installation fails, and the handler returns without switching workspace/config. Missing directories and installation I/O failures have the same destructive ordering.
- Impact: a rejected switch kills existing sessions. Cycle 2's publish-before-disposal inconsistency is removed, but its predecessor's destructive-preparation failure is back.
- Correction: separate real fallible lifecycle preparation/staging from final publication. Complete preparation before disposal; if disposal fails, rollback only newly prepared owned files. After successful disposal, publish config/workspace/sandbox consistently without repeating unprepared fallible install work. Merely moving the whole reconciliation across disposal is insufficient in either direction.
- Confidence: high. Cycle 2 W4 only partially addressed.

### W5 — Disable safety latch and durable-OFF failures remain incomplete — Medium

- Evidence: `server/src/api/config.rs:80-95,801-805`; `server/src/api/settings.rs:217-246`.
- Import disables before backup creation. Backup failure returns a generic error; atomic-write failure deletes the available backup and also returns a generic error. PUT returns its raw write error after disabling. Disk/in-memory configuration can remain ON while runtime is OFF, without explicit durable-OFF failure information.
- The import latch describes only requested ON-to-OFF. ON-to-ON installation failure also calls `disable_and_purge()`, but then executes ordinary old-bytes/old-ON recovery. A transient installation failure can therefore be followed by automatic re-enablement after an actual disable.
- Impact: operators cannot distinguish runtime OFF from durable OFF; recovery may re-enable after the fail-safe latch should be authoritative.
- Correction: carry the actual disable-applied outcome through every exit/recovery path. Retain available backups, explicitly identify durable-OFF failure and remediation, and overlay OFF when restoring unrelated fields. Never automatically restore ON once reconciliation has disabled tracking.
- Confidence: high on diagnostics/backup exits; medium-high on the transient ON-to-ON recovery scenario. Cycle 2 W5 unresolved.

### W6 — Regressions do not establish the claimed failure/race guarantees — Medium

- Evidence: `server/tests/session_changes_lifecycle.rs:89-139,141-250,330-347,394-405,408-467`; installer assertions at `server/tests/agent_status_integration.rs:910-1039`.
- No consecutive `enable()` or ON-to-ON capture-generation assertion. The named publication-race test disables before capture begins. The concurrent test uses `yield_now()` and discards both task results; it proves neither an in-flight publication boundary nor release of worker-local buffers.
- Cache-clear/workspace tests call helpers rather than their actual handlers. No new cycle-3 regressions cover null/default/concurrent directory transitions, extension-preflight failure with existing PTYs, persistence/backup/recovery failures, or actionable conflict responses.
- Correction: deterministic barriers at worker/publication ownership boundaries; assert both join outcomes; exercise real handlers against isolated filesystem/config/agent paths. Add the accepted unchanged-generation and validation/rollback regression cases as well.
- Confidence: high. Cycle 2 W6 unresolved.

### W7 — Telemetry settings can overwrite a completed OFF with stale ON config — High

- Evidence: `server/src/api/usage.rs:251-256,298-308,354-370`; serialized OFF writer at `server/src/api/config.rs:38-39,80-95`.
- Telemetry settings clone the entire config under only `telemetry_coordinator`, perform asynchronous work, then write that clone to disk and directly replace `state.config`. They neither acquire the workspace lifecycle guard nor reconcile Session Changes.
- Scenario: telemetry update captures ON; concurrent PUT disables, purges and persists OFF; telemetry finishes and writes its stale ON clone. Runtime stays OFF, but config/disk return to ON and the next restart re-enables without a new ON request. The reverse ordering can overwrite a completed enable with stale OFF.
- Impact: the new setting is not protected across all existing full-config writers. This is an integration race, not a request to redesign telemetry.
- Correction: serialize this writer under the same configuration transition boundary with consistent lock order, preserve the latest protected fields, and route any full-config publication through the lifecycle policy. Add a barrier-controlled concurrent telemetry-update/OFF regression.
- Confidence: high. Newly identified in Cycle 3.

## Suggestions

1. **KISS/DRY / architecture:** consolidate preparation, disable outcome, persistence handling and publication into narrow lifecycle operations. Policy currently repeats in PUT, import, shared reconcile and startup. A small transition result is sufficient; no general transaction framework or new tracking subsystem needed.
2. **Performance:** move managed-file reads, hashing, writes and `sync_all()` off Tokio runtime workers (`server/src/agent_status/integration.rs:472-474,595-604`). Avoid retaining hot locks through blocking work; preserve serialization and publication fences.
3. **Encapsulation:** `SessionChangesService.lifecycle` is publicly mutable (`store.rs:82`); public `_locked` config helpers rely on an unenforced caller precondition (`config.rs:757,763`). Prefer narrow methods/explicit guard ownership without widening the production API just for tests.
4. **Security hardening, inherited helper limitation:** managed status checks/read and later replace/unlink are separate path operations (`integration.rs:442-472,577-604,626-627`). They reject static symlinks but are not descriptor-identity/no-follow race-proof, and the metadata-only size check does not bound a concurrently growing read. If hostile concurrent local writers are supported, use bounded descriptor reads and identity-checked descriptor-relative mutation. This is not evidence of a new remote authentication bypass.

## Positive observations / requested-fix disposition

- **Non-locking storage release:** correct at guarded capture publication; previous recursive-read issue remains removed.
- **Idempotent enable:** preserves generation while already ON (`store.rs:127-133`). Source-level confirmation; dedicated regression missing.
- **Validation/rollback:** PUT renders/parses before installation/write, normalizes the setting casing, and limits failed-write uninstall to a previously absent installation (`config.rs:47-75,87-91,645-648`). No longer uninstalls a pre-existing current/outdated owned file merely because persistence failed.
- **Managed ownership:** dedicated bundle/path with shared SHA-256 body verification; Agent Status byte independence, outdated upgrade, modified refusal and CRLF behavior are asserted in the installer suite.
- **Default OFF:** no TempDir/baseline payload allocation on construction. Producer/public admission gates and post-I/O generation fencing remain present.
- No new database, background tracker, UI-local authority or speculative abstraction introduced. No new injection/authentication flaw identified in inspected changes.

## Reviewed files

Implementation/scoped diffs:
- `server/src/agent_status/{integration.rs,mod.rs}`
- `server/src/api/{config.rs,settings.rs,workspace.rs,session_changes.rs}`
- `server/src/config/{schema.rs,parser.rs,tests.rs}`
- `server/src/main.rs` — startup wiring
- `server/src/persistence/restore.rs` — exhaustive constructor
- `server/src/session_changes/{binding.rs,capture.rs,comparison.rs,control.rs,store.rs}`
- `server/src/session_changes/{capture_tests.rs,comparison_tests.rs}` — explicit opt-in migrations
- `server/tests/{agent_status_integration.rs,session_changes_lifecycle.rs}`
- Scoped fixture/import diffs: `server/tests/{auth_backend_startup.rs,session_changes_adversarial.rs,session_changes_api.rs,session_changes_controls.rs,session_changes_protocol.rs}`

Supporting evidence:
- `server/src/api/agent_status.rs:71-145`
- `server/src/api/usage.rs:251-278,298-376`
- `server/src/session_changes/inventory.rs:1-125`
- `server/src/pty/manager.rs:2695-2785,5380-5425`
- `README.md:1-124`; relevant PDR, code-standards and system-architecture sections
- `plans/261031-0949-lightweight-session-changes-refactor/{plan.md,phase-01-config-and-extension-lifecycle.md}`
- Approved design lifecycle/acceptance excerpts and Cycle 2 review

Approximately 3,000 implementation/test/context lines inspected. Updated plans: none, per assigned no-task-tracking ownership. Phase 01 acceptance remains incomplete; no task completion asserted.

## Validation commands/results

Reviewer executed read-only `git diff --stat`, `git status --short`, scoped `git diff`, repository searches/reads and `date +%y%m%d`. No build/test/lint commands rerun: coordinator owns execution; reported failures were not rerun to confirm them.

Current-cycle coordinator evidence inspected at `history://Main:1450-1470`:

| Command | Observed record / limitation |
|---|---|
| `cargo check --manifest-path server/Cargo.toml` | Initial invocation recorded error; coordinator subsequently edited workspace event broadcast and final invocation recorded `ok` at line 1462. Full compiler output not exposed by the inspected transcript rendering. |
| `cargo test --manifest-path server/Cargo.toml --test session_changes_lifecycle --test agent_status_integration --test …` | Recorded `ok` at line 1466. Remaining target arguments/full test output/counts truncated in the available record; not independently reproduced. |
| `cargo test --manifest-path server/Cargo.toml config && cargo test --manifest-path server/Cargo.toml persistence::restore` | Recorded `ok` at line 1470. Full per-suite counts/output unavailable in the inspected rendering. |

Recorded success is not proof of the absent boundary/failure cases. Type coverage/test coverage percentages not measured. Lint not run by reviewer. No TypeScript change in this review scope; no deployment/live OMP qualification performed.

## Recommended actions

1. Close W1-W4 and W7 before accepting Phase 01: serialized effective directory ownership, visible partial cleanup, real worker drain and non-destructive workspace preparation.
2. Carry actual disable outcomes through all persistence/recovery exits (W5).
3. Add deterministic handler/concurrency regressions (W6), then coordinator runs the phase-prescribed checks on the final coherent snapshot and retains full logs.

## Unresolved questions

- Exact current-cycle integration target list, assertion counts and full validation logs are unavailable in the inspected coordinator transcript rendering; retain/attach those artifacts for acceptance.
- Are hostile concurrent local writers replacing managed extension paths in the supported threat model? This determines whether inherited descriptor-level hardening is a required security gate.
