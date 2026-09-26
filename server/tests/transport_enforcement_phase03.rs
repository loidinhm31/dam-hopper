use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use bcrypt::{hash, DEFAULT_COST};
use chrono::{Duration as ChronoDuration, Utc};
use dam_hopper_server::api::build_router;
use dam_hopper_server::api::ws::{
    CLOSE_AUTH_UNAVAILABLE, CLOSE_FULL_LOGIN_REQUIRED, CLOSE_MFA_REQUIRED, CLOSE_OVERFLOW,
};
use dam_hopper_server::auth::model::{UserRecord, UserRole};
use dam_hopper_server::auth::policy::MockClock;
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
    state: AppState,
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

    let db_name = format!("test_transport_p3_{}", uuid::Uuid::new_v4().simple());
    let db = client.database(&db_name);
    if db.run_command(mongodb::bson::doc! { "ping": 1 }).await.is_err() {
        return None;
    }

    let store = AuthStore::new(db.clone());
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
        Some(db.clone()),
        false, // authenticated mode
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
    let app = build_router(state.clone());

    Some(TestFixture {
        app,
        state,
        db,
        store,
        clock,
        raw_mfa_key,
    })
}

async fn enroll_user(fixture: &mut TestFixture, username: &str, password: &str) -> (String, String) {
    let now = fixture.clock.now();
    let password_hash = hash(password, DEFAULT_COST).unwrap();

    let user_record = UserRecord {
        id: None,
        username: username.to_string(),
        password_hash,
        is_enabled: true,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    fixture
        .db
        .collection::<UserRecord>("users")
        .insert_one(user_record)
        .await
        .unwrap();

    let login_req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "username": username,
                "password": password
            }))
            .unwrap(),
        ))
        .unwrap();

    let login_resp = fixture.app.clone().oneshot(login_req).await.unwrap();
    assert_eq!(login_resp.status(), StatusCode::OK);
    let login_bytes = axum::body::to_bytes(login_resp.into_body(), 1024 * 1024).await.unwrap();
    let login_json: Value = serde_json::from_slice(&login_bytes).unwrap();
    assert_eq!(login_json["state"], "enrollmentRequired");
    let challenge_token = login_json["challengeToken"].as_str().unwrap().to_string();

    let setup_req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/mfa/setup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": challenge_token
            }))
            .unwrap(),
        ))
        .unwrap();

    let setup_resp = fixture.app.clone().oneshot(setup_req).await.unwrap();
    assert_eq!(setup_resp.status(), StatusCode::OK);
    let setup_bytes = axum::body::to_bytes(setup_resp.into_body(), 1024 * 1024).await.unwrap();
    let setup_json: Value = serde_json::from_slice(&setup_bytes).unwrap();
    let secret = setup_json["secret"].as_str().unwrap().to_string();
    let secret_raw = TotpEngine::base32_to_secret(&secret).unwrap();
    let now_sec = now.timestamp() as u64;
    let code = TotpEngine::generate_code_at(&secret_raw, now_sec).unwrap();

    let confirm_req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/mfa/confirm")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": challenge_token,
                "code": code
            }))
            .unwrap(),
        ))
        .unwrap();

    let confirm_resp = fixture.app.clone().oneshot(confirm_req).await.unwrap();
    assert_eq!(confirm_resp.status(), StatusCode::OK);
    let confirm_bytes = axum::body::to_bytes(confirm_resp.into_body(), 1024 * 1024).await.unwrap();
    let confirm_json: Value = serde_json::from_slice(&confirm_bytes).unwrap();
    assert_eq!(confirm_json["state"], "authenticated");
    let token = confirm_json["token"].as_str().unwrap().to_string();

    (token, secret)
}

