# Phase 07: Retire Linux runner and deliver safe manual uninstall

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions and integration inventory](./reports/validated-decisions.md), incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phase 01 retirement contracts; deploy implementation parallel to UI; apply only after G1/native release installed.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: Linux deployment worker. Estimated implementation effort: 10h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

Runner service is shared Linux platform and currently live according to read-only research. API and idle-suspend helper depend on plugin-named tmpfiles and supplementary group. Strict manager records contain runner/plugin metadata, so deletion without migration makes installed host state unreadable.

## Requirements

New bundles/install/upgrade/recovery never provision/start/require plugin runner or bundled worker Node. Preserve native API/web/PTYS/idle-suspend runtime and release manager integrity. Deliver one explicit manual stop/remove script; planning does not run it. No deleting user history or arbitrary accounts/groups.

## Architecture

Replace shared plugin tmpfiles with `dam-hopper-runtime.conf.in` and non-plugin runtime group policy for API/helper socket access. Reuse current runtime provisioning and descriptor-safe cleanup. Strict committed manager-state v1/v2 migration to native schema3 uses deployment lock/backup/atomic durable writes; release-manifest schemas remain separate. A narrow legacy manifest inspection reader preserves installed-state visibility, never an active plugin compatibility shim. Native activation/automatic rollback reject plugin-bearing inventory before mutation.

## Related code files

MODIFY /home/loidinh/WS/dam-hopper/server/src/linux_release/{constants.rs,account.rs,activate.rs,activate_preflight.rs,api_runtime.rs,cli.rs,host_config.rs,layout.rs,legacy_format2.rs,mod.rs,recovery.rs,rollback.rs,runtime_cleanup.rs,stage.rs,stage_transaction.rs,stage_units.rs,state.rs,state_record.rs,unit.rs,unit_policy.rs,inventory_validation.rs,manifest.rs,manifest_validation.rs,diagnostics/}; remove only plugin portions.
MODIFY /home/loidinh/WS/dam-hopper/deploy/{systemd/dam-hopper-api.service.in,systemd/dam-hopper-idle-suspend-helper.service.in,systemd/dam-hopper-idle-suspend-helper.socket.in,release/,reset-linux-production.sh}; .github/workflows/release-linux.yml runner/worker asset inputs.
UPDATE deploy/release/{release-manifest.schema.json,generate-release-manifest.mjs,check-release-assets.mjs,build-release-archive.sh} and release fixtures together with manifest ComponentsMeta/ServicesMeta, validators and inventory.
DELETE /home/loidinh/WS/dam-hopper/deploy/systemd/dam-hopper-plugin-runner.service.in and deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in after shared IPC replacement.
CREATE /home/loidinh/WS/dam-hopper/deploy/tmpfiles.d/dam-hopper-runtime.conf.in and deploy/remove-plugin-platform.sh.
MODIFY /home/loidinh/WS/dam-hopper/tests/deploy/ retained fresh-install/upgrade/security/reset/rollback journeys; DELETE runner-only journeys/scripts once native regression coverage exists.
UPDATE /home/loidinh/WS/dam-hopper/docs/linux-release-operator-runbook.md if present in research; otherwise existing operator guide named by inventory.

## Implementation Steps

