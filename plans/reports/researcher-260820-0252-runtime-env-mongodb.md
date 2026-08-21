# Runtime/config research: environment and MongoDB

Historical report for a superseded predecessor plan. Current acceptance status
is maintained by `../260820-0912-revalidation-build-run-service/`.

Investigated: 2026-08-20 02:53 Asia/Saigon. Read-only source investigation; only this report was created.

## Executive findings

- The Rust server already supports a conventional local `.env`: `dotenvy::dotenv().ok()` runs before CLI parsing (`server/src/main.rs:58-69`). `dotenvy` searches from the process working directory and does not replace variables already present in the process environment. Missing or malformed `.env` is ignored because the result is discarded.
- CLI fields use `clap`'s `env` feature (`server/Cargo.toml:41-43`). Explicit flags win over their environment-variable fallback; otherwise the fallback wins over defaults. Supported bindings are `DAM_HOPPER_CONFIG`, `DAM_HOPPER_WORKSPACE`, `DAM_HOPPER_PORT`, `DAM_HOPPER_HOST`, `DAM_HOPPER_CORS_ORIGINS`, and `DAM_HOPPER_NO_AUTH` (`server/src/main.rs:26-53`). `--new-token` has no environment binding.
- Startup registry precedence is explicit config, workspace directory, global registry, configured default workspace, upward current-directory discovery, then empty fallback (`server/src/config/resolve.rs:12-18`, `71-112`). `--config`/`DAM_HOPPER_CONFIG` is an exact file; `--workspace`/`DAM_HOPPER_WORKSPACE` searches for `dam-hopper.toml` and missing config becomes an empty fallback (`server/src/config/resolve.rs:72-91`). Global paths honor `XDG_CONFIG_HOME`, then `$HOME/.config` (`server/src/config/global.rs:7-24`).
- `MONGODB_URI` is read directly from the process environment only at startup, together with `MONGODB_DATABASE` (`server/src/main.rs:253-263`). Both must be present for a database to be constructed. The URI is parsed and passed to the MongoDB client; only the database name is logged (`server/src/main.rs:257-260`). No MongoDB value is read from TOML or terminal project `env_file`.

## `.env` and environment scopes

There are two distinct dotenv paths:

1. Server process environment: `dotenvy::dotenv()` at `main` startup (`server/src/main.rs:58-60`). This makes a working-directory `.env` available to CLI fallbacks, `MONGODB_URI`, `MONGODB_DATABASE`, `RUST_ENV`, `ENVIRONMENT`, `RUST_LOG`, and all other process reads. `.gitignore` excludes `.env` (`.gitignore:4`).
2. Project terminal environment: `project.env_file` is loaded with `dotenvy::from_path_iter` into a fresh map, then request-provided values override it (`server/src/api/terminal.rs:172-212`, `215-245`). It does not mutate the server process environment. The PTY is started from a controlled child environment (`server/src/pty/manager.rs:2081-2085`), and diagnostics log env keys only, not values (`server/src/pty/manager.rs:648-655`, `750-760`).

Therefore, a project `.env` configured as `env_file = ".env"` affects terminal children, not server MongoDB connection/auth startup. The docs explicitly describe this separation and request override behavior (`docs/system-architecture.md:1188-1191`; `docs/configuration-guide.md:157-168`).

## CLI/config precedence

The effective order is:

```text
CLI flag > matching DAM_HOPPER_* environment variable (including values loaded from .env) > clap default
```

This applies to port and host because they have defaults (`server/src/main.rs:35-41`); optional path/origin fields remain unset when neither source exists. After CLI parsing, `main` reads global TOML config and passes CLI-derived `config`/`workspace` into the resolver (`server/src/main.rs:85-108`). TOML registry selection does not override an explicit CLI/env selection.

Resolver tests constrain the behavior: exact explicit file (`server/src/config/tests.rs:971-993`), invalid explicit TOML errors (`996-1010`), workspace discovery (`1012-1033`), global registry over default/current directory (`1035-1060`), global default fallback (`1062-1081`), current directory fallback (`1083-1102`), and empty fallback (`1104-1143`).

## MongoDB behavior and constraints

