use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::router::build_router,
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
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
use serde_json::Value;
use tower::ServiceExt;

mod common;

static ENV_LOCK: Mutex<()> = Mutex::new(());
const TOKEN_CAPACITY: usize = 512;

struct TestContext {
    _app_state: AppState,
    _temp_dir: tempfile::TempDir,
    project_dir: PathBuf,
}

fn setup_test_app() -> (TestContext, axum::Router) {
    let temp_dir = tempfile::tempdir().unwrap();
    let root_path = temp_dir.path().to_path_buf();
    let project_dir = root_path.join("test-proj");
    std::fs::create_dir_all(&project_dir).unwrap();

    let (event_sink, _rx) = BroadcastEventSink::new(TOKEN_CAPACITY);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: root_path.display().to_string(),
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
        config_path: root_path.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = root_path.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-jwt-key".to_string();
    let fs = FsSubsystem::new(vec![("test-proj".into(), project_dir.clone())]);

    let _guard = ENV_LOCK.lock();
    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

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
        true, // no_auth for testing
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("Failed to create AppState in test");

    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }

    let router = build_router(app_state.clone());
    (
        TestContext {
            _app_state: app_state,
            _temp_dir: temp_dir,
            project_dir,
        },
        router,
    )
}

async fn json_response(response: axum::response::Response) -> Value {
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body_bytes).unwrap_or_else(|_| {
        panic!(
            "Failed to parse JSON response: {}",
            String::from_utf8_lossy(&body_bytes)
        )
    })
}

#[tokio::test]
async fn test_plan_folders_missing_plans_root() {
    let (_ctx, app) = setup_test_app();
    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    assert_eq!(json["folderState"], "missing");
    assert_eq!(json["kind"], "collection");
    assert_eq!(json["folders"].as_array().unwrap().len(), 0);
    assert_eq!(json["listing"]["complete"], true);
    assert_eq!(json["watchPaths"], serde_json::json!(["."]));
}

#[tokio::test]
async fn test_plan_folders_browsing_and_exclusions() {
    let (ctx, app) = setup_test_app();
    let plans_dir = ctx.project_dir.join("plans");
    std::fs::create_dir_all(&plans_dir).unwrap();

    // 1. Regular plan folder
    let feat_a = plans_dir.join("feature-a");
    std::fs::create_dir_all(&feat_a).unwrap();
    std::fs::write(feat_a.join("plan.md"), "# Feature A").unwrap();

    // 2. Regular group (no plan.md)
    let frontend = plans_dir.join("frontend");
    std::fs::create_dir_all(&frontend).unwrap();

    // 3. Hidden directory
    std::fs::create_dir_all(plans_dir.join(".hidden-dir")).unwrap();

    // 4. Utility basenames
    std::fs::create_dir_all(plans_dir.join("reports")).unwrap();
    std::fs::create_dir_all(plans_dir.join("research")).unwrap();
    std::fs::create_dir_all(plans_dir.join("templates")).unwrap();
    std::fs::create_dir_all(plans_dir.join("scout")).unwrap();
    std::fs::create_dir_all(plans_dir.join("node_modules")).unwrap();

    // 5. Symlink directory
    let outside_dir = ctx.project_dir.join("outside");
    std::fs::create_dir_all(&outside_dir).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside_dir, plans_dir.join("symlink-dir")).unwrap();

    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    assert_eq!(json["folderState"], "present");
    assert_eq!(json["kind"], "collection");

    let folders = json["folders"].as_array().unwrap();
    let names: Vec<&str> = folders
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["feature-a", "frontend"]);
    assert_eq!(json["watchPaths"], serde_json::json!([".", "plans"]));
}

#[tokio::test]
async fn test_plan_folders_plan_kind_no_children() {
    let (ctx, app) = setup_test_app();
    let plans_dir = ctx.project_dir.join("plans");
    let feat_a = plans_dir.join("feature-a");
    std::fs::create_dir_all(&feat_a).unwrap();
    std::fs::write(feat_a.join("plan.md"), "# Feature A").unwrap();
    // child directory inside plan folder
    std::fs::create_dir_all(feat_a.join("child")).unwrap();

    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans/feature-a")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    assert_eq!(json["kind"], "plan");
    assert_eq!(json["folders"].as_array().unwrap().len(), 0);
    assert_eq!(
        json["watchPaths"],
        serde_json::json!([".", "plans", "plans/feature-a"])
    );
}

