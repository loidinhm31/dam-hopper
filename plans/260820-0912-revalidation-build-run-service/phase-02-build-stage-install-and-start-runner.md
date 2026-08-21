# Phase 02: Build, stage, install, and start runner

## Context links

- [Parent plan](./plan.md)
- [Phase 01](./phase-01-guarded-reset-and-runtime-recreation.md)
- [Existing systemd handoff](../../docs/linux-systemd.md)
- Dependency: Phase 01 contracts and fixture tests pass.

## Overview

- Date: 2026-08-20
- Description: create separate build, install, start, status, and rollback commands.
- Priority: P2
- Implementation status: completed
- Review status: direct implementation review approved; core administrator acceptance recorded in Phase 03
- Effort: 3.5h

## Key Insights

- Current repository has only manual handoff and unsafe nohup package aliases.
- Full quality/build evidence gates install, but routine start must not rebuild.
- Absolute `/opt` unit paths need isolated pre-install verification and post-install verification.
- Historical test PASS cannot be reused as current evidence.

## Requirements

- One executable production runner with explicit subcommands and no implicit action.
- Build is unprivileged; install/start/rollback request exact authenticated sudo operations.
- Build creates unique restrictive staging plus hashes and complete file inventory.
- Install consumes verified staging only, refuses unknown existing assets, and does not start.
- Start validates installed marker/unit/assets/env/ownership and clean single-owner state.
- Retire supported `server:*` nohup package aliases; do not run two SQLite owners.

## Architecture

`run-linux-production.sh build` runs the focused systemd-service server/web/test/
unit gate (native/Tauri packaging is excluded) and emits a staging manifest.
`install` validates and installs root-owned binary/web/unit/marker, reloads
systemd, and enables without starting. `start` validates installed hashes,
runtime files, service identity, and clean ports/databases before starting, then
waits up to 10 seconds for the loopback listener; socket inspection fails closed
if `ss` errors or emits diagnostics. `status` is read-only. `rollback` is
marker-backed and never removes user runtime state.

## Related code files

- Create `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/deploy/run-linux-production.sh` — production runner; tracked `100755`.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/package.json` — add argument-forwarding `linux:reset`/`linux:production`; remove legacy `server:*` aliases.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/linux-systemd.md` — script workflow and evidence classes.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/linux-nohup.md` — unsupported legacy status and no-concurrency warning.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/README.md` — supported Linux entry point.
- Modify `/home/loidinh/WS/dam-hopper-ws/systemd-system-service/docs/configuration-guide.md` — server dotenv/systemd precedence.
- Modify fixture harness from Phase 01 for staging/install/start/rollback tests.
- Delete package aliases only; leave legacy script file unmodified for manual rollback history.

## Implementation Steps

1. Implement explicit `build`, `install`, `start`, `status`, and `rollback` dispatch,
   exact paths, lock/concurrency guard, cleanup traps, and dry-run/refusal behavior.
2. Build gate: release server build, production web build with backend override unset,
   Rust/integration and relevant UI tests, lint, Bash syntax/shell lint,
   JSON/package checks, secret-sentinel scans, executable checks, and expected diff.
3. Stage binary/web/unit in a unique `0700` directory; record hashes, modes, file and
   directory counts. Verify unit through an isolated-root/placeholder strategy.
4. Install only matching staged assets with root ownership/modes; write marker and
   manifest atomically, daemon-reload, enable, then post-install verify. Do not start.
5. Start only after installed manifest, ordered env files, effective unit, ports,
   processes, and DB holders pass. Status reports values only when non-secret.
6. Rollback stops/disables, revalidates inactive/MainPID/ports/holders, rejects drift,
   and removes or quarantines only matching installed assets.
7. Exercise actual package aliases and ensure scripts are tracked executable.

## Todo list

- [x] Implement production runner subcommands and locking
- [x] Implement current focused quality/build gate without native packaging
- [x] Implement staged manifest and isolated unit verification
- [x] Implement distinct install/start/status/rollback paths
- [x] Replace package aliases and update operator docs
- [x] Add fixture-only tests and current evidence report

## Current evidence

- PASS — Phase 01/02 fixture tests cover build staging, no-start install,
  start, drift refusal, aliases, and marker-backed rollback behavior.
- PASS — the unprivileged runner build completed repository checks, artifact
  checks, restrictive staging, manifest/hash verification, and isolated unit
  verification. No install was attempted.
- PASS — direct review fixed temporary-file cleanup and strict installed
  manifest-schema validation; the reviewed implementation was approved.
- CAVEAT — `shellcheck` is not installed in this environment; Bash syntax
  validation passed. Native desktop packaging is outside the systemd service
  deployment gate.
- Live privileged install/start/status/rollback and service evidence are recorded
  in [Phase 03](./phase-03-live-acceptance-rollback-and-handoff.md); its
  explicitly not-run workload and external checks remain outside this phase.

## Success Criteria

- Build failure prevents install; install never starts; start never rebuilds.
- Server executable/web/unit hashes and ownership match the manifest.
- Effective unit retains non-root identity, direct ExecStart, production auth,
  loopback 4801, journald, restart/SIGTERM, and hardening fields.
- No supported package command invokes unsafe nohup ownership.

## Risk Assessment

- Partial privileged install: atomic staging, manifest, cleanup traps, retain marker on drift.
- Stale build evidence: bind manifest to exact artifacts and repository revision.
- Alias argument loss: test real `pnpm ... --` forwarding.
- Verification false positive: separate isolated and installed unit checks.

## Security Considerations

- Root owns only unit and `/opt` artifacts; runtime and env files remain `loidinh`.
- Never copy dotenv/token/databases into staging, manifests, web assets, or reports.
- No noninteractive sudo, wildcard deletion, broad process kill, or root server process.

## Next steps

- Phase 03 records the bounded administrator acceptance against the installed
  evidence.

## Unresolved questions

- Install or otherwise provide `shellcheck` before treating shell lint as a
  complete host-side release gate.
