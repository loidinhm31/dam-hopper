# Authentication State, Cryptography, and Session Policy

**Authority:** Server Authentication Core (`server/src/auth/`)  
**Status:** Maintained Architecture Specification  

## Scope and Integration Boundary

The authentication subsystem provides backend-abstracted auth-state persistence (MongoDB and implemented SQLite storage adapters), cryptographic helpers, TOTP verification, and a deterministic session-policy evaluator. Challenge-based login, enrollment, verification, status, and logout endpoints are defined in the [Authentication API](../api/authentication.md).

- `AppState` owns an `Arc<AuthService>`; `evaluate_claims` loads current session/user state and invokes the shared policy evaluator.
- Protected REST middleware and WebSocket admission use this evaluator. `AuthenticatedActor` carries non-secret session identity/version and effective deadline; no raw bearer material is retained.
- WebSockets check the local deadline on inbound frames and outbound writes, with a five-second background session/revocation watcher. Image and video media capabilities bind to the auth session and versions, clamp absolute TTL to the effective deadline, and revalidate live streams.

Session issuance and every protected REST admission enforce the 30-day absolute and 10-day MFA freshness deadlines. WebSocket and media streams also enforce deadline and bounded revocation checks.

## Module Map

| Path | Responsibility |
| --- | --- |
| `server/src/auth/model.rs` | User, MFA, session, challenge, V2 claims, and policy decision records |
| `server/src/auth/store.rs` | Shared `AuthStore` facade: backend dispatch (`Backend::{Mongo, Sqlite}`), constructors (`from_mongo`, `open_sqlite`), unified error type (`StoreError`), user insertion, and test qualification hooks |
| `server/src/auth/store/mongo.rs` | Private MongoDB adapter: collections, indexes, account/challenge attempts, session operations, and compare-and-swap (CAS) mutations |
| `server/src/auth/store/sqlite.rs` | Private SQLite adapter: connection lifecycle, `spawn_blocking` execution, atomic CAS operations, attempt throttling, and opportunistic pruning |
| `server/src/auth/store/sqlite/open.rs` | Secure SQLite file preparation (0600 file / 0700 dir, symlink rejection), WAL pragmas, application ID header check, and versioned schema migrations |
| `server/src/auth/store/sqlite/records.rs` | Row-to-model checked mapping, UTC millisecond conversions, and fail-closed `InconsistentState` decoding |
| `server/src/auth/store/migrations/001-auth.sql` | Version 1 SQLite schema: STRICT `auth_users`, `auth_sessions`, and `auth_challenges` tables, indexes, and immutable ID trigger |
| `server/src/auth/policy.rs` | Injectable clock, deadline calculation, session decision table, challenge readiness, and throttle constants |
| `server/src/auth/secret.rs` | MFA key-file loading and AES-256-GCM secret encryption/decryption |
| `server/src/auth/totp.rs` | Secret generation/encoding, `otpauth://` URI construction, TOTP verification, and replay check |
| `server/src/auth/mod.rs` | `AuthService`, opaque challenge-token generation/digesting, and state-backed claim evaluation |
| `server/src/auth/config.rs` | Backend selection from `DAM_HOPPER_LITE_MODE`, SQLite path resolution (default `auth.db` in the global config directory, `~/` and CWD-relative forms), and distinct-database-file check |
| `server/src/state.rs`, `server/src/main.rs` | `AppState` ownership of the selected store via `AuthService`, key loading, production/`--no-auth` guards, and one-time store initialization (`init_auth_store`) |
| `server/src/api/auth.rs` | Password login challenges, full-policy protected-route middleware, status/logout |
| `server/src/api/auth_mfa.rs` | Challenge-gated TOTP enrollment, login verification, and step-up handlers |
| `server/tests/auth_mfa_api.rs` | HTTP lifecycle coverage for enrollment, login MFA, session step-up/status/logout, and edge cases |
| `server/tests/auth_state_and_policy.rs` | Focused policy, encryption, TOTP/replay, throttle, and MongoDB-store coverage |
| `server/tests/auth_sqlite_store.rs` | Dedicated file-backed SQLite store test suite: migrations, concurrency, CAS semantics, throttling, pruning, and security constraints |
| `server/tests/auth_lite_mode.rs` | File-backed SQLite lite-mode integration: registration, administrator gate, re-authentication, routed disabled-actor denial, storage-failure denial, and startup guards |
| `server/tests/transport_enforcement_phase03.rs` | REST, WebSocket admission/live revocation, logout, and reset integration coverage |

## Persisted State and Policy

Collections and tables persist user, session, and challenge records. JWT claims use the explicit V2 fields `v`, `sub`, `sid`, `authVersion`, `credentialVersion`, `iat`, and `exp`.

