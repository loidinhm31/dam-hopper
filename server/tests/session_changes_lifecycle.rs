use dam_hopper_server::agent_status::SESSION_CHANGES_EXTENSION_SUBPATH;
use dam_hopper_server::api::config::{reconcile_and_publish_config_locked, reload_config_locked};
use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, ServerConfig, WorkspaceInfo};
use dam_hopper_server::session_changes::binding::get_retained_session_list;
use dam_hopper_server::session_changes::store::{
    SessionChangesKey, SessionChangesRecord, SessionChangesService,
};
use dam_hopper_server::session_changes::types::*;
use dam_hopper_server::state::AppState;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;
static TEST_ENV_MUTEX: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn test_terminal_metadata_retention_and_removal() {
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    let key = SessionChangesKey {
        terminal_id: "term-123".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "omp-session-abc".into(),
        root_id: ".".into(),
    };

    let record = SessionChangesRecord {
        baseline_id: "base-1".into(),
        omp_session_id: "omp-session-abc".into(),
        root_id: ".".into(),
        canonical_root: PathBuf::from("/tmp/repo"),
        root_dir_file: None,
        generation: 1,
        created_at_ms: 1700000000000,
        captured_at_ms: 1700000000000,
        state: StatusState::Ready,
        tracked_paths: std::collections::BTreeMap::new(),
        retained_bytes: 500,
        comparison: None,
        comparison_revision: 0,
        capture_generation: 0,
        reason: None,
        recent_turn_ids: BTreeSet::new(),
        last_settled_turn_id: None,
        dirty_settled_hint: false,
    };

    {
        let mut recs = service.records.lock();
        recs.insert(key.clone(), record);
    }

    // 1. Terminal exited (process exit / dead status): record remains in service!
    let retained_list = get_retained_session_list(&service, "term-123", "1").unwrap();
    assert_eq!(retained_list.sessions.len(), 1);
    assert_eq!(retained_list.sessions[0].omp_session_id, "omp-session-abc");
    assert_eq!(retained_list.sessions[0].state, StatusState::Ready);

    // 2. Querying different incarnation returns empty list
    let empty_list = get_retained_session_list(&service, "term-123", "2").unwrap();
    assert_eq!(empty_list.sessions.len(), 0);

    // 3. Invalid incarnation returns IncarnationMismatch
    let err = get_retained_session_list(&service, "term-123", "01");
    assert_eq!(err.unwrap_err(), ErrorCode::IncarnationMismatch);

    // 4. Actual metadata removal (TTL sweep / explicit remove_with_expected) releases the record
    service.remove_terminal_records("term-123", "1");

    let after_remove = get_retained_session_list(&service, "term-123", "1").unwrap();
    assert_eq!(after_remove.sessions.len(), 0);
}

#[test]
fn test_default_off_service_and_atomic_purge_invalidation() {
    let service = SessionChangesService::new().unwrap();

    // Starts default OFF
    assert!(!service.is_enabled());
    let (enabled, gen) = service.current_generation();
    assert!(!enabled);
    assert_eq!(gen, 0);

    // Operations fail closed
    let _key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "omp-1".into(),
        root_id: ".".into(),
    };
    let err = get_retained_session_list(&Arc::new(service), "term-1", "1").unwrap_err();
    assert_eq!(err, ErrorCode::TargetUnavailable);

    let service = SessionChangesService::new().unwrap();
    assert!(service.try_reserve_storage_for_generation(0, 500).is_err());

    // Enable flips gate and bumps generation
    let gen1 = service.enable();
    assert!(service.is_enabled());
    assert_eq!(gen1, 1);

    // Storage reservation succeeds for generation 1
    assert!(service.try_reserve_storage_for_generation(gen1, 500).is_ok());
    assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 500);

    // Disable and purge drains state
    service.disable_and_purge();
    assert!(!service.is_enabled());
    assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 0);

    // Releasing storage for generation 1 after disable does NOT underflow or mutate accounting
    service.release_storage_for_generation(gen1, 500);
    assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 0);

    // Re-enabling to generation 3
    let gen3 = service.enable();
    assert_eq!(gen3, 3);
    assert!(service.try_reserve_storage_for_generation(gen3, 200).is_ok());
    assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 200);

    // Stale worker from generation 1 trying to release does not touch generation 3 allocation
    service.release_storage_for_generation(gen1, 500);
    assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 200);
}

