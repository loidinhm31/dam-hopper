# Reset/env security revalidation

Date: 2026-08-20 (Asia/Saigon)
Branch: `feat/systemd-system-service`
Scope: planning-only security/operations review; repository and prior read-only evidence only.

> Historical snapshot from before implementation. Its pending operator-sudo
> claims are superseded by the bounded 2026-08-21 acceptance report; its
> security recommendations remain design context.

## Verdict

Use one explicit destructive quick-verification mode, but order it as
**stop/identify → privileged marker verification → purge → recreate → env projection →
quality gates → staged install → start → acceptance**. Do not copy an arbitrary dotenv
wholesale into systemd. Do not copy `server.env` before purging its parent directory.

Repository validation remains possible unprivileged. At the time of this review,
installed-unit, root-owned marker, cutover, start, and rollback evidence were
operator-sudo blockers; the later bounded run records the core results.

## Evidence and concrete references

- Prior plan: `plans/260820-0252-linux-build-run-service/plan.md` and phase files;
  current drift summary maps reset to phase 01 and runner/env/install to phase 02
  (`researcher-01-repository-plan-drift.md:38-55`).
- Existing unit: `deploy/systemd/dam-hopper.service:8-25` runs as `loidinh`, sets
  production, uses an absolute executable/loopback port, and has restart/termination
  controls; it currently has no `EnvironmentFile=` (`repository-plan-drift.md:16-20,46-51`).
- Startup calls `dotenvy::dotenv().ok()` before CLI use (`server/src/main.rs:58-69`).
  Mongo is enabled only when both variables are present (`server/src/main.rs:253-263`).
- `AppState::new` rejects no-auth in production (`server/src/state.rs:165-183`), with
  integration coverage in `server/tests/auth_no_auth.rs:418` onward.
- Current architecture states the purge is local DamHopper state only, selected env is
  user-owned `server.env`, first install is manifest-backed, and rollback must recheck
  inactive/PID/listener state (`docs/system-architecture.md:1617-1641`).
- Read-only host evidence found installed unit root-owned `0644`, service inactive,
  no 4800/4801 listener, app databases `0600`, app config dir `0700`, stale nohup
  residue, and a root-owned `0700` marker unreadable by `loidinh`
  (`researcher-02-live-host-revalidation.md:20-35`). Marker content is therefore
  UNKNOWN, not absent or valid.

## Exact purge boundary

Quick purge may remove exactly the canonical app-owned tree
`/home/loidinh/.config/dam-hopper` after path/owner/symlink checks. This intentionally
includes app config, auth/setup state, SQLite state, diagnostics, stale nohup binary,
PID/log, and any prior generated `server.env`. Recreate the directory as
`loidinh:loidinh 0700`; recreate private files as `0600`.

Never include the repository/worktrees, other home paths, `/opt/dam-hopper`,
`/etc/systemd/system`, project repositories, unrelated processes/listeners/containers,
external MongoDB data, or caller-owned dotenv source. Normal reset should quarantine;
irreversible purge requires an explicit flag plus typed/interactive confirmation.

Resolve the selected dotenv source before purge and reject it if it is inside the purge
tree, is a symlink/non-regular file, is not owned by `loidinh`, or is group/world
readable. A source inside the tree cannot safely survive a fresh purge by convention.

## Dotenv and no-auth findings

- Copy-before-purge fails deterministically: whole-directory purge deletes
  `/home/loidinh/.config/dam-hopper/server.env`, then service starts without intended
  Mongo settings (and Mongo may silently remain disabled when the pair is incomplete).
- systemd `EnvironmentFile=` is not a dotenvy loader. It imports every accepted
  assignment with systemd parsing rules; environment-file values override unit
  `Environment=` values. A wholesale caller file can therefore alter `RUST_ENV`,
  `HOME`, config/web paths, logging, or `DAM_HOPPER_NO_AUTH` and may parse differently.
- Current source safety depends on `RUST_ENV=production` reaching `AppState::new`.
  Allowing a broad env file to replace it can defeat that precondition before the
  no-auth rejection runs. Absence of `--no-auth` in `ExecStart` is insufficient.
