use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use dam_hopper_server::config::parser::{is_sensitive_workspace_root, resolve_workspace_root};
use dam_hopper_server::config::schema::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
    ServerConfig, TerminalProfile, WorkspaceInfo, WorkspaceRootError,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::error::FsError;
use dam_hopper_server::fs::sandbox::WorkspaceSandbox;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use dam_hopper_server::workspace_target::{
    resolve_filesystem_target_parts, FileIdentity, FilesystemTargetRef, ProjectTargetRef,
    ResolvedFilesystemTarget, WorkspaceFolderTerminalRequest, WorkspaceTargetError,
    WorkspaceTargetResolver,
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tempfile::TempDir;

// ─────────────────────────────────────────────────────────────
// 1. Serialization & Wire Contracts
// ─────────────────────────────────────────────────────────────

#[test]
fn test_wire_contract_serialization_workspace() {
    let target = FilesystemTargetRef::workspace();
    let json = serde_json::to_string(&target).expect("serialize workspace target");
    assert_eq!(json, r#"{"type":"workspace"}"#);

    let roundtrip: FilesystemTargetRef =
        serde_json::from_str(&json).expect("deserialize workspace target");
    assert_eq!(roundtrip, FilesystemTargetRef::workspace());
    assert!(roundtrip.is_workspace());
    assert_eq!(roundtrip.as_project(), None);
}

#[test]
fn test_wire_contract_serialization_project_without_worktree() {
    let target = FilesystemTargetRef::project("frontend", None);
    let json = serde_json::to_string(&target).expect("serialize project target");
    assert_eq!(json, r#"{"type":"project","project":"frontend"}"#);

    let roundtrip: FilesystemTargetRef =
        serde_json::from_str(&json).expect("deserialize project target");
    assert_eq!(
        roundtrip,
        FilesystemTargetRef::Project(ProjectTargetRef {
            project: "frontend".to_string(),
            worktree_path: None,
        })
    );
    assert!(!roundtrip.is_workspace());
    assert_eq!(
        roundtrip.as_project(),
        Some(&ProjectTargetRef {
            project: "frontend".to_string(),
            worktree_path: None,
        })
    );
}

#[test]
fn test_wire_contract_serialization_project_with_worktree() {
    let target = FilesystemTargetRef::project("backend", Some("/repos/wt1".to_string()));
    let json = serde_json::to_string(&target).expect("serialize project target with worktree");
    assert_eq!(
        json,
        r#"{"type":"project","project":"backend","worktreePath":"/repos/wt1"}"#
    );

    let roundtrip: FilesystemTargetRef =
        serde_json::from_str(&json).expect("deserialize project target with worktree");
    assert_eq!(
        roundtrip,
        FilesystemTargetRef::Project(ProjectTargetRef {
            project: "backend".to_string(),
            worktree_path: Some("/repos/wt1".to_string()),
        })
    );
}

#[test]
fn test_wire_contract_strict_mixed_target_rejection() {
    // 1. Workspace target carrying project field is rejected
    let mixed_project = r#"{"type":"workspace","project":"demo"}"#;
    let err = serde_json::from_str::<FilesystemTargetRef>(mixed_project);
    assert!(err.is_err(), "expected rejection of workspace carrying project field");

    // 2. Workspace target carrying worktreePath field is rejected
    let mixed_worktree = r#"{"type":"workspace","worktreePath":"/elsewhere"}"#;
    let err = serde_json::from_str::<FilesystemTargetRef>(mixed_worktree);
    assert!(err.is_err(), "expected rejection of workspace carrying worktreePath field");

    // 3. Project target carrying unknown fields is rejected
    let project_extra = r#"{"type":"project","project":"demo","unknown":"extra"}"#;
    let err = serde_json::from_str::<FilesystemTargetRef>(project_extra);
    assert!(err.is_err(), "expected rejection of project carrying unknown field");

    // 4. Missing type discriminator is rejected
    let missing_type = r#"{"project":"demo"}"#;
    let err = serde_json::from_str::<FilesystemTargetRef>(missing_type);
    assert!(err.is_err(), "expected rejection of missing type discriminator");

    // 5. Unknown target type is rejected
    let unknown_type = r#"{"type":"unknown"}"#;
    let err = serde_json::from_str::<FilesystemTargetRef>(unknown_type);
    assert!(err.is_err(), "expected rejection of unknown target type");
}

#[test]
fn test_resolved_filesystem_target_projections() {
    let ws = ResolvedFilesystemTarget::from_workspace(PathBuf::from("/workspace/root"));
    assert!(ws.is_workspace());
    assert_eq!(ws.root_path(), Path::new("/workspace/root"));
    assert_eq!(ws.target_key(), "workspace");
    assert_eq!(ws.project(), None);
    assert!(ws.as_project().is_none());
    assert!(ws.is_root());
    assert!(ws.available());
}

#[test]
fn test_file_identity_dto_serialization() {
    let identity = FileIdentity::new("ws-123", 42, "/workspace/root/src/main.rs");
    let json = serde_json::to_string(&identity).expect("serialize FileIdentity");
    assert_eq!(
        json,
        r#"{"workspaceId":"ws-123","workspaceEpoch":42,"canonicalPath":"/workspace/root/src/main.rs"}"#
    );

    let roundtrip: FileIdentity =
        serde_json::from_str(&json).expect("deserialize FileIdentity");
    assert_eq!(roundtrip, identity);
    assert_eq!(roundtrip.workspace_id, "ws-123");
    assert_eq!(roundtrip.workspace_epoch, 42);
    assert_eq!(roundtrip.canonical_path, "/workspace/root/src/main.rs");
}

#[test]
fn test_folder_terminal_request_serialization() {
    let req = WorkspaceFolderTerminalRequest {
        target: FilesystemTargetRef::workspace(),
        cwd: Some("/workspace/root/src".to_string()),
    };
    let json = serde_json::to_string(&req).expect("serialize WorkspaceFolderTerminalRequest");
    assert_eq!(
        json,
        r#"{"target":{"type":"workspace"},"cwd":"/workspace/root/src"}"#
    );

    let roundtrip: WorkspaceFolderTerminalRequest =
        serde_json::from_str(&json).expect("deserialize WorkspaceFolderTerminalRequest");
    assert_eq!(roundtrip.target, FilesystemTargetRef::workspace());
    assert_eq!(roundtrip.cwd, Some("/workspace/root/src".to_string()));
}

// ─────────────────────────────────────────────────────────────
// 2. Authoritative Root Resolution & Fail-Closed Guards
// ─────────────────────────────────────────────────────────────

#[test]
fn test_resolve_workspace_root_explicit_dot() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();

    let resolved = resolve_workspace_root(&config_dir, ".").expect("should resolve dot to config_dir");
    assert_eq!(resolved, config_dir);
}

#[test]
fn test_resolve_workspace_root_relative_subfolder() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();
    let sub = config_dir.join("subfolder");
    fs::create_dir(&sub).unwrap();

    let resolved = resolve_workspace_root(&config_dir, "subfolder").expect("should resolve subfolder");
    assert_eq!(resolved, sub);
}

#[test]
fn test_resolve_workspace_root_empty_fails_closed_unconfigured() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();

    let err = resolve_workspace_root(&config_dir, "").unwrap_err();
    assert_eq!(err, WorkspaceRootError::Unconfigured);
    assert!(err.to_string().contains("UNCONFIGURED_WORKSPACE_ROOT"));

    let err_whitespace = resolve_workspace_root(&config_dir, "   ").unwrap_err();
    assert_eq!(err_whitespace, WorkspaceRootError::Unconfigured);
}

