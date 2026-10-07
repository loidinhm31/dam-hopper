use std::fs::File;
use std::io::Write;

use chrono::{Duration, Utc};
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::auth::model::*;
use dam_hopper_server::auth::policy::*;
use dam_hopper_server::auth::secret::*;
use dam_hopper_server::auth::totp::*;
use tempfile::tempdir;

#[test]
fn test_pure_timing_policy_decisions_with_mock_clock() {
    let base_time = Utc::now();
    let clock = MockClock::new(base_time);

    let (expires_at, mfa_due_at) = compute_session_deadlines(base_time);
    assert_eq!(
        (expires_at - base_time).num_seconds(),
        SESSION_LIFETIME_SECS,
        "Absolute expiry must be 30 days"
    );
    assert_eq!(
        (mfa_due_at - base_time).num_seconds(),
        MFA_VALIDITY_SECS,
        "Initial MFA validity must be 10 days"
    );

    let user = UserRecord {
        id: None,
        username: "alice".to_string(),
        password_hash: "$2b$12$...".to_string(),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: Some(MfaConfirmed {
            secret_ciphertext: "cipher".to_string(),
            nonce: "nonce".to_string(),
            key_id: "mfa-v1".to_string(),
            enrolled_at: chrono_to_bson(base_time),
            last_accepted_step: 100,
        }),
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };

    let session = AuthSession {
        id: "session-123".to_string(),
        username: "alice".to_string(),
        auth_version: 1,
        credential_version: 1,
        issued_at: chrono_to_bson(base_time),
        expires_at: chrono_to_bson(expires_at),
        mfa_verified_at: chrono_to_bson(base_time),
        revoked_at: None,
    };

    let claims = AuthClaims {
        v: 2,
        sub: "alice".to_string(),
        sid: "session-123".to_string(),
        auth_version: 1,
        credential_version: 1,
        iat: base_time.timestamp() as usize,
        exp: expires_at.timestamp() as usize,
    };

    // 1. Day 0 (Issuance): Fully authenticated
    let decision = evaluate_session_policy(&session, &user, &claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::Authenticated { .. }),
        "Day 0 must be Authenticated"
    );

    // 2. Day 9: Fully authenticated
    clock.advance(Duration::days(9));
    let decision = evaluate_session_policy(&session, &user, &claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::Authenticated { .. }),
        "Day 9 must be Authenticated"
    );

    // 3. Day 10 exactly (864,000s): MFA required (zero grace period!)
    clock.set(base_time + Duration::seconds(MFA_VALIDITY_SECS));
    let decision = evaluate_session_policy(&session, &user, &claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::MfaRequired { .. }),
        "Day 10 exact instant must trigger MfaRequired"
    );

    // 4. Day 15: User performs MFA step-up
    clock.set(base_time + Duration::days(15));
    let mut updated_session = session.clone();
    updated_session.credential_version = 2; // Incremented on step-up
    updated_session.mfa_verified_at = chrono_to_bson(clock.now());

    // Old token with credential_version=1 must be rejected
    let decision = evaluate_session_policy(&updated_session, &user, &claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::FullLoginRequired { .. }),
        "Old token with prior credentialVersion must be rejected immediately"
    );

    // New token with credential_version=2 is admitted
    let mut new_claims = claims.clone();
    new_claims.credential_version = 2;
    let decision = evaluate_session_policy(&updated_session, &user, &new_claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::Authenticated { .. }),
        "Updated token with matching credentialVersion must be Authenticated"
    );

    // 5. Day 25: 10 days after Day 15 step-up -> MFA required again
    clock.set(base_time + Duration::days(25));
    let decision = evaluate_session_policy(&updated_session, &user, &new_claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::MfaRequired { .. }),
        "Day 25 must trigger MfaRequired"
    );

    // 6. Day 29: Step-up performed at day 29
    clock.set(base_time + Duration::days(29));
    let mut day29_session = updated_session.clone();
    day29_session.credential_version = 3;
    day29_session.mfa_verified_at = chrono_to_bson(clock.now());
    let mut day29_claims = new_claims.clone();
    day29_claims.credential_version = 3;

    let decision = evaluate_session_policy(&day29_session, &user, &day29_claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::Authenticated { .. }),
        "Day 29 step-up must be Authenticated"
    );

    // 7. Day 30 exact instant (2,592,000s): 30-day absolute expiration wins over fresh MFA!
    clock.set(base_time + Duration::seconds(SESSION_LIFETIME_SECS));
    let decision = evaluate_session_policy(&day29_session, &user, &day29_claims, clock.now());
    assert!(
        matches!(decision, AuthDecision::FullLoginRequired { reason } if reason.contains("30-day absolute lifetime")),
        "Day 30 absolute expiration must force FullLoginRequired even after recent MFA"
    );

    // 8. Invalidation checks:
    // Disabled account
    let mut disabled_user = user.clone();
    disabled_user.is_enabled = false;
    let decision = evaluate_session_policy(&session, &disabled_user, &claims, base_time);
    assert!(matches!(
        decision,
        AuthDecision::FullLoginRequired { reason } if reason.contains("disabled")
    ));

    // Recovery reset (user auth_version bumped from 1 to 2)
    let mut reset_user = user.clone();
    reset_user.auth_version = 2;
    let decision = evaluate_session_policy(&session, &reset_user, &claims, base_time);
    assert!(matches!(
        decision,
        AuthDecision::FullLoginRequired { reason } if reason.contains("version mismatch")
    ));

    // Session revoked
    let mut revoked_session = session.clone();
    revoked_session.revoked_at = Some(chrono_to_bson(base_time + Duration::days(1)));
    let decision = evaluate_session_policy(&revoked_session, &user, &claims, base_time);
    assert!(matches!(
        decision,
        AuthDecision::FullLoginRequired { reason } if reason.contains("revoked")
    ));
}

