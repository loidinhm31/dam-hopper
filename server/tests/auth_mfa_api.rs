use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use bcrypt::{hash, DEFAULT_COST};
use chrono::{Duration as ChronoDuration, Utc};
use dam_hopper_server::api::build_router;
use dam_hopper_server::auth::model::{UserRecord, UserRole};
use dam_hopper_server::auth::policy::{MockClock, AUTH_PROTOCOL_VERSION};
use dam_hopper_server::auth::secret::MfaEncryptionKey;
use dam_hopper_server::auth::totp::TotpEngine;
use dam_hopper_server::auth::{AuthService, AuthStore, Clock};
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ServerConfig, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::telemetry::TelemetryRuntime;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::Value;
use tempfile::tempdir;
use tower::ServiceExt;

mod common;
const TEST_SECRET: &str = "test-jwt-secret-key-32-bytes-long!";

#[allow(dead_code)]
struct TestFixture {
    app: axum::Router,
    db: mongodb::Database,
    store: AuthStore,
    clock: Arc<MockClock>,
    raw_mfa_key: [u8; 32],
}

async fn setup_fixture() -> Option<TestFixture> {
    let uri = std::env::var("TEST_MONGODB_URI")
        .unwrap_or_else(|_| "mongodb://127.0.0.1:27018".to_string());
    let client = match mongodb::Client::with_uri_str(&uri).await {
        Ok(c) => c,
        Err(_) => return None,
    };

    let db_name = format!("test_mfa_api_{}", uuid::Uuid::new_v4().simple());
    let db = client.database(&db_name);
    if db.run_command(mongodb::bson::doc! { "ping": 1 }).await.is_err() {
        return None;
    }

    let store = AuthStore::from_mongo(db.clone());
    let _ = store.init_indexes().await;

    let tmp = tempdir().unwrap();
    let workspace_root = tmp.path().to_path_buf();
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_root.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = dam_hopper_server::agent_store::AgentStoreService::new(store_path);
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        TEST_SECRET.to_string(),
        fs,
        Some(store.clone()),
        false, // normal auth mode
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        TelemetryRuntime::new(),
    )
    .expect("Failed to create AppState");

    let raw_mfa_key = [0x77u8; 32];
    let mfa_key = MfaEncryptionKey::new(raw_mfa_key, "test-mfa-key");
    let clock = Arc::new(MockClock::new(Utc::now()));

    let auth_service = Arc::new(AuthService::new(
        Some(store.clone()),
        Some(mfa_key),
        clock.clone(),
    ));

    let state = state.with_auth_service(auth_service);
    let app = build_router(state);

    Some(TestFixture {
        app,
        db,
        store,
        clock,
        raw_mfa_key,
    })
}

