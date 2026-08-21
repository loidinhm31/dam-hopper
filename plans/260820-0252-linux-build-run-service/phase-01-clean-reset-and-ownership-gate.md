# Phase 01: Clean reset and ownership gate

Historical phase document; superseded by the current revalidation plan at
`../260820-0912-revalidation-build-run-service/`.

## Context

The host previously had an installed systemd unit, `/opt/dam-hopper`, and
legacy nohup residue. A free port is insufficient: both launch modes can open
the same user-owned SQLite files. The current installed deployment must be
cleared before a fresh production-style run. This requested quick verification
also needs fresh local DamHopper state, but must not touch project repositories
or external data.

## Files

- Create `deploy/reset-linux-production.sh`.
- Update `docs/linux-systemd.md` with the reset contract and evidence boundary.
- Update `docs/linux-nohup.md` with PID identity and non-concurrency rules.
- Add shell-test coverage under the repository's existing test convention, or
  a fixture-driven script test that never targets live `/opt` or `/etc` paths.

## Implementation

1. Add strict mode, exact absolute-path constants, usage/help, and a dry-run
   preflight. Capture only redacted metadata: unit state/fragment, MainPID,
   executable/owner/cmdline identity, listeners on 4800/4801, database owners,
   symlink state, modes, and the fresh-install manifest/hash.
2. Stop and disable `dam-hopper.service` with `sudo systemctl disable --now`;
   validate any nohup PID against `/proc` executable, UID, command line, and
   expected PID file before signaling it. Never use broad `pkill`.
3. Recheck inactive/dead systemd, no DamHopper process, no 4800/4801 listener,
   and no owner for `sessions.db` or `telemetry.db`; abort before mutation if
   any check fails.
4. Quarantine, rather than delete, the exact legacy binary/PID/log and the
   systemd unit plus `/opt/dam-hopper` only after an administrator verifies the
   repository fresh-install marker owns those paths. Remove the activation link
   through `systemctl disable`, then `daemon-reload`.
5. Keep the default reset recoverable, then add an explicit
   `--purge-local-state` path for this quick verification. After sudo identity
   checks and a confirmation listing each exact target, remove only the local
   DamHopper config, dotenv/server env, token, OPAQUE setup, SQLite databases,
   logs, and workspace `.dam-hopper/agent-store`; never remove project trees or
   external MongoDB data. The purge must not be implied by build or start.

## Validation

Test stale/wrong PID, active listener, database holder, symlink, changed marker,
partial cleanup, successful quarantine, and confirmation refusal with temporary
fixtures. Confirm no unrelated Docker container or external MongoDB resource is
inspected for deletion. Record clean-state evidence without file contents.

## Exit criteria

The reset is idempotent and fail-closed. The normal path is recoverable; the
explicit purge path has a printed target list and confirmation. A clean-state
report proves no service, process, listener, or SQLite owner remains before
Phase 02.

## Unresolved questions

- Is the current `/opt/dam-hopper/.systemd-fresh-install/manifest` definitely
  repository-owned, or must an administrator provide a backup/restore proof?
- What quarantine retention/evidence directory should the operator use?