#[tokio::test]
async fn test_race_disable_during_capture_publication() {
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());
    let (_, gen) = service.current_generation();
    assert_eq!(gen, 1);

    // Setup bound terminal and repo
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(root.join(".git")).unwrap();
    std::fs::write(root.join("hello.txt"), "content").unwrap();

    service.bind_terminal_target(
        "term-race",
        1,
        dam_hopper_server::session_changes::store::BoundTerminalTarget {
            project_name: Some("test-proj".into()),
            worktree_path: None,
            launch_cwd: root.clone(),
        },
    );
    let reg = dam_hopper_server::session_changes::capture::register_session(
        &service,
        "term-race".into(),
        "1".into(),
        &root,
        dam_hopper_server::session_changes::types::RegisterRequest {
            version: 1,
            omp_session_id: "omp-race".into(),
            root_id: ".".into(),
            cwd_hint: None,
        },
    )
    .await
    .unwrap();

    // Simulate race: service is disabled while in-flight worker was running
    service.disable_and_purge();
    assert!(!service.is_enabled());

    let cap_req = dam_hopper_server::session_changes::types::CaptureRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation: "1".into(),
        omp_session_id: "omp-race".into(),
        root_id: ".".into(),
        baseline_id: reg.baseline_id,
        capture_id: "cap-race".into(),
        paths: vec!["hello.txt".into()],
        mode: dam_hopper_server::session_changes::types::CaptureMode::PreEdit,
    };

    let err = dam_hopper_server::session_changes::capture::capture_session_paths(
        &service,
        "term-race".into(),
        "1".into(),
        cap_req,
    )
    .await
    .unwrap_err();
    assert_eq!(err, ErrorCode::TrackingDisabled);
    assert_eq!(service.records.lock().len(), 0);
    assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn test_concurrent_disable_during_in_flight_capture_drains_state() {
    for _ in 0..10 {
        let service = Arc::new(SessionChangesService::new_enabled().unwrap());
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("repo");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("hello.txt"), "hello world content\n").unwrap();

        service.bind_terminal_target(
            "term-conc",
            1,
            dam_hopper_server::session_changes::store::BoundTerminalTarget {
                project_name: Some("test-proj".into()),
                worktree_path: None,
                launch_cwd: root.clone(),
            },
        );

        let service_clone = Arc::clone(&service);
        let root_clone = root.clone();
        let capture_handle = tokio::spawn(async move {
            let reg = dam_hopper_server::session_changes::capture::register_session(
                &service_clone,
                "term-conc".into(),
                "1".into(),
                &root_clone,
                dam_hopper_server::session_changes::types::RegisterRequest {
                    version: 1,
                    omp_session_id: "omp-conc".into(),
                    root_id: ".".into(),
                    cwd_hint: None,
                },
            )
            .await;
            if let Ok(r) = reg {
                let _ = dam_hopper_server::session_changes::capture::capture_session_paths(
                    &service_clone,
                    "term-conc".into(),
                    "1".into(),
                    dam_hopper_server::session_changes::types::CaptureRequest {
                        version: 1,
                        server_epoch: service_clone.server_epoch.clone(),
                        terminal_incarnation: "1".into(),
                        omp_session_id: "omp-conc".into(),
                        root_id: ".".into(),
                        baseline_id: r.baseline_id,
                        capture_id: "cap-conc".into(),
                        paths: vec!["hello.txt".into()],
                        mode: dam_hopper_server::session_changes::types::CaptureMode::PreEdit,
                    },
                )
                .await;
            }
        });
        let disable_handle = {
            let service_disable = Arc::clone(&service);
            tokio::spawn(async move {
                tokio::task::yield_now().await;
                service_disable.disable_and_purge();
            })
        };

        let _ = tokio::join!(capture_handle, disable_handle);

        // Invariant: after disable_and_purge completes, service is OFF, 0 records, 0 storage bytes
        assert!(!service.is_enabled());
        assert_eq!(service.records.lock().len(), 0);
        assert_eq!(service.allocated_storage_bytes.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}

fn create_test_state_with_config(workspace_root: PathBuf, config: DamHopperConfig) -> AppState {
    let (event_sink, _rx) = dam_hopper_server::pty::BroadcastEventSink::new(512);
    let pty_manager = dam_hopper_server::pty::PtySessionManager::new(std::sync::Arc::new(event_sink.clone()));
    let global_config = dam_hopper_server::config::GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = dam_hopper_server::agent_store::AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-key".to_string();
    let fs = dam_hopper_server::fs::FsSubsystem::new(vec![]);
    let opaque_server_setup =
        opaque_ke::ServerSetup::<dam_hopper_server::crypto::DamHopperOpaqueSuite>::new(&mut rand::rngs::OsRng);

    AppState::new(
        workspace_root.clone(),
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None,
        true,
        dam_hopper_server::tunnel::TunnelSessionManager::new(
            Arc::new(dam_hopper_server::pty::BroadcastEventSink::new(512).0),
            Arc::new(dam_hopper_server::tunnel::CloudflaredDriver),
        ),
        None,
        opaque_server_setup,
        dam_hopper_server::diagnostics::DiagnosticStore::new(workspace_root.join("diagnostics.log")),
    )
    .unwrap()
}

#[tokio::test]
async fn test_config_reconciliation_enable_disable_lifecycle() {
    let _env_lock = TEST_ENV_MUTEX.lock().await;
    let tmp = tempdir().unwrap();
    let workspace_root = tmp.path().join("workspace");
    std::fs::create_dir_all(&workspace_root).unwrap();

    let agent_dir = tmp.path().join("agent");
    std::fs::create_dir_all(&agent_dir).unwrap();
    // Set environment variable to target our isolated agent directory
    std::env::set_var("PI_CODING_AGENT_DIR", agent_dir.to_str().unwrap());

    let config_path = workspace_root.join("dam-hopper.toml");
    let initial_toml = r#"
[workspace]
name = "lifecycle-ws"

[server]
session_changes_enabled = false
"#;
    std::fs::write(&config_path, initial_toml).unwrap();

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "lifecycle-ws".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig {
            session_changes_enabled: false,
            ..Default::default()
        },
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: config_path.clone(),
    };

    let state = create_test_state_with_config(workspace_root.clone(), config);

    // Initial state: tracking OFF, extension absent
    assert!(!state.session_changes.is_enabled());
    assert!(!agent_dir.join(SESSION_CHANGES_EXTENSION_SUBPATH).exists());

    // 1. Enable session changes via reconcile
    let mut enabled_config = state.config.read().await.clone();
    enabled_config.server.session_changes_enabled = true;
    let _guard = state.workspace_context_guard.write().await;
    reconcile_and_publish_config_locked(&state, enabled_config).await.expect("enable reconcile");
    drop(_guard);

    assert!(state.session_changes.is_enabled());
    assert!(agent_dir.join(SESSION_CHANGES_EXTENSION_SUBPATH).is_file());

    // 2. Disable session changes via external TOML change + reload_config_locked (cache_clear)
    std::fs::write(&config_path, initial_toml).unwrap();
    let _guard = state.workspace_context_guard.write().await;
    reload_config_locked(&state).await.expect("reload after external change");
    drop(_guard);

    assert!(!state.session_changes.is_enabled());
    assert!(!agent_dir.join(SESSION_CHANGES_EXTENSION_SUBPATH).exists());
}

