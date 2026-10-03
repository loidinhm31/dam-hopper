use std::path::Path;
use std::process::Command;
use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::router::build_router,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, ServerConfig,
        WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;

mod common;

fn git(args: &[&str], cwd: &Path) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {args:?} failed in {}: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_output(args: &[&str], cwd: &Path) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {args:?} failed in {}: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git output not utf-8")
        .trim()
        .to_string()
}

fn init_git_repo(path: &Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "test@example.com"], path);
    git(&["config", "user.name", "Test User"], path);
    std::fs::write(path.join("file1.txt"), "hello world\n").unwrap();
    git(&["add", "file1.txt"], path);
    git(&["commit", "-m", "initial commit"], path);
}

struct TestApp {
    router: axum::Router,
    _temp_dir: TempDir,
    project_path: std::path::PathBuf,
}

fn setup_test_app() -> TestApp {
    let temp_dir = tempfile::tempdir().unwrap();
    let root_path = temp_dir.path().to_path_buf();
    let project_dir = root_path.join("test-repo");
    std::fs::create_dir_all(&project_dir).unwrap();
    init_git_repo(&project_dir);

    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: root_path.display().to_string(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![ProjectConfig {
            name: "test-repo".into(),
            path: project_dir.display().to_string(),
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
        config_path: root_path.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = root_path.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-jwt-key".to_string();
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(root_path.join("diagnostics.jsonl"));

    let app_state = AppState::new(
        root_path.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None,
        true, // no-auth
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("Failed to create AppState");

    let router = build_router(app_state);

    TestApp {
        router,
        _temp_dir: temp_dir,
        project_path: project_dir,
    }
}

#[tokio::test]
async fn test_api_paired_get_and_edit_commit_message() {
    let app = setup_test_app();
    let head_oid = git_output(&["rev-parse", "HEAD"], &app.project_path);

    // 1. GET commit message
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/git/test-repo/commit/{head_oid}/message"))
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let snap: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(snap["message"], "initial commit\n");
    assert_eq!(snap["branch"], "refs/heads/main");
    assert_eq!(snap["headOid"], head_oid);

    // 2. POST edit commit message
    let edit_body = json!({
        "message": "Updated commit message\n",
        "expectedBranch": snap["branch"],
        "expectedHeadOid": snap["headOid"],
        "allowSignatureRemoval": false
    });

    let edit_req = Request::builder()
        .method("POST")
        .uri(format!("/api/git/test-repo/commit/{head_oid}/message"))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&edit_body).unwrap()))
        .unwrap();

    let edit_res = app.router.clone().oneshot(edit_req).await.unwrap();
    assert_eq!(edit_res.status(), StatusCode::OK);

    let edit_bytes = axum::body::to_bytes(edit_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let action_res: Value = serde_json::from_slice(&edit_bytes).unwrap();
    assert_eq!(action_res["ok"], true);

    let new_head = action_res["newHeadOid"].as_str().unwrap();
    assert_ne!(new_head, head_oid);

    // Independent oracle check via git binary on disk
    let current_log = git_output(&["log", "-1", "--pretty=%B"], &app.project_path);
    assert_eq!(current_log.trim(), "Updated commit message");

    let current_head = git_output(&["rev-parse", "HEAD"], &app.project_path);
    assert_eq!(current_head, new_head);

    // 3. Re-POST with now-stale expectedHeadOid must be blocked
    let stale_req = Request::builder()
        .method("POST")
        .uri(format!("/api/git/test-repo/commit/{head_oid}/message"))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&edit_body).unwrap()))
        .unwrap();

    let stale_res = app.router.clone().oneshot(stale_req).await.unwrap();
    assert_eq!(stale_res.status(), StatusCode::OK);

    let stale_bytes = axum::body::to_bytes(stale_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let stale_json: Value = serde_json::from_slice(&stale_bytes).unwrap();
    assert_eq!(stale_json["ok"], false);
    assert_eq!(stale_json["blockedReason"], "stale-ref");
}

