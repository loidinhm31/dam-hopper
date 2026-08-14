//! Integration coverage for the authenticated semantic transport.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router_with_origins;
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, NoopEventSink, PtySessionManager};
use dam_hopper_server::semantic::bundle::{BundleCommandSpec, BundleResolver};
use dam_hopper_server::semantic::bundle_manifest::{
    BundleArchitecture, BundleArtifact, BundleDescriptor, BundleManifest, BundleOs,
};
use dam_hopper_server::semantic::protocol::SemanticLanguage;
use dam_hopper_server::semantic::registry::SemanticRegistry;
use dam_hopper_server::semantic::supervisor::SemanticSupervisor;
use dam_hopper_server::semantic::trust::ProjectTrustStore;
use dam_hopper_server::state::AppState;
use futures_util::{SinkExt, StreamExt};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use sha2::Digest;
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};

mod common;

fn make_state(tmp: &TempDir, supervisor: Arc<SemanticSupervisor>) -> AppState {
    let project = tmp.path().join("project");
    std::fs::create_dir_all(project.join("src")).unwrap();
    std::fs::write(project.join("src/main.rs"), "fn main() {}").unwrap();
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "semantic-test".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "project".into(),
            path: project.to_string_lossy().into_owned(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 5,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: tmp.path().join("dam-hopper.toml"),
    };
    let (event_sink, _) = BroadcastEventSink::new(64);
    let state = AppState::new(
        tmp.path().to_path_buf(),
        config,
        GlobalConfig::default(),
        PtySessionManager::new(Arc::new(NoopEventSink::default())),
        AgentStoreService::new(tmp.path().join("store")),
        event_sink.clone(),
        "semantic-test-secret".into(),
        FsSubsystem::new(vec![("project".into(), project)]),
        None,
        true,
        common::make_tunnel_manager(&event_sink),
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(tmp.path().join("diagnostics.jsonl")),
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();
    state.with_semantic_supervisor(supervisor)
}

async fn spawn_server(state: AppState) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, build_router_with_origins(state, vec![]))
            .await
            .unwrap();
    });
    address
}

