# SQLite Default Backend Selection and Dual Production Support

Status: **approved design**. User explicitly approved this design and startup log proposal on 2026-10-29. Approval authorizes this record only; no implementation or direct code changes implied.

## Problem and final artifact

Currently, DamHopper defaults to MongoDB for user authentication (`server/src/auth/config.rs`). Existing documentation describes SQLite authentication as having full feature parity (strict WAL mode, encrypted MFA, sessions, and role-based access control), but it is gated behind an explicit `DAM_HOPPER_LITE_MODE=true` environment variable. When starting without MongoDB configured and without `DAM_HOPPER_LITE_MODE=true`, the server either aborts startup in production or starts with a disabled/unconfigured authentication store in development.

Users require SQLite to be a first-class choice for both development and production without requiring MongoDB setup, while preserving automatic selection of MongoDB when MongoDB environment variables are present.

Approved implementation artifact: A refined backend selection contract in `server/src/auth/config.rs` and `server/src/main.rs` that automatically defaults to SQLite when MongoDB is unconfigured, strictly enforces MongoDB when requested, and treats SQLite as a fully qualified production backend alongside MongoDB. This brainstorm does not implement that artifact.

## Agreed scope and constraints

User choices:
- Use SQLite database for both development and production.
- Default to checking for MongoDB setup in environment variables; if not present, automatically select SQLite.
- Approved startup log line: `Authentication backend: SQLite (default — MONGODB_URI not set)`.

In scope:
- Update backend selection logic in `server/src/auth/config.rs` and startup wiring in `server/src/main.rs`.
- Complete precedence rules for `DAM_HOPPER_LITE_MODE`, `MONGODB_URI`, `MONGODB_DATABASE`, and SQLite database path.
- Clear error handling for partial or malformed configurations (no silent fallback on misconfiguration).
- Add a bounded startup MongoDB connectivity ping before accepting Mongo backend initialization (failing startup loudly if unreachable, without altering the existing post-connectivity index-initialization warning policy).
- Emit explicit startup log identifying backend selection provenance.
- Update environment example files, server documentation, code standards, and test fixtures reflecting SQLite as the default unconfigured store.

Out of scope:
- Changes to the underlying SQLite schema (`001-auth.sql`) or `AuthStore` implementation.
- New runtime advisory file-locking mechanisms for SQLite (single-process ownership remains an operational and deployment constraint).
- Live data migration or synchronization between MongoDB and SQLite databases.
- Modifying authentication onboarding policies (disabled-by-default registration, operator approval, and TOTP MFA requirements remain unchanged; zero external database setup does not mean zero account onboarding).
- Concurrent dual-database active runtime in a single server process.

Constraints:
- Backward compatibility: existing deployments with valid `MONGODB_URI` and `MONGODB_DATABASE` continue to select MongoDB without configuration changes.
- Explicit selector stability: `DAM_HOPPER_LITE_MODE=true/1` explicitly forces SQLite regardless of Mongo env vars.
- No connection-failure fallback: once MongoDB is selected, connection or initialization errors must abort startup rather than falling back to SQLite.
- Single-process constraint: SQLite remains strictly limited to one server process per local database file (never shared across network filesystems or clustered nodes).
- Security invariants: in production (`RUST_ENV=production` or `ENVIRONMENT=production`), SQLite continues to mandate `DAM_HOPPER_MFA_KEY_FILE` (AES-256-GCM key). `--no-auth` remains strictly loopback-only and forbidden in production.

## Alternatives and decision

| Approach | Benefit | Trade-off / rejection |
| --- | --- | --- |
| **Automatic Selection with SQLite Default (Selected & Approved)** | Zero-config out of the box; works with standard `cargo run` / binary; retains Mongo when configured. | Operational risk if Mongo env vars are accidentally dropped (server selects a fresh SQLite identity store). Mitigated by strict unset-vs-empty parsing and explicit startup logging. |
| **Connection-Failure Dynamic Fallback** | Tries Mongo, switches to SQLite if unreachable. | **Rejected**: Violates data integrity; split-brain risk; causes missing accounts if Mongo daemon is temporarily down. |
| **New Selector Enum (`DAM_HOPPER_AUTH_BACKEND`)** | Explicit `mongo` vs `sqlite` string. | **Rejected**: Unnecessary new setting; adds conflicting configuration semantics when `DAM_HOPPER_LITE_MODE` already exists. |
| **Strict Explicit-Only Gating (Status Quo)** | No accidental database selection. | **Rejected**: High user friction; forces new users to configure MongoDB or discover `DAM_HOPPER_LITE_MODE=true`. |

