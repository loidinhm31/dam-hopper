use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tempfile::tempdir;
use tokio_util::sync::CancellationToken;

use dam_hopper_server::browser_host::config::{
    BrowserBudgetsConfig, BrowserHostConfig, BROWSER_PROTOCOL_VERSION,
};
use dam_hopper_server::browser_host::manager::{BrowserHostManager, ManagerError, ResetOutcome};
use dam_hopper_server::browser_host::process::find_browser_executable;
use dam_hopper_server::browser_host::profile::{
    now_unix_ms, ManagedProfile, ProfileError, ResetStage, ResetTombstone,
};

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

#[test]
fn test_managed_profile_layout_and_lock() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();

    // 1. Dev and prod namespaces are strictly separate
    let profile_prod = ManagedProfile::new(root, "alice@example.com", false).unwrap();
    let profile_dev = ManagedProfile::new(root, "alice@example.com", true).unwrap();

    assert!(profile_prod.principal_dir().starts_with(root.join("prod")));
    assert!(profile_dev.principal_dir().starts_with(root.join("dev")));
    assert_ne!(profile_prod.principal_dir(), profile_dev.principal_dir());

    // 2. Principal dir is hashed and non-user-controlled
    let prod_dir_name = profile_prod.principal_dir().file_name().unwrap().to_str().unwrap();
    assert_eq!(prod_dir_name.len(), 64); // SHA-256 hex length
    assert!(prod_dir_name.chars().all(|c| c.is_ascii_hexdigit()));

    // 3. Restricted layout: lock, metadata, reset tombstone are OUTSIDE user-data/
    assert_eq!(profile_prod.lock_file().parent(), Some(profile_prod.principal_dir()));
    assert_eq!(profile_prod.metadata_file().parent(), Some(profile_prod.principal_dir()));
    assert_eq!(profile_prod.reset_file().parent(), Some(profile_prod.principal_dir()));
    assert_eq!(profile_prod.user_data_dir().parent(), Some(profile_prod.principal_dir()));

    // 4. Directory creation and 0700 permissions
    profile_prod.ensure_user_data_dir().unwrap();
    assert!(profile_prod.principal_dir().is_dir());
    assert!(profile_prod.user_data_dir().is_dir());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode_p = fs::metadata(profile_prod.principal_dir()).unwrap().permissions().mode();
        assert_eq!(mode_p & 0o777, 0o700);
        let mode_u = fs::metadata(profile_prod.user_data_dir()).unwrap().permissions().mode();
        assert_eq!(mode_u & 0o777, 0o700);
    }

    // 5. Exclusive OS file lock (stable lock inode across credential deletion)
    let lock1 = profile_prod.try_lock().expect("first lock should succeed");
    assert!(profile_prod.lock_file().is_file());

    // Second lock attempt on same principal must return LockBusy
    let lock2_res = profile_prod.try_lock();
    assert!(matches!(lock2_res, Err(ProfileError::LockBusy(_))));

    // Dropping lock1 releases lock
    drop(lock1);
    let lock3 = profile_prod.try_lock().expect("subsequent lock should succeed");
    drop(lock3);

    // manager.lock file remains on disk (stable inode)
    assert!(profile_prod.lock_file().exists());
}

