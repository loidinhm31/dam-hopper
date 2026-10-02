# Project Manager Terminal Report — Phase 07: Linux Runner Retirement

**Date:** 2026-10-02  
**Plan:** `plans/261002-0246-native-advisor-migration/phase-07-linux-deployment-and-manual-uninstall.md`  
**Status:** Implementation and scoped validation terminal; advisory report only. This is **not** a durable completion receipt and does not claim controller completion.

## Executive status

Phase 07 retires the Linux plugin runner/worker from new deployments, migrates accepted manager state to native schema 3, preserves the API/helper shared runtime, and delivers a guarded manual removal script. The phase contract records implementation/review complete at 100%, and its listed TODO items are checked. The parent-requested task tally is **14/14 complete**.

Task-count note: the checked-in Phase 07 contract currently displays 12 top-level checked TODO rows. The source for the parent-requested 14-item tally is not enumerated in that file; reconcile the tracking units before any durable status publication.

## Validation evidence

Evidence below is reported by the terminal tester; this project-manager report did not rerun tests.

| Area | Recorded evidence |
|---|---|
| Backend | **1,728 passing Rust tests total**: 1,719 passed in `cargo test --manifest-path server/Cargo.toml` (54 suites; 6 ignored) plus 9 dedicated Phase 07 tests. Migration, fail-closed handling, native unit policy, history-root symlink rejection, legacy manifest inspection, and plugin-bearing bundle rejection are covered. |
| Deployment journeys | **8/8 passed** under `pnpm test:deploy`: clean install, upgrade/rollback, crash recovery, security, reset smoke, web contract, Fedora format-2 migration, and safe plugin-platform removal. Removal journey records dry-run invariance, prerequisite rejection, apply, history preservation, and idempotence. |
| UI | **2,206 passed, 0 failed** across 293 test files (`pnpm --filter @dam-hopper/ui test`). |
| Code review | **9.0/10, approved with warnings; no critical findings.** Review covers 50 files and the manager-state migration, release inventory, safe uninstall, permissions, and path handling. Source re-read for this report shows the earlier `eval` path now uses `getent`, the old installer option emits a deprecation notice without forwarding it, and the reinstall stop list omits the retired runner. No separate post-fix review result is recorded, so the review remains accurately described as approved with warnings. |

Sources: [tester validation](./tester-261002-1530-phase-07-linux-runner-validation.md), [code review](./code-review-261002-1520-phase-07-retire-linux-runner.md), and [Phase 07 contract](../261002-0246-native-advisor-migration/phase-07-linux-deployment-and-manual-uninstall.md).

## Documentation status

Docs review is **complete** for the authorized `docs/linux-systemd.md` scope. The guide now synchronizes service/role/filesystem details and the Phase 07 operator sequence; bundle-directory and MFA-session-token examples are corrected. See the [Docs Manager report](./docs-manager-261002-1530-phase-07-linux-runner-retirement.md).

Evidence limits: the scoped system command exited 1 at the fail-closed prerequisite because this host's installed API unit still references the retired tmpfiles file. It did not reach the rest of the dry-run flow; it made no changes and is an incomplete host smoke, not a passed dry-run. The Phase 07 tester separately reports the isolated uninstall integration journey passing. No `validate-docs.cjs` script was found, so the docs validator was unavailable. The guide is 933 LOC, above the 800-LOC target; no out-of-scope split was made.

## Phase 08 readiness and qualification gates

Phase 07 clears its own deployment-retirement dependency and is the immediate predecessor named by the project progress handoff. The current progress overview calls Phase 08 “Ready / Next,” and the Phase 07 review recommends proceeding.

However, Phase 08’s contract requires Phase 05 G1 and copied-source closure. Phase 05 still records the live G1 browser/API parity across eight operations and four views, plus manual operator smoke, as pending and says Phases 06/08 remain gated. Therefore Phase 07 completion **does not by itself prove every Phase 08 entry condition**. Parent must reconcile the progress overview against the explicit G1 gate and verify copied-source closure before destructive Evcrate source removal.

The Phase 07 evidence supplied does not show a separate disposable user-systemd-session qualification for uninstall. The Phase 07 success criterion permits user scope to be separately qualified or explicitly marked as an external validation gate; the parent should record which disposition applies. Production uninstall remains an operator action after native deployment; no production cleanup is claimed here.

## Parent next steps

1. Retain the Docs Manager’s authorized guide update; note its validator was unavailable and its host smoke stopped at the legacy-unit prerequisite, not a completed dry-run. Before production removal, deploy/activate a native release so API/helper units pass the uninstall guard.
2. Reconcile Phase 05’s pending G1/manual-smoke gate with the Phase 08 “Ready / Next” overview; confirm copied-source closure before Phase 08 deletes Evcrate integration/assets.
3. Record a separate user-scope qualification result or explicitly retain it as an external validation gate. Keep production cleanup manual and post-deployment.
4. Main owns the single project-wide validation after all sibling work lands. This report cites the tester’s scoped results and did not run another suite.
5. Parent owns the advice lifecycle and any durable receipt. Keep this report advisory; do not mark sealed plan/roadmap status DONE based on it.

## Unresolved questions

- Which approved tracking inventory defines 14 tasks when the checked-in Phase 07 contract lists 12 top-level TODO rows?
- Is user-scope uninstall qualification scheduled separately, or should it remain an explicit external gate?
- What parent-authorized evidence resolves the Phase 05 G1 prerequisite conflict before Phase 08 source deletion?
