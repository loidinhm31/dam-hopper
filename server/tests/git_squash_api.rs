use std::path::{Path, PathBuf};
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

fn git(args: &[&str], cwd: &Path) -> Vec<u8> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

fn text(args: &[&str], cwd: &Path) -> String {
    String::from_utf8(git(args, cwd))
        .unwrap()
        .trim()
        .to_string()
}

fn init(path: &Path) {
    std::fs::create_dir_all(path).unwrap();
    git(&["init", "-b", "main"], path);
    git(&["config", "user.name", "API Committer"], path);
    git(&["config", "user.email", "api@example.com"], path);
    for i in 0..4 {
        std::fs::write(path.join("tracked"), format!("version {i}\n")).unwrap();
        git(&["add", "tracked"], path);
        git(
            &["commit", "-m", &format!("subject {i}\n\nfull body {i} ✓")],
            path,
        );
    }
}

fn chain(path: &Path) -> Vec<String> {
    text(&["rev-list", "--reverse", "HEAD"], path)
        .lines()
        .map(str::to_owned)
        .collect()
}

fn project(name: &str, path: &Path) -> ProjectConfig {
    ProjectConfig {
        name: name.into(),
        path: path.display().to_string(),
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
    }
}

struct TestApp {
    router: axum::Router,
    _dir: TempDir,
    path: PathBuf,
    other: PathBuf,
    worktree: PathBuf,
}

fn setup(no_auth: bool) -> TestApp {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let path = root.join("test-repo");
    let other = root.join("other-repo");
    init(&path);
    init(&other);
    let worktree = root.join("linked");
    git(
        &[
            "worktree",
            "add",
            "-b",
            "feature",
            worktree.to_str().unwrap(),
        ],
        &path,
    );
    init(&worktree.join("modules/child"));
    init(&worktree.join("modules/sibling"));
    let (sink, _rx) = BroadcastEventSink::new(512);
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test".into(),
            root: root.display().to_string(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![project("test-repo", &path), project("other-repo", &other)],
        features: FeaturesConfig::default(),
        config_path: root.join("dam-hopper.toml"),
    };
    let state = AppState::new(
        root.to_path_buf(),
        config,
        GlobalConfig::default(),
        PtySessionManager::new(Arc::new(sink.clone())),
        AgentStoreService::new(root.join("agent-store")),
        sink.clone(),
        "test-secret-jwt-key".into(),
        FsSubsystem::new(vec![]),
        None,
        no_auth,
        common::make_tunnel_manager(&sink),
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(root.join("diagnostics.jsonl")),
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .unwrap();
    TestApp {
        router: build_router(state),
        _dir: dir,
        path,
        other,
        worktree,
    }
}

async fn request(
    router: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<&Value>,
    bearer: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = bearer {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    let payload = if let Some(value) = body {
        builder = builder.header("Content-Type", "application/json");
        Body::from(serde_json::to_vec(value).unwrap())
    } else {
        Body::empty()
    };
    let response = router
        .clone()
        .oneshot(builder.body(payload).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn snapshots(app: &TestApp, hashes: &[String], query: &str) -> Value {
    let mut snapshot = Value::Null;
    for hash in hashes {
        let (status, value) = request(
            &app.router,
            "GET",
            &format!("/api/git/test-repo/commit/{hash}/message{query}"),
            None,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{value}");
        assert!(value["message"].as_str().unwrap().contains("full body"));
        if !snapshot.is_null() {
            assert_eq!(snapshot["branch"], value["branch"]);
            assert_eq!(snapshot["headOid"], value["headOid"]);
        }
        snapshot = value;
    }
    snapshot
}

fn body(hashes: &[String], snapshot: &Value) -> Value {
    json!({"hashes": hashes, "message": "  gộp ✓\n\nfull body\n\n", "expectedBranch": snapshot["branch"], "expectedHeadOid": snapshot["headOid"]})
}

#[tokio::test]
async fn test_api_paired_messages_squash_older_range_and_stale_response() {
    let app = setup(true);
    let hashes = chain(&app.path);
    let snapshot = snapshots(&app, &hashes[..2], "").await;
    let body = body(&hashes[..2], &snapshot);
    let tree = text(&["rev-parse", "HEAD^{tree}"], &app.path);
    let index = std::fs::read(app.path.join(".git/index")).unwrap();
    std::fs::write(app.path.join("tracked"), "dirty\n").unwrap();
    std::fs::write(app.path.join("untracked"), "untracked\n").unwrap();
    let (status, result) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&body),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["oldTargetOid"], hashes[1]);
    assert_eq!(result["oldHeadOid"], hashes[3]);
    assert_ne!(result["newTargetOid"], result["newHeadOid"]);
    assert_eq!(result["hash"], result["newTargetOid"]);
    assert_eq!(result["rewrittenCount"], 3);
    assert_eq!(result["noOp"], false);
    assert_eq!(result["signaturesRemoved"], false);
    let target = result["newTargetOid"].as_str().unwrap();
    assert_eq!(
        text(&["rev-list", "--parents", "-n", "1", target], &app.path),
        target
    );
    let raw = git(&["cat-file", "commit", target], &app.path);
    let separator = raw.windows(2).position(|w| w == b"\n\n").unwrap();
    assert_eq!(
        &raw[separator + 2..],
        body["message"].as_str().unwrap().as_bytes()
    );
    assert_eq!(
        text(&["rev-parse", "HEAD"], &app.path),
        result["newHeadOid"]
    );
    assert_eq!(text(&["rev-parse", "HEAD^{tree}"], &app.path), tree);
    assert_eq!(std::fs::read(app.path.join(".git/index")).unwrap(), index);
    assert_eq!(std::fs::read(app.path.join("tracked")).unwrap(), b"dirty\n");
    assert_eq!(
        std::fs::read(app.path.join("untracked")).unwrap(),
        b"untracked\n"
    );
    let (status, stale) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&body),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stale["ok"], false);
    assert_eq!(stale["blockedReason"], "stale-ref");
    assert_eq!(
        text(&["rev-parse", "HEAD"], &app.path),
        result["newHeadOid"]
    );
}

#[tokio::test]
async fn test_api_nested_root_in_registered_worktree_is_isolated() {
    let app = setup(true);
    let child = app.worktree.join("modules/child");
    let sibling = app.worktree.join("modules/sibling");
    let parent_tip = text(&["rev-parse", "HEAD"], &app.path);
    let other_tip = text(&["rev-parse", "HEAD"], &app.other);
    let worktree_tip = text(&["rev-parse", "HEAD"], &app.worktree);
    let sibling_tip = text(&["rev-parse", "HEAD"], &sibling);
    let hashes = chain(&child);
    let query = format!(
        "?worktreePath={}&root=modules/child",
        app.worktree.display()
    );
    let snapshot = snapshots(&app, &hashes[1..3], &query).await;
    let mut body = body(&hashes[1..3], &snapshot);
    body["worktreePath"] = json!(app.worktree);
    body["root"] = json!("modules/child");
    let (status, result) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&body),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["rewrittenCount"], 2);
    assert_eq!(text(&["rev-parse", "HEAD"], &child), result["newHeadOid"]);
    assert_eq!(text(&["rev-parse", "HEAD"], &app.path), parent_tip);
    assert_eq!(text(&["rev-parse", "HEAD"], &app.other), other_tip);
    assert_eq!(text(&["rev-parse", "HEAD"], &app.worktree), worktree_tip);
    assert_eq!(text(&["rev-parse", "HEAD"], &sibling), sibling_tip);
}