#[test]
fn test_mfa_secret_encryption_and_safe_permissions() {
    let tmp = tempdir().unwrap();
    let key_file = tmp.path().join("mfa.key");

    let raw_key = [0x42u8; 32];
    let hex_key = hex::encode(raw_key);

    // Write hex key to file
    {
        let mut f = File::create(&key_file).unwrap();
        f.write_all(hex_key.as_bytes()).unwrap();
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // 1. Insecure permissions (0o666) -> should fail
        std::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o666)).unwrap();
        let res = MfaEncryptionKey::from_file(&key_file);
        assert!(
            matches!(res, Err(MfaSecretError::InsecurePermissions(_))),
            "Loading key file with 0o666 permissions must fail closed"
        );

        // 2. Secure permissions (0o600) -> should succeed
        std::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }

    let mfa_key = MfaEncryptionKey::from_file(&key_file).expect("Valid key file with 0o600");
    assert_eq!(mfa_key.as_bytes(), &raw_key);

    // Test encryption and decryption with AAD binding
    let secret_plaintext = b"super-secret-totp-bytes-160b";
    let (ciphertext, nonce) = mfa_key
        .encrypt("bob", "enrollment-confirmed", secret_plaintext)
        .expect("Encryption succeeds");

    // Correct decryption
    let decrypted = mfa_key
        .decrypt(
            "bob",
            "enrollment-confirmed",
            mfa_key.key_id(),
            &ciphertext,
            &nonce,
        )
        .expect("Decryption succeeds with matching AAD");
    assert_eq!(&decrypted[..], &secret_plaintext[..]);

    // Wrong username AAD -> fails
    let err = mfa_key.decrypt(
        "eve",
        "enrollment-confirmed",
        mfa_key.key_id(),
        &ciphertext,
        &nonce,
    );
    assert!(err.is_err(), "Decryption with wrong username must fail");

    // Wrong purpose AAD -> fails
    let err = mfa_key.decrypt(
        "bob",
        "enrollment-pending",
        mfa_key.key_id(),
        &ciphertext,
        &nonce,
    );
    assert!(err.is_err(), "Decryption with wrong purpose must fail");

    // Wrong key ID -> fails
    let err = mfa_key.decrypt(
        "bob",
        "enrollment-confirmed",
        "wrong-key-id",
        &ciphertext,
        &nonce,
    );
    assert!(err.is_err(), "Decryption with wrong key ID must fail");
}

