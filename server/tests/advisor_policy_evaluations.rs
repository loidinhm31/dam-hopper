use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use dam_hopper_server::advisor::AdvisorService;
use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::AuthService;
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
    let dot_evcrate = home.join(".evcrate");
    fs::create_dir_all(&dot_evcrate).unwrap();

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_root = manifest_dir.join("../__fixtures__/native-advisor");

    // Copy policy
    fs::copy(
        fixture_root.join("advisor-routing.json"),
        dot_evcrate.join("advisor-routing.json"),
    )
    .unwrap();

    // Copy evaluations
    let target_eval = dot_evcrate.join("advisor-evaluations");
    copy_dir_all(&fixture_root.join("advisor-evaluations"), &target_eval);

    home
}

async fn create_harness(
    temp_dir: &TempDir,
    home_dir: PathBuf,
) -> (axum::Router, AppState, String) {
    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let dummy_driver = Arc::new(dam_hopper_server::tunnel::CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);

    let proj_dir = temp_dir.path().join("test-proj");
    fs::create_dir_all(&proj_dir).unwrap();

    let config_path = temp_dir.path().join("dam-hopper.toml");
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: temp_dir.path().display().to_string(),
        },
        agent_store: None,
        server: Default::default(),
        projects: vec![ProjectConfig {
            name: "test-proj".into(),
            path: proj_dir.display().to_string(),
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
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();

    state = state.with_advisor_service(Arc::new(AdvisorService::new(Some(home_dir))));

    let now = chrono::Utc::now();
    let exp = chrono::DateTime::from_timestamp((now.timestamp() + 3600) as i64, 0).unwrap();
    let user = UserRecord {
        id: None,
        username: "admin-user".to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role: UserRole::Admin,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session = AuthSession {
        id: "session-admin".to_string(),
        username: "admin-user".to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
    };
    let auth_service = Arc::new(AuthService::new_mock(user, session));
    state = state.with_auth_service(auth_service);

    let token = generate_auth_token("admin-user", "session-admin");
    let router = build_router(state.clone());
    (router, state, token)
}

#[tokio::test]
async fn test_policy_and_evaluations_disabled_denied() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // 1. Policy endpoint returns 403 ADVISOR_DISABLED
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/policy/current")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "ADVISOR_DISABLED");

    // 2. Evaluations list endpoint returns 403 ADVISOR_DISABLED
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/list")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "ADVISOR_DISABLED");
}

#[tokio::test]
async fn test_policy_current_admin_flow() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // POST /api/advisor/policy/current
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/policy/current")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ready");
    assert_eq!(json["scope"], "account");
    assert_eq!(json["temporal"], "current");
    assert_eq!(json["policy"]["version"], 2);
    assert_eq!(json["policy"]["advisor"]["primary"]["backend"], "codex");
    assert_eq!(json["policy"]["advisor"]["backup"]["backend"], "omp");
}