#[tokio::test]
async fn test_shared_policy_admission_and_legacy_token_rejection() {
    let Some(mut fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB not available");
        return;
    };

    let (valid_token, secret) = enroll_user(&mut fixture, "alice", "hunter2!pass").await;

    // 1. Valid V2 token is admitted to protected route (/api/workspace/status)
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 2. Legacy V1 token without V2 claims is rejected with 401 AUTH_REQUIRED
    #[derive(serde::Serialize)]
    struct LegacyClaims {
        sub: String,
        exp: usize,
    }
    let legacy_claims = LegacyClaims {
        sub: "alice".to_string(),
        exp: (Utc::now().timestamp() as usize) + 3600,
    };
    let legacy_token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &legacy_claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap();

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {legacy_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "AUTH_REQUIRED");

    // 3. Corrupted token format is rejected with 401 AUTH_REQUIRED
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, "Bearer not.a.valid.jwt")
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 4. Advance clock by 11 days (past 10-day periodic MFA window)
    fixture.clock.advance(ChronoDuration::days(11));

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "MFA_REQUIRED");

    // 5. Step-up MFA verification rotates credential_version
    let challenge_req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/mfa/challenge")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let challenge_resp = fixture.app.clone().oneshot(challenge_req).await.unwrap();
    assert_eq!(challenge_resp.status(), StatusCode::OK);
    let ch_bytes = axum::body::to_bytes(challenge_resp.into_body(), 1024 * 1024).await.unwrap();
    let ch_json: Value = serde_json::from_slice(&ch_bytes).unwrap();
    let step_token = ch_json["challengeToken"].as_str().unwrap();

    let now = fixture.clock.now();
    let secret_raw = TotpEngine::base32_to_secret(&secret).unwrap();
    let now_sec = now.timestamp() as u64;
    let code = TotpEngine::generate_code_at(&secret_raw, now_sec).unwrap();
    let verify_req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/mfa/verify")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "challengeToken": step_token,
                "code": code
            }))
            .unwrap(),
        ))
        .unwrap();
    let verify_resp = fixture.app.clone().oneshot(verify_req).await.unwrap();
    assert_eq!(verify_resp.status(), StatusCode::OK);
    let v_bytes = axum::body::to_bytes(verify_resp.into_body(), 1024 * 1024).await.unwrap();
    let v_json: Value = serde_json::from_slice(&v_bytes).unwrap();
    let new_token = v_json["token"].as_str().unwrap().to_string();

    // New token works
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {new_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Old token with old credentialVersion is rejected with SESSION_REVOKED
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "SESSION_REVOKED");

    // 6. Advance clock past 30 days (absolute expiration)
    fixture.clock.advance(ChronoDuration::days(25)); // 11 + 25 = 36 days total
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {new_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "SESSION_EXPIRED");
}

#[tokio::test]
async fn test_out_of_band_reset_and_disabled_account() {
    let Some(mut fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB not available");
        return;
    };

    let (valid_token, _) = enroll_user(&mut fixture, "bob", "hunter2!pass").await;

    // 1. Verify access works initially
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 2. Direct out-of-band MongoDB account reset (increments authVersion to 1)
    let users_col = fixture.db.collection::<mongodb::bson::Document>("users");
    users_col
        .update_one(
            mongodb::bson::doc! { "username": "bob" },
            mongodb::bson::doc! { "$inc": { "authVersion": 1 } },
        )
        .await
        .unwrap();

    // Active token with authVersion 0 is now rejected with SESSION_REVOKED
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "SESSION_REVOKED");

    // 3. Disable account (isEnabled: false)
    users_col
        .update_one(
            mongodb::bson::doc! { "username": "bob" },
            mongodb::bson::doc! { "$set": { "isEnabled": false } },
        )
        .await
        .unwrap();

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "ACCOUNT_DISABLED");
}

