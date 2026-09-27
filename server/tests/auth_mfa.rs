use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use chrono::Duration as ChronoDuration;
use dam_hopper_server::auth::Clock;
use dam_hopper_server::auth::model::{AuthClaims, UserRecord};
use dam_hopper_server::auth::policy::{MFA_VALIDITY_SECS, SESSION_LIFETIME_SECS};
use dam_hopper_server::auth::totp::TotpEngine;
use mongodb::bson::doc;
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::auth_fixtures::AuthTestFixture;
fn to_20_bytes(v: &[u8]) -> [u8; 20] {
    let mut arr = [0u8; 20];
    arr.copy_from_slice(v);
    arr
}

#[tokio::test]
async fn test_a04_enrollment_setup_qr_and_manual_key_consistency() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    fixture.create_user("bob_a04", "Password123!", true).await;

    // 1. Password login -> returns enrollmentRequired
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a04",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "enrollmentRequired");
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // 2. Setup -> returns QR and manual setup key
    let setup_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(setup_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();

    let secret_base32 = json["secret"].as_str().unwrap();
    let otpauth_uri = json["otpauthUri"].as_str().unwrap();
    assert_eq!(json["issuer"], "DamHopper");
    assert_eq!(json["accountName"], "bob_a04");
    assert_eq!(json["algorithm"], "SHA1");
    assert_eq!(json["digits"], 6);
    assert_eq!(json["period"], 30);

    // Verify URI consistency with parameters
    assert!(otpauth_uri.contains("secret="));
    assert!(otpauth_uri.contains(secret_base32));
    assert!(otpauth_uri.contains("issuer=DamHopper"));
    assert!(otpauth_uri.contains("bob_a04"));

    // 3. Confirm enrollment with valid TOTP code
    let secret_bytes = TotpEngine::base32_to_secret(secret_base32).expect("decode base32");
    let secret_arr = to_20_bytes(&secret_bytes);
    let code = fixture.generate_code(&secret_arr, 0);

    let confirm_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(confirm_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "authenticated");
    let token = json["token"].as_str().unwrap();
    assert!(!token.is_empty());

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a05_invalid_malformed_expired_or_replayed_first_code() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    fixture.create_user("bob_a05", "Password123!", true).await;

    // Login to get challenge
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a05",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // Setup to initialize secret
    let setup_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(setup_req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let secret_base32 = json["secret"].as_str().unwrap().to_string();
    let secret_bytes = TotpEngine::base32_to_secret(&secret_base32).unwrap();
    let secret_arr = to_20_bytes(&secret_bytes);

    // 1. Wrong code -> 401 INVALID_MFA_CODE
    let bad_code_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": "999999"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(bad_code_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "INVALID_MFA_CODE");

    // 2. Malformed non-digit code -> 400 or 401
    let malformed_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": "abcdef"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(malformed_req).await.unwrap();
    assert!(resp.status() == StatusCode::BAD_REQUEST || resp.status() == StatusCode::UNAUTHORIZED);

    // 3. Confirm with valid code
    let valid_code = fixture.generate_code(&secret_arr, 0);
    let confirm_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": &valid_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(confirm_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 4. Replay exact same confirmation -> rejected
    let replay_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": &valid_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(replay_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a06_competing_enrollment_challenges_concurrent_confirmations() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    fixture.create_user("bob_a06", "Password123!", true).await;

    // Issue two separate enrollment challenges for the same user
    let login1_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a06",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp1 = fixture.app.clone().oneshot(login1_req).await.unwrap();
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let challenge1 = json1["challengeToken"].as_str().unwrap().to_string();

    let login2_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a06",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(login2_req).await.unwrap();
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    let challenge2 = json2["challengeToken"].as_str().unwrap().to_string();

    assert_ne!(challenge1, challenge2);

    // Setup both
    let setup1_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({ "challengeToken": &challenge1 })).unwrap(),
        ))
        .unwrap();
    let resp1 = fixture.app.clone().oneshot(setup1_req).await.unwrap();
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let secret1 = json1["secret"].as_str().unwrap().to_string();
    let secret_bytes1 = TotpEngine::base32_to_secret(&secret1).unwrap();
    let secret_arr1 = to_20_bytes(&secret_bytes1);

    let setup2_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({ "challengeToken": &challenge2 })).unwrap(),
        ))
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(setup2_req).await.unwrap();
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    let secret2 = json2["secret"].as_str().unwrap().to_string();
    let secret_bytes2 = TotpEngine::base32_to_secret(&secret2).unwrap();
    let secret_arr2 = to_20_bytes(&secret_bytes2);

    // Confirm challenge 1 first
    let code1 = fixture.generate_code(&secret_arr1, 0);
    let confirm1_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge1,
                "code": code1
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp1 = fixture.app.clone().oneshot(confirm1_req).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // Confirm challenge 2 must fail because user is now already enrolled (atomic CAS)
    let code2 = fixture.generate_code(&secret_arr2, 0);
    let confirm2_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge2,
                "code": code2
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(confirm2_req).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(json2["code"], "ALREADY_ENROLLED");

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a07_correct_password_for_enrolled_account_requires_mfa() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0x42u8; 20];
    fixture
        .create_enrolled_user("bob_a07", "Password123!", &secret)
        .await;

    // Login with password
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a07",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers().get(header::SET_COOKIE).is_none());

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "mfaRequired");
    let challenge_token = json["challengeToken"].as_str().unwrap();

    // Challenge token cannot be used as Bearer auth on protected route
    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {challenge_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a08_a09_totp_window_skew_and_replay_prevention() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0x33u8; 20];
    fixture
        .create_enrolled_user("bob_a08", "Password123!", &secret)
        .await;

    // Login to get MFA challenge
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a08",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // 1. Code at step t+2 (outside window) -> rejected
    let distant_code = fixture.generate_code(&secret, 2);
    let distant_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": distant_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(distant_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 2. Valid code at current step -> accepted
    let valid_code = fixture.generate_code(&secret, 0);
    let verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": &valid_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 3. New login challenge for same user
    let login_req2 = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a08",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(login_req2).await.unwrap();
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    let challenge_token2 = json2["challengeToken"].as_str().unwrap().to_string();

    // 4. Submitting the exact same code to the new challenge is rejected (replay prevention: step <= lastAcceptedStep)
    let replay_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token2,
                "code": &valid_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(replay_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 5. Advancing clock by 30s generates a strictly newer step -> accepted
    fixture.clock.advance(ChronoDuration::seconds(30));
    let next_code = fixture.generate_code(&secret, 0);
    let next_verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token2,
                "code": next_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(next_verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a10_day_10_mfa_deadline_cutoff() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0x55u8; 20];
    fixture
        .create_enrolled_user("bob_a10", "Password123!", &secret)
        .await;

    let base_time = fixture.clock.now();
    let (_session, token) = fixture
        .create_session(
            "bob_a10",
            1,
            base_time,
            base_time + ChronoDuration::seconds(SESSION_LIFETIME_SECS),
            base_time,
        )
        .await;

    // Day 0: status is 200 Authenticated
    let req0 = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp0 = fixture.app.clone().oneshot(req0).await.unwrap();
    assert_eq!(resp0.status(), StatusCode::OK);

    // Day 9: status is still 200 Authenticated
    fixture.clock.set(base_time + ChronoDuration::days(9));
    let req9 = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp9 = fixture.app.clone().oneshot(req9).await.unwrap();
    assert_eq!(resp9.status(), StatusCode::OK);

    // Day 10 exact instant: status returns 401 MFA_REQUIRED
    fixture
        .clock
        .set(base_time + ChronoDuration::seconds(MFA_VALIDITY_SECS));
    let req10 = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp10 = fixture.app.clone().oneshot(req10).await.unwrap();
    assert_eq!(resp10.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp10.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "MFA_REQUIRED");
    assert_eq!(json["user"], "bob_a10");

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a11_step_up_advances_credential_version_preserves_expiry() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0x77u8; 20];
    fixture
        .create_enrolled_user("bob_a11", "Password123!", &secret)
        .await;

    let base_time = fixture.clock.now();
    let original_expiry = base_time + ChronoDuration::seconds(SESSION_LIFETIME_SECS);
    let (_session, old_token) = fixture
        .create_session("bob_a11", 1, base_time, original_expiry, base_time)
        .await;

    // Advance to day 10 where MFA is due
    fixture
        .clock
        .set(base_time + ChronoDuration::seconds(MFA_VALIDITY_SECS));

    // Request step-up challenge using the stale token
    let challenge_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {old_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(challenge_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // Verify challenge with fresh TOTP code
    let code = fixture.generate_code(&secret, 0);
    let verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let new_token = json["token"].as_str().unwrap();

    // Decode claims of new token
    let new_claims = AuthClaims::decode(new_token, common::auth_fixtures::TEST_JWT_SECRET).unwrap();
    assert_eq!(new_claims.credential_version, 2);
    assert_eq!(new_claims.exp, original_expiry.timestamp() as usize);

    // Old token with credentialVersion 1 is rejected immediately
    let old_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {old_token}"))
        .body(Body::empty())
        .unwrap();
    let resp_old = fixture.app.clone().oneshot(old_req).await.unwrap();
    assert_eq!(resp_old.status(), StatusCode::UNAUTHORIZED);

    // New token with credentialVersion 2 is accepted
    let new_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {new_token}"))
        .body(Body::empty())
        .unwrap();
    let resp_new = fixture.app.clone().oneshot(new_req).await.unwrap();
    assert_eq!(resp_new.status(), StatusCode::OK);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a12_day_30_absolute_expiry_wins_over_mfa() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0x88u8; 20];
    fixture
        .create_enrolled_user("bob_a12", "Password123!", &secret)
        .await;

    let base_time = fixture.clock.now();
    let expiry = base_time + ChronoDuration::seconds(SESSION_LIFETIME_SECS);
    // Even if MFA was verified very recently (e.g. at day 29)
    let mfa_verified_at = base_time + ChronoDuration::days(29);
    let (_session, token) = fixture
        .create_session("bob_a12", 2, base_time, expiry, mfa_verified_at)
        .await;

    // At day 30 exact instant: absolute expiry wins
    fixture.clock.set(expiry);

    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "SESSION_EXPIRED");

    // Cannot step-up an expired session
    let challenge_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(challenge_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a14_independent_sessions_for_same_user() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0x99u8; 20];
    fixture
        .create_enrolled_user("bob_a14", "Password123!", &secret)
        .await;

    let base_time = fixture.clock.now();
    let expiry = base_time + ChronoDuration::seconds(SESSION_LIFETIME_SECS);

    // Create Session 1 and Session 2
    let (_sess1, token1) = fixture
        .create_session("bob_a14", 1, base_time, expiry, base_time)
        .await;
    let (_sess2, token2) = fixture
        .create_session("bob_a14", 1, base_time, expiry, base_time)
        .await;

    // Advance to day 10: both sessions need MFA
    fixture
        .clock
        .set(base_time + ChronoDuration::seconds(MFA_VALIDITY_SECS));

    // Request step-up challenge for Session 1
    let chal1_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();
    let resp1 = fixture.app.clone().oneshot(chal1_req).await.unwrap();
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let challenge1 = json1["challengeToken"].as_str().unwrap().to_string();

    // Request step-up challenge for Session 2
    let chal2_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(chal2_req).await.unwrap();
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    let challenge2 = json2["challengeToken"].as_str().unwrap().to_string();

    // Verify Session 1 with valid code
    let code = fixture.generate_code(&secret, 0);
    let verify1_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge1,
                "code": &code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp1 = fixture.app.clone().oneshot(verify1_req).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let new_token1 = json1["token"].as_str().unwrap();

    // Session 1 is now fresh
    let status1_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {new_token1}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status1_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Session 2 is still stale
    let status2_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status2_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Submitting the exact same code to Session 2 is rejected (account-wide replay fence)
    let verify2_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge2,
                "code": &code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(verify2_req).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a17_rate_limiting_and_lockout() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0xAAu8; 20];
    fixture
        .create_enrolled_user("bob_a17", "Password123!", &secret)
        .await;

    // Issue MFA challenge
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a17",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // 5 attempts on first challenge -> challenge gets consumed/exhausted
    for _ in 0..5 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/mfa/verify")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "challengeToken": &challenge_token,
                    "code": "000000"
                }))
                .unwrap(),
            ))
            .unwrap();
        let resp = fixture.app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    // Login again to get second challenge
    let login_req2 = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a17",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(login_req2).await.unwrap();
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    let challenge_token2 = json2["challengeToken"].as_str().unwrap().to_string();

    // Fail 5 more times -> 10 total failed attempts in window
    for _ in 0..5 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/mfa/verify")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "challengeToken": &challenge_token2,
                    "code": "000000"
                }))
                .unwrap(),
            ))
            .unwrap();
        let _ = fixture.app.clone().oneshot(req).await.unwrap();
    }

    // 11th attempt returns 429 TOO_MANY_REQUESTS
    let login_req3 = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a17",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp3 = fixture.app.clone().oneshot(login_req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(resp3.headers().contains_key(header::RETRY_AFTER));

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a20_logout_durably_revokes_session() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let base_time = fixture.clock.now();
    let expiry = base_time + ChronoDuration::seconds(SESSION_LIFETIME_SECS);
    let (session, token) = fixture
        .create_session("bob_a20", 1, base_time, expiry, base_time)
        .await;

    // Logout request
    let logout_req = Request::builder()
        .method("POST")
        .uri("/api/auth/logout")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(logout_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify session in MongoDB has revoked_at set
    let stored_sess = fixture
        .store
        .get_session(&session.id)
        .await
        .unwrap()
        .unwrap();
    assert!(stored_sess.revoked_at.is_some());

    // Subsequent access with this token is denied
    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}

