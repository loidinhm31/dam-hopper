# Auth Storage Parity Contract & SQLite Specification

## 1. Store Method Inventory & CAS Predicates

Parity source: `server/src/auth/store.rs` (38–431). [Parent design contracts](../contracts.md) resolve recommendations below; contracts take precedence.

| Method | Mongo Op (`store.rs`) | Target Entity | Predicates / CAS Constraints | Mutation Details |
|---|---|---|---|---|
| `init_indexes` | 60–121 | `users`, `sessions`, `challenges` | Dupe check (`62–80`) fails on count > 1 | Creates unique index on `username`, lookup + TTL indexes |
| `get_user` | 125–133 | `users` | Exact `username` match | Single-record lookup |
| `confirm_enrollment` | 140–178 | `users` | `username` AND (`authVersion == expected` OR (`expected == 0` AND missing/null)) AND `mfa IS NULL` | Sets `mfa` object (`secret_ciphertext`, `nonce`, `key_id`, `enrolled_at`, `last_accepted_step`), sets `authVersion` |
| `advance_totp_step` | 185–222 | `users` | `username` AND version match AND (`mfa.lastAcceptedStep < matched_step` OR missing) | Monotonic CAS: sets `mfa.lastAcceptedStep = matched_step` |
| `record_failed_attempt` | 227–270 | `users` | Read-then-update: resets if window expired (`>= 600s`); else increments count | If count >= 10: sets `mfaBlockedUntil = now + 600s` |
| `clear_failed_attempts` | 273–285 | `users` | Exact `username` match | Unsets attempt window, count, blocked timestamp |
| `create_challenge` | 288–291 | `authChallenges` | None (`_id` is token SHA-256 digest) | Insert single challenge record |
| `get_challenge` | 294–300 | `authChallenges` | `_id == digest` | Single-record lookup |
| `increment_challenge_attempt` | 303–317 | `authChallenges` | `_id == digest` | Atomic `$inc: { attempts: 1 }`, returns post-increment count |
| `consume_challenge` | 326–344 | `authChallenges` | `_id == digest` AND `purpose == expected` AND `consumedAt IS NULL` AND `expiresAt > now` | Atomic CAS: sets `consumedAt = now`, returns `modified == 1` |
| `create_session` | 347–350 | `authSessions` | None (`_id` is session UUID) | Insert single session record |
| `get_session` | 353–361 | `authSessions` | `_id == session_id` | Single-record lookup |
| `advance_session_mfa` | 370–396 | `authSessions` | `_id == session_id` AND `credentialVersion == expected` AND `revokedAt IS NULL` AND `expiresAt > now` | Atomic CAS: `$inc: credentialVersion`, sets `mfaVerifiedAt = now`, returns new session |
| `revoke_session` | 399–413 | `authSessions` | `_id == session_id` AND `revokedAt IS NULL` | Atomic CAS: sets `revokedAt = now` |
| `revoke_user_sessions` | 416–430 | `authSessions` | `username == username` AND `revokedAt IS NULL` | Multi-record update: sets `revokedAt = now`, returns modified count |

## 2. Timestamps, Identifiers & Field Mapping

- **Timestamps**: Mongo uses `mongodb::bson::DateTime` (i64 ms epoch). SQLite uses `INTEGER` (Unix ms epoch). Retains exact millisecond fidelity with `DateTime<Utc>::timestamp_millis()`.
- **User ID**: Mongo `_id: Option<ObjectId>` (`model.rs:36`); the operator recovery runbook also relies on immutable ID (`docs/configuration/server-environment-auth.md:83–104`). Preserve it as 24-hex `id TEXT PRIMARY KEY` in SQLite, mapping back to ObjectId.
- **Session & Challenge IDs**: Natural string keys (`id: String`). Mongo `_id` maps 1:1 to SQLite `id TEXT PRIMARY KEY`.
- **MFA Flat Fields**: Sub-document `MfaConfirmed` (`model.rs:16–29`) flattens cleanly into `users` table columns: `mfa_secret_ciphertext`, `mfa_nonce`, `mfa_key_id`, `mfa_enrolled_at`, `mfa_last_accepted_step`.

## 3. SQLite DDL & Required Indexes

```sql
CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE BINARY,
    password_hash TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'user',
    auth_version INTEGER NOT NULL DEFAULT 0,
    mfa_secret_ciphertext TEXT,
    mfa_nonce TEXT,
    mfa_key_id TEXT,
    mfa_enrolled_at INTEGER,
    mfa_last_accepted_step INTEGER,
    mfa_attempt_window_started_at INTEGER,
    mfa_attempt_count INTEGER NOT NULL DEFAULT 0,
    mfa_blocked_until INTEGER
);
-- username UNIQUE supplies its index; no redundant unique index.

CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    auth_version INTEGER NOT NULL,
    credential_version INTEGER NOT NULL DEFAULT 0,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    mfa_verified_at INTEGER NOT NULL,
    revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_username ON auth_sessions(username);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    auth_version INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER,
    pending_secret_ciphertext TEXT,
    pending_secret_nonce TEXT,
    pending_secret_key_id TEXT,
    session_id TEXT,
    credential_version INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_username ON auth_challenges(username);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);
```