#[tokio::test]
async fn test_websocket_admission_and_close_code_invariants() {
    assert_eq!(CLOSE_OVERFLOW, 4001);
    assert_eq!(CLOSE_MFA_REQUIRED, 4403);
    assert_eq!(CLOSE_FULL_LOGIN_REQUIRED, 4401);
    assert_eq!(CLOSE_AUTH_UNAVAILABLE, 1013);

    let Some(mut fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB not available");
        return;
    };

    let (valid_token, _) = enroll_user(&mut fixture, "carol", "hunter2!pass").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = fixture.app.clone();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

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

    // 1. WS handshake without token -> 401 UNAUTHORIZED
    let url = format!("ws://{}/ws", addr);
    let err = ws_connect(&url).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
        other => panic!("Expected HTTP 401 error, got: {:?}", other),
    }
    // 2. WS handshake with legacy V1 token -> 401 UNAUTHORIZED
    #[derive(serde::Serialize)]
    struct LegacyClaims {
        sub: String,
        exp: usize,
    }
    let legacy_claims = LegacyClaims {
        sub: "carol".to_string(),
        exp: (Utc::now().timestamp() as usize) + 3600,
    };
    let legacy_token = jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &legacy_claims,
        &jsonwebtoken::EncodingKey::from_secret(TEST_SECRET.as_bytes()),
    )
    .unwrap();
    let legacy_url = format!("ws://{}/ws?token={}", addr, legacy_token);
    let err = ws_connect(&legacy_url).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
        other => panic!("Expected HTTP 401 error, got: {:?}", other),
    }

    // 3. WS handshake with valid token succeeds!
    let valid_url = format!("ws://{}/ws?token={}", addr, valid_token);
    let (_ws, resp) = ws_connect(&valid_url)
        .await
        .expect("WS connect should succeed with valid token");
    assert_eq!(resp.status(), StatusCode::SWITCHING_PROTOCOLS);

    // 4. WS handshake after MFA freshness lapses (advance 12 days) -> 401 UNAUTHORIZED
    fixture.clock.advance(ChronoDuration::days(12));
    let err = ws_connect(&valid_url).await.unwrap_err();
    match err {
        tokio_tungstenite::tungstenite::Error::Http(resp) => {
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
        }
        other => panic!("Expected HTTP 401 error, got: {:?}", other),
    }
}
#[tokio::test]
async fn test_logout_revokes_session_durable() {
    let Some(mut fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB not available");
        return;
    };

    let (valid_token, _) = enroll_user(&mut fixture, "eve", "hunter2!pass").await;

    // Access works before logout
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Call logout
    let logout_req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/logout")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let logout_resp = fixture.app.clone().oneshot(logout_req).await.unwrap();
    assert_eq!(logout_resp.status(), StatusCode::OK);

    // Access denied after logout with SESSION_REVOKED
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/workspace/status")
        .header(header::AUTHORIZATION, format!("Bearer {valid_token}"))
        .body(Body::empty())
        .unwrap();
    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    let bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "SESSION_REVOKED");
}

#[tokio::test]
async fn test_websocket_live_revocation_closes_connection() {
    use futures_util::StreamExt;

    let Some(mut fixture) = setup_fixture().await else {
        eprintln!("Skipping test: MongoDB not available");
        return;
    };

    let (valid_token, _) = enroll_user(&mut fixture, "frank", "hunter2!pass").await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = fixture.app.clone();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

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

    let valid_url = format!("ws://{}/ws?token={}", addr, valid_token);
    let (mut ws, resp) = ws_connect(&valid_url)
        .await
        .expect("WS connect should succeed with valid token");
    assert_eq!(resp.status(), StatusCode::SWITCHING_PROTOCOLS);

    let claims = dam_hopper_server::auth::model::AuthClaims::decode(&valid_token, TEST_SECRET).unwrap();

    // Revoke the session in MongoDB
    fixture
        .store
        .revoke_session(&claims.sid, Utc::now())
        .await
        .unwrap();

    // Within bounded polling window (<= 7s), background watcher must close socket with 4401
    let close_msg = tokio::time::timeout(std::time::Duration::from_secs(8), ws.next())
        .await
        .expect("Server must send close frame within 8s")
        .expect("Stream should not terminate without frame")
        .expect("Valid message expected");

    match close_msg {
        tokio_tungstenite::tungstenite::Message::Close(Some(frame)) => {
            assert_eq!(
                frame.code,
                tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(
                    CLOSE_FULL_LOGIN_REQUIRED
                )
            );
            assert!(frame.reason.contains("Session revoked") || frame.reason.contains("modified"));
        }
        other => panic!("Expected Close frame with code 4401, got: {:?}", other),
    }
}
