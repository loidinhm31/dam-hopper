# Phase 04 — Role-Aware systemd Units and Ownership

## Context Links

- [Parent plan](./plan.md)
- [Phase 02 staging](./phase-02-rust-cli-safe-acquisition-staging.md)
- [Phase 03 web host](./phase-03-web-host-runtime-origin-health.md)
- [Systemd research](./research/researcher-02-systemd-transaction-runtime.md)
- [Current unit](../../deploy/systemd/dam-hopper.service)
- [Current Linux operations guide](../../docs/linux-systemd.md)

## Overview

- **Date:** 2026-09-03
- **Description:** Render concrete independent API/web units, create the web identity, and enforce role-specific filesystem and privilege boundaries.
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Effort:** 12h

## Key Insights

- systemd supervises committed processes; the manager coordinates release readiness and rollback. Unit dependencies cannot express exact-version health.
- API must initially remain `loidinh` because PTY, project, SSH, config, and SQLite access depend on that home identity.
- `NoNewPrivileges=yes` would block legitimate `sudo` from managed interactive terminals. Preserve `false` for API with explicit rationale; use strong isolation for the non-interactive web service. This resolves the current docs/unit disagreement without pretending the broad API boundary is fixed.
- Units must execute concrete verified paths. `/opt/dam-hopper/current` is diagnostic convenience, never `ExecStart` authority.

## Requirements

### Functional

- Role matrix:
  - server: common manager + API binary/template; only `dam-hopper-api.service` may activate.
  - web: common manager + web binary/assets/template/sysusers; only `dam-hopper-web.service` may activate.
  - both: exact same release/version for both units in one manager transaction.
- Unit names and ports are fixed: API `0.0.0.0:4801`; web `0.0.0.0:4802`; legacy `4800` must be free at every activation.
- Render unit files from attested templates with allowlisted placeholders only: concrete release root, exact version, API origins, and public runtime-config path.
- Never add `Requires=`, `PartOf=`, shared process, proxy, or same-unit coupling between API and web.
- Fresh install remains disabled/inactive. Enable selected units only after Phase 05 commit; role removal disables/stops the removed unit during explicit role activation.
- Web identity is fixed system account `dam-hopper-web`, no home, login shell, supplementary groups, or API data access.

### Non-functional

- Root ownership/modes: release dirs/binaries `0755`, static files/templates `0644`, manager state `0700/0600`, units and public host config `0644`, management CLI `0755`.
- API unit loads existing `server.env` then generated `server-safety.env`, pins config/home/host/port, runs non-root, uses graceful SIGTERM and `KillMode=mixed` so server shutdown orders PTY persistence before final cgroup kill.
- Web unit uses `Type=exec`, `NoNewPrivileges=yes`, empty capabilities, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, private devices, and read-only access only to its selected release and public host config.
- Validate templates in an isolated root before pending; validate rendered units with `systemd-analyze verify` before switch.

## Architecture

Publisher ships `systemd/dam-hopper-api.service.in`, `systemd/dam-hopper-web.service.in`, and `sysusers.d/dam-hopper-web.conf` inside the one archive. Templates are themselves exact manifest inventory.

Install builds candidate rendered units under `/var/lib/dam-hopper-manager/pending-units/<txn>/`; it does not replace active `/etc/systemd/system` units. `host-config.json` has schema, role, stable web profile UUID, API URL, and exact allowed web origins. Active public config is `/etc/dam-hopper/host-config.json`; pending config remains manager-private until activation.

API unit uses concrete `/opt/dam-hopper/releases/<tag>/<role>/bin/dam-hopper-server`. Web unit uses the matching `dam-hopper-web` and `web/` paths. Web reads only `/etc/dam-hopper/host-config.json`. systemd sysusers creates the identity before web validation; account persistence after rollback is harmless and avoids unsafe account deletion.

## Related Code Files

### Create

- `deploy/systemd/dam-hopper-api.service.in` — concrete-path API template.
- `deploy/systemd/dam-hopper-web.service.in` — isolated web template.
- `deploy/sysusers.d/dam-hopper-web.conf` — fixed system identity declaration.
- `server/src/linux_release/unit.rs` — strict placeholder rendering and policy validation.
- `server/src/linux_release/systemd.rs` — no-shell systemctl/systemd-analyze adapter.
- `server/src/linux_release/process.rs` — cgroup, MainPID, executable, UID, and listener evidence.
- `server/src/linux_release/ownership.rs` — selected-role owner/mode/set checks.
- `server/tests/linux_release_unit_policy.rs` — template/render/effective property tests.

