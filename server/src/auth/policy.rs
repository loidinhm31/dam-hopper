use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};

use super::model::{
    bson_to_chrono, AuthChallenge, AuthClaims, AuthDecision, AuthSession, ChallengePurpose,
    UserRecord,
};

/// Hard 30-day session lifetime (30 * 24 * 3600 seconds).
pub const SESSION_LIFETIME_SECS: i64 = 2_592_000;

/// Periodic 10-day MFA freshness window (10 * 24 * 3600 seconds).
pub const MFA_VALIDITY_SECS: i64 = 864_000;

/// Fixed 5-minute challenge lifetime (5 * 60 seconds).
pub const CHALLENGE_LIFETIME_SECS: i64 = 300;

/// Maximum verification attempts permitted for a single challenge.
pub const CHALLENGE_MAX_ATTEMPTS: u32 = 5;

/// Maximum failed MFA attempts across an account within the attempt window.
pub const ACCOUNT_MAX_FAILED_ATTEMPTS: u32 = 10;

/// Window duration for counting account failed MFA attempts (10 minutes).
pub const ACCOUNT_ATTEMPT_WINDOW_SECS: i64 = 600;

/// Cooldown lockout duration after hitting max failed attempts (10 minutes).
pub const ACCOUNT_COOLDOWN_SECS: i64 = 600;

/// Protocol version number.
pub const AUTH_PROTOCOL_VERSION: u32 = 2;

/// Injectable clock trait to enable deterministic time testing without sleeps.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}

/// Standard system clock using `Utc::now()`.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Mock clock for deterministic tests.
#[derive(Debug, Clone)]
pub struct MockClock {
    current_timestamp_millis: Arc<AtomicI64>,
}

impl MockClock {
    pub fn new(initial: DateTime<Utc>) -> Self {
        Self {
            current_timestamp_millis: Arc::new(AtomicI64::new(initial.timestamp_millis())),
        }
    }

    pub fn set(&self, time: DateTime<Utc>) {
        self.current_timestamp_millis
            .store(time.timestamp_millis(), Ordering::SeqCst);
    }

    pub fn advance(&self, duration: Duration) {
        self.current_timestamp_millis
            .fetch_add(duration.num_milliseconds(), Ordering::SeqCst);
    }
}

impl Clock for MockClock {
    fn now(&self) -> DateTime<Utc> {
        let millis = self.current_timestamp_millis.load(Ordering::SeqCst);
        DateTime::from_timestamp_millis(millis).unwrap_or_else(Utc::now)
    }
}

/// Pure calculation of session deadlines at creation time.
/// Returns `(expires_at, mfa_due_at)`.
pub fn compute_session_deadlines(issued_at: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    let expires_at = issued_at + Duration::seconds(SESSION_LIFETIME_SECS);
    let mfa_due_at = issued_at + Duration::seconds(MFA_VALIDITY_SECS);
    // mfa_due_at is clamped to expires_at
    let clamped_mfa_due_at = std::cmp::min(mfa_due_at, expires_at);
    (expires_at, clamped_mfa_due_at)
}

/// Pure calculation of MFA deadline after successful step-up or re-verification.
pub fn compute_mfa_due_at(mfa_verified_at: DateTime<Utc>, expires_at: DateTime<Utc>) -> DateTime<Utc> {
    let raw_due = mfa_verified_at + Duration::seconds(MFA_VALIDITY_SECS);
    std::cmp::min(raw_due, expires_at)
}

/// Pure evaluation of an active session against account state, claims, and current time.
pub fn evaluate_session_policy(
    session: &AuthSession,
    user: &UserRecord,
    claims: &AuthClaims,
    now: DateTime<Utc>,
) -> AuthDecision {
    // 1. Account must be enabled
    if !user.is_enabled {
        return AuthDecision::FullLoginRequired {
            reason: "Account is disabled or pending approval",
        };
    }

    // 2. Protocol version in claims must match
    if claims.v != AUTH_PROTOCOL_VERSION {
        return AuthDecision::FullLoginRequired {
            reason: "Unsupported auth protocol version",
        };
    }

    // 3. Subject and session ID must match
    if claims.sub != user.username || claims.sub != session.username || claims.sid != session.id {
        return AuthDecision::FullLoginRequired {
            reason: "Actor or session ID mismatch",
        };
    }

    // 4. authVersion must match between user, session, and claims (recovery reset invalidation)
    if session.auth_version != user.auth_version || claims.auth_version != user.auth_version {
        return AuthDecision::FullLoginRequired {
            reason: "Account authorization version mismatch (session invalidated)",
        };
    }

    // 5. credentialVersion must match between session and claims (old token invalidated on MFA step-up)
    if claims.credential_version != session.credential_version {
        return AuthDecision::FullLoginRequired {
            reason: "Session credential version superseded by periodic MFA rotation",
        };
    }

    // 6. Session must not have been explicitly revoked
    if session.revoked_at.is_some() {
        return AuthDecision::FullLoginRequired {
            reason: "Session was explicitly revoked or logged out",
        };
    }

    let expires_at = bson_to_chrono(session.expires_at);
    let mfa_verified_at = bson_to_chrono(session.mfa_verified_at);

    // 7. Claim and session document absolute-expiry agreement
    if claims.exp != expires_at.timestamp() as usize {
        return AuthDecision::FullLoginRequired {
            reason: "Token expiration does not match session document expiration",
        };
    }

    // 7. Hard 30-day absolute expiration check (zero grace period: now >= expires_at means expired)
    if now >= expires_at {
        return AuthDecision::FullLoginRequired {
            reason: "Session expired (30-day absolute lifetime reached)",
        };
    }

    // 8. 10-day periodic MFA freshness check
    let mfa_due_at = compute_mfa_due_at(mfa_verified_at, expires_at);
    if now >= mfa_due_at {
        return AuthDecision::MfaRequired {
            session: session.clone(),
            mfa_due_at,
        };
    }

    // 9. Fully authenticated
    AuthDecision::Authenticated {
        session: session.clone(),
        user: user.clone(),
    }
}

/// Evaluates if an account is currently rate-limited/throttled.
/// Returns `(is_throttled, retry_after_seconds)`.
pub fn check_account_throttle(user: &UserRecord, now: DateTime<Utc>) -> (bool, Option<i64>) {
    if let Some(blocked_until) = user.mfa_blocked_until {
        let blocked_until_chrono = bson_to_chrono(blocked_until);
        if now < blocked_until_chrono {
            let diff = blocked_until_chrono - now;
            return (true, Some(std::cmp::max(1, diff.num_seconds())));
        }
    }
    (false, None)
}

/// Validates whether a challenge can be attempted.
pub fn validate_challenge_readiness(
    challenge: &AuthChallenge,
    expected_purpose: ChallengePurpose,
    now: DateTime<Utc>,
) -> Result<(), &'static str> {
    if challenge.purpose != expected_purpose {
        return Err("Challenge purpose mismatch");
    }

    if challenge.consumed_at.is_some() {
        return Err("Challenge has already been consumed");
    }

    let expires_at = bson_to_chrono(challenge.expires_at);
    if now >= expires_at {
        return Err("Challenge has expired");
    }

    if challenge.attempts >= CHALLENGE_MAX_ATTEMPTS {
        return Err("Maximum verification attempts exceeded for this challenge");
    }

    Ok(())
}