#[tokio::test]
async fn test_plan_folders_group_browsing() {
    let (ctx, app) = setup_test_app();
    let plans_dir = ctx.project_dir.join("plans");
    let frontend = plans_dir.join("frontend");
    let login = frontend.join("login");
    std::fs::create_dir_all(&login).unwrap();
    std::fs::write(login.join("plan.md"), "# Login Plan").unwrap();

    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans/frontend")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    assert_eq!(json["kind"], "group");
    let folders = json["folders"].as_array().unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0]["name"], "login");
    assert_eq!(folders[0]["path"], "plans/frontend/login");
}

#[tokio::test]
async fn test_plan_folders_not_found() {
    let (ctx, app) = setup_test_app();
    let plans_dir = ctx.project_dir.join("plans");
    std::fs::create_dir_all(&plans_dir).unwrap();

    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans/nonexistent")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_NOT_FOUND");
}

#[tokio::test]
async fn test_plan_folders_query_validation() {
    let (_ctx, app) = setup_test_app();

    // 1. Missing project
    let req = Request::builder()
        .uri("/api/plans/folders?path=plans")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_INVALID_QUERY");

    // 2. Duplicate parameter
    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&project=test-proj")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_INVALID_QUERY");

    // 3. Unknown parameter
    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&unknown=field")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_INVALID_QUERY");

    // 4. Path traversal
    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans/../src")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_PATH_REJECTED");

    // 5. Absolute path
    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=/etc")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_PATH_REJECTED");
}

#[tokio::test]
async fn test_plan_folders_bulk_siblings_and_unreadable() {
    let (ctx, app) = setup_test_app();
    let bulk_dir = ctx.project_dir.join("plans").join("bulk");
    std::fs::create_dir_all(&bulk_dir).unwrap();

    // Create 205 sibling folders
    for i in 1..=205 {
        let child = bulk_dir.join(format!("plan-{:03}", i));
        std::fs::create_dir_all(&child).unwrap();
        std::fs::write(child.join("plan.md"), format!("# Plan {:03}", i)).unwrap();
    }

    // Add FIFO on Unix
    #[cfg(unix)]
    {
        let fifo_path = bulk_dir.join("unreadable-fifo");
        let path_c = std::ffi::CString::new(fifo_path.to_str().unwrap()).unwrap();
        unsafe {
            libc::mkfifo(path_c.as_ptr(), 0o600);
        }
    }

    let req = Request::builder()
        .uri("/api/plans/folders?project=test-proj&path=plans/bulk")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    let folders = json["folders"].as_array().unwrap();
    assert_eq!(folders.len(), 205);
}

#[tokio::test]
async fn test_selected_plan_read_happy_path() {
    let (ctx, app) = setup_test_app();
    let feat_dir = ctx.project_dir.join("plans").join("feature-a");
    std::fs::create_dir_all(&feat_dir).unwrap();

    let plan_md_content = r#"---
title: "Feature A"
description: "Core feature plan"
status: pending
created: 2026-10-06
---

# Feature A

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | Setup | Completed |
| 02 | Impl | Pending |
"#;
    std::fs::write(feat_dir.join("plan.md"), plan_md_content).unwrap();

    let progress_md_content = r#"# Progress

Current status: In Progress

## Phase Reconciliation

| Phase | Current status |
|---|---|
| 01 | Completed |
| 02 | Pending |
"#;
    std::fs::write(feat_dir.join("progress.md"), progress_md_content).unwrap();

    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans/feature-a")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    let plan = &json["plan"];
    assert_eq!(plan["id"], "plans/feature-a");
    assert_eq!(plan["title"], "Feature A");
    assert_eq!(plan["documents"]["plan"]["state"], "readable");
    assert_eq!(plan["documents"]["progress"]["state"], "readable");
    assert_eq!(plan["reportedStatus"]["authority"], "progress");
    assert_eq!(plan["reportedStatus"]["value"], "in-progress");
    assert_eq!(
        json["watchPaths"],
        serde_json::json!([".", "plans", "plans/feature-a"])
    );
}

#[tokio::test]
async fn test_selected_plan_read_absent_progress() {
    let (ctx, app) = setup_test_app();
    let feat_dir = ctx.project_dir.join("plans").join("feature-b");
    std::fs::create_dir_all(&feat_dir).unwrap();

    let plan_md_content = r#"---
title: "Feature B"
status: in-progress
---
# Feature B
"#;
    std::fs::write(feat_dir.join("plan.md"), plan_md_content).unwrap();

    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans/feature-b")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    let plan = &json["plan"];
    assert_eq!(plan["documents"]["progress"]["state"], "absent");
    assert_eq!(plan["reportedStatus"]["authority"], "plan");
}

