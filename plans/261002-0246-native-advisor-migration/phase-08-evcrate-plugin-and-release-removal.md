# Phase 08: Remove Evcrate plugin integration and release assets

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions and integration inventory](./reports/validated-decisions.md), incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phase 05 G1 and copied source closure complete.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: Evcrate retirement worker. Estimated implementation effort: 5h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

Evcrate plugin/ contains built/generated packaging, while UI/contract/provider code also lives under viewer/src and src/protocol. Preserve core Advisor producer and currently supported non-plugin behavior only, not a historical standalone picker. The plugin archive is a separate CI product; general public release scripts and seven public assets are not plugin packaging.

## Requirements

Completely remove Dam-Hopper plugin integration, packaging, release archive generation/upload/check/download requirements, vendored SDK and plugin-only tests. Preserve core Advisor CLI/settings/history execution and any currently supported non-plugin viewer behavior. Do not delete shared domain validation with remaining core/standalone imports.

## Architecture

Dam-Hopper owns copied native view/domain code after G1; no runtime cross-repo dependency. Evcrate no longer imports @dam-hopper/plugin-sdk or starts DamHopperPortProvider. Pure contracts formerly plugin-named but used standalone are renamed to neutral Advisor data contracts and all callers migrated, not left as re-export aliases.

## Related code files

