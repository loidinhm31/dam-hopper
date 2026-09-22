#[path = "plugin_test_helpers.rs"]
mod plugin_test_helpers;

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::sync::watch;
use tower::ServiceExt;

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
    AdminSubjectList, EpochRegistry, PluginApiService, PluginAuthorizationService,
    PluginContextTable, PluginRegistry, PluginRegistryLayout, RunnerClient, RunnerClientConfig,
    RunnerServer, RunnerServerConfig, SupervisorManager,
};
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::TunnelSessionManager;
use dam_hopper_server::workspace_target::WorkspaceTargetResolver;
use opaque_ke::ServerSetup;
use plugin_test_helpers::{build_manifest_json, create_regular_tar_gz};

fn real_node_worker_code() -> &'static [u8] {
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
  } else if (msg.method === 'context.open') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        contextId: 'test-ctx-1',
        bindingRevision: 1,
        grantRevision: 1,
        activationGeneration: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 900
      }
    });
  } else if (msg.method === 'context.close') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: { closed: true }
    });
  } else if (msg.method === 'plugin.invoke') {
    if (msg.params.operation === 'history.summary' || msg.params.operation === 'snapshot.summary') {
      writeFrame({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          result: {
            snapshotId: 'snap-42',
            totalFiles: 5,
            totalBytes: 1024,
            status: 'ok'
          }
        }
      });
    } else if (msg.params.operation === 'crash.worker') {
      process.exit(1);
    } else {
      writeFrame({
        jsonrpc: '2.0',
        id: msg.id,
        result: { result: { echo: msg.params.operation } }
      });
    }
  } else if (msg.method === 'request.cancel') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: { outcome: 'accepted' }
    });
  } else if (msg.method === 'worker.shutdown') {
    process.exit(0);
  }
}
"#
}

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

fn setup_test_installation(temp_dir: &TempDir) -> (Arc<PluginRegistry>, String, String) {
    let layout = PluginRegistryLayout::new(temp_dir.path().join("registry"));
    let admin_subjects = AdminSubjectList::new(vec!["admin-user".to_string()]);
    let registry = Arc::new(PluginRegistry::new(layout, admin_subjects).unwrap());

    let worker_code = real_node_worker_code();
    let manifest_str = build_manifest_json(
        "evcrate-advisor",
        "1.0.0",
        &[("backend/worker.cjs", worker_code, 0o755)],
    );

    let (tar_gz, digest) = create_regular_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644),
        ("backend/worker.cjs", worker_code, 0o755),
    ]);

    let begin = registry
        .stage_begin("admin-user", &digest, tar_gz.len() as u64)
        .unwrap();
    registry
        .stage_chunk("admin-user", &begin.stage_id, 0, &tar_gz)
        .unwrap();
    registry
        .stage_finish("admin-user", &begin.stage_id)
        .unwrap();

    let mut bindings = BTreeMap::new();
    bindings.insert("test-proj".to_string(), "approved-source".to_string());
    let inst = registry
        .approve_stage("admin-user", &begin.stage_id, &digest, 1, bindings, vec![])
        .unwrap();

    (registry, inst.installation_id, digest)
}

struct TestHarness {
    pub state: AppState,
    pub epoch: u64,
    pub installation_id: String,
    #[allow(dead_code)]
    pub socket_path: PathBuf,
    pub shutdown_tx: watch::Sender<bool>,
    pub project_dir: PathBuf,
}

