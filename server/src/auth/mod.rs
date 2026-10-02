pub mod model;
pub mod policy;
pub mod secret;
pub mod store;
pub mod totp;

use std::sync::Arc;

use rand::RngCore;
use sha2::{Digest, Sha256};

pub use model::*;
pub use policy::*;
pub use secret::*;
pub use store::*;
pub use totp::*;

/// In-memory session and user record for non-MongoDB test harnesses.
#[derive(Clone, Debug)]
pub struct MockSessionRecord {
    pub user: UserRecord,
    pub session: AuthSession,
}

pub const MOCK_USER: &str = "test-user";
pub const MOCK_SESSION_ID: &str = "test-session";
pub const MOCK_EXPIRY_SECS: usize = 2_000_000_000;

/// Primary authentication and session management service.
#[derive(Clone)]
pub struct AuthService {
    store: Option<AuthStore>,
    mock_session: Option<Arc<MockSessionRecord>>,
    mfa_key: Option<MfaEncryptionKey>,
    clock: Arc<dyn Clock>,
}

impl AuthService {
    pub fn new(
        store: Option<AuthStore>,
        mfa_key: Option<MfaEncryptionKey>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            store,
            mock_session: None,
            mfa_key,
            clock,
        }
    }

    pub fn new_mock(user: UserRecord, session: AuthSession) -> Self {
        Self {
            store: None,
            mock_session: Some(Arc::new(MockSessionRecord { user, session })),
            mfa_key: None,
            clock: Arc::new(SystemClock),
        }
    }

    pub fn new_mock_default() -> (Self, AuthClaims) {
        let now = chrono::Utc::now();
        let exp_chrono = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
        let user = UserRecord {
            id: None,
            username: MOCK_USER.to_string(),
            password_hash: String::new(),
            is_enabled: true,
            role: UserRole::User,
            auth_version: 0,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        };
        let session = AuthSession {
            id: MOCK_SESSION_ID.to_string(),
            username: MOCK_USER.to_string(),
            auth_version: 0,
            credential_version: 0,
            issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(exp_chrono),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
        };
        let claims = AuthClaims {
            v: AUTH_PROTOCOL_VERSION,
            sub: MOCK_USER.to_string(),
            sid: MOCK_SESSION_ID.to_string(),
            auth_version: 0,
            credential_version: 0,
            iat: now.timestamp() as usize,
            exp: MOCK_EXPIRY_SECS,
        };
        (Self::new_mock(user, session), claims)
    }

    pub fn with_system_clock(store: Option<AuthStore>, mfa_key: Option<MfaEncryptionKey>) -> Self {
        Self::new(store, mfa_key, Arc::new(SystemClock))
    }

    pub fn store(&self) -> Option<&AuthStore> {
        self.store.as_ref()
    }

    pub fn mock_user(&self) -> Option<&UserRecord> {
        self.mock_session.as_ref().map(|m| &m.user)
    }
    pub fn mfa_key(&self) -> Option<&MfaEncryptionKey> {
        self.mfa_key.as_ref()
    }

    pub fn clock(&self) -> &dyn Clock {
        self.clock.as_ref()
    }

    /// Generate an opaque 32-byte random challenge token.
    /// Returns `(token_hex, sha256_digest_hex)`.
    /// The token is sent to the client; only the digest is stored in the database.
    pub fn generate_challenge_token() -> (String, String) {
        let mut raw = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut raw);
        let token_hex = hex::encode(raw);
        let digest = Sha256::digest(raw);
        let digest_hex = hex::encode(digest);
        (token_hex, digest_hex)
    }

    /// Compute SHA-256 hex digest of a client-supplied challenge token.
    pub fn digest_challenge_token(token_hex: &str) -> Result<String, hex::FromHexError> {
        let raw = hex::decode(token_hex.trim())?;
        let digest = Sha256::digest(raw);
        Ok(hex::encode(digest))
    }

    /// Evaluate access for an incoming request carrying verified claims.
    pub async fn evaluate_claims(&self, claims: &AuthClaims) -> AuthDecision {
        if let Some(store) = &self.store {
            let session = match store.get_session(&claims.sid).await {
                Ok(Some(s)) => s,
                Ok(None) => {
                    return AuthDecision::FullLoginRequired {
                        reason: "Session not found",
                    }
                }
                Err(e) => {
                    return AuthDecision::Unavailable {
                        reason: format!("Database session lookup failed: {e}"),
                    }
                }
            };

            let user = match store.get_user(&claims.sub).await {
                Ok(Some(u)) => u,
                Ok(None) => {
                    return AuthDecision::FullLoginRequired {
                        reason: "User not found",
                    }
                }
                Err(e) => {
                    return AuthDecision::Unavailable {
                        reason: format!("Database user lookup failed: {e}"),
                    }
                }
            };

            evaluate_session_policy(&session, &user, claims, self.clock.now())
        } else if let Some(mock) = &self.mock_session {
            if claims.sid != mock.session.id {
                return AuthDecision::FullLoginRequired {
                    reason: "Session not found",
                };
            }
            if claims.sub != mock.user.username {
                return AuthDecision::FullLoginRequired {
                    reason: "User not found",
                };
            }
            evaluate_session_policy(&mock.session, &mock.user, claims, self.clock.now())
        } else {
            AuthDecision::Unavailable {
                reason: "Database not configured".into(),
            }
        }
    }
}