#[test]
fn test_resolve_workspace_root_nonexistent_fails() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();

    let err = resolve_workspace_root(&config_dir, "nonexistent-dir-12345").unwrap_err();
    match err {
        WorkspaceRootError::NotFound(p) => {
            assert!(p.ends_with("nonexistent-dir-12345"));
        }
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[test]
fn test_resolve_workspace_root_file_not_directory_fails() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();
    let file = config_dir.join("test.txt");
    fs::write(&file, "hello").unwrap();

    let err = resolve_workspace_root(&config_dir, "test.txt").unwrap_err();
    match err {
        WorkspaceRootError::NotADirectory(p) => {
            assert_eq!(p, file);
        }
        other => panic!("expected NotADirectory, got {other:?}"),
    }
}

#[test]
fn test_resolve_workspace_root_sensitive_directory_rejection() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();

    // Create a mock .config/dam-hopper inside temp dir
    let sensitive_mock = config_dir.join(".config").join("dam-hopper");
    fs::create_dir_all(&sensitive_mock).unwrap();

    let err = resolve_workspace_root(&config_dir, ".config/dam-hopper").unwrap_err();
    match err {
        WorkspaceRootError::SensitiveDirectory(p) => {
            assert_eq!(p, sensitive_mock);
        }
        other => panic!("expected SensitiveDirectory, got {other:?}"),
    }

    // Direct check helper: target is inside sensitive dir
    assert!(is_sensitive_workspace_root(&sensitive_mock));
    let sub = sensitive_mock.join("subdir");
    fs::create_dir_all(&sub).unwrap();
    assert!(is_sensitive_workspace_root(&sub));

    // Direct check helper: target contains .config/dam-hopper
    assert!(is_sensitive_workspace_root(&config_dir));
}

