#![cfg(target_os = "linux")]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;

use axum::http::{header, StatusCode};
use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::build_router;
use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::auth::MOCK_EXPIRY_SECS;
use dam_hopper_server::config::schema::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::git::diff::{discard_file, discard_hunk};
use dam_hopper_server::pty::{BroadcastEventSink, NoopEventSink, PtySessionManager};
use dam_hopper_server::semantic::protocol::ConnectionId;
use dam_hopper_server::state::AppState;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use reqwest::Client;
use serde_json::json;
use tempfile::TempDir;
use tokio::sync::Mutex;

mod common;

static TEST_MUTEX: Mutex<()> = Mutex::const_new(());
const TEST_SECRET: &str = "test-secret-at-least-32-bytes-long!!";

fn git_cmd(cwd: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .expect("git execution failed");
    assert!(
        output.status.success(),
        "git {:?} failed in {}: {}",
        args,
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn make_jwt(sub: &str, sid: &str) -> String {
    let now = chrono::Utc::now();
    let claims = AuthClaims {
        v: dam_hopper_server::auth::AUTH_PROTOCOL_VERSION,
        sub: sub.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    };
    claims.encode(TEST_SECRET).unwrap()
}

async fn make_auth_service(
    tmp: &TempDir,
    username: &str,
    role: UserRole,
) -> (dam_hopper_server::auth::AuthService, String, PathBuf) {
    let now = chrono::Utc::now();
    let exp = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
    let sid = format!("session-{username}");

    let user = UserRecord {
        id: None,
        username: username.to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };

    let session = AuthSession {
        id: sid.clone(),
        username: username.to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
        user_agent: None,
    };

    let db_path = tmp.path().join(format!("auth-{username}.db"));
    let store = dam_hopper_server::auth::AuthStore::open_sqlite(&db_path)
        .await
        .unwrap();
    store.create_user(user).await.unwrap();
    store.create_session(session).await.unwrap();
    let service = dam_hopper_server::auth::AuthService::with_system_clock(Some(store), None);
    let token = make_jwt(username, &sid);
    (service, token, db_path)
}

#[tokio::test]
async fn test_worktree_remove_refuses_protected_config_and_preserves_admission() {
    let _guard = TEST_MUTEX.lock().await;

    let tmp = TempDir::new().unwrap();
    let repo_dir = tmp.path().join("main_repo");
    std::fs::create_dir_all(&repo_dir).unwrap();
    git_cmd(&repo_dir, &["init", "-b", "main"]);
    git_cmd(&repo_dir, &["config", "user.email", "test@test.local"]);
    git_cmd(&repo_dir, &["config", "user.name", "Test"]);
    std::fs::write(repo_dir.join("main.ts"), "export const a = 1;\n").unwrap();
    git_cmd(&repo_dir, &["add", "main.ts"]);
    git_cmd(&repo_dir, &["commit", "-m", "init"]);

    let protected_wt = tmp.path().join("protected_wt");
    git_cmd(
        &repo_dir,
        &["worktree", "add", "-b", "protected", protected_wt.to_str().unwrap()],
    );

    let unrelated_wt = tmp.path().join("unrelated_wt");
    git_cmd(
        &repo_dir,
        &["worktree", "add", "-b", "unrelated", unrelated_wt.to_str().unwrap()],
    );

    // Place XDG_CONFIG_HOME inside protected_wt
    let config_home = protected_wt.join("my_config_home");
    let dam_hopper_dir = config_home.join("dam-hopper");
    std::fs::create_dir_all(&dam_hopper_dir).unwrap();
    let config_file = dam_hopper_dir.join("config.toml");
    std::fs::write(&config_file, "# CANONICAL GLOBAL CONFIG\n[general]\nfoo = 'bar'\n").unwrap();

    std::env::set_var("XDG_CONFIG_HOME", &config_home);

    let global_cfg = dam_hopper_server::config::global_config_path();
    assert_eq!(global_cfg, config_file);
    assert!(config_file.exists());
    assert!(dam_hopper_server::fs::secure_path::is_protected_global_config_path(&protected_wt));
    assert!(!dam_hopper_server::fs::secure_path::is_protected_global_config_path(&unrelated_wt));

    let toolchain = common::semantic_fixtures::TestToolchain::new();
    let profile = toolchain.tool_profile();
    let workspace_dir = tmp.path().to_path_buf();
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: ".".into(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: "test-project".into(),
            path: repo_dir.to_str().unwrap().into(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: Default::default(),
            restart_max_retries: 3,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: workspace_dir.join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(NoopEventSink));
    let agent_store = AgentStoreService::new(workspace_dir.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diagnostics.jsonl"));

    let (auth_service, token, _db_path) = make_auth_service(&tmp, "regular-user", UserRole::User).await;

    let state = AppState::new(
        workspace_dir,
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        TEST_SECRET.to_string(),
        fs,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("AppState creation failed")
    .with_auth_service(Arc::new(auth_service))
    .with_semantic_supervisor(Arc::new(
        dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)),
    ));

    let supervisor = &state.semantic_supervisor;
    supervisor.set_enabled(true).await;

    // Establish semantic session in protected_wt
    let conn_id = ConnectionId("conn-1".into());
    let epoch = supervisor.register_connection(&conn_id).await;
    let sess = supervisor
        .get_or_create_session(
            conn_id,
            "test-project",
            Some(protected_wt.to_str().unwrap().into()),
            protected_wt.clone(),
            epoch,
        )
        .await
        .unwrap();
    sess.initialize().await.unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state.clone());
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let client = Client::new();
    let delete_url = format!("http://{addr}/api/git/test-project/worktrees");

    // 1. Attempt to remove protected worktree -> MUST BE REFUSED (403 Forbidden)
    let resp = client
        .delete(&delete_url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "path": protected_wt.to_str().unwrap(), "force": true }).to_string())
        .send()
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::FORBIDDEN,
        "Protected worktree removal must be refused with HTTP 403 Forbidden"
    );

    // Verify config file and worktree STILL EXIST on disk
    assert!(config_file.exists(), "Canonical config file must remain on disk");
    assert!(protected_wt.exists(), "Worktree directory must remain on disk");

    // Verify semantic session admission is PRESERVED (did_open succeeds, not Invalidated)
    let file_uri = url::Url::from_file_path(protected_wt.join("main.ts")).unwrap().to_string();
    let open_res = sess.did_open(file_uri, "typescript".into(), 1, "export const a = 2;".into()).await;
    assert!(
        open_res.is_ok(),
        "Semantic session must remain valid; prepare_invalidate_target must NOT run before refusal"
    );

    // 2. Positive control: removing unrelated worktree SUCCEEDS
    let unrelated_resp = client
        .delete(&delete_url)
        .bearer_auth(&token)
        .header(header::CONTENT_TYPE, "application/json")
        .body(json!({ "path": unrelated_wt.to_str().unwrap(), "force": true }).to_string())
        .send()
        .await
        .unwrap();

    assert_eq!(
        unrelated_resp.status(),
        StatusCode::OK,
        "Unrelated worktree removal must succeed"
    );
    assert!(!unrelated_wt.exists(), "Unrelated worktree should be removed");
}