1. Inventory exact installed runner units, state/socket/tmpfiles paths, package files, account/group ownership and manager rollback dependencies. Use read-only systemctl/show; do not stop production as part of implementation tests.
2. Replace shared runtime setup, API/helper ExecStartPre and SupplementaryGroups token/policy with native runtime group/config, updating helper socket ownership, unit rendering/policy and account provisioning together. Preserve helper audit data, directory/socket ownership, server.pid and idle-suspend socket requirements; never delete `/run/dam-hopper` wholesale.
3. Remove runner/Node unit rendering, owner account provisioning, plugin CLI options/host config fields, health probes and inventory requirements. Remove worker/runner archive inputs and release-linux workflow binary/chmod/artifact entries; preserve API/web/helper, Windows build, general SPDX/notices and any unrelated Node needs.
4. Migrate accepted committed manager-state v1/v2 to native schema3 under DeploymentLock before native deserialization: validate strict legacy envelope, back up original, strip only enumerated obsolete plugin/runner fields and bump durable generation once. Preserve unrelated metadata/journal and retained asset digests; unknown/malformed state and unfinished live transactions fail closed without mutation.
5. Normalize legacy host TOML plugin-owner/admin fields without rewriting unrelated service identity/origins. Coordinate Phase06 removal of api/agent_status.rs plugin_owner_user fallback while preserving service_user/HOME lookup. No deprecated public DTO fields or CLI aliases remain after one-time migration.
6. Update manifest ComponentsMeta/ServicesMeta, schema/generator, asset gate, validators and fixtures together. Use a narrow validated legacy manifest reader for status/migration/retention inspection only; never rewrite signed immutable manifest bytes or relabel old bundles as native. Reject plugin-bearing candidate/rollback inventory before staging/switch; retain immutable old releases plus backed-up old manager/state for explicit manual legacy recovery. No automatic obsolete-runner restart.
7. New bundle/install provisioning uses API service HOME exactly; history must be an existing readable real final directory, not a root symlink, with no path hash requirement. Do not scan other users, copy private history automatically or silently change service identity/HOME. Validate native discovery under rendered service user/HOME.
8. Implement `deploy/remove-plugin-platform.sh`: default inspection/dry-run; `--apply` and explicit `--scope system|user` with target user for user scope; fail if API/helper units still reference old runtime config or plugin group. Require native release commit/migration first and release-manager transaction lock. Detect unavailable user DBus and explain without escalating to other sessions.
9. Apply path allowlist: verified `/etc/systemd/system/dam-hopper-plugin-runner.service` and managed drop-ins/symlinks, `/run/dam-hopper/plugin-runner.sock`, `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`, `/var/lib/dam-hopper-plugin-runner/plugins` and verified plugin-only runtime state. Stop then disable exact scoped runner unit; verify stopped, signal only verified unit-owned descendants if required. Remove service-owned registry only after source-history exclusion check. Daemon reload, reset failed only for removed unit, then verify absence. Missing artifacts → success; permission/type/ownership mismatch → abort.
10. Never remove HOME/.evcrate, history, custom users, unrelated groups, shared IPC, existing retained release files, global Node install or generic systemd files. Only remove dedicated auto-created runner account/group if a separate explicit operator option proves no ownership/membership consumers; default preserve them and report inert remainder.
11. Isolated deployment fixtures exercise dry-run/apply/idempotence, symlink trap, unavailable user bus, active runner, old API unit prerequisite, plugin-bearing manager state, malformed state, pending transaction, native rollback/crash recovery and helper/API startup without runner.
12. Deliver literal manual command examples with sequence: deploy native build + migrate → verify Advisor/PTYS/helper → inspect script → explicit apply → verify unit absent/history intact. Test system scope in disposable systemd host; user scope in disposable login/user-manager session. Production cleanup remains operator action.

## Todo list