| State | Contract |
| --- | --- |
| User | Retains username, password hash, enablement, and role. `authVersion` defaults to `0` when absent in legacy documents; optional `mfa` stores the confirmed encrypted factor and last accepted TOTP step. Failed-attempt window/count/cooldown are account fields. |
| Session | Binds one username to `authVersion`, `credentialVersion`, issue time, absolute expiry, most recent MFA time, and optional revocation time. |
| Challenge | Stores the SHA-256 digest of the client-facing random token as its ID, account/version, purpose (`enroll`, `loginMfa`, or `stepUp`), issue/expiry times, attempts/consumption state, and purpose-specific encrypted enrollment or session binding data. |
| Session decision | Requires enabled account, V2 claims, matching account/session/claim identity and versions, non-revoked session, and exact JWT/session expiry agreement. At `now >= expiresAt`, full login is required; before expiry, at `now >= mfaDueAt`, MFA step-up is required; otherwise access is allowed. |

Policy bounds are fixed in `policy.rs`:

| Bound | Value |
| --- | --- |
| Absolute session lifetime | 30 days; no expiry grace |
| MFA freshness | 10 days per session, clamped to absolute session expiry |
| Challenge lifetime | 5 minutes |
| Challenge verification attempts | 5 maximum |
| Account failed attempts | 10 within a 10-minute window, then a 10-minute cooldown |
| Auth protocol | V2 |

`AuthDecision` distinguishes full access, MFA-required step-up, full-login-required, and unavailable state. Request-time policy checks enforce expiries independently of background deletion or pruning.

`AuthStore` is a facade over private backend adapters (`Backend::Mongo` and `Backend::Sqlite`); no raw database handle is exposed through it. `StoreError` unifies backend error variants (`Mongo`, `Bson`, `Sqlite`, `Io`, `Unavailable`, `DuplicateUsername`, `InconsistentState`). The store provides user insertion, conditional enrollment confirmation, monotonic accepted-step advancement, one-time challenge consumption, session MFA revision advancement, and session revocation. `create_user` is a plain insert that generates the immutable `_id` when absent and reports a username conflict as `StoreError::DuplicateUsername`; other write failures stay storage errors.

### MongoDB Storage Adapter

- Constructed via `AuthStore::from_mongo(db)`.
- Collections: `users`, `authSessions`, and `authChallenges` with camelCase BSON documents.
- Index setup: `init_indexes()` checks for duplicate usernames before requesting a unique username index, and requests username lookup plus expiry TTL indexes for sessions and challenges.
- Cleanup: MongoDB TTL background indexes garbage-collect expired documents; request-time policy checks remain authoritative.

### SQLite Storage Adapter (Implemented)

The SQLite adapter (`server/src/auth/store/sqlite.rs`) is fully implemented and tested at the storage layer:

- **Construction and Migration:** Opened asynchronously via `AuthStore::open_sqlite(path)`. Schema migrations run synchronously during open; `init_indexes()` is an intentional no-op.
- **Tables and Schema (`001-auth.sql`):** Dedicated authentication database with STRICT tables and UTC timestamps stored as integer milliseconds (`_ms`):
  - `auth_users`: Primary key `id` (24-hex lowercase ObjectId, protected against modification by `auth_users_id_immutable` trigger); `username` (`TEXT NOT NULL UNIQUE COLLATE BINARY`); `password_hash`; `is_enabled` (0 or 1); `role` (`user` or `admin`); `auth_version` (`>= 0`); MFA columns (`mfa_secret_ciphertext`, `mfa_nonce`, `mfa_key_id`, `mfa_enrolled_at_ms`, `mfa_last_accepted_step`) enforced all NULL or all non-NULL by a table `CHECK` constraint; attempt throttling columns (`mfa_attempt_window_started_at_ms`, `mfa_attempt_count`, `mfa_blocked_until_ms`).
  - `auth_sessions`: Primary key `id`; `username`; `auth_version`; `credential_version`; `issued_at_ms`; `expires_at_ms`; `mfa_verified_at_ms`; nullable `revoked_at_ms`. Indexes on `username` and `expires_at_ms`.
  - `auth_challenges`: Primary key `id` (hex SHA-256 digest of client token); `username`; `auth_version`; `purpose` (`enroll`, `loginMfa`, `stepUp`); `created_at_ms`; `expires_at_ms`; `attempts` (`0..u32::MAX`); nullable `consumed_at_ms`; purpose payload columns (`pending_secret_ciphertext`, `pending_secret_nonce`, `pending_secret_key_id`, `session_id`, `credential_version`). Indexes on `username` and `expires_at_ms`.