#[tokio::test]
async fn test_api_edit_commit_message_preserves_dirty_worktree() {
    let app = setup_test_app();

    // Create staged, unstaged, and untracked changes
    std::fs::write(app.project_path.join("unstaged.txt"), "unstaged content\n").unwrap();
    git(&["add", "unstaged.txt"], &app.project_path);
    git(&["commit", "-m", "add unstaged file"], &app.project_path);

    // Staged change
    std::fs::write(app.project_path.join("file1.txt"), "modified file1\n").unwrap();
    git(&["add", "file1.txt"], &app.project_path);

    // Unstaged change
    std::fs::write(app.project_path.join("unstaged.txt"), "unstaged modified\n").unwrap();

    // Untracked change
    std::fs::write(
        app.project_path.join("untracked.txt"),
        "untracked content\n",
    )
    .unwrap();
    let new_tip = git_output(&["rev-parse", "HEAD"], &app.project_path);
    let snap_req = Request::builder()
        .method("GET")
        .uri(format!("/api/git/test-repo/commit/{new_tip}/message"))
        .body(Body::empty())
        .unwrap();

    let snap_res = app.router.clone().oneshot(snap_req).await.unwrap();
    let snap_bytes = axum::body::to_bytes(snap_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let snap: Value = serde_json::from_slice(&snap_bytes).unwrap();

    let edit_body = json!({
        "message": "Rewritten message with dirty tree\n",
        "expectedBranch": snap["branch"],
        "expectedHeadOid": snap["headOid"],
        "allowSignatureRemoval": false
    });

    let edit_req = Request::builder()
        .method("POST")
        .uri(format!("/api/git/test-repo/commit/{new_tip}/message"))
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&edit_body).unwrap()))
        .unwrap();

    let edit_res = app.router.clone().oneshot(edit_req).await.unwrap();
    let edit_bytes = axum::body::to_bytes(edit_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let action_res: Value = serde_json::from_slice(&edit_bytes).unwrap();
    assert_eq!(action_res["ok"], true);

    // Verify staged, unstaged, and untracked changes are completely preserved byte-identical
    assert_eq!(
        std::fs::read_to_string(app.project_path.join("file1.txt")).unwrap(),
        "modified file1\n"
    );
    assert_eq!(
        std::fs::read_to_string(app.project_path.join("unstaged.txt")).unwrap(),
        "unstaged modified\n"
    );
    assert_eq!(
        std::fs::read_to_string(app.project_path.join("untracked.txt")).unwrap(),
        "untracked content\n"
    );

    let status = git_output(&["status", "--porcelain"], &app.project_path);
    assert!(status.contains("M  file1.txt")); // staged
    assert!(status.contains(" M unstaged.txt")); // unstaged
    assert!(status.contains("?? untracked.txt")); // untracked
}

#[tokio::test]
async fn test_api_commit_message_unknown_project_returns_not_found() {
    let app = setup_test_app();
    let req = Request::builder()
        .method("GET")
        .uri(
            "/api/git/non-existent-project/commit/abcdef1234567890abcdef1234567890abcdef12/message",
        )
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_api_message_reads_do_not_contend_with_ref_locks() {
    let app = setup_test_app();
    let head_oid = git_output(&["rev-parse", "HEAD"], &app.project_path);
    let repo = git2::Repository::open(&app.project_path).unwrap();
    let mut transaction = repo.transaction().unwrap();
    transaction.lock_ref("HEAD").unwrap();
    transaction.lock_ref("refs/heads/main").unwrap();

    // Concurrent draft reads are observational; only the later mutation acquires write locks.
    let read = || {
        app.router.clone().oneshot(
            Request::builder()
                .uri(format!("/api/git/test-repo/commit/{head_oid}/message"))
                .body(Body::empty())
                .unwrap(),
        )
    };
    let (first, second) = tokio::join!(read(), read());
    for response in [first.unwrap(), second.unwrap()] {
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let snapshot: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(snapshot["message"], "initial commit\n");
        assert_eq!(snapshot["branch"], "refs/heads/main");
        assert_eq!(snapshot["headOid"], head_oid);
    }
    assert_eq!(
        git_output(&["rev-parse", "HEAD"], &app.project_path),
        head_oid
    );
}

#[tokio::test]
async fn test_api_message_preserves_raw_body_whitespace_unicode_and_nul() {
    let app = setup_test_app();
    let repo = git2::Repository::open(&app.project_path).unwrap();
    let odb = repo.odb().unwrap();
    let original = odb.read(repo.head().unwrap().target().unwrap()).unwrap();
    let boundary = original
        .data()
        .windows(2)
        .position(|bytes| bytes == b"\n\n")
        .unwrap()
        + 2;
    let message = "\n\nSubject Đặng\n\nBody before\0after NUL  \nTrailer: giữ nguyên\n\n";
    let mut payload = original.data()[..boundary].to_vec();
    payload.extend_from_slice(message.as_bytes());
    let oid = odb.write(git2::ObjectType::Commit, &payload).unwrap();
    repo.find_reference("refs/heads/main")
        .unwrap()
        .set_target(oid, "raw message fixture")
        .unwrap();

    let response = app
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/git/test-repo/commit/{oid}/message"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let snapshot: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(snapshot["message"], message);
    assert_eq!(snapshot["headOid"], oid.to_string());
    assert_eq!(repo.head().unwrap().target(), Some(oid));
}