#[tokio::test]
async fn test_modified_extension_conflict_preserves_file_and_stays_off() {
    let _env_lock = TEST_ENV_MUTEX.lock().await;
    let tmp = tempdir().unwrap();
    let workspace_root = tmp.path().join("workspace");
    std::fs::create_dir_all(&workspace_root).unwrap();

    let agent_dir = tmp.path().join("agent_mod");
    std::fs::create_dir_all(&agent_dir).unwrap();
    std::env::set_var("PI_CODING_AGENT_DIR", agent_dir.to_str().unwrap());

    let config_path = workspace_root.join("dam-hopper.toml");
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "mod-ws".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig {
            session_changes_enabled: true,
            ..Default::default()
        },
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: config_path.clone(),
    };

    let state = create_test_state_with_config(workspace_root.clone(), config);

    // Enable session changes
    let enabled_cfg = state.config.read().await.clone();
    let _guard = state.workspace_context_guard.write().await;
    reconcile_and_publish_config_locked(&state, enabled_cfg).await.expect("enable");
    drop(_guard);

    let extension_path = agent_dir.join(SESSION_CHANGES_EXTENSION_SUBPATH);
    assert!(extension_path.is_file());
    assert!(state.session_changes.is_enabled());

    // Tamper with extension file (user modified)
    let mut content = std::fs::read_to_string(&extension_path).unwrap();
    content.push_str("\n// user custom change\n");
    std::fs::write(&extension_path, content).unwrap();

    // Disabling via reconcile must preserve the file and leave runtime OFF
    let mut disabled_cfg = state.config.read().await.clone();
    disabled_cfg.server.session_changes_enabled = false;
    let _guard = state.workspace_context_guard.write().await;
    reconcile_and_publish_config_locked(&state, disabled_cfg).await.expect("disable with conflict");
    drop(_guard);

    assert!(!state.session_changes.is_enabled());
    // File was NOT deleted because it was modified
    assert!(extension_path.is_file());
    let current_content = std::fs::read_to_string(&extension_path).unwrap();
    assert!(current_content.contains("// user custom change"));
}