#[test]
fn test_totp_rfc6238_generation_verification_and_replay_fencing() {
    let secret = TotpEngine::generate_secret();
    assert_eq!(secret.len(), 20, "TOTP secret must be 20 bytes (160 bits)");

    // Base32 round-trip
    let base32 = TotpEngine::secret_to_base32(&secret);
    let recovered_secret =
        TotpEngine::base32_to_secret(&base32).expect("Base32 decoding succeeds");
    assert_eq!(&secret[..], &recovered_secret[..]);

    // Provisioning URI
    let uri = TotpEngine::generate_otpauth_uri(&secret, "carol@example.com", "DamHopper")
        .expect("URI generation succeeds");
    println!("Generated URI: {uri}");
    assert!(uri.starts_with("otpauth://totp/"));
    assert!(uri.contains("secret="));
    assert!(uri.contains("issuer=DamHopper"));
    assert!(uri.contains("carol"));

    let now_unix = 1700000000u64;
    let current_step = (now_unix / 30) as i64;

    // Generate code at current step
    let code_curr = TotpEngine::generate_code_at(&secret, now_unix).unwrap();
    assert_eq!(code_curr.len(), 6);
    assert!(code_curr.chars().all(|c| c.is_ascii_digit()));

    // Verify code at current step (no prior accepted step)
    let matched_step = TotpEngine::verify_code(&secret, &code_curr, now_unix, None)
        .expect("Verification of current code succeeds");
    assert_eq!(matched_step, current_step);

    // Replay attack: submitting the exact same code with last_accepted_step = current_step
    let replay_err = TotpEngine::verify_code(&secret, &code_curr, now_unix, Some(current_step));
    assert_eq!(
        replay_err,
        Err(TotpError::ReplayedCode),
        "Submitting unreplayed code with step <= last_accepted_step must be rejected"
    );

    // Skew verification: t-1 and t+1
    let code_prev = TotpEngine::generate_code_at(&secret, now_unix - 30).unwrap();
    let code_next = TotpEngine::generate_code_at(&secret, now_unix + 30).unwrap();

    // t-1 succeeds if last_accepted_step is earlier
    let matched_prev =
        TotpEngine::verify_code(&secret, &code_prev, now_unix, Some(current_step - 2)).unwrap();
    assert_eq!(matched_prev, current_step - 1);

    // t-1 fails if last_accepted_step is >= t-1
    let err_prev =
        TotpEngine::verify_code(&secret, &code_prev, now_unix, Some(current_step - 1));
    assert_eq!(err_prev, Err(TotpError::ReplayedCode));

    // t+1 succeeds
    let matched_next =
        TotpEngine::verify_code(&secret, &code_next, now_unix, Some(current_step)).unwrap();
    assert_eq!(matched_next, current_step + 1);

    // t+2 is out of skew window (+/- 1 step)
    let code_far = TotpEngine::generate_code_at(&secret, now_unix + 60).unwrap();
    let err_far = TotpEngine::verify_code(&secret, &code_far, now_unix, None);
    assert_eq!(
        err_far,
        Err(TotpError::InvalidCode),
        "Code 2 steps in future must be rejected"
    );

    // Invalid format tests
    assert_eq!(
        TotpEngine::verify_code(&secret, "12345", now_unix, None),
        Err(TotpError::InvalidFormat)
    );
    assert_eq!(
        TotpEngine::verify_code(&secret, "1234567", now_unix, None),
        Err(TotpError::InvalidFormat)
    );
    assert_eq!(
        TotpEngine::verify_code(&secret, "abcdef", now_unix, None),
        Err(TotpError::InvalidFormat)
    );
}

