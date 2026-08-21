# Researcher 01 — Read-only planning audit

Date: 2026-08-20, Asia/Saigon
Branch: `feat/systemd-system-service`
Scope: repository/plan inspection only; no implementation/docs/deployment files or live state changed.

> Historical snapshot from before implementation. Pending/stale findings below
> describe the 2026-08-20 baseline; current delivery and bounded host evidence
> are recorded in the parent plan and `plans/reports/qa-260821-0142-linux-production-runner.md`.

## Verdict

**PENDING.** Existing unit/manual handoff provide a foundation, but production/reset scripts, aliases, env projection, shell tests, and current administrator evidence are missing. Several plan statements conflict with systemd semantics or each other.

## Inherited worktree

- Tracked modification: `docs/system-architecture.md`.
- Untracked: plans `260820-0252`, `260820-0315`, `260820-0912`, related reports.
- No implementation files are modified. Planned `deploy/reset-linux-production.sh`, `deploy/run-linux-production.sh`, and `deploy/dam-hopper-env-template.example` are absent.
- Existing nohup script is tracked mode `100644`, although package aliases execute it directly (`package.json:20-24`).

## Audit

| Status | Finding |
|---|---|
| **PASS** | Existing unit preserves non-root identity, explicit paths, production mode, loopback `4801`, direct `ExecStart`, journald, restart/SIGTERM, `UMask=0077`, and `NoNewPrivileges=true` (`deploy/systemd/dam-hopper.service:6-25`). |
| **PASS** | Architecture now describes intended operator-run authenticated-sudo boundary and explicitly keeps service process non-root (`docs/system-architecture.md:1563-1568,1617-1621`). |
| **PASS** | Architecture distinguishes repository evidence from administrator acceptance and labels active-runtime evidence pending (`docs/system-architecture.md:1570-1585`). |
| **PENDING** | Operator automation does not exist. Plan requires two scripts (`plan.md:25-31`; phases 01/02 at `:14`/`:12`), but only legacy nohup helper exists. |
| **STALE** | `docs/linux-systemd.md:3,71-73` says repository automation never installs/starts unit and presents manual handoff. This contradicts newly intended operator-script workflow in architecture. |
| **STALE** | README still recommends nohup for day-to-day Linux use (`README.md:42-63`), conflicting with “systemd as the one production owner” (`plan.md:27-31`). |
| **PENDING** | `linux:reset` and `linux:production` aliases are absent; only legacy `server:*` aliases exist (`package.json:20-24`). |
| **STALE** | Existing `server:*` aliases directly execute a non-executable `100644` script. New script plans also omit executable-mode requirements and a `test -x` gate. |
| **STALE** | Plan overview has valid frontmatter and stays under 80 lines (`plan.md:1-66`), but phase listing lacks status/effort tracking (`:46-51`). |
| **STALE** | Phase files omit prescribed Context Links, Overview/status, Key Insights, Requirements, Architecture, action-typed related files, Todo, Risks, Security, and Next Steps. Current headings are only Context/Files/Implementation/Validation/Exit Criteria (`phase-01:3-55`; similarly phases 02–04). |
| **STALE** | Env contract contradicts itself: research/planner draft requires narrow projection (`research/01-runtime-env-mongodb.md:5-11`; `planner-draft.md:130-145`), while acceptance and phase 03 describe copying/broad-importing selected dotenv (`plan.md:40-42`; `phase-03:26-35,54-56`). |
| **STALE** | systemd 259 semantics: `EnvironmentFile=` uses systemd parsing, not dotenv/shell parsing; its values override every `Environment=` assignment; `-PATH` silently ignores missing, unreadable, and invalid files. Therefore phase 03 cannot “force `RUST_ENV=production` after environment loading” with current unit model (`phase-03:32-35`). |
| **PENDING** | Broad env file could override `RUST_ENV=production` and import `DAM_HOPPER_NO_AUTH`, weakening guard described at `docs/system-architecture.md:1599-1601,1627-1632`. Current protection depends on `RUST_ENV` reaching `AppState::new` (`server/src/state.rs:165-183`). |
| **PENDING** | systemd warns environment variables are unsuitable for secrets because they enter process environments and may be exposed through manager/process interfaces. Mode `0600` protects file at rest, not Mongo URI throughout runtime. Quick-verification risk must be explicit. |
| **PENDING** | MongoDB remains silently disabled unless both variables exist (`server/src/main.rs:253-263`). No partial-pair startup policy or credential-redaction regression tests exist. |
| **STALE** | Purge scope conflicts: phase 01 removes config/token/OPAQUE/SQLite and workspace agent-store (`phase-01:36-41`), while phase 04 requires those paths preserved (`phase-04:28-33`). Deleting workspace `.dam-hopper/agent-store` also conflicts with stated project-tree exclusion (`plan.md:20-23`). |
| **STALE** | Phase 01 says stop/disable occurs before later check that must “abort before mutation” (`phase-01:22-35`). Stop/disable is already live mutation; preflight and post-stop revalidation need separate names/gates. |
| **PENDING** | Quarantine location/retention and cross-filesystem behavior remain unresolved (`phase-01:57-61`). Moving root-owned `/opt` assets into user trash is not a sufficiently specified recovery contract. |
| **STALE** | Nohup PID ownership is unsafe: trusts `kill -0` only (`deploy/run-linux-nohup.sh:118-125`) and signals PID without UID/executable/start-time checks (`:151-170`). PID reuse could signal an unrelated process. |
| **STALE** | Nohup runtime creation lacks global restrictive umask/directory mode (`deploy/run-linux-nohup.sh:59-80`); PID/log writes have no explicit private modes (`:145-146`). Prior host evidence observed both as `0644`, but that is historical evidence, not current host proof. |
| **PENDING** | Plan updates nohup documentation but does not clearly harden or disable unsafe helper. Documentation alone cannot enforce single SQLite ownership. |
| **STALE** | “Full build/test/lint/unit gate before installation or start” (`phase-02:58-62`) conflicts with independent operational `start` subcommand semantics (`:21-24`). Restarting installed unit should not require rebuilding repository. |
| **PENDING** | `pnpm test` runs only Rust tests (`package.json:28-29`). Phase 04’s vague “full” gate (`phase-04:20-24`) does not define UI-test inclusion, shell harness, shell lint, JSON validation, executable-mode checks, or secret-sentinel scans. |
| **PENDING** | `bash -n` proves syntax only. No fixture-driven shell test files exist for PID reuse, listener/database races, symlinks, marker mismatch, purge refusal, env parsing, rollback, or command failure. |
| **STALE** | A staged unit still references absolute `/opt`. `systemd-analyze verify` needs explicitly defined isolated root/placeholder strategy plus post-install verification; “staged/installed unit” is too ambiguous (`phase-02:35-39`; `phase-04:20-24`). |
| **STALE** | Test PASS claims are historical only: `docs/linux-systemd.md:775-785`, `docs/system-architecture.md:1570-1576`, and revalidation report `researcher-01-repository-plan-drift.md:25-28`. No current test run was performed or may be inferred. |
| **PENDING** | Administrator evidence remains absent by design: effective UID/GID, active listener, journal, cutover, restart, SIGTERM/PTY cleanup, rollback (`phase-04:25-40`; revalidation report `:66-68`). |

