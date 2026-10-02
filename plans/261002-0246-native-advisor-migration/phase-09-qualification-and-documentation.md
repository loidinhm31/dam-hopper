# Phase 09: Qualify native-only cutover and update current docs

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions and integration inventory](./reports/validated-decisions.md), incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phases 02–08 integrated; G1 native parity already passed.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: Integration/verification owner. Estimated implementation effort: 7h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

Planning provides no implementation verification. Tests alone do not prove native UI/service/release behavior. Default pnpm dev:server runs --no-auth, which intentionally cannot qualify admin Advisor; authenticated fixture credentials/database are required.

## Requirements

Run final build/lint/test once after workers stop; actual authenticated server/browser/release/deployment smoke. Remove dead current docs/instructions and update changelogs in both repos. Record proof per acceptance scenario, with unavailable platform/runtime gates explicitly blocked, never marked passed.

## Architecture

Three gates: G1 before source deletion = native API/UI parity; G2 before manual cleanup = native release/state migration/shared IPC ready; G3 final delivery = plugin-free dependencies/assets + real browser/domain/producer/deployment evidence. One verification owner owns execution and evidence.

## Related code files

UPDATE /home/loidinh/WS/dam-hopper/docs/{architecture/native-advisor.md,system-architecture.md,api-reference.md,configuration-guide.md,frontend-components.md,codebase-summary.md,CHANGELOG.md,project-overview-pdr.md} relevant sections only; current plugin architecture guides archive/remove links or label retired rather than leave them current.
UPDATE existing Evcrate release/Advisor/viewer docs and changelog identified by research; preserve core feature guidance.
UPDATE /home/loidinh/WS/dam-hopper/{README.md,deploy/server.env.example} only obsolete plugin references.
CREATE /home/loidinh/WS/dam-hopper/plans/261002-0246-native-advisor-migration/reports/qualification.md with commands, outputs, screenshots and scenario results.
DELETE implementation-only temporary scripts/scratch artifacts after evidence capture; keep behavior regressions.

## Implementation Steps