#[tokio::test]
async fn test_api_rejects_foreign_unknown_deleted_and_unregistered_targets_and_unsafe_roots() {
    let app = setup(true);
    let hashes = chain(&app.path);
    let snapshot = snapshots(&app, &hashes[..2], "").await;
    let base = body(&hashes[..2], &snapshot);
    let outside = tempfile::tempdir().unwrap();
    init(outside.path());
    let root_before = text(&["rev-parse", "HEAD"], &app.path);
    let outside_before = text(&["rev-parse", "HEAD"], outside.path());
    for target in [
        app.other.clone(),
        outside.path().to_path_buf(),
        app.path.join("missing"),
        app.worktree.join("modules/child"),
    ] {
        let mut payload = base.clone();
        payload["worktreePath"] = json!(target);
        let (status, _) = request(
            &app.router,
            "POST",
            "/api/git/test-repo/squash",
            Some(&payload),
            None,
        )
        .await;
        assert!(status.is_client_error(), "{target:?}: {status}");
    }
    for root in [
        "*",
        "unknown",
        "../other-repo",
        "/tmp",
        "modules/../../other-repo",
    ] {
        let mut payload = base.clone();
        payload["root"] = json!(root);
        let (status, _) = request(
            &app.router,
            "POST",
            "/api/git/test-repo/squash",
            Some(&payload),
            None,
        )
        .await;
        assert!(status.is_client_error(), "{root}: {status}");
    }
    let (status, _) = request(
        &app.router,
        "POST",
        "/api/git/unknown/squash",
        Some(&base),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    #[cfg(unix)]
    {
        let escape = app.path.join("escape");
        std::os::unix::fs::symlink(outside.path(), &escape).unwrap();
        let mut payload = base.clone();
        payload["root"] = json!("escape");
        let (status, _) = request(
            &app.router,
            "POST",
            "/api/git/test-repo/squash",
            Some(&payload),
            None,
        )
        .await;
        assert!(status.is_client_error());
    }
    // Warm the registered-target resolver, then delete that target and try again.
    let query = format!("?worktreePath={}", app.worktree.display());
    let linked_snap = snapshots(&app, &hashes[..2], &query).await;
    std::fs::remove_dir_all(&app.worktree).unwrap();
    let mut payload = body(&hashes[..2], &linked_snap);
    payload["worktreePath"] = json!(app.worktree);
    let (status, _) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&payload),
        None,
    )
    .await;
    assert!(status.is_client_error());
    assert_eq!(text(&["rev-parse", "HEAD"], &app.path), root_before);
    assert_eq!(text(&["rev-parse", "HEAD"], outside.path()), outside_before);
}

