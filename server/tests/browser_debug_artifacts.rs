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
        ui: None,
        workspaces: None,
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
    )
    .unwrap()
    .with_auth_service(std::sync::Arc::new(
        dam_hopper_server::auth::AuthService::new_mock_default().0,
    ))
}

fn auth_cookie() -> String {
    use dam_hopper_server::auth::model::AuthClaims;
    use dam_hopper_server::auth::{
        AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS, MOCK_SESSION_ID, MOCK_USER,
    };
    let claims = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: MOCK_USER.to_string(),
        sid: MOCK_SESSION_ID.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: chrono::Utc::now().timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    format!("damhopper-auth={}", claims.encode(TOKEN).unwrap())
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
async fn request_with_cookie(
    state: AppState,
    method: &str,
    path: &str,
    content_type: Option<&str>,
    body: Body,
    cookie: &str,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(path);
    builder = builder.header("Cookie", cookie);
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

    let invalid = serde_json::json!({"terminalId":"shell:browser-debug", "terminalIncarnation": inc, "selection":{"unexpected":true}});
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
    let too_large = format!(
        "{}{}",
        selection("shell:browser-debug", inc),
        " ".repeat(64 * 1024)
    );
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

#[tokio::test]
async fn client_forged_source_or_owner_is_rejected_with_bad_request() {
    let temp = tempfile::tempdir().unwrap();
    let state = make_state(&temp);
    let inc = create_terminal(&state, temp.path());

    // Client attempts to forge "source": "ManagedBrowser"
    let mut forged_source = selection("shell:browser-debug", inc);
    forged_source["source"] = serde_json::json!("ManagedBrowser");
    let res = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(forged_source.to_string()),
        true,
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // Client attempts to forge "owner": "admin"
    let mut forged_owner = selection("shell:browser-debug", inc);
    forged_owner["owner"] = serde_json::json!("admin");
    let res = request(
        state.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(forged_owner.to_string()),
        true,
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn foreign_actor_cannot_upload_handoff_or_delete_artifact() {
    use dam_hopper_server::auth::model::{AuthClaims, AuthSession, UserRecord, UserRole};
    use dam_hopper_server::auth::{AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS};

    let temp = tempfile::tempdir().unwrap();
    let now = chrono::Utc::now();
    let exp_chrono = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();

    // User 1 (owner)
    let user1 = UserRecord {
        id: None,
        username: "user1".to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session1 = AuthSession {
        id: "session-user1".to_string(),
        username: "user1".to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: dam_hopper_server::auth::chrono_to_bson(now),
        expires_at: dam_hopper_server::auth::chrono_to_bson(exp_chrono),
        mfa_verified_at: dam_hopper_server::auth::chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };

    // User 2 (attacker)
    let user2 = UserRecord {
        id: None,
        username: "user2".to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role: UserRole::User,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session2 = AuthSession {
        id: "session-user2".to_string(),
        username: "user2".to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: dam_hopper_server::auth::chrono_to_bson(now),
        expires_at: dam_hopper_server::auth::chrono_to_bson(exp_chrono),
        mfa_verified_at: dam_hopper_server::auth::chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };

    let auth_svc1 = dam_hopper_server::auth::AuthService::new_mock(user1, session1);
    let state1 = make_state(&temp).with_auth_service(std::sync::Arc::new(auth_svc1));
    let auth_svc2 = dam_hopper_server::auth::AuthService::new_mock(user2, session2);
    let state2 = state1
        .clone()
        .with_auth_service(std::sync::Arc::new(auth_svc2));
    let inc = create_terminal(&state1, temp.path());

    let claims1 = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: "user1".to_string(),
        sid: "session-user1".to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    let cookie1 = format!("damhopper-auth={}", claims1.encode(TOKEN).unwrap());

    let claims2 = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: "user2".to_string(),
        sid: "session-user2".to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    let cookie2 = format!("damhopper-auth={}", claims2.encode(TOKEN).unwrap());

    // User 1 creates an artifact
    let created = request_with_cookie(
        state1.clone(),
        "POST",
        "/api/browser-debug/artifacts",
        Some("application/json"),
        Body::from(selection("shell:browser-debug", inc).to_string()),
        &cookie1,
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let created_body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(created.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let artifact_id = created_body["artifactId"].as_str().unwrap();

    // User 2 attempts to upload PNG -> 404 NOT_FOUND
    let foreign_upload = request_with_cookie(
        state2.clone(),
        "PUT",
        &format!("/api/browser-debug/artifacts/{artifact_id}/png"),
        Some("image/png"),
        Body::from(png()),
        &cookie2,
    )
    .await;
    assert_eq!(foreign_upload.status(), StatusCode::NOT_FOUND);

    // User 2 attempts to handoff -> 404 NOT_FOUND
    let foreign_handoff = request_with_cookie(
        state2.clone(),
        "POST",
        &format!("/api/browser-debug/artifacts/{artifact_id}/handoff"),
        None,
        Body::empty(),
        &cookie2,
    )
    .await;
    assert_eq!(foreign_handoff.status(), StatusCode::NOT_FOUND);

    // User 2 attempts to delete -> 404 NOT_FOUND
    let foreign_delete = request_with_cookie(
        state2.clone(),
        "DELETE",
        &format!("/api/browser-debug/artifacts/{artifact_id}"),
        None,
        Body::empty(),
        &cookie2,
    )
    .await;
    assert_eq!(foreign_delete.status(), StatusCode::NOT_FOUND);

    // User 1 can still upload PNG and handoff
    let owner_upload = request_with_cookie(
        state1.clone(),
        "PUT",
        &format!("/api/browser-debug/artifacts/{artifact_id}/png"),
        Some("image/png"),
        Body::from(png()),
        &cookie1,
    )
    .await;
    assert_eq!(owner_upload.status(), StatusCode::OK);

    let owner_handoff = request_with_cookie(
        state1.clone(),
        "POST",
        &format!("/api/browser-debug/artifacts/{artifact_id}/handoff"),
        None,
        Body::empty(),
        &cookie1,
    )
    .await;
    assert_eq!(owner_handoff.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------------------------
// Artifact terminal paths: retained (charged, retryable) unlink failures and registration cleanup.
// ---------------------------------------------------------------------------------------------

use dam_hopper_server::api::auth::AuthenticatedActor;
use dam_hopper_server::browser_debug::{
    ArtifactSource, BoxFuture, BrowserAdmissionAuthority, BrowserDebugArtifactManager,
    BrowserDebugError, BrowserSelectionBoundsV1, BrowserSelectionV1,
};

#[derive(Default)]
struct RecordingAuthority {
    retired: std::sync::Mutex<Vec<(String, uuid::Uuid)>>,
}

impl BrowserAdmissionAuthority for RecordingAuthority {
    fn check_managed_admission<'a>(
        &'a self,
        actor: &'a AuthenticatedActor,
        principal: &'a str,
        _profile_epoch: u64,
    ) -> BoxFuture<'a, bool> {
        Box::pin(async move { actor.subject == principal })
    }

    fn artifact_retired<'a>(
        &'a self,
        session_id: &'a str,
        artifact_id: uuid::Uuid,
    ) -> BoxFuture<'a, ()> {
        self.retired
            .lock()
            .unwrap()
            .push((session_id.to_string(), artifact_id));
        Box::pin(async {})
    }
}

fn sample_selection() -> BrowserSelectionV1 {
    BrowserSelectionV1 {
        version: 1,
        tag: "button".into(),
        role: None,
        accessible_name: None,
        text: Some("Save".into()),
        attributes: Default::default(),
        locator: "main > button".into(),
        bounds: BrowserSelectionBoundsV1 {
            x: 1.0,
            y: 2.0,
            width: 80.0,
            height: 32.0,
        },
    }
}

fn managed_source(principal: &str) -> ArtifactSource {
    ArtifactSource::ManagedBrowser {
        principal: principal.into(),
        profile_epoch: 1,
        browser_incarnation: "inc-1".into(),
    }
}

/// Makes unlinking inside `dir` fail with a permission error and proves the denial is real.
fn deny_unlink(dir: &std::path::Path) {
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    assert!(
        std::fs::File::create(dir.join("probe-denied")).is_err(),
        "test requires a non-root user so a read-only directory denies unlink"
    );
}

fn allow_unlink(dir: &std::path::Path) {
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
}

fn artifact_dir(json_path: &str) -> std::path::PathBuf {
    std::path::Path::new(json_path)
        .parent()
        .unwrap()
        .to_path_buf()
}

#[tokio::test]
async fn denied_unlink_on_delete_retires_the_artifact_into_charged_retryable_cleanup() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let actor = AuthenticatedActor::new("owner", None);
    let created = manager
        .create(
            "owner".into(),
            ArtifactSource::Cooperative,
            "shell:x".into(),
            1,
            sample_selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&created.artifact_id).unwrap();
    let dir = artifact_dir(&created.json_path);
    let charged = manager.reserved_bytes();
    assert!(charged > 0);

    deny_unlink(&dir);
    let denied = manager.delete(id, &actor).await;
    assert!(
        matches!(denied, Err(BrowserDebugError::Io(_))),
        "{denied:?}"
    );
    assert_eq!(
        manager.len().await,
        0,
        "ownership moved out of the entry map before the unlink was awaited"
    );
    assert_eq!(manager.pending_cleanup_count(), 1, "retained for retry");
    assert_eq!(manager.reserved_bytes(), charged, "quota stays charged");
    assert!(std::path::Path::new(&created.json_path).exists());
    assert!(matches!(
        manager.delete(id, &actor).await,
        Err(BrowserDebugError::NotFound)
    ));

    allow_unlink(&dir);
    manager.retry_pending_cleanups(Some("owner")).await.unwrap();
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert!(!std::path::Path::new(&created.json_path).exists());
}

#[tokio::test]
async fn denied_unlink_on_force_invalidate_stays_charged_retryable_and_reports_failure() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let created = manager
        .create(
            "owner".into(),
            ArtifactSource::Cooperative,
            "shell:x".into(),
            1,
            sample_selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&created.artifact_id).unwrap();
    let dir = artifact_dir(&created.json_path);
    let charged = manager.reserved_bytes();

    deny_unlink(&dir);
    assert!(matches!(
        manager.force_invalidate(id).await,
        Err(BrowserDebugError::Io(_))
    ));
    assert_eq!(
        manager.len().await,
        0,
        "invalidated artifact is no longer reachable"
    );
    assert_eq!(manager.pending_cleanup_count(), 1);
    assert_eq!(
        manager.reserved_bytes(),
        charged,
        "quota stays charged while the file remains"
    );
    assert!(std::path::Path::new(&created.json_path).exists());
    assert!(
        manager.retry_pending_cleanups(Some("owner")).await.is_err(),
        "retry keeps failing while the unlink is denied"
    );
    assert_eq!(manager.pending_cleanup_count(), 1);

    allow_unlink(&dir);
    manager.retry_pending_cleanups(Some("owner")).await.unwrap();
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert!(!std::path::Path::new(&created.json_path).exists());
}

#[tokio::test]
async fn principal_purge_fails_while_private_files_remain_and_ttl_sweeper_retries_it() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    manager.set_authority(Arc::new(RecordingAuthority::default()));
    let created = manager
        .create(
            "admin".into(),
            managed_source("admin"),
            "shell:x".into(),
            1,
            sample_selection(),
        )
        .await
        .unwrap();
    let dir = artifact_dir(&created.json_path);
    let charged = manager.reserved_bytes();

    deny_unlink(&dir);
    let purge = manager.revoke_managed_by_principal("admin", None).await;
    assert!(
        matches!(purge, Err(BrowserDebugError::Io(_))),
        "purge must not report completion: {purge:?}"
    );
    assert_eq!(manager.len().await, 0);
    assert_eq!(manager.pending_cleanup_count(), 1);
    assert_eq!(manager.reserved_bytes(), charged);
    assert!(std::path::Path::new(&created.json_path).exists());

    // The periodic sweeper retries retained cleanups; still denied -> still pending.
    manager.sweep_expired().await;
    assert_eq!(manager.pending_cleanup_count(), 1);

    allow_unlink(&dir);
    manager.sweep_expired().await;
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert!(!std::path::Path::new(&created.json_path).exists());
    manager
        .revoke_managed_by_principal("admin", None)
        .await
        .expect("purge completes once the files are gone");
}

#[tokio::test]
async fn delete_invalidate_and_revoke_retire_selection_registrations_exactly_once() {
    let temp = tempfile::tempdir().unwrap();
    let pty = PtySessionManager::new(Arc::new(NoopEventSink));
    let incarnation = pty
        .create(PtyCreateOpts {
            id: "shell:retire".into(),
            command: common::read_stdin_command().into(),
            cwd: temp.path().display().to_string(),
            env: Default::default(),
            cols: 80,
            rows: 24,
            project: None,
            worktree_path: None,
            name: None,
            restart_policy: Default::default(),
            restart_max_retries: 0,
        })
        .unwrap()
        .incarnation;
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let authority = Arc::new(RecordingAuthority::default());
    manager.set_authority(authority.clone());
    let actor = AuthenticatedActor::new("admin", None);

    let mut ids = Vec::new();
    for _ in 0..3 {
        let created = manager
            .create_managed_checked(
                &actor,
                managed_source("admin"),
                ("sess-1".into(), 1, 1),
                "shell:retire".into(),
                incarnation,
                sample_selection(),
                &pty,
            )
            .await
            .unwrap();
        ids.push(uuid::Uuid::parse_str(&created.artifact_id).unwrap());
    }

    manager.delete(ids[0], &actor).await.unwrap();
    manager.force_invalidate(ids[1]).await.unwrap();
    manager
        .revoke_managed_by_principal("admin", None)
        .await
        .unwrap();

    let mut retired = authority.retired.lock().unwrap().clone();
    retired.sort();
    let mut expected: Vec<_> = ids.iter().map(|id| ("sess-1".to_string(), *id)).collect();
    expected.sort();
    assert_eq!(
        retired, expected,
        "every terminal path retires its registration once"
    );
}

// ---------------------------------------------------------------------------------------------
// Cancelled writes and purge-vs-in-flight interleavings, driven by deterministic barriers.
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Default)]
struct Gate(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);

impl Gate {
    fn wait(&self) {
        let (lock, cvar) = &*self.0;
        let mut open = lock.lock().unwrap();
        while !*open {
            open = cvar.wait(open).unwrap();
        }
    }

    fn open(&self) {
        let (lock, cvar) = &*self.0;
        *lock.lock().unwrap() = true;
        cvar.notify_all();
    }
}

/// Opens the gate when dropped, so a failing assertion cannot leave a blocking worker parked
/// (which would hang runtime shutdown).
struct OpenOnDrop(Gate);

impl Drop for OpenOnDrop {
    fn drop(&mut self) {
        self.0.open();
    }
}

/// Hook that reports entry on `entered` and blocks until `gate` opens.
fn parked_hook(
    entered: std::sync::mpsc::Sender<()>,
    gate: Gate,
) -> Option<Arc<dyn Fn() + Send + Sync>> {
    Some(Arc::new(move || {
        let _ = entered.send(());
        gate.wait();
    }))
}

async fn await_entered(entered: std::sync::mpsc::Receiver<()>) {
    tokio::task::spawn_blocking(move || {
        entered
            .recv_timeout(Duration::from_secs(5))
            .expect("hook was never reached")
    })
    .await
    .unwrap();
}

async fn wait_until(mut cond: impl FnMut() -> bool) {
    let start = std::time::Instant::now();
    while !cond() {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "condition did not become true within 5s"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Learns the private artifact directory (one probe artifact, deleted again).
async fn private_artifact_dir(manager: &BrowserDebugArtifactManager) -> std::path::PathBuf {
    let probe = manager
        .create(
            "owner".into(),
            ArtifactSource::Cooperative,
            "shell:x".into(),
            1,
            sample_selection(),
        )
        .await
        .unwrap();
    let dir = artifact_dir(&probe.json_path);
    manager
        .delete(
            uuid::Uuid::parse_str(&probe.artifact_id).unwrap(),
            &AuthenticatedActor::new("owner", None),
        )
        .await
        .unwrap();
    assert_eq!(manager.reserved_bytes(), 0);
    dir
}

fn files_in(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir).unwrap().count()
}

fn spawn_create(
    manager: &BrowserDebugArtifactManager,
    owner: &'static str,
    source: ArtifactSource,
) -> tokio::task::JoinHandle<Result<(), BrowserDebugError>> {
    let manager = manager.clone();
    tokio::spawn(async move {
        manager
            .create(
                owner.into(),
                source,
                "shell:x".into(),
                1,
                sample_selection(),
            )
            .await
            .map(|_| ())
    })
}

/// Asserts the leftover private file is still owned (charged, owner-qualified, retryable) and
/// that cleanup completes once unlink works again.
async fn assert_retained_then_recovered(
    manager: &BrowserDebugArtifactManager,
    dir: &std::path::Path,
) {
    assert_eq!(manager.pending_cleanup_count(), 1);
    assert!(manager.reserved_bytes() > 0, "quota stays charged");
    assert_eq!(files_in(dir), 1, "the private file is still on disk");
    manager
        .retry_pending_cleanups(Some("someone-else"))
        .await
        .unwrap();
    assert_eq!(
        manager.pending_cleanup_count(),
        1,
        "retention is owner-qualified"
    );
    assert!(matches!(
        manager.retry_pending_cleanups(Some("owner")).await,
        Err(BrowserDebugError::Io(_))
    ));
    assert_eq!(manager.pending_cleanup_count(), 1);

    allow_unlink(dir);
    manager.retry_pending_cleanups(Some("owner")).await.unwrap();
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert_eq!(files_in(dir), 0);
}

#[tokio::test]
async fn cancelled_write_after_persist_with_denied_unlink_stays_charged_and_retryable() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let dir = private_artifact_dir(&manager).await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Gate::default();
    let _open = OpenOnDrop(gate.clone());
    *manager._after_persist_before_publish_hook.write().unwrap() =
        parked_hook(entered_tx, gate.clone());

    let task = spawn_create(&manager, "owner", ArtifactSource::Cooperative);
    await_entered(entered_rx).await;
    task.abort();
    let _ = task.await;
    deny_unlink(&dir);
    gate.open();

    wait_until(|| manager.pending_cleanup_count() == 1).await;
    assert_retained_then_recovered(&manager, &dir).await;
}

#[tokio::test]
async fn cancelled_write_before_persist_with_denied_temp_unlink_stays_charged_and_retryable() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let dir = private_artifact_dir(&manager).await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Gate::default();
    let _open = OpenOnDrop(gate.clone());
    *manager._after_temp_write_hook.write().unwrap() = parked_hook(entered_tx, gate.clone());

    let task = spawn_create(&manager, "owner", ArtifactSource::Cooperative);
    await_entered(entered_rx).await;
    task.abort();
    let _ = task.await;
    deny_unlink(&dir);
    gate.open();

    wait_until(|| manager.pending_cleanup_count() == 1).await;
    assert_retained_then_recovered(&manager, &dir).await;
}

