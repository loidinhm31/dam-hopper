---
title: "Native Advisor and complete plugin-platform retirement"
description: "Move Evcrate Advisor into Dam-Hopper natively, with an admin server toggle and complete plugin/release/service removal."
status: in-progress
priority: P2
effort: 70h
branch: main
tags: [refactor, frontend, backend, api, auth, infra]
created: 2026-10-02
---

# Native Advisor migration

## Outcome and confirmed scope

Native Rust/Axum Advisor APIs + reused React viewer inside Workspace. Admin-only, one per-server enable/disable toggle, default off. Discover only a real directory at server `$HOME/.evcrate/advisor-history`; no hashing UI, registration, grants, bindings or hash prerequisite. User confirmed complete Dam-Hopper plugin-platform retirement, including Linux service.

Phase 01 contract/parity, Phase 02 history/status/admin/native API, and Phase 03 policy/evaluation read/compare implementation and finalization are settled; durable completion remains pending for all three (none is DONE). Phase 04 UI cutover, plugin-platform retirement, and deployment cutover remain unimplemented.

## Design and evidence

- [Architecture and migration contract](../../docs/architecture/native-advisor.md) — Phase 01 contract/source-parity baseline frozen; native runtime implementation and qualification remain later-phase work.
- [Native design contracts, agent waves and A01–A20 acceptance](./reports/native-design-contract.md).
- [Advisor source inventory](./research/evcrate-advisor-source.md).
- [Plugin/service/release retirement inventory](./research/plugin-retirement.md).
- [Hard-planning enhanced prompt](./reports/planning-command-prompt.md); [navigation overview](./cmd-plan.md).
- [Validated decisions and integration inventory](./reports/validated-decisions.md) — audit trail; incorporated directly into all nine phase contracts.

## Implementation phases

| Phase | Contract | Status / progress | Estimate |
|---|---|---|---|
| 01 | [Freeze native contract and source parity baseline](./phase-01-contract-and-parity-baseline.md) | Implementation/finalization settled; durable completion pending (not DONE) | 4h |
| 02 | [Port history domain, status, admin guard and native API](./phase-02-native-history-domain-and-api.md) | Implementation/finalization settled; durable completion pending (not DONE) | 12h |
| 03 | [Port current policy and evaluation discovery/read/compare](./phase-03-policy-and-evaluation-domain.md) | Implementation/finalization settled; durable completion pending (not DONE) | 10h |
| 04 | [Reuse Advisor UI and replace plugin provider](./phase-04-reuse-native-advisor-ui.md) | Pending / 0% | 10h |
| 05 | [Wire per-server toggle and all Workspace surfaces](./phase-05-settings-and-workspace-cutover.md) | Pending / 0% | 6h |
| 06 | [Delete Dam-Hopper plugin runtime, SDK and bridge](./phase-06-remove-dam-hopper-plugin-platform.md) | Pending / 0% | 6h |
| 07 | [Retire Linux runner and deliver safe manual uninstall](./phase-07-linux-deployment-and-manual-uninstall.md) | Pending / 0% | 10h |
| 08 | [Remove Evcrate plugin integration and release assets](./phase-08-evcrate-plugin-and-release-removal.md) | Pending / 0% | 5h |
| 09 | [Qualify native-only cutover and update current docs](./phase-09-qualification-and-documentation.md) | Pending / 0% | 7h |

## Order and ownership

1. Phase01 freezes interfaces/parity. One integration owner owns shared router/client/state/manifests and gates.
2. Phase02 history, Phase04 UI and Phase07 deployment can run in parallel in disjoint module trees; Phase03 depends on native service contract.
3. Phase05 proves native API/UI parity (**G1**) before Phase06/08 delete old platform/source integration.
4. Finish Phase07 native deployment/shared runtime/state migration before applying uninstall (**G2**). Production script remains manual operator action.
5. Phase09 validates complete native-only/release/producer cutover (**G3**) and updates current docs/changelogs.

Workers skip checks/formatters mid-flight; integration/verification owner runs final checks after each dependency wave settles, never against changing files. Exact source paths, steps, todos, risks and success gates are in each phase.

## Critical boundaries

- Durable history is V1; V2 checkpoint and root-query API are separate. Preserve producer project-path/revision hashes; remove plugin root admission hash and all path-hash UI.
- Policy stays account-wide/current; evaluations reuse verified HOME/explicit-project discovery, not worker-CWD fixtures or invented writer paths.
- Reuse persistent native Workspace placement. Scope copied CSS and remove source window-hash routing, iframe/MessagePort/Node worker.
- Replace shared plugin-named tmpfiles/group before deleting runner; API/idle-suspend IPC must survive.
- Migrate strict manager state before dropping plugin metadata. Native manager rejects plugin-bearing legacy rollback pre-mutation; preserve immutable old release files and operator legacy backups.
- Cleanup script default dry-run + explicit apply/system-or-user scope; no history/home/custom-user/global-Node deletion.

## Validation and execution status

**Plan status: IN PROGRESS (0/9 phases durably complete; 0%; implementation/finalization settled through Phase 03: 3/9 phases, 33%; 26/70h, 37%).** Durable completion for Phases 01–03 remains pending (none is DONE). Phase 01 review reports frozen contract/golden fixtures, 16/16 parity checks, 9.5/10, and no critical findings. Phase 02 review scored 9.6/10 with no critical/high findings; scoped validation passed 8/8 API integration tests, 23/23 Advisor unit tests, and 16/16 parity tests, with zero compile errors or Advisor warnings. Phase 03 review scored 9.7/10 with no critical findings; passed 4/4 policy/evaluation API integration tests, 23/23 Advisor unit tests, and 8/8 history API tests. Phases 04–09 remain pending; native UI cutover, plugin/source removal, deployment cleanup, and integrated end-to-end qualification are not claimed.

Final implementation requires actual authenticated server/browser smoke, source-domain parity, real disposable systemd cleanup/install/migration/rollback, release asset checks in both repos and core Evcrate producer smoke. Default no-auth dev server is not valid Advisor admin proof.
## Validation Summary

**Validated:** 2026-10-02. **Questions asked:** 5 (plus 2 earlier scope questions).
- Confirmed: full platform retirement; per-server toggle disabled by default; real history directory required (reject root symlink); no hashing utility; native-only automatic rollback with explicit legacy recovery backups.
- All nine phase files directly reflect revalidation in requirements, implementation steps, matching todos and success criteria; no pre-interview override layer remains.
The integration inventory is incorporated into Phases 06–08, including auth/agent-status callsites, strict state/manifest migration, shared runtime replacement and retained Evcrate release tooling.


## Unresolved questions

- No open user scope decisions. `avisor-history` treated as producer-confirmed spelling typo. Hashing utility explicitly removed during validation.
- No evaluation writer found; reader paths/behavior known, so not a blocker.
- Qualification prerequisites: authenticated MongoDB fixture, disposable systemd/user session, native platform toolchain. Record unavailable gates explicitly; do not claim them passed.