async fn next_json(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let message = tokio::time::timeout(remaining, socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if let Message::Text(text) = message {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

fn fixture_payload_tree_digest(path: &std::path::Path) -> String {
    let file_digest = hex::encode(sha2::Sha256::digest(std::fs::read(path).unwrap()));
    hex::encode(sha2::Sha256::digest(format!(
        "rust-analyzer\0{file_digest}\n"
    )))
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn fixture_supervisor(tmp: &TempDir) -> Arc<SemanticSupervisor> {
    let payload = tmp.path().join("payload");
    std::fs::create_dir(&payload).unwrap();
    let script = payload.join("rust-analyzer");
    let body = r#"#!/bin/sh
while :; do
  length=""
  while IFS= read -r line; do
    line=$(printf '%s' "$line" | tr -d '\r')
    case "$line" in Content-Length:*) length=${line#Content-Length: };; esac
    [ -z "$line" ] && break
  done
  [ -z "$length" ] && exit 0
  request=$(dd bs=1 count="$length" 2>/dev/null)
  if printf '%s' "$request" | grep -q '"method":"initialize"'; then
    response='{"jsonrpc":"2.0","id":"dam-hopper-initialize","result":{"capabilities":{}}}'
  elif printf '%s' "$request" | grep -q 'textDocument/'; then
    response='{"jsonrpc":"2.0","id":"REPLACE_ID","result":null}'
    id=$(printf '%s' "$request" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    response=$(printf '%s' "$response" | sed "s/REPLACE_ID/$id/")
  else
    continue
  fi
  printf 'Content-Length: %s\r\n\r\n%s' "${#response}" "$response"
done
"#;
    std::fs::write(&script, body).unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let digest = hex::encode(sha2::Sha256::digest(std::fs::read(&script).unwrap()));
    let manifest = BundleManifest {
        descriptors: vec![BundleDescriptor {
            descriptor_id: "rust-analyzer".into(),
            runtime_id: "native".into(),
            language: SemanticLanguage::Rust,
            version: "test".into(),
            target: dam_hopper_server::semantic::bundle_manifest::BundleTarget {
                os: current_os(),
                architecture: current_architecture(),
            },
            artifact: BundleArtifact {
                sha256: digest,
                license_id: "MIT".into(),
                sbom_component: "test-rust-analyzer".into(),
                compressed_size_bytes: 1,
                uncompressed_size_bytes: body.len() as u64 + 1024,
                payload_tree_sha256: fixture_payload_tree_digest(&script),
            },
        }],
    };
    let resolver = BundleResolver::for_test(tmp.path(), manifest).with_test_command_spec(
        "rust-analyzer",
        BundleCommandSpec::new("payload/rust-analyzer", Vec::new()).unwrap(),
    );
    Arc::new(SemanticSupervisor::new(
        SemanticRegistry::new(resolver),
        ProjectTrustStore::open(tmp.path().join("trust.json")).unwrap(),
        1,
        true,
    ))
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
#[tokio::test]
async fn semantic_ws_syncs_unsaved_documents_and_returns_safe_navigation() {
    let tmp = tempfile::tempdir().unwrap();
    let supervisor = fixture_supervisor(&tmp);
    let state = make_state(&tmp, supervisor.clone());
    let address = spawn_server(state).await;
    let (mut socket, _) = connect_async(format!("ws://{address}/ws/semantic"))
        .await
        .unwrap();

    let handshake = next_json(&mut socket).await;
    assert_eq!(handshake["kind"], "semantic:handshake");
    assert_eq!(handshake["protocolVersion"], 1);
    assert!(!handshake.to_string().contains("file:"));

    socket
        .send(Message::Text(
            json!({"kind":"semantic:project","profileId":"profile","projectId":"project"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let project_message = next_json(&mut socket).await;
    assert_eq!(project_message["kind"], "semantic:project");
    assert!(project_message["workspaceGeneration"].is_number());

    let uri = json!({
        "profileId":"profile",
        "projectId":"project",
        "path":"src/main.rs",
        "language":"rust"
    });
    socket
        .send(Message::Text(
            json!({"kind":"semantic:document_open","uri":uri,"documentVersion":1,"text":"fn main() { unsaved(); }"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        next_json(&mut socket).await["kind"],
        "semantic:document_accepted"
    );

    socket
        .send(Message::Text(
            json!({
                "kind":"semantic:navigate",
                "requestId":"request-1",
                "documentVersion":1,
                "operation":"definition",
                "uri":uri,
                "position":{"line":0,"character":10}
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let mut response = Value::Null;
    for _ in 0..6 {
        let candidate = next_json(&mut socket).await;
        if candidate["kind"] == "empty" || candidate["kind"] == "targets" {
            response = candidate;
            break;
        }
    }
    assert_eq!(response["kind"], "empty");
    assert_eq!(response["documentVersion"], 1);
    assert!(!response.to_string().contains("/mnt/") && !response.to_string().contains("file:"));
    supervisor.shutdown().await;
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
#[tokio::test]
async fn semantic_ws_fences_active_client_across_off_on_transition() {
    let tmp = tempfile::tempdir().unwrap();
    let supervisor = fixture_supervisor(&tmp);
    let state = make_state(&tmp, supervisor.clone());
    let address = spawn_server(state).await;
    let (mut socket, _) = connect_async(format!("ws://{address}/ws/semantic"))
        .await
        .unwrap();

    assert_eq!(next_json(&mut socket).await["kind"], "semantic:handshake");
    socket
        .send(Message::Text(
            json!({"kind":"semantic:project","profileId":"profile","projectId":"project"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    assert_eq!(next_json(&mut socket).await["kind"], "semantic:project");

    supervisor.reconfigure(false).await;
    let off = next_json(&mut socket).await;
    assert_eq!(off["kind"], "semantic:workspace_changed");

    supervisor.reconfigure(true).await;
    let on = next_json(&mut socket).await;
    assert_eq!(on["kind"], "semantic:workspace_changed");

    socket
        .send(Message::Text(
            json!({"kind":"semantic:project","profileId":"profile","projectId":"project"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    assert_eq!(next_json(&mut socket).await["kind"], "semantic:project");
    supervisor.shutdown().await;
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
#[tokio::test]
async fn semantic_trust_routes_persist_and_revoke_without_host_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let supervisor = fixture_supervisor(&tmp);
    let state = make_state(&tmp, supervisor.clone());
    let address = spawn_server(state).await;
    let client = reqwest::Client::new();
    let base = format!("http://{address}/api/semantic/trust/project");

    let status = client.get(&base).send().await.unwrap();
    assert_eq!(status.status(), reqwest::StatusCode::OK);
    let status_body: Value = serde_json::from_str(&status.text().await.unwrap()).unwrap();
    assert_eq!(status_body["trust"], "restricted");
    assert!(
        !status_body.to_string().contains("/mnt/") && !status_body.to_string().contains("command")
    );

    let challenge_response = client
        .post(format!("{base}/challenge"))
        .send()
        .await
        .unwrap();
    assert_eq!(challenge_response.status(), reqwest::StatusCode::OK);
    let challenge: Value = serde_json::from_str(&challenge_response.text().await.unwrap()).unwrap();
    let transition = client
        .post(format!("{base}/transition"))
        .header("content-type", "application/json")
        .body(
            json!({
                "projectId":"project",
                "desiredTrust":"trusted",
                "confirmation":challenge["challenge"]
            })
            .to_string(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(transition.status(), reqwest::StatusCode::OK);
    let transition_body: Value = serde_json::from_str(&transition.text().await.unwrap()).unwrap();
    assert_eq!(transition_body["trust"], "trusted");
    assert!(transition_body.get("canonicalProject").is_none());
    assert!(transition_body.get("updatedAt").is_none());
    assert!(transition_body.get("auditReason").is_none());
    assert!(!transition_body
        .to_string()
        .contains(tmp.path().to_string_lossy().as_ref()));

    let revoke = client
        .post(format!("{base}/revoke"))
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(revoke.status(), reqwest::StatusCode::OK);
    let revoke_body: Value = serde_json::from_str(&revoke.text().await.unwrap()).unwrap();
    assert_eq!(revoke_body["trust"], "revoked");
    assert!(revoke_body.get("canonicalProject").is_none());
    assert!(revoke_body.get("updatedAt").is_none());
    assert!(revoke_body.get("auditReason").is_none());
    assert!(!revoke_body
        .to_string()
        .contains(tmp.path().to_string_lossy().as_ref()));
    let status = client.get(&base).send().await.unwrap();
    let status_body: Value = serde_json::from_str(&status.text().await.unwrap()).unwrap();
    assert_eq!(status_body["trust"], "revoked");
    assert_eq!(status_body["policyRevision"], 2);

    let (mut socket, _) = connect_async(format!("ws://{address}/ws/semantic"))
        .await
        .unwrap();
    assert_eq!(next_json(&mut socket).await["kind"], "semantic:handshake");
    socket
        .send(Message::Text(
            json!({"kind":"semantic:project","profileId":"profile","projectId":"project"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let project_message = next_json(&mut socket).await;
    assert_eq!(project_message["kind"], "semantic:project");
    assert!(project_message["workspaceGeneration"].is_number());
    socket
        .send(Message::Text(
            json!({
                "kind":"semantic:document_open",
                "uri":{
                    "profileId":"profile",
                    "projectId":"project",
                    "path":"src/main.rs",
                    "language":"rust"
                },
                "documentVersion":1,
                "text":"fn main() {}"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let document_response = next_json(&mut socket).await;
    assert_eq!(document_response["kind"], "semantic:error");
    assert_eq!(document_response["code"], "policyChanged");
    supervisor.shutdown().await;
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
#[tokio::test]
async fn semantic_ws_rejects_unauthenticated_upgrade() {
    let tmp = tempfile::tempdir().unwrap();
    let supervisor = fixture_supervisor(&tmp);
    let mut state = make_state(&tmp, supervisor.clone());
    state.no_auth = false;
    let address = spawn_server(state).await;
    let error = connect_async(format!("ws://{address}/ws/semantic"))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("401") || error.to_string().contains("Unauthorized"));
    supervisor.shutdown().await;
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn current_os() -> BundleOs {
    BundleOs::Linux
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn current_architecture() -> BundleArchitecture {
    BundleArchitecture::X86_64
}
