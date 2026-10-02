# Validated decisions — synchronized implementation contract

Validated 2026-10-02. Five interview questions plus two initial scope questions. User-requested revalidation synchronization is now applied directly to parent plan, all nine phase requirements/steps/todos/success criteria and native-design-contract. This file retains decision/evidence traceability, not a contradictory override layer. No application implementation edits occurred.

## Confirmed user decisions

| Topic | User decision | Binding implementation instruction |
|---|---|---|
| Removal scope | Retire entire plugin platform | Delete Dam-Hopper generic SDK/runtime/registration/runner as well as Evcrate integration; preserve unrelated ecosystem plugins |
| Toggle scope | Per-server admin setting | Store `server.advisor.enabled`; not local preference or a plugin record |
| Initial toggle | Disabled by default | Missing setting=false, including upgrade; directory presence never implicitly enables |
| History root | Require a real directory | Final `$HOME/.evcrate/advisor-history` itself must not be a symlink; empty real directory available; no canonical-equals-input or ancestor-symlink identity prerequisite |
| Hash clarification | Hash not needed for reading; remove hashing entirely | **No path hash UI/API/field, Generate/Copy action, root identity or hash admission requirement** |
| Legacy rollback | Native-only automatic rollback | Native manager rejects plugin-bearing candidates before mutation; immutable old release files + old manager/state backup support explicit manual legacy disaster recovery only |

“Remove hashing” applies to the requested root/path utility and plugin binding identity, not core data algorithms. Preserve durable project_id SHA-256 partitioning, checkpoint digest validation, content revision digests and signed cursor integrity. Removing those would break existing history and observable read behavior.

## Phase synchronization record

- **Phase01:** Optional path hash requirement removed. Real-root-directory check frozen; no sourceRootIdentity/pathSha256 DTO. Producer project_id hash preserved; no allow-root-symlink instruction remains.
- **Phase02:** Do not calculate/return a path hash. Status fields `{enabled,available,path,sourceError}`. Use symlink_metadata on final root, reject symlink with bounded source issue; no required canonical string equality/UID/link-count/grant check. Root symlink scenario must prove explicit rejection, not successful reading.
- **Phase03:** Domain revisions/digests remain necessary for changed/compare behavior; they are not path hashing utility.
- **Phase04:** Remove all hash utility presentation references. Panel tabs historically named hash-tabs refer to URL hashes: make tabs local as already specified, not a data-path utility.
- **Phase05:** Settings only enable toggle + detected-directory availability/path/error. No hash generation/copy/field; no hash failure state. Native Workspace visibility remains enabled+admin+connected, with source unavailability explained inside enabled panel.
- **Phase06:** Delete `computeSha256Hex` when plugin registration/access modal removed; do not rehome the utility. Remove logout plugin revocation call while preserving ordinary session/media/auth revocation.
- **Phase07:** Confirm native-only automatic rollback and legacy backups in runbook; no old-plugin runtime compatibility shim. Existing committed old state must still migrate safely.
- **Phase08:** No plugin-only path hash code retained in Evcrate viewer. Core producer/revision hashes stay. Preserve unrelated release scripts/assets.
- **Phase09:** A03 proves root-symlink rejection. A04 proves no hashing UI/API/requirement while existing partition/revision/cursor identities still function. No Generate/Copy smoke scenario.

Implementation handoff: these decisions and the integration inventory below are incorporated directly into phase contracts and matching checklists. Supply the synchronized phase and native-design-contract to each worker; no deferred override edits, outstanding user questions or new feature work are required.

## Integration inventory — incorporated into Phases 06–08

### Phase06 runtime/auth cleanup

- `/home/loidinh/WS/dam-hopper/server/src/api/auth.rs:716`: delete `state.plugin_service.revoke_actor(...)` from logout; preserve current auth-session and media-ticket revocation. Otherwise deleting AppState.plugin_service leaves a compile failure.
- `/home/loidinh/WS/dam-hopper/server/src/api/agent_status.rs:76`: remove fallback from host TOML `service_user` to `plugin_owner_user`; preserve API service-user/home lookup and native agent-status behavior. This must migrate with host-config removal, not change agent status source ownership.
- Actual WS paths are `server/src/api/ws.rs`, `server/src/api/ws_protocol.rs` (not `server/src/ws.rs`). Delete only plugin epoch variants/issue/revoke; keep auth/MFA watcher and connection generation.
- Keep `/home/loidinh/WS/dam-hopper/packages/browser-bridge/`: used by native build; not plugin platform debris.

