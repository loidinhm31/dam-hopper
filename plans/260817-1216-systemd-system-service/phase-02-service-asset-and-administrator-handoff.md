# Phase 02: Service Asset and Administrator Handoff

## Context links

- [Parent plan](./plan.md)
- [Phase 01 gate](./phase-01-isolated-port-4801-feasibility-gate.md)
- [Advisor brief](./reports/01-advisor-decision-brief.md)
- [Planned architecture](../../docs/system-architecture.md#proposedplanned-systemd-system-service-repository-asset-not-installed)

## Overview

- Date: 2026-08-17
- Description: implement the future unit asset, safe human administrator handoff, and shutdown hardening
- Priority: P2
- Implementation status: complete; Phase 01 gate complete; asset and handoff implemented
- Review status: approved by independent release validation and code review
- Administrator validation status: pending; the production systemd service remains uninstalled
- Effort: 2h

## Key Insights

- System-unit ownership does not require a root server process; `User=loidinh` is the hard boundary.
- Explicit paths avoid system-manager HOME/XDG ambiguity.
- Current nohup remains on `4800`; the future unit targets `4801`, but neither launch may concurrently own the live SQLite files.
- `/opt/dam-hopper/web` is absent, so UI asset strategy must be resolved before install.

## Requirements

- Future unit: `Type=simple`, `User=loidinh`, explicit HOME/XDG/config/binary/web/working paths,
  `127.0.0.1:4801`, explicit production environment/auth fail-closed guard, `Restart=on-failure`,
  journald, SIGTERM, bounded stop.
- Execute the server directly; no shell wrapper, environment file, PID file, sudo, capability,
  privileged helper, or root pre-start process.
- Preserve loidinh ownership and `0600` modes of private runtime secrets/DBs.
- Handoff separates non-privileged asset preparation from administrator install/start/rollback.

## Architecture

Administrator-owned unit and `/opt` assets launch one cgroup whose main process starts directly as
loidinh. The process reads `/home/loidinh/.config/dam-hopper/dam-hopper.toml`, owns user-private
runtime state, binds loopback `4801`, and emits stdout/stderr to journald. Stop targets the main process
with SIGTERM; the server snapshots buffers, marks PTYs killed, terminates their process groups, then
systemd applies bounded final cgroup cleanup. A per-disposal generation fence also rejects
in-flight PTY creates from publishing after disposal, while terminal server shutdown rejects
new creates after shutdown begins.

## Related code files

- Create: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/deploy/systemd/dam-hopper.service`
  - Dependency: Phase 01 pass; future repository unit template only, never installed automatically.
- Create: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/linux-systemd.md`
  - Dependency: final unit fields and resolved UI hosting choice; administrator handoff/rollback.
- Modify: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/system-architecture.md`
  - Dependency: asset design review; retain honest installed/uninstalled status.
- Delete: none.

## Implementation Steps

1. Resolve same-process web assets versus external UI. Use same-process root-owned
   `/opt/dam-hopper/web`; no external CORS surface is needed.
2. Create the unit template with direct `ExecStart=/opt/dam-hopper/bin/dam-hopper-server`,
   explicit arguments/environment including `RUST_ENV=production`, `User=loidinh`, journald,
   on-failure restart, and graceful stop semantics. Do not add an `EnvironmentFile`.
3. Document pre-install checks: Phase 01 pass, paths exist, config/runtime ownership is loidinh,
   nohup is stopped, port 4801 is free, the planned 4800 handoff is complete, and no process
   holds live SQLite files.
4. Document administrator-only first-install asset installation with exact-target absence checks,
   root ownership/modes for unit/binary/web, a fresh-install marker, manager reload, enable/start,
   status, journal, loopback health, protected route, and UID checks.
5. Document marker-guarded rollback: stop/disable unit, remove only new unit/assets, reload manager,
   verify no listener/DB holder, then optionally restore the prior nohup launch. Existing deployments
   require an administrator backup/restore plan.
6. Keep all admin commands in the handoff; repository scripts and server perform no elevation.

## Todo list

- [x] UI hosting choice resolved: same-process `/opt/dam-hopper/web`
- [x] Unit template uses direct non-root execution and production fail-closed auth
- [x] Explicit path/auth/network/log/restart/stop fields documented
- [x] Administrator install and marker-guarded rollback handoff written
- [x] Architecture status remains honest
- [x] Independent release validation and code review complete
- [ ] Administrator installation, runtime, and rollback evidence returned

## Success Criteria

- Static review finds no path where the server runs as root.
- Unit contains no shell, sudo, privilege helper, no-auth flag, wildcard bind, PID file, or log file;
  a home `.env` cannot turn on no-auth without the production guard failing startup.
- Handoff prevents concurrent nohup/systemd use of live SQLite and keeps the new unit on loopback `4801`.
- Active PTY disposal marks sessions killed and terminates their process groups before final persistence;
  a per-disposal generation fence also prevents queued or in-flight auto-respawns and in-flight PTY
  creates from publishing after disposal; a persistence gate identity-checks periodic/final reader
  snapshots against replacement sessions; terminal shutdown joins readers before persistence shutdown
  and rejects new creates.
- First-install and rollback shell blocks fail closed, stage exact assets, reject dangling symlinks,
  and retain the marker if partial-install cleanup fails; they do not delete user-owned config or databases.
- The installed `bin/` directory is traversable by `loidinh`; install and rollback reject
  symlinked `/opt/dam-hopper` and `bin/` parents, and rollback checks/stops the loaded systemd
  service before deleting any marker-backed asset.
- The packaged same-origin web build rejects a backend override and ignores stale cross-origin active
  profiles or legacy URL storage, while isolated Vite development continues to target `4801`.

## Risk Assessment

- Admin-installed unit could accidentally run root: require explicit `User=loidinh` review.
- Missing web assets could produce a healthy API but broken UI: make hosting choice an install gate.
- Restart loops could hide config errors: use on-failure, bounded delay, and journal inspection.

## Security Considerations

- Unit, binary, and same-process web assets are administrator-owned; runtime state remains loidinh.
- Loopback and auth are defense-in-depth defaults; `RUST_ENV=production` makes no-auth fail closed.
- No secrets in unit text, docs, command output, or environment files.

## Next steps

- Hand the asset/docs to Phase 03 for the remaining administrator checklist execution. Keep the
  production deployment marked uninstalled until host installation, runtime, and rollback evidence
  is returned.

## Unresolved Questions

- Administrator acceptance identity and evidence-retention location remain unspecified; this does not block the repository asset.
