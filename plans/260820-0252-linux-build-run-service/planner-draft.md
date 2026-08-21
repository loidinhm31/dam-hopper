# Planner draft: Linux build, clean reset, and production-style run

Historical planning artifact; superseded by the delivered revalidation plan at
`../260820-0912-revalidation-build-run-service/`.

Date: 2026-08-20 (Asia/Saigon)
Repository: `/home/loidinh/WS/dam-hopper-ws/systemd-system-service`

## Outcome and recommended architecture

Use systemd as the one canonical production-style owner, with two deliberately
separate operations:

1. `deploy/reset-linux-production.sh` performs a read-only preflight, stops and
   disables both systemd and legacy nohup owners, then quarantines only verified
   deployment residue.
2. `deploy/run-linux-production.sh` builds the web and Rust release artifacts,
   performs secret/path checks, stages the exact root-owned systemd assets, and
   enables/starts `dam-hopper.service` only after the clean-state gate passes.

Keep the existing direct systemd unit shape: `User=loidinh`, explicit
`HOME`/`XDG_CONFIG_HOME`, `WorkingDirectory=/home/loidinh`, same-origin web
assets at `/opt/dam-hopper/web`, loopback `127.0.0.1:4801`, production auth,
journald, `Restart=on-failure`, bounded SIGTERM shutdown, `UMask=0077`, and
`NoNewPrivileges=true` (`deploy/systemd/dam-hopper.service:6-25`). The scripts
may orchestrate `sudo systemctl`, but the service must not gain a shell,
wrapper, PID file, or privileged helper.

The MongoDB option is an explicit environment-file handoff, not Docker
management. If the caller supplies a local dotenv file, parse and validate only
the supported MongoDB keys, write a mode-0600 runtime environment file outside
`/opt`, and reference that file from systemd with an optional
`EnvironmentFile=`. Do not copy the repository dotenv file into the release
tree. For direct/non-systemd launches, preserve the server's existing
`dotenvy::dotenv().ok()` behavior (`server/src/main.rs:58-69`).

### Alternatives considered

- Keep extending `deploy/run-linux-nohup.sh`: simplest and root-free, but stale
  PID identity, unbounded append-only logs, weak supervision, and SIGKILL
  fallback make it unsuitable as the production owner.
- Run a new standalone script with `nohup`: duplicates those lifecycle risks
  and increases the chance of two processes opening the same SQLite files.
- Add MongoDB/Docker orchestration: unnecessary; MongoDB is an optional
  externally supplied service and the repository has no Mongo image, compose
  file, volume, or initialization contract.

Systemd is therefore the only production path; nohup remains a documented
legacy fallback on `4800`, never concurrent with systemd or shared databases.

## Expected file scope

Likely implementation changes, subject to the unresolved questions below:

- New `deploy/reset-linux-production.sh`: exact allowlist, identity-checked
  process shutdown, marker/manifest checks, reversible quarantine, and a
  separate explicit `--purge-data` refusal gate.
- New `deploy/run-linux-production.sh`: build, validate, optional env-file
  preparation, staged installation, `systemd-analyze verify`, and
  enable/start handoff. It should fail closed rather than silently upgrade an
  existing `/opt` deployment.
- `deploy/systemd/dam-hopper.service`: only to add the optional external
  `EnvironmentFile` contract; preserve all current security and lifecycle
  fields. The file must remain direct `ExecStart` with absolute paths.
- `package.json`: narrow aliases such as `linux:reset` and
  `linux:production` (do not alter existing `server:*` semantics).
- `docs/linux-systemd.md`: document the script contract, clean reset, env-file
  location/precedence, acceptance evidence, and rollback ownership boundary.
- `docs/linux-nohup.md`: label nohup legacy, document stale-PID identity checks,
  and state that it cannot share runtime SQLite files with systemd.
- `docs/configuration-guide.md:541-549`: document `MONGODB_URI`,
  `MONGODB_DATABASE`, `RUST_ENV`, `ENVIRONMENT`, relevant `DAM_HOPPER_*`
  variables, dotenv scope, and precedence.
- `README.md`: expose the supported build/run entry point and the reset safety
  warning.
- New untracked placeholder template, preferably
  `deploy/dam-hopper-env-template.example`, containing no real credentials.