## Required corrections

1. Make one contract authoritative: operator invokes repository scripts as `loidinh`; scripts request interactive sudo only for exact system-manager/root-owned operations; server always runs as `loidinh`.
2. Replace raw dotenv copying with parsing plus canonical generation of `server.env` containing only `MONGODB_URI` and `MONGODB_DATABASE`. Reject unknown/duplicate keys, partial pairs, parser ambiguity without printing values.
3. Exclude `RUST_ENV`, `ENVIRONMENT`, `DAM_HOPPER_NO_AUTH`, paths, host, port from projection. Keep production/auth/path invariants in unit/CLI; consider final `UnsetEnvironment=DAM_HOPPER_NO_AUTH`.
4. Prefer mandatory generated `EnvironmentFile=` once workflow is selected. If `-PATH` remains optional, require runner-side existence/ownership/mode/content checks immediately before every start.
5. Split reset into preflight → authorized stop/disable → post-stop race revalidation → marker verification → quarantine or explicit purge. Never claim “before mutation” after stopping.
6. Define separate acceptance matrices: normal reset preserves runtime state; purge intentionally removes/recreates approved state. Remove workspace agent-store from purge unless separately enumerated/confirmed.
7. Either harden nohup with `umask 077`, private modes, PID/start-time/UID/executable identity, locking, systemd/DB-holder refusal, and log rotation—or retire package aliases from supported operation.
8. Add aliases with explicit argument forwarding and either track scripts as `100755` or invoke through `bash`; test actual package commands.
9. Separate gates: build/verify creates hashed evidence; install consumes it; start validates installed manifest/unit/env/ownership and clean single-owner state without rebuilding.
10. Define exact fresh repository commands and fixture-only shell harness. Keep repository, administrator, optional live-Mongo evidence separate.

## Unresolved questions

1. Must MongoDB be mandatory for this verification, and should partial pair hard-fail server startup globally?
2. Is exact purge boundary only `~/.config/dam-hopper`, or may workspace/project state be removed?
3. Is root-owned marker permanent rollback identity or deleted after acceptance?
4. Which same-filesystem quarantine location and retention policy is administrator-approved?
5. Is nohup retained/hardened, or formally deprecated with aliases removed?
6. Which health/auth request and active-PTY workload are canonical administrator probes?
7. Is loopback `127.0.0.1:4801` behind trusted proxy still canonical production bind?
8. What credential-exposure risk is accepted for quick Mongo verification, and must later release work migrate to systemd credentials?