#[cfg(unix)]
#[tokio::test]
async fn test_api_registered_worktree_replaced_by_escaping_symlink_is_rejected() {
    let app = setup(true);
    let hashes = chain(&app.path);
    let query = format!("?worktreePath={}", app.worktree.display());
    let snapshot = snapshots(&app, &hashes[..2], &query).await;
    let outside = tempfile::tempdir().unwrap();
    init(outside.path());
    let outside_tip = text(&["rev-parse", "HEAD"], outside.path());
    let main_tip = text(&["rev-parse", "HEAD"], &app.path);
    let original = app.worktree.with_file_name("original-linked");
    std::fs::rename(&app.worktree, &original).unwrap();
    std::os::unix::fs::symlink(outside.path(), &app.worktree).unwrap();
    let mut payload = body(&hashes[..2], &snapshot);
    payload["worktreePath"] = json!(app.worktree);
    let (status, _) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&payload),
        None,
    )
    .await;
    assert!(status.is_client_error());
    assert_eq!(text(&["rev-parse", "HEAD"], outside.path()), outside_tip);
    assert_eq!(text(&["rev-parse", "HEAD"], &app.path), main_tip);
}

#[tokio::test]
async fn test_api_authentication_precedes_valid_mutation() {
    let app = setup(false);
    let hashes = chain(&app.path);
    let payload = json!({"hashes": &hashes[..2], "message": "new", "expectedBranch": "refs/heads/main", "expectedHeadOid": hashes[3]});
    for bearer in [None, Some("invalid-token")] {
        let (status, _) = request(
            &app.router,
            "POST",
            "/api/git/test-repo/squash",
            Some(&payload),
            bearer,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(text(&["rev-parse", "HEAD"], &app.path), hashes[3]);
    }
}

#[tokio::test]
async fn test_api_malformed_requests_and_missing_committer_have_clear_errors() {
    let app = setup(true);
    let hashes = chain(&app.path);
    let snapshot = snapshots(&app, &hashes[..2], "").await;
    let base = body(&hashes[..2], &snapshot);
    for patch in [
        json!({"hashes": []}),
        json!({"hashes": [hashes[0]]}),
        json!({"hashes": [hashes[0], hashes[0].to_uppercase()]}),
        json!({"hashes": ["HEAD", hashes[1]]}),
        json!({"message": " \n\t"}),
        json!({"expectedBranch": "main"}),
        json!({"expectedHeadOid": "HEAD"}),
    ] {
        let mut payload = base.clone();
        for (key, value) in patch.as_object().unwrap() {
            payload[key] = value.clone();
        }
        let (status, _) = request(
            &app.router,
            "POST",
            "/api/git/test-repo/squash",
            Some(&payload),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(text(&["rev-parse", "HEAD"], &app.path), hashes[3]);
    }
    git(&["config", "user.name", ""], &app.path);
    git(&["config", "user.email", ""], &app.path);
    let (status, error) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&base),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(
        error.to_string().contains("git user not configured"),
        "{error}"
    );
    assert_eq!(text(&["rev-parse", "HEAD"], &app.path), hashes[3]);
}

#[tokio::test]
async fn test_api_signature_consent_defaults_false_and_absorbed_signature_requires_it() {
    let app = setup(true);
    let hashes = chain(&app.path);
    let repo = git2::Repository::open(&app.path).unwrap();
    let tree = repo.head().unwrap().peel_to_commit().unwrap().tree_id();
    let raw = format!("tree {tree}\nparent {}\nauthor Signed <signed@example.com> 1700000000 +0000\ncommitter Signed <signed@example.com> 1700000000 +0000\ngpgsig-sha256 opaque\n continuation\n\nfull body signed\n", hashes[3]);
    let signed = repo
        .odb()
        .unwrap()
        .write(git2::ObjectType::Commit, raw.as_bytes())
        .unwrap()
        .to_string();
    git(&["update-ref", "refs/heads/main", &signed], &app.path);
    let selected = vec![hashes[3].clone(), signed.clone()];
    let snapshot = snapshots(&app, &selected, "").await;
    let mut payload = body(&selected, &snapshot);
    let (status, refused) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&payload),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(refused["ok"], false);
    assert_eq!(refused["blockedReason"], "signature-consent-required");
    assert_eq!(text(&["rev-parse", "HEAD"], &app.path), signed);
    payload["allowSignatureRemoval"] = json!(true);
    let (_, allowed) = request(
        &app.router,
        "POST",
        "/api/git/test-repo/squash",
        Some(&payload),
        None,
    )
    .await;
    assert_eq!(allowed["ok"], true, "{allowed}");
    assert_eq!(allowed["signaturesRemoved"], true);
    assert!(!String::from_utf8_lossy(&git(
        &["cat-file", "commit", allowed["hash"].as_str().unwrap()],
        &app.path
    ))
    .contains("gpgsig"));
}