- Rust files only if tests expose a real correctness/security defect:
  `server/src/main.rs` for all-or-nothing Mongo validation/error redaction and
  focused tests under `server/tests/` or the relevant module. No Rust change is
  otherwise needed to build and serve the SPA.

Do not change `docs/system-architecture.md` unless the chosen unit contract
actually changes its recorded invariants; the current architecture already
records the 4800/4801 ownership split and marker-guarded deployment.

## Clean-reset safety boundary and order

Default reset preserves user data, credentials, and configuration:

`/home/loidinh/.config/dam-hopper/dam-hopper.toml`, `config.toml`,
`server-token`, `opaque-server-setup`, `sessions.db`, `telemetry.db`,
`server.conf`, project trees, workspace `.dam-hopper/agent-store`, and MongoDB
data outside this repository. Preserve `output.log` by quarantine/rotation;
the observed log is approximately 49 MiB.

The reset must stop before any mutation when ownership is ambiguous. Required
order:

1. Capture redacted identities and exact paths: unit fragment, active state,
   `MainPID`, process executable/owner/cmdline, listeners on 4800/4801,
   database owners, symlink status, ownership/modes, and the
   `/opt/dam-hopper/.systemd-fresh-install/manifest`. Never print file contents
   of tokens, configs, or env files.
2. As administrator, `disable --now` the systemd unit; as `loidinh`, stop nohup
   only after validating the PID file points to the expected executable and
   owner. Never broad-`pkill`; never trust a stale PID.
3. Recheck inactive/dead systemd, no DamHopper process, no 4800/4801 listener,
   and no process holding either SQLite database. Abort on any failure.
4. Quarantine exact legacy binary, PID, and log paths. Quarantine
   `/etc/systemd/system/dam-hopper.service` and `/opt/dam-hopper` only after
   administrator verification that the marker/manifest proves this deployment
   owns the paths. Use an exact, recoverable move; do not unconditional `rm -rf`.
5. `daemon-reload`, then verify the intended absence/clean state and preserved
   runtime ownership/modes before the build/install phase.

`--purge-data` must be a separate, explicit, interactive/admin-gated operation
and must name each target. It may never be implied by `reset`, `build`, or
`start`; default behavior must refuse to delete databases, tokens, OPAQUE
state, TOML, projects, agent-store data, or external Mongo collections.
Unrelated Docker containers must not be stopped or removed.

## Environment and MongoDB contract

### Local dotenv file

- The server currently loads a dotenv file from its process working directory
  before CLI parsing and does not overwrite pre-existing process variables
  (`server/src/main.rs:58-69`; runtime report).
- Effective server precedence is: explicit CLI flag > process environment
  (including dotenv values) > clap default. Project `env_file` is a separate
  PTY-child feature and must not be treated as server Mongo config.
- The production script should accept an explicit `--env-file PATH`; no
  implicit scan of arbitrary directories. Validate it is a regular non-symlink
  file owned by `loidinh` (or explicitly admin-managed), mode 0600 or tighten
  it, and reject world/group-readable input.
- Extract only `MONGODB_URI` and `MONGODB_DATABASE` plus an explicitly allowed
  small set of runtime keys (`RUST_LOG`, `DAM_HOPPER_CORS_ORIGINS` if needed).
  Do not export a generic dotenv file wholesale into systemd.
- Write the selected values to a runtime env file such as
  `/home/loidinh/.config/dam-hopper/server.env`, owned by `loidinh`, mode 0600,
  never under `/opt`; use an atomic temporary file and restrictive umask.
  The service's `EnvironmentFile=-...` remains optional and absent by default.
- CLI values in the unit remain authoritative over environment values. The
  systemd environment file outranks a clap default; existing process variables
  must not be overwritten by dotenv loading. Document that `dotenvy` imports
  all keys for direct launches, while the production handoff intentionally
  narrows the file.

### MongoDB semantics and leak checks

- Treat `MONGODB_URI` and `MONGODB_DATABASE` as an all-or-nothing pair. Decide
  and test whether a partial pair is a hard startup error; do not silently
  advertise Mongo as configured when the server currently constructs `db` only
  when both exist (`server/src/main.rs:253-263`).
- Never add MongoDB reset, provisioning, collection deletion, or Docker cleanup
  to this workflow.