## 4. Concurrency, CAS Semantics & SQL Consistency

- **CAS Implementation via SQL `WHERE` & affected-row counts** (illustrative; use `auth_users`, not `users`, and constraints in parent contracts):
  - `confirm_enrollment`: `UPDATE users SET mfa_... = ?, auth_version = ? WHERE username = ? AND (auth_version = ? OR (? = 0 AND auth_version IS NULL)) AND mfa_secret_ciphertext IS NULL;`. `modified = sqlite3_changes() == 1`.
  - `advance_totp_step`: `UPDATE users SET mfa_last_accepted_step = ?, auth_version = ? WHERE username = ? AND (auth_version = ? OR (? = 0 AND auth_version IS NULL)) AND (mfa_last_accepted_step < ? OR mfa_last_accepted_step IS NULL);`.
  - `consume_challenge`: `UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?;`.
  - `advance_session_mfa`: `UPDATE auth_sessions SET credential_version = credential_version + 1, mfa_verified_at = ? WHERE id = ? AND credential_version = ? AND revoked_at IS NULL AND expires_at > ? RETURNING *;`.
- **Multi-Record Consistency**:
  - Mongo currently lacks cross-collection transactions; operations rely on atomic per-document updates.
  - In SQLite, wrap `record_failed_attempt` and bulk revocations in explicit transactions (`BEGIN IMMEDIATE`) to prevent read-modify-write races that Mongo had.
- **Async Runtime & Blocking Strategy**:
  - `rusqlite` is synchronous. To avoid blocking Tokio worker threads, execute all queries via `tokio::task::spawn_blocking` or a dedicated connection pool actor.
- **WAL Mode & Contention Control**:
  - Proposed initialization: WAL, foreign keys, safe durability, busy timeout <=2000ms to respect existing database admission caps.
  - WAL permits cross-connection readers with one writer; bounded contention produces errors, not implicit fallback/retries. One mutex-backed connection still serializes its own operations.

## 5. Recovery Semantics: MFA Reset vs Recovery Codes

- **Finding**: **Recovery means administrative MFA reset; recovery codes do NOT exist.**
  - Codebase ground truth: `store.rs:139` ("factor cannot be overwritten without recovery reset"), `model.rs:42` ("Monotonically incremented on account recovery/reset").
  - There are NO backup codes, hashed recovery tokens, or recovery code tables anywhere in `model.rs`, `store.rs`, `api/auth_mfa.rs`, or `docs/architecture/authentication-state-and-cryptography.md`.
  - Existing operator runbook conditionally bumps `authVersion` and clears MFA/attempt state; policy invalidates old sessions/challenges without requiring explicit revocation/deletion (`docs/configuration/server-environment-auth.md:88–104`). No recovery API/store method is implied.

## 6. Shared Model Strategy: Evaluation & Recommendation

- **Option A (Decoupled Domain Models)**: Refactor `model.rs` timestamps to `chrono::DateTime<Utc>` and `Option<String>` for IDs. Requires adapters for both Mongo BSON and SQLite.
- **Option B (Boring / Minimal Blast Radius - RECOMMENDED)**:
  - Both backends compile into the exact same server binary. `mongodb` crate is already linked.
  - Keep `UserRecord`, `AuthSession`, and `AuthChallenge` as standard shared structs in `model.rs`.
  - SQLite maps typed columns to `BsonDateTime::from_millis(col)` and retained ObjectId decoded from immutable 24-hex user ID.
  - **Verdict**: Keep models shared as-is (Option B). Eliminates touchpoints across API routes (`auth.rs`, `auth_mfa.rs`, policy evaluator) while achieving 100% auth parity.

## 7. Unsupported Assumptions & Open Questions

1. **TTL Garbage Collection**: Mongo handles TTL deletion in background threads via indexes (`store.rs:95,111`). SQLite lacks native TTL; expired sessions/challenges accumulate unless an explicit background sweeper or query-time purge is scheduled.
2. **User Creation API**: User creation is outside `AuthStore` in Mongo (seeds / register elsewhere); SQLite parity requires initial user provisioning logic or shared user bootstrap.

Parent adjudication: this sketch is not final DDL. Apply all constraints, `_ms` column naming, complete step-up bindings, disabled registration defaults, typed errors, and migration rules from [contracts](../contracts.md). Use bounded opportunistic expiry pruning rather than a new background service.
