# Independent plan challenge

## Status and disposition
- **Review complete; revision required:** one High execution-contract finding. No additional material design finding in the requested auth/lifecycle migration scope.
- Plan-only review, not implementation approval, final user validation, or a passing qualification receipt.
- Reviewed selected overview and linked phase completely, including the full long acceptance record.

## Inspected evidence
Paths relative to repository unless prefixed `~`:
- `plans/261116-0938-device-login-management/plan.md:1–60`.
- `plans/261116-0938-device-login-management/phase-01-device-login-surface-cutover.md:1–207`.
- `plans/261116-0938-device-login-management/tasks.json:1–202` (task metadata throughout; full contracts/history at 11–48 and 80–200).
- `README.md:1–126`; `docs/project-overview-pdr.md:1–22,57–64`.
- `docs/code-standards.md:18–45,199–204,214`; line 214 inspected untruncated.
- `docs/system-architecture.md:44,716–731`; `docs/user-guide-multi-server-profiles.md:80–104`.
- `docs/testing.md:76–120,220–244`.
- `packages/ui/src/components/pages/DevicesPage.tsx:1–105`; `DevicesPage.test.tsx:1–79` in that directory.
- `packages/ui/src/os/apps/SettingsApp.tsx:1–26,39–110`; `SettingsApp.test.tsx:1–117` in that directory.
- `packages/ui/src/components/organisms/LoginDevicesSection.tsx:1–86`.
- `packages/ui/src/components/organisms/use-login-devices.ts:1–128`; `login-devices-owner.ts:1–74` in that directory.
- `packages/ui/src/components/organisms/login-devices-connections.test.tsx:1–289` (complete, unelided).
- `packages/ui/src/components/organisms/LoginDevicesSection.test.tsx:112–239`, plus case inventory at 55–213.
- `packages/ui/src/components/organisms/ServerSettingsDialog.tsx:590–920`; dialog test `:1–164,524–555`, plus case inventory through 869.
- `packages/ui/src/components/organisms/ServerSettingsDialogMfa.test.tsx:1–58`, plus case inventory at 58,186,289,345.
- `packages/ui/browser-tests/login-devices.browser.tsx:1–75`; `packages/ui/package.json:1–76`.
- `plans/261022-0322-device-login-management/plan.md:1–69`; `phase-03-validation.md:51–71` in that historical directory.
- Published resources: `~/.omp/agent/evcrate/AGENTS.md:1–56`, `workflows/development-rules.md:1–44`.
- Skills read directly: `~/.omp/agent/skills/code-review/SKILL.md:1–143`; `planning/SKILL.md:1–113`; `planning/references/plan-review.md:1–46`; `planning/references/task-management.md:1–137`.
- Installed helper evidence under `~/.omp/agent/evcrate/scripts/plan-tasks/`: `runtime.cjs:1–48`, `readiness.cjs:1–41`, `transitions.cjs:1–62`, `evidence.cjs:1–59`, `state.cjs:67–104`; entry `../plan-tasks.cjs:1–16`.

## Finding R1 — Completion-gated DAG prevents the promised edit join
- **Severity:** High. **Confidence:** High; enforced by installed helper, not a speculative workflow interpretation.
- **Plan:** phase `:13,50,118,125,134,143,152,161,177–183`; overview `:45,54`.
- **Supporting contract:** published `planning/references/task-management.md:65,79–83,96–120`; installed `readiness.cjs:13–24,36–39`, `transitions.cjs:34–55`, `evidence.cjs:10–33`.
- **Scenario:** after reviewed hydration/reclaim, `detach-dialog-devices` is in progress. The next task cannot be claimed or started until detach has an evidence-valid **completed** state. Completion requires terminal implementation, applicable compile, passing tests/smoke and review. Yet this plan prohibits checks until every edit lands and reserves integrated verification for the last task. Callback retirement and connection-host migration therefore cannot legally begin. Callback retirement also explicitly relies on the later migration before its integration verification can pass.
- **Impact:** coordinator must either deadlock at the first dependent claim, make premature completion claims, or edit future tasks' files outside their active contracts. Hydration fixes stale fingerprints but does not change these readiness semantics. Stable IDs and correct ownership lists alone do not make this execution schedule runnable.
- **Smallest correction:** distinguish serialized **editing order** from evidence-backed **completion dependencies**. Retain six IDs/history and exclusive file ownership, but make staged edit tasks claimable without completion of earlier staged edits; enforce their existing order through the single coordinator/owner handoff. Make qualification claimable after the coordinator-observed edit join rather than through a chain requiring its own future receipts. Run joined checks/review once, then complete tasks using current-fingerprint shared integrated evidence. Propagate this to `blocked_by`, prose, acceptance and reconciliation instructions. Alternatively specify an actually runnable per-task verification schedule, explicitly resolving the callback/test-host dependency; do not invent an intermediate helper state or treat implementation-terminal as completed.