### Modify

- `server/src/linux_release/host_config.rs` — active/pending config paths and role-transition rules.
- `server/src/linux_release/stage.rs` — render candidate units without installing/enabling them.
- `server/src/linux_release/mod.rs` — export systemd/ownership modules.
- `deploy/release/release-manifest.schema.json` — require template/sysusers inventory and service contracts.

### Delete

- None yet. `deploy/systemd/dam-hopper.service` remains solely for Phase 07 verified migration.

## Implementation Steps

1. Define templates with finite tokens; reject leftover/duplicate tokens, newline/control injection, non-canonical release roots, and URL/origin text outside strict serializers.
2. Implement role set algebra and expected installed inventory/modes. Treat unselected unit/files as drift, not optional extras.
3. Add sysusers preflight and creation. Verify resulting UID resolves to `dam-hopper-web`, has no home/login capability, and is not `loidinh`/root.
4. Render candidate units and host config into root-private manager state; `fsync` files/directories before marking pending.
5. Isolated-verify both templates using placeholder executables/config, then verify selected rendered units against actual candidate paths.
6. Encode API contract: `Type=exec`, `User/Group=loidinh`, exact HOME/XDG/config/env order, API-only mode, bind/port, restart bounds, SIGTERM, `KillMode=mixed`, `TimeoutStopSec=20s`, `UMask=0077`, `NoNewPrivileges=false`, journald.
7. Encode web contract: fixed user/group, exact root/config/version/port, `Restart=on-failure`, cgroup cleanup, strict sandbox, no environment files, writable paths, network client/proxy settings, or home access.
8. Add unit policy tests plus planned effective-property checks using `systemctl show` after Phase 08 activation.
9. Plan compile proof: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`; planned static unit proof: `systemd-analyze verify` against isolated rendered candidates.
10. Submit to `evcrate-code-reviewer`; fix blocking findings and rerun compile/static proofs before approval.

## Todo List

- [ ] Add API/web templates and web sysusers declaration.
- [ ] Add strict unit rendering and role inventory.
- [ ] Add account, ownership, process, and systemd adapters.
- [ ] Preserve API runtime/env/graceful-shutdown requirements.
- [ ] Enforce web least privilege and service independence.
- [ ] Run compile/static checks and pass reviewer gate.

## Success Criteria

- Server/web/both candidate unit sets match the role matrix exactly; no mixed-version or unselected service can be installed/enabled.
- Fresh install has no enabled or active selected unit and no `4800/4801/4802` listener.
- Effective API process UID/GID is `loidinh`; effective web UID/GID is the fixed distinct account; neither service is root.
- API executable, web executable, static root, and runtime config resolve under one concrete `<tag>/<role>` release view, never `current`.
- Stopping/crashing API does not stop web and vice versa; units have no coupling dependency.
- Web effective sandbox cannot read `/home/loidinh`, API env/token/SQLite, projects, or manager state and cannot write its release tree.
- Compile/static commands exit `0`; reviewer has no unresolved P1/P2 findings.

## Risk Assessment

- **API remains broad:** Record as accepted v1 residual risk; do not claim web-grade isolation.
- **Hardening breaks user tools:** Preserve current API privilege semantics and validate real PTY/SIGTERM behavior before release.
- **Template injection:** Serialize finite typed fields; never concatenate operator text into shell or Environment lines.
- **SELinux denial:** Phase 08 validates actual Fedora labels/ports; manager fails activation and rolls back rather than disabling SELinux.
- **Account drift/drop-ins:** Reject unexpected identity properties and unit drop-ins before activation.

## Security Considerations

- Web service gets no secrets and no read path into API/user state.
- API origins are exact and wildcard-free. Runtime config publishes URL only.
- Manager verifies unit file owner/mode/hash, fragments/drop-ins, effective identity, and concrete executable both before and after start.
- Never weaken host firewall/Tailscale, SELinux, or systemd protections automatically.

## Next Steps

Phase 05 atomically installs these rendered units and commits enablement only after health. Phase 07 removes the old single unit after migration evidence. Unresolved questions: none.