#[tokio::test]
async fn failed_publication_with_denied_temp_unlink_stays_charged_and_retryable() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let dir = private_artifact_dir(&manager).await;
    // No cancellation: the directory turns read-only after the temp file is written, so the
    // publishing rename fails AND the writer's own cleanup of the temp file is denied.
    let denied_dir = dir.clone();
    *manager._after_temp_write_hook.write().unwrap() =
        Some(Arc::new(move || deny_unlink(&denied_dir)));

    let result = manager
        .create(
            "owner".into(),
            ArtifactSource::Cooperative,
            "shell:x".into(),
            1,
            sample_selection(),
        )
        .await;
    assert!(
        matches!(result, Err(BrowserDebugError::Io(_))),
        "publication must fail: {result:?}"
    );

    wait_until(|| manager.pending_cleanup_count() == 1).await;
    assert_retained_then_recovered(&manager, &dir).await;
}

#[tokio::test]
async fn write_completed_but_abandoned_with_denied_unlink_stays_charged_and_retryable() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let dir = private_artifact_dir(&manager).await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Gate::default();
    let _open = OpenOnDrop(gate.clone());
    *manager._after_persist_before_publish_hook.write().unwrap() =
        parked_hook(entered_tx, gate.clone());

    let task = spawn_create(&manager, "owner", ArtifactSource::Cooperative);
    await_entered(entered_rx).await;
    deny_unlink(&dir);
    gate.open();
    // Single-threaded runtime: the finished write cannot be observed by the task until the test
    // yields, so aborting now drops the future AFTER the worker published its file.
    std::thread::sleep(Duration::from_millis(300));
    task.abort();
    let _ = task.await;

    wait_until(|| manager.pending_cleanup_count() == 1).await;
    assert_retained_then_recovered(&manager, &dir).await;
}

