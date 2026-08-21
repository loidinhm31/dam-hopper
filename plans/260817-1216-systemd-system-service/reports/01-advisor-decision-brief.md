# Advisor Decision Brief

> Historical decision brief from the superseded systemd planning sequence. Current acceptance status is maintained by the [successor revalidation plan](../../260820-0912-revalidation-build-run-service/plan.md).

- question: Should DamHopper use an admin-installed systemd system unit that runs as loidinh, given no noninteractive sudo and existing user-owned runtime state?
- kind: architecture/security
- evidence:
  - `server/src/main.rs`
  - `server/src/state.rs`
  - `server/src/api/router.rs`
  - `deploy/run-linux-nohup.sh`

## Constraints

- Administrator owns installation and lifecycle; no privileged action is available to the implementation session.
- Effective service identity must always be `loidinh`, never root.
- Existing config, secrets, and SQLite files are loidinh-owned; secret/DB modes are `0600`.
- Supplied host evidence: current nohup backend is loidinh-owned, in a user-session scope, on
  `0.0.0.0:4800`; collector uses `127.0.0.1:4811`; no DamHopper unit exists; `sudo -n`
  requires a password; parent-shell user bus is unavailable; `/opt/dam-hopper/web` is absent.

## Repository Findings

- `main.rs` accepts explicit host, port, and config paths; defaults to `0.0.0.0:4800`;
  resolves user config/token paths; opens session SQLite; and handles SIGTERM with Axum graceful
  shutdown plus telemetry, tunnel, artifact, and persistence teardown.
- `state.rs` keeps auth enabled unless the explicit no-auth switch is set and rejects unsafe
  no-auth combinations. User identity determines private config and credential paths.
- `router.rs` provides public `/api/health`, protected routes such as `/api/projects`, and an
  explicit `DAM_HOPPER_WEB_DIR` override whose fallback is `/opt/dam-hopper/web`.
- `run-linux-nohup.sh` already proves a user-owned binary/config model and loopback default, but
  manages its own PID and log files and has no system-manager restart or boot lifecycle.

## Options

| Choice | Benefits | Costs / rejection reason |
| --- | --- | --- |
| System unit with `User=loidinh` | Boot lifecycle, `Restart=on-failure`, journald, admin-owned unit; private state remains user-owned | Requires one administrator handoff; must stop nohup before live DB/port use |
| User unit | Natural user identity; no root-running process | User bus unavailable in supplied context; boot persistence/linger adds admin policy and does not match requested admin-managed system service |
| Current nohup | Already works without privilege; smallest current mechanism | User-session scope, PID/log script lifecycle, no journald or systemd restart policy; current non-loopback bind conflicts with desired default |

## Recommendation

Use one admin-installed system unit with `User=loidinh` and explicit absolute paths. This is the
least complex safe option that meets boot supervision and administrator ownership without changing
runtime-file ownership or introducing a privileged helper. The unit must execute the server
directly as loidinh, bind `127.0.0.1`, keep auth enabled, log to journald, use
`Restart=on-failure`, and send SIGTERM to the graceful shutdown path.

Implementation stays split: non-privileged repository work creates and validates the unit asset;
an administrator installs root-owned deployment assets and performs enable/start or rollback.
Before any implementation, a manual `127.0.0.1:4801` run must use isolated token/config/session
DB/telemetry DB paths and prove health, auth protection, and SIGTERM completion.

## Unresolved Questions

- Should the system service serve web assets from `/opt/dam-hopper/web`, or should an external UI
  host be documented with an exact CORS origin?