#[test]
fn test_metadata_persistence_and_profile_epoch() {
    let tmp = tempdir().unwrap();
    let profile = ManagedProfile::new(tmp.path(), "bob@example.com", false).unwrap();

    // Initial metadata initializes to epoch 1
    let meta1 = profile.load_or_init_metadata().unwrap();
    assert_eq!(meta1.subject, "bob@example.com");
    assert!(!meta1.is_dev);
    assert_eq!(meta1.profile_epoch, 1);
    assert!(meta1.browser_incarnation.is_none());

    // Update metadata
    let mut meta2 = meta1.clone();
    meta2.profile_epoch = 2;
    meta2.browser_incarnation = Some("inc-uuid-1234".to_string());
    profile.save_metadata(&meta2).unwrap();

    // Reload metadata and verify
    let reloaded = profile.load_or_init_metadata().unwrap();
    assert_eq!(reloaded.profile_epoch, 2);
    assert_eq!(reloaded.browser_incarnation.as_deref(), Some("inc-uuid-1234"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(profile.metadata_file()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn test_reset_tombstone_lifecycle() {
    let tmp = tempdir().unwrap();
    let profile = ManagedProfile::new(tmp.path(), "carol@example.com", false).unwrap();

    assert!(profile.load_tombstone().unwrap().is_none());

    let tombstone = ResetTombstone {
        operation_id: "reset-op-1".to_string(),
        target_profile_epoch: 2,
        stage: ResetStage::Terminating,
        created_at_unix_ms: now_unix_ms(),
        updated_at_unix_ms: now_unix_ms(),
        error: Some("test error".to_string()),
        process_pid: None,
        process_pgid: None,
    };

    profile.save_tombstone(&tombstone).unwrap();
    assert!(profile.reset_file().is_file());

    let loaded = profile.load_tombstone().unwrap().expect("tombstone should exist");
    assert_eq!(loaded.operation_id, "reset-op-1");
    assert_eq!(loaded.target_profile_epoch, 2);
    assert_eq!(loaded.stage, ResetStage::Terminating);
    assert_eq!(loaded.error.as_deref(), Some("test error"));

    profile.clear_tombstone().unwrap();
    assert!(profile.load_tombstone().unwrap().is_none());
    assert!(!profile.reset_file().exists());
}

#[tokio::test]
async fn test_manager_capabilities_dto() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();

    let mut config = BrowserHostConfig::default();
    config.enabled = false;

    let manager = BrowserHostManager::new(config.clone(), Some(tmp.path().to_path_buf()), cancel.clone());
    let caps = manager.capabilities("user1", false).await;
    assert_eq!(caps.protocol_version, BROWSER_PROTOCOL_VERSION);
    assert!(!caps.available);
    assert_eq!(caps.unavailable_reason.as_deref(), Some("browser host disabled in configuration"));

    // If enabled but executable missing
    config.enabled = true;
    config.executable_path = Some(PathBuf::from("/nonexistent/browser/binary"));
    let manager2 = BrowserHostManager::new(config.clone(), Some(tmp.path().to_path_buf()), cancel.clone());
    let caps2 = manager2.capabilities("user1", false).await;
    assert!(!caps2.available);
    assert!(caps2.unavailable_reason.unwrap().contains("executable"));

    // If profile has tombstone
    let profile = ManagedProfile::new(tmp.path(), "user2", false).unwrap();
    let tombstone = ResetTombstone {
        operation_id: "op-failed".to_string(),
        target_profile_epoch: 2,
        stage: ResetStage::Failed,
        created_at_unix_ms: now_unix_ms(),
        updated_at_unix_ms: now_unix_ms(),
        error: Some("prior failure".to_string()),
        process_pid: None,
        process_pgid: None,
    };
    profile.save_tombstone(&tombstone).unwrap();

    let caps3 = manager2.capabilities("user2", false).await;
    assert!(!caps3.available);
    assert!(caps3.unavailable_reason.unwrap().contains("cleanup pending"));
}

#[tokio::test]
async fn test_reset_profile_stale_epoch_rejected() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();
    let config = BrowserHostConfig::default();
    let manager = BrowserHostManager::new(config, Some(tmp.path().to_path_buf()), cancel);

    // Initial epoch is 1. Calling reset with expected_epoch = 99 must fail with StaleEpoch
    let res = manager.reset_profile("user_stale", false, "op-1", 99).await;
    assert!(matches!(res, Err(ManagerError::StaleEpoch { expected: 99, actual: 1 })));

    // Verify metadata was NOT incremented
    let profile = ManagedProfile::new(tmp.path(), "user_stale", false).unwrap();
    let meta = profile.load_or_init_metadata().unwrap();
    assert_eq!(meta.profile_epoch, 1);
    assert!(profile.load_tombstone().unwrap().is_none());
}

#[tokio::test]
async fn test_reset_profile_simulated_kill_failure() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();
    let config = BrowserHostConfig::default();
    let manager = BrowserHostManager::new(config.clone(), Some(tmp.path().to_path_buf()), cancel.clone());

    let profile = ManagedProfile::new(tmp.path(), "user_fail_kill", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    // Place synthetic cookies / credentials in user-data
    let cookie_file = profile.user_data_dir().join("Cookies");
    fs::write(&cookie_file, b"secret_session_cookies").unwrap();
    assert!(cookie_file.exists());

    // Inject simulated kill failure
    manager._simulated_reset_kill_failure.store(true, Ordering::SeqCst);

    let res = manager.reset_profile("user_fail_kill", false, "op-kill-fail", 1).await.unwrap();
    assert!(matches!(res, ResetOutcome::CleanupPending { .. }));

    // Acceptance check 1: Reset NEVER deletes live user-data when process termination fails!
    assert!(cookie_file.exists(), "live user-data must NOT be deleted on kill failure");

    // Acceptance check 2: reset.json tombstone persists with failure details
    let tombstone = profile.load_tombstone().unwrap().expect("tombstone must persist");
    assert_eq!(tombstone.operation_id, "op-kill-fail");
    assert_eq!(tombstone.stage, ResetStage::Failed);
    assert_eq!(tombstone.target_profile_epoch, 2);

    // Acceptance check 3: Simulated kill failure persists cleanupPending across manager restart!
    let mut active_config = config;
    active_config.enabled = true;
    let restarted_manager = BrowserHostManager::new(active_config, Some(tmp.path().to_path_buf()), cancel);
    let caps = restarted_manager.capabilities("user_fail_kill", false).await;
    assert!(!caps.available);
    assert!(caps.unavailable_reason.unwrap().contains("cleanup pending"));

    // Relaunching while cleanupPending must fail closed
    let launch_res = restarted_manager.ensure_running("user_fail_kill", false).await;
    assert!(matches!(launch_res, Err(ManagerError::CleanupPending(_))));

    // Stable external lock and metadata files survive
    assert!(profile.lock_file().exists());
    assert!(profile.metadata_file().exists());
    assert!(profile.reset_file().exists());
}

#[tokio::test]
async fn test_reset_profile_simulated_delete_failure() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();
    let config = BrowserHostConfig::default();
    let manager = BrowserHostManager::new(config.clone(), Some(tmp.path().to_path_buf()), cancel.clone());

    let profile = ManagedProfile::new(tmp.path(), "user_fail_del", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    let dummy_file = profile.user_data_dir().join("dummy.dat");
    fs::write(&dummy_file, b"data").unwrap();

    // Inject simulated delete failure
    manager._simulated_reset_delete_failure.store(true, Ordering::SeqCst);

    let res = manager.reset_profile("user_fail_del", false, "op-del-fail", 1).await.unwrap();
    assert!(matches!(res, ResetOutcome::CleanupPending { .. }));

    // Tombstone persists across restart
    let tombstone = profile.load_tombstone().unwrap().expect("tombstone must exist");
    assert_eq!(tombstone.operation_id, "op-del-fail");
    assert_eq!(tombstone.stage, ResetStage::Failed);

    let restarted_manager = BrowserHostManager::new(config, Some(tmp.path().to_path_buf()), cancel);
    let caps = restarted_manager.capabilities("user_fail_del", false).await;
    assert!(!caps.available);
}

#[tokio::test]
async fn test_reset_profile_successful_sequence() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();
    let config = BrowserHostConfig::default();
    let manager = BrowserHostManager::new(config, Some(tmp.path().to_path_buf()), cancel);

    let profile = ManagedProfile::new(tmp.path(), "user_clean_reset", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    // Place synthetic credentials in user-data/
    let cred_file = profile.user_data_dir().join("Web Data");
    fs::write(&cred_file, b"saved passwords and autofill").unwrap();
    assert!(cred_file.exists());

    // Initial state: epoch 1
    assert_eq!(profile.load_or_init_metadata().unwrap().profile_epoch, 1);

    // Perform confirmed reset with expected_epoch = 1
    let outcome = manager
        .reset_profile("user_clean_reset", false, "op-clean-1", 1)
        .await
        .expect("reset should succeed");

    assert_eq!(
        outcome,
        ResetOutcome::Completed {
            operation_id: "op-clean-1".to_string(),
            new_profile_epoch: 2,
        }
    );

    // 1. user-data/ credential file is DELETED
    assert!(!cred_file.exists(), "old user-data files must be deleted");

    // 2. empty user-data/ directory is recreated with 0700 permissions
    assert!(profile.user_data_dir().is_dir());
    assert_eq!(fs::read_dir(profile.user_data_dir()).unwrap().count(), 0);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(profile.user_data_dir()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
    }

    // 3. manager.lock and manager.json are NEVER deleted by credential wipe
    assert!(profile.lock_file().exists(), "manager.lock must survive credential wipe");
    assert!(profile.metadata_file().exists(), "manager.json must survive credential wipe");

    // 4. profile epoch is updated to 2
    let updated_meta = profile.load_or_init_metadata().unwrap();
    assert_eq!(updated_meta.profile_epoch, 2);

    // 5. reset tombstone is cleared
    assert!(profile.load_tombstone().unwrap().is_none());
    assert!(!profile.reset_file().exists());

    // 6. Idempotent retry with same operation_id returns Completed
    let retry = manager
        .reset_profile("user_clean_reset", false, "op-clean-1", 2)
        .await
        .unwrap();
    assert_eq!(
        retry,
        ResetOutcome::Completed {
            operation_id: "op-clean-1".to_string(),
            new_profile_epoch: 2,
        }
    );
}

#[tokio::test]
async fn test_browser_lifecycle_reconnect_and_stop() {
    let exec = match resolve_test_executable() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();

    let mut config = BrowserHostConfig::default();
    config.enabled = true;
    config.executable_path = Some(exec);
    config.budgets = BrowserBudgetsConfig {
        max_processes: 2,
        ..BrowserBudgetsConfig::default()
    };

    let manager = BrowserHostManager::new(config, Some(tmp.path().to_path_buf()), cancel);

    // 1. Initial launch
    let handle1 = manager.ensure_running("user_live", false).await.expect("initial launch failed");
    assert!(handle1.pid > 0);
    assert!(!handle1.browser_incarnation.is_empty());
    assert_eq!(handle1.profile_epoch, 1);

    // 2. Reconnect reuses the live managed instance!
    let handle2 = manager.ensure_running("user_live", false).await.expect("reconnect failed");
    assert_eq!(handle2.pid, handle1.pid, "reconnect must reuse the same PID");
    assert_eq!(handle2.browser_incarnation, handle1.browser_incarnation, "reconnect must reuse same incarnation");

    // Place a cookie file in user-data to verify stop preserves it
    let test_cookie = handle1.user_data_dir.join("test_cookie.txt");
    fs::write(&test_cookie, b"persisted_cookie").unwrap();

    // 3. Stop instance
    manager.stop_instance("user_live", false).await.expect("stop failed");

    // 4. Verification: cookies and storage are preserved after logical close!
    assert!(test_cookie.exists(), "cookies and storage must be preserved after stop");
    let content = fs::read(&test_cookie).unwrap();
    assert_eq!(content, b"persisted_cookie");
}

#[tokio::test]
async fn test_reset_profile_while_browser_running() {
    let exec = match resolve_test_executable() {
        Some(p) => p,
        None => {
            eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
            return;
        }
    };

    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();

    let mut config = BrowserHostConfig::default();
    config.enabled = true;
    config.executable_path = Some(exec);

    let manager = BrowserHostManager::new(config, Some(tmp.path().to_path_buf()), cancel);

    // 1. Launch browser - instance is Running and holds exclusive lock
    let handle = manager.ensure_running("user_active_reset", false).await.expect("launch failed");
    assert!(handle.pid > 0);

    // Place test file in user-data
    let test_file = handle.user_data_dir.join("live_session.txt");
    fs::write(&test_file, b"live_data").unwrap();
    assert!(test_file.exists());

    // 2. Reset while running must NOT self-deadlock!
    let outcome = manager
        .reset_profile("user_active_reset", false, "op-active-reset-1", 1)
        .await
        .expect("reset while running should succeed without deadlock");

    assert_eq!(
        outcome,
        ResetOutcome::Completed {
            operation_id: "op-active-reset-1".to_string(),
            new_profile_epoch: 2,
        }
    );

    // 3. User data was deleted and process terminated
    assert!(!test_file.exists());
}