## Design and interfaces

### Concrete Precedence Contract

The selection resolver in `server/src/auth/config.rs` evaluates process environment variables at startup according to this strict matrix:

| `DAM_HOPPER_LITE_MODE` | `MONGODB_URI` & `MONGODB_DATABASE` | Selected Backend | Behavior / Error Contract |
|---|---|---|---|
| `true` / `1` | Any (including partial, malformed, or blank) | **SQLite** | Explicit SQLite opt-in (existing behavior preserved). |
| `false` / `0` | Both set and non-empty/non-whitespace | **MongoDB** | Explicit MongoDB enforcement. |
| `false` / `0` | Either unset, empty, whitespace, or malformed | **Fatal Error** | Operator explicitly disabled lite mode but omitted valid Mongo config. Abort startup. |
| Unset / empty / whitespace | Both set and non-empty/non-whitespace | **MongoDB** | MongoDB auto-selected because complete Mongo config is supplied. |
| Unset / empty / whitespace | Both genuinely unset | **SQLite** | **New Default**: Zero-config startup defaults to local SQLite `auth.db`. |
| Unset / empty / whitespace | Any other combination (e.g. set-blank, partial) | **Fatal Error** | Incomplete or malformed MongoDB configuration; fail startup with actionable diagnostic. |
| Invalid string (e.g. `banana`) | Any | **Fatal Error** | Invalid boolean format; fail startup immediately. |

### Configuration Semantics: Unset vs Set-Empty

To prevent accidental fallback due to syntax mistakes or partially empty `.env` files:
1. **Genuinely Unset**: Variable is absent from process environment (`std::env::var_os(...)` is `None`). Only when **both** `MONGODB_URI` and `MONGODB_DATABASE` are genuinely unset does the resolver default to SQLite.
2. **Set-Empty or Whitespace-Only**: If either variable is defined as an empty string or whitespace (e.g. `MONGODB_URI=""`), it is treated as a **malformed configuration error**, aborting startup with an actionable error message rather than silently defaulting to SQLite.
3. **Database Name Handling**: Both `MONGODB_URI` and `MONGODB_DATABASE` must be set and non-blank when using MongoDB.

### Startup MongoDB Connectivity Ping Behavior

To satisfy the contract that an unreachable MongoDB server causes startup to fail loudly (and never fall back to SQLite), while preserving the existing warning policy for subsequent index initialization:
- After MongoDB client and database handles are constructed, `main.rs` issues a single bounded ping (`admin.run_command(doc! { "ping": 1 })`).
- If unreachable or authentication fails: server startup aborts immediately.
- If connectivity succeeds: proceeding index initialization failures retain the existing warn-and-continue policy.

### Independent State & Storage Isolation

- MongoDB and SQLite maintain independent identity datastores. No automated data transfer, credential synchronization, or schema linking is performed.
- SQLite path resolution preserves existing logic: defaults to `auth.db` in the global DamHopper configuration directory resolved via `server/src/config/global.rs` (`XDG_CONFIG_HOME` or `~/.config/dam-hopper/auth.db`), overridable via `DAM_HOPPER_AUTH_SQLITE_PATH`.
- Path collision guard remains enforced: `auth.db` cannot collide with `sessions.db` or `telemetry.db`.

### Production Parity and Operating Modes

1. **Development (`RUST_ENV != production`)**:
   - Starting without any environment variables creates/opens `auth.db`.
   - `--no-auth` remains a separate loopback bypass that skips all database initialization.
2. **Production (`RUST_ENV=production` or `ENVIRONMENT=production`)**:
   - SQLite is officially supported as a single-node production backend.
   - `DAM_HOPPER_MFA_KEY_FILE` is mandatory; missing key file aborts startup.
   - For multi-node or clustered deployments behind load balancers, MongoDB remains required due to SQLite's single-writer local-filesystem invariant. Single-process ownership is an operational constraint, not a new runtime advisory lock.

