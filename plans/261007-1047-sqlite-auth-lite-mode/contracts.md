# SQLite Authentication Lite Mode — Design Contracts

Status: proposed; no implementation. Date: 2026-10-07. Branch: `feat/sqlite-auth`.

## Confirmed Scope

- Same server binary; runtime **lite mode** uses SQLite, not a separate build.
- Full existing authentication: accounts/roles, MFA, challenges, sessions, revocation, operator recovery, sensitive-action and transport enforcement.
- Independent fresh database. No MongoDB data transfer or automatic backend fallback.
- No password algorithm, JWT/wire protocol, policy deadline, frontend, release artifact, or database service redesign.
- Recovery means existing privileged MFA/account-version reset; no new recovery-code feature.
- Validation confirmed: one server process per auth file on local storage; global auth.db default and local SQL account operations. Multiple server processes/network-filesystem sharing are outside qualification, not implicit supported deployment.

## Environment Selection

| Input | Selected authentication backend |
| --- | --- |
| `DAM_HOPPER_LITE_MODE` absent, empty/whitespace, `false`, or `0` | MongoDB (existing default) |
| `DAM_HOPPER_LITE_MODE=true` or `1` | SQLite; lite mode |
| Any other nonempty value | Actionable startup error; never silently default |

Trim whitespace and accept case-insensitive `true`/`false`. Boolean syntax is a proposed explicit contract, not current support.

- `DAM_HOPPER_AUTH_SQLITE_PATH`: absent/empty defaults to `auth.db` under the existing DamHopper global configuration directory. Use the same directory resolver as global config; no hardcoded Linux-only path.
- Explicit absolute path stays absolute; `~/` expands using the existing HOME convention; relative path resolves against process startup CWD, not whichever `.env` supplied it. Reject unsupported `~user` and `:memory:` in deployment configuration; isolated tests can open memory databases directly if useful.
- Selector alone selects backend. Setting only the SQLite path never enables lite mode. Lite mode ignores MongoDB settings; default mode ignores SQLite path settings. No auto-detection.
- Read after all existing `.env` loading/config discovery, before constructing auth services. Preserve dotenv non-overwrite semantics: process environment > CWD/upward `.env` > global `.env` > explicit/resolved config-adjacent `.env` for values actually loaded. Existing early hook dispatch stays before dotenv/database work.
- Keep default-mode development behavior when MongoDB config is absent; production still requires a selected usable auth store and MFA encryption key. Explicit lite mode database creation/open/schema failure aborts startup in every environment.
- Preserve existing `--no-auth` startup bypass: skip opening either database. `AppState` rejects no-auth plus an actual active store and production no-auth; do not invent a new env-only rejection in this feature.
- A configured valid MFA key is needed for working MFA in both modes; production requires it. Keep key provisioning external and owner-only; no auto-generation/rotation change.
- Restart required to change backend/path; no live swapping. Switching away and back retains each backend's independent accounts, keys permitting.

## Shared Store Boundary

Keep existing async `AuthStore` consumer API, with enum dispatch to `MongoAuthStore` and `SqliteAuthStore`. Rename Mongo constructor to `from_mongo`, add explicit `open_sqlite`, and migrate every caller; no compatibility alias or Mongo-only `database()` accessor on the shared facade.

`AuthService` owns the optional selected store. Remove raw `AppState.db`; derive availability from `auth_service.store()` and pass the selected store into state construction. No separate cached backend/availability state.

Migrate registration, enabled-account lookup, role lookup, credential verification, host-action availability/reauthentication, and idle-suspend actor checks to the shared store. Keep actor identity bound to the authenticated subject and zeroize passwords. Storage failure must deny access; never invoke test-only/mock authentication as a runtime fallback. Existing explicit mock helpers may remain for unrelated test fixtures.

Add `create_user(UserRecord)` to the store for registration and fixture seeding. Normalize unique-username conflict into a backend-independent error; other failures cannot report successful registration. Registration still creates `isEnabled=false`, `role=user`, `authVersion=0`, no MFA, cleared attempts. No first-user-admin policy.

Keep public record types and BSON timestamps/ObjectId for this same-binary feature: SQL adapter maps them to typed columns; MongoDB preserves BSON/wire behavior. This avoids an unrelated exported-model and policy rewrite. BSON is an internal representation dependency, not a running MongoDB service. Mongo collections remain adapter-local.

## SQLite Schema

Separate file from PTY/workflow `sessions.db`. Versioned, transactional, idempotent migrations; unknown newer schema versions fail. Names below are intended SQL schema; wire/on-disk Mongo field names stay unchanged.

| Table | Columns / constraints |
| --- | --- |
| `auth_users` | `id TEXT PRIMARY KEY` (immutable 24-hex ObjectId), `username TEXT NOT NULL UNIQUE COLLATE BINARY`, `password_hash TEXT NOT NULL`, `is_enabled INTEGER NOT NULL CHECK IN (0,1)`, `role TEXT NOT NULL CHECK IN ('user','admin')`, `auth_version INTEGER NOT NULL DEFAULT 0 CHECK >=0` |
| User MFA columns | Nullable `mfa_secret_ciphertext`, `mfa_nonce`, `mfa_key_id` (TEXT), `mfa_enrolled_at_ms`, `mfa_last_accepted_step` (INTEGER). All NULL or all present; confirmed secret never plaintext. |
| User attempt columns | Nullable `mfa_attempt_window_started_at_ms`, `mfa_blocked_until_ms`; `mfa_attempt_count INTEGER NOT NULL DEFAULT 0`, checked in the Rust u32 range. |
| `auth_sessions` | `id TEXT PRIMARY KEY`, `username TEXT NOT NULL`, `auth_version`, `credential_version` INTEGER NOT NULL >=0; `issued_at_ms`, `expires_at_ms`, `mfa_verified_at_ms` INTEGER NOT NULL; nullable `revoked_at_ms` INTEGER. |
| `auth_challenges` | `id TEXT PRIMARY KEY` (SHA-256 digest), `username TEXT NOT NULL`, `auth_version INTEGER NOT NULL >=0`, `purpose TEXT NOT NULL` constrained to `enroll/loginMfa/stepUp`, `created_at_ms`, `expires_at_ms` INTEGER NOT NULL; `attempts INTEGER NOT NULL DEFAULT 0` checked u32; nullable `consumed_at_ms`. |
| Challenge bindings | Nullable TEXT `pending_secret_ciphertext`, `pending_secret_nonce`, `pending_secret_key_id`, `session_id`; nullable INTEGER `credential_version`. Preserve each purpose's existing optional fields; do not impose new API admission rules. |
| Indexes | Unique exact username; session/challenge username indexes; session/challenge expiry indexes. |