- **File Security and Open Invariants (`sqlite/open.rs`):**
  - Unix parent directory created with mode `0700`; existing parent directories writable by group or others (`mode & 0o022 != 0`) are rejected.
  - Database file opened/created with mode `0600`, `O_NOFOLLOW`, and `SQLITE_OPEN_NOFOLLOW`; existing files with any group or other bits (`mode & 0o077 != 0`) or symlinks are rejected. Sidecars (`-wal`, `-shm`) inherit `0600` permissions.
  - Pragmas: WAL journaling (`PRAGMA journal_mode = WAL`), full durability (`PRAGMA synchronous = FULL` ensuring power-loss durability for revocations and consumptions), 2-second busy timeout (`PRAGMA busy_timeout = 2000`), and foreign key enforcement (`PRAGMA foreign_keys = ON`).
  - Header & Version Gate: Validates `PRAGMA application_id = 0x44484155` ("DHAU") and `PRAGMA user_version = 1`. A brand-new empty database initializes from 0 to 1 inside an `IMMEDIATE` transaction; a foreign database or newer schema version fails with `StoreError::Unavailable` before any mutation, and an unreadable/corrupt file fails open with a SQLite error. A failed open never selects another backend.
- **Concurrency and Execution Model:** Uses an `Arc<Mutex<rusqlite::Connection>>`. All operations execute inside `tokio::task::spawn_blocking`, holding the lock only synchronously for the duration of the closure and never across an async `.await`.
- **Compare-And-Swap (CAS) & Mutation Semantics:**
  - Exact parameterized queries prevent injection and ambiguity.
  - `create_user` is INSERT-only; SQLite `UNIQUE` conflict on `auth_users.username` maps exclusively to `StoreError::DuplicateUsername`.
  - Atomic CAS mutations use single conditional `UPDATE` statements: `confirm_enrollment` (requires matching `auth_version` and NULL factor), `advance_totp_step` (requires enrolled factor and strictly greater step), `consume_challenge`, `advance_session_mfa`, and `revoke_*`.
  - Account throttling (`record_failed_attempt`) runs in an `IMMEDIATE` transaction sharing policy constants (10 attempts, 600s window, 600s cooldown), so concurrent failures never lose an increment. `clear_failed_attempts` resets attempt state; `increment_challenge_attempt` is a single `UPDATE ... RETURNING`.
- **Opportunistic Pruning:** `create_session` and `create_challenge` prune up to 256 expired rows (`expires_at_ms <= issue_time`) in the same transaction as row creation. No background sweeper thread is used; request-time policy checks remain authoritative.
- **Fail-Closed Decoding (`sqlite/records.rs`):** Row decoding validates constraints strictly; unknown roles, unknown challenge purposes, out-of-range counters, partial MFA factor tuples, or malformed ObjectIds map directly to `StoreError::InconsistentState`, failing closed to deny access.

## Cryptography and TOTP

`DAM_HOPPER_MFA_KEY_FILE` selects the dedicated 32-byte MFA encryption key. The file loader accepts 32 raw bytes, 64 hexadecimal characters, or 44 Base64 characters; it rejects symlinks and non-regular files, and on Unix rejects any group/world permission bits (`mode & 0o077 != 0`, enforcing owner-only access; `chmod 0600` recommended). The key is held in zeroizing memory (`Zeroizing<[u8; 32]>`). When configured, malformed or unreadable key material fails startup. Production authenticated startup requires the key; non-production development may construct the service without it.

MFA secrets are encrypted with AES-256-GCM using a random 12-byte nonce. Authenticated associated data binds the key ID, username, and purpose; ciphertext and nonce are Base64 encoded. Decryption requires the matching key ID and AAD and returns a zeroizing buffer. The key ID uses the configured file's UTF-8 stem, or `mfa-key-v1` when unavailable. Provision and back up this key separately from MongoDB or SQLite; the runtime does not create or rotate it automatically.

TOTP uses a CSPRNG-generated 20-byte secret, Base32 provisioning, SHA-1, six decimal digits, a 30-second step, and a ±1-step window. Verification uses constant-time code comparisons and returns the greatest matching step. A step is eligible only if it is newer than `lastAcceptedStep`; the store CAS makes persisted advancement monotonic under concurrent use. Keep leading zeroes in submitted codes.

Challenge handles are generated from 32 random bytes and returned as hex; only their SHA-256 digest is persisted. Challenge checks validate purpose, consumption, expiration, and attempt limit. Account failure tracking is persisted so issuing a new challenge does not reset the account window.

## Startup and Operational Boundary

