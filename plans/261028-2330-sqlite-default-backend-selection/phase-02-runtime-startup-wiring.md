# Phase 02 — Main.rs and Runtime Startup Wiring

Priority P2 · Status pending · Effort 3h

## Context and requirements
- [Overview](./plan.md), [resolver contract](./phase-01-resolver-and-precedence-matrix.md).
- `server/src/main.rs:549-617`: one-time initializer currently returns optional store, re-reads Mongo variables, and can return None in development. `:857-861`: `--no-auth` already bypasses the initializer.
- Existing Mongo `init_indexes` warning policy is intentional for this scope. Driver construction alone is lazy and does not establish connectivity; a selected unreachable Mongo must still fail before serving.
- Existing SQLite adapter, schema, key-file validation, production detection, and collision checks remain unchanged in behavior.

## Task: wire-auth-startup
1. Migrate all `main.rs` enum constructors/patterns to phase 01 config. `from_env()` remains after every dotenv load; no new env precedence or CLI/TOML settings.
2. Make `init_auth_store(...) -> anyhow::Result<AuthStore>`: authenticated startup cannot represent an unconfigured optional store anymore. At the existing caller keep `None` only for `cli.no_auth`; otherwise use `Some(init_auth_store(...).await?)`. Preserve `AppState` optional-store API for bypass and tests; no changes to `state.rs`.
3. SQLite: retain production check for `RUST_ENV=production` OR `ENVIRONMENT=production`; load and validate configured MFA key before creating auth.db. Existing key loader rejects empty/unreadable/malformed/insecure key files. Missing production key fails before open. Preserve default path, collision checks against session/telemetry files, permissions/WAL/migrations, and fatal open handling.
4. Reuse resolved backend for `ensure_distinct_from` before destructuring or borrow its path; do not clone the path solely to construct another config value.
5. After successful SQLite open, log exactly `Authentication backend: SQLite (default)` when `explicit == false`; include structured `reason = "MongoDB variables unset"` and path. Explicit true logs `Authentication backend: SQLite (explicit)` with `DAM_HOPPER_LITE_MODE` as reason. Never mislabel forced SQLite as default.
6. Mongo: consume validated `uri` and `database` from config. Remove missing-env branches, production-only missing-store error, and development warning/None path. Parse `ClientOptions`, create client, obtain selected database, and issue ONE `run_command(doc! { "ping": 1 })` before wrapping/accepting the store. Reuse existing mongodb API/dependency; no retries or new timeout setting.
7. Propagate URI parsing, client construction, ping/connectivity errors as fatal contextual startup failures. Diagnostics identify selected backend and configuration names without exposing credential-bearing URI or server-echoed secrets; use existing safe error/redaction conventions. Do not log raw Mongo URI/config/ClientOptions.
8. Call existing `store.init_indexes().await` after successful connectivity. Preserve current warning-and-continue behavior exactly; log safe error context. No fallback on ping OR index error. Log selected Mongo backend without credentials; only report ready after successful connectivity.
9. Keep `--no-auth` outside resolution/key/auth-file initialization; do not weaken production or host guards. No additional startup file lock: one-process SQLite remains documented operations policy.
10. Adapt current `init_auth_store_lite_mode_opens_sqlite_and_honors_precedence` test to the nonoptional result/new behavior. Replace unguarded global env cleanup with scoped restoration and local serialization for every binary-unit test mutating env. Prefer phase 03 child processes for new combinations; do not spread env mutation through the binary test suite.

## Failure and observability contract
| Failure | Result |
| --- | --- |
| Invalid/partial/set-blank backend env | Resolver error, nonzero exit; never open auth.db |
| Invalid Mongo URI or failed ping | Fatal before auth readiness; no SQLite fallback |
| Mongo index init failure after successful ping | Existing warning and continued Mongo-only operation |
| Missing/invalid production SQLite key | Fatal before auth.db open |
| SQLite collision, permissions, open/migration failure | Fatal; no Mongo attempt |
| Allowed loopback development bypass | Skip backend resolution/storage; existing development semantics |

"Fail immediately" means abort on the driver's startup failure, not an invented sub-second SLA. Tests may set standard URI `serverSelectionTimeoutMS`/`connectTimeoutMS` values to bound negative scenarios; production driver timeout defaults remain untouched.

## Files and ownership
Modify only `server/src/main.rs`, including its existing unit tests and local env guard. No new modules/dependencies, no adapter/schema edits, no files deleted. Phase 02 implementer owns this file after phase 01 interface handoff; dependent changes are compiled together.

## Risks, security, rollback
- A successful ping distinguishes connectivity from existing index-policy warnings; it is not proof that every future query/write succeeds. Mongo authentication/index permissions may still produce existing runtime/index errors; do not promise policy beyond this contract.
- No startup log may include URI userinfo, credentials, tokens or key contents. Preserve key-load-before-SQLite-file ordering.
- No runtime resource loop, polling or retry introduced; one startup command only. Mongo/SQLite identities remain separate.
- Rollback code and enum caller together; retain databases and MFA key. Prior startup behavior requires explicit true to reopen SQLite.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "wire-auth-startup",
    "title": "Wire resolved backend into one-time authenticated startup",
    "blocked_by": ["resolve-auth-backend"],
    "allowed_files": ["server/src/main.rs"],
    "constraints": ["Preserve dotenv precedence, production/key/path guards and loopback-only no-auth behavior.", "Add one Mongo connectivity ping, no retries/fallback; retain warning-and-continue for index initialization errors.", "Do not add advisory file locks or modify AuthStore, schema, AppState policy or dependencies.", "Migrate binary unit tests without leaking global env; coordinator executes checks only after all edits land."],
    "acceptance": ["Authenticated initializer always returns a real selected store or error; optional None is reserved for the bypass caller.", "SQLite logs distinguish default and explicit selection and production key validation precedes file creation.", "Invalid/unreachable Mongo aborts without SQLite; successful Mongo keeps existing index-warning policy.", "All main.rs callers and binary unit tests match the resolved config and nonoptional initializer."],
    "verification": ["Coordinator runs cargo check --manifest-path server/Cargo.toml --bin dam-hopper-server and cargo test --manifest-path server/Cargo.toml --bin dam-hopper-server after integrated edits.", "Coordinator observes default/explicit SQLite logs and invalid/unreachable Mongo process failure with no fallback file using phase 03 tests."]
  }
]
```

- [ ] <!-- evcrate-task:wire-auth-startup --> Wire selected store and preserve startup guards

## Handoff
Phase 03 tests actual binary startup, not just constructing AppState or directly opening AuthStore. Any index-policy change is out of scope and requires a separate decision.