#[tokio::test]
async fn test_full_enrollment_and_login_mfa_lifecycle() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test_full_enrollment_and_login_mfa_lifecycle: MongoDB unavailable");
        return;
    };

    // 1. Insert an enabled user without MFA
    let password_hash = hash("hunter2", DEFAULT_COST).unwrap();
    let test_user = UserRecord {
        id: None,
        username: "alice".to_string(),
        password_hash,
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(test_user)
        .await
        .unwrap();

    // 2. Login with wrong password -> 401 INVALID_CREDENTIALS
    let bad_login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "alice",
                "password": "wrong-password"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(bad_login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "INVALID_CREDENTIALS");

    // 3. Login with correct password -> 200 enrollmentRequired challenge
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "alice",
                "password": "hunter2"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers().get(header::SET_COOKIE).is_none(), "No cookie should be issued before MFA");
    assert_eq!(resp.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "enrollmentRequired");
    assert_eq!(json["authProtocol"], AUTH_PROTOCOL_VERSION);
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();
    assert!(!challenge_token.is_empty());

    // 4. Setup endpoint: fetch setup URI and secret
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let secret_base32 = json["secret"].as_str().unwrap().to_string();
    let otpauth_uri = json["otpauthUri"].as_str().unwrap().to_string();
    assert_eq!(json["issuer"], "DamHopper");
    assert_eq!(json["accountName"], "alice");
    assert!(otpauth_uri.contains("DamHopper"));
    assert!(otpauth_uri.contains(&secret_base32));

    // Repeat fetch returns the exact same secret
    let repeat_setup_req = Request::builder()
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
    let resp = fixture.app.clone().oneshot(repeat_setup_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let repeat_json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(repeat_json["secret"], secret_base32);

    // 5. Confirm with invalid code -> 401 INVALID_MFA_CODE
    let bad_confirm_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": "000000"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(bad_confirm_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "INVALID_MFA_CODE");

    // 6. Confirm with valid code -> 200 authenticated, token, and cookie
    let secret_raw = TotpEngine::base32_to_secret(&secret_base32).unwrap();
    let now_sec = (fixture.clock.now().timestamp()) as u64;
    let valid_code = TotpEngine::generate_code_at(&secret_raw, now_sec).unwrap();

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
    let cookie_hdr = resp
        .headers()
        .get(header::SET_COOKIE)
        .expect("Cookie must be set on confirmation")
        .to_str()
        .unwrap();
    assert!(cookie_hdr.contains("damhopper-auth="));

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "authenticated");
    let session_jwt = json["token"].as_str().unwrap().to_string();
    assert!(!session_jwt.is_empty());
    assert_eq!(json["user"], "alice");
    assert_eq!(json["role"], "user");
    assert!(json.get("expiresAt").is_some());
    assert!(json.get("mfaDueAt").is_some());

    // 7. Verify status with newly minted JWT -> 200 OK
    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {session_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["authenticated"], true);
    assert_eq!(json["user"], "alice");
    assert_eq!(json["authProtocol"], AUTH_PROTOCOL_VERSION);

    // 8. Subsequent login requires MFA code (mfaRequired state)
    let login_req2 = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "alice",
                "password": "hunter2"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req2).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "mfaRequired");
    let login_challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // 9. Replaying same TOTP code -> 401 REPLAYED_MFA_CODE
    let replayed_verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &login_challenge_token,
                "code": &valid_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(replayed_verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "REPLAYED_MFA_CODE");

    // 10. Advance clock by 30 seconds -> valid next TOTP step
    fixture.clock.advance(ChronoDuration::seconds(30));
    let next_sec = (fixture.clock.now().timestamp()) as u64;
    let next_code = TotpEngine::generate_code_at(&secret_raw, next_sec).unwrap();

    let valid_verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &login_challenge_token,
                "code": &next_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(valid_verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["state"], "authenticated");
    let session2_jwt = json["token"].as_str().unwrap().to_string();

    // 11. Step-up challenge flow
    let stepup_challenge_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {session2_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(stepup_challenge_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let stepup_token = json["challengeToken"].as_str().unwrap().to_string();

    // Step-up verification: advance clock 30s and submit valid code
    fixture.clock.advance(ChronoDuration::seconds(30));
    let stepup_sec = (fixture.clock.now().timestamp()) as u64;
    let stepup_code = TotpEngine::generate_code_at(&secret_raw, stepup_sec).unwrap();

    let stepup_verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &stepup_token,
                "code": &stepup_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(stepup_verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let rotated_jwt = json["token"].as_str().unwrap().to_string();

    // 12. Old pre-rotation JWT is now superseded (credentialVersion bumped)
    let old_jwt_status = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {session2_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(old_jwt_status).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "SESSION_REVOKED");

    // Fresh rotated JWT succeeds
    let new_jwt_status = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {rotated_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(new_jwt_status).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 13. Stale MFA status check: advance clock by 11 days (MFA due at day 10)
    fixture.clock.advance(ChronoDuration::days(11));
    let stale_status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {rotated_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(stale_status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["authenticated"], false);
    assert_eq!(json["code"], "MFA_REQUIRED");
    assert!(json.get("mfaDueAt").is_some());
    assert!(json.get("expiresAt").is_some());

    // 14. Logout succeeds even with stale MFA and revokes the session
    let logout_req = Request::builder()
        .method("POST")
        .uri("/api/auth/logout")
        .header(header::AUTHORIZATION, format!("Bearer {rotated_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(logout_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let cookie_clear = resp.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
    assert!(cookie_clear.contains("Max-Age=0"));

    // After logout, token is revoked
    let post_logout_status = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {rotated_jwt}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(post_logout_status).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "SESSION_REVOKED");
}

#[tokio::test]
async fn test_mfa_request_body_size_limit() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test_mfa_request_body_size_limit: MongoDB unavailable");
        return;
    };

    // Body larger than 16 KB should be rejected with 413 Payload Too Large
    let huge_token = "a".repeat(20 * 1024);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": huge_token
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_login_edge_cases_disabled_and_unregistered() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    // 1. Unregistered user -> 401 INVALID_CREDENTIALS
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "nonexistent",
                "password": "password123"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "INVALID_CREDENTIALS");

    // 2. Disabled account -> 401 ACCOUNT_DISABLED
    let password_hash = hash("secretpass", DEFAULT_COST).unwrap();
    let disabled_user = UserRecord {
        id: None,
        username: "charlie".to_string(),
        password_hash,
        is_enabled: false,
        role: UserRole::User,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(disabled_user)
        .await
        .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "charlie",
                "password": "secretpass"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "ACCOUNT_DISABLED");
}

#[tokio::test]
async fn test_step_up_rejected_when_session_expired() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    // Create user with confirmed MFA
    let password_hash = hash("hunter2", DEFAULT_COST).unwrap();
    let raw_secret = [0x55u8; 20];
    let mfa_key = MfaEncryptionKey::new(fixture.raw_mfa_key, "test-mfa-key");
    let (ciphertext, nonce) = mfa_key
        .encrypt("bob", "enrollment-confirmed", &raw_secret)
        .unwrap();

    let user = UserRecord {
        id: None,
        username: "bob".to_string(),
        password_hash,
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: Some(dam_hopper_server::auth::model::MfaConfirmed {
            secret_ciphertext: ciphertext,
            nonce,
            key_id: "test-mfa-key".to_string(),
            enrolled_at: dam_hopper_server::auth::model::chrono_to_bson(fixture.clock.now()),
            last_accepted_step: 10,
        }),
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(user)
        .await
        .unwrap();

    // Login and get MFA challenge
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "bob",
                "password": "hunter2"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap();

    // Advance clock to step 20 (advance 30 seconds)
    fixture.clock.advance(ChronoDuration::seconds(30));
    let now_sec = (fixture.clock.now().timestamp()) as u64;
    let valid_code = TotpEngine::generate_code_at(&raw_secret, now_sec).unwrap();

    let verify_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": challenge_token,
                "code": valid_code
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(verify_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let token = json["token"].as_str().unwrap().to_string();

    // Advance clock past 30 days (day 31)
    fixture.clock.advance(ChronoDuration::days(31));

    // Status -> 401 SESSION_EXPIRED
    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "SESSION_EXPIRED");

    // Step-up challenge -> 401 SESSION_EXPIRED
    let challenge_req = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(challenge_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "SESSION_EXPIRED");
}

#[tokio::test]
async fn test_status_with_legacy_v1_jwt_is_rejected() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    // Mint legacy V1 claims: { "sub": "alice", "exp": ... } without v: 2, sid, etc.
    #[derive(serde::Serialize)]
    struct LegacyClaims {
        sub: String,
        exp: usize,
    }
    let legacy_claims = LegacyClaims {
        sub: "alice".to_string(),
        exp: (fixture.clock.now().timestamp() + 3600) as usize,
    };
    let legacy_token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &legacy_claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap();

    let status_req = Request::builder()
        .method("GET")
        .uri("/api/auth/status")
        .header(header::AUTHORIZATION, format!("Bearer {legacy_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(status_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "AUTH_REQUIRED");
}

#[tokio::test]
async fn test_concurrent_enrollment_cas_failure() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let password_hash = hash("hunter2", DEFAULT_COST).unwrap();
    let user = UserRecord {
        id: None,
        username: "dave".to_string(),
        password_hash,
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(user)
        .await
        .unwrap();

    // 1. Login to get enrollment challenge
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "dave",
                "password": "hunter2"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // 2. Fetch setup secret
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
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let secret_base32 = json["secret"].as_str().unwrap().to_string();
    let secret_raw = TotpEngine::base32_to_secret(&secret_base32).unwrap();
    let valid_code = TotpEngine::generate_code_at(&secret_raw, fixture.clock.now().timestamp() as u64).unwrap();

    // 3. Simulate concurrent reset or competing setup that increments authVersion
    fixture
        .db
        .collection::<mongodb::bson::Document>("users")
        .update_one(
            mongodb::bson::doc! { "username": "dave" },
            mongodb::bson::doc! { "$inc": { "authVersion": 1 } },
        )
        .await
        .unwrap();

    // 4. Confirmation should fail with 401 CHALLENGE_EXPIRED or 409 CONFLICT
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
    assert!(
        resp.status() == StatusCode::CONFLICT || resp.status() == StatusCode::UNAUTHORIZED,
        "Concurrent authVersion change must fail confirmation"
    );
}

#[tokio::test]
async fn test_mfa_rate_limiting_locks_out_after_10_failed_attempts() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    let password_hash = hash("hunter2", DEFAULT_COST).unwrap();
    let user = UserRecord {
        id: None,
        username: "eve".to_string(),
        password_hash,
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(user)
        .await
        .unwrap();

    // Submit wrong password or wrong code to hit rate limits
    for _ in 0..10 {
        let bad_login = Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "username": "eve",
                    "password": "wrong-password"
                }))
                .unwrap(),
            ))
            .unwrap();
        let resp = fixture.app.clone().oneshot(bad_login).await.unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    // 11th attempt must be 429 Too Many Requests
    let locked_login = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "eve",
                "password": "hunter2" // Even with correct password, account is locked!
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(locked_login).await.unwrap();
    assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(resp.headers().get(header::RETRY_AFTER).is_some());
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "RATE_LIMITED");
}

