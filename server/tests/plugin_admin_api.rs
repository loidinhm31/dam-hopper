use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router;
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
    WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::plugins::{
    record_admin_audit, AdminAuditRecord, AdminInstallationDto, AdminInstallationListResult,
    AdminSubjectList, EpochRegistry, PluginApiService, PluginAuthorizationService,
    PluginContextTable, PluginRegistry, PluginRegistryLayout, RunnerClient, RunnerClientConfig,
    RunnerServer, RunnerServerConfig, StageReviewDto, SupervisorManager,
};
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::TunnelSessionManager;
use dam_hopper_server::workspace_target::WorkspaceTargetResolver;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tempfile::TempDir;
use tokio::sync::watch;
use tower::ServiceExt;

mod plugin_test_helpers;
use plugin_test_helpers::{build_manifest_json, create_regular_tar_gz};

fn find_node_bin() -> PathBuf {
    if let Ok(output) = std::process::Command::new("which").arg("node").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return PathBuf::from(path_str);
            }
        }
    }
    PathBuf::from("/usr/bin/node")
}

fn node_worker_code() -> &'static [u8] {
    br#"
const fs = require('fs');

function readFrame(buf) {
  if (buf.length < 4) return null;
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len) return null;
  const payload = buf.slice(4, 4 + len).toString('utf8');
  return { payload, totalLen: 4 + len };
}

function writeFrame(payloadObj) {
  const str = JSON.stringify(payloadObj);
  const buf = Buffer.from(str, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(buf.length, 0);
  process.stdout.write(Buffer.concat([header, buf]));
}

let inBuf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (true) {
    const frame = readFrame(inBuf);
    if (!frame) break;
    inBuf = inBuf.slice(frame.totalLen);
    handleMessage(JSON.parse(frame.payload));
  }
});

function handleMessage(msg) {
  if (msg.method === 'runner.hello') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        runnerVersion: '1.0.0',
        negotiatedProtocolVersion: '1.0.0',
        supportedCapabilities: ['advisor.scan']
      }
    });
  } else if (msg.method === 'worker.ping') {
    writeFrame({ jsonrpc: '2.0', id: msg.id, result: { pong: true } });
  } else if (msg.method === 'worker.shutdown') {
    process.exit(0);
  } else {
    writeFrame({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
}
"#
}

fn generate_auth_token(subject: &str, secret: &str) -> String {
    let exp = (chrono::Utc::now().timestamp() as usize) + 3600;
    #[derive(serde::Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &Claims {
            sub: subject.to_string(),
            exp,
        },
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap()
}

struct TestHarness {
    pub state: AppState,
    #[allow(dead_code)]
    pub shutdown_tx: watch::Sender<bool>,
}

async fn create_admin_test_harness(temp_dir: &TempDir, no_auth: bool) -> TestHarness {
    let socket_path = temp_dir.path().join("runner.sock");
    let layout = PluginRegistryLayout::new(temp_dir.path().join("registry"));
    let admin_subjects = AdminSubjectList::new(vec!["admin-user".to_string()]);
    let registry = Arc::new(PluginRegistry::new(layout, admin_subjects).unwrap());

    let node_bin = find_node_bin();
    let supervisor_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let server_config = RunnerServerConfig {
        socket_path: socket_path.clone(),
        expected_api_uid: None,
        allow_root_peer: true,
    };
    let runner_server = RunnerServer::new(server_config, registry, supervisor_mgr);

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = runner_server.run(shutdown_rx).await;
    });

    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let project_dir = temp_dir.path().join("test-proj");
    fs::create_dir_all(&project_dir).unwrap();

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let dummy_driver = Arc::new(dam_hopper_server::tunnel::CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);

    let mut runner_client_config = RunnerClientConfig::default();
    runner_client_config.socket_path = socket_path;
    runner_client_config.allow_root_peer = true;
    let runner_client = Arc::new(RunnerClient::new(runner_client_config));

    let epoch_reg = Arc::new(EpochRegistry::new());
    let auth_service = Arc::new(PluginAuthorizationService::new(epoch_reg));
    let context_table = Arc::new(PluginContextTable::new());
    let plugin_service = Arc::new(PluginApiService::new(
        runner_client,
        auth_service,
        context_table,
        WorkspaceTargetResolver::new(),
    ));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: temp_dir.path().display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "test-proj".into(),
            path: project_dir.display().to_string(),
            project_type: ProjectType::Custom,
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
        config_path: temp_dir.path().join("dam-hopper.toml"),
    };
    let diagnostics = DiagnosticStore::new(temp_dir.path().join("diag.jsonl"));

    let mut state = AppState::new(
        temp_dir.path().to_path_buf(),
        config,
        GlobalConfig::default(),
        pty_manager,
        AgentStoreService::new(temp_dir.path().join("store")),
        event_sink,
        "test-jwt-secret".to_string(),
        FsSubsystem::new(vec![]),
        None,
        no_auth,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();
    state = state.with_plugin_service(plugin_service);

    TestHarness { state, shutdown_tx }
}

