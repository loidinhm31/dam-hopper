# Phase 02: Build, stage, and systemd run workflow

Historical phase document; superseded by the current revalidation plan at
`../260820-0912-revalidation-build-run-service/`.

## Context

Existing commands build the Rust release binary and Vite web bundle separately;
the current unit expects `/opt/dam-hopper/bin/dam-hopper-server` and
`/opt/dam-hopper/web`. This phase adds the repeatable production-style script
that connects those existing artifacts to the guarded systemd handoff.

## Files

- Create `deploy/run-linux-production.sh`.
- Modify `package.json` with narrow `linux:production` and `linux:reset` aliases.
- Modify `deploy/systemd/dam-hopper.service` only for the approved optional
  environment-file contract; retain direct absolute `ExecStart`.
- Update `docs/linux-systemd.md` and `README.md` with exact commands and
  developer-vs-administrator evidence.

## Implementation

1. Provide explicit subcommands/options such as `build`, `install`, `start`,
   `status`, and `rollback`; default to a safe usage error rather than silently
   installing or starting. Require the Phase 01 clean-state gate before first
   install and refuse to overwrite an existing unverified deployment.
2. Run `pnpm install --frozen-lockfile` only when requested/needed, then
   `pnpm build:server` and `env -u VITE_DAM_HOPPER_SERVER_URL pnpm build`.
   Verify the release binary is executable and the web index artifact exists;
   scan the staged tree for dotenv files, credential-bearing values, and
   private keys before elevation.
3. Stage into an exact temporary directory with restrictive permissions, hash
   the binary/unit/web inventory, and install root-owned `0755` directories and
   executable/broad web modes using the existing fresh-install marker model.
   Never copy runtime config, dotenv files, databases, token, or OPAQUE state
   into `/opt`.
4. Run `systemd-analyze verify` against the staged/installed unit, daemon-reload,
   enable, and start only after all preflight checks pass. Keep `User=loidinh`,
   `HOME`, `XDG_CONFIG_HOME`, `WorkingDirectory`, `RUST_ENV=production`,
   loopback `127.0.0.1:4801`, journald, `Restart=on-failure`, `SIGTERM`,
   `UMask=0077`, and `NoNewPrivileges=true`.
5. Make rollback marker- and identity-guarded: stop/disable, verify inactive,
   MainPID/port/database absence, quarantine/remove only matching assets, and
   preserve all user runtime files.

## Validation

Run `bash -n`, fixture-based install refusal/success tests, build checks, unit
syntax/content checks, file ownership/mode checks, and a clean host acceptance
sequence. Verify effective UID/GID, `127.0.0.1:4801`, same-origin UI health,
authenticated route behavior, journald output, and graceful stop. Do not claim
administrator acceptance from repository-only checks.

## Exit criteria

One script can reproducibly build and hand off the service, but never starts a
second owner or runs the server as root. Rollback is recoverable and bounded to
marker-backed assets.

## Decision

The production command requires the full build, test, lint, and unit-validation
gate before installation or start. A fast developer-only mode is out of scope
for this quick verification.