#[tokio::test]
async fn test_consumed_challenge_cannot_be_reused_to_mint_another_session() {
    let Some(fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB unavailable");
        return;
    };

    // Create user with confirmed MFA
    let password_hash = hash("hunter2", DEFAULT_COST).unwrap();
    let raw_secret = [0x88u8; 20];
    let mfa_key = MfaEncryptionKey::new(fixture.raw_mfa_key, "test-mfa-key");
    let (ciphertext, nonce) = mfa_key
        .encrypt("frank", "enrollment-confirmed", &raw_secret)
        .unwrap();

    let user = UserRecord {
        id: None,
        username: "frank".to_string(),
        password_hash,
        is_enabled: true,
        role: UserRole::User,
        auth_version: 1,
        mfa: Some(dam_hopper_server::auth::model::MfaConfirmed {
            secret_ciphertext: ciphertext,
            nonce,
            key_id: "test-mfa-key".to_string(),
            enrolled_at: dam_hopper_server::auth::model::chrono_to_bson(fixture.clock.now()),
            last_accepted_step: 0,
        }),
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(user)
        .await
        .unwrap();

    // Login -> get challenge token
    let login_req = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": "frank",
                "password": "hunter2"
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    let challenge_token = json["challengeToken"].as_str().unwrap().to_string();

    // Advance clock 30s and submit valid code
    fixture.clock.advance(ChronoDuration::seconds(30));
    let code_1 = TotpEngine::generate_code_at(&raw_secret, fixture.clock.now().timestamp() as u64).unwrap();

    let verify_req_1 = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": &code_1
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp_1 = fixture.app.clone().oneshot(verify_req_1).await.unwrap();
    assert_eq!(resp_1.status(), StatusCode::OK);

    // Now advance clock another 30s and try reusing the SAME challenge token with a fresh valid code
    fixture.clock.advance(ChronoDuration::seconds(30));
    let code_2 = TotpEngine::generate_code_at(&raw_secret, fixture.clock.now().timestamp() as u64).unwrap();

    let verify_req_2 = Request::builder()
        .method("POST")
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": &challenge_token,
                "code": &code_2
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp_2 = fixture.app.clone().oneshot(verify_req_2).await.unwrap();
    assert_eq!(resp_2.status(), StatusCode::UNAUTHORIZED);
    let body_2 = axum::body::to_bytes(resp_2.into_body(), usize::MAX).await.unwrap();
    let json_2: Value = serde_json::from_slice(&body_2).unwrap();
    assert_eq!(json_2["code"], "CHALLENGE_EXPIRED");
}
