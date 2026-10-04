use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use dam_hopper_server::advisor::AdvisorService;
use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router;
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::auth::model::{
    AuthClaims, AuthSession, UserRecord, UserRole, chrono_to_bson,
};
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
    WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::TunnelSessionManager;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tempfile::TempDir;
use tower::ServiceExt;

const TEST_JWT_SECRET: &str = "test-jwt-secret-key-32bytes-long!";

fn generate_auth_token(subject: &str, sid: &str) -> String {
    let now = chrono::Utc::now();
    let claims = AuthClaims {
        v: 2,
        sub: subject.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: (now.timestamp() + 3600) as usize,
    };
    claims.encode(TEST_JWT_SECRET).unwrap()
}

fn copy_dir_all(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap().flatten() {
        let ty = entry.file_type().unwrap();
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()));
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name())).unwrap();
        }
    }
}

fn setup_test_home(temp_dir: &TempDir) -> PathBuf {
    let home = temp_dir.path().join("home");
    let target = home.join(".evcrate").join("advisor-history");
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_history = manifest_dir.join("../__fixtures__/native-advisor/advisor-history");
    copy_dir_all(&fixture_history, &target);
    home
}

async fn create_harness(
    temp_dir: &TempDir,
    no_auth: bool,
    role: UserRole,
    home_dir: Option<PathBuf>,
) -> (axum::Router, AppState) {
    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let dummy_driver = Arc::new(dam_hopper_server::tunnel::CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);

    let config_path = temp_dir.path().join("dam-hopper.toml");
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: temp_dir.path().display().to_string(),
        },
        agent_store: None,
        server: Default::default(),
        projects: vec![ProjectConfig {
            name: "test-project".into(),
            path: temp_dir.path().join("proj").display().to_string(),
            project_type: ProjectType::Npm,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 0,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: config_path.clone(),
    };
    dam_hopper_server::config::write_config(&config_path, &config).unwrap();

    let diagnostics = DiagnosticStore::new(temp_dir.path().join("diag.jsonl"));
    let mut state = AppState::new(
        temp_dir.path().to_path_buf(),
        config,
        GlobalConfig::default(),
        pty_manager,
        AgentStoreService::new(temp_dir.path().join("store")),
        event_sink,
        TEST_JWT_SECRET.to_string(),
        FsSubsystem::new(vec![]),
        None, // No MongoDB
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();

    if let Some(h) = home_dir {
        state = state.with_advisor_service(Arc::new(AdvisorService::new(Some(h))));
    }

    if !no_auth {
        let now = chrono::Utc::now();
        let exp = chrono::DateTime::from_timestamp((now.timestamp() + 3600) as i64, 0).unwrap();
        let username = match role {
            UserRole::Admin => "admin-user",
            UserRole::User => "normal-user",
        };
        let sid = match role {
            UserRole::Admin => "session-admin",
            UserRole::User => "session-normal",
        };
        let user = UserRecord {
            id: None,
            username: username.to_string(),
            password_hash: String::new(),
            is_enabled: true,
            role,
            auth_version: 0,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        };
        let session = AuthSession {
            id: sid.to_string(),
            username: username.to_string(),
            auth_version: 0,
            credential_version: 0,
            issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(exp),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
        };
        let auth_service = Arc::new(AuthService::new_mock(user, session));
        state = state.with_auth_service(auth_service);
    }

    let router = build_router(state.clone());
    (router, state)
}

#[tokio::test]
async fn test_advisor_no_auth_denied() {
    let temp_dir = TempDir::new().unwrap();
    let (router, _state) = create_harness(&temp_dir, true, UserRole::Admin, None).await;

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "NoAuthForbidden");
}

#[tokio::test]
async fn test_advisor_unauthenticated_denied() {
    let temp_dir = TempDir::new().unwrap();
    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, None).await;

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_advisor_non_admin_denied() {
    let temp_dir = TempDir::new().unwrap();
    let (router, _state) = create_harness(&temp_dir, false, UserRole::User, None).await;
    let token = generate_auth_token("normal-user", "session-normal");

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "AdminRoleRequired");
}
#[tokio::test]
async fn test_advisor_cookie_session_allowed() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let token = generate_auth_token("admin-user", "session-admin");

    // Ordinary validated session via cookie must be accepted (not rejected with BearerRequired)
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .header(header::COOKIE, format!("damhopper-auth={token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status_json["available"], true);
}

#[tokio::test]
async fn test_advisor_status_and_toggle_when_disabled() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, state) = create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let token = generate_auth_token("admin-user", "session-admin");

    // 1. GET /api/advisor/status succeeds when disabled
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status_json["enabled"], false);
    assert_eq!(status_json["available"], true);

    // 2. Data endpoint returns 403 ADVISOR_DISABLED when disabled
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/refresh")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let disabled_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(disabled_json["error"], "ADVISOR_DISABLED");

    // 3. Admin can PATCH /api/advisor/settings to enable
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let settings_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(settings_json["enabled"], true);

    // 4. Verify persisted to dam-hopper.toml
    let toml_str = fs::read_to_string(&state.config.read().await.config_path).unwrap();
    assert!(toml_str.contains("[server.advisor]"));
    assert!(toml_str.contains("enabled = true"));
}