- Timestamp storage: signed i64 UTC milliseconds; preserve BSON precision. Checked decoding for IDs, roles, purpose, versions, and counters; corrupt values yield typed store error, not `Utc::now()` or fabricated records.
- Generate immutable user ObjectId when registration supplies `None`; retain supplied IDs for isolated fixtures. No username normalization/case folding.
- No new foreign-key rejection for orphan sessions/challenges: existing policy already fails closed on missing account. Enable standard SQLite foreign-key pragma without inventing deletion cascades.
- WAL, a bounded busy timeout no greater than existing 2s database admission cap, safe durability (do not select `synchronous=OFF`). Run connection access/migrations/queries in `spawn_blocking`, lock only inside blocking work; reuse `Arc<Mutex<Connection>>` pattern. No custom pool/worker/automatic retry framework.
- Ensure owner-private database directory/file and WAL/SHM sidecars on Unix, reject unsafe nonregular/symlink final targets, propagate filesystem/open errors. Keep portable handling on Windows; do not claim unexercised Windows permission proof.
- SQLite has no TTL monitor. Prune bounded batches of expired sessions/challenges on corresponding create operations using existing record issue time, expiry index and `LIMIT` subquery; request-time policy remains authority even without pruning. No background retention service.

## Mutation Contracts

| Operation | Required SQL behavior |
| --- | --- |
| `get_user`, `get_session`, `get_challenge` | Exact parameterized lookup; missing -> `None`; decoding/storage failures -> error. |
| `create_user`, `create_session`, `create_challenge` | INSERT, never REPLACE/upsert that overwrites identity/security state. Surface duplicate/error outcome. |
| `confirm_enrollment` | Conditional UPDATE username + expected auth version + absent MFA; set entire encrypted factor atomically; affected rows determine CAS success. |
| `advance_totp_step` | Conditional UPDATE username + expected auth version + strictly older accepted step; one winner for equal step. Preserve existing contract for absent last-step state without creating malformed partial MFA. |
| `record_failed_attempt` | IMMEDIATE transaction: read rolling-window state, reset/increment, persist cooldown using injected `now`; no lost increments between independent connections. Match existing 10 attempts/10min/cooldown boundaries. |
| `clear_failed_attempts` | One UPDATE clearing window/count/cooldown; missing user is no-op. |
| `increment_challenge_attempt` | Atomic increment returning updated count; missing -> 0. Checked counter bounds; readiness/attempt-limit admission stays in shared policy. |
| `consume_challenge` | Conditional UPDATE digest + expected purpose + unconsumed + `expires_at_ms > now`; exactly one winner. |
| `advance_session_mfa` | Conditional UPDATE ID + expected credential version + not revoked + expiry strictly after now; increment version and update MFA time; return updated row or None. Absolute expiry unchanged. |
| `revoke_session`, `revoke_user_sessions` | Conditional UPDATE only unrevoked rows; return bool/count; never extend session lifetime. |

Preserve current handler ordering and safety under partial failure; Mongo methods do not currently wrap complete enrollment/login/step-up across records in one transaction. Do not claim cross-record atomicity or redesign both backends here. SQLite per-operation transactions must not weaken CAS/replay safety. Distinguish existing Mongo throttle read/write race from SQLite transaction correctness; no unrelated Mongo algorithm fix.

## Operator Boundary

- Register normally, then operator uses local `sqlite3` against configured file to approve account and assign role after out-of-band identity verification. Document exact checked SQL; no public account-management surface.
- Recovery uses immutable `id` and expected `auth_version`, bumps version and NULLs complete MFA/attempt state in one conditional transaction. Require exactly one changed row; preserve password, enablement, role. Stale reset denied. Existing session/challenge version evaluation invalidates old credentials without requiring deletion.
- Back up SQLite via consistent SQLite backup/checkpoint tooling, not copying a live main file without WAL. Back up MFA key separately; signing secret remains separate. Mongo deployments retain current procedure.

## Qualification Boundary

Real file-backed SQLite tests cannot skip because MongoDB is missing. Shared MongoDB regression run must use a reachable isolated database and count executions/skips explicitly. Exercise live server without no-auth: .env selection, registration/approval/enrollment, authenticated HTTP and WS, restart persistence, logout denial. Unavailable DB/corrupt rows cannot grant access. Test two independent connections for single-winner CAS and throttling, not only clones sharing one mutex.

Planning checks validate documents and contracts only; they do not certify implemented SQLite behavior.

## Unresolved Questions

None. User confirmed lite-mode/full-parity/fresh-state scope and validated local SQL operations, global auth.db default, and one-server-per-auth-file deployment. No implementation started.