#[tokio::test]
#[cfg(unix)]
async fn test_selected_plan_read_symlink_progress() {
    let (ctx, app) = setup_test_app();
    let feat_dir = ctx.project_dir.join("plans").join("feature-c");
    std::fs::create_dir_all(&feat_dir).unwrap();

    let plan_md_content = r#"---
title: "Feature C"
status: completed
---
# Feature C

## Phases

| # | Phase | Status | Detail |
|---|---|---|---|
| 01 | Captured complete | Completed | [Phase](./phase-01.md) |
"#;
    std::fs::write(feat_dir.join("plan.md"), plan_md_content).unwrap();

    let outside_file = ctx.project_dir.join("outside-progress.md");
    std::fs::write(&outside_file, "# Fake Outside").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside_file, feat_dir.join("progress.md")).unwrap();

    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans/feature-c")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_response(res).await;
    let plan = &json["plan"];
    assert_eq!(plan["documents"]["progress"]["state"], "unreadable");
    assert_eq!(plan["reportedStatus"]["authority"], "progress");
    assert_eq!(plan["reportedStatus"]["value"], "unknown");
    assert_eq!(plan["phases"].as_array().unwrap().len(), 1);
    assert_eq!(plan["phases"][0]["id"], "phase-01.md");
    assert_eq!(plan["phases"][0]["reportedStatus"]["value"], "unknown");
    assert_eq!(plan["phases"][0]["reportedStatus"]["authority"], "progress");
    let captured = &plan["phases"][0]["reportedStatus"]["captured"][0];
    assert_eq!(captured["value"], "completed");
    assert_eq!(captured["evidence"]["path"], "plans/feature-c/plan.md");
    assert_eq!(plan["completion"]["declared"], 1);
    assert_eq!(plan["completion"]["completed"], 0);
    assert_eq!(plan["completion"]["unknown"], 1);
    assert!(plan["completion"]["fraction"].is_null());

    let diags = plan["diagnostics"].as_array().unwrap();
    assert!(diags.iter().any(|d| d["code"] == "PROGRESS_UNREADABLE"));
}

#[tokio::test]
async fn test_selected_plan_missing_plan_md_returns_404() {
    let (ctx, app) = setup_test_app();
    let group_dir = ctx.project_dir.join("plans").join("group-only");
    std::fs::create_dir_all(&group_dir).unwrap();

    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans/group-only")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_NOT_FOUND");
}

#[tokio::test]
async fn test_selected_plan_query_validation() {
    let (_ctx, app) = setup_test_app();

    // 1. Missing planPath
    let req = Request::builder()
        .uri("/api/plans?project=test-proj")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_INVALID_QUERY");

    // 2. planPath = "plans" root
    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let json = json_response(res).await;
    assert_eq!(json["code"], "PLANS_INVALID_QUERY");
}