#[tokio::test]
async fn test_advisor_history_lifecycle_against_fixtures() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let token = generate_auth_token("admin-user", "session-admin");

    // Enable advisor first
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 1. POST /api/advisor/history/refresh
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/refresh")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let refresh_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(refresh_json["state"], "fresh");
    assert_eq!(refresh_json["scan"]["acceptedRecords"], 3);
    assert_eq!(refresh_json["scan"]["invalidRecords"], 2);
    let snapshot_id = refresh_json["snapshotId"].as_str().unwrap().to_string();

    // 2. POST /api/advisor/history/summary
    let summary_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "query": {}
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/summary")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(summary_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let summary_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(summary_json["metrics"]["totalConsultations"], 3);
    assert_eq!(summary_json["metrics"]["adviceReadyCount"], 2);
    assert_eq!(summary_json["metrics"]["resolvedCount"], 1);
    assert_eq!(summary_json["metrics"]["missingOutcomeCount"], 1);

    // 3. POST /api/advisor/history/page (page 1, limit 2)
    let page1_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "query": {},
        "sort": "started_at_desc",
        "limit": 2
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/page")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(page1_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let page1_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(page1_json["entries"].as_array().unwrap().len(), 2);
    let next_cursor = page1_json["nextCursor"].as_str().unwrap().to_string();

    // 4. POST /api/advisor/history/page (page 2 with cursor)
    let page2_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "query": {},
        "sort": "started_at_desc",
        "cursor": next_cursor,
        "limit": 2
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/page")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(page2_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let page2_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let page2_entries = page2_json["entries"].as_array().unwrap();
    assert_eq!(page2_entries.len(), 1);
    assert!(page2_json["nextCursor"].is_null());

    let valid_row = &page2_entries[0];
    assert_eq!(valid_row["outcomeState"], "valid");
    let record_ref = valid_row["recordRef"].as_str().unwrap().to_string();

    // 5. POST /api/advisor/history/detail (valid record)
    let detail_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "recordRef": record_ref
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/detail")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(detail_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let detail_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(detail_json["status"], "ready");
    assert!(detail_json["detailRevision"].is_string());
    assert_eq!(detail_json["detailRevision"].as_str().unwrap().len(), 64);
    assert!(detail_json["execution"].is_object());
    assert!(detail_json["outcome"].is_object());

    // 6. POST /api/advisor/history/detail (nonexistent record)
    let missing_detail_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "recordRef": "00000000000000000000000000000000"
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/detail")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(missing_detail_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_advisor_symlink_rejection_in_api() {
    let temp_dir = TempDir::new().unwrap();
    let home = temp_dir.path().join("home");
    let real_history = temp_dir.path().join("real_history");
    fs::create_dir_all(&real_history).unwrap();

    let dot_evcrate = home.join(".evcrate");
    fs::create_dir_all(&dot_evcrate).unwrap();
    let symlink_path = dot_evcrate.join("advisor-history");

    #[cfg(unix)]
    std::os::unix::fs::symlink(&real_history, &symlink_path).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&real_history, &symlink_path).unwrap();

    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let token = generate_auth_token("admin-user", "session-admin");

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status_json["available"], false);
    assert_eq!(
        status_json["sourceError"],
        "History root must be a real directory; symlink rejected"
    );
}

#[tokio::test]
async fn test_advisor_disable_clears_snapshots() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let token = generate_auth_token("admin-user", "session-admin");

    // 1. Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // 2. Refresh to create a snapshot
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/refresh")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let refresh_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let snapshot_id = refresh_json["snapshotId"].as_str().unwrap().to_string();

    // 3. Disable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": false}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // 4. Re-enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // 5. Query old snapshot -> 404 SnapshotNotFound
    let summary_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "query": {}
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/summary")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(summary_payload.to_string()))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_advisor_default_app_state_uses_effective_home() {
    let temp_dir = tempfile::tempdir().unwrap();
    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, None).await;
    let token = generate_auth_token("admin-user", "session-admin");

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    // Status responds with valid JSON schema
    assert!(status_json.get("enabled").is_some());
    assert!(status_json.get("available").is_some());
}