- Generate `server.env` from a strict allowlist only: `MONGODB_URI` and
  `MONGODB_DATABASE`. Require both or neither; for this production-verification flow,
  require both. Reject duplicate/unknown keys and parse errors without printing values.
  Write atomically in the recreated directory, owner `loidinh`, mode `0600`.
- Keep `RUST_ENV=production`, `HOME`, `XDG_CONFIG_HOME`, web/config paths, host, and
  port in the unit/CLI, outside `EnvironmentFile`. Keep `--no-auth` absent. Add a final
  defense that removes inherited `DAM_HOPPER_NO_AUTH` (for example unit
  `UnsetEnvironment=`), but do not treat that as a substitute for allowlisting.

## Corrected executable sequence

1. Assert Linux, exact user/home/branch, canonical paths, no symlinks, explicit purge
   confirmation, and eligible dotenv metadata; print paths/keys only, never values.
2. Stop legacy nohup only after PID executable/UID/cmdline identity matches. Operator
   stops systemd; verify inactive, `MainPID=0`, ports 4800/4801 free, and no DB holders.
3. With operator sudo, `lstat` every `/opt`/unit path, verify the root-owned marker and
   manifest nonce/hash/inventory against current assets. Mismatch/unreadable/incomplete
   means abort and retain marker/assets. Never remove marker first.
4. Purge only the boundary above; recreate `0700`; atomically project the two allowlisted
   variables to `server.env` as `0600`. Confirm source and destination are distinct.
5. Run all repository quality gates before privileged install. Build into a unique
   unprivileged staging tree; hash/inventory it; reject dirty/unexpected output.
6. Operator stages root-owned unit/binary/web assets, verifies hashes/modes/no symlinks,
   writes marker+manifest atomically, runs daemon-reload, enables, and starts service.
7. Run admin acceptance. Remove the fresh-install marker only if the prior plan defines
   successful acceptance as its lifecycle end; otherwise retain it for guarded rollback.

## Quality and administrator acceptance gates

Repository gate: `pnpm check`; release server build; production web build with backend
override unset; full Rust/integration and relevant UI tests; reset/runner fixture tests
for PID/listener/DB/symlink/marker/purge/env failures; `bash -n` plus shell lint;
`systemd-analyze verify`; package/JSON checks; tracked-secret/ignored-env scan; clean
expected diff. Any failure blocks install.

Administrator gate: installed unit/manifest/assets exact root ownership and modes;
service enabled+active; nonzero `MainPID`; exact executable and effective UID/GID
`loidinh`; only loopback `127.0.0.1:4801`; no legacy 4800 owner; private runtime files
`0600`; authenticated health works and unauthenticated/no-auth attempt fails closed;
journal contains no credential values; web same-origin works; restart recovers with a
new PID; SIGTERM/graceful PTY disposal leaves no child/cgroup residue; DBs have no
concurrent legacy holder; manifest-backed rollback dry-run and actual reset preserve
unrelated state. Capture commands/results redacted; repository tests cannot satisfy this.

## Failure modes

- Unprivileged marker check reports false absence: marker is root-owned `0700`.
- Broad env import changes production/auth/path behavior or fails on parser mismatch.
- Partial Mongo pair silently disables persistence; leaked command/journal output exposes
  credentials; avoid value echo and shell tracing.
- PID reuse or stale PID kills unrelated process; listener/DB holder races after preflight;
  revalidate immediately before stop/remove/start.
- Marker removed or assets changed before verification destroys rollback identity.
- Whole config purge after env copy removes the env and can also delete evidence needed
  to diagnose startup; capture metadata first, values never.

## Unresolved questions

1. Is quick purge intentionally allowed to erase all app auth/setup/config/SQLite state,
   or must any named subtrees survive?
2. Must Mongo be mandatory for this verification, and should partial pairs hard-fail all
   production startup in server code rather than only the runner?
3. Is the marker deleted after acceptance or retained as the permanent rollback manifest?
4. Which health/auth request and PTY workload are the canonical admin acceptance probes?