#[tokio::test]
async fn test_strict_rest_fs_read_plan_document() {
    let (ctx, app) = setup_test_app();
    let plans_dir = ctx.project_dir.join("plans").join("feature-a");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let plan_file = plans_dir.join("plan.md");
    std::fs::write(&plan_file, "# Document Details Markdown").unwrap();

    let notes_file = ctx.project_dir.join("notes.txt");
    std::fs::write(&notes_file, "plain text").unwrap();

    // 1. Success strict read
    let req = Request::builder()
        .uri("/api/fs/read?project=test-proj&path=plans/feature-a/plan.md&mode=plan-document")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers().get("content-type").unwrap(), "text/markdown");
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(bytes, "# Document Details Markdown".as_bytes());

    // 2. Range not allowed
    let req = Request::builder()
        .uri("/api/fs/read?project=test-proj&path=plans/feature-a/plan.md&mode=plan-document&offset=0&len=5")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Non-.md extension rejected
    let req = Request::builder()
        .uri("/api/fs/read?project=test-proj&path=notes.txt&mode=plan-document")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Unsupported mode
    let req = Request::builder()
        .uri("/api/fs/read?project=test-proj&path=plans/feature-a/plan.md&mode=unsupported")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 5. Default mode succeeds for plain text file
    let req = Request::builder()
        .uri("/api/fs/read?project=test-proj&path=notes.txt")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_selected_plan_projection_review_boundaries() {
    let (ctx, app) = setup_test_app();
    let folder = ctx.project_dir.join("plans").join("projection");
    std::fs::create_dir_all(&folder).unwrap();
    let two_phases = "# Projection\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Pending | [One](./one.md) |\n\
        | 2 | Two | Pending | [Two](./two.md) |\n";
    let one_phase = "# Projection\n\n## Phases\n\n\
        | # | Phase | Status |\n|---|---|---|\n| 1 | One | Pending |\n";
    for (plan_md, progress_md, status, phase_statuses, completed, fraction, diagnostic) in [
        (
            two_phases,
            "# Progress\n\n## Phase Reconciliation\n\n\
             | Phase | Current status |\n|---|---|\n| [02](./one.md) | Completed |\n",
            "unknown",
            vec!["conflict", "conflict"],
            0,
            None,
            Some("STATUS_CONFLICT"),
        ),
        (
            two_phases,
            "# Progress\n\n## Phase Reconciliation\n\n\
             | Phase | Current status |\n|---|---|\n\
             | 1 | Completed |\n| [01](./one.md) | Completed |\n| 2 | Pending |\n",
            "unknown",
            vec!["conflict", "pending"],
            0,
            Some(0.0),
            Some("STATUS_CONFLICT"),
        ),
        (
            "# Projection\n\n## Phases\n\n\
             | # | Phase | Status | Detail |\n|---|---|---|---|\n\
             | 1 | One | Completed | [One](./one.md) |\n| 2 | Two | Pending |\n",
            "",
            "unknown",
            vec!["unknown", "unknown"],
            0,
            None,
            Some("PHASE_UNREPORTED"),
        ),
        (
            one_phase,
            "# Progress\n\n**Current status:** All phases (Phase 01) completed \
             with durable task sealing. Plan execution complete.\n\n\
             ## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n| 1 | Completed |\n",
            "completed",
            vec!["completed"],
            1,
            Some(1.0),
            None,
        ),
        (
            one_phase,
            "# Progress\n\n## Phase Reconciliation\n\n\
             | Phase | Status | Current status |\n|---|---|---|\n| 1 | Pending | Completed |\n",
            "completed",
            vec!["completed"],
            1,
            Some(1.0),
            None,
        ),
        (
            two_phases,
            "# Progress\n\n## Phase Reconciliation\n\n\
             | Phase | Current status | Captured status | Detail |\n|---|---|---|---|\n\
             | 1 | Completed | Pending | Sealed |\n2 | Pending\n",
            "in-progress",
            vec!["completed", "pending"],
            1,
            Some(0.5),
            None,
        ),
        (
            two_phases,
            "# Progress\n\n**Current status:** All phases (01–02) incomplete.\n\n\
             ## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n\
             | 1 | Completed |\n2 | Completed\n",
            "unknown",
            vec!["completed", "completed"],
            2,
            Some(1.0),
            Some("UNSUPPORTED_STATUS"),
        ),
        (
            two_phases,
            "# Progress\n\n**Current status:** All phases (Phase 01–bogus) completed.\n\n\
             ## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n\
             | 1 | Completed |\n2 | Completed\n",
            "unknown",
            vec!["completed", "completed"],
            2,
            Some(1.0),
            Some("UNSUPPORTED_STATUS"),
        ),
    ] {
        std::fs::write(folder.join("plan.md"), plan_md).unwrap();
        std::fs::write(folder.join("progress.md"), progress_md).unwrap();
        let req = Request::builder()
            .uri("/api/plans?project=test-proj&planPath=plans/projection")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let json = json_response(res).await;
        let plan = &json["plan"];
        assert_eq!(plan["reportedStatus"]["value"], status, "{progress_md}");
        assert_eq!(plan["reportedStatus"]["authority"], "progress");
        let phases = plan["phases"].as_array().unwrap();
        assert_eq!(phases.len(), phase_statuses.len());
        for (phase, expected) in phases.iter().zip(&phase_statuses) {
            assert_eq!(phase["reportedStatus"]["value"], *expected, "{progress_md}");
            assert_eq!(phase["reportedStatus"]["authority"], "progress");
        }
        assert_eq!(plan["completion"]["declared"], phase_statuses.len());
        assert_eq!(plan["completion"]["completed"], completed);
        assert_eq!(plan["completion"]["fraction"], serde_json::json!(fraction));
        if let Some(code) = diagnostic {
            assert!(plan["diagnostics"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d["code"] == code));
        } else {
            assert!(plan["diagnostics"].as_array().unwrap().is_empty());
        }
    }

    // The exact short-inventory reproduction also works without a progress opt-in.
    std::fs::remove_file(folder.join("progress.md")).unwrap();
    std::fs::write(
        folder.join("plan.md"),
        "# Projection\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Completed | [One](./one.md) |\n2 | Two | Pending\n",
    )
    .unwrap();
    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans/projection")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    assert_eq!(json["plan"]["completion"]["declared"], 2);
    assert_eq!(json["plan"]["completion"]["completed"], 1);
    assert_eq!(json["plan"]["completion"]["fraction"], 0.5);
    assert_eq!(json["plan"]["reportedStatus"]["value"], "in-progress");
    assert!(json["plan"]["diagnostics"].as_array().unwrap().is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn test_plan_folders_response_byte_limit_retains_maximal_whole_sorted_prefix() {
    let (ctx, app) = setup_test_app();
    let mut path = "plans".to_string();
    for index in 0..12 {
        path.push('/');
        path.push_str(&format!("{index:02}{}", "a".repeat(158)));
    }
    let folder = ctx.project_dir.join(&path);
    std::fs::create_dir_all(&folder).unwrap();
    let names: Vec<String> = (0..1500)
        .map(|index| format!("{index:04}-{}-\"\\\n-é", "b".repeat(48)))
        .collect();
    for name in &names {
        std::fs::create_dir(folder.join(name)).unwrap();
    }
    let req = Request::builder()
        .uri(format!("/api/plans/folders?project=test-proj&path={path}"))
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let max_bytes = 2 * 1024 * 1024;
    assert!(bytes.len() <= max_bytes);
    let mut json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["listing"]["complete"], false);
    assert_eq!(json["listing"]["entriesVisited"], 1500);
    assert_eq!(
        json["listing"]["limitsReached"],
        serde_json::json!(["response-bytes"])
    );
    let retained = json["folders"].as_array().unwrap().len();
    assert!(retained > 0 && retained < names.len());
    for (entry, name) in json["folders"].as_array().unwrap().iter().zip(&names) {
        assert_eq!(entry["name"], *name);
        assert_eq!(entry["path"], format!("{path}/{name}"));
    }
    // The envelope/flag/comma/escaped-entry accounting must use the whole budget:
    // adding the very next entry would exceed it, with no partial entry emitted.
    let next = &names[retained];
    json["folders"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "name": next,
            "path": format!("{path}/{next}"),
        }));
    assert!(serde_json::to_vec(&json).unwrap().len() > max_bytes);
}