#[tokio::test]
async fn test_advisor_refresh_and_query_by_project_label() {
    let temp_dir = tempfile::tempdir().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state) = create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let token = generate_auth_token("admin-user", "session-admin");
    // 0. Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 1. Refresh with project label "Project Alpha"
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/refresh")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"projectId": "Project Alpha"}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let refresh_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(refresh_json["scan"]["projectsDiscovered"], 1);
    assert!(refresh_json["scan"]["acceptedRecords"].as_u64().unwrap() > 0);
    let snapshot_id = refresh_json["snapshotId"].as_str().unwrap();

    // 2. Query summary with project label "Project Alpha"
    let summary_payload = serde_json::json!({
        "snapshotId": snapshot_id,
        "query": {
            "projectId": "Project Alpha"
        }
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/summary")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(summary_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let summary_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        summary_json["metrics"]["totalConsultations"]
            .as_u64()
            .unwrap()
            > 0
    );
}

#[tokio::test]
async fn test_advisor_routing_endpoints_auth_matrix() {
    let temp_dir = TempDir::new().unwrap();

    // 1. no_auth mode: both PATCH /policy and POST /models return 403 NoAuthForbidden
    let (router_no_auth, _state) = create_harness(&temp_dir, true, UserRole::Admin, None).await;

    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"expectedRevision":"none","advisor":{"primary":{"backend":"codex","model":"m1","effort":"high"},"backup":{"backend":"omp","model":"openai/m2","effort":"low"}}}"#))
        .unwrap();
    let resp = router_no_auth.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"codex"}"#))
        .unwrap();
    let resp = router_no_auth.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 2. unauthenticated: returns 401 Unauthorized
    let (router_auth, _state) = create_harness(&temp_dir, false, UserRole::Admin, None).await;

    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"expectedRevision":"none","advisor":{"primary":{"backend":"codex","model":"m1","effort":"high"},"backup":{"backend":"omp","model":"openai/m2","effort":"low"}}}"#))
        .unwrap();
    let resp = router_auth.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"codex"}"#))
        .unwrap();
    let resp = router_auth.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 3. non-admin: returns 403 AdminRoleRequired
    let (router_user, _state) = create_harness(&temp_dir, false, UserRole::User, None).await;
    let user_token = generate_auth_token("normal-user", "session-normal");

    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"expectedRevision":"none","advisor":{"primary":{"backend":"codex","model":"m1","effort":"high"},"backup":{"backend":"omp","model":"openai/m2","effort":"low"}}}"#))
        .unwrap();
    let resp = router_user.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"codex"}"#))
        .unwrap();
    let resp = router_user.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 4. cookie session for admin succeeds
    let home = setup_test_home(&temp_dir);
    let (router_cookie, _state) =
        create_harness(&temp_dir, false, UserRole::Admin, Some(home)).await;
    let admin_token = generate_auth_token("admin-user", "session-admin");

    // Enable advisor first via cookie
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::COOKIE, format!("damhopper-auth={admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled":true}"#))
        .unwrap();
    let resp = router_cookie.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // POST /api/advisor/models via cookie
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::COOKIE, format!("damhopper-auth={admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"codex"}"#))
        .unwrap();
    let resp = router_cookie.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_advisor_routing_with_missing_history_directory() {
    let temp_dir = TempDir::new().unwrap();
    let home = temp_dir.path().join("home");
    let dot_evcrate = home.join(".evcrate");
    std::fs::create_dir_all(&dot_evcrate).unwrap();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_policy = manifest_dir.join("../__fixtures__/native-advisor/advisor-routing.json");
    std::fs::copy(&fixture_policy, dot_evcrate.join("advisor-routing.json")).unwrap();
    // Note: No history directory is created!

    let (router, _state) =
        create_harness(&temp_dir, false, UserRole::Admin, Some(home.clone())).await;
    let token = generate_auth_token("admin-user", "session-admin");

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled":true}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 1. History refresh responds without crashing, discover projects finds 0 records
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/history/refresh")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let refresh_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(refresh_json["scan"]["acceptedRecords"], 0);

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/advisor/status")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let status_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(status_json["available"], false); // History source unavailable
    assert_eq!(status_json["enabled"], true); // But admin enabled
    // 2. Discover models works
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"omp"}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let models_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(models_json["backend"], "omp");
    assert!(!models_json["models"].as_array().unwrap().is_empty());

    // 3. Read current policy (POST /api/advisor/policy/current)
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/policy/current")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let policy_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(policy_json["status"], "ready");
    let current_revision = policy_json["revision"].as_str().unwrap().to_string();

    // 4. Update policy works even without history directory
    let update_body = serde_json::json!({
        "expectedRevision": current_revision,
        "advisor": {
            "primary": {
                "backend": "codex",
                "model": "gpt-updated-model",
                "effort": "high"
            },
            "backup": {
                "backend": "omp",
                "model": "openai/gpt-backup-model",
                "effort": "low"
            }
        }
    });
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(update_body.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024)
        .await
        .unwrap();
    let updated_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(updated_json["status"], "ready");
    assert_eq!(
        updated_json["policy"]["advisor"]["primary"]["model"],
        "gpt-updated-model"
    );
}