- Optional connection requires both `MONGODB_URI` and `MONGODB_DATABASE`; if either is absent, `db = None` (`server/src/main.rs:253-263`). This differs slightly from the public safety wording that says no-auth fails when `MONGODB_URI` is set (`docs/api-reference.md:15-25`). The actual guard checks whether a database object was built (`server/src/state.rs:165-173`).
- With a database object and `--no-auth`/`DAM_HOPPER_NO_AUTH`, startup fails closed (`server/src/state.rs:165-173`). `RUST_ENV=production` or `ENVIRONMENT=production` independently blocks no-auth (`server/src/state.rs:175-183`).
- The integration test simulates a configured MongoDB database and asserts the no-auth failure/message (`server/tests/auth_no_auth.rs:351-415`); production-env tests begin at `server/tests/auth_no_auth.rs:417`.
- Existing operational docs use `~/.config/dam-hopper/server.conf` for the nohup wrapper, including both MongoDB variables (`docs/linux-nohup.md:33-57`), while the systemd unit has no `EnvironmentFile` and intentionally has no shell/wrapper (`docs/linux-systemd.md:15-23`, `deploy/systemd/dam-hopper.service:10-25`).

## Secret handling and redaction risks

- Positive controls: `.env` is ignored by Git (`.gitignore:4`); systemd uses `UMask=0077` and `NoNewPrivileges=true` (`deploy/systemd/dam-hopper.service:21-23`); deployment docs prohibit copying `.env` or runtime secrets into `/opt` (`docs/linux-systemd.md:443-447`); PTY diagnostics record env keys only (`server/src/pty/manager.rs:654-655`).
- The MongoDB URI itself is not logged in the normal connection message (`server/src/main.rs:257`), but parse/client errors are propagated with `?` (`258-260`). Verify the MongoDB driver does not include credentials in parse or connection error text before exposing those errors to logs/API responses.
- `dotenvy::dotenv()` imports every key in the working-directory `.env` into the server process. Any future generic environment dump, panic, debug formatter, child-process inheritance path, or third-party tracing instrumentation could expose all secrets. Keep `.env` permissions restrictive and document that it is process-wide, not just MongoDB-specific.
- Partial configuration is a correctness/security edge: `MONGODB_URI` alone does not create `db`, so the actual no-auth guard does not reject it even though docs imply URI presence is sufficient. A local `.env` integration should define both variables together or add explicit validation/tests for incomplete pairs.
- `RUST_LOG` is also loaded before tracing initialization (`server/src/main.rs:62-67`). Avoid enabling verbose logging around connection/config parsing in environments where URI-bearing errors could be emitted.

## Recommendations for local `.env` integration

1. Keep the existing `dotenvy::dotenv().ok()` startup behavior; do not add a second loader or make project `env_file` mutate process state.
2. Add a documented, untracked sample environment template containing placeholders only (`MONGODB_URI`, `MONGODB_DATABASE`, optional `DAM_HOPPER_*`, `RUST_LOG`) and state that `.env` is resolved relative to the server working directory.
3. Add focused tests around the startup boundary: dotenv values feed CLI env fallbacks; explicit CLI flags override them; pre-existing process variables are not overwritten; and `MONGODB_URI`/`MONGODB_DATABASE` are all-or-nothing.
4. Prefer systemd `EnvironmentFile=` or a root-owned/admin-managed secret mechanism for production rather than relying on a home-directory `.env`; if `EnvironmentFile=` is introduced, keep it outside `/opt`, mode-restricted, and avoid printing its contents.
5. Redact MongoDB credentials from any surfaced driver errors, and add a regression test asserting a URI password never appears in diagnostics or startup error text.
6. Update `docs/configuration-guide.md:541-549` to list `MONGODB_URI`, `MONGODB_DATABASE`, `RUST_ENV`, `ENVIRONMENT`, `DAM_HOPPER_PORT`, `DAM_HOPPER_HOST`, and `DAM_HOPPER_NO_AUTH`, plus the `.env` loading scope and precedence.

## Unresolved questions

- Does the pinned MongoDB driver version (`server/Cargo.toml:149`) redact credentials in all parse, DNS, and connection errors? This needs a targeted dependency/runtime test.
- Should `MONGODB_URI` without `MONGODB_DATABASE` be a startup error, or intentionally mean MongoDB disabled? Current code silently disables MongoDB.
- Should the systemd unit gain an explicit `EnvironmentFile=` contract, or remain environment-free with administrator-managed `systemctl set-environment`/drop-ins?
- Are there any external launchers besides `deploy/run-linux-nohup.sh` that set a different working directory, changing which `.env` `dotenvy::dotenv()` discovers?
