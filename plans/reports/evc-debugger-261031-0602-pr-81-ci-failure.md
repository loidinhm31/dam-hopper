# PR 81 CI Failure Diagnostic

## Executive Summary

- **PR:** [#81 — read-only OMP session changes panel with bounded Monaco diff](https://github.com/loidinhm31/dam-hopper/pull/81).
- **Failed workflow:** [PR Quality Gate, run 41119606867, attempt 1](https://github.com/loidinhm31/dam-hopper/actions/runs/41119606867).
- **Primary failure:** `Application E2E journeys` → step 10, `Run application E2E tests`. New session-changes journey fails during fixture setup, before workspace navigation or Monaco assertions.
- **Root cause, confirmed:** arguments reversed at `packages/ui/e2e/session-changes-review/omp-session-fixture.ts:54`. `copyToContainer` requires `(localPath, containerId, containerTarget)`, but caller supplies `(appContainerId, hostStagingDir, containerTargetDir)`.
- **Cascading failure:** `Quality Gate` → step 2, `Require every quality job`, correctly rejects `APPLICATION_E2E=failure`. Not a separate workflow defect.
- **Impact:** required PR quality gate fails; this run does not qualify the new production-container session-changes journey. Other 13 check jobs succeeded. E2E result: **1 failed, 11 passed**.
- **Immediate recommendation:** swap the first two arguments at the faulty call. Preserve helper contract and required workflow gates. Static inspection also identifies downstream journey setup/selector gaps; these were not reached in this run and must not be confused with the observed Docker failure.
- **Scope:** read-only investigation; only this report created. No source changes, workflow reruns, local tests, builds, or formatters executed.

## Investigation Evidence and Method

Read debugging/problem-solving skill instructions; applied root-cause tracing from failed child process to caller and compared existing working copy callsites. Current `docs/codebase-summary.md` was fresh and sufficient for repository context; no repository summary generation needed.

Commands used:

```sh
gh pr view 81 --json number,title,url,state,headRefName,headRefOid,baseRefName,commits,files,statusCheckRollup
gh run list --pr 81
gh run list --branch feat/session-changes-omp --limit 30 --json databaseId,workflowName,headSha,event,conclusion,status,createdAt,updatedAt,url
gh pr checks 81
gh run view 41119606867 --log-failed
gh run view 41119606867 --json name,headSha,attempt,conclusion,jobs,url,createdAt,updatedAt
gh pr diff 81
gh api repos/loidinhm31/dam-hopper/commits/234db334a9b5a23c0b4bc8f4c3aa184912bab6c4
gh api repos/loidinhm31/dam-hopper/actions/runs/41119606867/artifacts
```

`gh run list --pr 81` was attempted as requested, but installed CLI returned **`unknown flag: --pr`**. Used branch-filtered run list plus PR checks/head SHA to establish association instead. One matching workflow run returned. `gh pr checks 81` exits 1 because checks failed; not a CLI access failure.

`--log-failed` labeled log entries `UNKNOWN STEP`; job/step identities above are resolved from the run's structured `jobs[].steps[]` metadata, not guessed from that label.

### Revision Identity

| Identity | Value |
| --- | --- |
| PR head branch | `feat/session-changes-omp` |
| PR head/run head SHA | `5b07a4be5afcf78c8ac78b21138b9c7513688fdd` |
| Base branch | `main` |
| Base SHA shown by checkout | `5d92c54eac29529269a2519b5680f9587bfbe56c` |
| Actual Actions checkout | `8c684d4780437db417d05a5542106f8517bee63e`, `refs/remotes/pull/81/merge` |
| Trigger | `pull_request` |
| Runner | Ubuntu 22.04.5; image `20261025.340.1` |
| Runtime | Node `v24.22.1`, pnpm `10.34.9`, `CONTAINER_ENGINE=docker` |

The CI checkout is GitHub's synthetic merge, not the PR head itself. The faulty call was also retrieved directly from GitHub at the pinned PR head, matching local source.

## Failed Workflow, Jobs, and Steps

| Job | Step | Result / evidence |
| --- | --- | --- |
| [Application E2E journeys — 124282672661](https://github.com/loidinhm31/dam-hopper/actions/runs/41119606867/job/124282672661) | **10: Run application E2E tests**; `pnpm --filter @dam-hopper/ui test:e2e` | Failed 2026-10-30 20:16:21 UTC, exit 1; Docker copy argument failure in new test fixture |
| [Quality Gate — 124289926492](https://github.com/loidinhm31/dam-hopper/actions/runs/41119606867/job/124289926492) | **2: Require every quality job** | Failed 2026-10-30 20:17:23 UTC, exit 1; `APPLICATION_E2E: failure` |

Successful check jobs: lint/typecheck/frontend builds; JS tests for shared, browser-bridge, UI, native, create-admin; Chromium browser regressions; Rust server Linux/Windows; native client Linux/Windows SSH gate; release contract Linux/Windows.

Within the failing E2E job, dependency installation, Chromium installation, MongoDB image prefetch, E2E typecheck, and runtime image prebuild all succeeded. Artifact upload also succeeded after the test failure.

### Timeline — UTC

| Time, 2026-10-30 | Event |
| --- | --- |
| 19:56:49 | Feature commit `234db334a9b5a23c0b4bc8f4c3aa184912bab6c4` adds new E2E fixture and journey |
| 19:57:58 | Merge commit `5b07a4be5afcf78c8ac78b21138b9c7513688fdd` merges `origin/main` into feature branch |
| 19:58:49 | Quality workflow created |
| 19:59:52–19:59:54 | E2E typecheck succeeds |
| 19:59:55–20:14:17 | E2E image build succeeds: `Successfully built dam-hopper:production-test` |
| 20:14:17 | Playwright step starts |
| 20:14:18 | `Running 12 tests using 1 worker` |
| 20:16:21 | Playwright reports Docker copy error, 1 failed / 11 passed; step exits 1 |
| 20:16:22 | Sanitized failure artifact uploaded |
| 20:17:23 | Aggregate gate observes E2E failure and exits 1 |

## Exact Failure Logs

Primary failure, copied from `gh run view 41119606867 --log-failed` (job/`UNKNOWN STEP` prefixes omitted; messages unchanged):

```text
2026-10-30T20:16:21.2431944Z   1) [chromium] › e2e/session-changes-review/session-changes-review.spec.ts:14:3 › OMP Session Changes Panel User Journey (AC1-AC8) › opens session changes panel, renders read-only Monaco diff viewer, and captures evidence across viewports
2026-10-30T20:16:21.2434036Z     Error: Command failed: docker cp dam-hopper-app-28ce9737/. /tmp/omp-session-e2e-fixture-yY4QAn:/e2e/workspace/session-project
2026-10-30T20:16:21.2434966Z     must specify at least one container source
2026-10-30T20:16:21.2435716Z     Error Context: test-results/session-changes-review-ses-327a4-s-evidence-across-viewports-chromium/error-context.md
2026-10-30T20:16:21.2436256Z   1 failed
2026-10-30T20:16:21.2438087Z   11 passed (2.1m)
2026-10-30T20:16:21.2702557Z  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @dam-hopper/ui@0.15.5 test:e2e: `playwright test`
2026-10-30T20:16:21.2703039Z Exit status 1
2026-10-30T20:16:21.2873023Z ##[error]Process completed with exit code 1.
```

Aggregate failure:

```text
2026-10-30T20:17:23.9584087Z   APPLICATION_E2E: failure
2026-10-30T20:17:23.9793848Z A required quality job finished with: failure
2026-10-30T20:17:23.9821191Z ##[error]Process completed with exit code 1.
```

Failure artifact: [application-e2e-failure-reports, ID 13008413482](https://github.com/loidinhm31/dam-hopper/actions/runs/41119606867/artifacts/13008413482), 717 bytes, API reports not expired; expires 2026-11-06 20:16:21 UTC. Upload log reports one file. Artifact contents were not downloaded; conclusions use workflow logs and source, not uninspected artifact contents.

## Root Cause Analysis

### 1. New Caller Violates Existing Helper Contract

Faulty new caller, [`omp-session-fixture.ts:54`](https://github.com/loidinhm31/dam-hopper/blob/5b07a4be5afcf78c8ac78b21138b9c7513688fdd/packages/ui/e2e/session-changes-review/omp-session-fixture.ts#L54):

```ts
await copyToContainer(appContainerId, hostStagingDir, containerTargetDir);
```

Existing helper, [`container-client.ts:78–86`](https://github.com/loidinhm31/dam-hopper/blob/5b07a4be5afcf78c8ac78b21138b9c7513688fdd/packages/ui/e2e/fixtures/container-client.ts#L78-L86):

```ts
export async function copyToContainer(
  localPath: string,
  containerId: string,
  containerTarget: string,
): Promise<void> {
  const engine = await getContainerEngine();
  await execFileAsync(engine, ["cp", `${localPath}/.`, `${containerId}:${containerTarget}`], {
    env: { ...process.env, ...ENGINE_ENV },
  });
}
```

Argument mapping explains the exact failing command:

| Helper parameter | Incorrect actual argument | Result |
| --- | --- | --- |
| `localPath` | `dam-hopper-app-28ce9737` | Source becomes `dam-hopper-app-28ce9737/.`, a relative host path rather than host staging directory |
| `containerId` | `/tmp/omp-session-e2e-fixture-yY4QAn` | Destination becomes `/tmp/omp-session-e2e-fixture-yY4QAn:/e2e/workspace/session-project`, not a valid intended container endpoint |
| `containerTarget` | `/e2e/workspace/session-project` | Target suffix itself is unchanged |

Docker rejects the malformed endpoints with `must specify at least one container source`. This is argument construction failure, not a missing Docker installation, image pull failure, MongoDB/auth issue, build failure, resource timeout, or demonstrated Monaco/product regression.

Existing working callers use the correct ordering:

- `packages/ui/e2e/fixtures/application-services.ts:167,170`.
- `packages/ui/e2e/editor-git-blame/git-fixture.ts:165`.
- `packages/ui/e2e/git-conflict-resolver/git-fixture.ts:86`.

### 2. Why PR 81 Introduces It / Why Earlier Checks Pass

The feature commit [234db334](https://github.com/loidinhm31/dam-hopper/commit/234db334a9b5a23c0b4bc8f4c3aa184912bab6c4) adds `omp-session-fixture.ts` and the reversed call. PR diff and pinned head both retain it. No evidence attributes this mistake to the later documentation-conflict merge.

All three helper parameters are plain `string`, so TypeScript cannot detect the first-two-argument transposition. E2E typechecking therefore passes legitimately. `packages/ui/playwright.config.ts:36–42` discovers `e2e/**/*.spec.ts`, uses one worker and zero retries; the new journey is automatically included. At `session-changes-review.spec.ts:19`, it awaits fixture creation before `page.goto` at line 22. The copy exception escapes setup; no session-panel assertion is reached.

### 3. Aggregate Failure Is Correct Propagation

`.github/workflows/pr-quality-gate.yml:346–388` declares `application_e2e` as a required dependency, runs with `if: always()`, maps its result to `APPLICATION_E2E` at line 367, and exits 1 when any result is not `success`. No fix needed there.

## Concrete Recommended Fixes

### P0 — Fix Observed Failure

**Modify:** `packages/ui/e2e/session-changes-review/omp-session-fixture.ts:54` only for the observed failure:

```ts
await copyToContainer(hostStagingDir, appContainerId, containerTargetDir);
```

Expected command shape after correction, not executed during this investigation:

```sh
docker cp /tmp/omp-session-e2e-fixture-<suffix>/. dam-hopper-app-<id>:/e2e/workspace/session-project
```

Keep `container-client.ts` unchanged: its contract matches existing working callers. Do not skip the journey, add retries, raise timeouts, suppress the copy exception, or weaken `Quality Gate`; none addresses the argument reversal.

### P1 — Resolve Downstream Journey Gaps Before Claiming Full Qualification

These are **static source findings / [INFERENCE] follow-on blockers**, not additional failures observed in this CI run:

1. **Accessible-name mismatch:** `session-changes-review.spec.ts:28` uses `/Review session changes/`. Desktop buttons use `aria-label="Review OMP session changes"` at `TabBar.tsx:308` and `ActiveTerminalRuntimeDisplay.tsx:347`; the regex does not match that intervening `OMP`. Mobile controls use the shorter name. Update the spec locator to accept actual names, e.g. `/^Review (?:OMP )?session changes$/`, or use explicit desktop/mobile locators. Do not change product labels solely to accommodate a stale test.
2. **No OMP lifecycle established by the new fixture/journey:** `omp-session-fixture.ts:36–54` creates/copies a dirty Git tree only. `session-changes-review.spec.ts:18–30` does not select that project, create an OMP terminal, establish agent session identity, or perform session-start baseline/receipt setup. `TabBar.tsx:225–226,303` renders the desktop button only for an active terminal with `agentKind === "omp"` and a nonempty `agentSessionId`. Update the journey/fixture to establish a real controlled OMP session and wait for readiness before looking for the button.
3. **Project target mismatch:** default new fixture target is `/e2e/workspace/session-project` (`omp-session-fixture.ts:19`), while default application seed registers `fixture-project` and `fixture-worktree-project` (`application-data.ts:63–66,115`). Bind the journey's configured project/terminal launch target to the copied repository, using the existing fixture configuration rather than an unrelated unregistered path.
4. **Claimed diff behavior lacks assertions:** `session-changes-review.spec.ts:32–54` checks host visibility and captures viewports, but does not select a changed file or assert Monaco diff contents/read-only behavior. Add meaningful assertions after a baseline is captured and subsequent file changes occur; dirty files created before baseline capture alone do not prove session-relative changes. Keep Git HEAD/index/worktree invariance checks tied to the read-only acceptance contract if claiming that qualification.

P0 is a confirmed one-line repair; P1 items explain why that line alone cannot establish that the entire new AC1–AC8 journey will pass or meaningfully validate its title. Product server/UI modifications are not justified by the observed Docker failure.

## Recommended Validation Handoff — Not Executed

After repair, main agent/test owner should run in a Docker-capable environment:

```sh
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm --filter @dam-hopper/ui exec playwright test e2e/session-changes-review/session-changes-review.spec.ts --project=chromium
pnpm --filter @dam-hopper/ui test:e2e
```

Then collect a fresh PR quality workflow result. Acceptance: fixture copies into intended container/project; real OMP session readiness and panel/diff assertions are reached; focused journey and all application journeys pass; aggregate gate succeeds without exclusions. Initial copy fix has not been applied or validated here.

## Unresolved Questions

- After correcting fixture argument order and downstream journey setup/selector gaps, does the real production-container OMP session/Monaco journey pass? This run aborted before those behaviors; no subsequent behavior or fix success is claimed.