#[test]
fn test_resolve_workspace_root_config_in_sensitive_dir_fails_closed() {
    let dir = TempDir::new().unwrap();
    let base = dunce::canonicalize(dir.path()).unwrap();
    let sensitive_config_dir = base.join(".config").join("dam-hopper");
    fs::create_dir_all(&sensitive_config_dir).unwrap();

    // Config loaded from ~/.config/dam-hopper trying to set root = "." or ".."
    let err = resolve_workspace_root(&sensitive_config_dir, ".").unwrap_err();
    assert!(matches!(err, WorkspaceRootError::SensitiveDirectory(_)));

    let err_parent = resolve_workspace_root(&sensitive_config_dir, "..").unwrap_err();
    assert!(matches!(err_parent, WorkspaceRootError::SensitiveDirectory(_)));
}

#[test]
fn test_dam_hopper_config_resolve_workspace_root_helper() {
    let dir = TempDir::new().unwrap();
    let config_dir = dunce::canonicalize(dir.path()).unwrap();
    let config_file = config_dir.join("dam-hopper.toml");

    let mut cfg = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-ws".into(),
            root: ".".into(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: config_file,
    };

    let resolved = cfg.resolve_workspace_root().expect("explicit dot resolves");
    assert_eq!(resolved, config_dir);

    // Omitted root string -> empty -> Unconfigured
    cfg.workspace.root = "".into();
    let err = cfg.resolve_workspace_root().unwrap_err();
    assert_eq!(err, WorkspaceRootError::Unconfigured);
}

// ─────────────────────────────────────────────────────────────
// 3. WorkspaceSandbox Containment & Traversal Guards
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_workspace_sandbox_traversal_rejection() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let sandbox = WorkspaceSandbox::new(root.clone()).expect("init sandbox");

    assert_eq!(sandbox.root(), root.as_path());
    assert_eq!(sandbox.generation(), 1);

    // Lexical .. rejection in validate
    let escape_dotdot = root.join("..").join("outside.txt");
    let err = sandbox.validate(escape_dotdot).await.unwrap_err();
    assert!(matches!(err, FsError::PathEscape));

    // Lexical .. rejection in validate_new_path
    let err = sandbox
        .validate_new_path(root.join(".."), "escape.txt")
        .await
        .unwrap_err();
    assert!(matches!(err, FsError::PathEscape));

    // Invalid new names
    assert!(matches!(
        sandbox.validate_new_path(root.clone(), "").await.unwrap_err(),
        FsError::InvalidName(_)
    ));
    assert!(matches!(
        sandbox.validate_new_path(root.clone(), "..").await.unwrap_err(),
        FsError::InvalidName(_)
    ));
    assert!(matches!(
        sandbox.validate_new_path(root.clone(), "foo/bar").await.unwrap_err(),
        FsError::InvalidName(_)
    ));
}

#[tokio::test]
async fn test_workspace_sandbox_symlink_escape_rejection() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();

    let outside_dir = TempDir::new().unwrap();
    let outside_root = dunce::canonicalize(outside_dir.path()).unwrap();
    let outside_target = outside_root.join("secret.txt");
    fs::write(&outside_target, "secret data").unwrap();

    let symlink_path = root.join("link_to_outside");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside_target, &symlink_path).unwrap();

    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&outside_target, &symlink_path).unwrap();

    let sandbox = WorkspaceSandbox::new(root.clone()).expect("init sandbox");

    // Attempt to validate proposed path that goes through symlink escaping root
    let err = sandbox.validate(symlink_path).await.unwrap_err();
    assert!(matches!(err, FsError::PathEscape));
}