- Keep `RUST_ENV=production` and the existing no-auth fail-closed behavior;
  no dotenv file may enable `DAM_HOPPER_NO_AUTH` in the production unit.
- Add a regression test that a URI password is absent from parse, DNS,
  connection, startup, journal, and surfaced API error text. Confirm the
  pinned Mongo driver does not leak credentials; redact before propagation if
  it can.
- Test scans must reject dotenv files, `server.env`, token-like values, private
  keys, and credential-bearing URI strings in staged binary/web trees, generated
  manifests, script output, and documentation. Logs/evidence use names,
  hashes, modes, and booleans only—not values.

## Implementation phases and dependencies

1. **Contract/preflight design** — map exact paths, marker ownership, process
   identity checks, quarantine naming, env allowlist, and purge confirmation.
   Depends on the two research reports and current docs.
2. **Reset implementation** — add the guarded reset script and shell tests for
   missing/stale PID, wrong executable, symlinked target, active listener,
   changed manifest, and preserved runtime files. No live host mutation in CI.
3. **Build/run implementation** — add the build script and package alias; run
   `pnpm install --frozen-lockfile`, `pnpm build:server`, and
   `env -u VITE_DAM_HOPPER_SERVER_URL pnpm build`; stage exact binary/web/unit
   assets through the existing marker/hash model.
4. **Environment integration** — add the optional external systemd env file,
   sample placeholders, allowlist/permissions, precedence docs, partial-pair
   behavior, and redaction tests. Depends on the chosen answer about partial
   Mongo configuration.
5. **Validation and handoff docs** — update package/docs, run static secret and
   forbidden-pattern scans, and record administrator-only acceptance steps.

Dependencies: Node >=20, pnpm >=9, Rust/Cargo, systemd tooling, `sudo` for
installation, and an externally reachable MongoDB only for the optional
Mongo integration test. Docker is not a dependency for this path.

## Tests and manual acceptance evidence

Developer checks:

- `bash -n` for both scripts; shell tests exercise refusal paths without sudo.
- `pnpm build:server` and `env -u VITE_DAM_HOPPER_SERVER_URL pnpm build`.
- `pnpm test`, `pnpm lint`, and `systemd-analyze verify
  deploy/systemd/dam-hopper.service` (after staging, verify the absolute
  executable too).
- Focused env tests: dotenv fallback, CLI-over-env, pre-existing env
  preservation, explicit env-file allowlist, permissions, pair completeness,
  no-auth production guard, and Mongo credential redaction.
- Staged-tree scans: no dotenv file or secrets; web has `index.html`; release
  binary is executable; manifest hashes/file inventory match.

Administrator acceptance evidence, redacted:

- Before/after `systemctl show`, `is-enabled`, `is-active`, `MainPID`, effective
  UID/GID, exact listener (`127.0.0.1:4801`), and no 4800 owner.
- `stat` output for root-owned `/opt` assets, unit, marker, and user-owned
  0600 runtime/env files; no contents.
- Authenticated browser/API smoke from the 4801 same-origin service and a
  journal excerpt proving normal startup and graceful shutdown without secrets.
- Reset quarantine inventory and manifest hash evidence; preserved token,
  OPAQUE, TOML, SQLite, project, and agent-store paths with unchanged
  ownership/modes. No Mongo/Docker deletion evidence should exist.
- A controlled rollback rehearsal only against the verified fresh-install
  marker, proving service stop/disable, port/process absence, asset removal or
  quarantine, and runtime-state preservation.

## Unresolved questions

- Should partial `MONGODB_URI`/`MONGODB_DATABASE` be a hard startup error or
  intentionally mean MongoDB disabled?
- Should production consume a generated narrow `server.env` or support a
  systemd `EnvironmentFile` pointing directly at an administrator-managed
  file? The former better supports a local dotenv file without broad
  process-state import; the latter avoids copying secrets but needs explicit
  ownership policy.
- Does the pinned MongoDB driver redact credentials in every parse, DNS, and
  connection error path?
- Is `/opt/dam-hopper/.systemd-fresh-install/manifest` definitely the current
  deployment's ownership marker, or an administrator-managed upgrade marker?
- What retention period and administrator-owned evidence directory should be
  used for quarantined binary/unit/web/log artifacts?
- Should the canonical production bind remain loopback `4801` behind a trusted
  reverse proxy, or change to a protected non-loopback address?
