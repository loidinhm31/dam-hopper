//! MongoDB adapter for the shared authentication store.
//!
//! Owns collection names, index setup, and BSON query predicates. Reached only
//! through the `AuthStore` facade; hooks/policy live outside this module.
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use mongodb::bson::oid::ObjectId;
use mongodb::bson::{doc, to_bson, Document};
use mongodb::error::{ErrorKind, WriteFailure};
use mongodb::options::{FindOneAndUpdateOptions, IndexOptions, ReturnDocument};
use mongodb::{Collection, Database, IndexModel};

use super::StoreError;
use crate::auth::model::{
    bson_to_chrono, chrono_to_bson, AuthChallenge, AuthSession, ChallengePurpose, MfaConfirmed,
    UserRecord,
};
use crate::auth::policy::{
    ACCOUNT_ATTEMPT_WINDOW_SECS, ACCOUNT_COOLDOWN_SECS, ACCOUNT_MAX_FAILED_ATTEMPTS,
};

/// MongoDB duplicate-key write error code.
const DUPLICATE_KEY_CODE: i32 = 11000;
/// Default index name for the unique `users.username` index.
const USERNAME_INDEX_NAME: &str = "username_1";

/// Authentication store backed by MongoDB collections.
#[derive(Clone)]
pub(super) struct MongoAuthStore {
    db: Database,
    users: Collection<UserRecord>,
    sessions: Collection<AuthSession>,
    challenges: Collection<AuthChallenge>,
}

impl MongoAuthStore {
    pub(super) fn new(db: Database) -> Self {
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

    /// Insert a new user. Plain INSERT: never overwrites an existing account.
    ///
    /// Generates the immutable `_id` when absent. A username conflict maps to
    /// `DuplicateUsername`; any other write failure stays a storage error.
    pub async fn create_user(&self, mut user: UserRecord) -> Result<(), StoreError> {
        // Precheck keeps the conflict outcome when the unique index is absent
        // (index setup is best-effort); the index decides concurrent races.
        if self.get_user(&user.username).await?.is_some() {
            return Err(duplicate_username(&user.username));
        }
        if user.id.is_none() {
            user.id = Some(ObjectId::new());
        }
        let username = user.username.clone();
        match self.users.insert_one(user).await {
            Ok(_) => Ok(()),
            Err(error) if is_username_conflict(&error) => Err(duplicate_username(&username)),
            Err(error) => Err(error.into()),
        }
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

fn duplicate_username(username: &str) -> StoreError {
    StoreError::DuplicateUsername(format!("username '{username}' already exists"))
}

/// True only for a duplicate-key failure raised by the unique username index,
/// so an `_id` collision, an unrelated unique index, or any other write error
/// is never reported as a username conflict.
fn is_username_conflict(error: &mongodb::error::Error) -> bool {
    matches!(
        &*error.kind,
        ErrorKind::Write(WriteFailure::WriteError(write_error))
            if write_error.code == DUPLICATE_KEY_CODE
                && duplicate_key_index(&write_error.message) == Some(USERNAME_INDEX_NAME)
    )
}

/// Extract the failing index name from a server duplicate-key message
/// (`... collection: db.coll index: <name> dup key: { ... }`). The driver
/// exposes no structured key metadata, so the first ` index: ` boundary is
/// parsed; the offending key value only appears after ` dup key`, so user
/// input cannot spoof the name. `None` when the shape is not recognised.
fn duplicate_key_index(message: &str) -> Option<&str> {
    let (_, rest) = message.split_once(" index: ")?;
    rest.split_once(" dup key").map(|(name, _)| name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real server errors for each duplicate-key source, classified without
    /// the `create_user` precheck short-circuiting the insert path.
    #[tokio::test]
    async fn classifies_only_username_index_violations() {
        let uri = std::env::var("TEST_MONGODB_URI")
            .unwrap_or_else(|_| "mongodb://127.0.0.1:27018".to_string());
        let Ok(client) = mongodb::Client::with_uri_str(&uri).await else {
            eprintln!("Skipping MongoDB unit test: cannot connect to {uri}");
            return;
        };
        let db = client.database(&format!("test_auth_{}", uuid::Uuid::new_v4().simple()));
        if db.run_command(doc! { "ping": 1 }).await.is_err() {
            eprintln!("Skipping MongoDB unit test: ping failed on {uri}");
            return;
        }
        let users = db.collection::<Document>("users");
        users
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "username": 1 })
                    .options(IndexOptions::builder().unique(true).build())
                    .build(),
            )
            .await
            .unwrap();
        users
            .create_index(
                IndexModel::builder()
                    .keys(doc! { "authVersion": 1 })
                    .options(
                        IndexOptions::builder()
                            .unique(true)
                            .name("other_username_1".to_string())
                            .build(),
                    )
                    .build(),
            )
            .await
            .unwrap();
        let id = ObjectId::new();
        users
            .insert_one(doc! { "_id": id, "username": "alice x index: username_1", "authVersion": 1 })
            .await
            .unwrap();

        let username_dup = users
            .insert_one(doc! { "username": "alice x index: username_1", "authVersion": 2 })
            .await
            .unwrap_err();
        let unrelated_index_dup = users
            .insert_one(doc! { "username": "bob", "authVersion": 1 })
            .await
            .unwrap_err();
        let id_dup = users
            .insert_one(doc! { "_id": id, "username": "carol", "authVersion": 3 })
            .await
            .unwrap_err();

        assert!(is_username_conflict(&username_dup), "{username_dup:?}");
        assert!(
            !is_username_conflict(&unrelated_index_dup),
            "{unrelated_index_dup:?}"
        );
        assert!(!is_username_conflict(&id_dup), "{id_dup:?}");
        let _ = db.drop().await;
    }

    #[test]
    fn index_name_is_parsed_at_the_structural_boundary() {
        assert_eq!(
            duplicate_key_index(
                "E11000 duplicate key error collection: d.users index: username_1 dup key: { username: \"x index: other dup key\" }"
            ),
            Some("username_1")
        );
        assert_eq!(duplicate_key_index("write failed: something else"), None);
    }
}