#[tokio::test]
async fn test_selected_plan_bare_table_cell_and_high_phase_numbers() {
    let (ctx, app) = setup_test_app();
    let folder = ctx.project_dir.join("plans").join("sparse");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("plan.md"),
        "# Bare\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Completed | [One](./one.md) |\n2\n",
    )
    .unwrap();
    let req = Request::builder()
        .uri("/api/plans?project=test-proj&planPath=plans/sparse")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_response(res).await;
    assert_eq!(json["plan"]["completion"]["declared"], 2);
    assert_eq!(json["plan"]["completion"]["completed"], 1);
    assert_eq!(json["plan"]["completion"]["unknown"], 1);
    assert_eq!(json["plan"]["completion"]["fraction"], 0.5);
    assert_eq!(
        json["plan"]["phases"][1]["reportedStatus"]["value"],
        "unknown"
    );

    for (numbers, restriction) in [(vec![129], "Phase 129"), (vec![129, 130], "129–130")] {
        let mut plan = "# Sparse\n\n## Phases\n\n\
            | # | Phase | Status |\n|---|---|---|\n"
            .to_string();
        let mut progress = format!(
            "# Progress\n\nCurrent status: All phases ({restriction}) completed.\n\n\
             ## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n"
        );
        for number in &numbers {
            plan.push_str(&format!("| {number} | Phase {number} | Pending |\n"));
            progress.push_str(&format!("| {number} | Completed |\n"));
        }
        std::fs::write(folder.join("plan.md"), plan).unwrap();
        std::fs::write(folder.join("progress.md"), progress).unwrap();
        let req = Request::builder()
            .uri("/api/plans?project=test-proj&planPath=plans/sparse")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let json = json_response(res).await;
        assert_eq!(json["plan"]["reportedStatus"]["value"], "completed");
        assert_eq!(json["plan"]["completion"]["declared"], numbers.len());
        assert_eq!(json["plan"]["completion"]["fraction"], 1.0);
        assert!(json["plan"]["diagnostics"].as_array().unwrap().is_empty());
    }
}
