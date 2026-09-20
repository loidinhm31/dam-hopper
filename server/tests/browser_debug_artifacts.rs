mod common;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::build_router,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, NoopEventSink, PtyCreateOpts, PtySessionManager},
    state::AppState,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};
use jsonwebtoken::{encode, EncodingKey, Header};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tower::ServiceExt;

const TOKEN: &str = "browser-debug-test-token";

fn make_state(tmp: &tempfile::TempDir) -> AppState {
    let root = tmp.path().to_path_buf();
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: Default::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: root.join("dam-hopper.toml"),
    };
    let (sink, _) = BroadcastEventSink::new(8);
    let tunnels = TunnelSessionManager::new(Arc::new(sink.clone()), Arc::new(CloudflaredDriver));
    AppState::new(
        root.clone(),
        config,
        GlobalConfig::default(),
        PtySessionManager::new(Arc::new(NoopEventSink::default())),
        AgentStoreService::new(root.join(".dam-hopper/agent-store")),
        sink,
        TOKEN.into(),
        FsSubsystem::new(vec![]),
        None,
        false,
        tunnels,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(root.join("diagnostics.jsonl")),
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap()
}

fn auth_cookie() -> String {
    #[derive(serde::Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    let claims = Claims {
        sub: "test-user".into(),
        exp: (chrono::Utc::now().timestamp() + 3600) as usize,
    };
    format!(
        "damhopper-auth={}",
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(TOKEN.as_bytes())
        )
        .unwrap()
    )
}

async fn request(
    state: AppState,
    method: &str,
    path: &str,
    content_type: Option<&str>,
    body: Body,
    auth: bool,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(path);
    if auth {
        builder = builder.header("Cookie", auth_cookie());
    }
    if let Some(content_type) = content_type {
        builder = builder.header("Content-Type", content_type);
    }
    build_router(state)
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap()
}

fn selection(terminal_id: &str, incarnation: u64) -> serde_json::Value {
    serde_json::json!({
        "terminalId": terminal_id,
        "terminalIncarnation": incarnation,
        "selection": {
            "version": 1,
            "tag": "button",
            "role": "button",
            "accessibleName": "Save",
            "text": "Save changes",
            "attributes": {"data-testid": "save"},
            "locator": "main > button",
            "bounds": {"x": 1, "y": 2, "width": 80, "height": 32}
        }
    })
}

fn create_terminal(state: &AppState, root: &std::path::Path) -> u64 {
    let session = state
        .pty_manager
        .create(PtyCreateOpts {
            id: "shell:browser-debug".into(),
            command: common::read_stdin_command().into(),
            cwd: root.display().to_string(),
            env: Default::default(),
            cols: 80,
            rows: 24,
            project: None,
            worktree_path: None,
            name: None,
            restart_policy: Default::default(),
            restart_max_retries: 0,
        })
        .unwrap();
    session.incarnation
}