#[test]
fn test_challenge_readiness_and_account_throttling() {
    let now = Utc::now();
    let (token_hex, digest_hex) = AuthService::generate_challenge_token();
    assert_eq!(token_hex.len(), 64);
    assert_eq!(digest_hex.len(), 64);

    let recovered_digest = AuthService::digest_challenge_token(&token_hex).unwrap();
    assert_eq!(recovered_digest, digest_hex);

    let challenge = AuthChallenge {
        id: digest_hex,
        username: "dave".to_string(),
        auth_version: 1,
        purpose: ChallengePurpose::LoginMfa,
        created_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(now + Duration::seconds(CHALLENGE_LIFETIME_SECS)),
        attempts: 0,
        consumed_at: None,
        pending_secret_ciphertext: None,
        pending_secret_nonce: None,
        pending_secret_key_id: None,
        session_id: None,
        credential_version: None,
    };

    // Valid challenge
    assert!(validate_challenge_readiness(&challenge, ChallengePurpose::LoginMfa, now).is_ok());

    // Wrong purpose
    assert!(validate_challenge_readiness(&challenge, ChallengePurpose::Enroll, now).is_err());

    // Expired challenge (now >= expires_at)
    assert!(validate_challenge_readiness(
        &challenge,
        ChallengePurpose::LoginMfa,
        now + Duration::seconds(CHALLENGE_LIFETIME_SECS + 1)
    )
    .is_err());

    // Max attempts exceeded
    let mut exhausted = challenge.clone();
    exhausted.attempts = 5;
    assert!(validate_challenge_readiness(&exhausted, ChallengePurpose::LoginMfa, now).is_err());

    // Consumed challenge
    let mut consumed = challenge.clone();
    consumed.consumed_at = Some(chrono_to_bson(now));
    assert!(validate_challenge_readiness(&consumed, ChallengePurpose::LoginMfa, now).is_err());

    // Account throttling check
    let unblocked_user = UserRecord {
        id: None,
        username: "dave".to_string(),
        password_hash: "hash".to_string(),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let (throttled, retry_after) = check_account_throttle(&unblocked_user, now);
    assert!(!throttled);
    assert!(retry_after.is_none());

    let mut blocked_user = unblocked_user.clone();
    blocked_user.mfa_blocked_until = Some(chrono_to_bson(now + Duration::seconds(300)));
    let (throttled, retry_after) = check_account_throttle(&blocked_user, now);
    assert!(throttled);
    assert!(retry_after.unwrap() >= 290);
}

#[tokio::test]
async fn test_mongodb_auth_store_cas_and_indexes() {
    let uri = std::env::var("TEST_MONGODB_URI")
        .unwrap_or_else(|_| "mongodb://127.0.0.1:27018".to_string());
    let client = match mongodb::Client::with_uri_str(&uri).await {
        Ok(c) => c,
        Err(_) => {
            eprintln!("Skipping MongoDB integration test: cannot connect to {uri}");
            return;
        }
    };

    let db_name = format!("test_auth_{}", uuid::Uuid::new_v4().simple());
    let db = client.database(&db_name);
    if db.run_command(mongodb::bson::doc! { "ping": 1 }).await.is_err() {
        eprintln!("Skipping MongoDB integration test: ping failed on {uri}");
        return;
    }

    let store = dam_hopper_server::auth::AuthStore::from_mongo(db.clone());

    // 1. Duplicate check before index creation
    let users_col = db.collection::<mongodb::bson::Document>("users");
    users_col
        .insert_many([
            mongodb::bson::doc! { "username": "cloned", "authVersion": 0 },
            mongodb::bson::doc! { "username": "cloned", "authVersion": 0 },
        ])
        .await
        .unwrap();

    let init_err = store.init_indexes().await;
    assert!(
        matches!(init_err, Err(dam_hopper_server::auth::StoreError::DuplicateUsername(_))),
        "init_indexes must fail when duplicate usernames exist"
    );

    // Clean up duplicates and re-run index creation
    users_col.delete_many(mongodb::bson::doc! {}).await.unwrap();
    store.init_indexes().await.expect("init_indexes succeeds on clean DB");

    // 2. Insert test user
    let now = Utc::now();
    let test_user = UserRecord {
        id: None,
        username: "grace".to_string(),
        password_hash: "$2b$12$hashed".to_string(),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    db.collection::<UserRecord>("users")
        .insert_one(test_user)
        .await
        .unwrap();

    // 3. Confirm enrollment CAS
    let mfa = MfaConfirmed {
        secret_ciphertext: "enc".to_string(),
        nonce: "nonce".to_string(),
        key_id: "key-1".to_string(),
        enrolled_at: chrono_to_bson(now),
        last_accepted_step: 100,
    };

    // Wrong authVersion CAS -> fails
    let ok = store.confirm_enrollment("grace", 99, mfa.clone()).await.unwrap();
    assert!(!ok, "Enrollment with wrong authVersion must fail CAS");

    let ok = store.confirm_enrollment("grace", 1, mfa.clone()).await.unwrap();
    assert!(ok, "First enrollment confirmation must succeed");

    // Competing/duplicate enrollment confirmation -> fails (factor already confirmed)
    let ok = store.confirm_enrollment("grace", 1, mfa.clone()).await.unwrap();
    assert!(!ok, "Subsequent enrollment confirmation must fail CAS (cannot overwrite factor)");

    // 4. Advance TOTP step CAS (monotonicity)
    // Advance to 101 -> succeeds
    let ok = store.advance_totp_step("grace", 1, 101).await.unwrap();
    assert!(ok, "Advancing to step > 100 must succeed");

    // Re-advance to 101 -> fails (must be strictly greater)
    let ok = store.advance_totp_step("grace", 1, 101).await.unwrap();
    assert!(!ok, "Re-advancing to same step must fail CAS (replay fence)");

    // Advance backwards to 99 -> fails
    let ok = store.advance_totp_step("grace", 1, 99).await.unwrap();
    assert!(!ok, "Advancing to older step must fail CAS (monotonicity)");

    // 4b. Legacy user without authVersion field in MongoDB
    db.collection::<mongodb::bson::Document>("users")
        .insert_one(mongodb::bson::doc! {
            "username": "legacy_grace",
            "passwordHash": "$2b$12$hashed",
            "isEnabled": true,
            "role": "user"
        })
        .await
        .unwrap();

    let legacy_user = store.get_user("legacy_grace").await.unwrap().unwrap();
    assert_eq!(legacy_user.auth_version, 0, "Default auth_version must be 0 for legacy user");

    let ok = store.confirm_enrollment("legacy_grace", legacy_user.auth_version, mfa.clone()).await.unwrap();
    assert!(ok, "Enrollment confirmation for legacy user without authVersion field must succeed");

    let ok = store.advance_totp_step("legacy_grace", 0, 105).await.unwrap();
    assert!(ok, "Step advancement for legacy user must succeed");

    // 5. Challenges: create, attempt increment, and atomic consumption
    let challenge = AuthChallenge {
        id: "digest-grace-1".to_string(),
        username: "grace".to_string(),
        auth_version: 1,
        purpose: ChallengePurpose::LoginMfa,
        created_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(now + Duration::seconds(300)),
        attempts: 0,
        consumed_at: None,
        pending_secret_ciphertext: None,
        pending_secret_nonce: None,
        pending_secret_key_id: None,
        session_id: None,
        credential_version: None,
    };
    store.create_challenge(challenge).await.unwrap();

    // Increment attempts
    let attempts = store.increment_challenge_attempt("digest-grace-1").await.unwrap();
    assert_eq!(attempts, 1);

    // Consume challenge
    let consumed = store.consume_challenge("digest-grace-1", ChallengePurpose::LoginMfa, now).await.unwrap();
    assert!(consumed, "First challenge consumption must succeed");

    // Double-consumption fails
    let consumed_again = store.consume_challenge("digest-grace-1", ChallengePurpose::LoginMfa, now).await.unwrap();
    assert!(!consumed_again, "Second challenge consumption must fail");

    // 6. Sessions: create, step-up CAS, and revocation
    let session = AuthSession {
        id: "session-grace-1".to_string(),
        username: "grace".to_string(),
        auth_version: 1,
        credential_version: 1,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(now + Duration::days(30)),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
    };
    store.create_session(session).await.unwrap();

    // Advance session MFA (step-up)
    let updated_session = store.advance_session_mfa("session-grace-1", 1, now + Duration::days(10)).await.unwrap();
    assert!(updated_session.is_some());
    let updated = updated_session.unwrap();
    assert_eq!(updated.credential_version, 2);

    // Stale credentialVersion step-up fails
    let stale_attempt = store.advance_session_mfa("session-grace-1", 1, now + Duration::days(11)).await.unwrap();
    assert!(stale_attempt.is_none(), "Step-up with stale credentialVersion must fail");

    // Revoke session
    let revoked = store.revoke_session("session-grace-1", now).await.unwrap();
    assert!(revoked, "Revocation of active session succeeds");

    // Step-up on revoked session fails
    let revoked_step_up = store.advance_session_mfa("session-grace-1", 2, now + Duration::days(12)).await.unwrap();
    assert!(revoked_step_up.is_none(), "Step-up on revoked session must fail");

    // 7. Throttling attempts
    for _ in 0..9 {
        store.record_failed_attempt("grace", now).await.unwrap();
    }
    let user = store.get_user("grace").await.unwrap().unwrap();
    assert_eq!(user.mfa_attempt_count, 9);
    assert!(user.mfa_blocked_until.is_none());

    // 10th attempt triggers lockout
    store.record_failed_attempt("grace", now).await.unwrap();
    let user = store.get_user("grace").await.unwrap().unwrap();
    assert_eq!(user.mfa_attempt_count, 10);
    assert!(user.mfa_blocked_until.is_some());

    // Clear attempts resets lockout
    store.clear_failed_attempts("grace").await.unwrap();
    let user = store.get_user("grace").await.unwrap().unwrap();
    assert_eq!(user.mfa_attempt_count, 0);
    assert!(user.mfa_blocked_until.is_none());

    // Clean up test DB
    let _ = db.drop().await;
}

fn registered_user(username: &str, id: Option<mongodb::bson::oid::ObjectId>) -> UserRecord {
    UserRecord {
        id,
        username: username.to_string(),
        password_hash: "$2b$12$hashed".to_string(),
        is_enabled: false,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    }
}

#[tokio::test]
async fn test_mongodb_create_user_generates_id_and_reports_username_conflict_only() {
    use dam_hopper_server::auth::{AuthStore, StoreError};

    let uri = std::env::var("TEST_MONGODB_URI")
        .unwrap_or_else(|_| "mongodb://127.0.0.1:27018".to_string());
    let client = match mongodb::Client::with_uri_str(&uri).await {
        Ok(c) => c,
        Err(_) => {
            eprintln!("Skipping MongoDB integration test: cannot connect to {uri}");
            return;
        }
    };
    let db = client.database(&format!("test_auth_{}", uuid::Uuid::new_v4().simple()));
    if db.run_command(mongodb::bson::doc! { "ping": 1 }).await.is_err() {
        eprintln!("Skipping MongoDB integration test: ping failed on {uri}");
        return;
    }
    let store = AuthStore::from_mongo(db.clone());

    // Conflict outcome holds with and without the unique index in place.
    for with_index in [false, true] {
        if with_index {
            store.init_indexes().await.expect("indexes on clean collection");
        }
        let name = format!("carol-{with_index}");
        store.create_user(registered_user(&name, None)).await.unwrap();
        let stored = store.get_user(&name).await.unwrap().expect("user persisted");
        assert!(stored.id.is_some(), "ObjectId generated when absent");
        assert!(!stored.is_enabled && stored.auth_version == 0);

        let again = store.create_user(registered_user(&name, None)).await;
        assert!(matches!(again, Err(StoreError::DuplicateUsername(_))), "got {again:?}");
        db.collection::<UserRecord>("users")
            .delete_many(mongodb::bson::doc! {})
            .await
            .unwrap();
    }

    // Duplicate `_id` is a storage error, never masked as a username conflict.
    let shared_id = mongodb::bson::oid::ObjectId::new();
    store.create_user(registered_user("dave", Some(shared_id))).await.unwrap();
    let collision = store.create_user(registered_user("erin", Some(shared_id))).await;
    assert!(matches!(collision, Err(StoreError::Mongo(_))), "got {collision:?}");
    assert!(store.get_user("erin").await.unwrap().is_none());

    // Concurrent registrations of one username: the index arbitrates, one winner.
    let users = db.collection::<UserRecord>("users");
    users.delete_many(mongodb::bson::doc! {}).await.unwrap();
    let attempts = (0..8).map(|_| store.create_user(registered_user("frank", None)));
    let results = futures_util::future::join_all(attempts).await;
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1, "{results:?}");
    assert!(
        results
            .iter()
            .filter_map(|r| r.as_ref().err())
            .all(|e| matches!(e, StoreError::DuplicateUsername(_))),
        "{results:?}"
    );

    // A collision on an unrelated unique index is a storage error, not a username conflict.
    users.delete_many(mongodb::bson::doc! {}).await.unwrap();
    users
        .create_index(
            mongodb::IndexModel::builder()
                .keys(mongodb::bson::doc! { "authVersion": 1 })
                .options(
                    mongodb::options::IndexOptions::builder()
                        .unique(true)
                        .name("other_username_1".to_string())
                        .build(),
                )
                .build(),
        )
        .await
        .unwrap();
    store.create_user(registered_user("gina", None)).await.unwrap();
    let unrelated = store.create_user(registered_user("hank", None)).await;
    assert!(matches!(unrelated, Err(StoreError::Mongo(_))), "got {unrelated:?}");

    let _ = db.drop().await;
}
