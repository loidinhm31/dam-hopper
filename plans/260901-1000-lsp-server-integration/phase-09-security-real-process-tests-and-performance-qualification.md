# Phase 09 — Security, Real-Process Tests, and Performance Qualification

## Context links

- Parent authority: [latest Validation Summary and phase ledger](./plan.md#validation-summary).
- Direct dependencies: [Phase 03 initial enforced policy](./phase-03-pinned-tool-provisioning-and-resource-controls.md), [Phase 08 integrated lifecycle](./phase-08-lifecycle-invalidation-and-recovery.md); Phase 08 transitively requires the implemented Phases 02–07 and Phase 01 stop/go proof.
- Repository: [backend API tests](../../server/src/api/tests.rs), [filesystem tests](../../server/tests/fs_sandbox.rs), [worktree tests](../../server/tests/project_worktree_lifecycle.rs), [settings import tests](../../server/tests/settings_import_export.rs), [current auth watcher](../../server/src/api/ws.rs), [browser runner](../../packages/ui/vitest.browser.config.ts), [application fixtures](../../packages/ui/e2e/fixtures/application-fixture.ts), [test tiers](../../docs/testing.md).
- Historical evidence: [accepted architecture decision](../reports/brainstorm-260901-1000-lsp-server-integration.md#acceptance-criteria), [tool/resource research](./research/researcher-02-tsls-provisioning-resource-controls.md). Neither constitutes current process/platform qualification.

## Overview

- Date: 2026-10-23
- Description: Qualify actual bundled Linux TSLS, deterministic process failure/security boundaries, bounded adaptive sync, and core responsiveness; select final measured release limits.
- Priority: P1
- Implementation status: Pending (0%)
- Review status: Plan reconciliation completed; no implementation, measurement, or runtime qualification executed.
- Effort: 40h, provisional; expanded real-process trust/auth/write-path matrix, hard/portable tree controls, and repeatable performance qualification replace the historical 28h assumption.

## Key Insights

- Phase 01 records finite executable spike settings before any process/exposure; Phase 03 already enforces conservative initial limits. This phase tunes bounded working behavior, not first establishes safety.
- Real deterministic child processes prove failure timing/framing/tree cleanup; the exact packaged Node/TypeScript/TSLS tuple proves actual semantics, engine resolution, and project-code-loading restrictions. Neither alone replaces the other.
- Trusted workspaces only: child can read with the server account's filesystem authority. Gateway URI/result containment prevents client exposure/navigation, not arbitrary child filesystem reads or an OS sandbox.
- Portable-only is a required runnable degraded mode. Node heap policy and sampled RSS termination are not hard RSS guarantees; cgroup controls must contain the semantic descendant tree without starving the daemon/core.
- Baseline method and numerical acceptance budget must be recorded before the final qualification run; no changing workloads/budgets to make a failed final run pass.
- Only Linux x64 server + web TS/JS can qualify here; all native including Linux Tauri, Windows, and Android remain deferred, unqualified, non-blocking.

## Requirements

- Run real packaged tuple offline with manifest/hash/version identity; prove no PATH/package-manager/network fallback, alternate SDK/TSLS command, arbitrary client init/config/command field, or host flag/env/config/import/API/UI override path.
- Adversarial project fixtures cover TypeScript/TSLS plugin loading, workspace-selected SDK/tsserver paths, project package resolution/hook surfaces, inherited Node preload/loader/environment hooks, and selected tuple-specific execution mechanisms. A project-code marker must never execute; exact denial configuration and observed resolver/process evidence are required. If any required restriction is unprovable, return to Phase 01 stop/go, not a warning.
- Security matrix across actor × write path × operation: current Admin success, ordinary User denied, no-auth dev User denied, unauthenticated denied, demoted/stale-role Admin denied, and auth backend error/timeout denied. Paths include dedicated semantic settings, full/global raw config, workspace/settings imports, cache/reload/workspace paths affecting protected policy, and shared persistence helpers reachable from any such writer. Test omission/reset/alias/nested/unknown-field mutation and atomic failure behavior, not only UI disabling.
- Ordinary valid authenticated Users can attach/navigate when enabled. Validate exact Origin/credential/subprotocol policy and live account/session existence/enabled/revocation/auth-version/credential-version/MFA/deadline/expiry/backend checks.
- Live-auth cutoff must hold with a deliberately non-reading socket consumer and saturated output. Record detection/check/admission-cutoff/cancel/reap timings independently of close-frame delivery; 5s recheck and 2s store timeout are policy inputs, not unconditional 5s teardown promises.
- Real protocol/semantic matrix: all four extensions, multiple/null/empty/denied results, ordered unsaved sync, exact threshold and both crossings, UTF-16/non-BMP/composed/decomposed Unicode/multiline edits, full replay/resync, source-version and destination freshness, cancellation/stale/late/duplicate replies, malformed/fragmented/oversized framing, crash/ignored shutdown/backoff/overload.
- Separate simultaneous clients/sessions for the same target retain independent unsaved overlays and results. Lifecycle matrix covers document close versus whole-session cleanup, close/reopen incarnation, same-binding reconnect, endpoint/profile replacement, target/workspace/config/auth invalidation, OFF, idle, daemon shutdown, and descendant teardown.
- Measure small/medium/large fixtures in forced portable-only and, on a capable host, hard mode: payload/serialization and sync costs, cold-ready/warm navigation p50/p95, queue/in-flight/overlay pressure, timeout/cancel/stale/overload/restart counts, whole-child-tree CPU/RSS/task counts, Axum/FS/Git/workspace and terminal latency/drop signals, reap duration/orphan count. Every mode has an explicit matrix row: absent hard capability means unavailable/unqualified, not passed; portable-only may independently qualify Linux/web. Publish observations separately from enforced capabilities.

## Architecture

Three layers: deterministic real LSP fault process; exact offline packaged TSLS/tsserver against deterministic projects; actual server + dedicated WebSocket + browser Monaco for cross-boundary freshness. Follow repository test tiers: headless unit tests for pure policy, real processes for OS boundaries, browser tests in `browser-tests/`, actual built application journeys in Phase 10.

A focused runner reuses repository application/process fixtures and emits non-sensitive aggregate evidence, not a new production benchmark service. Record executable/tool manifest digest, fixture seed/digest, OS/kernel/control mode, baseline/load schedule, warmup/sample counts, concurrency, acceptance budgets, and run/source identity. Pin policy across the final run.

Measurement sequence: baseline semantics OFF → bounded exploratory candidate comparisons under initial limits → choose candidate threshold/limits and predeclare numerical budgets/method → fresh repeated final comparisons in forced portable-only and each hard mode being claimed. Missing hard capability does not block portable-only release qualification; record hard mode unavailable/unqualified until a capable-host run passes. A failure requires root-cause correction and a new versioned qualification record; preserve the failed result and rationale, never retroactively loosen its budget. If initial safety limits prevent representative workloads, change them explicitly with justification before candidate runs, retaining finite enforced bounds throughout.

Rollback boundary: failed protocol/version/sync, project-code denial, authorization, client URI/result containment, portable bound, tree cleanup, or core responsiveness gate blocks Phases 10–11. Missing hard-control availability alone does not: qualify portable-only startup and behavior; obtain real hard-mode evidence on a capable Linux host before claiming that mode qualified.

## Related code files

- Modify: planned `server/tests/semantic_child_process.rs`, `semantic_supervisor.rs`, `semantic_websocket.rs` and real fixture introduced by Phase 02 — deterministic failure/auth/tree contracts.
- Create: `server/tests/semantic_tsls_e2e.rs`, `semantic_resource_qualification.rs` — actual bundled tuple and bounded measured core/resource gates.
- Create: `server/tests/fixtures/semantic-small/`, `semantic-medium/`, adversarial code-loading fixtures, `generate-semantic-large.mjs` and deterministic manifest — non-sensitive reproducible inputs.
- Modify: existing `server/tests/fs_sandbox.rs`, `workspace_targets.rs`, `project_worktree_lifecycle.rs`, `settings_import_export.rs`, `auth_no_auth.rs`, and relevant auth-session suites only for changed contracts.
- Modify/Create: `packages/ui/browser-tests/semantic-navigation.browser.tsx`, planned semantic client/unit tests and existing `MonacoHost.test.tsx`/`EditorTabs.test.tsx` — real browser ordered sync, stable models, late callback/reveal behavior.
- Create: `scripts/qualify-semantic-navigation.mjs` — focused orchestration and aggregate report using existing fixture conventions.
- Modify after measurement: planned `server/src/semantic/resources.rs` and the single negotiated policy/threshold source consumed by gateway/client; no independent drifting client constant.
- Evidence: keep concise aggregate qualification record and predeclared budget with the release/test records in this plan's existing reports area; generated fixture bodies and raw process logs stay temporary.
- Delete: only disposable generated output/raw sensitive logs and unselected experiments, not deterministic fixture source/generator or failed aggregate evidence.

## Implementation Steps

1. Turn each requirement into an observable case: actor/input/action/response, child-tree/overlay/admission state, timing/control mode, expected denial or success. Confirm initial bounds and all Phase 01 stop/go proofs exist before running anything.
2. Extend a real fixture process with fragmented/coalesced frames, malformed/oversized lengths, delayed/duplicate/late replies, stderr/output floods, external URIs, crash, ignored shutdown, and spawned descendants; observe real PID/tree exit rather than mocked owner calls.
3. Run exact packaged TSLS offline on `.ts/.tsx/.js/.jsx`, nested config/project references, unsaved navigation, multiple/empty replies, and Unicode. Verify bundled TypeScript/tsserver resolution, no runtime download/package manager/PATH fallback, and no arbitrary command selection on any surface.
4. Execute adversarial code-loading fixtures for all selected tuple loading/hook paths. Observe canary non-execution plus actual bundled resolver/process behavior; prove trusted-workspace warning/restriction is documented and exercised. Do not claim this constrains server-account filesystem authority.
5. Run the actor/write-path matrix, including delayed mutation after admin demotion, forged role/body fields, no-auth dev actor, partial/omitted raw configuration, imports, reset/reload and shared writes. Initial authorization denial leaves persisted/runtime policy and children unchanged. If initially authorized OFF has already irreversibly cleaned trees when final authorization/persistence fails, require unchanged durable intent plus safe-disabled runtime and explicit mismatch/error, as Phase 06 specifies; never resurrect overlays. Admin ON remains zero-child after integrity/config checks only.
6. Attack handshake/auth/exact Origin/subprotocol/method/server-request/capability filters, attach order, binary/batch/malformed/rate/queue/message pressure, arbitrary root/options/command/edit/config/filesystem requests, and unknown command-like fields. Observe explicit bounded rejection without execution.
7. Attack input/result URI containment: unregistered/stale target, absolute/encoded traversal, separator ambiguity, symlink/sibling/root replacement, external TS library/global package. Test disclosure across responses/errors/logs, not just navigation. Windows-shaped parser inputs do not qualify Windows.
8. Run live account/session disable/delete/revoke, auth/credential version changes, MFA/deadline/expiry, backend error and store timeout, with a blocked output consumer. Prove cancellation/admission cutoff does not wait for sends; measure actual cutoff and tree-reap deadlines separately.
9. Prove adaptive equality/crossing using exact UTF-8 post-edit bytes below/equal/above initial and selected thresholds, both directions, UTF-16 event order, and full open/replay/resync. Assert identical semantic results/state with the single negotiated sync kind; no invented child ack or standard version parameter.
10. Run simultaneous different unsaved overlays for the same target. Delay results across source/destination edits, close/reopen, single-document close with another live, reconnect, endpoint edit, role/auth/target/OFF/shutdown changes. Observe no stale navigation, cross-owner replay, replacement cleanup, leaked overlay, restart loop, or orphan descendants.
11. Declare OFF baseline procedure and repeat sampling schedule for small/medium/large fixtures, warm/cold runs and core endpoints/terminal workloads. Record system noise and fixed absolute/relative regression budgets, navigation/reap deadlines, and drop/orphan acceptance before final runs.
12. Compare bounded candidate thresholds/limits, select the simplest evidence-supported policy, and freeze final candidate plus numerical acceptance budgets before fresh final runs. Never enlarge budget retrospectively to pass; keep unsuccessful aggregate runs with cause.
13. On hard-capable Linux, verify cgroup/rlimit/priority actually applies to TSLS/tsserver descendants, not the whole daemon; test CPU/memory/task pressure, out-of-budget behavior, kill/reap, and core responsiveness. On forced portable-only, prove warning/degraded reporting, successful bounded lazy use, all portable caps, overload shedding, sampled monitoring/termination limits, and tree teardown without claiming hard RSS.
14. Encode only supported measured final constants and negotiated threshold/policy, rerun final fixed-method comparisons for the chosen settings, and record achieved workloads/observations/enforcement capabilities and unqualified combinations. Preserve default OFF and zero-child ON.
15. Inspect aggregate evidence for sensitive data, remove raw/generated temporary output, and hand actual measured results plus remaining failures to Phase 10. Mark every native/Windows/Android combination deferred/non-blocking without inferred support.

## Todo list

### Core Qualification Gates
- [ ] Require existing finite initial bounds and closed Phase 01 stop/go gates.
- [ ] Complete deterministic real-process and packaged TSLS matrices.
- [ ] Prove project-code denial, bundled-only rejection, trust disclosure, and URI/result containment.
- [ ] Prove admin/User/no-auth/all-write-path authorization and slow-consumer live-auth cutoff.
- [ ] Prove independent overlays, adaptive equality/crossings, freshness, and all lifecycle tree cleanup.
- [ ] Record baseline/comparison method and numerical budgets before final run.
- [ ] Select measured final threshold/limits; qualify forced portable-only and record observed hard-mode qualification or explicit unavailable/unqualified status.
- [ ] Publish safe repeatable aggregate evidence with limitations; remove only disposable raw output.

### Receiving Checklist: Carried Forward Items from Phase 08 and Prior Phases
- [ ] Remediate Phase 08 C2: Synchronous revocation token fence on session/target before actor drain and result publication; prevent old results surviving prepare.
- [ ] Remediate Phase 08 R1: Foreign-binding dirty replay guard validating endpoint/root/actor provenance before replaying unsaved local models.
- [ ] Remediate Phase 08 W2: Socket handshake attempt isolation preventing mutable `this.ws` race during asynchronous error cleanup.
- [ ] Remediate Phase 08 W3: Per-instance Monaco manager registration tokens and unified destination target resolver.
- [ ] Remediate Phase 08 R2: Client attach `target.worktree` vs gateway `target.worktreePath` wire alignment and unopened target propagation.
- [ ] Remediate Phase 08 R3: Terminal child exit on invalidated actor before reap acknowledgment, preventing crash restart during retirement.
- [ ] Remediate Phase 08 W5: Target-scoped git worktree invalidation in git route operations (currently project-wide).
- [ ] Remediate Phase 07 W-1 / G5: Destination coordinate-to-content freshness validation before cross-tab reveal of unopened files.
- [ ] Remediate Phase 07 C-2 / G8: Live web browser Monaco definition action verification across owned/non-owned models with clean restore on OFF.
- [ ] Verify Phase 05 gateway carryovers (W-A reader loop on writer death, W-B cancelled request null id, W-C invalid id echo, W-D pre-actor overlay rejection).
- [ ] Verify Phase 06 toggle carryovers (W1 cancellation safety, W2 child leak detection, W3 re-enable block, W4 teardown timeout margin, W5 failure regression tests, W6 transition error sanitization).
- [ ] Live auth revocation harness across SQLite and MongoDB real backends.
- [ ] Non-reading socket backpressure bounds and cancellation-first teardown under slow consumers.
## Success Criteria

- Real tuple identity and malicious-project canaries show no project-controlled executable/plugin/preload/alternate SDK execution. Unproven required restriction fails the gate, not a disclaimer substituting for denial.
- All command/override inputs are rejected, including flags/env/host config/import/API/UI; no generic plugin framework or native execution route appears.
- Only current server-authorized Admin changes global runtime on every write path. Initially denied User/no-auth/unauthenticated/demoted/backend-failed mutations have no effects; a final failure after initially authorized irreversible OFF retains prior durable intent with safe-disabled actual runtime and explicit mismatch/error. Valid User navigation works when enabled.
- Live invalidation works with a stalled socket consumer: admission/cancel/reap timing is bounded and observed independently of close-message delivery. No unconditional 5s teardown claim.
- Zero unauthorized/outside-target path disclosure, stale/cancelled navigation, cross-client overlay contamination, unbounded queue/restart, or orphan descendants across all recorded boundaries.
- Below/equal/above threshold, both crossings, full replay/resync, source/destination freshness, and UTF-16 Unicode behavior are equivalent with real TSLS under the approved single sync capability.
- Final predeclared repeated comparisons satisfy numerical latency/drop/resource/reap budgets while core services remain responsive; policy limits and acceptance values are not tuned after failure to manufacture a pass.
- Forced portable-only starts and warns/reports degradation while enforcing application limits; no hard RSS or OS filesystem sandbox promise. Every claimed hard mode has observed child-tree-scoped controls and passing capable-host evidence. If hard capability is unavailable, that matrix row remains explicitly unqualified/non-blocking; Linux/web portable-only qualification does not imply hard-mode qualification.
- Evidence states exact Linux/web/tuple/workload/control coverage and measured final bounds only. Native including Linux Tauri, Windows, Android, Java and Rust gain no qualification by analogy.

## Risk Assessment

- Timing noise/overfitting: deterministic fixtures, repeated baseline/load comparisons, fixed final method/budgets, retained failed aggregate outcomes.
- Resource control harms daemon: child subtree-only placement and simultaneous real core/terminal workloads.
- Project hooks outside known surfaces: audit exact selected tuple and exercise adversarial canaries; unresolved surface returns to Phase 01 stop/go.
- Backpressure hides revocation: assert admission/cancel independent from output, not only eventual socket close.
- Fixture looks real but mocks boundary: require real executable digest/PIDs/tree exit/socket/browser behavior for each claimed boundary.

## Security Considerations

- Trusted projects only; normal target containment does not sandbox the language process's server-account filesystem authority. Canary fixtures are disposable and non-sensitive.
- Ephemeral test identities/config/workspaces; never expose tokens, source, absolute host paths, argv, environment, raw stderr, or symbols in published evidence.
- Security gates remain failures; only absent hard controls produce qualified portable-only degradation. No auth/no-auth promotion or host override exception.

## Next steps

- Phase 10 qualifies actual built web journeys/captures with authenticated Linux server after these gates pass; Phase 11 publishes only those measured qualified claims.
- Unresolved gates: Phase 01 tuple/project-loading/sync/version/destination/model feasibility must close first; final threshold/numeric limits and performance budgets remain measurement-owned here. No runtime evidence exists from this plan revision.