#[tokio::test]
async fn test_evaluations_list_read_compare_flow() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // 1. POST /api/advisor/evaluations/list
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/list")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let list_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(list_json["status"], "ready");
    let items = list_json["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);

    let item_a = items.iter().find(|i| i["evaluationRef"] == "eval-group-a").unwrap();
    assert_eq!(item_a["candidateCount"], 2);
    assert_eq!(item_a["caseCount"], 2);
    let digest_a = item_a["sourceDigest"].as_str().unwrap().to_string();

    let item_b = items.iter().find(|i| i["evaluationRef"] == "eval-group-b").unwrap();
    assert_eq!(item_b["caseCount"], 9);
    let digest_b = item_b["sourceDigest"].as_str().unwrap().to_string();

    // 2. POST /api/advisor/evaluations/read (matching revision)
    let read_payload = serde_json::json!({
        "evaluationRef": "eval-group-a",
        "expectedRevision": digest_a
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/read")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(read_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let read_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(read_json["status"], "ready");
    assert_eq!(read_json["document"]["evaluation_id"], "eval-valid-mixed-001");

    // 3. POST /api/advisor/evaluations/read (mismatched revision -> changed)
    let read_changed_payload = serde_json::json!({
        "evaluationRef": "eval-group-a",
        "expectedRevision": "0".repeat(64)
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/read")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(read_changed_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let changed_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(changed_json["status"], "changed");
    assert_eq!(changed_json["observedRevision"], digest_a);

    // 4. POST /api/advisor/evaluations/compare
    let compare_payload = serde_json::json!({
        "items": [
            { "evaluationRef": "eval-group-a", "expectedRevision": digest_a },
            { "evaluationRef": "eval-group-b", "expectedRevision": digest_b }
        ],
        "limit": 10
    });
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/compare")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(compare_payload.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let compare_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(compare_json["status"], "ready");
    assert_eq!(compare_json["sourceRevisions"].as_array().unwrap().len(), 2);
    assert!(!compare_json["groups"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn test_evaluations_project_discovery_and_deduplication() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // Set up project fixture directory under test-proj
    let proj_fixture_dir = temp_dir
        .path()
        .join("test-proj")
        .join("tests")
        .join("fixtures")
        .join("advisor-evaluations");
    fs::create_dir_all(&proj_fixture_dir).unwrap();

    // 1. Duplicate fixture from HOME (should be deduplicated by ref: first-wins)
    let src_fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../__fixtures__/native-advisor/advisor-evaluations/eval-group-a.json");
    fs::copy(&src_fixture, proj_fixture_dir.join("eval-group-a.json")).unwrap();

    // 2. Custom fixture only present in project
    let custom_doc = serde_json::json!({
        "rubric_digest": "proj-rubric-123",
        "evaluation_id": "eval-custom-project",
        "run_id": "run-proj-001",
        "created_at": 1727800000000u64,
        "candidates": [
            { "candidate_id": "cand-p1", "label": "Project Candidate", "route": { "backend": "codex", "model": "gpt-5", "effort": "low" } }
        ],
        "cases": [
            {
                "case_id": "case-p1",
                "input_digest": "proj-input-123",
                "observations": [
                    { "candidate_id": "cand-p1", "response": { "status": "ADVICE_READY" } }
                ]
            }
        ]
    });
    fs::write(
        proj_fixture_dir.join("eval-project-custom.json"),
        serde_json::to_vec(&custom_doc).unwrap(),
    )
    .unwrap();

    // List evaluations with target: test-proj
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/list")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"target": "test-proj"}"#))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let list_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(list_json["status"], "ready");
    let items = list_json["items"].as_array().unwrap();
    // 3 items total: eval-group-a (deduped), eval-group-b (HOME), eval-project-custom (project)
    assert_eq!(items.len(), 3);
    let custom_item = items
        .iter()
        .find(|i| i["evaluationRef"] == "eval-project-custom")
        .expect("eval-project-custom discovered");
    assert_eq!(custom_item["candidateCount"], 1);
    assert_eq!(custom_item["caseCount"], 1);

    // Read the project-discovered evaluation
    let read_req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/read")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({
                "target": "test-proj",
                "evaluationRef": "eval-project-custom"
            })
            .to_string(),
        ))
        .unwrap();
    let read_resp = router.clone().oneshot(read_req).await.unwrap();
    assert_eq!(read_resp.status(), StatusCode::OK);
    let read_body = axum::body::to_bytes(read_resp.into_body(), 64 * 1024).await.unwrap();
    let read_json: serde_json::Value = serde_json::from_slice(&read_body).unwrap();
    assert_eq!(read_json["status"], "ready");
    assert_eq!(read_json["document"]["evaluation_id"], "eval-custom-project");

    // Unregistered target falls back to HOME discovery without error
    let unreg_req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/evaluations/list")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"target": "unknown-unregistered"}"#))
        .unwrap();
    let unreg_resp = router.oneshot(unreg_req).await.unwrap();
    assert_eq!(unreg_resp.status(), StatusCode::OK);
    let unreg_body = axum::body::to_bytes(unreg_resp.into_body(), 64 * 1024).await.unwrap();
    let unreg_json: serde_json::Value = serde_json::from_slice(&unreg_body).unwrap();
    assert_eq!(unreg_json["items"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn test_policy_patch_disabled_denied() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"expectedRevision":"123","advisor":{"primary":{"backend":"codex","model":"m","effort":"high"},"backup":{"backend":"omp","model":"p/m","effort":"low"}}}"#))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "ADVISOR_DISABLED");
}

#[tokio::test]
async fn test_policy_patch_success_and_conflict_flow() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // 1. Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // 2. Read current policy to get revision
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/policy/current")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let old_rev = json["revision"].as_str().unwrap().to_string();

    // 3. PATCH with valid revision and routes
    let patch_body = serde_json::json!({
        "expectedRevision": old_rev,
        "advisor": {
            "primary": { "backend": "codex", "model": "gpt-6.1-sol", "effort": "high" },
            "backup": { "backend": "omp", "model": "openai/custom-backup", "effort": "low" }
        }
    });
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(patch_body.to_string()))
        .unwrap();
    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["status"], "ready");
    let new_rev = json["revision"].as_str().unwrap().to_string();
    assert_ne!(new_rev, old_rev);
    assert_eq!(json["policy"]["advisor"]["primary"]["model"], "gpt-6.1-sol");
    assert_eq!(json["policy"]["advisor"]["backup"]["model"], "openai/custom-backup");

    // 4. Stale PATCH with old revision -> 409 Conflict
    let stale_req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(patch_body.to_string()))
        .unwrap();
    let stale_resp = router.clone().oneshot(stale_req).await.unwrap();
    assert_eq!(stale_resp.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(stale_resp.into_body(), 64 * 1024).await.unwrap();
    let err_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(err_json["code"], "POLICY_REVISION_CONFLICT");

    // 5. Identical primary and backup -> 400 Bad Request
    let identical_body = serde_json::json!({
        "expectedRevision": new_rev,
        "advisor": {
            "primary": { "backend": "codex", "model": "same", "effort": "high" },
            "backup": { "backend": "codex", "model": "same", "effort": "high" }
        }
    });
    let id_req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(identical_body.to_string()))
        .unwrap();
    let id_resp = router.clone().oneshot(id_req).await.unwrap();
    assert_eq!(id_resp.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(id_resp.into_body(), 64 * 1024).await.unwrap();
    let err_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(err_json["code"], "ROUTE_BACKUP_IDENTICAL");

    // 6. Credential field in request -> 400 Bad Request ROUTE_CREDENTIAL_FIELD
    let cred_body = serde_json::json!({
        "expectedRevision": new_rev,
        "advisor": {
            "primary": { "backend": "codex", "model": "m1", "effort": "high" },
            "backup": { "backend": "omp", "model": "p/m2", "effort": "low" }
        },
        "api_key": "leak-secret"
    });
    let cred_req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(cred_body.to_string()))
        .unwrap();
    let cred_resp = router.clone().oneshot(cred_req).await.unwrap();
    assert_eq!(cred_resp.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(cred_resp.into_body(), 64 * 1024).await.unwrap();
    let err_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(err_json["code"], "ROUTE_CREDENTIAL_FIELD");
}