#[tokio::test]
async fn test_discard_file_and_hunk_refuse_protected_config() {
    let _guard = TEST_MUTEX.lock().await;

    let tmp = TempDir::new().unwrap();
    let repo_dir = tmp.path().join("repo");
    std::fs::create_dir_all(&repo_dir).unwrap();
    git_cmd(&repo_dir, &["init", "-b", "main"]);
    git_cmd(&repo_dir, &["config", "user.email", "test@test.local"]);
    git_cmd(&repo_dir, &["config", "user.name", "Test"]);

    // Track config.toml in git
    let config_dir = repo_dir.join("dam-hopper");
    std::fs::create_dir_all(&config_dir).unwrap();
    let config_file = config_dir.join("config.toml");
    std::fs::write(&config_file, "HEAD_CONFIG = true\n").unwrap();

    // Track an unrelated file
    let other_file = repo_dir.join("unrelated.txt");
    std::fs::write(&other_file, "head content\n").unwrap();

    git_cmd(&repo_dir, &["add", "."]);
    git_cmd(&repo_dir, &["commit", "-m", "init"]);

    // Set XDG_CONFIG_HOME
    std::env::set_var("XDG_CONFIG_HOME", &repo_dir);
    assert_eq!(dam_hopper_server::config::global_config_path(), config_file);

    // Mutate both files
    std::fs::write(&config_file, "MUTATED_CONFIG = true\n").unwrap();
    std::fs::write(&other_file, "mutated content\n").unwrap();

    // 1. Attempt discard on protected config -> REFUSED
    let res = discard_file(&repo_dir, "dam-hopper/config.toml");
    assert!(res.is_err(), "discard_file must fail for protected config");
    assert!(
        matches!(res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "Expected MutationRefused error on protected config discard"
    );
    // Config contents must be preserved
    assert_eq!(
        std::fs::read_to_string(&config_file).unwrap(),
        "MUTATED_CONFIG = true\n"
    );

    // 2. Attempt discard_hunk on protected config -> REFUSED
    let res_hunk = discard_hunk(&repo_dir, "dam-hopper/config.toml", 0);
    assert!(res_hunk.is_err(), "discard_hunk must fail for protected config");
    assert!(
        matches!(res_hunk, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "Expected MutationRefused error on protected config discard_hunk"
    );
    assert_eq!(
        std::fs::read_to_string(&config_file).unwrap(),
        "MUTATED_CONFIG = true\n"
    );

    // 3. Positive control: discard on unrelated file SUCCEEDS
    let res_other = discard_file(&repo_dir, "unrelated.txt");
    assert!(res_other.is_ok(), "discard on unrelated file must succeed");
    assert_eq!(
        std::fs::read_to_string(&other_file).unwrap(),
        "head content\n",
        "Unrelated file must be restored to HEAD"
    );
}

#[tokio::test]
async fn test_conflict_resolve_refuses_protected_config() {
    let _guard = TEST_MUTEX.lock().await;

    let tmp = TempDir::new().unwrap();
    let repo_dir = tmp.path().join("repo");
    std::fs::create_dir_all(&repo_dir).unwrap();
    git_cmd(&repo_dir, &["init", "-b", "main"]);
    git_cmd(&repo_dir, &["config", "user.email", "test@test.local"]);
    git_cmd(&repo_dir, &["config", "user.name", "Test"]);

    let config_dir = repo_dir.join("dam-hopper");
    std::fs::create_dir_all(&config_dir).unwrap();
    let config_file = config_dir.join("config.toml");
    std::fs::write(&config_file, "init\n").unwrap();
    git_cmd(&repo_dir, &["add", "."]);
    git_cmd(&repo_dir, &["commit", "-m", "init"]);

    std::env::set_var("XDG_CONFIG_HOME", &repo_dir);

    // Call apply_conflict_resolution on protected config
    let req = dam_hopper_server::git::types::ResolveRequest {
        conflict_id: dam_hopper_server::git::conflict::encode_conflict_id(b"dam-hopper/config.toml"),
        snapshot_version: "snap1".into(),
        full_index_fingerprint: "fp1".into(),
        action: dam_hopper_server::git::types::ResolveAction::Delete {},
        root: None,
        worktree_path: None,
    };

    let outcome = dam_hopper_server::git::apply_conflict_resolution(&repo_dir, &req).unwrap();
    assert!(
        matches!(outcome, dam_hopper_server::git::types::ResolveOutcome::Unsupported { ref reason } if reason.contains("Direct mutation of global config file is forbidden")),
        "Expected Unsupported outcome refusing mutation of protected config, got {outcome:?}"
    );
}

#[tokio::test]
async fn test_checkout_and_reset_and_cherry_pick_refuse_protected_config() {
    let _guard = TEST_MUTEX.lock().await;

    let tmp = TempDir::new().unwrap();
    let repo_dir = tmp.path().join("repo");
    std::fs::create_dir_all(&repo_dir).unwrap();
    git_cmd(&repo_dir, &["init", "-b", "main"]);
    git_cmd(&repo_dir, &["config", "user.email", "test@test.local"]);
    git_cmd(&repo_dir, &["config", "user.name", "Test"]);

    let config_dir = repo_dir.join("dam-hopper");
    std::fs::create_dir_all(&config_dir).unwrap();
    let config_file = config_dir.join("config.toml");
    std::fs::write(&config_file, "version = 1\n").unwrap();
    git_cmd(&repo_dir, &["add", "."]);
    git_cmd(&repo_dir, &["commit", "-m", "commit 1"]);

    // Create branch other with modified config
    git_cmd(&repo_dir, &["checkout", "-b", "other"]);
    std::fs::write(&config_file, "version = 2\n").unwrap();
    git_cmd(&repo_dir, &["commit", "-am", "commit 2 on other"]);
    let other_hash = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_dir)
        .output()
        .unwrap();
    let other_hash = String::from_utf8_lossy(&other_hash.stdout).trim().to_string();

    // Return to main
    git_cmd(&repo_dir, &["checkout", "main"]);

    // Set XDG_CONFIG_HOME
    std::env::set_var("XDG_CONFIG_HOME", &repo_dir);

    // 1. Checkout other branch (whose diff modifies config.toml) -> REFUSED
    let checkout_res = dam_hopper_server::git::checkout_branch(
        &repo_dir,
        "other",
        None,
        false,
        dam_hopper_server::git::CheckoutStrategy::Normal,
    )
    .await;
    assert!(
        matches!(checkout_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "checkout of branch modifying protected config must be refused, got: {checkout_res:?}"
    );

    // 2. Cherry-pick other commit (which modifies config.toml) -> REFUSED
    let cp_res = dam_hopper_server::git::cherry_pick(&repo_dir, &other_hash).await;
    assert!(
        matches!(cp_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "cherry-pick modifying protected config must be refused, got: {cp_res:?}"
    );

    // 3. Reset hard to other commit (which modifies config.toml) -> REFUSED
    let reset_res = dam_hopper_server::git::reset_to_commit(
        &repo_dir,
        &other_hash,
        dam_hopper_server::git::ResetMode::Hard,
    )
    .await;
    assert!(
        matches!(reset_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "reset hard to commit modifying protected config must be refused, got: {reset_res:?}"
    );

    // 4. Discard with wildcard matching protected config -> REFUSED
    std::fs::write(&config_file, "version = dirty\n").unwrap();
    let discard_wildcard_res = dam_hopper_server::git::diff::discard_file(&repo_dir, "dam-hopper/*");
    assert!(
        matches!(discard_wildcard_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "discard_file with wildcard expanding to protected config must be refused, got: {discard_wildcard_res:?}"
    );
    assert_eq!(std::fs::read_to_string(&config_file).unwrap(), "version = dirty\n");

    std::fs::write(&config_file, "version = 1\n").unwrap();
    git_cmd(&repo_dir, &["checkout", "--", "."]);
    // 5. Committed rename of protected config (dam-hopper/config.toml -> dam-hopper/moved.toml) -> REFUSED
    git_cmd(&repo_dir, &["checkout", "-b", "rename-branch"]);
    git_cmd(&repo_dir, &["mv", "dam-hopper/config.toml", "dam-hopper/moved.toml"]);
    git_cmd(&repo_dir, &["commit", "-m", "rename config"]);
    let rename_hash = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_dir)
        .output()
        .unwrap();
    let rename_hash = String::from_utf8_lossy(&rename_hash.stdout).trim().to_string();
    git_cmd(&repo_dir, &["checkout", "main"]);

    let checkout_rename_res = dam_hopper_server::git::checkout_branch(
        &repo_dir,
        "rename-branch",
        None,
        false,
        dam_hopper_server::git::CheckoutStrategy::Normal,
    )
    .await;
    assert!(
        matches!(checkout_rename_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "checkout of branch renaming protected config must be refused via --no-renames source inspection, got: {checkout_rename_res:?}"
    );

    let cp_rename_res = dam_hopper_server::git::cherry_pick(&repo_dir, &rename_hash).await;
    assert!(
        matches!(cp_rename_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "cherry-pick of commit renaming protected config must be refused, got: {cp_rename_res:?}"
    );

    // 6. Force checkout with dirty protected config in working tree -> REFUSED
    std::fs::write(&config_file, "version = dirty_again\n").unwrap();
    let force_checkout_res = dam_hopper_server::git::checkout_branch(
        &repo_dir,
        "main",
        None,
        false,
        dam_hopper_server::git::CheckoutStrategy::Force,
    )
    .await;
    assert!(
        matches!(force_checkout_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "force checkout with dirty protected config must be refused, got: {force_checkout_res:?}"
    );
    assert_eq!(std::fs::read_to_string(&config_file).unwrap(), "version = dirty_again\n");

    // 7. Pull fast-forward merge modifying protected config -> REFUSED
    // Clean worktree before pull test
    std::fs::write(&config_file, "version = 1\n").unwrap();
    git_cmd(&repo_dir, &["checkout", "."]);
    // Set upstream tracking to rename-branch
    git_cmd(&repo_dir, &["branch", "--set-upstream-to=rename-branch", "main"]);
    let pull_res = dam_hopper_server::git::pull(&repo_dir, "repo", &None, None).await;
    assert!(!pull_res.success, "pull with upstream rename/mutation of protected config must fail");
    assert!(
        pull_res.error.as_deref().unwrap_or("").contains("rejected")
            || pull_res.error.as_deref().unwrap_or("").contains("forbidden")
            || pull_res.error.as_deref().unwrap_or("").contains("MutationRefused"),
        "Expected pull refusal error, got: {:?}",
        pull_res.error
    );

    // 8. Assume-unchanged hard reset evasion attempt -> REFUSED
    git_cmd(&repo_dir, &["branch", "--unset-upstream", "main"]);
    git_cmd(&repo_dir, &["update-index", "--assume-unchanged", "dam-hopper/config.toml"]);
    std::fs::write(&config_file, "version = assume_unchanged_mutated\n").unwrap();
    let head_hash = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repo_dir)
        .output()
        .unwrap();
    let head_hash = String::from_utf8_lossy(&head_hash.stdout).trim().to_string();

    let reset_assume_unchanged_res = dam_hopper_server::git::reset_to_commit(
        &repo_dir,
        &head_hash,
        dam_hopper_server::git::ResetMode::Hard,
    )
    .await;
    assert!(
        matches!(reset_assume_unchanged_res, Err(dam_hopper_server::error::AppError::Fs(dam_hopper_server::fs::FsError::MutationRefused(_)))),
        "reset hard on assume-unchanged dirty protected config must be refused, got: {reset_assume_unchanged_res:?}"
    );
    assert_eq!(
        std::fs::read_to_string(&config_file).unwrap(),
        "version = assume_unchanged_mutated\n",
        "Config file on disk must retain mutated content despite assume-unchanged index flag"
    );
}