#[tokio::test]
async fn reset_purge_sees_an_unlink_already_in_flight_for_a_deleted_artifact() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    manager.set_authority(Arc::new(RecordingAuthority::default()));
    let created = manager
        .create(
            "admin".into(),
            managed_source("admin"),
            "shell:x".into(),
            1,
            sample_selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&created.artifact_id).unwrap();

    // The first unlink attempt (the delete's) parks before touching the disk.
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Gate::default();
    let _open = OpenOnDrop(gate.clone());
    let first = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let parked = parked_hook(entered_tx, gate.clone()).unwrap();
    *manager._before_unlink_hook.write().unwrap() = Some(Arc::new(move || {
        if first.swap(false, std::sync::atomic::Ordering::SeqCst) {
            parked();
        }
    }));
    let deleter = {
        let manager = manager.clone();
        tokio::spawn(async move {
            manager
                .delete(id, &AuthenticatedActor::new("admin", None))
                .await
        })
    };
    await_entered(entered_rx).await;

    // Metadata is gone but the unlink has not happened: the files must already be owned.
    assert_eq!(manager.len().await, 0);
    assert_eq!(manager.pending_cleanup_count(), 1);
    assert!(std::path::Path::new(&created.json_path).exists());

    // A reset purging this principal now must find and remove them, not report completion early.
    manager
        .revoke_managed_by_principal("admin", None)
        .await
        .expect("purge removes the in-flight deletion's files");
    assert!(!std::path::Path::new(&created.json_path).exists());
    assert_eq!(manager.reserved_bytes(), 0);
    assert_eq!(manager.pending_cleanup_count(), 0);

    gate.open();
    deleter.await.unwrap().expect("delete completes");
    assert_eq!(manager.reserved_bytes(), 0, "quota released exactly once");
}