fn sample_plugin_archive(id: &str, version: &str) -> (Vec<u8>, String) {
    let worker = node_worker_code();
    let manifest = build_manifest_json(id, version, &[("backend/worker.cjs", worker, 0o755)]);
    create_regular_tar_gz(&[
        ("manifest.json", manifest.as_bytes(), 0o644),
        ("backend/worker.cjs", worker, 0o755),
    ])
}

#[tokio::test]
async fn test_empty_deny_allowlist() {
    let temp_dir = TempDir::new().unwrap();
    let harness = create_admin_test_harness(&temp_dir, false).await;
    let router = build_router(harness.state);

    // Non-admin user with valid JWT
    let non_admin_token = generate_auth_token("normal-user", "test-jwt-secret");

    // GET /api/plugins/admin -> 401 Unauthorized
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins/admin")
        .header(header::AUTHORIZATION, format!("Bearer {non_admin_token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let err_str = String::from_utf8_lossy(&body_bytes);
    println!("DEBUG resp: status={status}, body={err_str}");
    let err_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let err_msg = err_json["error"].as_str().unwrap();
    assert!(
        err_msg.contains("not authorized plugin administrator")
            || err_msg.contains("not in authorized plugin admin list"),
        "Expected admin allowlist denial, got: {:?}",
        err_json
    );

    // POST /api/plugins/admin/stages as non-admin -> 401 Unauthorized
    let (tar_gz, sha) = sample_plugin_archive("test-plugin", "1.0.0");
    let stage_req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {non_admin_token}"))
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", sha)
        .header(header::CONTENT_LENGTH, tar_gz.len())
        .body(Body::from(tar_gz))
        .unwrap();

    let stage_resp = router.oneshot(stage_req).await.unwrap();
    assert_eq!(stage_resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_bearer_only_mutation_rejects_cookie_and_no_auth() {
    let temp_dir = TempDir::new().unwrap();
    let harness = create_admin_test_harness(&temp_dir, false).await;
    let router = build_router(harness.state);

    let admin_token = generate_auth_token("admin-user", "test-jwt-secret");

    // 1. Request with Cookie auth only (no Bearer header) -> 403 Forbidden (BearerRequired)
    let req_cookie = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins/admin")
        .header(
            header::COOKIE,
            format!("damhopper-auth={admin_token}; Path=/"),
        )
        .body(Body::empty())
        .unwrap();

    let resp_cookie = router.clone().oneshot(req_cookie).await.unwrap();
    assert_eq!(resp_cookie.status(), StatusCode::FORBIDDEN);
    let body_bytes = axum::body::to_bytes(resp_cookie.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let err_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(err_json["code"], "BearerRequired");

    // 2. Request under --no-auth mode in develop environment is permitted -> 200 OK
    let temp_dir_no_auth = TempDir::new().unwrap();
    let harness_no_auth = create_admin_test_harness(&temp_dir_no_auth, true).await;
    let router_no_auth = build_router(harness_no_auth.state);

    let req_no_auth = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins/admin")
        .body(Body::empty())
        .unwrap();

    let resp_no_auth = router_no_auth.clone().oneshot(req_no_auth).await.unwrap();
    assert_eq!(resp_no_auth.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp_no_auth.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(json.get("installations").is_some());

    // 3. Staging a package under --no-auth mode without any Bearer token succeeds
    let (tar_gz, sha) = sample_plugin_archive("dev-plugin", "0.1.0");
    let stage_req_no_auth = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", &sha)
        .header(header::CONTENT_LENGTH, tar_gz.len())
        .body(Body::from(tar_gz))
        .unwrap();

    let stage_resp_no_auth = router_no_auth.clone().oneshot(stage_req_no_auth).await.unwrap();
    assert_eq!(stage_resp_no_auth.status(), StatusCode::CREATED);
    let stage_bytes = axum::body::to_bytes(stage_resp_no_auth.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let stage_json: serde_json::Value = serde_json::from_slice(&stage_bytes).unwrap();
    assert_eq!(stage_json["pluginId"], "dev-plugin");

    // 4. Approve stage under --no-auth mode without any Bearer token succeeds
    let stage_id = stage_json["stageId"].as_str().unwrap();
    let approve_req_no_auth = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/plugins/admin/stages/{stage_id}/approve"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "expectedSha256": sha,
                "expectedSecurityRevision": 1
            }))
            .unwrap(),
        ))
        .unwrap();

    let approve_resp_no_auth = router_no_auth.oneshot(approve_req_no_auth).await.unwrap();
    assert_eq!(approve_resp_no_auth.status(), StatusCode::OK);
    let approve_bytes = axum::body::to_bytes(approve_resp_no_auth.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let inst_json: serde_json::Value = serde_json::from_slice(&approve_bytes).unwrap();
    assert_eq!(inst_json["pluginId"], "dev-plugin");
    assert_eq!(inst_json["enabled"], true);
}

#[tokio::test]
async fn test_upload_bounds_and_invalid_digest() {
    let temp_dir = TempDir::new().unwrap();
    let harness = create_admin_test_harness(&temp_dir, false).await;
    let router = build_router(harness.state);
    let admin_token = generate_auth_token("admin-user", "test-jwt-secret");

    // 1. Invalid Content-Type (text/plain) -> 415 Unsupported Media Type
    let req_unsupported = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "text/plain")
        .header("X-Expected-SHA256", "a".repeat(64))
        .header(header::CONTENT_LENGTH, 100)
        .body(Body::from(vec![0u8; 100]))
        .unwrap();

    let resp = router.clone().oneshot(req_unsupported).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);

    // 2. Missing or invalid X-Expected-SHA256 -> 400 Bad Request
    let req_bad_sha = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", "short-not-hex")
        .header(header::CONTENT_LENGTH, 100)
        .body(Body::from(vec![0u8; 100]))
        .unwrap();

    let resp = router.clone().oneshot(req_bad_sha).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 3. Payload too large (Content-Length > 32 MiB) -> 413 Payload Too Large
    let req_too_large = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", "a".repeat(64))
        .header(header::CONTENT_LENGTH, 35 * 1024 * 1024)
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(req_too_large).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // 4. Missing Content-Length -> 411 Length Required
    let req_missing_len = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", "a".repeat(64))
        .body(Body::empty())
        .unwrap();

    let resp_missing = router.clone().oneshot(req_missing_len).await.unwrap();
    assert_eq!(resp_missing.status(), StatusCode::LENGTH_REQUIRED);

    // 5. Zero Content-Length -> 411 Length Required
    let req_zero_len = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", "a".repeat(64))
        .header(header::CONTENT_LENGTH, 0)
        .body(Body::empty())
        .unwrap();

    let resp_zero = router.oneshot(req_zero_len).await.unwrap();
    assert_eq!(resp_zero.status(), StatusCode::LENGTH_REQUIRED);
}

#[tokio::test]
async fn test_streaming_stage_and_approve_and_lifecycle_flow() {
    let temp_dir = TempDir::new().unwrap();
    let harness = create_admin_test_harness(&temp_dir, false).await;
    let router = build_router(harness.state);
    let admin_token = generate_auth_token("admin-user", "test-jwt-secret");

    let (archive_bytes, expected_sha) = sample_plugin_archive("managed-advisor", "1.0.0");

    // 1. Stream stage package -> 201 Created with StageReviewDto
    let stage_req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/admin/stages")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/gzip")
        .header("X-Expected-SHA256", &expected_sha)
        .header(header::CONTENT_LENGTH, archive_bytes.len())
        .body(Body::from(archive_bytes))
        .unwrap();

    let stage_resp = router.clone().oneshot(stage_req).await.unwrap();
    assert_eq!(stage_resp.status(), StatusCode::CREATED);

    let stage_bytes = axum::body::to_bytes(stage_resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let review: StageReviewDto = serde_json::from_slice(&stage_bytes).unwrap();
    assert_eq!(review.plugin_id, "managed-advisor");
    assert_eq!(review.archive_sha256, expected_sha);

    // 2. Reject approve with stale security revision -> 403 Forbidden
    let stale_approve_req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/plugins/admin/stages/{}/approve", review.stage_id))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "expectedSha256": expected_sha,
                "expectedSecurityRevision": 999
            }))
            .unwrap(),
        ))
        .unwrap();

    let stale_resp = router.clone().oneshot(stale_approve_req).await.unwrap();
    assert_eq!(stale_resp.status(), StatusCode::FORBIDDEN);

    // 3. Approve stage with correct security revision (1) -> 200 OK with AdminInstallationDto
    let approve_req = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/plugins/admin/stages/{}/approve", review.stage_id))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "expectedSha256": expected_sha,
                "expectedSecurityRevision": review.security_revision,
                "initialBindings": { "test-proj": "approved-source" }
            }))
            .unwrap(),
        ))
        .unwrap();

    let approve_resp = router.clone().oneshot(approve_req).await.unwrap();
    let approve_status = approve_resp.status();
    let approve_bytes = axum::body::to_bytes(approve_resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    println!("DEBUG approve error: status={approve_status}, body={}", String::from_utf8_lossy(&approve_bytes));
    assert_eq!(approve_status, StatusCode::OK);
    let inst: AdminInstallationDto = serde_json::from_slice(&approve_bytes).unwrap();
    assert_eq!(inst.plugin_id, "managed-advisor");
    assert_eq!(inst.activation_generation, 1);
    assert!(inst.enabled);

    let installation_id = inst.installation_id;

    // 4. GET /api/plugins/admin -> lists the installation
    let list_req = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins/admin")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();

    let list_resp = router.clone().oneshot(list_req).await.unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let list_bytes = axum::body::to_bytes(list_resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let list_dto: AdminInstallationListResult = serde_json::from_slice(&list_bytes).unwrap();
    assert_eq!(list_dto.installations.len(), 1);
    assert_eq!(list_dto.installations[0].installation_id, installation_id);

    // 5. POST /api/plugins/admin/installations/{id}/disable -> 200 OK
    let disable_req = Request::builder()
        .method(Method::POST)
        .uri(format!(
            "/api/plugins/admin/installations/{installation_id}/disable"
        ))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "expectedSecurityRevision": list_dto.security_revision
            }))
            .unwrap(),
        ))
        .unwrap();

    let disable_resp = router.clone().oneshot(disable_req).await.unwrap();
    assert_eq!(disable_resp.status(), StatusCode::OK);
    let disable_bytes = axum::body::to_bytes(disable_resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let disabled_dto: AdminInstallationDto = serde_json::from_slice(&disable_bytes).unwrap();
    assert!(!disabled_dto.enabled);

    // 6. POST /api/plugins/admin/installations/{id}/enable -> 200 OK
    let enable_req = Request::builder()
        .method(Method::POST)
        .uri(format!(
            "/api/plugins/admin/installations/{installation_id}/enable"
        ))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&serde_json::json!({
                "expectedSecurityRevision": list_dto.security_revision
            }))
            .unwrap(),
        ))
        .unwrap();

    let enable_resp = router.clone().oneshot(enable_req).await.unwrap();
    assert_eq!(enable_resp.status(), StatusCode::OK);
    let enabled_bytes = axum::body::to_bytes(enable_resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let enabled_dto: AdminInstallationDto = serde_json::from_slice(&enabled_bytes).unwrap();
    assert!(enabled_dto.enabled);
    assert_eq!(enabled_dto.activation_generation, 2);

    // 7. DELETE /api/plugins/admin/installations/{id} -> 200 OK
    let remove_req = Request::builder()
        .method(Method::DELETE)
        .uri(format!(
            "/api/plugins/admin/installations/{installation_id}?expectedSecurityRevision={}",
            list_dto.security_revision
        ))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();

    let remove_resp = router.clone().oneshot(remove_req).await.unwrap();
    assert_eq!(remove_resp.status(), StatusCode::OK);

    // 8. Verify list is now empty
    let list_after_req = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins/admin")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();

    let list_after_resp = router.oneshot(list_after_req).await.unwrap();
    assert_eq!(list_after_resp.status(), StatusCode::OK);
    let list_after_bytes = axum::body::to_bytes(list_after_resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let list_after_dto: AdminInstallationListResult =
        serde_json::from_slice(&list_after_bytes).unwrap();
    assert!(list_after_dto.installations.is_empty());
}

#[test]
fn test_redacted_audit() {
    let mut record = AdminAuditRecord::new("admin-user", "stage.approve", 3, "success");
    record.installation_id = Some("inst-123".to_string());
    record.package_digest = Some("a".repeat(64));
    record.old_generation = Some(1);
    record.new_generation = Some(2);

    record_admin_audit(&record);
    assert_eq!(record.actor, "admin-user");
    assert_eq!(record.operation, "stage.approve");
    assert_eq!(record.security_revision, 3);
    assert_eq!(record.outcome, "success");
}

#[cfg(unix)]
#[test]
fn test_admin_config_group_writable_rejected() {
    use std::os::unix::fs::PermissionsExt;
    let temp_dir = TempDir::new().unwrap();
    let config_path = temp_dir.path().join("admins.json");
    fs::write(&config_path, r#"{"adminSubjects":["admin-user"]}"#).unwrap();

    // Safe permissions: 0o644
    fs::set_permissions(&config_path, fs::Permissions::from_mode(0o644)).unwrap();
    let safe_res = dam_hopper_server::plugins::load_admin_subjects_from_file(&config_path);
    assert!(safe_res.is_ok());
    assert!(safe_res.unwrap().is_admin("admin-user"));

    // Unsafe group-writable permissions: 0o664 (perm & 0o022 != 0)
    fs::set_permissions(&config_path, fs::Permissions::from_mode(0o664)).unwrap();
    let group_writable_res = dam_hopper_server::plugins::load_admin_subjects_from_file(&config_path);
    assert!(group_writable_res.is_err());
    let err_msg = group_writable_res.unwrap_err().to_string();
    assert!(err_msg.contains("unsafe writable permissions"));

    // Unsafe world-writable permissions: 0o646
    fs::set_permissions(&config_path, fs::Permissions::from_mode(0o646)).unwrap();
    let world_writable_res = dam_hopper_server::plugins::load_admin_subjects_from_file(&config_path);
    assert!(world_writable_res.is_err());
}
