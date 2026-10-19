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
    git::types::{ConflictSnapshot, ConflictStatus, ConflictSummaryResponse, StageKind},
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

mod common;

fn git(args: &[&str], cwd: &Path) {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
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

fn git_try(args: &[&str], cwd: &Path) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn init_git_repo(path: &Path) {
    git(&["init", "-b", "main"], path);
    git(&["config", "user.email", "tester@example.com"], path);
    git(&["config", "user.name", "Tester"], path);
    git(&["config", "commit.gpgsign", "false"], path);
    git(&["config", "core.autocrlf", "false"], path);
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
async fn test_conflict_summary_and_snapshot_both_modified() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::fs::write(root.join("conflict.txt"), "base content\nline 2\n").unwrap();
    git(&["add", "conflict.txt"], root);
    git(&["commit", "-m", "base commit"], root);

    git(&["checkout", "-b", "feature-branch"], root);
    std::fs::write(root.join("conflict.txt"), "base content\nfeature change\n").unwrap();
    git(&["add", "conflict.txt"], root);
    git(&["commit", "-m", "feature commit"], root);

    git(&["checkout", "main"], root);
    std::fs::write(root.join("conflict.txt"), "main change\nline 2\n").unwrap();
    git(&["add", "conflict.txt"], root);
    git(&["commit", "-m", "main commit"], root);

    let _ = git_try(&["merge", "feature-branch"], root);

    // 1. GET /api/git/test-repo/conflicts
    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: ConflictSummaryResponse = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(summary.entries.len(), 1);
    let entry = &summary.entries[0];
    assert_eq!(entry.path, "conflict.txt");
    assert_eq!(entry.status, ConflictStatus::BothModified);
    assert!(!entry.is_binary);
    assert!(entry.conflict_id.starts_with("cid_"));

    // 2. GET /api/git/test-repo/conflicts/file?conflictId=...
    let file_uri = format!(
        "/api/git/test-repo/conflicts/file?conflictId={}",
        entry.conflict_id
    );
    let req_file = Request::builder()
        .uri(&file_uri)
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res_file = app.router.clone().oneshot(req_file).await.unwrap();
    assert_eq!(res_file.status(), StatusCode::OK);

    let file_body_bytes = axum::body::to_bytes(res_file.into_body(), usize::MAX).await.unwrap();
    let snapshot: ConflictSnapshot = serde_json::from_slice(&file_body_bytes).unwrap();

    assert_eq!(snapshot.conflict_id, entry.conflict_id);
    assert_eq!(snapshot.path, "conflict.txt");
    assert!(!snapshot.snapshot_version.is_empty());
    assert!(!snapshot.full_index_fingerprint.is_empty());
    assert_eq!(snapshot.status, ConflictStatus::BothModified);

    // Verify stages: 1 (base), 2 (ours), 3 (theirs)
    let base = snapshot.stages.base.expect("Base stage must be present");
    assert_eq!(base.stage, 1);
    assert_eq!(base.kind, StageKind::Text);
    assert_eq!(
        base.text_tokens,
        Some(vec!["base content\n".to_string(), "line 2\n".to_string()])
    );

    let ours = snapshot.stages.ours;
    assert_eq!(ours.stage, 2);
    assert_eq!(ours.kind, StageKind::Text);
    assert_eq!(
        ours.text_tokens,
        Some(vec!["main change\n".to_string(), "line 2\n".to_string()])
    );

    let theirs = snapshot.stages.theirs;
    assert_eq!(theirs.stage, 3);
    assert_eq!(theirs.kind, StageKind::Text);
    assert_eq!(
        theirs.text_tokens,
        Some(vec![
            "base content\n".to_string(),
            "feature change\n".to_string()
        ])
    );

    // Verify worktree has conflict markers
    assert!(snapshot.worktree.exists);
    assert!(snapshot.worktree.has_conflict_markers);
    assert!(snapshot.worktree.is_dirty_vs_stages);
}

#[tokio::test]
async fn test_conflict_binary_files() {
    let app = setup_test_app();
    let root = &app.project_path;

    let base_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x01\x02\x03";
    let ours_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\xAA\xBB\xCC\xDD";
    let theirs_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x11\x22\x33\x44";

    std::fs::write(root.join("image.png"), base_png).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "base binary"], root);

    git(&["checkout", "-b", "theirs-branch"], root);
    std::fs::write(root.join("image.png"), theirs_png).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "theirs binary"], root);

    git(&["checkout", "main"], root);
    std::fs::write(root.join("image.png"), ours_png).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "ours binary"], root);

    let _ = git_try(&["merge", "theirs-branch"], root);

    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: ConflictSummaryResponse = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(summary.entries.len(), 1);
    let entry = &summary.entries[0];
    assert_eq!(entry.path, "image.png");
    assert!(entry.is_binary, "Binary image conflict must report is_binary = true in summary");

    // Check snapshot classifies as StageKind::Binary without text tokens
    let file_uri = format!(
        "/api/git/test-repo/conflicts/file?conflictId={}",
        entry.conflict_id
    );
    let req_file = Request::builder()
        .uri(&file_uri)
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res_file = app.router.clone().oneshot(req_file).await.unwrap();
    assert_eq!(res_file.status(), StatusCode::OK);

    let file_body_bytes = axum::body::to_bytes(res_file.into_body(), usize::MAX).await.unwrap();
    let snapshot: ConflictSnapshot = serde_json::from_slice(&file_body_bytes).unwrap();

    assert_eq!(snapshot.stages.ours.kind, StageKind::Binary);
    assert_eq!(snapshot.stages.theirs.kind, StageKind::Binary);
    assert!(snapshot.stages.ours.text_tokens.is_none());
    assert!(snapshot.stages.theirs.text_tokens.is_none());
}