#[tokio::test]
async fn reset_purge_waits_for_an_unpublished_writer_started_before_its_fence() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let dir = private_artifact_dir(&manager).await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Gate::default();
    let _open = OpenOnDrop(gate.clone());
    *manager._after_persist_before_publish_hook.write().unwrap() =
        parked_hook(entered_tx, gate.clone());

    let writer = spawn_create(&manager, "admin", managed_source("admin"));
    await_entered(entered_rx).await;
    assert_eq!(files_in(&dir), 1, "the writer's file is in neither map");

    let purge = manager.revoke_managed_by_principal("admin", None).await;
    assert!(
        matches!(purge, Err(BrowserDebugError::OperationsInFlight)),
        "purge must not complete while a pre-fence writer is unowned: {purge:?}"
    );

    gate.open();
    assert!(matches!(
        writer.await.unwrap(),
        Err(BrowserDebugError::NotFound)
    ));
    manager
        .revoke_managed_by_principal("admin", None)
        .await
        .expect("purge completes once the writer cleaned up");
    assert_eq!(files_in(&dir), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert_eq!(manager.pending_cleanup_count(), 0);
}

// ---------------------------------------------------------------------------------------------
// Explicit discard of a just-published managed file: cancellation must not forget the file.
// ---------------------------------------------------------------------------------------------

