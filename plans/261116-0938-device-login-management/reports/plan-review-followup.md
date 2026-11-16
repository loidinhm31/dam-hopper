# R1 targeted plan-review follow-up

## Status
- **Review complete. R1 resolved in amended design.** Installed helper source permits the specified six-task claim/start sequence without earlier completion/evidence, after required state reconciliation.
- **Current execution remains gated:** existing `tasks.json` is pre-amendment; reviewed hydration/reopen/current claims are still required. This is an explicit prerequisite, not the former circular evidence dependency.
- No additional material R1 finding. Not implementation approval, final plan validation, or an execution/qualification receipt. Sole targeted follow-up; no full-plan re-review.

## Inspected evidence
Paths relative to repository; `H` = `/home/loidinh/.omp/agent/evcrate/scripts/plan-tasks/`.
- `plans/261116-0938-device-login-management/reports/plan-review.md:1–57`, including complete R1 correction at line 37.
- `plans/261116-0938-device-login-management/plan.md:1–60`; scheduling/reconciliation at 44–56, including full line 54.
- `plans/261116-0938-device-login-management/phase-01-device-login-surface-cutover.md:1–219`; targeted contracts at 39–61, 110–189, 208–219, including full lines 119 and 148.
- `plans/261116-0938-device-login-management/tasks.json:1–202`.
- `H/readiness.cjs:1–41`; `H/transitions.cjs:1–62`; `H/runtime.cjs:1–48`.
- `H/state.cjs:1–105`; `H/evidence.cjs:1–59`; `H/source.cjs:1–62`.
- `H/contracts.cjs:1–38`; `H/validation.cjs:1–49`; `H/arguments.cjs:1–31`; `H/markdown.cjs:1–57`; helper entry `H/../plan-tasks.cjs:1–16`.
- Published guidance: `~/.omp/agent/evcrate/AGENTS.md:1–56`, `workflows/development-rules.md:1–44`, `skills/code-review/SKILL.md:1–143`, `skills/planning/SKILL.md:1–113`, `skills/planning/references/plan-review.md:1–46`, `task-management.md:1–137` (skill paths under `~/.omp/agent/`).

## R1 evidence and disposition
### Exact dependencies and runnable transitions
The phase task fence declares precisely:

| Coordinator order / exact ID | `blocked_by` | Contract lines | Writable scope |
|---|---|---|---|
| 1. `detach-dialog-devices` | `[]` | 125–131 | Dialog production/test |
| 2. `retire-device-draft-callback` | `[]` | 134–140 | Section/hook |
| 3. `prove-settings-device-surface` | `[]` | 143–149 | Page/app/connection tests |
| 4. `migrate-device-browser-coverage` | `[]` | 152–158 | Browser test |
| 5. `document-device-surface` | `[]` | 161–167 | Three documentation files |
| 6. `qualify-device-surface` | `[]` | 170–176 | Empty |

- **Static transition proof, not an executed simulation:** `H/readiness.cjs:13–24,36–39` checks incomplete dependencies and active writable overlaps. Every amended dependency array is empty. Literal writable paths are pairwise disjoint under the case-insensitive exact/ancestor comparison in `H/validation.cjs:45–47`; qualification has no paths.
- `H/transitions.cjs:34–40` therefore permits each reconciled pending task to become claimed, then same-owner `in_progress`, while all earlier tasks remain `in_progress` with no evidence. No active-task-count or global owner-serialization constraint exists on this transition path. Evidence validation belongs to completion, not claim/start (`:52–55`).
- The plan correctly does **not** delegate ordering to `next`: helper views sort IDs, not narrative order (`H/readiness.cjs:32–35`; `H/runtime.cjs:23–24`). Phase `:54–58` requires coordinator-selected exact IDs and terminal edit handoffs in the table's order.
- Qualification is admitted only after five terminal edit/docs reports, landed scopes and no remaining writer, while all five edit tasks remain `in_progress` (phase `:58–60,116,174,189`). Its empty dependencies/scope mean no future compile/test/review receipt blocks its claim/start. Coordinator enforces the join; helper readiness alone is explicitly insufficient.