#[tokio::test]
async fn test_a21_a22_mongodb_atomic_recovery_reset() {
    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let secret = [0xCCu8; 20];
    fixture
        .create_enrolled_user("bob_a21", "Password123!", &secret)
        .await;

    let base_time = fixture.clock.now();
    let expiry = base_time + ChronoDuration::seconds(SESSION_LIFETIME_SECS);
    let (_session, token) = fixture
        .create_session("bob_a21", 1, base_time, expiry, base_time)
        .await;

    // Verify initially authenticated
    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Operator executes atomic recovery reset:
    // Update user: $unset mfa and throttling, $inc authVersion by 1
    // Filter must match expected authVersion (1)
    let update_res = fixture
        .db
        .collection::<UserRecord>("users")
        .update_one(
            doc! { "username": "bob_a21", "authVersion": 1 },
            doc! {
                "$inc": { "authVersion": 1 },
                "$unset": {
                    "mfa": "",
                    "mfaAttemptWindowStartedAt": "",
                    "mfaAttemptCount": "",
                    "mfaBlockedUntil": ""
                }
            },
        )
        .await
        .unwrap();
    assert_eq!(update_res.matched_count, 1);
    assert_eq!(update_res.modified_count, 1);

    // 1. Existing session token is immediately dead (authVersion mismatch)
    let status_req2 = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp2 = fixture.app.clone().oneshot(status_req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::UNAUTHORIZED);

    // 2. User logs in with password -> gets enrollmentRequired with authVersion: 2
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob_a21",
                "password": "Password123!"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "enrollmentRequired");
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // 3. User sets up new secret and confirms
    let setup_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({ "challengeToken": &challenge_token })).unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(setup_req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let new_secret_b32 = json["secret"].as_str().unwrap().to_string();
    let new_secret_bytes = TotpEngine::base32_to_secret(&new_secret_b32).unwrap();
    let new_secret_arr = to_20_bytes(&new_secret_bytes);

    let new_code = fixture.generate_code(&new_secret_arr, 0);
    let confirm_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": new_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(confirm_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let fresh_token = json["token"].as_str().unwrap();

    // 4. Fresh token succeeds
    let status_req3 = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {fresh_token}"))
        .body(Body::empty())
        .unwrap();
    let resp3 = fixture.app.clone().oneshot(status_req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::OK);

    // 5. Old token is still rejected
    let status_req_old = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp_old = fixture.app.clone().oneshot(status_req_old).await.unwrap();
    assert_eq!(resp_old.status(), StatusCode::UNAUTHORIZED);

    // 6. Test A22: Reset attempt with stale/wrong version predicate mutates 0 rows
    let stale_reset = fixture
        .db
        .collection::<UserRecord>("users")
        .update_one(
            doc! { "username": "bob_a21", "authVersion": 1 },
            doc! { "$inc": { "authVersion": 1 } },
        )
        .await
        .unwrap();
    assert_eq!(stale_reset.matched_count, 0);
    assert_eq!(stale_reset.modified_count, 0);

    fixture.cleanup().await;
}
#[tokio::test]
async fn test_smoke_end_to_end_real_tcp_ws_deadline_and_recovery() {
    use dam_hopper_server::api::ws::{CLOSE_FULL_LOGIN_REQUIRED, CLOSE_MFA_REQUIRED};
    use futures_util::StreamExt;

    let Some(fixture) = AuthTestFixture::new().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    // 1. Verify strict file permission check on MFA key file
    let tmp_key_dir = tempfile::tempdir().unwrap();
    let key_file_path = tmp_key_dir.path().join("test_smoke_mfa.key");
    std::fs::write(&key_file_path, fixture.raw_mfa_key).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Insecure permissions (0644) should fail from_file
        std::fs::set_permissions(&key_file_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(
            dam_hopper_server::auth::secret::MfaEncryptionKey::from_file(&key_file_path).is_err()
        );

        // Secure permissions (0600) should succeed
        std::fs::set_permissions(&key_file_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let loaded_key =
            dam_hopper_server::auth::secret::MfaEncryptionKey::from_file(&key_file_path).unwrap();
        assert_eq!(loaded_key.as_bytes(), &fixture.raw_mfa_key);
    }

    // 2. Bind real TCP listener on 127.0.0.1:0
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = fixture.app.clone();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let http_client = reqwest::Client::new();
    let base_url = format!("http://{addr}");

    // 3. User registers through real HTTP endpoint
    let register_resp = http_client
        .post(format!("{base_url}/api/auth/register"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&serde_json::json!({
                "username": "smoke_eval_user",
                "password": "SmokePassword123!"
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(register_resp.status(), StatusCode::OK);

    // Operator approves user in MongoDB (sets isEnabled: true)
    fixture
        .db
        .collection::<UserRecord>("users")
        .update_one(
            doc! { "username": "smoke_eval_user" },
            doc! { "$set": { "isEnabled": true } },
        )
        .await
        .unwrap();

    // 4. Login -> state: enrollmentRequired
    let login_resp = http_client
        .post(format!("{base_url}/api/auth/login"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&serde_json::json!({
                "username": "smoke_eval_user",
                "password": "SmokePassword123!"
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(login_resp.status(), StatusCode::OK);
    let login_bytes = login_resp.bytes().await.unwrap();
    let login_json: Value = serde_json::from_slice(&login_bytes).unwrap();
    assert_eq!(login_json["state"], "enrollmentRequired");
    let challenge_token = login_json["challengeToken"].as_str().unwrap().to_string();

    // 5. Setup -> get secret & otpauth URI
    let setup_resp = http_client
        .post(format!("{base_url}/api/auth/mfa/setup"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&serde_json::json!({ "challengeToken": &challenge_token })).unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(setup_resp.status(), StatusCode::OK);
    let setup_bytes = setup_resp.bytes().await.unwrap();
    let setup_json: Value = serde_json::from_slice(&setup_bytes).unwrap();
    let secret_b32 = setup_json["secret"].as_str().unwrap();
    let secret_bytes = TotpEngine::base32_to_secret(secret_b32).unwrap();
    let secret_arr = to_20_bytes(&secret_bytes);

    // 6. Confirm -> state: authenticated, returns JWT
    let code = fixture.generate_code(&secret_arr, 0);
    let confirm_resp = http_client
        .post(format!("{base_url}/api/auth/mfa/confirm"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": code
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(confirm_resp.status(), StatusCode::OK);
    let confirm_bytes = confirm_resp.bytes().await.unwrap();
    let confirm_json: Value = serde_json::from_slice(&confirm_bytes).unwrap();
    assert_eq!(confirm_json["state"], "authenticated");
    let token = confirm_json["token"].as_str().unwrap().to_string();

    // 7. Protected route status -> 200 OK
    let status_resp = http_client
        .get(format!("{base_url}/api/auth/status"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(status_resp.status(), StatusCode::OK);

    // Legacy token -> 401 Unauthorized
    let legacy_resp = http_client
        .get(format!("{base_url}/api/auth/status"))
        .header(header::AUTHORIZATION, "Bearer legacy.invalid.token")
        .send()
        .await
        .unwrap();
    assert_eq!(legacy_resp.status(), StatusCode::UNAUTHORIZED);

    // 8. Connect real WebSocket
    let ws_connect = |uri_str: &str| {
        let key = tokio_tungstenite::tungstenite::handshake::client::generate_key();
        let req = tokio_tungstenite::tungstenite::handshake::client::Request::builder()
            .uri(uri_str)
            .header(header::UPGRADE, "websocket")
            .header(header::CONNECTION, "Upgrade")
            .header("Sec-WebSocket-Key", key)
            .header("Sec-WebSocket-Version", "13")
            .header(header::ORIGIN, format!("http://{addr}"))
            .header(header::HOST, addr.to_string())
            .body(())
            .unwrap();
        tokio_tungstenite::connect_async(req)
    };

    let ws_url = format!("ws://{}/ws?token={}", addr, token);
    let (mut ws, ws_resp) = ws_connect(&ws_url)
        .await
        .expect("WebSocket connection should succeed");
    assert_eq!(ws_resp.status(), StatusCode::SWITCHING_PROTOCOLS);

    // 9. Advance clock to day 10 (MFA deadline reached)
    let base_time = fixture.clock.now();
    fixture
        .clock
        .set(base_time + ChronoDuration::seconds(MFA_VALIDITY_SECS));

    // WebSocket should be terminated with 4403 (CLOSE_MFA_REQUIRED)
    let close_msg = tokio::time::timeout(std::time::Duration::from_secs(8), ws.next())
        .await
        .expect("Server must send close frame on MFA deadline")
        .expect("Stream should not terminate without frame")
        .expect("Valid message expected");

    match close_msg {
        tokio_tungstenite::tungstenite::Message::Close(Some(frame)) => {
            assert_eq!(
                frame.code,
                tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(
                    CLOSE_MFA_REQUIRED
                )
            );
        }
        other => panic!("Expected Close frame with 4403, got: {:?}", other),
    }

    // 10. HTTP status now returns 401 MFA_REQUIRED
    let status_due = http_client
        .get(format!("{base_url}/api/auth/status"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(status_due.status(), StatusCode::UNAUTHORIZED);
    let due_bytes = status_due.bytes().await.unwrap();
    let due_json: Value = serde_json::from_slice(&due_bytes).unwrap();
    assert_eq!(due_json["code"], "MFA_REQUIRED");

    // 11. Perform step-up to obtain new token
    let chal_resp = http_client
        .post(format!("{base_url}/api/auth/mfa/challenge"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(chal_resp.status(), StatusCode::OK);
    let chal_bytes = chal_resp.bytes().await.unwrap();
    let chal_json: Value = serde_json::from_slice(&chal_bytes).unwrap();
    let stepup_challenge = chal_json["challengeToken"].as_str().unwrap();

    let fresh_code = fixture.generate_code(&secret_arr, 0);
    let verify_resp = http_client
        .post(format!("{base_url}/api/auth/mfa/verify"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": stepup_challenge,
                "code": fresh_code
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(verify_resp.status(), StatusCode::OK);
    let verify_bytes = verify_resp.bytes().await.unwrap();
    let verify_json: Value = serde_json::from_slice(&verify_bytes).unwrap();
    let new_token = verify_json["token"].as_str().unwrap().to_string();

    // 12. Connect new WebSocket with new token
    let new_ws_url = format!("ws://{}/ws?token={}", addr, new_token);
    let (mut new_ws, new_ws_resp) = ws_connect(&new_ws_url)
        .await
        .expect("New WebSocket connection should succeed");
    assert_eq!(new_ws_resp.status(), StatusCode::SWITCHING_PROTOCOLS);

    // 13. Perform atomic MongoDB reset recovery while connected
    let reset_res = fixture
        .db
        .collection::<UserRecord>("users")
        .update_one(
            doc! { "username": "smoke_eval_user", "authVersion": 0 },
            doc! {
                "$inc": { "authVersion": 1 },
                "$unset": { "mfa": "", "mfaAttemptWindowStartedAt": "", "mfaAttemptCount": "", "mfaBlockedUntil": "" }
            },
        )
        .await
        .unwrap();
    assert_eq!(reset_res.modified_count, 1);

    // Live socket must be closed with 4401 (CLOSE_FULL_LOGIN_REQUIRED) within <= 8s
    let reset_close_msg = tokio::time::timeout(std::time::Duration::from_secs(8), new_ws.next())
        .await
        .expect("Server must terminate live socket after DB reset")
        .expect("Stream should not terminate without frame")
        .expect("Valid message expected");

    match reset_close_msg {
        tokio_tungstenite::tungstenite::Message::Close(Some(frame)) => {
            assert_eq!(
                frame.code,
                tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(
                    CLOSE_FULL_LOGIN_REQUIRED
                )
            );
        }
        other => panic!("Expected Close frame with 4401, got: {:?}", other),
    }

    // HTTP status with new_token is also dead immediately
    let post_reset_status = http_client
        .get(format!("{base_url}/api/auth/status"))
        .header(header::AUTHORIZATION, format!("Bearer {new_token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(post_reset_status.status(), StatusCode::UNAUTHORIZED);

    fixture.cleanup().await;
}