#[tokio::test]
async fn test_workspace_sandbox_root_mutation_rejection() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let sandbox = WorkspaceSandbox::new(root.clone()).expect("init sandbox");

    // Mutation target check refuses workspace root itself
    let err = sandbox.check_mutation_target(&root).unwrap_err();
    assert!(matches!(err, FsError::MutationRefused(_)));

    // Mutation of subpaths allowed
    let subpath = root.join("file.txt");
    assert!(sandbox.check_mutation_target(&subpath).is_ok());

    // validate_new_path refuses creating root itself
    let parent = root.parent().unwrap().to_path_buf();
    let root_name = root.file_name().unwrap().to_str().unwrap();
    let err = sandbox
        .validate_new_path(parent, root_name)
        .await
        .unwrap_err();
    assert!(matches!(err, FsError::PathEscape | FsError::MutationRefused(_)));
}

#[tokio::test]
async fn test_workspace_sandbox_directory_identity_replacement_enforced_in_operations() {
    let dir = TempDir::new().unwrap();
    let target = dir.path().join("ws_target");
    fs::create_dir(&target).unwrap();
    let subfile = target.join("child.txt");
    fs::write(&subfile, "initial").unwrap();

    let sandbox = WorkspaceSandbox::new(target.clone()).expect("init sandbox");
    assert!(sandbox.check_identity().is_ok());

    // Validate works initially
    let valid = sandbox.validate(subfile.clone()).await;
    assert!(valid.is_ok());

    // Replace directory with a new directory at the same path
    let old_target = dir.path().join("ws_target_old");
    fs::rename(&target, &old_target).unwrap();
    fs::create_dir(&target).unwrap();
    let new_subfile = target.join("child.txt");
    fs::write(&new_subfile, "replaced").unwrap();

    // 1. check_identity detects replacement
    let err = sandbox.check_identity().unwrap_err();
    assert!(matches!(err, FsError::MutationRefused(_)));

    // 2. Normal validate fails closed immediately
    let err = sandbox.validate(new_subfile).await.unwrap_err();
    assert!(matches!(err, FsError::MutationRefused(_)));

    // 3. Normal validate_new_path fails closed immediately
    let err = sandbox.validate_new_path(target.clone(), "new.txt").await.unwrap_err();
    assert!(matches!(err, FsError::MutationRefused(_)));

    // 4. Normal check_mutation_target fails closed immediately
    let err = sandbox.check_mutation_target(&target).unwrap_err();
    assert!(matches!(err, FsError::MutationRefused(_)));
}

// ─────────────────────────────────────────────────────────────
// 4. Target Resolution (Workspace vs Project)
// ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_resolve_filesystem_target_parts_workspace_and_project() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();

    let proj_dir = dir.path().join("my-project");
    fs::create_dir(&proj_dir).unwrap();
    let proj_canonical = dunce::canonicalize(&proj_dir).unwrap();

    let resolver = WorkspaceTargetResolver::new();
    let projects = vec![("my-project".to_string(), proj_canonical.clone())];

    // 1. Resolve Workspace target
    let ws_ref = FilesystemTargetRef::workspace();
    let ws_res = resolve_filesystem_target_parts(&ws_ref, Some(&root), &resolver, &projects)
        .await
        .expect("resolve workspace target");
    assert_eq!(ws_res.root_path(), root.as_path());
    assert_eq!(ws_res.target_key(), "workspace");
    assert!(ws_res.is_workspace());

    // 2. Resolve Project target
    let proj_ref = FilesystemTargetRef::project("my-project", None);
    let proj_res = resolve_filesystem_target_parts(&proj_ref, Some(&root), &resolver, &projects)
        .await
        .expect("resolve project target");
    assert_eq!(proj_res.root_path(), proj_canonical.as_path());
    assert_eq!(proj_res.target_key(), "root");
    assert_eq!(proj_res.project(), Some("my-project"));
    assert!(!proj_res.is_workspace());

    // 3. Unknown Project fails
    let unknown_ref = FilesystemTargetRef::project("unknown", None);
    let err = resolve_filesystem_target_parts(&unknown_ref, Some(&root), &resolver, &projects)
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        dam_hopper_server::error::AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject)
    ));

    // 4. Workspace target when workspace_root is None fails
    let err = resolve_filesystem_target_parts(&ws_ref, None, &resolver, &projects)
        .await
        .unwrap_err();
    assert!(matches!(err, dam_hopper_server::error::AppError::Unavailable(_)));
}

// ─────────────────────────────────────────────────────────────
// 5. AppState Target Resolution & FsSubsystem Integration
// ─────────────────────────────────────────────────────────────

