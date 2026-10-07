//! SQLite adapter for the shared authentication store.
//!
//! Owns SQL, schema, and row mapping. Reached only through the `AuthStore`
//! facade; hooks/policy live outside this module. Every operation runs inside
//! `spawn_blocking` and holds the connection lock only there, never across an
//! await. Compare-and-swap operations are single conditional statements (or
//! IMMEDIATE transactions), so they stay correct across independent
//! connections to the same file, not only across clones of one handle.
mod open;
mod records;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use self::records::{
    decode_challenge, decode_session, decode_user, purpose_to_sql, role_to_sql, to_ms,
    CHALLENGE_COLUMNS, SESSION_COLUMNS, USER_COLUMNS,
};
use super::StoreError;
use crate::auth::model::{AuthChallenge, AuthSession, ChallengePurpose, MfaConfirmed, UserRecord};
use crate::auth::policy::{
    ACCOUNT_ATTEMPT_WINDOW_SECS, ACCOUNT_COOLDOWN_SECS, ACCOUNT_MAX_FAILED_ATTEMPTS,
};

/// Expired rows removed per create call. No background sweeper: request-time
/// policy stays the authority and pruning only bounds table growth.
const PRUNE_BATCH: i64 = 256;

/// Authentication store backed by one SQLite connection.
#[derive(Clone)]
pub(super) struct SqliteAuthStore {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteAuthStore {
    /// Open (creating if needed) the private authentication database and apply
    /// pending schema migrations. Any failure is returned, never swallowed.
    pub(super) async fn open(path: PathBuf) -> Result<Self, StoreError> {
        let conn = blocking(move || open::open_connection(&path)).await?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Run `work` on the blocking pool with exclusive access to the connection.
    async fn run<T, F>(&self, work: F) -> Result<T, StoreError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, StoreError> + Send + 'static,
    {
        let conn = Arc::clone(&self.conn);
        blocking(move || {
            let mut guard = conn.lock().map_err(|_| {
                StoreError::Unavailable("authentication database lock poisoned".into())
            })?;
            work(&mut guard)
        })
        .await
    }

    /// Insert a new user. Plain INSERT: never overwrites an existing account.
    ///
    /// Generates the immutable id when absent. Only a violation of the unique
    /// username constraint maps to `DuplicateUsername`; an id collision or any
    /// other failure stays a storage error.
    pub(super) async fn create_user(&self, user: UserRecord) -> Result<(), StoreError> {
        self.run(move |conn| {
            // `ObjectId::default()` generates a fresh id.
            let id = user.id.unwrap_or_default().to_hex();
            let mfa = user.mfa.as_ref();
            let result = conn.execute(
                &format!(
                    "INSERT INTO auth_users ({USER_COLUMNS}) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"
                ),
                params![
                    id,
                    user.username,
                    user.password_hash,
                    user.is_enabled,
                    role_to_sql(user.role),
                    user.auth_version,
                    mfa.map(|m| m.secret_ciphertext.as_str()),
                    mfa.map(|m| m.nonce.as_str()),
                    mfa.map(|m| m.key_id.as_str()),
                    mfa.map(|m| to_ms(m.enrolled_at)),
                    mfa.map(|m| m.last_accepted_step),
                    user.mfa_attempt_window_started_at.map(to_ms),
                    user.mfa_attempt_count,
                    user.mfa_blocked_until.map(to_ms),
                ],
            );
            match result {
                Ok(_) => Ok(()),
                Err(error) if is_username_conflict(&error) => Err(StoreError::DuplicateUsername(
                    format!("username '{}' already exists", user.username),
                )),
                Err(error) => Err(error.into()),
            }
        })
        .await
    }

    /// Retrieve user by exact (case-sensitive) username.
    pub(super) async fn get_user(&self, username: &str) -> Result<Option<UserRecord>, StoreError> {
        let username = username.to_owned();
        self.run(move |conn| {
            conn.query_row(
                &format!("SELECT {USER_COLUMNS} FROM auth_users WHERE username = ?1"),
                [&username],
                |row| Ok(decode_user(row)),
            )
            .optional()?
            .transpose()
        })
        .await
    }

    /// Atomically confirm MFA enrollment: matching `auth_version` and no
    /// existing factor. The whole encrypted factor is written in one UPDATE.
    pub(super) async fn confirm_enrollment(
        &self,
        username: &str,
        expected_auth_version: i64,
        mfa: MfaConfirmed,
    ) -> Result<bool, StoreError> {
        let username = username.to_owned();
        self.run(move |conn| {
            let changed = conn.execute(
                "UPDATE auth_users SET mfa_secret_ciphertext = ?3, mfa_nonce = ?4, \
                     mfa_key_id = ?5, mfa_enrolled_at_ms = ?6, mfa_last_accepted_step = ?7 \
                 WHERE username = ?1 AND auth_version = ?2 AND mfa_secret_ciphertext IS NULL",
                params![
                    username,
                    expected_auth_version,
                    mfa.secret_ciphertext,
                    mfa.nonce,
                    mfa.key_id,
                    to_ms(mfa.enrolled_at),
                    mfa.last_accepted_step,
                ],
            )?;
            Ok(changed == 1)
        })
        .await
    }

    /// Advance the accepted TOTP step: matching `auth_version`, an enrolled
    /// factor, and a strictly older stored step. One winner per step. An
    /// account without a factor never matches (no partial factor is invented).
    pub(super) async fn advance_totp_step(
        &self,
        username: &str,
        expected_auth_version: i64,
        matched_step: i64,
    ) -> Result<bool, StoreError> {
        let username = username.to_owned();
        self.run(move |conn| {
            let changed = conn.execute(
                "UPDATE auth_users SET mfa_last_accepted_step = ?3 \
                 WHERE username = ?1 AND auth_version = ?2 \
                   AND mfa_secret_ciphertext IS NOT NULL AND mfa_last_accepted_step < ?3",
                params![username, expected_auth_version, matched_step],
            )?;
            Ok(changed == 1)
        })
        .await
    }

    /// Record a failed MFA attempt using the shared window/limit/cooldown
    /// constants. The read-modify-write is one IMMEDIATE transaction, so
    /// concurrent failures on independent connections never lose an increment.
    pub(super) async fn record_failed_attempt(
        &self,
        username: &str,
        now: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        let username = username.to_owned();
        self.run(move |conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let state: Option<(Option<i64>, i64)> = tx
                .query_row(
                    "SELECT mfa_attempt_window_started_at_ms, mfa_attempt_count \
                     FROM auth_users WHERE username = ?1",
                    [&username],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let Some((window_started, count)) = state else {
                return Ok(());
            };
            let now_ms = now.timestamp_millis();
            let new_window = match window_started {
                Some(started) => {
                    now_ms.saturating_sub(started) >= ACCOUNT_ATTEMPT_WINDOW_SECS * 1_000
                }
                None => true,
            };
            if new_window {
                tx.execute(
                    "UPDATE auth_users SET mfa_attempt_window_started_at_ms = ?2, \
                         mfa_attempt_count = 1, mfa_blocked_until_ms = NULL \
                     WHERE username = ?1",
                    params![username, now_ms],
                )?;
            } else {
                let new_count = u32::try_from(count)
                    .ok()
                    .and_then(|count| count.checked_add(1))
                    .ok_or_else(|| {
                        StoreError::InconsistentState("MFA attempt counter out of range".into())
                    })?;
                let blocked_until = if new_count >= ACCOUNT_MAX_FAILED_ATTEMPTS {
                    let cooldown = now_ms
                        .checked_add(ACCOUNT_COOLDOWN_SECS * 1_000)
                        .ok_or_else(|| {
                            StoreError::InconsistentState("cooldown deadline overflow".into())
                        })?;
                    Some(cooldown)
                } else {
                    None
                };
                tx.execute(
                    "UPDATE auth_users SET mfa_attempt_count = ?2, \
                         mfa_blocked_until_ms = COALESCE(?3, mfa_blocked_until_ms) \
                     WHERE username = ?1",
                    params![username, new_count, blocked_until],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// Reset account failure tracking; a missing user is a no-op.
    pub(super) async fn clear_failed_attempts(&self, username: &str) -> Result<(), StoreError> {
        let username = username.to_owned();
        self.run(move |conn| {
            conn.execute(
                "UPDATE auth_users SET mfa_attempt_window_started_at_ms = NULL, \
                     mfa_attempt_count = 0, mfa_blocked_until_ms = NULL \
                 WHERE username = ?1",
                [&username],
            )?;
            Ok(())
        })
        .await
    }

    /// Insert a newly issued challenge after pruning a bounded batch of
    /// challenges already expired at its issue time.
    pub(super) async fn create_challenge(
        &self,
        challenge: AuthChallenge,
    ) -> Result<(), StoreError> {
        self.run(move |conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            prune_expired(&tx, "auth_challenges", to_ms(challenge.created_at))?;
            tx.execute(
                &format!(
                    "INSERT INTO auth_challenges ({CHALLENGE_COLUMNS}) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
                ),
                params![
                    challenge.id,
                    challenge.username,
                    challenge.auth_version,
                    purpose_to_sql(challenge.purpose),
                    to_ms(challenge.created_at),
                    to_ms(challenge.expires_at),
                    challenge.attempts,
                    challenge.consumed_at.map(to_ms),
                    challenge.pending_secret_ciphertext,
                    challenge.pending_secret_nonce,
                    challenge.pending_secret_key_id,
                    challenge.session_id,
                    challenge.credential_version,
                ],
            )?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// Retrieve challenge by hex SHA-256 digest.
    pub(super) async fn get_challenge(
        &self,
        digest: &str,
    ) -> Result<Option<AuthChallenge>, StoreError> {
        let digest = digest.to_owned();
        self.run(move |conn| {
            conn.query_row(
                &format!("SELECT {CHALLENGE_COLUMNS} FROM auth_challenges WHERE id = ?1"),
                [&digest],
                |row| Ok(decode_challenge(row)),
            )
            .optional()?
            .transpose()
        })
        .await
    }

    /// Atomically increment the attempt counter; a missing challenge yields 0.
    /// The column CHECK rejects overflow past `u32::MAX` (fails closed).
    pub(super) async fn increment_challenge_attempt(
        &self,
        digest: &str,
    ) -> Result<u32, StoreError> {
        let digest = digest.to_owned();
        self.run(move |conn| {
            let attempts: Option<i64> = conn
                .query_row(
                    "UPDATE auth_challenges SET attempts = attempts + 1 \
                     WHERE id = ?1 RETURNING attempts",
                    [&digest],
                    |row| row.get(0),
                )
                .optional()?;
            match attempts {
                None => Ok(0),
                Some(value) => u32::try_from(value).map_err(|_| {
                    StoreError::InconsistentState("challenge attempts out of range".into())
                }),
            }
        })
        .await
    }

    /// Atomically consume a challenge: matching purpose, unconsumed, and
    /// `expires_at > now`. Exactly one concurrent caller wins.
    pub(super) async fn consume_challenge(
        &self,
        digest: &str,
        expected_purpose: ChallengePurpose,
        now: DateTime<Utc>,
    ) -> Result<bool, StoreError> {
        let digest = digest.to_owned();
        self.run(move |conn| {
            let now_ms = now.timestamp_millis();
            let changed = conn.execute(
                "UPDATE auth_challenges SET consumed_at_ms = ?3 \
                 WHERE id = ?1 AND purpose = ?2 AND consumed_at_ms IS NULL \
                   AND expires_at_ms > ?3",
                params![digest, purpose_to_sql(expected_purpose), now_ms],
            )?;
            Ok(changed == 1)
        })
        .await
    }

    /// Store a newly created session after pruning a bounded batch of sessions
    /// already expired at its issue time.
    pub(super) async fn create_session(&self, session: AuthSession) -> Result<(), StoreError> {
        self.run(move |conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            prune_expired(&tx, "auth_sessions", to_ms(session.issued_at))?;
            tx.execute(
                &format!(
                    "INSERT INTO auth_sessions ({SESSION_COLUMNS}) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
                ),
                params![
                    session.id,
                    session.username,
                    session.auth_version,
                    session.credential_version,
                    to_ms(session.issued_at),
                    to_ms(session.expires_at),
                    to_ms(session.mfa_verified_at),
                    session.revoked_at.map(to_ms),
                ],
            )?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// Retrieve session by session ID.
    pub(super) async fn get_session(
        &self,
        session_id: &str,
    ) -> Result<Option<AuthSession>, StoreError> {
        let session_id = session_id.to_owned();
        self.run(move |conn| {
            conn.query_row(
                &format!("SELECT {SESSION_COLUMNS} FROM auth_sessions WHERE id = ?1"),
                [&session_id],
                |row| Ok(decode_session(row)),
            )
            .optional()?
            .transpose()
        })
        .await
    }

    /// Atomically bump `credential_version` and refresh `mfa_verified_at` on
    /// step-up: version must match, session unrevoked and `expires_at > now`.
    /// The absolute expiry is never changed.
    pub(super) async fn advance_session_mfa(
        &self,
        session_id: &str,
        expected_credential_version: i64,
        now: DateTime<Utc>,
    ) -> Result<Option<AuthSession>, StoreError> {
        let session_id = session_id.to_owned();
        self.run(move |conn| {
            conn.query_row(
                &format!(
                    "UPDATE auth_sessions SET credential_version = credential_version + 1, \
                         mfa_verified_at_ms = ?3 \
                     WHERE id = ?1 AND credential_version = ?2 AND revoked_at_ms IS NULL \
                       AND expires_at_ms > ?3 \
                     RETURNING {SESSION_COLUMNS}"
                ),
                params![
                    session_id,
                    expected_credential_version,
                    now.timestamp_millis()
                ],
                |row| Ok(decode_session(row)),
            )
            .optional()?
            .transpose()
        })
        .await
    }

    /// Mark an unrevoked session revoked; an already revoked one is untouched.
    pub(super) async fn revoke_session(
        &self,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, StoreError> {
        let session_id = session_id.to_owned();
        self.run(move |conn| {
            let changed = conn.execute(
                "UPDATE auth_sessions SET revoked_at_ms = ?2 \
                 WHERE id = ?1 AND revoked_at_ms IS NULL",
                params![session_id, now.timestamp_millis()],
            )?;
            Ok(changed == 1)
        })
        .await
    }

    /// Revoke every unrevoked session of a user; returns the affected count.
    pub(super) async fn revoke_user_sessions(
        &self,
        username: &str,
        now: DateTime<Utc>,
    ) -> Result<u64, StoreError> {
        let username = username.to_owned();
        self.run(move |conn| {
            let changed = conn.execute(
                "UPDATE auth_sessions SET revoked_at_ms = ?2 \
                 WHERE username = ?1 AND revoked_at_ms IS NULL",
                params![username, now.timestamp_millis()],
            )?;
            Ok(changed as u64)
        })
        .await
    }
}

/// Delete up to [`PRUNE_BATCH`] rows whose expiry is at or before `as_of_ms`,
/// oldest first, using the `expires_at_ms` index. `table` is a compile-time
/// constant from this module, never caller input.
fn prune_expired(
    tx: &rusqlite::Transaction<'_>,
    table: &'static str,
    as_of_ms: i64,
) -> Result<(), StoreError> {
    tx.execute(
        &format!(
            "DELETE FROM {table} WHERE id IN ( \
                 SELECT id FROM {table} WHERE expires_at_ms <= ?1 \
                 ORDER BY expires_at_ms LIMIT ?2)"
        ),
        params![as_of_ms, PRUNE_BATCH],
    )?;
    Ok(())
}

/// True only for a UNIQUE violation on `auth_users.username`, so a primary-key
/// (id) collision or any other constraint failure is never a username conflict.
fn is_username_conflict(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, Some(message))
            if failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                && message.contains("auth_users.username")
    )
}

/// Run blocking database work off the async executor.
async fn blocking<T, F>(work: F) -> Result<T, StoreError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, StoreError> + Send + 'static,
{
    tokio::task::spawn_blocking(work).await.map_err(|error| {
        StoreError::Unavailable(format!("authentication database task failed: {error}"))
    })?
}