#[tokio::test]
async fn artifact_routes_require_auth_and_validate_terminal_and_selection() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_state(&temp);
    let unauthenticated = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:missing", 1).to_string()),
        false,
    )
    .await;
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);
    let dead_terminal = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:missing", 1).to_string()),
        true,
    )
    .await;
    assert_eq!(dead_terminal.status(), StatusCode::NOT_FOUND);
    // Missing terminalIncarnation fails validation with 400 Bad Request before persistence
    let missing_incarnation = serde_json::json!({
        "terminalId": "shell:missing",
        "selection": {
            "version": 1,
            "tag": "button",
            "role": "button",
            "accessibleName": "Save",
            "text": "Save changes",
            "attributes": {"data-testid": "save"},
            "locator": "main > button",
            "bounds": {"x": 1, "y": 2, "width": 80, "height": 32}
        }
    });
    let missing_incarnation_res = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(missing_incarnation.to_string()),
        true,
    )
    .await;
    assert_eq!(missing_incarnation_res.status(), StatusCode::BAD_REQUEST);

    // Live terminal with mismatched terminalIncarnation fails with 409 Conflict
    let inc = create_terminal(&state, temp.path());
    let mismatched = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:browser-debug", inc + 999).to_string()),
        true,
    )
    .await;
    assert_eq!(mismatched.status(), StatusCode::CONFLICT);
    let mismatched_body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(mismatched.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(mismatched_body["code"], "TERMINAL_INCARNATION_MISMATCH");

    let invalid =
        serde_json::json!({"terminalId":"shell:browser-debug", "terminalIncarnation": inc, "selection":{"unexpected":true}});
    let invalid_selection = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(invalid.to_string()),
        true,
    )
    .await;
    assert_eq!(invalid_selection.status(), StatusCode::BAD_REQUEST);
    let malformed = request(
        make_state(&temp),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from("{not-json"),
        true,
    )
    .await;
    assert_eq!(malformed.status(), StatusCode::BAD_REQUEST);
    let too_large = format!("{}{}", selection("shell:browser-debug", inc), " ".repeat(64 * 1024));
    let oversized_json = request(
        make_state(&temp),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(too_large),
        true,
    )
    .await;
    assert_eq!(oversized_json.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn artifact_routes_write_private_files_and_delete_them() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_state(&temp);
    let inc = create_terminal(&state, temp.path());
    let created = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:browser-debug", inc).to_string()),
        true,
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let value: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(created.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let id = value["artifactId"].as_str().unwrap();
    assert_eq!(value["terminalIncarnation"], inc);
    let json_path = std::path::PathBuf::from(value["jsonPath"].as_str().unwrap());
    assert!(json_path.is_file() && !json_path.starts_with(temp.path()));
    let read_attempt = request(
        state.clone(),
        "GET",
        &format!("/api/browser-debug/artifacts/{id}"),
        None,
        Body::empty(),
        true,
    )
    .await;
    assert!(matches!(
        read_attempt.status(),
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
    ));
    #[cfg(unix)]
    assert_eq!(
        std::fs::metadata(&json_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let wrong_mime = request(
        state.clone(),
        "PUT",
        &format!("/api/browser-debug/artifacts/{id}/png"),
        Some("image/jpeg"),
        Body::from(png()),
        true,
    )
    .await;
    assert_eq!(wrong_mime.status(), StatusCode::BAD_REQUEST);
    let invalid_content = request(
        state.clone(),
        "PUT",
        &format!("/api/browser-debug/artifacts/{id}/png"),
        Some("image/png"),
        Body::from(axum::body::Bytes::from_static(
            b"\x89PNG\r\n\x1a\nnot-a-real-png",
        )),
        true,
    )
    .await;
    assert_eq!(invalid_content.status(), StatusCode::BAD_REQUEST);
    let uploaded = request(
        state.clone(),
        "PUT",
        &format!("/api/browser-debug/artifacts/{id}/png"),
        Some("image/png"),
        Body::from(png()),
        true,
    )
    .await;
    assert_eq!(uploaded.status(), StatusCode::OK);
    let uploaded: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(uploaded.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let png_path = std::path::PathBuf::from(uploaded["pngPath"].as_str().unwrap());
    #[cfg(unix)]
    assert_eq!(
        std::fs::metadata(&png_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let duplicate = request(
        state.clone(),
        "PUT",
        &format!("/api/browser-debug/artifacts/{id}/png"),
        Some("image/png"),
        Body::from(png()),
        true,
    )
    .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let deleted = request(
        state.clone(),
        "DELETE",
        &format!("/api/browser-debug/artifacts/{id}"),
        None,
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    assert!(!json_path.exists());
    let unknown = request(
        state.clone(),
        "DELETE",
        &format!("/api/browser-debug/artifacts/{id}"),
        None,
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    let invalid_id = request(
        state,
        "DELETE",
        "/api/browser-debug/artifacts/not-a-uuid",
        None,
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(invalid_id.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn png_upload_enforces_the_four_megabyte_cap() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_state(&temp);
    let inc = create_terminal(&state, temp.path());
    let created = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:browser-debug", inc).to_string()),
        true,
    )
    .await;
    let value: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(created.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let id = value["artifactId"].as_str().unwrap();
    let oversized = vec![0; 4 * 1024 * 1024 + 1];
    let response = request(
        state,
        "PUT",
        &format!("/api/browser-debug/artifacts/{id}/png"),
        Some("image/png"),
        Body::from(oversized),
        true,
    )
    .await;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn artifact_handoff_writes_once_and_requires_acknowledgement() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_state(&temp);
    let inc = create_terminal(&state, temp.path());
    let created = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:browser-debug", inc).to_string()),
        true,
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let value: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(created.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let id = value["artifactId"].as_str().unwrap();
    assert_eq!(value["terminalIncarnation"], inc);
    let json_path = value["jsonPath"].as_str().unwrap();

    let handoff_path = format!("/api/browser-debug/artifacts/{id}/handoff");
    let (first, second) = tokio::join!(
        request(
            state.clone(),
            "POST",
            &handoff_path,
            None,
            Body::empty(),
            true,
        ),
        request(
            state.clone(),
            "POST",
            &handoff_path,
            None,
            Body::empty(),
            true,
        )
    );
    let (handed_off, duplicate) = if first.status() == StatusCode::OK {
        (first, second)
    } else {
        (second, first)
    };
    assert_eq!(handed_off.status(), StatusCode::OK);
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(handed_off.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["inserted"], true);

    let reference =
        format!("[DamHopper browser-debug artifact (untrusted page data): JSON {json_path}]");
    for _ in 0..20 {
        if state
            .pty_manager
            .get_buffer("shell:browser-debug")
            .unwrap()
            .contains(&reference)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(state
        .pty_manager
        .get_buffer("shell:browser-debug")
        .unwrap()
        .contains(&reference));
}

#[tokio::test]
async fn replaced_terminal_incarnation_rejects_handoff_without_writing_to_replacement_pty() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_state(&temp);
    let inc1 = create_terminal(&state, temp.path());
    let created = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:browser-debug", inc1).to_string()),
        true,
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let value: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(created.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let id = value["artifactId"].as_str().unwrap();
    assert_eq!(value["terminalIncarnation"], inc1);

    // Replace session with same ID "shell:browser-debug" -> incarnation inc2
    state.pty_manager.remove("shell:browser-debug").unwrap();
    let inc2 = create_terminal(&state, temp.path());
    assert_ne!(inc1, inc2);

    let initial_input_revision = state.pty_manager.input_revision();
    let initial_buffer = state.pty_manager.get_buffer("shell:browser-debug").unwrap();

    // Handoff on artifact for inc1 must be rejected with 409 CONFLICT
    let handoff_path = format!("/api/browser-debug/artifacts/{id}/handoff");
    let handoff_res = request(
        state.clone(),
        "POST",
        &handoff_path,
        None,
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(handoff_res.status(), StatusCode::CONFLICT);
    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(handoff_res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["code"], "TERMINAL_INCARNATION_MISMATCH");

    // SUCCESS CRITERIA: replacement PTY input bytes AND input revision remain UNCHANGED!
    assert_eq!(state.pty_manager.input_revision(), initial_input_revision);
    assert_eq!(
        state.pty_manager.get_buffer("shell:browser-debug").unwrap(),
        initial_buffer
    );

    // Verify handoff claim was released on failure so it doesn't get stuck in claimed state
    let second_attempt = request(
        state.clone(),
        "POST",
        &handoff_path,
        None,
        Body::empty(),
        true,
    )
    .await;
    assert_eq!(second_attempt.status(), StatusCode::CONFLICT);
    let second_body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(second_attempt.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(second_body["code"], "TERMINAL_INCARNATION_MISMATCH");
}

fn png() -> axum::body::Bytes {
    axum::body::Bytes::from(valid_png())
}

fn valid_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_chunk(&mut png, b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    append_chunk(
        &mut png,
        b"IDAT",
        &[
            0x78, 0x01, 0x01, 0x05, 0x00, 0xfa, 0xff, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x00, 0x01,
        ],
    );
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn append_chunk(target: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    target.extend_from_slice(&(data.len() as u32).to_be_bytes());
    target.extend_from_slice(kind);
    target.extend_from_slice(data);
    target.extend_from_slice(&crc32(&[kind.as_slice(), data].concat()).to_be_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 0 {
                crc >> 1
            } else {
                (crc >> 1) ^ 0xedb8_8320
            };
        }
    }
    !crc
}
