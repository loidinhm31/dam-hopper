use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use mongodb::bson::{doc, to_bson, Document};
use mongodb::options::{FindOneAndUpdateOptions, IndexOptions, ReturnDocument};
use mongodb::{Collection, Database, IndexModel};
use thiserror::Error;

use super::model::{
    bson_to_chrono, chrono_to_bson, AuthChallenge, AuthSession, ChallengePurpose, MfaConfirmed,
    UserRecord,
};
use super::policy::{
    ACCOUNT_ATTEMPT_WINDOW_SECS, ACCOUNT_COOLDOWN_SECS, ACCOUNT_MAX_FAILED_ATTEMPTS,
};

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

/// Authentication store backed by MongoDB.
#[derive(Clone)]
pub struct AuthStore {
    db: Database,
    users: Collection<UserRecord>,
    sessions: Collection<AuthSession>,
    challenges: Collection<AuthChallenge>,
}

impl AuthStore {
    pub fn new(db: Database) -> Self {
        let users = db.collection::<UserRecord>("users");
        let sessions = db.collection::<AuthSession>("authSessions");
        let challenges = db.collection::<AuthChallenge>("authChallenges");
        Self {
            db,
            users,
            sessions,
            challenges,
        }
    }

    pub fn database(&self) -> &Database {
        &self.db
    }

