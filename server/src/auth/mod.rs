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

/// Primary authentication and session management service.
#[derive(Clone)]
pub struct AuthService {
    store: Option<AuthStore>,
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
            mfa_key,
            clock,
        }
    }

    pub fn with_system_clock(store: Option<AuthStore>, mfa_key: Option<MfaEncryptionKey>) -> Self {
        Self::new(store, mfa_key, Arc::new(SystemClock))
    }

    pub fn store(&self) -> Option<&AuthStore> {
        self.store.as_ref()
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
        let Some(store) = &self.store else {
            return AuthDecision::Unavailable {
                reason: "Database not configured".into(),
            };
        };

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
    }
}
