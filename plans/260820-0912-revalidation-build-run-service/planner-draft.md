# Planner draft: revalidated Linux build/run service

Date: 2026-08-20 (Asia/Saigon)
Repository: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service`
Branch: `feat/systemd-system-service`

## Verdict and supersession

**Historical planning snapshot (2026-08-20).** This draft supersedes
`plans/260820-0252-linux-build-run-service/plan.md` and all of its phases. Its
pending claims describe the pre-implementation state and must not override the
bounded 2026-08-21 acceptance report.

## Current evidence

- `deploy/systemd/dam-hopper.service:8-25` has direct `ExecStart`,
  `User/Group=loidinh`, `/home/loidinh`, production mode, `127.0.0.1:4801`,
  journald, SIGTERM, restart, `UMask=0077`, and `NoNewPrivileges=true`.
- Host revalidation (`researcher-02-live-host-revalidation.md:20-35`) found
  enabled but inactive/dead service (`MainPID=0`), no 4800/4801 listener, no
  exact server process, user state `0700`/private files `0600`, root-owned
  `/opt` assets, stale nohup PID/log (log about 49 MiB), and a root-owned
  `0700` fresh-install marker whose content is **UNKNOWN**.
- `sudo` exists but unauthenticated elevation failed (`researcher-02-live-host-
  revalidation.md:42-44`); marker/assets and root-visible holders remain
  unverified. MongoDB was not observed; Docker containers are unrelated.
- `package.json:20-24` supports only unsafe legacy `server:*` nohup aliases;
  `deploy/run-linux-nohup.sh:118-170` trusts PID liveness and uses private
  files with historically weak modes. No new production/reset scripts exist.
- `server/src/main.rs:58-69,253-263` loads dotenv before CLI and enables Mongo
  only when both variables exist; `server/src/state.rs:165-183` rejects
  production no-auth. `docs/system-architecture.md:1587-1647` is the current
  systemd invariant baseline.

## Authoritative contracts

### Preflight and privileged stop

`linux:reset` runs as `loidinh`, asserts Linux, exact home/repo/branch and
canonical paths, resolves `--env-file` before any purge, and prints metadata,
paths, keys, modes, owners, PIDs, listeners, and hashes only. It must stop if
the source is inside the purge tree, a symlink/non-regular file, or
group/world-readable. Never echo values or enable shell tracing.

After explicit confirmation, it must obtain authenticated interactive sudo.
If sudo is unavailable or authentication fails, stop and instruct the operator
to run/authenticate sudo; never bypass or partially continue. With sudo, stop
and disable the unit, verify inactive/dead, `MainPID=0`, no exact DamHopper
process, no 4800/4801 listener, and no SQLite holder. Validate any nohup PID
by PID file, UID, executable, command identity, and start identity before a
signal; ambiguous identity aborts. Revalidate immediately after stopping.

### Marker, purge, recreate, and environment

Before removal, sudo must verify the root-owned fresh-install marker and
manifest nonce/hash/inventory against the exact current `/opt/dam-hopper` and
`/etc/systemd/system/dam-hopper.service`. Missing, unreadable, mismatched,
symlinked, or incomplete proof aborts and retains assets/marker.

Quick verification then purges exactly canonical
`/home/loidinh/.config/dam-hopper`—including app config, auth/setup, SQLite,
diagnostics, stale nohup binary/PID/log, and prior generated env files—only
after the typed/interactive confirmation and authenticated sudo gate. Recreate
it as `loidinh:loidinh 0700`; private files are `0600`, atomically written.
Explicitly exclude workspace/project `.dam-hopper`, all project repositories,
`/opt`, `/etc/systemd/system`, unrelated processes/listeners/containers, and
external MongoDB data. Do not quarantine/purge outside this boundary without a
separate confirmation and plan.

Copy the caller-selected dotenv **verbatim/wholesale** to
`~/.config/dam-hopper/server.env` after recreation, preserving no source path
or contents in output; user accepts this quick-check leakage risk. Do not
source or rewrite it. Generate a second `server-safety.env` afterward,
`loidinh:loidinh 0600`, containing forced `RUST_ENV=production`,
`ENVIRONMENT=production`, `DAM_HOPPER_NO_AUTH=false`,
`HOME=/home/loidinh`, `XDG_CONFIG_HOME=/home/loidinh/.config`, and
`DAM_HOPPER_WEB_DIR=/opt/dam-hopper/web`.

The unit lists `EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env`
first and `EnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env`
second. systemd reads these files in declaration order; later assignments
override earlier `Environment=`/EnvironmentFile values, so the generated
safety file directly overrides broad caller values. Keep direct absolute
`ExecStart` and explicit CLI host/port; do not rely on absence of
`--no-auth`. Validate systemd parsing and fail closed if either file is absent
or invalid. This is quick-check-only, not the later hardened secret contract.

### Quality/build, install, start, acceptance, rollback

Build is repository-only and unprivileged: run the focused server/systemd gate
before install (`pnpm build:server`, production web build with
`VITE_DAM_HOPPER_SERVER_URL` unset, `pnpm test`, `pnpm lint`, relevant UI tests
and type checking, shell syntax/fixture tests, package/secret scans, and staged
`systemd-analyze verify`). Native desktop packaging is outside this service gate.
Record a hash/inventory of a unique restrictive staging tree. Any failure
blocks install; rerun commands on this branch and record results.

Install is a distinct sudo operation consuming only the verified staging
manifest: refuse unverified existing targets, copy root-owned `/opt` binary/web
assets and unit with expected modes/no symlinks, write marker+manifest
atomically, daemon-reload, and enable. Install does not build or start.

Start is distinct: validate installed manifest, unit, both user env files,
ownership/modes, clean single-owner state, and loopback target; then start and
verify active/MainPID/effective UID-GID, authenticated health/UI, no 4800
owner, journal redaction, restart recovery, and SIGTERM/PTTY cleanup. The
runner waits up to 10 seconds for the loopback listener and fails closed when
`ss` reports an error. Start does not rebuild. Mongo remains external and
untouched; live Mongo smoke is operator-opt-in only.

Rollback is marker/manifest guarded: stop/disable, revalidate inactive,
`MainPID=0`, port/process/database absence, reject symlinks or changed assets,
then remove/quarantine only matching installed assets and retain user state.
Preserve the marker unless the operator explicitly approves successful-
acceptance retirement; report rollback separately from repository evidence.

## Files and modes

- Create `deploy/reset-linux-production.sh` and
  `deploy/run-linux-production.sh`, tracked executable mode `100755`; both
  fail closed and use exact absolute allowlists.
- Modify `deploy/systemd/dam-hopper.service` to add the two ordered
  `EnvironmentFile=` entries while preserving all current invariants/direct
  `ExecStart`.
- Modify `package.json`: add `linux:reset` and `linux:production` aliases that
  invoke the scripts directly and forward pnpm trailing arguments; test
  `test -x` and actual alias invocation.
- Retire supported `server:install/start/stop/restart/status` aliases from
  `package.json`; leave `deploy/run-linux-nohup.sh` unmodified but explicitly
  unsupported/legacy in the implementation handoff (no concurrent use).
- Add fixture-only shell tests (repository test convention or a new clearly
  named harness) for negative paths, env ordering, purge boundary, marker,
  PID/listener/DB races, staging, rollback; no live `/opt`/`/etc` fixtures.
- Update `docs/linux-systemd.md`, `docs/linux-nohup.md`, `README.md`, and
  `docs/configuration-guide.md` only to document this final contract; no
  architecture change is required unless implementation alters invariants.

## Phases (dependencies, effort, tests)

1. **Contract and guarded reset (2–3h; none):** implement preflight, sudo
   stop/marker checks, exact purge/recreate, wholesale copy + safety-file
   generation. Test all refusal/race/boundary cases.
2. **Build/stage/install runner (3–4h; phase 1):** implement separate build,
   install, start, status, rollback paths and package aliases; run the focused
   systemd-service gate, staged hashes, unit verification, and install fixture
   tests. Native/Tauri packaging is outside this service gate.
3. **Live acceptance and handoff (1–2h; phases 1–2 + authenticated sudo):**
   install/start, authenticated probes, restart/SIGTERM/PTY checks, redacted
   evidence, then marker-guarded rollback rehearsal if approved.

## Unresolved questions

- What exact health/authenticated request and active PTY workload are canonical?
- Should Mongo be mandatory for this quick check, and is a safe URI available?
- Should the fresh-install marker be retained permanently after acceptance?
- Which operator-approved evidence/quarantine retention location is required?