1. Integrate every shared-file/package/lockfile edit; no worker mid-flight tests/builds. Format touched TS/CSS/markdown with configured Prettier and touched Rust with cargo fmt; do not reformat unrelated user edits.
2. Run `cargo test --manifest-path server/Cargo.toml --test advisor_history_api` and `--test advisor_policy_evaluations`, retained deployment/migration tests selected by exact new names, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui test:browser`, `pnpm build`, `pnpm lint`, native build where supported; broad `pnpm check` once if runtime/toolchain available. Record actual commands, no duplicate blind reruns.
3. Run real authenticated dam-hopper-server with isolated config/HOME and current enabled MongoDB admin account/session fixture; never use dev:server no-auth as passing admin proof. Use existing test-server auth fixture conventions without resurrecting plugin test-server.
4. Exercise status/settings and all eight data operations with deterministic IDs/values. Compare every baseline row/metric/group/status; unsupported/malformed/changed/missing boundaries; alternate/unset HOME, empty/missing/unreadable real directory, explicit final-root symlink rejection, preserved project_id/checkpoint/revision/cursor hash compatibility.
5. Real browser: per-server admin toggle off/on/reload, disabled by default including upgrades; all four tabs and details; no path-hash UI/API/requirement or registration iframe; all IDE/Terminal/compact launchers and keyboard paths; focus/zoom/narrow/dark/light; late requests/project/profile/logout/role downgrade; Settings profile A versus Workspace B.
6. Consumer regression smoke: normal session/MFA expiry, PTY create/output, file list/watch, git/status and idle-suspend helper remain operational after platform deletion; no plugin:get_epoch/message/socket or worker traffic.
7. Disposable Linux host: native fresh install, strict committed manager-state v1/v2 migration to schema3, malformed/unknown/pending refusal, legacy manifest inspection without immutable-byte changes, plugin-bearing activation/rollback refusal before mutation, native rollback and crash recovery. Shared API/helper runtime then cleanup dry-run/apply/twice; history checksums unchanged, runner inactive/disabled/unit gone, no orphan verified descendants. User-scope cleanup in disposable login separately.
8. Both repositories produce retained release products in scratch space with plugin products absent. Asset verifier/upload list/inventory pass; Evcrate general tooling and all seven public assets remain while separate dist/advisor-plugin/ CI product is absent. Core producer makes source-shaped history and native app reads it; currently supported non-plugin behavior, if any, remains exercised without restoring a historical viewer.
9. Classify surviving plugin references: historical plans, retired docs, unrelated Vite/agent ecosystem okay; runtime APIs/SDK/deploy dependencies/registration instructions not okay. Verify no cross-checkout imports or public compatibility aliases.
10. Update architecture from proposed to implemented only after source matches; current docs describe admin role, per-server default-off toggle including upgrades, real HOME source directory/root-symlink rejection, no path-hash utility/API, evaluation discovery and read-only feature, cleanup prerequisites/commands and native-only automatic rollback with explicit legacy recovery backups. Changelog both repos, remove obsolete current plugin instructions.
11. Remove temporary fixtures/services/scratch outputs created for qualification, not user services/data. Complete all checklist items or state the exact external prerequisite/evidence missing; no unfinished consumer operation can be called done.

## Todo list

- [ ] Integrate every shared-file/package/lockfile edit; no worker mid-flight tests/builds. Format touched TS/CSS/markdown with configured Prettier and touched Rust with cargo fmt; do not reformat unrelated user edits.
- [ ] Run `cargo test --manifest-path server/Cargo.toml --test advisor_history_api` and `--test advisor_policy_evaluations`, retained deployment/migration tests selected by exact new names, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui test:browser`, `pnpm build`, `pnpm lint`, native build where supported; broad `pnpm check` once if runtime/toolchain available. Record actual commands, no duplicate blind reruns.
- [ ] Run real authenticated dam-hopper-server with isolated config/HOME and current enabled MongoDB admin account/session fixture; never use dev:server no-auth as passing admin proof. Use existing test-server auth fixture conventions without resurrecting plugin test-server.
- [ ] Exercise status/settings and all eight data operations with deterministic IDs/values. Compare every baseline row/metric/group/status; unsupported/malformed/changed/missing boundaries; alternate/unset HOME, empty/missing/unreadable real directory, explicit final-root symlink rejection, preserved project_id/checkpoint/revision/cursor hash compatibility.
- [ ] Real browser: per-server admin toggle off/on/reload, disabled by default including upgrades; all four tabs and details; no path-hash UI/API/requirement or registration iframe; all IDE/Terminal/compact launchers and keyboard paths; focus/zoom/narrow/dark/light; late requests/project/profile/logout/role downgrade; Settings profile A versus Workspace B.
- [ ] Consumer regression smoke: normal session/MFA expiry, PTY create/output, file list/watch, git/status and idle-suspend helper remain operational after platform deletion; no plugin:get_epoch/message/socket or worker traffic.
- [ ] Disposable Linux host: native fresh install, strict committed manager-state v1/v2 migration to schema3, malformed/unknown/pending refusal, legacy manifest inspection without immutable-byte changes, plugin-bearing activation/rollback refusal before mutation, native rollback and crash recovery. Shared API/helper runtime then cleanup dry-run/apply/twice; history checksums unchanged, runner inactive/disabled/unit gone, no orphan verified descendants. User-scope cleanup in disposable login separately.
- [ ] Both repositories produce retained release products in scratch space with plugin products absent. Asset verifier/upload list/inventory pass; Evcrate general tooling and all seven public assets remain while separate dist/advisor-plugin/ CI product is absent. Core producer makes source-shaped history and native app reads it; currently supported non-plugin behavior, if any, remains exercised without restoring a historical viewer.
- [ ] Classify surviving plugin references: historical plans, retired docs, unrelated Vite/agent ecosystem okay; runtime APIs/SDK/deploy dependencies/registration instructions not okay. Verify no cross-checkout imports or public compatibility aliases.
- [ ] Update architecture from proposed to implemented only after source matches; current docs describe admin role, per-server default-off toggle including upgrades, real HOME source directory/root-symlink rejection, no path-hash utility/API, evaluation discovery and read-only feature, cleanup prerequisites/commands and native-only automatic rollback with explicit legacy recovery backups. Changelog both repos, remove obsolete current plugin instructions.
- [ ] Remove temporary fixtures/services/scratch outputs created for qualification, not user services/data. Complete all checklist items or state the exact external prerequisite/evidence missing; no unfinished consumer operation can be called done.

## Success Criteria

Acceptance matrix A01–A20 in parent contracts report has observed proof. Native feature complete and platform removed across both repos/releases. Manual script delivered, not run against production without operator action. No tests/docs claim unavailable native/user-systemd/production qualification passed.

## Risk Assessment

MongoDB/authenticated session fixture and isolated Linux systemd/user manager required. Desktop platform-specific builds may be unavailable on Linux; record limit and do all reachable verification. Private history/policy screenshots must use synthetic fixtures.

## Security Considerations

Non-admin cannot obtain source path/history/policy/evaluation data or toggle. No path-hash field exists; no auth bypass for test convenience. Cleanup preserves checksummed history, unrelated users/groups/units and immutable release contents.

## Next steps

Update phase/checklist statuses from actual evidence; deliver implementation report only after acceptance complete. Planning itself remains pending, with no tests/runtime/cleanup applied.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
