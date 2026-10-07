//! Shared authentication store facade.
//!
//! `AuthService` and API handlers talk only to `AuthStore`; backend adapters
//! stay private to this module tree. Test qualification hooks fire once here,
//! never per adapter.
mod mongo;

use chrono::{DateTime, Utc};
use mongodb::Database;
use thiserror::Error;

use self::mongo::MongoAuthStore;
use super::model::{AuthChallenge, AuthSession, ChallengePurpose, MfaConfirmed, UserRecord};

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("MongoDB operation failed: {0}")]
    Mongo(#[from] mongodb::error::Error),
    #[error("BSON serialization/deserialization failed: {0}")]
    Bson(#[from] mongodb::bson::ser::Error),
    #[error("Duplicate username constraint violation detected: {0}")]
    DuplicateUsername(String),
    #[error("State inconsistency: {0}")]
    InconsistentState(String),
}

/// Selected-backend dispatch. Private so adapters are never a handler option.
#[derive(Clone)]
enum Backend {
    Mongo(MongoAuthStore),
}

/// Authentication store; every operation dispatches to the selected backend.
#[derive(Clone)]
pub struct AuthStore {
    backend: Backend,
}

impl AuthStore {
    /// Store backed by a MongoDB database.
    pub fn from_mongo(db: Database) -> Self {
        Self {
            backend: Backend::Mongo(MongoAuthStore::new(db)),
        }
    }

    /// Initialize backend schema/indexes.
    pub async fn init_indexes(&self) -> Result<(), StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.init_indexes().await,
        }
    }

    /// Insert a new user (never an upsert). Username conflicts surface as
    /// `StoreError::DuplicateUsername`; any other failure is a storage error.
    pub async fn create_user(&self, user: UserRecord) -> Result<(), StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.create_user(user).await,
        }
    }

    /// Retrieve user by username.
    pub async fn get_user(&self, username: &str) -> Result<Option<UserRecord>, StoreError> {
        #[cfg(test)]
        crate::system::resource_stream::qual_hook::record_auth("get_user", username);
        match &self.backend {
            Backend::Mongo(store) => store.get_user(username).await,
        }
    }

    /// Atomically confirm MFA enrollment via Compare-And-Swap (CAS).
    ///
    /// Requires that:
    /// - The user exists and has matching `authVersion`
    /// - `mfa` is currently null/missing (factor cannot be overwritten without recovery reset)
    pub async fn confirm_enrollment(
        &self,
        username: &str,
        expected_auth_version: i64,
        mfa: MfaConfirmed,
    ) -> Result<bool, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => {
                store
                    .confirm_enrollment(username, expected_auth_version, mfa)
                    .await
            }
        }
    }

    /// Advance `lastAcceptedStep` on user document via Compare-And-Swap (CAS).
    ///
    /// Requires that:
    /// - The user exists and has matching `authVersion`
    /// - `lastAcceptedStep` is strictly less than `matched_step` (monotonicity)
    pub async fn advance_totp_step(
        &self,
        username: &str,
        expected_auth_version: i64,
        matched_step: i64,
    ) -> Result<bool, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => {
                store
                    .advance_totp_step(username, expected_auth_version, matched_step)
                    .await
            }
        }
    }

    /// Record a failed MFA verification attempt on the account document.
    ///
    /// Applies 10-attempt / 10-minute window limit and sets the cooldown.
    pub async fn record_failed_attempt(
        &self,
        username: &str,
        now: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.record_failed_attempt(username, now).await,
        }
    }

    /// Reset account failure tracking after successful verification.
    pub async fn clear_failed_attempts(&self, username: &str) -> Result<(), StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.clear_failed_attempts(username).await,
        }
    }

    /// Insert a newly issued challenge.
    pub async fn create_challenge(&self, challenge: AuthChallenge) -> Result<(), StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.create_challenge(challenge).await,
        }
    }

    /// Retrieve challenge by hex SHA-256 digest.
    pub async fn get_challenge(&self, digest: &str) -> Result<Option<AuthChallenge>, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.get_challenge(digest).await,
        }
    }

    /// Increment attempt counter on a challenge; missing challenge yields 0.
    pub async fn increment_challenge_attempt(&self, digest: &str) -> Result<u32, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.increment_challenge_attempt(digest).await,
        }
    }

    /// Atomically consume a challenge: matching purpose, unconsumed, unexpired.
    pub async fn consume_challenge(
        &self,
        digest: &str,
        expected_purpose: ChallengePurpose,
        now: DateTime<Utc>,
    ) -> Result<bool, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.consume_challenge(digest, expected_purpose, now).await,
        }
    }

    /// Store a newly created session.
    pub async fn create_session(&self, session: AuthSession) -> Result<(), StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.create_session(session).await,
        }
    }

    /// Retrieve session by session ID.
    pub async fn get_session(&self, session_id: &str) -> Result<Option<AuthSession>, StoreError> {
        #[cfg(test)]
        crate::system::resource_stream::qual_hook::record_auth("get_session", session_id);
        match &self.backend {
            Backend::Mongo(store) => store.get_session(session_id).await,
        }
    }

    /// Atomically bump `credentialVersion` and refresh `mfaVerifiedAt` on step-up.
    pub async fn advance_session_mfa(
        &self,
        session_id: &str,
        expected_credential_version: i64,
        now: DateTime<Utc>,
    ) -> Result<Option<AuthSession>, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => {
                store
                    .advance_session_mfa(session_id, expected_credential_version, now)
                    .await
            }
        }
    }

    /// Mark an active session as revoked.
    pub async fn revoke_session(
        &self,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.revoke_session(session_id, now).await,
        }
    }

    /// Revoke all active sessions for a user.
    pub async fn revoke_user_sessions(
        &self,
        username: &str,
        now: DateTime<Utc>,
    ) -> Result<u64, StoreError> {
        match &self.backend {
            Backend::Mongo(store) => store.revoke_user_sessions(username, now).await,
        }
    }
}
