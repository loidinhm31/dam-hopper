use chrono::{DateTime, Utc};
use mongodb::bson::oid::ObjectId;
use mongodb::bson::DateTime as BsonDateTime;
use serde::{Deserialize, Serialize};

/// Role assigned to a user account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    #[default]
    User,
    Admin,
}

/// Confirmed MFA factor state stored in the user document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaConfirmed {
    /// Base64-encoded AES-256-GCM ciphertext of the 20-byte TOTP secret.
    pub secret_ciphertext: String,
    /// Base64-encoded 12-byte nonce used during encryption.
    pub nonce: String,
    /// Identifier of the encryption key used (matches key envelope).
    pub key_id: String,
    /// UTC timestamp when enrollment was confirmed.
    pub enrolled_at: BsonDateTime,
    /// Greatest TOTP timestep accepted so far. Fences replay attacks.
    pub last_accepted_step: i64,
}

/// Full user document stored in MongoDB `users` collection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRecord {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    pub id: Option<ObjectId>,
    pub username: String,
    pub password_hash: String,
    pub is_enabled: bool,
    #[serde(default)]
    pub role: UserRole,
    /// Monotonically incremented on account recovery/reset. Missing in legacy documents -> 0.
    #[serde(default)]
    pub auth_version: i64,
    /// Confirmed MFA enrollment; `None` indicates enrollment is required.
    #[serde(default)]
    pub mfa: Option<MfaConfirmed>,
    /// Start of current rolling 10-minute failed attempt window.
    #[serde(default)]
    pub mfa_attempt_window_started_at: Option<BsonDateTime>,
    /// Number of failed MFA attempts within the current window.
    #[serde(default)]
    pub mfa_attempt_count: u32,
    /// Blocked until this UTC timestamp if cooldown is active.
    #[serde(default)]
    pub mfa_blocked_until: Option<BsonDateTime>,
}

/// Active session stored in MongoDB `authSessions` collection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    /// Random opaque session identifier (UUID v4 or CSPRNG string).
    #[serde(rename = "_id")]
    pub id: String,
    /// Username / account identity bound to this session.
    pub username: String,
    /// User authVersion at session creation time; must match user document.
    pub auth_version: i64,
    /// Incremented on each periodic MFA re-verification (step-up). Old JWTs invalid.
    pub credential_version: i64,
    /// UTC instant when full password+MFA session was created.
    pub issued_at: BsonDateTime,
    /// Hard 30-day absolute expiration: `issued_at + 2,592,000s`.
    pub expires_at: BsonDateTime,
    /// UTC instant of most recent successful MFA verification for this session.
    pub mfa_verified_at: BsonDateTime,
    /// UTC instant when this session was explicitly revoked/logged out.
    #[serde(default)]
    pub revoked_at: Option<BsonDateTime>,
}

/// Purpose for which an authentication challenge was issued.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChallengePurpose {
    /// Enrolling first MFA factor for an enabled user after password check.
    Enroll,
    /// Standard MFA check after password verification for an enrolled user.
    LoginMfa,
    /// Periodic 10-day step-up check for an existing active session.
    StepUp,
}

/// Challenge document stored in MongoDB `authChallenges` collection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthChallenge {
    /// Hex SHA-256 digest of the client-facing opaque challenge token.
    #[serde(rename = "_id")]
    pub id: String,
    /// Username bound to this challenge.
    pub username: String,
    /// authVersion of the user when challenge was issued.
    pub auth_version: i64,
    /// Purpose of this challenge.
    pub purpose: ChallengePurpose,
    /// UTC instant when challenge was created.
    pub created_at: BsonDateTime,
    /// Fixed 5-minute expiration: `created_at + 300s`.
    pub expires_at: BsonDateTime,
    /// Number of code verification attempts against this challenge (max 5).
    #[serde(default)]
    pub attempts: u32,
    /// UTC instant when this challenge was consumed; `None` if pending.
    #[serde(default)]
    pub consumed_at: Option<BsonDateTime>,
    /// Pending encrypted secret ciphertext (Enroll purpose only).
    #[serde(default)]
    pub pending_secret_ciphertext: Option<String>,
    /// Nonce for pending encrypted secret (Enroll purpose only).
    #[serde(default)]
    pub pending_secret_nonce: Option<String>,
    /// Key ID for pending encrypted secret (Enroll purpose only).
    #[serde(default)]
    pub pending_secret_key_id: Option<String>,
    /// Bound session ID (StepUp purpose only).
    #[serde(default)]
    pub session_id: Option<String>,
    /// Bound credentialVersion (StepUp purpose only).
    #[serde(default)]
    pub credential_version: Option<i64>,
}

/// Strict V2 JWT claims layout (`v: 2`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthClaims {
    /// Protocol version, pinned to 2.
    pub v: u32,
    /// Subject (username).
    pub sub: String,
    /// Session identifier matching an active `authSessions` document.
    pub sid: String,
    /// User authVersion at issuance.
    #[serde(rename = "authVersion")]
    pub auth_version: i64,
    /// Session credentialVersion at issuance.
    #[serde(rename = "credentialVersion")]
    pub credential_version: i64,
    /// Issued at (Unix seconds).
    pub iat: usize,
    /// Expiration (Unix seconds, matching session `expires_at`).
    pub exp: usize,
}

/// Decision returned by the pure policy evaluator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthDecision {
    /// Full access allowed.
    Authenticated {
        session: AuthSession,
        user: UserRecord,
    },
    /// Session is valid but 10-day MFA freshness has lapsed. Restricted step-up only.
    MfaRequired {
        session: AuthSession,
        mfa_due_at: DateTime<Utc>,
    },
    /// Session is expired, revoked, or account is disabled/reset. Full password login required.
    FullLoginRequired {
        reason: &'static str,
    },
    /// Database or cryptography service unavailable.
    Unavailable {
        reason: String,
    },
}

/// Helper converting `mongodb::bson::DateTime` to `chrono::DateTime<Utc>`.
pub fn bson_to_chrono(dt: BsonDateTime) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(dt.timestamp_millis()).unwrap_or_else(Utc::now)
}

/// Helper converting `chrono::DateTime<Utc>` to `mongodb::bson::DateTime`.
pub fn chrono_to_bson(dt: DateTime<Utc>) -> BsonDateTime {
    BsonDateTime::from_millis(dt.timestamp_millis())
}