    /// Initialize required indexes for auth collections.
    ///
    /// - Checks for duplicate usernames before creating unique index on `users.username`.
    /// - Creates lookup and TTL indexes on `authSessions` (`expiresAt`).
    /// - Creates lookup and TTL indexes on `authChallenges` (`expiresAt`).
    pub async fn init_indexes(&self) -> Result<(), StoreError> {
        // 1. Audit username duplicates in users collection before adding unique index
        let pipeline: Vec<Document> = vec![
            doc! { "$group": { "_id": "$username", "count": { "$sum": 1 } } },
            doc! { "$match": { "count": { "$gt": 1 } } },
        ];
        let mut cursor = self
            .db
            .collection::<Document>("users")
            .aggregate(pipeline)
            .await?;
        if cursor.advance().await? {
            let doc = cursor.deserialize_current()?;
            let dupe = doc
                .get_str("_id")
                .unwrap_or("unknown")
                .to_string();
            return Err(StoreError::DuplicateUsername(format!(
                "Cannot create unique index on users: duplicate username detected for '{dupe}'"
            )));
        }

        // Unique index on users.username
        let user_index = IndexModel::builder()
            .keys(doc! { "username": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build();
        let _ = self.users.create_index(user_index).await;

        // Indexes for authSessions: username lookup + TTL on expiresAt
        let session_user_index = IndexModel::builder()
            .keys(doc! { "username": 1 })
            .build();
        let _ = self.sessions.create_index(session_user_index).await;

        let session_ttl_index = IndexModel::builder()
            .keys(doc! { "expiresAt": 1 })
            .options(
                IndexOptions::builder()
                    .expire_after(Duration::from_secs(0))
                    .build(),
            )
            .build();
        let _ = self.sessions.create_index(session_ttl_index).await;

        // Indexes for authChallenges: username lookup + TTL on expiresAt
        let challenge_user_index = IndexModel::builder()
            .keys(doc! { "username": 1 })
            .build();
        let _ = self.challenges.create_index(challenge_user_index).await;

        let challenge_ttl_index = IndexModel::builder()
            .keys(doc! { "expiresAt": 1 })
            .options(
                IndexOptions::builder()
                    .expire_after(Duration::from_secs(0))
                    .build(),
            )
            .build();
        let _ = self.challenges.create_index(challenge_ttl_index).await;

        Ok(())
    }

    /// Retrieve user by username.
    pub async fn get_user(&self, username: &str) -> Result<Option<UserRecord>, StoreError> {
        let user = self
            .users
            .find_one(doc! { "username": username })
            .await?;
        Ok(user)
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
        let auth_version_clause = if expected_auth_version == 0 {
            doc! {
                "$or": [
                    { "authVersion": 0 },
                    { "authVersion": { "$exists": false } },
                    { "authVersion": { "$eq": null } },
                ]
            }
        } else {
            doc! { "authVersion": expected_auth_version }
        };
        let filter = doc! {
            "username": username,
            "$and": [
                auth_version_clause,
                doc! {
                    "$or": [
                        { "mfa": { "$eq": null } },
                        { "mfa": { "$exists": false } }
                    ]
                }
            ]
        };
        let mfa_bson = to_bson(&mfa)?;
        let update = doc! {
            "$set": {
                "mfa": mfa_bson,
                "authVersion": expected_auth_version,
            }
        };
        let res = self.users.update_one(filter, update).await?;
        Ok(res.modified_count == 1)
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
        let auth_version_clause = if expected_auth_version == 0 {
            doc! {
                "$or": [
                    { "authVersion": 0 },
                    { "authVersion": { "$exists": false } },
                    { "authVersion": { "$eq": null } },
                ]
            }
        } else {
            doc! { "authVersion": expected_auth_version }
        };
        let filter = doc! {
            "username": username,
            "$and": [
                auth_version_clause,
                doc! {
                    "$or": [
                        { "mfa.lastAcceptedStep": { "$lt": matched_step } },
                        { "mfa.lastAcceptedStep": { "$exists": false } }
                    ]
                }
            ]
        };
        let update = doc! {
            "$set": {
                "mfa.lastAcceptedStep": matched_step,
                "authVersion": expected_auth_version,
            }
        };
        let res = self.users.update_one(filter, update).await?;
        Ok(res.modified_count == 1)
    }

    /// Record a failed MFA verification attempt on the account document.
    ///
    /// Applies 10-attempt / 10-minute window limit and sets `mfaBlockedUntil` cooldown.
    pub async fn record_failed_attempt(
        &self,
        username: &str,
        now: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        let user = self.get_user(username).await?;
        let Some(user) = user else {
            return Ok(());
        };

        let now_bson = chrono_to_bson(now);
        let window_start = user.mfa_attempt_window_started_at.map(bson_to_chrono);

        let is_new_window = match window_start {
            Some(start) => (now - start) >= ChronoDuration::seconds(ACCOUNT_ATTEMPT_WINDOW_SECS),
            None => true,
        };

        if is_new_window {
            let update = doc! {
                "$set": {
                    "mfaAttemptWindowStartedAt": now_bson,
                    "mfaAttemptCount": 1
                },
                "$unset": { "mfaBlockedUntil": "" }
            };
            self.users
                .update_one(doc! { "username": username }, update)
                .await?;
        } else {
            let new_count = user.mfa_attempt_count + 1;
            let mut set_doc = doc! { "mfaAttemptCount": new_count };
            if new_count >= ACCOUNT_MAX_FAILED_ATTEMPTS {
                let blocked_until = now + ChronoDuration::seconds(ACCOUNT_COOLDOWN_SECS);
                set_doc.insert("mfaBlockedUntil", chrono_to_bson(blocked_until));
            }
            let update = doc! { "$set": set_doc };
            self.users
                .update_one(doc! { "username": username }, update)
                .await?;
        }

        Ok(())
    }

    /// Reset account failure tracking after successful verification.
    pub async fn clear_failed_attempts(&self, username: &str) -> Result<(), StoreError> {
        let update = doc! {
            "$unset": {
                "mfaAttemptWindowStartedAt": "",
                "mfaAttemptCount": "",
                "mfaBlockedUntil": ""
            }
        };
        self.users
            .update_one(doc! { "username": username }, update)
            .await?;
        Ok(())
    }

    /// Insert a newly issued challenge.
    pub async fn create_challenge(&self, challenge: AuthChallenge) -> Result<(), StoreError> {
        self.challenges.insert_one(challenge).await?;
        Ok(())
    }

    /// Retrieve challenge by hex SHA-256 digest.
    pub async fn get_challenge(&self, digest: &str) -> Result<Option<AuthChallenge>, StoreError> {
        let challenge = self
            .challenges
            .find_one(doc! { "_id": digest })
            .await?;
        Ok(challenge)
    }

    /// Increment attempt counter on challenge document.
    pub async fn increment_challenge_attempt(&self, digest: &str) -> Result<u32, StoreError> {
        let res = self
            .challenges
            .find_one_and_update(
                doc! { "_id": digest },
                doc! { "$inc": { "attempts": 1 } },
            )
            .with_options(
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await?;
        Ok(res.map(|c| c.attempts).unwrap_or(0))
    }

    /// Atomically consume challenge via CAS.
    ///
    /// Requires that:
    /// - `_id` matches
    /// - `purpose` matches
    /// - `consumedAt` is null
    /// - `expiresAt > now`
    pub async fn consume_challenge(
        &self,
        digest: &str,
        expected_purpose: ChallengePurpose,
        now: DateTime<Utc>,
    ) -> Result<bool, StoreError> {
        let purpose_bson = to_bson(&expected_purpose)?;
        let filter = doc! {
            "_id": digest,
            "purpose": purpose_bson,
            "consumedAt": { "$eq": null },
            "expiresAt": { "$gt": chrono_to_bson(now) }
        };
        let update = doc! {
            "$set": { "consumedAt": chrono_to_bson(now) }
        };
        let res = self.challenges.update_one(filter, update).await?;
        Ok(res.modified_count == 1)
    }

    /// Store a newly created session.
    pub async fn create_session(&self, session: AuthSession) -> Result<(), StoreError> {
        self.sessions.insert_one(session).await?;
        Ok(())
    }

    /// Retrieve session by session ID.
    pub async fn get_session(&self, session_id: &str) -> Result<Option<AuthSession>, StoreError> {
        let session = self
            .sessions
            .find_one(doc! { "_id": session_id })
            .await?;
        Ok(session)
    }

    /// Atomically increment `credentialVersion` and refresh `mfaVerifiedAt` on session step-up.
    ///
    /// Requires that:
    /// - `_id` matches
    /// - `credentialVersion` matches expected version
    /// - Session is not revoked
    /// - Session is not expired
    pub async fn advance_session_mfa(
        &self,
        session_id: &str,
        expected_credential_version: i64,
        now: DateTime<Utc>,
    ) -> Result<Option<AuthSession>, StoreError> {
        let filter = doc! {
            "_id": session_id,
            "credentialVersion": expected_credential_version,
            "revokedAt": { "$eq": null },
            "expiresAt": { "$gt": chrono_to_bson(now) }
        };
        let update = doc! {
            "$inc": { "credentialVersion": 1 },
            "$set": { "mfaVerifiedAt": chrono_to_bson(now) }
        };
        let session = self
            .sessions
            .find_one_and_update(filter, update)
            .with_options(
                FindOneAndUpdateOptions::builder()
                    .return_document(ReturnDocument::After)
                    .build(),
            )
            .await?;
        Ok(session)
    }

    /// Mark an active session as revoked.
    pub async fn revoke_session(
        &self,
        session_id: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, StoreError> {
        let filter = doc! {
            "_id": session_id,
            "revokedAt": { "$eq": null }
        };
        let update = doc! {
            "$set": { "revokedAt": chrono_to_bson(now) }
        };
        let res = self.sessions.update_one(filter, update).await?;
        Ok(res.modified_count == 1)
    }

    /// Revoke all active sessions for a user (used on password change or user logout-all).
    pub async fn revoke_user_sessions(
        &self,
        username: &str,
        now: DateTime<Utc>,
    ) -> Result<u64, StoreError> {
        let filter = doc! {
            "username": username,
            "revokedAt": { "$eq": null }
        };
        let update = doc! {
            "$set": { "revokedAt": chrono_to_bson(now) }
        };
        let res = self.sessions.update_many(filter, update).await?;
        Ok(res.modified_count)
    }
}