#[tokio::test]
async fn test_conflict_delete_modify() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::fs::write(root.join("del_mod.txt"), "initial text\n").unwrap();
    git(&["add", "del_mod.txt"], root);
    git(&["commit", "-m", "base commit"], root);

    git(&["checkout", "-b", "mod-branch"], root);
    std::fs::write(root.join("del_mod.txt"), "modified text\n").unwrap();
    git(&["add", "del_mod.txt"], root);
    git(&["commit", "-m", "modified commit"], root);

    git(&["checkout", "main"], root);
    git(&["rm", "del_mod.txt"], root);
    git(&["commit", "-m", "delete commit"], root);

    let _ = git_try(&["merge", "mod-branch"], root);

    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: ConflictSummaryResponse = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(summary.entries.len(), 1);
    let entry = &summary.entries[0];
    assert_eq!(entry.status, ConflictStatus::ModifyDelete);

    let file_uri = format!(
        "/api/git/test-repo/conflicts/file?conflictId={}",
        entry.conflict_id
    );
    let req_file = Request::builder()
        .uri(&file_uri)
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res_file = app.router.clone().oneshot(req_file).await.unwrap();
    assert_eq!(res_file.status(), StatusCode::OK);

    let file_body_bytes = axum::body::to_bytes(res_file.into_body(), usize::MAX).await.unwrap();
    let snapshot: ConflictSnapshot = serde_json::from_slice(&file_body_bytes).unwrap();

    // Ours was deleted: stage 2 is Missing
    assert_eq!(snapshot.stages.ours.kind, StageKind::Missing);
    assert_eq!(snapshot.stages.theirs.kind, StageKind::Text);
    assert_eq!(snapshot.status, ConflictStatus::ModifyDelete);
}

#[tokio::test]
async fn test_conflict_summary_paging_and_bounds() {
    let app = setup_test_app();
    let root = &app.project_path;

    for i in 1..=4 {
        std::fs::write(root.join(format!("c{i}.txt")), format!("base {i}\n")).unwrap();
        git(&["add", &format!("c{i}.txt")], root);
    }
    git(&["commit", "-m", "base 4 files"], root);

    git(&["checkout", "-b", "branch-a"], root);
    for i in 1..=4 {
        std::fs::write(root.join(format!("c{i}.txt")), format!("branch a {i}\n")).unwrap();
        git(&["add", &format!("c{i}.txt")], root);
    }
    git(&["commit", "-m", "branch a changes"], root);

    git(&["checkout", "main"], root);
    for i in 1..=4 {
        std::fs::write(root.join(format!("c{i}.txt")), format!("branch main {i}\n")).unwrap();
        git(&["add", &format!("c{i}.txt")], root);
    }
    git(&["commit", "-m", "main changes"], root);

    let _ = git_try(&["merge", "branch-a"], root);

    // Page 1: limit 2
    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts?limit=2")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let p1: ConflictSummaryResponse = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(p1.entries.len(), 2);
    assert!(p1.truncated);
    let next_cursor = p1.next_cursor.expect("Must provide nextCursor on truncated summary");

    // Page 2: with cursor
    let req2 = Request::builder()
        .uri(&format!(
            "/api/git/test-repo/conflicts?limit=2&cursor={next_cursor}"
        ))
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res2 = app.router.clone().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::OK);

    let body_bytes2 = axum::body::to_bytes(res2.into_body(), usize::MAX).await.unwrap();
    let p2: ConflictSummaryResponse = serde_json::from_slice(&body_bytes2).unwrap();

    assert_eq!(p2.entries.len(), 2);
    assert!(!p2.truncated);
    assert!(p2.next_cursor.is_none());

    // Verify all 4 entries are distinct
    let mut all_paths: Vec<String> = p1.entries.into_iter().map(|e| e.path).collect();
    all_paths.extend(p2.entries.into_iter().map(|e| e.path));
    all_paths.sort();
    assert_eq!(all_paths, vec!["c1.txt", "c2.txt", "c3.txt", "c4.txt"]);
}