#[tokio::test]
async fn test_workspace_switch_reconciles_session_changes() {
    let _env_lock = TEST_ENV_MUTEX.lock().await;
    let tmp = tempdir().unwrap();
    let ws_a = tmp.path().join("workspace_a");
    let ws_b = tmp.path().join("workspace_b");
    std::fs::create_dir_all(&ws_a).unwrap();
    std::fs::create_dir_all(&ws_b).unwrap();

    let agent_dir = tmp.path().join("agent_ws");
    std::fs::create_dir_all(&agent_dir).unwrap();
    std::env::set_var("PI_CODING_AGENT_DIR", agent_dir.to_str().unwrap());

    // WS A: enabled = true
    let config_a = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "ws-a".into(),
            root: ws_a.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig {
            session_changes_enabled: true,
            ..Default::default()
        },
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: ws_a.join("dam-hopper.toml"),
    };

    // WS B: enabled = false
    let config_b = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "ws-b".into(),
            root: ws_b.display().to_string(),
        },
        agent_store: None,
        server: ServerConfig {
            session_changes_enabled: false,
            ..Default::default()
        },
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: ws_b.join("dam-hopper.toml"),
    };

    let state = create_test_state_with_config(ws_a.clone(), config_a.clone());

    // Initialize with WS A (enabled)
    let _guard = state.workspace_context_guard.write().await;
    reconcile_and_publish_config_locked(&state, config_a).await.expect("init ws a");
    drop(_guard);
    assert!(state.session_changes.is_enabled());
    assert!(agent_dir.join(SESSION_CHANGES_EXTENSION_SUBPATH).is_file());

    // Switch to WS B (disabled)
    let _guard = state.workspace_context_guard.write().await;
    reconcile_and_publish_config_locked(&state, config_b).await.expect("switch to ws b");
    drop(_guard);
    assert!(!state.session_changes.is_enabled());
    assert!(!agent_dir.join(SESSION_CHANGES_EXTENSION_SUBPATH).exists());
}
