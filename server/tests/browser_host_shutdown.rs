use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

use dam_hopper_server::browser_host::config::BrowserHostConfig;
use dam_hopper_server::browser_host::manager::BrowserHostManager;
use dam_hopper_server::browser_host::process::find_browser_executable;
use dam_hopper_server::browser_host::profile::{
    now_unix_ms, ManagedProfile, ResetStage, ResetTombstone,
};
use dam_hopper_server::config::schema::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ServerConfig, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;

fn resolve_test_executable() -> Option<PathBuf> {
    if let Ok(p) = find_browser_executable(None) {
        return Some(p);
    }
    for candidate in &["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn create_test_app_state(
    workspace_root: PathBuf,
    browser_cfg: BrowserHostConfig,
    custom_profile_root: Option<PathBuf>,
) -> AppState {
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(std::sync::Arc::new(event_sink.clone()));

    let mut server = ServerConfig::default();
    server.browser = browser_cfg;

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "shutdown-test-ws".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server,
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: workspace_root.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = dam_hopper_server::agent_store::AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-key".to_string();
    let fs_subsystem = FsSubsystem::new(vec![]);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

    let mut state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs_subsystem,
        None,
        true, // no_auth
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
    )
    .expect("failed to create test AppState");

    if let Some(root) = custom_profile_root {
        state.browser_host = std::sync::Arc::new(BrowserHostManager::new(
            state.config.try_read().unwrap().server.browser.clone(),
            Some(root),
            CancellationToken::new(),
        ));
    }

    state
}

#[tokio::test]
async fn test_server_startup_without_browser_use_launches_no_engine() {
    let tmp = tempdir().unwrap();
    let profile_tmp = tempdir().unwrap();

    let mut browser_cfg = BrowserHostConfig::default();
    browser_cfg.enabled = true;
    browser_cfg.executable_path = resolve_test_executable();

    let state = create_test_app_state(
        tmp.path().to_path_buf(),
        browser_cfg,
        Some(profile_tmp.path().to_path_buf()),
    );

    // 1. AppState::new creates lazy manager; NO Chromium engine is spawned
    let caps = state.browser_host.capabilities("admin@example.com", false).await;
    assert_eq!(caps.protocol_version, 1);
    assert!(!caps.managed_profile_present);
    // 2. Profile root has not created any user-data or engine processes
    let profile = ManagedProfile::new(profile_tmp.path(), "admin@example.com", false).unwrap();
    assert!(!profile.user_data_dir().exists(), "no user-data directory should be spawned");
    // 3. Graceful shutdown completes immediately without stalling
    state.browser_host.shutdown_all().await;
}

#[tokio::test]
async fn test_shutdown_reaps_browser_descendants_and_preserves_credentials() {
    let exec = match resolve_test_executable() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let profile_tmp = tempdir().unwrap();

    let mut browser_cfg = BrowserHostConfig::default();
    browser_cfg.enabled = true;
    browser_cfg.executable_path = Some(exec);

    let state = create_test_app_state(
        tmp.path().to_path_buf(),
        browser_cfg,
        Some(profile_tmp.path().to_path_buf()),
    );

    // 1. Launch managed browser instance
    let handle = state
        .browser_host
        .ensure_running("user_shutdown", false)
        .await
        .expect("browser launch failed");

    let pid = handle.pid;
    assert!(pid > 0);

    #[cfg(unix)]
    {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;
        let is_running = kill(Pid::from_raw(pid as i32), None).is_ok();
        assert!(is_running, "browser process must be running before shutdown");
    }

    // 2. Write credential/cookie marker in user-data-dir
    let cookie_file = handle.user_data_dir.join("Cookies");
    fs::write(&cookie_file, b"persisted_admin_session").unwrap();
    assert!(cookie_file.exists());

    // 3. Server shutdown reaps all browser instances
    state.browser_host.shutdown_all().await;

    // Give kernel a moment to reap
    tokio::time::sleep(Duration::from_millis(100)).await;

    // 4. Verify process and descendants are dead
    #[cfg(unix)]
    {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;
        let is_dead = kill(Pid::from_raw(pid as i32), None).is_err();
        assert!(is_dead, "browser process must be dead after server shutdown");
    }

    // 5. Verify user-data-dir credentials are preserved across server shutdown!
    assert!(
        cookie_file.exists(),
        "credentials must NOT be deleted by server shutdown"
    );
    let cookie_data = fs::read(&cookie_file).unwrap();
    assert_eq!(cookie_data, b"persisted_admin_session");
}

#[tokio::test]
async fn test_shutdown_timeout_leaves_recoverable_tombstone_and_never_reports_deleted_credentials() {
    let tmp = tempdir().unwrap();
    let profile_tmp = tempdir().unwrap();

    let profile = ManagedProfile::new(profile_tmp.path(), "user_tombstone", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    let cred_file = profile.user_data_dir().join("Login Data");
    fs::write(&cred_file, b"saved_login_records").unwrap();

    // Create unsettled tombstone
    let tombstone = ResetTombstone {
        operation_id: "op-unfinished-shutdown".to_string(),
        target_profile_epoch: 2,
        stage: ResetStage::Terminating,
        created_at_unix_ms: now_unix_ms(),
        updated_at_unix_ms: now_unix_ms(),
        error: Some("shutdown watchdog interrupted reset".to_string()),
        process_pid: None,
        process_pgid: None,
    };
    profile.save_tombstone(&tombstone).unwrap();

    let mut browser_cfg = BrowserHostConfig::default();
    browser_cfg.enabled = true;
    browser_cfg.executable_path = resolve_test_executable();

    let state = create_test_app_state(
        tmp.path().to_path_buf(),
        browser_cfg.clone(),
        Some(profile_tmp.path().to_path_buf()),
    );

    // Shutdown runs
    state.browser_host.shutdown_all().await;

    // 1. Tombstone survives shutdown
    let loaded_tombstone = profile.load_tombstone().unwrap().expect("tombstone must survive");
    assert_eq!(loaded_tombstone.operation_id, "op-unfinished-shutdown");

    // 2. Live credentials were NOT deleted
    assert!(cred_file.exists(), "credentials must not be deleted on premature exit or timeout");

    // 3. Restart server and verify capabilities reflect recoverable cleanup pending
    let restarted_state = create_test_app_state(
        tmp.path().to_path_buf(),
        browser_cfg,
        Some(profile_tmp.path().to_path_buf()),
    );
    let caps = restarted_state.browser_host.capabilities("user_tombstone", false).await;
    assert!(!caps.available);
    assert!(caps.unavailable_reason.unwrap().contains("cleanup pending"));
}
