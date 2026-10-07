//! Row <-> record mapping for the SQLite adapter.
//!
//! Decoding is checked: an out-of-range counter, unknown role/purpose, partial
//! MFA factor, or malformed ObjectId yields `StoreError::InconsistentState`
//! instead of a fabricated record, so a corrupt row denies access.
use mongodb::bson::oid::ObjectId;
use mongodb::bson::DateTime as BsonDateTime;
use rusqlite::Row;

use crate::auth::model::{
    AuthChallenge, AuthSession, ChallengePurpose, MfaConfirmed, UserRecord, UserRole,
};
use crate::auth::store::StoreError;

pub(super) const USER_COLUMNS: &str = "id, username, password_hash, is_enabled, role, \
     auth_version, mfa_secret_ciphertext, mfa_nonce, mfa_key_id, mfa_enrolled_at_ms, \
     mfa_last_accepted_step, mfa_attempt_window_started_at_ms, mfa_attempt_count, \
     mfa_blocked_until_ms";

pub(super) const SESSION_COLUMNS: &str = "id, username, auth_version, credential_version, \
     issued_at_ms, expires_at_ms, mfa_verified_at_ms, revoked_at_ms";

pub(super) const CHALLENGE_COLUMNS: &str = "id, username, auth_version, purpose, created_at_ms, \
     expires_at_ms, attempts, consumed_at_ms, pending_secret_ciphertext, pending_secret_nonce, \
     pending_secret_key_id, session_id, credential_version";

fn inconsistent(detail: impl std::fmt::Display) -> StoreError {
    StoreError::InconsistentState(format!("corrupt authentication row: {detail}"))
}

pub(super) fn to_ms(value: BsonDateTime) -> i64 {
    value.timestamp_millis()
}

fn from_ms(value: i64) -> BsonDateTime {
    BsonDateTime::from_millis(value)
}

pub(super) fn role_to_sql(role: UserRole) -> &'static str {
    match role {
        UserRole::User => "user",
        UserRole::Admin => "admin",
    }
}

fn role_from_sql(value: &str) -> Result<UserRole, StoreError> {
    match value {
        "user" => Ok(UserRole::User),
        "admin" => Ok(UserRole::Admin),
        other => Err(inconsistent(format_args!("unknown role '{other}'"))),
    }
}

pub(super) fn purpose_to_sql(purpose: ChallengePurpose) -> &'static str {
    match purpose {
        ChallengePurpose::Enroll => "enroll",
        ChallengePurpose::LoginMfa => "loginMfa",
        ChallengePurpose::StepUp => "stepUp",
    }
}

fn purpose_from_sql(value: &str) -> Result<ChallengePurpose, StoreError> {
    match value {
        "enroll" => Ok(ChallengePurpose::Enroll),
        "loginMfa" => Ok(ChallengePurpose::LoginMfa),
        "stepUp" => Ok(ChallengePurpose::StepUp),
        other => Err(inconsistent(format_args!(
            "unknown challenge purpose '{other}'"
        ))),
    }
}

fn counter(value: i64, column: &str) -> Result<u32, StoreError> {
    u32::try_from(value).map_err(|_| inconsistent(format_args!("{column} out of range")))
}

/// Decode a row selected with [`USER_COLUMNS`].
pub(super) fn decode_user(row: &Row<'_>) -> Result<UserRecord, StoreError> {
    let id: String = row.get("id")?;
    let id = ObjectId::parse_str(&id).map_err(|_| inconsistent("user id is not an ObjectId"))?;
    let enabled: i64 = row.get("is_enabled")?;
    let is_enabled = match enabled {
        0 => false,
        1 => true,
        _ => return Err(inconsistent("is_enabled is not boolean")),
    };
    let role: String = row.get("role")?;

    let ciphertext: Option<String> = row.get("mfa_secret_ciphertext")?;
    let nonce: Option<String> = row.get("mfa_nonce")?;
    let key_id: Option<String> = row.get("mfa_key_id")?;
    let enrolled_at: Option<i64> = row.get("mfa_enrolled_at_ms")?;
    let last_step: Option<i64> = row.get("mfa_last_accepted_step")?;
    let mfa = match (ciphertext, nonce, key_id, enrolled_at, last_step) {
        (None, None, None, None, None) => None,
        (Some(secret_ciphertext), Some(nonce), Some(key_id), Some(enrolled_at), Some(step)) => {
            Some(MfaConfirmed {
                secret_ciphertext,
                nonce,
                key_id,
                enrolled_at: from_ms(enrolled_at),
                last_accepted_step: step,
            })
        }
        _ => return Err(inconsistent("partial MFA factor")),
    };

    let window_started: Option<i64> = row.get("mfa_attempt_window_started_at_ms")?;
    let attempt_count: i64 = row.get("mfa_attempt_count")?;
    let blocked_until: Option<i64> = row.get("mfa_blocked_until_ms")?;
    Ok(UserRecord {
        id: Some(id),
        username: row.get("username")?,
        password_hash: row.get("password_hash")?,
        is_enabled,
        role: role_from_sql(&role)?,
        auth_version: row.get("auth_version")?,
        mfa,
        mfa_attempt_window_started_at: window_started.map(from_ms),
        mfa_attempt_count: counter(attempt_count, "mfa_attempt_count")?,
        mfa_blocked_until: blocked_until.map(from_ms),
    })
}

/// Decode a row selected with [`SESSION_COLUMNS`].
pub(super) fn decode_session(row: &Row<'_>) -> Result<AuthSession, StoreError> {
    let revoked_at: Option<i64> = row.get("revoked_at_ms")?;
    Ok(AuthSession {
        id: row.get("id")?,
        username: row.get("username")?,
        auth_version: row.get("auth_version")?,
        credential_version: row.get("credential_version")?,
        issued_at: from_ms(row.get("issued_at_ms")?),
        expires_at: from_ms(row.get("expires_at_ms")?),
        mfa_verified_at: from_ms(row.get("mfa_verified_at_ms")?),
        revoked_at: revoked_at.map(from_ms),
    })
}

/// Decode a row selected with [`CHALLENGE_COLUMNS`].
pub(super) fn decode_challenge(row: &Row<'_>) -> Result<AuthChallenge, StoreError> {
    let purpose: String = row.get("purpose")?;
    let attempts: i64 = row.get("attempts")?;
    let consumed_at: Option<i64> = row.get("consumed_at_ms")?;
    Ok(AuthChallenge {
        id: row.get("id")?,
        username: row.get("username")?,
        auth_version: row.get("auth_version")?,
        purpose: purpose_from_sql(&purpose)?,
        created_at: from_ms(row.get("created_at_ms")?),
        expires_at: from_ms(row.get("expires_at_ms")?),
        attempts: counter(attempts, "attempts")?,
        consumed_at: consumed_at.map(from_ms),
        pending_secret_ciphertext: row.get("pending_secret_ciphertext")?,
        pending_secret_nonce: row.get("pending_secret_nonce")?,
        pending_secret_key_id: row.get("pending_secret_key_id")?,
        session_id: row.get("session_id")?,
        credential_version: row.get("credential_version")?,
    })
}