#[tokio::test]
async fn test_policy_patch_payload_limit() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    // Payload > 16 KiB
    let large_pad = "a".repeat(20 * 1024);
    let large_body = format!(
        r#"{{"expectedRevision":"123","advisor":{{"primary":{{"backend":"codex","model":"{}","effort":"high"}},"backup":{{"backend":"omp","model":"p/m","effort":"low"}}}}}}"#,
        large_pad
    );
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/policy")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(large_body))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_models_disabled_denied() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"codex"}"#))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "ADVISOR_DISABLED");
}

#[tokio::test]
async fn test_models_unknown_backend_rejected() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"not_a_valid_backend"}"#))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["code"], "InvalidInput");
}

#[tokio::test]
async fn test_models_payload_limit() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    let large_pad = "a".repeat(20 * 1024);
    let body_str = format!(r#"{{"backend":"codex","padding":"{}"}}"#, large_pad);
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body_str))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_models_discovery_flow_all_backends() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (router, _state, token) = create_harness(&temp_dir, home).await;

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    for backend in &["codex", "claude", "omp", "pi"] {
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/advisor/models")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(format!(r#"{{"backend":"{backend}"}}"#)))
            .unwrap();
        let resp = router.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "Failed for backend {backend}");
        let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["backend"], *backend);
        assert!(json["source"] == "fallback" || json["source"] == "harness");
        assert_eq!(json["defaultEffort"], "medium");
        assert!(json["models"].as_array().unwrap().len() >= 1);
        assert!(json["efforts"].as_array().unwrap().len() >= 1);
    }
}

#[tokio::test]
async fn test_models_with_fake_runner_harness_success() {
    let temp_dir = TempDir::new().unwrap();
    let home = setup_test_home(&temp_dir);
    let (_router, mut state, token) = create_harness(&temp_dir, home.clone()).await;

    // Inject fake runner
    let fake_runner = Arc::new(dam_hopper_server::advisor::models::FakeHarnessCommandRunner::new());
    let omp_fixture = br#"{"models":[{"id":"m1","provider":"openai","selector":"openai/m1","displayName":"OpenAI Model 1","thinking":["low","high"]}]}"#;
    fake_runner.set_result(
        dam_hopper_server::advisor::models::AdvisorBackend::Omp,
        Ok(dam_hopper_server::advisor::models::CommandOutput {
            stdout: omp_fixture.to_vec(),
            truncated: false,
        }),
    );

    let advisor_service = Arc::new(AdvisorService::with_model_runner(Some(home), fake_runner));
    state = state.with_advisor_service(advisor_service);
    let router = dam_hopper_server::api::build_router(state);

    // Enable advisor
    let req = Request::builder()
        .method(Method::PATCH)
        .uri("/api/advisor/settings")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"enabled": true}"#))
        .unwrap();
    router.clone().oneshot(req).await.unwrap();

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/advisor/models")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(r#"{"backend":"omp"}"#))
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["backend"], "omp");
    assert_eq!(json["source"], "harness");
    assert_eq!(json["models"][0]["id"], "openai/m1");
    assert_eq!(json["models"][0]["label"], "OpenAI Model 1");
    assert_eq!(json["models"][0]["efforts"], serde_json::json!(["low", "high"]));
    assert_eq!(json["issueCode"], serde_json::Value::Null);
}