### Real identity and exclusive ownership preserved
- Phase `:54–55,60,119` requires terminal old workers before reconciliation, a real coordinator-assigned owner token bound to the actual worker/handoff, retained current claims, current fingerprints and completion with each retained owner token. It does not invent a new helper state or substitute historical ownership for a current claim.
- Actual helper claim records the supplied owner; start/complete require exact equality (`H/transitions.cjs:12–16,34–40,52–55`). Active scopes cannot overlap, regardless of owner (`H/readiness.cjs:14–19`; `H/state.cjs:54–57`). Separate edit scopes permit retained claims without granting a second writer to any file.
- Binding a token to a real worker remains a coordinator duty, not something the helper authenticates. This matches installed `task-management.md:88,94–98`; the review establishes the amended contract, not future worker provenance or cross-plan writer absence.

### Per-task completion gates not weakened
- Phase `:59–61,119,176,189` keeps all six incomplete until joined checks/review pass, requires one evidence JSON per current ID/fingerprint and each task's terminal report, and permits accurate shared integrated receipts rather than early completion. Failed checks block completion; no new waiver is granted.
- Helper still requires same-owner `in_progress`, readiness and evidence at completion (`H/transitions.cjs:52–55`). Evidence requires current ID/fingerprint, terminal implementation, compile/tests/smoke fields, passing review and existing report references/hashes (`H/evidence.cjs:6–38,50–57`). Existing schema exceptions are unchanged; shared reports are expressly permitted by installed `task-management.md:118–120`.
- Focused unit/build/browser commands remain explicit and retain the connection suite (phase `:188–201`). Historical human visual qualification remains separate (`:59,111,175,198–199`); this scheduling change supplies no passing receipt.

### Existing state/history not replaced by the revision
- Current snapshot retains detach's `in_progress` status, `main-device-login-implementation` owner and both original claim/start events (`tasks.json:29–48`). Later tasks remain pending with old completion edges (`:51–55,73–78,81–109,112–139,142–170,173–199`), including qualification's old docs dependency. These are not presented as amended ready/current state.
- Overview `:53–54` and phase `:54,119` explicitly leave state author-read-only and require parent reconciliation, not manual replacement, history deletion or old-fingerprint completion. Observed state is consistent with no amendment hydration; no byte-for-byte pre-revision snapshot was supplied to prove all historical bytes unchanged.
- Semantic overview/full-phase edits enter every task fingerprint (`H/source.cjs:54–60`; `H/markdown.cjs:37–55`). Hydration merges stable IDs, preserves history, appends stale events and clears current claims/evidence/mappings (`H/state.cjs:67–93`); explicit reasoned reopen returns stale tasks to pending (`H/transitions.cjs:46–50`). This is deliberate invalidation, not loss of historical identity.
- Until that parent-owned sequence occurs, helper operations reject source/state drift (`H/runtime.cjs:14–21`; `H/state.cjs:95–103`). The amended schedule is runnable **after** reconciliation, not against the current old state.

## Checks and limits
- Performed: static comparison of amended exact contracts, ownership, coordinator admission/completion prose, retained state/history and installed helper transition/evidence/reconciliation logic.
- Not performed: helper operations, hydration, in-memory helper execution, tests/builds/lint/browser runs, product/source/plan/task-state edits, Git operations or delegation. Plan owner's reported in-memory validation was not independently rerun or adopted as execution evidence.
- Only this assigned report written. Coverage complete for R1; product implementation, broader auth/lifecycle correctness and actual qualification excluded.

## Unresolved questions / residual blocker
- No unresolved R1 design question. Parent must still collect actual affected workers, finish required review/final-validation disposition, hydrate/reopen all six IDs, obtain current fingerprints and preserve real owner-to-worker handoffs before revised execution. Actual reconciliation, worker terminality and absence of external conflicting writers are not established by this read-only review.
