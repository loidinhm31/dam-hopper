# Plan revalidation: Linux build/run service

Date: 2026-08-20 (Asia/Saigon)
Branch: `feat/systemd-system-service`
Plan: `plans/260820-0252-linux-build-run-service/`
Scope: read-only repository/test validation; no sudo, systemctl, or live-service action.

## Verdict

This is a historical read-only snapshot. The predecessor plan is superseded by
`plans/260820-0912-revalidation-build-run-service/`, which now records the
delivered reset/build workflow and administrator acceptance.

## Implemented / PASS

- Unit exists at `deploy/systemd/dam-hopper.service:1-30`: non-root
  `User/Group=loidinh` (8-9), `/home/loidinh` working directory (10),
  production env (15), direct absolute `ExecStart` on loopback `4801` (16),
  restart/SIGTERM/journald/security settings (17-25). `systemd-analyze verify`
  passed. This is a repository asset, not proof of installation.
- Existing docs cover the manual first-install/manifest handoff and guarded
  rollback (`docs/linux-systemd.md:67-69`, `75-443`, `501-773`), and explicitly
  keep administrator acceptance pending (`:3`, `:783-796`). They do not automate
  the new plan.
- Existing build/test signals pass: `pnpm build:server`;
  `env -u VITE_DAM_HOPPER_SERVER_URL pnpm build`; `pnpm test` (706 Rust unit
  tests plus integration suites, 0 failures; 2 ignored tests); `pnpm lint`;
  `bash -n deploy/run-linux-nohup.sh`; package JSON syntax.
- Current source references used by the plan are still line-valid:
  `dotenvy::dotenv().ok()` at `server/src/main.rs:58-69`; Mongo construction at
  `server/src/main.rs:253-263`; no-auth production guard at
  `server/src/state.rs:165-183`.
- `.gitignore:4-5` ignores exact `.env` names and `*.local`; `.env` and files
  matching the local-suffix rule pass. No dotenv/runtime env file is tracked.

## Pending / FAIL

- **Phase 01 reset:** `deploy/reset-linux-production.sh` is absent; no fixture
  tests exist for PID identity, listeners, database holders, symlinks, marker
  changes, quarantine, or explicit purge. `phase-01...md:14-55` is entirely
  planned, not implemented.
- **Phase 02 production runner:** `deploy/run-linux-production.sh` is absent;
  `package.json:20-24` has only legacy `server:*` aliases and no
  `linux:reset`/`linux:production`. No staged install, hash inventory, clean
  state gate, rollback command, or script tests exist.
- **Dotenv/Mongo contract:** no `--env-file` handling, allowlist, atomic
  `/home/loidinh/.config/dam-hopper/server.env` copy, template, or
  `EnvironmentFile=` exists. The unit has no `EnvironmentFile`
  (`deploy/systemd/dam-hopper.service:10-16`). Because `WorkingDirectory` is
  `/home/loidinh` and `main.rs:60` calls dotenvy, a home `.env` is still broad
  process input; the planned selected-file/narrow import contract is absent.
- Mongo remains silently disabled unless *both* variables exist
  (`server/src/main.rs:253-263`); no partial-pair policy or URI-password
  parse/DNS/connection redaction test was added. Existing auth tests cover
  no-auth safety, not this plan’s redaction contract.
- **Documentation:** `docs/linux-systemd.md` and `README.md` still describe
  manual administrator handoff/legacy nohup, not the planned copy/paste
  `linux:*` workflow. `docs/linux-nohup.md` has no new PID identity or
  non-concurrency guard section. `docs/configuration-guide.md` documents
  project terminal `env_file` (`:20-21`, `:157-168`), not production server
  dotenv precedence.
- **Ignore coverage gap:** production-named dotenv variants, `foo.env`,
  `server.env`, and `deploy/dam-hopper-env-template.example` are not ignored.
  The plan’s secret scan/template work is therefore not represented in Git
  policy.
- **Administrator evidence:** effective UID/GID, installed root ownership,
  enablement, `MainPID`, listener, journal, cutover, reset, and rollback were
  not run by design; repository tests cannot pass these criteria.

## Current nohup behavior / risk

- `deploy/run-linux-nohup.sh:108-116` sources `server.conf` as shell code;
  `:118-125` trusts a PID file plus `kill -0` without executable/UID/cmdline
  identity; `:145-147` appends an unbounded log and records `$!`; and
  `:157-170` falls back to `kill -9`. Defaults remain user-local `4800`
  (`:4-9`, `:71-77`). This is consistent with the plan’s “legacy fallback”
  decision, but does not satisfy the planned reset safety gate.

## Stale/obsolete assessment

- The predecessor `plan.md:4` is retained as `status: superseded`; current
  acceptance status belongs to the successor revalidation plan.
- Unit line references in `planner-draft.md:18-24` and research reports for
  `main.rs:58-69`/`:253-263` remain current. Plan report links at
  `plan.md:64-65` resolve to `plans/reports/`.
- The earlier assumption that a documented manual systemd handoff was enough
  is obsolete for this plan: the current docs explicitly say no automatic
  install/start (`docs/linux-systemd.md:3`, `:71-73`), while this plan requires
  guarded scripts and package entry points.

## Unresolved questions

1. Should a partial `MONGODB_URI`/`MONGODB_DATABASE` pair hard-fail startup or
   mean Mongo disabled?
2. Should the runner generate a narrow `server.env` or reference an
   administrator-managed `EnvironmentFile` directly?
3. Does the pinned MongoDB driver redact credentials in every error path?
4. Is `/opt/dam-hopper/.systemd-fresh-install/manifest` repository-owned or
   administrator-owned, and what quarantine/evidence retention is approved?
5. Is loopback `127.0.0.1:4801` still canonical behind a trusted proxy?