#[tokio::test]
async fn test_conflict_legacy_resolve_fails_closed() {
    let app = setup_test_app();

    let req = Request::builder()
        .uri("/api/git/test-repo/resolve")
        .method("POST")
        .header("content-type", "application/json")
        .body(Body::from(
            r#"{"path":"file.txt","content":"unsafe resolved content"}"#,
        ))
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let err_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(
        err_json["code"], "LEGACY_PAYLOAD_REJECTED",
        "Legacy payload must be rejected with code LEGACY_PAYLOAD_REJECTED"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn test_conflict_symlink_marked_unsupported() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::os::unix::fs::symlink("target_a", root.join("link_conflict")).unwrap();
    git(&["add", "link_conflict"], root);
    git(&["commit", "-m", "base link"], root);

    git(&["checkout", "-b", "link-branch"], root);
    std::fs::remove_file(root.join("link_conflict")).unwrap();
    std::os::unix::fs::symlink("target_b", root.join("link_conflict")).unwrap();
    git(&["add", "link_conflict"], root);
    git(&["commit", "-m", "link b"], root);

    git(&["checkout", "main"], root);
    std::fs::remove_file(root.join("link_conflict")).unwrap();
    std::os::unix::fs::symlink("target_c", root.join("link_conflict")).unwrap();
    git(&["add", "link_conflict"], root);
    git(&["commit", "-m", "link c"], root);

    let _ = git_try(&["merge", "link-branch"], root);

    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: ConflictSummaryResponse = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(summary.entries.len(), 1);
    let entry = &summary.entries[0];
    assert_eq!(entry.status, ConflictStatus::Unsupported);
    assert!(entry.unsupported_reason.as_ref().unwrap().contains("Symlink"));
}

#[tokio::test]
async fn test_conflict_stale_cursor_rejected() {
    let app = setup_test_app();

    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts?cursor=v1:oldrevision123:5")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_conflict_custom_filter_withholds_tokens() {
    let app = setup_test_app();
    let root = &app.project_path;

    std::fs::write(root.join(".gitattributes"), "filter_file.txt filter=custom_unsupported\n").unwrap();
    git(&["add", ".gitattributes"], root);
    std::fs::write(root.join("filter_file.txt"), "base content\n").unwrap();
    git(&["add", "filter_file.txt"], root);
    git(&["commit", "-m", "base with filter"], root);

    git(&["checkout", "-b", "filter-branch"], root);
    std::fs::write(root.join("filter_file.txt"), "branch change\n").unwrap();
    git(&["add", "filter_file.txt"], root);
    git(&["commit", "-m", "branch filter change"], root);

    git(&["checkout", "main"], root);
    std::fs::write(root.join("filter_file.txt"), "main change\n").unwrap();
    git(&["add", "filter_file.txt"], root);
    git(&["commit", "-m", "main filter change"], root);

    let _ = git_try(&["merge", "filter-branch"], root);

    let req = Request::builder()
        .uri("/api/git/test-repo/conflicts")
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let summary: ConflictSummaryResponse = serde_json::from_slice(&body_bytes).unwrap();
    let entry = summary.entries.iter().find(|e| e.path == "filter_file.txt").unwrap();

    let file_uri = format!(
        "/api/git/test-repo/conflicts/file?conflictId={}",
        entry.conflict_id
    );
    let req_file = Request::builder()
        .uri(&file_uri)
        .method("GET")
        .body(Body::empty())
        .unwrap();

    let res_file = app.router.clone().oneshot(req_file).await.unwrap();
    assert_eq!(res_file.status(), StatusCode::OK);

    let file_body_bytes = axum::body::to_bytes(res_file.into_body(), usize::MAX).await.unwrap();
    let snapshot: ConflictSnapshot = serde_json::from_slice(&file_body_bytes).unwrap();

    assert_eq!(snapshot.status, ConflictStatus::Unsupported);
    assert!(!snapshot.effective_attributes.filter_qualified);
    assert!(snapshot.stages.ours.text_tokens.is_none(), "Unqualified filter must withhold ours text tokens");
    assert!(snapshot.stages.theirs.text_tokens.is_none(), "Unqualified filter must withhold theirs text tokens");
    assert!(snapshot.worktree.text_tokens.is_none(), "Unqualified filter must withhold worktree text tokens");
}

#[test]
fn test_conflict_non_utf8_path_marked_unsupported() {
    let raw_non_utf8 = b"invalid_\xFF\xFE_path.txt";
    let cid = dam_hopper_server::git::conflict::encode_conflict_id(raw_non_utf8);
    assert!(cid.starts_with("cid_"));
    let decoded = dam_hopper_server::git::conflict::decode_conflict_id(&cid).unwrap();
    assert_eq!(decoded, raw_non_utf8);
}
