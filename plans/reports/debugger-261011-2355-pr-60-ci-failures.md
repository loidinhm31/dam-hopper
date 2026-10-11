# PR 60 CI root cause analysis

## Executive summary

PR: [loidinhm31/dam-hopper#60](https://github.com/loidinhm31/dam-hopper/pull/60), branch `refactor/remove-advisor`, CI head `536c8aae401e58ce9693687233915f4e4a6c0f03`.

Two independent E2E defects block merge:

1. **Deterministic incomplete fixture migration:** secondary `plan.md` still declares one pending phase after its completed `progress.md` reconciliation was removed. Plan-only parsing correctly returns completed = 0; the journey retains completed = 1.
2. **Nondeterministic session identity selection:** the terminal journey treats the last `/api/terminal/detailed` entry as the terminal just created. The endpoint returns Rust HashMap iteration order, not creation order, so an existing feature-worktree session can be inspected instead.

Priority: fix both before merge. No evidence warrants restoring progress authority, changing PTY cwd resolution, or imposing server-side ordering.

## CI evidence and timeline

Sources: [Application E2E job](https://github.com/loidinhm31/dam-hopper/actions/runs/38155272192/job/114516847813), [aggregate Quality Gate job](https://github.com/loidinhm31/dam-hopper/actions/runs/38155272192/job/114520523990), [PR file changes](https://github.com/loidinhm31/dam-hopper/pull/60/files).

- 2026-10-11 16:23:41Z: workflow created for the above head.
- 16:36:44Z: `pnpm --filter @dam-hopper/ui test:e2e` starts.
- 16:36:45Z: eight tests, one worker.
- 16:38:20Z: two failed, six passed, 1.6 minutes.
- 16:41:46Z: aggregate gate exits because `APPLICATION_E2E: failure`; all other aggregate inputs are `success`.

Log excerpts:

```text
project-plans-dashboard.spec.ts:254:7
Expected: "Completed: 1"
Received: "Completed: 0"
Timeout: 10000ms
24 × locator resolved ... unexpected value "Completed: 0"

traditional-terminal-worktree-switching.spec.ts:321:36
Expected: "/e2e/workspace/fixture-project"
Received: "/e2e/workspace/fixture-feature-worktree"
```

These are assertion failures, not build, auth, container startup, or connection failures. Existing logs inspected; no tests rerun.

## Failure 1: secondary plan completion

### Exact source chain

- `packages/ui/e2e/fixtures/application-data.ts:64-73,106-107`: default secondary project is `fixture-worktree-project`; fresh seed tree calls `seedPlanFixtures(projectDir, secondaryProjectDir)`.
- `packages/ui/e2e/fixtures/plan-fixtures.ts:145-153`: secondary plan is written at `<secondaryProjectDir>/plans/261001-sample/plan.md`, deliberately sharing the primary plan's relative path.
- `plan-fixtures.ts:157`: secondary frontmatter is `status: pending`.
- `plan-fixtures.ts:166-168`: exactly one phase; row is `| 01 | Phase 1 | Pending | 0% | 8h | ... |`.
- `server/src/plans/parser.rs:18-47`: metadata, inventory, statuses, and completion all derive from `plan.md`.
- `parser.rs:844-852`: phase status is the row's status with `PlanAuthority::Plan`.
- `parser.rs:1394-1413`: declared = phase count; only `PlanStatus::Completed` increments completed. Pending increments recognized, not completed. Result: declared = 1, completed = 0, fraction = 0.
- `packages/ui/src/components/organisms/ProjectPlanOverview.tsx:179-183`: UI directly renders completion counts; no additional completion override.
- `packages/ui/e2e/project-plans-dashboard/project-plans-dashboard.spec.ts:235-254`: switches to secondary project, opens the matching folder, successfully expects `Declared: 1`, then incorrectly expects `Completed: 1`.

### Change that introduced mismatch

PR diff removes the secondary `progress.md` write. Deleted contents explicitly reported phase 01 `Completed`, with captured status `Pending (initial snapshot)` and overall `In Progress (Only Phase 01 completed)`. Before the cutover, that reconciliation supplied the one completed phase. The secondary `plan.md` pending row was not migrated.

The primary fixture was migrated correctly: `plan-fixtures.ts:22,36-40` now declares in-progress with two completed, one in-progress, and two pending phases. Its watcher mutation also now writes completed phases directly to `plan.md` (`project-plans-dashboard.spec.ts:174-210`). Secondary migration is the missing piece.

This is not evidence of wrong-project caching: declared = 1 matches secondary inventory, whereas the primary has five completed phases by this stage (`project-plans-dashboard.spec.ts:191-210`). Ten seconds of retries cannot turn a pending row into a completed one.

### Recommended fix, preserving the existing acceptance assertion

In `packages/ui/e2e/fixtures/plan-fixtures.ts`:

1. Change secondary frontmatter line 157 to `status: completed`.
2. Change secondary phase row line 168 to:

```markdown
| 01 | Phase 1 | Completed | 100% | 8h | [Phase 1](./phase-01.md) |
```

3. Change stale comment line 144 from “different report” to “different phase inventory”.

Keep `project-plans-dashboard.spec.ts:251,254` expecting declared = 1 and completed = 1. Updating both the row and frontmatter avoids a new status conflict; header-only or percentage-only edits do not establish phase completion.

If intentionally choosing a pending secondary fixture instead, the internally consistent alternative is changing the assertion at line 254 to `Completed: 0` and documenting that fixture intent. Do not mix alternatives. Migrating completion into `plan.md` preserves this journey's existing acceptance value and prior reconciliation intent.

Do not restore `progress.md` authority. `server/src/plans/tests.rs:485-548` explicitly tests that legacy progress files, including a completed reconciliation, are ignored in favor of a pending plan.

## Failure 2: terminal selected by array position

### Exact source chain

- `packages/ui/e2e/traditional-terminal-worktree-switching/traditional-terminal-worktree-switching.spec.ts:13-16`: `sessions()` fetches `/api/terminal/detailed` without sorting or filtering.
- `server/src/api/terminal.rs:270-271`: endpoint serializes `pty_manager.list_detailed()` directly.
- `server/src/pty/manager.rs:617-620`: both live and dead session stores are `HashMap<String, ...>`.
- `manager.rs:2595-2609`: collects `inner.live.values()` directly into a Vec, then appends `inner.dead.values()`. No timestamp or insertion-order sort.
- `manager.rs:1732`: creation inserts into the live HashMap; insertion does not mean append-to-response.
- Journey lines 181-189: an existing feature terminal has project `fixture-project`, cwd `/e2e/workspace/fixture-feature-worktree`.
- Journey lines 244-251: a third terminal is correctly identified by excluding root and feature IDs, then asserts root cwd.
- Journey lines 303-304: secondary profile's selector visibly says root.
- Journey lines 307-316: launch waits only for total session count to increase by one.
- **Journey line 318:** `afterSecondarySessions[afterSecondarySessions.length - 1]` assumes the final entry is newly created.
- Journey lines 320-321: project assertion cannot distinguish old feature session from new root session; both belong to `fixture-project`. Cwd assertion then exposes mistaken identity.

### Mechanism and confidence

HashMap response order is unspecified and is not chronological. Adding the fourth session may preserve, change, or rehash iteration order. Waiting for four sessions proves existence, not which entry is new. An existing feature-worktree session can occupy the final position; if dead entries exist, a dead session can also be final because tombstones are appended.

The supplied received cwd exactly matches the feature session established earlier in this journey. The invalid selection mechanism is verified from source. **[INFERENCE]** CI likely selected that existing feature session; logs do not print IDs or the complete response, so the exact returned ID and actual new secondary session's cwd cannot be independently established from the log alone. This assertion is not reliable evidence of a profile-isolation or server-cwd defect.

Server creation resolves the supplied target/cwd before PTY creation (`server/src/api/terminal.rs:96-114`); absent requested cwd defaults to the resolved target path (`terminal.rs:197-218`). Nothing in detailed listing reassigns session cwd.

### Recommended exact test fix

Replace the launch observation at journey lines 307-321 with a pre-launch ID snapshot and post-launch identity delta. Reuse the earlier identity-based selection pattern, not array order or expected cwd as a filter:

```typescript
const beforeSecondarySessions = await sessions(appServices);
const beforeSecondaryIds = new Set(beforeSecondarySessions.map((s) => s.id));
await secondaryNavigator
  .getByRole("button", {
    name: "New terminal in selected project",
    exact: true,
  })
  .click();

let newSecondarySessions: SessionInfo[] = [];
await expect
  .poll(async () => {
    newSecondarySessions = (await sessions(appServices)).filter(
      (s) => !beforeSecondaryIds.has(s.id),
    );
    return newSecondarySessions.length;
  })
  .toBe(1);

const [secondaryTerminal] = newSecondarySessions;
expect(secondaryTerminal).toBeDefined();
expect(secondaryTerminal!.project).toBe("fixture-project");
expect(secondaryTerminal!.alive).toBe(true);
expect(secondaryTerminal!.cwd).toBe("/e2e/workspace/fixture-project");
expect(secondaryTerminal!.worktreePath).toBeUndefined();
```

Using the successful poll snapshot avoids a second unrelated response fetch. Exactly one new ID prevents silently choosing among multiple launches. In this journey IDs are newly created, not reused; if a future test intentionally respawns existing public IDs, correlate `(id, incarnation)` instead (`server/src/pty/session.rs:96-100`).

Do not `.find()` by desired cwd: selecting any old root terminal would let a wrong-cwd new terminal pass. Do not sort by ID or use maximum timestamp: ID is not chronology and timestamps can tie. Do not change `HashMap` to `BTreeMap` or add backend sorting merely to satisfy this test. Capture the create response ID as an alternative only if that response is already available through the journey's transport; the identity delta is sufficient here.

Keep existing root/feature preservation assertions. Optionally recheck known IDs after secondary launch, so secondary activity cannot regress original sessions. Production `terminal.rs` and `manager.rs` need no change for the demonstrated assertion defect.

## Regression checks for the integrating agent

Not executed during this diagnostic assignment:

1. `pnpm --filter @dam-hopper/ui test:e2e:typecheck` after test edits.
2. Run both named Playwright journeys using the existing E2E container setup. Dashboard must retain primary initial 2/5, watcher-updated 5/5, secondary 1/1, and return-to-primary 5/5 behavior.
3. Exercise the terminal journey across fresh server starts: hash seeds/order differ by process. The new session must have a new ID, be alive, belong to fixture-project, have root cwd and no worktree target; existing feature session must remain alive in its feature cwd.
4. Preserve `test_legacy_progress_file_completely_ignored_by_scanner_and_parser` and the parser's completion/status-conflict coverage. No legacy authority reintroduced.
5. Run the full eight-journey application suite once integrated; aggregate gate should become green only after its dependency succeeds.

## Changes and unresolved questions

No source code changed; report only. Evidence collected via GitHub metadata/logs/PR diff and source inspection. No builds, tests, linters, or formatters run.

Unresolved evidence detail: historical log does not expose the misselected terminal ID or new secondary terminal cwd. Identity-based assertions resolve this observability gap without speculative production changes. No missing prerequisite blocks the recommended fixes.