async fn create_test_harness(temp_dir: &TempDir, no_auth: bool) -> TestHarness {
    let socket_path = temp_dir.path().join("runner.sock");
    let (registry, installation_id, _digest) = setup_test_installation(temp_dir);

    let node_bin = find_node_bin();
    let supervisor_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));
    let sup = supervisor_mgr
        .get_or_create(&installation_id)
        .await
        .unwrap();
    sup.activate().await.unwrap();

    let server_config = RunnerServerConfig {
        socket_path: socket_path.clone(),
        expected_api_uid: None,
        allow_root_peer: true,
    };
    let runner_server = RunnerServer::new(server_config, registry, supervisor_mgr.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        let _ = runner_server.run(shutdown_rx).await;
    });

    // Wait for server socket to become available
    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    // Set up project directory with sample files
    let project_dir = temp_dir.path().join("test-proj");
    fs::create_dir_all(&project_dir).unwrap();
    fs::write(project_dir.join("sample.txt"), "hello source file").unwrap();

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let dummy_driver = Arc::new(dam_hopper_server::tunnel::CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);
    let diagnostics = DiagnosticStore::new(temp_dir.path().join("diag.jsonl"));

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

    let client_config = RunnerClientConfig {
        socket_path: socket_path.clone(),
        expected_runner_uid: None,
        allow_root_peer: true,
        client_name: "test-api".to_string(),
        max_reconnect_retries: 5,
        reconnect_base_delay: Duration::from_millis(50),
    };

    let runner_client = Arc::new(RunnerClient::new(client_config));
    let epoch_registry = Arc::new(EpochRegistry::new());
    let epoch = epoch_registry.issue_epoch("admin-user", None);
    let auth_service = Arc::new(PluginAuthorizationService::new(epoch_registry));
    auth_service.set_actor_grants(
        "admin-user",
        vec![dam_hopper_server::plugins::contract::GrantKey {
            actor_subject: "admin-user".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "*".to_string(),
            allowed_operations: vec!["*".to_string()],
            allow_current_account_policy: false,
        }],
    );
    let context_table = Arc::new(PluginContextTable::new());
    let plugin_service = Arc::new(PluginApiService::new(
        runner_client,
        auth_service,
        context_table,
        WorkspaceTargetResolver::new(),
    ));

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

    TestHarness {
        state,
        epoch,
        installation_id,
        socket_path,
        shutdown_tx,
        project_dir,
    }
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