Server startup resolves the authentication backend after every `.env` file has loaded: `AuthBackendConfig::from_env` (`server/src/auth/config.rs`) reads `DAM_HOPPER_LITE_MODE` (and `DAM_HOPPER_AUTH_SQLITE_PATH` when lite mode is on), then `init_auth_store` in `main.rs` opens the selected store exactly once. MongoDB (the default) uses `AuthStore::from_mongo` and requests index initialization; returned initialization errors are logged as warnings and do not abort startup. Lite mode uses `AuthStore::open_sqlite`; any open/migration failure aborts startup and never falls back to MongoDB. `--no-auth` skips store selection entirely. `AppState::new` takes the optional store, builds the shared `AuthService` from it (there is no raw database handle on `AppState`) and loads `DAM_HOPPER_MFA_KEY_FILE` when configured. With no store the service reports authentication unavailable; there is no implicit test account. Production mode is identified by `RUST_ENV=production` or `ENVIRONMENT=production`; production startup requires a selected authentication store and the MFA key, and rejects the development bypass (`--no-auth`). `--no-auth` together with an active store (either backend) is rejected.

Registration, administrator-role lookup, enabled-account checks, same-subject re-authentication, host-action availability and idle-suspend actor checks all go through the selected `AuthStore`; storage failure denies and never consults a mock.

The MFA key is encryption material, not the JWT signing secret. Do not put it in MongoDB or SQLite, expose it to the browser, or log its contents. Missing database state or failed session/user lookups result in an unavailable policy decision rather than an allow decision.

## Lite Mode Status and Runtime Integration Plan

Design tracked in [SQLite authentication lite-mode plan](../../plans/261007-1047-sqlite-auth-lite-mode/plan.md). Runtime selection is implemented (Phase 03); live-runtime qualification and operator documentation remain.

### Implementation Status

- **Storage Layer (Phase 02 — Implemented):** `SqliteAuthStore` adapter, `AuthStore::open_sqlite` constructor, versioned STRICT schema migrations (`001-auth.sql`), atomic CAS updates, account throttling, opportunistic pruning, fail-closed row decoding, strict file/directory permissions (0600 file / 0700 parent), WAL durability (`synchronous=FULL`), and file-backed integration test suite (`server/tests/auth_sqlite_store.rs`).
- **Runtime Selection and Integration (Phase 03 — Implemented):** `DAM_HOPPER_LITE_MODE` / `DAM_HOPPER_AUTH_SQLITE_PATH` selection and path resolution (`server/src/auth/config.rs`), single store initialization in `main.rs`, distinct-file check against the session and telemetry databases, `AppState.db` removed, backend-neutral production and `--no-auth` guards, and registration/role/re-authentication/host-action/idle-suspend consumers migrated to `AuthStore` (`server/tests/auth_lite_mode.rs`).
- **Remaining (Phases 04–05 — Not Implemented):**
  - Live runtime qualification across REST and WebSocket auth flows, restart persistence and operator recovery SQL (Phase 04).
  - Operator documentation and deployment guidance (Phase 05).

### Runtime Integration Design

- Keep one server binary. `DAM_HOPPER_LITE_MODE=true` selects SQLite for the entire authentication store; unset, empty, or false keeps MongoDB. Unknown values fail startup. Lite mode is authenticated deployment, not `--no-auth`.
- `DAM_HOPPER_AUTH_SQLITE_PATH` selects the independent auth database; absent/empty defaults to `auth.db` in the existing DamHopper global config directory. Existing PTY/workflow `sessions.db` is unchanged. Switching backends starts independent account/session state; no import or migration.
- Validated lite deployment: one server process per auth file on local storage. Concurrent requests and local operator connections still require database-level CAS; shared network-file/multi-server deployments are not qualified by this feature.
- Keep `AuthService`, policy, JWT V2, TOTP, encrypted secrets, and wire contracts shared. Handlers, role checks, sensitive-action reauthentication, and transports must not bypass `AuthStore`.
- File-backed SQLite initialization/migrations must succeed before accepting requests. Unavailable storage fails closed, never falls back to MongoDB or development authentication. Production requires the selected usable store and the existing MFA key.
- Preserve explicit development bypass semantics; do not open an authentication database under `--no-auth`. Application-state construction rejects bypass plus an active store, regardless of backend.
- Account registration retains disabled-by-default user status. Operators enable accounts and assign administrator roles locally; no automatic first-user administrator, unauthenticated management endpoint, or reduced MFA policy.
- Qualification must cover authenticated enrollment/login, restart persistence, revocation, replay/CAS races, exact deadlines, administrator checks, REST/WebSocket enforcement, and unchanged MongoDB defaults.

## Related Documentation

- [Authentication API](../api/authentication.md) — Route contract, MFA challenge credential admission, and JSON examples
- [API Reference](../api-reference.md#authentication) — Server-wide route index
- [Server Configuration](../configuration/server-configuration.md#environment-variables) — Environment-variable index
- [System Architecture](../system-architecture.md) — Server-wide subsystem architecture