fn dummy_project(name: &str, path: &Path) -> ProjectConfig {
    ProjectConfig {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        project_type: ProjectType::Cargo,
        services: None,
        commands: None,
        env_file: None,
        tags: None,
        terminals: vec![TerminalProfile {
            name: "default".into(),
            command: "bash".into(),
            cwd: ".".into(),
        }],
        agents: None,
        restart_policy: RestartPolicy::Never,
        restart_max_retries: 5,
        health_check_url: None,
    }
}

fn test_app_state(
    workspace_dir: PathBuf,
    config: DamHopperConfig,
    fs: FsSubsystem,
) -> AppState {
    let (event_sink, _) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let agent_store =
        dam_hopper_server::agent_store::AgentStoreService::new(workspace_dir.join(".agent_store"));
    let global_config = GlobalConfig::default();
    let tunnel_manager = TunnelSessionManager::new(
        Arc::new(event_sink.clone()),
        Arc::new(CloudflaredDriver),
    );
    let opaque_server_setup = ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng);
    let diagnostics = DiagnosticStore::new(workspace_dir.join("diag.jsonl"));

    AppState::new(
        workspace_dir,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        "dummy-secret".to_string(),
        fs,
        None,
        true, // no-auth
        tunnel_manager,
        None,
        opaque_server_setup,
        diagnostics,
    )
    .expect("AppState creation")
}

#[tokio::test]
async fn test_app_state_resolve_filesystem_target_and_subscription() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let config_path = root.join("dam-hopper.toml");

    let proj_dir = root.join("demo-proj");
    fs::create_dir(&proj_dir).unwrap();
    let proj_canonical = dunce::canonicalize(&proj_dir).unwrap();

    let nested_dir = root.join("nested").join("sub");
    fs::create_dir_all(&nested_dir).unwrap();
    let nested_canonical = dunce::canonicalize(&nested_dir).unwrap();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "app-ws".into(),
            root: ".".into(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![dummy_project("demo-proj", &proj_canonical)],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: config_path.clone(),
    };

    let fs = FsSubsystem::new_with_workspace(
        vec![("demo-proj".into(), proj_canonical.clone())],
        Some(root.clone()),
    );

    let state = test_app_state(root.clone(), config, fs.clone());

    // 1. Check workspace sandbox exists on state
    let ws_sb = state.workspace_sandbox().expect("workspace sandbox available");
    assert_eq!(ws_sb.root(), root.as_path());
    let initial_gen = ws_sb.generation();

    // 2. Resolve Workspace target via AppState
    let ws_target = state
        .resolve_filesystem_target(&FilesystemTargetRef::workspace())
        .await
        .expect("resolve workspace target on AppState");
    assert_eq!(ws_target.root_path(), root.as_path());
    assert!(ws_target.is_workspace());

    // 3. Resolve Project target via AppState
    let proj_target = state
        .resolve_filesystem_target(&FilesystemTargetRef::project("demo-proj", None))
        .await
        .expect("resolve project target on AppState");
    assert_eq!(proj_target.root_path(), proj_canonical.as_path());
    assert!(!proj_target.is_workspace());
    assert_eq!(proj_target.project(), Some("demo-proj"));

    // 4. Subscribe to workspace tree at root
    let (sub_id, _rx) = fs
        .subscribe_workspace_tree(root.clone())
        .expect("subscribe to workspace tree");
    assert_eq!(fs.sub_filter_prefix(sub_id), Some(root.clone()));

    // 5. Subscribe to nested directory under workspace root
    let (nested_sub_id, _nested_rx) = fs
        .subscribe_workspace_directory(nested_canonical.clone())
        .expect("subscribe to nested workspace directory");
    assert_eq!(fs.sub_filter_prefix(nested_sub_id), Some(nested_canonical));

    // Subscription outside workspace root is rejected
    let outside = TempDir::new().unwrap();
    let outside_root = dunce::canonicalize(outside.path()).unwrap();
    let escape_sub = fs.subscribe_workspace_tree(outside_root);
    assert!(matches!(escape_sub, Err(FsError::PathEscape)));

    // 6. Reinitialize workspace sandbox flushes workspace subscriptions and bumps generation
    let new_dir = TempDir::new().unwrap();
    let new_root = dunce::canonicalize(new_dir.path()).unwrap();
    fs.reinit_workspace_sandbox(Some(new_root.clone()));

    // Old workspace watcher released (filter prefix removed)
    assert_eq!(fs.sub_filter_prefix(sub_id), None);
    assert_eq!(fs.sub_filter_prefix(nested_sub_id), None);
    let updated_sb = fs.workspace_sandbox().unwrap();
    assert_eq!(updated_sb.root(), new_root.as_path());
    assert_eq!(updated_sb.generation(), initial_gen + 1);

    // Unsubscribe cleans up safely
    fs.unsubscribe_tree(sub_id);
    fs.unsubscribe_tree(nested_sub_id);
}

