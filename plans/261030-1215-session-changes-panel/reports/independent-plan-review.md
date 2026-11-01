# Independent session-changes plan review

Status: **complete initial review and single targeted follow-up; identified plan-review findings cleared**. Plan-only, read-only review; not implementation approval, final user validation or runtime qualification. Initial findings/evidence below retained as historical review, not current defects.

Final open counts: **0 execution blockers / 0 high / 0 medium**. F1/F2/F3 and Q1/Q2 settled by revised contracts/tasks; no new material defects identified within targeted follow-up scope. Initial counts were 1 blocker / 1 high / 2 medium (blocker overlapped high). No unresolved design questions from this review; runtime release gates remain unpassed.

## Scope and inspected evidence

Paths below use `P = plans/261030-1215-session-changes-panel/`, `O = /home/loidinh/WS/oh-my-pi/packages/coding-agent/src/`, `S = /home/loidinh/.omp/agent/skills/`.

Assigned artifacts inspected completely:
- `P/plan.md:1-62`; `P/contracts.md:1-158` (long consequential lines reread untruncated); `P/ownership.md:1-147`; `P/acceptance-matrix.md:1-73`.
- `P/phase-01-contracts-and-wire-types.md:1-88`; `P/phase-02-snapshot-and-comparison-engine.md:1-140`.
- `P/phase-03-server-control-and-terminal-lifecycle.md:1-190`; `P/phase-04-omp-readiness-and-managed-adapter.md:1-129`.
- `P/phase-05-owner-client-and-queries.md:1-96`; `P/phase-06-readonly-session-review-ui.md:1-132`.
- `P/phase-07-host-and-live-protocol-integration.md:1-164`; `P/phase-08-qualification-and-documentation.md:1-196` (repeated command summary at :183 truncated; equivalent complete commands at :135-139 inspected).
- `P/reports/repository-evidence.md:1-36`; `omp-lifecycle-evidence.md:1-30`; `ui-evidence.md:1-32`; `authoring-report.md:1-57`.
- `plans/reports/design-261030-0043-session-changes-panel.md:1-123`; related conflict-resolver `plan.md:16-55,185-199`.

Consequential source/spec checks:
- `README.md:1-85`; `docs/project-overview-pdr.md:1-22,46-74,96-100` (wide status-table rows not relied on); `docs/code-standards.md:20-45,112-150`; `docs/system-architecture.md:71-90,129-135,225-234,353-360`.
- `server/src/lib.rs:1-64`; `server/src/api/terminal.rs:85-255`; `server/src/api/router.rs:1-80`.
- `server/src/git/vcs_roots.rs:1-215,290-532`; `server/src/fs/secure_path.rs:61-88,553-680,1405-1463`.
- `server/src/pty/manager.rs:1505-1535,1690-1750,2620-2675,2866-2965,3440-3465`.
- `server/src/agent_status/collector.rs:1-158,154-212`; `runtime.rs:380-425,535-585`; `assets/omp-agent-status.ts:1-105,350-495,730-825`.
- `server/src/main.rs:1020-1070,1095-1157`.
- `packages/ui/src/api/ws-transport.ts:2925-3110`; `client.ts:158-177,3400-3415,3840-3860`; `ownership.ts:1-30,95-145`.
- `packages/ui/src/components/pages/WorkspacePage.tsx:610-645,1820-1925`; `components/organisms/DiffViewer.tsx:180-235,600-641`.
- `packages/ui/e2e/traditional-terminal-agents/traditional-terminal-agents.spec.ts:1-60`; `packages/ui/package.json:1-75`.
- `O/extensibility/extensions/runner.ts:125-150,1750-1830`; `O/extensibility/shared-events.ts:20-65`; `O/session/session-manager.ts:715-755,3205-3240`; `O/modes/controllers/extension-ui-controller.ts:382-401`.
- `S/planning/SKILL.md:1-111`; `references/plan-review.md:1-46`; `references/task-management.md:1-137`; `S/code-review/SKILL.md:1-143`; published AGENTS/development rules inspected.

Exclusions: no exhaustive product-source/caller audit, independent repeat of parent parser/overlap validator, full related-plan review, external research, implementation, task hydration/state edits or authored-plan edits. Supporting scout claims outside the source ranges above remain report evidence, not independently reproduced facts. No source/storage fixture exists yet to execute.

## Initial findings — historical; dispositions in targeted follow-up below

### F1 — High / execution blocker: prerequisite completion depends on descendants