/// Admits until `admitted` flips, so a test can fail the admission recheck made AFTER the write.
#[derive(Default)]
struct SwitchAuthority {
    revoked: std::sync::atomic::AtomicBool,
}

impl BrowserAdmissionAuthority for SwitchAuthority {
    fn check_managed_admission<'a>(
        &'a self,
        actor: &'a AuthenticatedActor,
        principal: &'a str,
        _profile_epoch: u64,
    ) -> BoxFuture<'a, bool> {
        let ok =
            actor.subject == principal && !self.revoked.load(std::sync::atomic::Ordering::SeqCst);
        Box::pin(async move { ok })
    }
}

/// Parks a managed create inside its discard (`cleanup_now`), aborts it there while the unlink
/// is denied, and expects the published file to stay owned, charged and retryable.
/// `trigger` runs on the blocking writer right after the file is published, so it decides why
/// the artifact must be discarded.
async fn assert_cancelled_discard_keeps_the_file_owned(
    trigger: impl Fn(&BrowserDebugArtifactManager, &SwitchAuthority) + Send + Sync + 'static,
) {
    let temp = tempfile::tempdir().unwrap();
    let pty = PtySessionManager::new(Arc::new(NoopEventSink));
    let incarnation = pty
        .create(PtyCreateOpts {
            id: "shell:discard".into(),
            command: common::read_stdin_command().into(),
            cwd: temp.path().display().to_string(),
            env: Default::default(),
            cols: 80,
            rows: 24,
            project: None,
            worktree_path: None,
            name: None,
            restart_policy: Default::default(),
            restart_max_retries: 0,
        })
        .unwrap()
        .incarnation;
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let authority = Arc::new(SwitchAuthority::default());
    manager.set_authority(authority.clone());
    let dir = private_artifact_dir(&manager).await;

    // After the file is published: make unlink fail and fire the trigger that dooms the artifact.
    {
        let (hook_manager, authority, dir) = (manager.clone(), authority.clone(), dir.clone());
        *manager._after_persist_before_publish_hook.write().unwrap() = Some(Arc::new(move || {
            deny_unlink(&dir);
            trigger(&hook_manager, &authority);
        }));
    }
    // The discard's unlink parks before touching the disk.
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Gate::default();
    let _open = OpenOnDrop(gate.clone());
    *manager._before_unlink_hook.write().unwrap() = parked_hook(entered_tx, gate.clone());

    let creator = {
        let manager = manager.clone();
        tokio::spawn(async move {
            manager
                .create_managed_checked(
                    &AuthenticatedActor::new("admin", None),
                    managed_source("admin"),
                    ("sess-discard".into(), 1, 1),
                    "shell:discard".into(),
                    incarnation,
                    sample_selection(),
                    &pty,
                )
                .await
        })
    };
    await_entered(entered_rx).await;
    creator.abort();
    let _ = creator.await;
    gate.open();
    *manager._before_unlink_hook.write().unwrap() = None;
    // Drops the hook's clone of the manager (it fired once, before the unlink parked).
    *manager._after_persist_before_publish_hook.write().unwrap() = None;

    // The cancelled discard handed path and charge to the retryable set.
    wait_until(|| manager.pending_cleanup_count() == 1).await;
    assert!(manager.reserved_bytes() > 0, "quota stays charged");
    assert_eq!(files_in(&dir), 1, "the private file is still on disk");
    assert_eq!(manager.len().await, 0);
    assert!(
        manager.retry_pending_cleanups(Some("admin")).await.is_err(),
        "a purge must not complete while the file remains"
    );
    assert_eq!(manager.pending_cleanup_count(), 1);

    allow_unlink(&dir);
    manager.sweep_expired().await;
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert_eq!(files_in(&dir), 0);
    manager
        .retry_pending_cleanups(Some("admin"))
        .await
        .expect("purge completes once the file is gone");
}

#[tokio::test]
async fn cancelled_discard_after_admission_recheck_failure_keeps_the_denied_file_owned() {
    assert_cancelled_discard_keeps_the_file_owned(|_, authority| {
        authority
            .revoked
            .store(true, std::sync::atomic::Ordering::SeqCst)
    })
    .await;
}

#[tokio::test]
async fn cancelled_discard_after_generation_rejection_keeps_the_denied_file_owned() {
    let runtime = tokio::runtime::Handle::current();
    assert_cancelled_discard_keeps_the_file_owned(move |manager, _| {
        // A principal fence landing between the write and the commit rejects the artifact.
        runtime.block_on(manager.fence_managed_by_principal_and_ids("admin", None, &[]));
    })
    .await;
}