#[tokio::test]
async fn test_app_state_clears_workspace_sandbox_on_missing_or_dangerous_root() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let config_path = root.join("dam-hopper.toml");

    let proj_dir = root.join("demo-proj");
    fs::create_dir(&proj_dir).unwrap();
    let proj_canonical = dunce::canonicalize(&proj_dir).unwrap();

    // Config has EMPTY root (unconfigured)
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "unconfigured-ws".into(),
            root: "".into(),
        },
        server: ServerConfig::default(),
        agent_store: None,
        projects: vec![dummy_project("demo-proj", &proj_canonical)],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: config_path.clone(),
    };

    // Pre-populate FsSubsystem with a workspace root
    let fs = FsSubsystem::new_with_workspace(
        vec![("demo-proj".into(), proj_canonical.clone())],
        Some(root.clone()),
    );
    assert!(fs.workspace_sandbox().is_ok());

    // Creating AppState MUST clear the workspace sandbox because config has no valid workspace root
    let state = test_app_state(root.clone(), config, fs.clone());

    // Workspace sandbox is cleared / unavailable
    let ws_sb_err = state.workspace_sandbox().unwrap_err();
    assert!(matches!(ws_sb_err, FsError::Unavailable));

    // Resolving workspace target fails
    let ws_res_err = state
        .resolve_filesystem_target(&FilesystemTargetRef::workspace())
        .await
        .unwrap_err();
    assert!(matches!(
        ws_res_err,
        dam_hopper_server::error::AppError::Fs(FsError::Unavailable)
    ));

    // CRITICAL: Project target resolution remains 100% operational!
    let proj_res = state
        .resolve_filesystem_target(&FilesystemTargetRef::project("demo-proj", None))
        .await
        .expect("project target remains available even when workspace is unconfigured");
    assert_eq!(proj_res.root_path(), proj_canonical.as_path());
    assert_eq!(proj_res.project(), Some("demo-proj"));
}

#[tokio::test]
async fn test_workspace_and_project_watcher_namespace_isolation() {
    let dir = TempDir::new().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();

    let proj_dir = root.join("demo-proj");
    fs::create_dir(&proj_dir).unwrap();
    let proj_canonical = dunce::canonicalize(&proj_dir).unwrap();

    let fs = FsSubsystem::new_with_workspace(
        vec![("demo-proj".into(), proj_canonical.clone())],
        Some(root.clone()),
    );

    // Subscribe to both project tree and workspace tree
    let (proj_sub_id, _proj_rx) = fs
        .subscribe_tree("demo-proj", proj_canonical.clone())
        .expect("subscribe project");
    let (ws_sub_id, _ws_rx) = fs
        .subscribe_workspace_tree(root.clone())
        .expect("subscribe workspace");

    assert!(fs.sub_filter_prefix(proj_sub_id).is_some());
    assert!(fs.sub_filter_prefix(ws_sub_id).is_some());

    // 1. Reinit workspace sandbox flushes ONLY workspace subscriptions
    let new_ws_dir = TempDir::new().unwrap();
    let new_ws_root = dunce::canonicalize(new_ws_dir.path()).unwrap();
    fs.reinit_workspace_sandbox(Some(new_ws_root.clone()));

    assert_eq!(fs.sub_filter_prefix(ws_sub_id), None, "workspace sub flushed");
    assert!(fs.sub_filter_prefix(proj_sub_id).is_some(), "project sub retained");

    // 2. Re-subscribe workspace, then reinit project sandbox
    let (ws_sub_id2, _ws_rx2) = fs
        .subscribe_workspace_tree(new_ws_root)
        .expect("subscribe new workspace");

    let new_proj_dir = dir.path().join("demo-proj-2");
    fs::create_dir(&new_proj_dir).unwrap();
    let new_proj_canonical = dunce::canonicalize(&new_proj_dir).unwrap();

    fs.reinit_sandbox(vec![("demo-proj-2".into(), new_proj_canonical)]);

    assert_eq!(fs.sub_filter_prefix(proj_sub_id), None, "project sub flushed");
    assert!(fs.sub_filter_prefix(ws_sub_id2).is_some(), "workspace sub retained");

    fs.unsubscribe_tree(ws_sub_id2);
}