- **Plan:** `P/phase-01-contracts-and-wire-types.md:15-17,34-38,63-64,84`; `P/phase-02-snapshot-and-comparison-engine.md:25-26,43,68-69,136`; `P/ownership.md:13-28,32-36`. Every phase repeats that checks wait until coherent integration; phase01's Rust types are registered only by its dependent engine.
- **Support:** installed `S/planning/references/task-management.md:79-83,94-120` requires evidence-backed prerequisite completion before dependent claiming; applicable compile/tests, smoke and review are not satisfied by authoring tests. `server/src/lib.rs:1-33` currently has no session_changes module.
- **Failure:** after freeze writes unreachable Rust types, coordinator cannot truthfully complete its applicable Rust verification; engine cannot be claimed until freeze completes. Marking freeze complete from source-only vectors violates the execution evidence gate. The same all-checks-after-descendants rule also affects later prerequisite handoffs, including adapter verification referring to integrated real OMP.
- **Impact/confidence:** legal scheduler deadlock or fabricated completion evidence; **high confidence**, deterministic contract conflict, not a runtime hypothesis.
- **Smallest correction:** give freeze `lib.rs` plus a types-only `session_changes/mod.rs` and Rust vector tests; transfer those shared paths sequentially to engine in actions/matrix/DAG. Allow main coordinator focused compile/tests/contract-smoke/review at coherent prerequisite handoffs; retain final full suites once integrated. Separate prerequisite-local evidence from descendant integration/release checks rather than requiring future descendant evidence to complete a prerequisite. Propagate to all affected task gates; no new scheduler required.

### F2 — Medium: frozen acknowledgment invariant does not distinguish from-now

- **Plan:** `P/phase-01-contracts-and-wire-types.md:34-38` freezes “no ready without received acknowledgment”; `P/contracts.md:64,72,83` also permits explicit from-now and `acknowledgment:'notApplicable'`; `P/phase-03-server-control-and-terminal-lifecycle.md:75` creates that baseline through the public operation, outside producer activation/receipt.
- **Support:** approved design `plans/reports/design-261030-0043-session-changes-panel.md:30-35,99-101` explicitly permits from-now for missing originals, while pre-first-turn acknowledgment protects session-start capture. `P/contracts.md:55` correctly scopes the receipt-only ready transition to **original** readiness.
- **Failure:** independently implemented strict TS decoder rejects a ready from-now status with notApplicable; alternatively server fabricates received acknowledgment for a user-requested capture that never had a producer receipt. The freeze currently supplies no exact valid combination to resolve the conflict.
- **Impact/confidence:** legitimate fallback unusable or misleading readiness provenance across parallel consumers; **high confidence** in the schema ambiguity.
- **Smallest correction:** freeze origin-qualified invariants: sessionStart ready/incomplete requires received; fromNow ready/incomplete uses explicitly selected acknowledgment semantics (normally notApplicable), with no first-turn claim. Add valid from-now ready/incomplete vectors and invalid cross-origin combinations to Rust/TS decoder fixtures and public/client checks.

### F3 — Medium: eligible-inventory completeness is not historical absence proof

- **Plan:** `P/phase-02-snapshot-and-comparison-engine.md:44-45,53` says complete tracked/nonignored inventory proves known absence; `P/contracts.md:87-89` simultaneously requires excluded originals remain unknown and admits newly eligible current paths. No bounded historical exclusion/eligibility provenance is specified.
- **Support:** approved design `plans/reports/design-261030-0043-session-changes-panel.md:18-20,30-31,66,70` excludes ignored capture and requires honest gaps. A complete inventory of the eligible set cannot distinguish a nonexistent path from a present ignored path outside that set; this follows directly from the selected inventory definition, not unobserved Git behavior.
- **Failure:** `secret.txt` exists but is ignored at capture, so is absent from the otherwise complete manifest. Later removing its ignore rule or force-adding it to the index makes it current-eligible. Treating nonmembership as original absence fabricates an addition/full line count; treating every new path unknown loses the specified known-addition behavior without a stated rule.
- **Impact/confidence:** incorrect original presence and diff/count fidelity after ignore/index changes; **high confidence** in missing proof requirement, not a claim the unimplemented engine already misclassifies.
- **Smallest correction:** freeze how bounded original eligibility/exclusion provenance supports absence for current-only paths; unresolved historical eligibility must remain unknown, not absent. Qualify the phase02 completeness statement and add fixtures for initially ignored content later unignored/force-added, versus a genuinely new eligible path, including truncated provenance. Do not capture ignored source bytes or add infrastructure.