## Coverage and challenged contracts
- **Requirements / bounded cutover:** covered. Existing page/Settings composition supports reuse; no new app, API, DTO, backend or storage migration needed. Read-only production boundaries are explicit.
- **Test-host migration:** covered. Integration suite currently imports/renders only `ServerSettingsDialog` (`:7,57–74`); all device actions depend on its removed section. Phase `:72–91` assigns the formerly omitted file and maps all fifteen parameterized cases without treating the initial exception as substantive proof.
- **Owner lifecycle oracles:** covered. Matrix retains real profile storage/subscriber/4401 handling, generation and socket counts, late success/error fencing, replacement and ambient isolation. It preserves synchronous DELETE-first cleanup and actionable storage failure/recovery. These correspond to owner `:40–73` and hook `:33–119`; retirement of notification plumbing is not retirement of cleanup authority.
- **Independent login/MFA:** covered. Shared old `render`, password/MFA helpers and Save assumptions are not reusable as page controls. Separate scoped real-dialog/provider setup is explicitly required for valid unsaved-MFA cases; only three revoked-draft Save-guard cases are replaced. No demand to restore removed guards.
- **Page/app acceptance:** covered. Real page tests and narrow Settings boundary tests have distinct proof boundaries; explicit selected A versus ambient B, Cancel zero-DELETE, acknowledgment timing, self cleanup, controlled rerender/callback and `noLayout` remain required.
- **Browser / qualification:** covered. Current browser source already mounts real Settings at 320×667, 320×420 and 1024×640, asserting scroll reachability, text-only hints, confirmation geometry/focus, Escape/Cancel and exact DELETE. Earlier 3/3 receipt is not reused as unit/build/full-app approval. Focused commands retain the connection suite; package build really is `tsc -p tsconfig.json`.
- **Exact ownership / ordering:** file ownership and docs handoff covered; durable scheduling incomplete because R1. Existing state records detach's claim/start history and omits the integration file from the older page task. Explicit stale/reopen/reclaim reconciliation is otherwise consistent with installed `state.cjs:78–104`.
- **Failure / rollback:** covered. Plan preserves ordinary persistence restoration, URL-change clearing and media ordering, targets the exact orphan call, escalates out-of-scope production defects, and limits rollback to authorized frontend/docs changes without resetting unrelated work.
- **Docs / historical gates:** covered. Architecture and guide are already cut over in current source; treat planned updates as reconciliation, not permission to overwrite delivered/concurrent edits. Historical pending human visual gate remains explicitly preserved. No automated/browser component receipt closes it.

## Checks performed / not performed
- Performed: static plan/source comparison; manual task-field/marker/ownership/DAG inspection; installed helper readiness/evidence/reconciliation inspection; migration-matrix mapping against actual test cases; browser and documentation contract inspection.
- Not performed: tests, builds, lint, formatting, installs, browser/live-app execution, helper operations/hydration, task-state updates, implementation edits, delegation or Git operations.
- Supplied observations only: initial fifteen stale-host failures, orphan-helper build error and browser 3/3 pass. No rerun or independently claimed execution result.
- Evidence limit: no full backend/security audit, full dialog/MFA-suite implementation review, historical PNG inspection or real-app qualification. Historical `packages/ui/e2e/device-login-management/device-login-management.spec.ts` referenced by old docs is absent from the current E2E directory; its archived run/visual review was not independently verified. This does not close or alter that historical gate.

## Unresolved questions
- No product decision needed. Coordinator/planner must settle R1's runnable task lifecycle before execution readiness; this report does not authorize bypassing the helper or weakening evidence gates.