DELETE /home/loidinh/WS/evcrate/plugin/ in full, including vendor tarball, generated HTML, manifests and backend worker.
DELETE /home/loidinh/WS/evcrate/scripts/build-advisor-plugin-candidate.mjs and scripts/generate-advisor-plugin-data-schema.mjs when no retained native-neutral schema caller exists; scripts/plugin/ plugin-only contents per research.
KEEP /home/loidinh/WS/evcrate/scripts/{prepare-release-assets.cjs,verify-private-linux-release.cjs} and scripts/release/** general tooling; edit only proven plugin branches, if any. MODIFY .github/workflows/release.yml plugin-only build/archive/verify and artifact steps.
MODIFY /home/loidinh/WS/evcrate/{package.json,package-lock.json or actual lockfile,tsconfig*.json} only referenced existing files.
DELETE /home/loidinh/WS/evcrate/viewer/src/providers/{dam-hopper-port-provider.ts,bridge-contract.ts}; preserve provider-neutral interfaces only where currently supported non-plugin consumers need them.
MODIFY /home/loidinh/WS/evcrate/viewer/src/{app.tsx,app-state*.ts,providers/advisor-data-provider.ts} to remove plugin mode without restoring historical standalone behavior.
RENAME /home/loidinh/WS/evcrate/src/protocol/advisor-plugin-data-api.ts to advisor-data-api.ts if still used outside plugin, migrate all imports and remove obsolete plugin envelope fields. Keep core advisor-contract/evaluation/metrics/settings modules.
DELETE plugin-only integration tests/docs runtime instructions; UPDATE current release/viewer docs and changelog. Keep historical plans as history.
KEEP /home/loidinh/WS/evcrate/.evcrate/source/.evcrate/bin/{evcrate-advisor,lib/advisor/**} core producer/history/settings and current core tests. DELETE tests/plugin/** only after useful domain assertions migrate.

## Implementation Steps

1. Verify G1 and Dam-Hopper source closure is self-contained; native build must not read sibling Evcrate checkout. Capture removal inventory before deleting generated folder.
2. Delete plugin directory, plugin-only scripts/SDK dependency and path-hash utility code; preserve producer project partition, checkpoint, revision and cursor hashes. Walk all inbound imports using available LSP references before exported-symbol cleanup; if no server configured, explicit import/dependency inventory.
3. Remove port provider/bridge contract and plugin-mode construction from standalone viewer. Preserve only currently supported non-plugin entry/logic if any; do not invent or restore a historical local/file picker. If the remaining viewer build is solely the plugin entry, retire that build target while retaining domain code required by core producer. Remove frame/capability/registration-only state/actions/text.
4. Rename shared plugin-named data contract to neutral Advisor module only if retained consumers need it; migrate every caller, validator generator, test and docs import. No alias exports or deprecated plugin option.
5. Keep general prepare-release-assets.cjs, verify-private-linux-release.cjs and scripts/release/**; edit only proven plugin branches. Remove separate dist/advisor-plugin/ CI staging/archive/digests/gates, not public asset logic. Preserve all seven public assets: Linux archive+SHA256, Windows archive+SHA256, release JSON, install.sh and install.ps1, plus unrelated npm/CLI/web products and checksum tooling.
6. Remove .github/workflows/release.yml plugin build/archive/verify, npm ci --prefix plugin and plugin artifact upload/download steps; remove package build:all plugin UI step and plugin-only package commands/build settings/lockfile dependencies. Published historical GitHub assets remain unless remote deletion is explicitly requested; new builds no longer produce/request plugin products.
7. Migrate meaningful producer/standalone domain assertions before deleting plugin-only tests. Replace Dam-Hopper's `scripts/test-native-advisor-parity.mjs` (which imports the Evcrate plugin backend) with permanent native Rust parity coverage from Phases 02/03, then remove the script before deleting that backend. Remove current docs telling users to register/install plugin; keep core Advisor operational docs.
8. After integration finish, run source repository's actual build/test/release verification commands from its current manifests. Produce release assets in scratch output and assert expected retained products present, plugin archive absent.
9. Smoke core Advisor history writer in temporary HOME using existing deterministic fixture mode; exercise any retained supported non-plugin viewer behavior, then native Dam-Hopper on the same documents. No plugin SDK/worker/iframe path may be necessary.

## Todo list

- [ ] Verify G1 and Dam-Hopper source closure is self-contained; native build must not read sibling Evcrate checkout. Capture removal inventory before deleting generated folder.
- [ ] Delete plugin directory, plugin-only scripts/SDK dependency and path-hash utility code; preserve producer project partition, checkpoint, revision and cursor hashes. Walk all inbound imports using available LSP references before exported-symbol cleanup; if no server configured, explicit import/dependency inventory.
- [ ] Remove port provider/bridge contract and plugin-mode construction from standalone viewer. Preserve only currently supported non-plugin entry/logic if any; do not invent or restore a historical local/file picker. If the remaining viewer build is solely the plugin entry, retire that build target while retaining domain code required by core producer. Remove frame/capability/registration-only state/actions/text.
- [ ] Rename shared plugin-named data contract to neutral Advisor module only if retained consumers need it; migrate every caller, validator generator, test and docs import. No alias exports or deprecated plugin option.
- [ ] Keep general prepare-release-assets.cjs, verify-private-linux-release.cjs and scripts/release/**; edit only proven plugin branches. Remove separate dist/advisor-plugin/ CI staging/archive/digests/gates, not public asset logic. Preserve all seven public assets: Linux archive+SHA256, Windows archive+SHA256, release JSON, install.sh and install.ps1, plus unrelated npm/CLI/web products and checksum tooling.
- [ ] Remove .github/workflows/release.yml plugin build/archive/verify, npm ci --prefix plugin and plugin artifact upload/download steps; remove package build:all plugin UI step and plugin-only package commands/build settings/lockfile dependencies. Published historical GitHub assets remain unless remote deletion is explicitly requested; new builds no longer produce/request plugin products.
- [ ] Migrate meaningful producer/standalone domain assertions before deleting plugin-only tests. Replace Dam-Hopper's `scripts/test-native-advisor-parity.mjs` (which imports the Evcrate plugin backend) with permanent native Rust parity coverage from Phases 02/03, then remove the script before deleting that backend. Remove current docs telling users to register/install plugin; keep core Advisor operational docs.
- [ ] After integration finish, run source repository's actual build/test/release verification commands from its current manifests. Produce release assets in scratch output and assert expected retained products present, plugin archive absent.
- [ ] Smoke core Advisor history writer in temporary HOME using existing deterministic fixture mode; exercise any retained supported non-plugin viewer behavior, then native Dam-Hopper on the same documents. No plugin SDK/worker/iframe path may be necessary.

## Success Criteria

No Evcrate plugin directory/provider/SDK/path-hash utility or plugin archive generation/upload requirements. Core producer writes compatible history and native viewer reads it. Permanent native Rust parity tests replace the Dam-Hopper script importing Evcrate plugin backend before that backend is removed. Currently supported non-plugin behavior remains functional; historical removed standalone functionality is not newly required. General release tooling and all seven public assets remain; asset verifier passes without the separate plugin CI archive. Dam-Hopper build is independent of sibling checkout.

## Risk Assessment

Data-contract file has shared consumers: blind deletion breaks retained behavior. General release tooling is not plugin-only and must remain. Generated CJS plugin clones are removable only after native ownership is proven. The Dam-Hopper parity script imports the Evcrate plugin backend; Phases 02/03 native parity tests must replace it before this phase removes the backend.

## Security Considerations

No copying actual user history into fixtures/assets. Do not change core policy/settings permission model while removing integration. Remote release deletion is not requested.

## Next steps

Hand release/producer/standalone smoke evidence to Phase 09; no source integration restored as rollback shim.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