## Risk surfaces reviewed without additional established defects

- Prepare/activate/receipt explicitly separates immutable preparation from public readiness. With an honest live adapter, the 12s monotonic fence is below runner's observed 30s budget; lost activation cannot produce receipt, and delayed final receipt can only name pre-turn acknowledged bytes. Runtime event-loop/abort behavior remains a required test, not proven here.
- Initial/new/fork versus resume/history/unknown capture eligibility is conservative; unknown local/remote provenance must stay unavailable. Original failure latch, explicit from-now origin and no silent recapture are stated. F2 affects schema agreement, not approved fallback scope.
- Credential-derived terminal/incarnation, immutable launch descriptor, configured target/cwd containment and target-generation publication checks preserve the intended trust boundary. Existing account policy is deliberately not a new per-user PTY ACL.
- Baseline union handles retained membership after stage/commit/ignore changes; incomplete/truncated capture cannot later become complete. F3 concerns current-only historical eligibility, not already retained paths.
- Stored immutable current revision, atomic candidate swap, decimal revisions, response leases and client sequence/owner fences coherently prevent mutable-disk detail/list mixing. No proof of implementation claimed.
- Two blocking permits held through actual task exit, bounded metadata/content/candidates/leases, cooperative cancellation and reserved fail/receipt capacity acknowledge noncancellable I/O honestly. Root-resolution question below remains.
- Normal status/process exit is correctly separated from metadata destruction. Actual TTL sweep calls remove_with_expected; no requested retention extension, and stale incarnation cleanup cannot delete replacement data by contract.
- Profile/generation/session/root/epoch/baseline/revision keys, exact incarnation resolution and a single host above shell choice align with inspected ownership seams. Existing editable Git viewer is not reused as a capability surface.
- Exact task/path ordering and related-plan serialization policy are explicit; parent parser's reported zero unordered overlaps is structural evidence only. F1 is evidence-gate feasibility despite an acyclic graph.
- Real managed OMP18.13.3/model/tool, authenticated services, actual Monaco, Linux Tauri and human visual ACCEPTED are explicit release gates. Existing shell-only E2E and source applicability are not misrepresented as those receipts. Windows producer remains unqualified; Android-native excluded.

## Checks performed / not run

Performed: actual plan/phase/contract/ownership/acceptance inspection; source-backed trust, lifetime, ordering, transport and viewer-seam review; installed task-completion contract comparison; manual failure-scenario reasoning. Required planning/code-review skills read explicitly; no automatic activation claimed.

Not run: builds, compile/typecheck, tests, linters, formatters, parser/helper execution or hydration, benchmarks, model/tool turns, browser/Monaco/Tauri launches, credential checks or visual acceptance. Parent's prior structural validation was supplied evidence, not this review's execution. No claimed runtime success. Only this report written.

## Initial questions — historical; both resolved below

1. **From-now settled propagation:** `P/contracts.md:39,83,105-109` and phase04:38-42 require exact producer baseline IDs for hidden-panel settled refresh, but do not state how an adapter with a failed/missing original learns the browser-created fromNow ID. Will an existing bounded private lookup reconcile/adopt that origin before settled controls, without clearing the original failure latch? Please freeze the handoff and its test; absence of an implementation is not itself a demonstrated defect.
2. **Bounded root resolution:** `P/contracts.md:13` allows either resolve_git_request_root or resolve_vcs_root. The former calls discover_vcs_roots (`server/src/git/vcs_roots.rs:189`), full git output/status and width-unbounded nested discovery (:38-134,315-344,453-479); outer timeout cannot bound those allocations/work. Is the selected implementation the direct canonical root validator plus bounded eligibility checks? Specify it before engine work; no assertion that the safe alternative is impossible.

## Single targeted follow-up — final disposition

Coverage: **complete for requested revisions and their affected consumer/task gates**, not a second whole-repository review. Inspected revised `P/plan.md:1-69`, `contracts.md:1-207` (root/provenance/adoption/handoff long lines reread untruncated), `ownership.md:1-158`, `acceptance-matrix.md:1-83`, `reports/authoring-report.md:1-70`.