### Phase07 manifest/state and runtime cleanup

- Current manager-state schema is 2; legacy is1. Define native state schema3 in `server/src/linux_release/constants.rs`, strict migration for accepted committed v1/v2 state under deployment lock before native record deserialization. Remove only known plugin/runner fields, preserve unrelated state and bump generation once; invalid/unknown state and unfinished transaction explicitly refused, not permissive deserialization.
- Current release-manifest schema is separate from manager-state schema. Update `server/src/linux_release/manifest.rs::{ComponentsMeta,ServicesMeta}`, `manifest_validation.rs`, `inventory_validation.rs`, `deploy/release/release-manifest.schema.json`, `generate-release-manifest.mjs::roleForPath`, `check-release-assets.mjs::REQUIRED_INVENTORY_PATHS`, release fixtures together. Merely deleting RunnerServiceContract breaks loading old installed manifests.
- For status/migration/retention inspection, parse legacy installed manifests through a narrow versioned reader/normalizer that validates enumerated retired runner fields before discarding them. This is one-time persisted artifact migration, not an active plugin API/runtime compatibility shim. Never relabel an old immutable bundle as native or alter its signed manifest bytes. Native activate/rollback gate explicitly refuses plugin-bearing inventory before mutation.
- Shared runtime replacement must update **both** `deploy/systemd/dam-hopper-api.service.in` and `dam-hopper-idle-suspend-helper.service.in`, plus `.socket.in` ownership contract, unit render/policy, account provision, `runtime_cleanup.rs`. Preserve helper audit data, PID/socket semantics and API/helper health. Do not repurpose `deploy/reset-linux-production.sh` as broad plugin deletion.
- Exact installed system runner unit: `/etc/systemd/system/dam-hopper-plugin-runner.service`; obsolete tmpfiles `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`; socket `/run/dam-hopper/plugin-runner.sock`; registry `/var/lib/dam-hopper-plugin-runner/plugins`. Remove only verified managed artifacts after native runtime replacement, never whole `/run/dam-hopper` or immutable old releases.
- Remove runner/worker Node inputs from `deploy/release/build-release-archive.sh` and `.github/workflows/release-linux.yml` rust-binaries/chmod/artifact lists. Preserve main server/manager/API/web/helper, Windows build and general SPDX/notices still needed.

### Phase08 Evcrate release correction

- `scripts/prepare-release-assets.cjs`, `scripts/verify-private-linux-release.cjs`, `scripts/release/**` are general release tooling; **keep them**. Edit only proven plugin branches, if any; do not delete or rewrite general public asset logic.
- Remove plugin-specific build/archive/verify step and `npm ci --prefix plugin` from `/home/loidinh/WS/evcrate/.github/workflows/release.yml`, plus plugin-only `scripts/plugin/**`, `tests/plugin/**`, package commands, `build:all` plugin UI step and vendored SDK tree. Migrate useful domain assertions before removing integration tests.
- Plugin archive is separate `dist/advisor-plugin/` CI product, not one of Evcrate's public assets. Preserve exact seven public assets: Linux archive+SHA256, Windows archive+SHA256, release JSON, install.sh, install.ps1. Do not remove checksum tooling for retained products.
- Preserve `.evcrate/source/.evcrate/bin/{evcrate-advisor,lib/advisor/**}` core producer/history/settings functionality and current core tests.

## Evidence limits and unresolved questions

- System runner was read-only observed loaded/active/running; planning leaves it untouched. User-scope inspection unavailable because no user DBus/XDG_RUNTIME_DIR. Do not assume no additional deployment-host units; script must inspect explicit scope on target.
- Who produces evaluation JSON at known reader paths remains unknown; reader behavior known and preserved. Not a scope or implementation blocker.
- Native qualification requires authenticated MongoDB-backed fixture, disposable systemd/user-manager host and platform toolchain. No builds/tests or source deletions were run while planning.
- No unresolved user decision. Ready to implement using the synchronized nine phase contracts; implementation not started.