## Touchpoints and behavior

- `server/src/auth/config.rs`:
  - Extend `AuthBackendConfig::resolve` to accept raw environment state for `mongodb_uri` and `mongodb_database`.
  - Implement the complete precedence and error matrix with strict unset vs set-blank checks.
- `server/src/main.rs`:
  - Pass MongoDB environment inputs into `AuthBackendConfig::from_env`.
  - Dispatch startup on resolved `AuthBackendConfig`.
  - Add bounded MongoDB startup ping before index initialization.
  - Emit approved log line: `Authentication backend: SQLite (default — MONGODB_URI not set)` or explicit selection log.
- `server/tests/`:
  - Unit tests in `auth/config.rs` covering all rows of the Precedence Matrix.
  - Integration tests asserting clean default SQLite creation when unconfigured and immediate failure on malformed/unreachable Mongo.
- `docs/` & `deploy/`:
  - Update `docs/code-standards.md`, `docs/codebase-summary.md`, and `docs/configuration/server-environment-auth.md`.
  - Update `deploy/server.env.example` noting that SQLite is default when MongoDB is unconfigured.
- `packages/ui/e2e/`:
  - Audit E2E test harness (`fixtures/application-services.ts`) to ensure container tests expecting Mongo explicitly supply Mongo env vars.

## Feasibility and stakeholder impact

- **Developers**: Instant out-of-the-box local server startup without running `mongod` or Docker containers.
- **Single-Node Operators**: Zero external database dependency for production self-hosting and systemd installations.
- **Enterprise / Clustered Operators**: Existing MongoDB setups continue uninterrupted as long as `MONGODB_URI` and `MONGODB_DATABASE` are defined.
- **Operational Trade-off**: If an operator intends MongoDB but their environment file fails to load or drops MongoDB variables, the server will default to SQLite and create a separate identity store. This risk is acknowledged and mitigated by clear startup logs indicating `Authentication backend: SQLite (default — MONGODB_URI not set)` and the ability to explicitly set `DAM_HOPPER_LITE_MODE=false`.

## Acceptance criteria and validation

Observable criteria:
1. `dam-hopper-server` started with completely clean environment (no `DAM_HOPPER_LITE_MODE`, no `MONGODB_URI`) successfully initializes SQLite at default `auth.db` and logs `Authentication backend: SQLite (default — MONGODB_URI not set)`.
2. `dam-hopper-server` started with valid `MONGODB_URI` and `MONGODB_DATABASE` selects MongoDB without requiring `DAM_HOPPER_LITE_MODE=false`.
3. `dam-hopper-server` started with `DAM_HOPPER_LITE_MODE=true` selects SQLite even if `MONGODB_URI` is present.
4. `dam-hopper-server` started with `DAM_HOPPER_LITE_MODE=false` but missing or blank Mongo env vars aborts with an actionable error.
5. `dam-hopper-server` started with partial or whitespace-only Mongo configuration aborts with an actionable error.
6. `dam-hopper-server` in production (`RUST_ENV=production`) selecting SQLite without `DAM_HOPPER_MFA_KEY_FILE` aborts immediately.
7. `dam-hopper-server --no-auth` continues to bypass auth storage initialization entirely.
8. Unreachable or invalid MongoDB server causes immediate fatal error during startup ping and never creates an `auth.db` fallback.

## Assumptions and evidence limits

- Adapter implementation details and cryptographic behavior were not independently verified in this brainstorm; claims are based on existing repository documentation and specifications.
- Cargo.toml specifies `bcrypt` (0.19) for password hashing and existing AES-256-GCM for MFA; these cryptographic algorithms remain unchanged.
- Assumed existing E2E and unit test suites can accommodate the default backend change by ensuring Mongo-specific test harnesses pass explicit Mongo configuration.
- Single-process SQLite usage is an operational constraint documented in deployment guides; no runtime file-locking mechanism is introduced in this scope.

## Unresolved questions

- None. Precedence contract, scope boundaries, and error semantics have been fully specified and approved.