- [ ] Inventory exact installed runner units, state/socket/tmpfiles paths, package files, account/group ownership and manager rollback dependencies. Use read-only systemctl/show; do not stop production as part of implementation tests.
- [ ] Replace shared runtime setup, API/helper ExecStartPre and SupplementaryGroups token/policy with native runtime group/config, updating helper socket ownership, unit rendering/policy and account provisioning together. Preserve helper audit data, directory/socket ownership, server.pid and idle-suspend socket requirements; never delete `/run/dam-hopper` wholesale.
- [ ] Remove runner/Node unit rendering, owner account provisioning, plugin CLI options/host config fields, health probes and inventory requirements. Remove worker/runner archive inputs and release-linux workflow binary/chmod/artifact entries; preserve API/web/helper, Windows build, general SPDX/notices and any unrelated Node needs.
- [ ] Migrate accepted committed manager-state v1/v2 to native schema3 under DeploymentLock before native deserialization: validate strict legacy envelope, back up original, strip only enumerated obsolete plugin/runner fields and bump durable generation once. Preserve unrelated metadata/journal and retained asset digests; unknown/malformed state and unfinished live transactions fail closed without mutation.
- [ ] Normalize legacy host TOML plugin-owner/admin fields without rewriting unrelated service identity/origins. Coordinate Phase06 removal of api/agent_status.rs plugin_owner_user fallback while preserving service_user/HOME lookup. No deprecated public DTO fields or CLI aliases remain after one-time migration.
- [ ] Update manifest ComponentsMeta/ServicesMeta, schema/generator, asset gate, validators and fixtures together. Use a narrow validated legacy manifest reader for status/migration/retention inspection only; never rewrite signed immutable manifest bytes or relabel old bundles as native. Reject plugin-bearing candidate/rollback inventory before staging/switch; retain immutable old releases plus backed-up old manager/state for explicit manual legacy recovery. No automatic obsolete-runner restart.
- [ ] New bundle/install provisioning uses API service HOME exactly; history must be an existing readable real final directory, not a root symlink, with no path hash requirement. Do not scan other users, copy private history automatically or silently change service identity/HOME. Validate native discovery under rendered service user/HOME.
- [ ] Implement `deploy/remove-plugin-platform.sh`: default inspection/dry-run; `--apply` and explicit `--scope system|user` with target user for user scope; fail if API/helper units still reference old runtime config or plugin group. Require native release commit/migration first and release-manager transaction lock. Detect unavailable user DBus and explain without escalating to other sessions.
- [ ] Apply path allowlist: verified `/etc/systemd/system/dam-hopper-plugin-runner.service` and managed drop-ins/symlinks, `/run/dam-hopper/plugin-runner.sock`, `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`, `/var/lib/dam-hopper-plugin-runner/plugins` and verified plugin-only runtime state. Stop then disable exact scoped runner unit; verify stopped, signal only verified unit-owned descendants if required. Remove service-owned registry only after source-history exclusion check. Daemon reload, reset failed only for removed unit, then verify absence. Missing artifacts → success; permission/type/ownership mismatch → abort.
- [ ] Never remove HOME/.evcrate, history, custom users, unrelated groups, shared IPC, existing retained release files, global Node install or generic systemd files. Only remove dedicated auto-created runner account/group if a separate explicit operator option proves no ownership/membership consumers; default preserve them and report inert remainder.
- [ ] Isolated deployment fixtures exercise dry-run/apply/idempotence, symlink trap, unavailable user bus, active runner, old API unit prerequisite, plugin-bearing manager state, malformed state, pending transaction, native rollback/crash recovery and helper/API startup without runner.
- [ ] Deliver literal manual command examples with sequence: deploy native build + migrate → verify Advisor/PTYS/helper → inspect script → explicit apply → verify unit absent/history intact. Test system scope in disposable systemd host; user scope in disposable login/user-manager session. Production cleanup remains operator action.

## Success Criteria

Fresh/upgrade/native rollback/crash recovery run without runner/worker Node. Accepted committed manager-state v1/v2 migrates once to schema3; malformed/unknown/pending state does not mutate. Legacy manifest inspection works without rewriting immutable bundles; plugin-bearing activation/rollback refuses before mutation. API/helper startup and IPC preserved. Uninstall dry-run nonmutating, explicit apply removes verified plugin service/runtime, second apply succeeds, history bytes unchanged. User scope qualified separately or explicitly marked external validation gate.

## Risk Assessment

Deleting old tmpfiles/group breaks API and idle-suspend; replacement is mandatory. Destructive uninstall cannot be tested on live host. Legacy release rollback is intentionally incompatible with new manager; backed-up legacy manager/state required and clearly documented.

## Security Considerations

No broad pkill/rm -rf HOME or groupdel/userdel by default. Exact paths with no symlink traversal; root required only system scope. Stop confirmed service before removing socket/state. Existing service permissions remain; no world-readable private history or automatic ACL broadening.

## Next steps

After native release and G1, operator may run script. Phases 08/09 release checks integrate native-only artifacts and deployment evidence.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