Inspected revised phases: `phase-01-contracts-and-wire-types.md:1-102`; `phase-02-snapshot-and-comparison-engine.md:1-165`; `phase-03-server-control-and-terminal-lifecycle.md:1-218`; `phase-04-omp-readiness-and-managed-adapter.md:1-146`; `phase-05-owner-client-and-queries.md:1-105`; `phase-06-readonly-session-review-ui.md:1-149`; `phase-07-host-and-live-protocol-integration.md:1-181`; `phase-08-qualification-and-documentation.md:1-219`. Repeated long summaries not independently executable evidence; authoritative detailed verification arrays inspected.

- **F1 cleared, high confidence.** Phase01:15,25-31,37-39,51-73 now owns registered types-only Rust module plus actual vector/smoke tests and local Rust/TS compile/testing/review before children. Phase02:25-26,47,73-90 modifies those files only after freeze. Ownership:32-44,111,124 specifies sequential transfer, coherent build checkpoints and prerequisite-local rather than descendant evidence. All16 task verification arrays now distinguish local completion from integrated/release checks. Comparison/server/client/component/adapter/package gates can be exercised without their descendants; actual OMP/native/human gates remain downstream. This removes the installed task-management completion conflict identified above, without new scheduling infrastructure.
- **F2 cleared, high confidence.** Contracts:94-107 freezes exhaustive origin/state/acknowledgment combinations: sessionStart ready/incomplete requires received; fromNow uses notApplicable and makes no first-turn claim. Phase01:38,65-72 includes positive/negative vectors; phase03:75-79, phase05:37-42 and phase06:49-52 propagate legitimate fallback decoding/display. No remaining parallel-consumer ambiguity identified on this point.
- **F3 cleared, high confidence in design correction.** Contracts:111-123 replaces eligible-set negative inference with bounded metadata-only namespace trie, certified child-set completeness, opaque excluded prefixes and earliest-missing-child absence proof. Unknown/excluded/truncated ancestry remains unknown/null; later capture cannot repair original gaps. Shared10k-node/8MiB/depth64 budgets and no ignored-content read are explicit. Phase02:31-34,48-51,57-61 owns implementation/tests; phase03:76, phase05:37-40, phase06:42,50-52 and acceptance:27-28 preserve provenance through API/UI. Child-set/ancestry instability is explicitly non-atomic observed evidence, consistent with approved scope.
- **Q1 resolved, high confidence in specified handoff.** Contracts:33,46-48,145-151 defines metadata-only same-listener lookup,500ms/no retries/no filesystem scan, separate originalAttempt latch and activeReview pointer, identity/generation checks after await, and exact origin/root/baseline settled controls. Late original failure cannot invalidate fromNow. Phase03:67,143, phase04:40-43 and phase07:67,143 assign local and real hidden-panel adoption/race checks. Public fromNow need not notify the browser-hidden producer or clear the original failure.
- **Q2 resolved, high confidence in selected path.** Contracts:13-19 prohibits discovery/status helpers, chooses direct canonical single-root validation with secure ancestor/marker checks, admission from first I/O and explicit component/metadata/scratch/time/candidate limits. Phase02:49-51,98-99 and phase08:56 require observed operation/budget tests rather than source-string assertions. This avoids the inspected helper's width-unbounded discovery/output path; cooperative timeout limitations remain honest.
- **Revision regression check:** plan:44-54 Mermaid has16 task-equivalent nodes and17 dependency arrows matching ownership:13-28 by manual comparison; new shared module writers are transitively ordered. Create/Modify transfers and new root/absence test paths agree across ownership and phase actions. No new material security, lifecycle, schema, ownership or acceptance defect identified in these revised surfaces. This is not proof of zero possible implementation defects.

Follow-up checks performed: actual revised artifact inspection, cross-contract/phase/acceptance propagation comparison, local-completion feasibility reasoning, manual diagram/DAG comparison against task records, and comparison with source/spec evidence retained above. No builds/tests/lint/formatters, helper/parser execution, hydration, implementation, external research, native/browser/model runs or visual approval performed. Author's structural-validator results remain supplied evidence, not independently rerun runtime proof.

Clearance: **identified independent plan-review blockers/findings cleared; coordinator may proceed to its final validation/handoff gate**. No permission to implement or claim release readiness. Actual managed OMP/model access, resource measurements, supported platform/security checks, web/Monaco/Tauri behavior and human visual acceptance remain required future qualification.

Final unresolved questions: **none from this targeted review**. Runtime prerequisites and cross-plan active-writer reconciliation remain explicit execution gates, not unresolved product decisions or passed checks.