#[tokio::test]
async fn test_plugin_api_full_g1_lifecycle_and_immutability() {
    let temp_dir = TempDir::new().unwrap();
    let harness = create_test_harness(&temp_dir, false).await;
    let router = build_router(harness.state.clone());

    // Record source file properties before test execution
    let sample_file = harness.project_dir.join("sample.txt");
    let meta_before = fs::metadata(&sample_file).unwrap();
    let content_before = fs::read(&sample_file).unwrap();

    let admin_token = generate_auth_token("admin-user", "test-jwt-secret");
    let attacker_token = generate_auth_token("attacker-user", "test-jwt-secret");

    // 1. GET /api/plugins?project=test-proj -> 200 OK
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins?project=test-proj")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    let plugins = list_json["plugins"].as_array().unwrap();
    assert!(!plugins.is_empty());
    assert_eq!(plugins[0]["id"], harness.installation_id);

    // 2. POST /api/plugins/contexts/open on registered project target
    let open_body = serde_json::json!({
        "epoch": harness.epoch,
        "installationId": harness.installation_id,
        "target": {
            "project": "test-proj",
            "worktreePath": null
        },
        "allowedOperations": ["history.summary", "snapshot.summary", "crash.worker"],
        "allowCurrentAccountPolicy": false
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/contexts/open")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&open_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "Body: {}",
        String::from_utf8_lossy(&body_bytes)
    );
    let open_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    let context_id = open_json["contextId"].as_str().unwrap().to_string();
    assert!(context_id.starts_with("ctx:"));

    // 3. POST /api/plugins/invoke with snapshot.summary
    let invoke_body = serde_json::json!({
        "epoch": harness.epoch,
        "contextId": context_id,
        "requestId": "snapshot-summary-1",
        "operation": "snapshot.summary",
        "payload": { "project": "test-proj" },
        "deadlineMs": 5000
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/invoke")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&invoke_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let invoke_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(invoke_json["result"]["status"], "ok");
    assert_eq!(invoke_json["result"]["snapshotId"], "snap-42");

    // 4. Deny second actor (attacker tries to invoke on admin's context)
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/invoke")
        .header(header::AUTHORIZATION, format!("Bearer {attacker_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&invoke_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // 5. Deny invalid / wrong target
    let bad_target_body = serde_json::json!({
        "epoch": harness.epoch,
        "installationId": harness.installation_id,
        "target": {
            "project": "nonexistent-project",
            "worktreePath": null
        },
        "allowedOperations": ["history.summary"],
        "allowCurrentAccountPolicy": false
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/contexts/open")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&bad_target_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // 6. Cancellation check: cancel request on context
    let cancel_body = serde_json::json!({
        "epoch": harness.epoch,
        "contextId": context_id,
        "requestId": "req-999"
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/cancel")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&cancel_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cancel_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(matches!(
        cancel_json["outcome"].as_str(),
        Some("accepted" | "unknown" | "alreadySettled")
    ));

    // 7. POST /api/plugins/contexts/close -> 200 OK
    let close_body = serde_json::json!({
        "epoch": harness.epoch,
        "contextId": context_id
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/contexts/close")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&close_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 8. Invoke on closed context -> 410 GONE
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/invoke")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&invoke_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::GONE);

    // 9. Source Immutability Check: ensure no source files were mutated
    let meta_after = fs::metadata(&sample_file).unwrap();
    let content_after = fs::read(&sample_file).unwrap();

    assert_eq!(
        content_before, content_after,
        "Source content must be identical"
    );
    assert_eq!(
        meta_before.len(),
        meta_after.len(),
        "Source file length must not change"
    );
    assert_eq!(
        meta_before.modified().unwrap(),
        meta_after.modified().unwrap(),
        "Source mtime must be unchanged"
    );

    let _ = harness.shutdown_tx.send(true);
}

#[tokio::test]
async fn test_plugin_api_denied_under_no_auth_mode() {
    let temp_dir = TempDir::new().unwrap();
    let harness = create_test_harness(&temp_dir, true).await; // no_auth = true
    let router = build_router(harness.state.clone());

    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/plugins?project=test-proj")
        .body(Body::empty())
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(err_json["code"], "NoAuthForbidden");

    let _ = harness.shutdown_tx.send(true);
}
#[tokio::test]
async fn test_real_evcrate_candidate_package_g1_snapshot_summary() {
    let candidate_path = PathBuf::from("/home/loidinh/WS/evcrate/artifacts/candidate/evcrate-advisor-plugin-0.1.0-candidate.tar.gz");
    if !candidate_path.exists() {
        eprintln!(
            "Candidate archive not found at {:?}; skipping real worker G1 test",
            candidate_path
        );
        return;
    }

    let temp_dir = TempDir::new().unwrap();
    let socket_path = temp_dir.path().join("runner.sock");
    let layout = PluginRegistryLayout::new(temp_dir.path().join("registry"));
    let admin_subjects = AdminSubjectList::new(vec!["admin-user".to_string()]);
    let registry = Arc::new(PluginRegistry::new(layout, admin_subjects).unwrap());

    let tar_gz = fs::read(&candidate_path).unwrap();
    let digest = hex::encode(Sha256::digest(&tar_gz));

    let begin = registry
        .stage_begin("admin-user", &digest, tar_gz.len() as u64)
        .unwrap();
    registry
        .stage_chunk("admin-user", &begin.stage_id, 0, &tar_gz)
        .unwrap();
    registry
        .stage_finish("admin-user", &begin.stage_id)
        .unwrap();

    let mut bindings = BTreeMap::new();
    bindings.insert(
        "evcrate".to_string(),
        "/home/loidinh/WS/evcrate".to_string(),
    );
    let inst = registry
        .approve_stage("admin-user", &begin.stage_id, &digest, 1, bindings, vec![])
        .unwrap();
    let grant = dam_hopper_server::plugins::contract::GrantKey {
        actor_subject: "admin-user".to_string(),
        installation_id: inst.installation_id.clone(),
        configured_project_target: "*".to_string(),
        allowed_operations: vec![
            "history.refresh".to_string(),
            "history.summary".to_string(),
            "policy.readCurrent".to_string(),
        ],
        allow_current_account_policy: false,
    };
    registry
        .update_grants("admin-user", &inst.installation_id, 1, vec![grant.clone()])
        .unwrap();

    let node_bin = find_node_bin();
    let supervisor_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));
    let sup = supervisor_mgr
        .get_or_create(&inst.installation_id)
        .await
        .unwrap();
    sup.activate().await.unwrap();

    let server_config = RunnerServerConfig {
        socket_path: socket_path.clone(),
        expected_api_uid: None,
        allow_root_peer: true,
    };
    let runner_server = RunnerServer::new(server_config, registry, supervisor_mgr.clone());

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

    let sample_file = PathBuf::from("/home/loidinh/WS/evcrate/package.json");
    let meta_before = fs::metadata(&sample_file).unwrap();
    let content_before = fs::read(&sample_file).unwrap();

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let dummy_driver = Arc::new(dam_hopper_server::tunnel::CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);
    let diagnostics = DiagnosticStore::new(temp_dir.path().join("diag.jsonl"));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "evcrate-workspace".into(),
            root: "/home/loidinh/WS/evcrate".to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "evcrate".into(),
            path: "/home/loidinh/WS/evcrate".to_string(),
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

    let client_config = RunnerClientConfig {
        socket_path: socket_path.clone(),
        expected_runner_uid: None,
        allow_root_peer: true,
        client_name: "test-api".to_string(),
        max_reconnect_retries: 5,
        reconnect_base_delay: Duration::from_millis(50),
    };

    let runner_client = Arc::new(RunnerClient::new(client_config));
    let epoch_registry = Arc::new(EpochRegistry::new());
    let epoch = epoch_registry.issue_epoch("admin-user", None);
    let auth_service = Arc::new(PluginAuthorizationService::new(epoch_registry));
    auth_service.set_actor_grants("admin-user", vec![grant]);
    let context_table = Arc::new(PluginContextTable::new());
    let plugin_service = Arc::new(PluginApiService::new(
        runner_client,
        auth_service,
        context_table,
        WorkspaceTargetResolver::new(),
    ));

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
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();

    state = state.with_plugin_service(plugin_service);
    let router = build_router(state);
    let admin_token = generate_auth_token("admin-user", "test-jwt-secret");

    let asset_uri = format!(
        "/api/plugins/{}/ui?project=evcrate&activeDigest={}&activationGeneration=1",
        inst.installation_id, digest
    );

    let unauthenticated_asset = Request::builder()
        .method(Method::GET)
        .uri(&asset_uri)
        .body(Body::empty())
        .unwrap();
    let unauthenticated_response = router.clone().oneshot(unauthenticated_asset).await.unwrap();
    assert_eq!(unauthenticated_response.status(), StatusCode::UNAUTHORIZED);
    let unauthenticated_body =
        axum::body::to_bytes(unauthenticated_response.into_body(), usize::MAX)
            .await
            .unwrap();
    assert!(unauthenticated_body.is_empty());

    let stale_asset = Request::builder()
        .method(Method::GET)
        .uri(format!(
            "/api/plugins/{}/ui?project=evcrate&activeDigest={}&activationGeneration=2",
            inst.installation_id, digest
        ))
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();
    let stale_response = router.clone().oneshot(stale_asset).await.unwrap();
    assert_eq!(stale_response.status(), StatusCode::GONE);
    let stale_body = axum::body::to_bytes(stale_response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(stale_body.is_empty());

    let asset_request = Request::builder()
        .method(Method::GET)
        .uri(&asset_uri)
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .body(Body::empty())
        .unwrap();
    let asset_response = router.clone().oneshot(asset_request).await.unwrap();
    assert_eq!(asset_response.status(), StatusCode::OK);
    assert_eq!(
        asset_response.headers()[header::CONTENT_TYPE],
        "application/octet-stream"
    );
    assert_eq!(
        asset_response.headers()[header::CONTENT_DISPOSITION],
        "attachment; filename=\"plugin-ui.bin\""
    );
    assert_eq!(
        asset_response.headers()[header::CACHE_CONTROL],
        "private, no-store"
    );
    assert_eq!(
        asset_response.headers()["x-content-type-options"],
        "nosniff"
    );
    let expected_ui_digest = asset_response.headers()["x-plugin-ui-sha256"]
        .to_str()
        .unwrap()
        .to_string();
    let asset_body = axum::body::to_bytes(asset_response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(hex::encode(Sha256::digest(&asset_body)), expected_ui_digest);
    assert!(asset_body.starts_with(b"<!DOCTYPE html>"));

    // Open context on real evcrate target
    let open_body = serde_json::json!({
        "epoch": epoch,
        "installationId": inst.installation_id,
        "target": {
            "project": "evcrate",
            "worktreePath": null
        },
        "allowedOperations": ["history.refresh", "history.summary", "policy.readCurrent"],
        "allowCurrentAccountPolicy": false
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/contexts/open")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&open_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "Body: {}",
        String::from_utf8_lossy(&body_bytes)
    );
    let open_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    let context_id = open_json["contextId"].as_str().unwrap().to_string();

    // Invoke history.refresh on real evcrate worker
    let refresh_body = serde_json::json!({
        "epoch": epoch,
        "contextId": context_id,
        "requestId": "history-refresh-1",
        "operation": "history.refresh",
        "payload": {},
        "deadlineMs": 10000
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/invoke")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&refresh_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "Body: {}",
        String::from_utf8_lossy(&body_bytes)
    );
    let refresh_json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(refresh_json["result"].is_object());

    // Close context
    let close_body = serde_json::json!({
        "epoch": epoch,
        "contextId": context_id
    });

    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/plugins/contexts/close")
        .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&close_body).unwrap()))
        .unwrap();

    let resp = router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Source immutability verification on evcrate files
    let meta_after = fs::metadata(&sample_file).unwrap();
    let content_after = fs::read(&sample_file).unwrap();
    assert_eq!(
        content_before, content_after,
        "evcrate source content must be strictly immutable"
    );
    assert_eq!(
        meta_before.len(),
        meta_after.len(),
        "evcrate file size must not change"
    );
    assert_eq!(
        meta_before.modified().unwrap(),
        meta_after.modified().unwrap(),
        "evcrate mtime must be unchanged"
    );

    let _ = shutdown_tx.send(true);
}
