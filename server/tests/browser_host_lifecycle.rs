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
    for candidate in &[
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ] {
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
    let prod_dir_name = profile_prod
        .principal_dir()
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(prod_dir_name.len(), 64); // SHA-256 hex length
    assert!(prod_dir_name.chars().all(|c| c.is_ascii_hexdigit()));

    // 3. Restricted layout: lock, metadata, reset tombstone are OUTSIDE user-data/
    assert_eq!(
        profile_prod.lock_file().parent(),
        Some(profile_prod.principal_dir())
    );
    assert_eq!(
        profile_prod.metadata_file().parent(),
        Some(profile_prod.principal_dir())
    );
    assert_eq!(
        profile_prod.reset_file().parent(),
        Some(profile_prod.principal_dir())
    );
    assert_eq!(
        profile_prod.user_data_dir().parent(),
        Some(profile_prod.principal_dir())
    );

    // 4. Directory creation and 0700 permissions
    profile_prod.ensure_user_data_dir().unwrap();
    assert!(profile_prod.principal_dir().is_dir());
    assert!(profile_prod.user_data_dir().is_dir());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode_p = fs::metadata(profile_prod.principal_dir())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode_p & 0o777, 0o700);
        let mode_u = fs::metadata(profile_prod.user_data_dir())
            .unwrap()
            .permissions()
            .mode();
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
    let lock3 = profile_prod
        .try_lock()
        .expect("subsequent lock should succeed");
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
    assert_eq!(
        reloaded.browser_incarnation.as_deref(),
        Some("inc-uuid-1234")
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(profile.metadata_file())
            .unwrap()
            .permissions()
            .mode();
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
        containment: Default::default(),
    };

    profile.save_tombstone(&tombstone).unwrap();
    assert!(profile.reset_file().is_file());

    let loaded = profile
        .load_tombstone()
        .unwrap()
        .expect("tombstone should exist");
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

    let manager = BrowserHostManager::new(
        config.clone(),
        Some(tmp.path().to_path_buf()),
        cancel.clone(),
    );
    let caps = manager.capabilities("user1", false).await;
    assert_eq!(caps.protocol_version, BROWSER_PROTOCOL_VERSION);
    assert!(!caps.available);
    assert_eq!(
        caps.unavailable_reason.as_deref(),
        Some("browser host disabled in configuration")
    );

    // If enabled but executable missing
    config.enabled = true;
    config.executable_path = Some(PathBuf::from("/nonexistent/browser/binary"));
    let manager2 = BrowserHostManager::new(
        config.clone(),
        Some(tmp.path().to_path_buf()),
        cancel.clone(),
    );
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
        containment: Default::default(),
    };
    profile.save_tombstone(&tombstone).unwrap();

    let caps3 = manager2.capabilities("user2", false).await;
    assert!(!caps3.available);
    assert!(caps3
        .unavailable_reason
        .unwrap()
        .contains("cleanup pending"));
}

#[tokio::test]
async fn test_reset_profile_stale_epoch_rejected() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();
    let config = BrowserHostConfig::default();
    let manager = BrowserHostManager::new(config, Some(tmp.path().to_path_buf()), cancel);

    // Initial epoch is 1. Calling reset with expected_epoch = 99 must fail with StaleEpoch
    let res = manager.reset_profile("user_stale", false, "op-1", 99).await;
    assert!(matches!(
        res,
        Err(ManagerError::StaleEpoch {
            expected: 99,
            actual: 1
        })
    ));

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
    let manager = BrowserHostManager::new(
        config.clone(),
        Some(tmp.path().to_path_buf()),
        cancel.clone(),
    );

    let profile = ManagedProfile::new(tmp.path(), "user_fail_kill", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    // Place synthetic cookies / credentials in user-data
    let cookie_file = profile.user_data_dir().join("Cookies");
    fs::write(&cookie_file, b"secret_session_cookies").unwrap();
    assert!(cookie_file.exists());

    // Inject simulated kill failure
    manager
        ._simulated_reset_kill_failure
        .store(true, Ordering::SeqCst);

    let res = manager
        .reset_profile("user_fail_kill", false, "op-kill-fail", 1)
        .await
        .unwrap();
    assert!(matches!(res, ResetOutcome::CleanupPending { .. }));

    // Acceptance check 1: Reset NEVER deletes live user-data when process termination fails!
    assert!(
        cookie_file.exists(),
        "live user-data must NOT be deleted on kill failure"
    );

    // Acceptance check 2: reset.json tombstone persists with failure details
    let tombstone = profile
        .load_tombstone()
        .unwrap()
        .expect("tombstone must persist");
    assert_eq!(tombstone.operation_id, "op-kill-fail");
    assert_eq!(tombstone.stage, ResetStage::Failed);
    assert_eq!(tombstone.target_profile_epoch, 2);

    // Acceptance check 3: Simulated kill failure persists cleanupPending across manager restart!
    let mut active_config = config;
    active_config.enabled = true;
    let restarted_manager =
        BrowserHostManager::new(active_config, Some(tmp.path().to_path_buf()), cancel);
    let caps = restarted_manager
        .capabilities("user_fail_kill", false)
        .await;
    assert!(!caps.available);
    assert!(caps.unavailable_reason.unwrap().contains("cleanup pending"));

    // Relaunching while cleanupPending must fail closed
    let launch_res = restarted_manager
        .ensure_running("user_fail_kill", false)
        .await;
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
    let manager = BrowserHostManager::new(
        config.clone(),
        Some(tmp.path().to_path_buf()),
        cancel.clone(),
    );

    let profile = ManagedProfile::new(tmp.path(), "user_fail_del", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    let dummy_file = profile.user_data_dir().join("dummy.dat");
    fs::write(&dummy_file, b"data").unwrap();

    // Inject simulated delete failure
    manager
        ._simulated_reset_delete_failure
        .store(true, Ordering::SeqCst);

    let res = manager
        .reset_profile("user_fail_del", false, "op-del-fail", 1)
        .await
        .unwrap();
    assert!(matches!(res, ResetOutcome::CleanupPending { .. }));

    // Tombstone persists across restart
    let tombstone = profile
        .load_tombstone()
        .unwrap()
        .expect("tombstone must exist");
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
        let mode = fs::metadata(profile.user_data_dir())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700);
    }

    // 3. manager.lock and manager.json are NEVER deleted by credential wipe
    assert!(
        profile.lock_file().exists(),
        "manager.lock must survive credential wipe"
    );
    assert!(
        profile.metadata_file().exists(),
        "manager.json must survive credential wipe"
    );

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
    let handle1 = manager
        .ensure_running("user_live", false)
        .await
        .expect("initial launch failed");
    assert!(handle1.pid > 0);
    assert!(!handle1.browser_incarnation.is_empty());
    assert_eq!(handle1.profile_epoch, 1);

    // 2. Reconnect reuses the live managed instance!
    let handle2 = manager
        .ensure_running("user_live", false)
        .await
        .expect("reconnect failed");
    assert_eq!(
        handle2.pid, handle1.pid,
        "reconnect must reuse the same PID"
    );
    assert_eq!(
        handle2.browser_incarnation, handle1.browser_incarnation,
        "reconnect must reuse same incarnation"
    );

    // Place a cookie file in user-data to verify stop preserves it
    let test_cookie = handle1.user_data_dir.join("test_cookie.txt");
    fs::write(&test_cookie, b"persisted_cookie").unwrap();

    // 3. Stop instance
    manager
        .stop_instance("user_live", false)
        .await
        .expect("stop failed");

    // 4. Verification: cookies and storage are preserved after logical close!
    assert!(
        test_cookie.exists(),
        "cookies and storage must be preserved after stop"
    );
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
    let handle = manager
        .ensure_running("user_active_reset", false)
        .await
        .expect("launch failed");
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

fn running_request() -> dam_hopper_server::browser_host::session::CreateSessionRequest {
    dam_hopper_server::browser_host::session::CreateSessionRequest {
        creation_key: uuid::Uuid::new_v4().to_string(),
        url: "about:blank".to_string(),
        viewport: dam_hopper_server::browser_host::session::ViewportRequest {
            width: 1280,
            height: 900,
            dpr: 1.0,
        },
    }
}

/// Stopping the instance and resetting the profile retire exactly the sessions of the ended
/// incarnation (`lost`, slot released) and leave sibling principals' sessions untouched; the
/// startup page is closed by the manager-owned observer.
#[tokio::test]
async fn test_stop_and_reset_retire_only_the_ended_incarnation_sessions() {
    let Some(exec) = resolve_test_executable() else {
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };
    let registry = dam_hopper_server::api::browser_host::global_session_registry();
    let tmp = tempdir().unwrap();
    let mut config = BrowserHostConfig::default();
    config.enabled = true;
    config.executable_path = Some(exec);
    let manager = BrowserHostManager::new(
        config,
        Some(tmp.path().to_path_buf()),
        CancellationToken::new(),
    );

    let handle = manager
        .ensure_running("lifecycle-owner", false)
        .await
        .expect("launch");
    let control = manager
        .native_control("lifecycle-owner", false)
        .await
        .expect("control");
    let started = std::time::Instant::now();
    loop {
        let pages = control.list_pages().await.expect("list pages");
        if pages.iter().all(|p| p.target_type != "page") {
            break;
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "startup page must be closed: {pages:?}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let (owned, _) = registry
        .insert_running_for_test(
            "lifecycle-owner",
            false,
            &handle.browser_incarnation,
            handle.profile_epoch,
            &running_request(),
            &[],
        )
        .await
        .unwrap();
    let (sibling, _) = registry
        .insert_running_for_test(
            "lifecycle-sibling",
            false,
            "another-incarnation",
            1,
            &running_request(),
            &[],
        )
        .await
        .unwrap();

    manager
        .stop_instance("lifecycle-owner", false)
        .await
        .expect("stop");
    let lost = registry
        .get_session(&owned.browser_session_id, "lifecycle-owner")
        .await
        .unwrap();
    assert_eq!(
        lost.status, "lost",
        "stopped incarnation's session must be exposed as lost"
    );
    let sibling_after = registry
        .get_session(&sibling.browser_session_id, "lifecycle-sibling")
        .await
        .unwrap();
    assert_eq!(
        sibling_after.status, "running",
        "sibling identity untouched"
    );

    // A new incarnation, then a reset: its session is lost too, the sibling still untouched.
    let handle2 = manager
        .ensure_running("lifecycle-owner", false)
        .await
        .expect("relaunch");
    assert_ne!(handle2.browser_incarnation, handle.browser_incarnation);
    let (second, _) = registry
        .insert_running_for_test(
            "lifecycle-owner",
            false,
            &handle2.browser_incarnation,
            handle2.profile_epoch,
            &running_request(),
            &[],
        )
        .await
        .unwrap();
    manager
        .reset_profile(
            "lifecycle-owner",
            false,
            "op-retire-1",
            handle2.profile_epoch,
        )
        .await
        .expect("reset");
    let after_reset = registry
        .get_session(&second.browser_session_id, "lifecycle-owner")
        .await
        .unwrap();
    assert_eq!(after_reset.status, "lost");
    let sibling_after = registry
        .get_session(&sibling.browser_session_id, "lifecycle-sibling")
        .await
        .unwrap();
    assert_eq!(sibling_after.status, "running");
}

/// A worker that cannot be policed or stopped hands the whole incarnation to the manager: the
/// verified process tree is terminated, every session of that incarnation is retired together
/// (sibling principals untouched), the obligation is idempotent, and the principal can launch a
/// fresh incarnation afterwards. The obligation is independent of any producer: nothing but
/// the manager is involved here.
#[tokio::test]
async fn test_contain_incarnation_terminates_tree_and_retires_all_its_sessions() {
    use dam_hopper_server::browser_host::process::live_members;
    let Some(exec) = resolve_test_executable() else {
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };
    let registry = dam_hopper_server::api::browser_host::global_session_registry();
    let tmp = tempdir().unwrap();
    let config = BrowserHostConfig {
        enabled: true,
        executable_path: Some(exec),
        ..Default::default()
    };
    let manager = BrowserHostManager::new(
        config,
        Some(tmp.path().to_path_buf()),
        CancellationToken::new(),
    );

    let handle = manager
        .ensure_running("contain-owner", false)
        .await
        .expect("launch");
    let pgid = handle.pid as i32;
    assert!(live_members(pgid).unwrap() > 0);
    let mut owned = Vec::new();
    for _ in 0..2 {
        let (session, _) = registry
            .insert_running_for_test(
                "contain-owner",
                false,
                &handle.browser_incarnation,
                handle.profile_epoch,
                &running_request(),
                &[],
            )
            .await
            .unwrap();
        owned.push(session.browser_session_id);
    }
    let (sibling, _) = registry
        .insert_running_for_test(
            "contain-sibling",
            false,
            "another-incarnation",
            1,
            &running_request(),
            &[],
        )
        .await
        .unwrap();

    // Raised twice (two producers saw the same survivor): one obligation.
    for _ in 0..2 {
        manager.contain_incarnation(
            "contain-owner",
            false,
            &handle.browser_incarnation,
            "unpoliced worker survived",
        );
    }
    let started = std::time::Instant::now();
    while live_members(pgid).unwrap() > 0 {
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "the browser tree survived containment"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    for id in &owned {
        let started = std::time::Instant::now();
        loop {
            let session = registry.get_session(id, "contain-owner").await.unwrap();
            if session.status == "lost" {
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "every session of the contained incarnation is retired together"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    assert_eq!(
        registry
            .get_session(&sibling.browser_session_id, "contain-sibling")
            .await
            .unwrap()
            .status,
        "running",
        "a sibling principal is untouched"
    );

    let next = manager
        .ensure_running("contain-owner", false)
        .await
        .expect("a fresh incarnation launches after containment");
    assert_ne!(next.browser_incarnation, handle.browser_incarnation);

    // A late obligation for the ended incarnation must not touch the new one.
    manager.contain_incarnation(
        "contain-owner",
        false,
        &handle.browser_incarnation,
        "late duplicate",
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(live_members(next.pid as i32).unwrap() > 0);
    manager.shutdown_all().await;
    assert_eq!(live_members(next.pid as i32).unwrap(), 0);
}

/// Shutdown joins an in-flight containment instead of racing it: afterwards nothing runs.
#[tokio::test]
async fn test_shutdown_joins_an_in_flight_containment() {
    use dam_hopper_server::browser_host::process::live_members;
    let Some(exec) = resolve_test_executable() else {
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };
    let tmp = tempdir().unwrap();
    let config = BrowserHostConfig {
        enabled: true,
        executable_path: Some(exec),
        ..Default::default()
    };
    let manager = BrowserHostManager::new(
        config,
        Some(tmp.path().to_path_buf()),
        CancellationToken::new(),
    );
    let handle = manager
        .ensure_running("contain-shutdown", false)
        .await
        .expect("launch");
    manager.contain_incarnation(
        "contain-shutdown",
        false,
        &handle.browser_incarnation,
        "shutdown race",
    );
    manager.shutdown_all().await;
    assert_eq!(live_members(handle.pid as i32).unwrap(), 0);
}

// ---------------------------------------------------------------------------------------------
// Persist/reset recovery (L6, L7, L10): durable ordering, completed-marker recovery and prior
// browser tree reconciliation, driven through the production manager with injected faults.
// ---------------------------------------------------------------------------------------------

use std::path::Path;
use std::time::Duration;

use dam_hopper_server::browser_host::manager::ResetStatus;
use dam_hopper_server::browser_host::profile::{FaultStep, FaultTarget};

const DUR_USER: &str = "user_durable";

fn dur_manager(root: &Path) -> BrowserHostManager {
    let config = BrowserHostConfig {
        enabled: true,
        ..Default::default()
    };
    BrowserHostManager::new(config, Some(root.to_path_buf()), CancellationToken::new())
}

/// New manager on the same profile root; the old one (and its retained lock) is dropped first.
fn dur_restart(old: BrowserHostManager, root: &Path) -> BrowserHostManager {
    drop(old);
    dur_manager(root)
}

fn dur_seed(root: &Path) -> (ManagedProfile, PathBuf) {
    let profile = ManagedProfile::new(root, DUR_USER, false).unwrap();
    profile.ensure_user_data_dir().unwrap();
    profile.load_or_init_metadata().unwrap();
    let cred = profile.user_data_dir().join("Login Data");
    fs::write(&cred, b"saved_login_records").unwrap();
    (profile, cred)
}

fn dur_no_temp_files(profile: &ManagedProfile) -> bool {
    fs::read_dir(profile.principal_dir())
        .unwrap()
        .filter_map(Result::ok)
        .all(|e| !e.file_name().to_string_lossy().contains(".tmp."))
}

/// After recovery the browser must be startable again: no CleanupPending/Resetting refusal.
async fn dur_assert_can_restart(manager: &BrowserHostManager) {
    let res = manager.ensure_running(DUR_USER, false).await;
    assert!(
        !matches!(res, Err(ManagerError::CleanupPending(_))),
        "browser must be restartable after recovery, got {res:?}"
    );
}

#[tokio::test]
async fn test_reset_intent_durability_failures_are_never_accepted_and_recover_once() {
    let cases = [
        (FaultTarget::Tombstone, FaultStep::FileSync),
        (FaultTarget::Tombstone, FaultStep::Rename),
        (FaultTarget::Tombstone, FaultStep::DirSync),
        (FaultTarget::Metadata, FaultStep::FileSync),
        (FaultTarget::Metadata, FaultStep::Rename),
        (FaultTarget::Metadata, FaultStep::DirSync),
    ];
    for (target, step) in cases {
        let label = format!("{target:?}/{step:?}");
        let tmp = tempdir().unwrap();
        let (profile, cred) = dur_seed(tmp.path());
        let manager = dur_manager(tmp.path());

        manager.profile_faults.fail(target, step, 0, 1);
        let res = manager.reset_profile(DUR_USER, false, "op-intent", 1).await;
        assert!(
            matches!(res, Err(ManagerError::Profile(ProfileError::Io(_)))),
            "{label}: unsynced intent must not be accepted, got {res:?}"
        );
        assert!(
            cred.exists(),
            "{label}: credentials untouched before durable intent"
        );
        assert!(
            dur_no_temp_files(&profile),
            "{label}: no temp file may be left behind"
        );
        let epoch_after_failure = profile.load_or_init_metadata().unwrap().profile_epoch;
        assert!(
            epoch_after_failure <= 2,
            "{label}: epoch advanced at most once"
        );
        if profile.load_tombstone().unwrap().is_some() {
            // A visible but unconfirmed intent is the fence: the browser cannot start.
            let started = manager.ensure_running(DUR_USER, false).await;
            assert!(
                matches!(started, Err(ManagerError::CleanupPending(_))),
                "{label}: surviving tombstone must block launch, got {started:?}"
            );
        }

        // Restart and retry the same operation: it completes with the epoch advanced once.
        let manager = dur_restart(manager, tmp.path());
        let out = manager
            .reset_profile(DUR_USER, false, "op-intent", 1)
            .await
            .unwrap_or_else(|e| panic!("{label}: retry failed: {e}"));
        assert_eq!(
            out,
            ResetOutcome::Completed {
                operation_id: "op-intent".to_string(),
                new_profile_epoch: 2,
            },
            "{label}"
        );
        assert!(!cred.exists(), "{label}: credentials wiped after recovery");
        assert_eq!(
            profile.load_or_init_metadata().unwrap().profile_epoch,
            2,
            "{label}"
        );
        assert!(profile.load_tombstone().unwrap().is_none(), "{label}");
        assert!(dur_no_temp_files(&profile), "{label}");
        dur_assert_can_restart(&manager).await;
    }
}

#[tokio::test]
async fn test_reset_boundary_failures_never_report_cleared_and_recover_once() {
    // (target, step, occurrences to let pass, credentials must survive the failure).
    // Tombstone writes in order: 0 intent, 1 Terminating, 2 DeletingUserData, 3
    // RecreatingUserData; tombstone dir syncs: same order, then 4 = unlink. Metadata writes:
    // 0 epoch commit, 1 completion marker. User-data dir syncs: 0 delete, 1 recreate.
    let cases = [
        (FaultTarget::Tombstone, FaultStep::FileSync, 1, true),
        (FaultTarget::Tombstone, FaultStep::Rename, 2, true),
        (FaultTarget::Tombstone, FaultStep::DirSync, 2, true),
        (FaultTarget::UserData, FaultStep::Delete, 0, true),
        (FaultTarget::UserData, FaultStep::DirSync, 0, false),
        (FaultTarget::Tombstone, FaultStep::FileSync, 3, false),
        (FaultTarget::UserData, FaultStep::Recreate, 0, false),
        (FaultTarget::UserData, FaultStep::DirSync, 1, false),
        (FaultTarget::Metadata, FaultStep::FileSync, 1, false),
        (FaultTarget::Metadata, FaultStep::Rename, 1, false),
        (FaultTarget::Metadata, FaultStep::DirSync, 1, false),
        (FaultTarget::Tombstone, FaultStep::Unlink, 0, false),
        (FaultTarget::Tombstone, FaultStep::DirSync, 4, false),
    ];
    for restart_before_retry in [false, true] {
        for (target, step, skip, creds_survive) in cases {
            let label = format!("{target:?}/{step:?}/skip{skip}/restart={restart_before_retry}");
            let tmp = tempdir().unwrap();
            let (profile, cred) = dur_seed(tmp.path());
            let mut manager = dur_manager(tmp.path());

            manager.profile_faults.fail(target, step, skip, 1);
            let out = manager
                .reset_profile(DUR_USER, false, "op-boundary", 1)
                .await
                .unwrap_or_else(|e| panic!("{label}: reset errored: {e}"));
            assert!(
                matches!(out, ResetOutcome::CleanupPending { .. }),
                "{label}: a failed durable step must never report cleared, got {out:?}"
            );
            if creds_survive {
                assert!(
                    cred.exists(),
                    "{label}: credentials deleted before durable ordering"
                );
            }
            assert_eq!(
                profile.load_or_init_metadata().unwrap().profile_epoch,
                2,
                "{label}: epoch advanced exactly once"
            );

            // GET agrees with POST: still pending, never completed.
            let status = manager
                .get_reset_status(DUR_USER, false, "op-boundary")
                .await
                .unwrap();
            assert!(
                matches!(status, ResetStatus::CleanupPending { .. }),
                "{label}: status must agree with POST, got {status:?}"
            );
            let started = manager.ensure_running(DUR_USER, false).await;
            assert!(
                matches!(started, Err(ManagerError::CleanupPending(_))),
                "{label}: no launch while cleanup is unconfirmed, got {started:?}"
            );

            if restart_before_retry {
                manager = dur_restart(manager, tmp.path());
            }
            let retry = manager
                .reset_profile(DUR_USER, false, "op-boundary", 2)
                .await
                .unwrap_or_else(|e| panic!("{label}: retry errored: {e}"));
            assert_eq!(
                retry,
                ResetOutcome::Completed {
                    operation_id: "op-boundary".to_string(),
                    new_profile_epoch: 2,
                },
                "{label}: same-operation retry completes without a second epoch bump"
            );
            assert!(!cred.exists(), "{label}");
            assert_eq!(
                profile.load_or_init_metadata().unwrap().profile_epoch,
                2,
                "{label}"
            );
            assert!(profile.load_tombstone().unwrap().is_none(), "{label}");
            assert!(dur_no_temp_files(&profile), "{label}");
            let status = manager
                .get_reset_status(DUR_USER, false, "op-boundary")
                .await
                .unwrap();
            assert!(
                matches!(
                    status,
                    ResetStatus::Completed {
                        profile_epoch: 2,
                        ..
                    }
                ),
                "{label}: status after recovery, got {status:?}"
            );
            dur_assert_can_restart(&manager).await;
        }
    }
}

#[tokio::test]
async fn test_completed_marker_with_surviving_tombstone_resumes_after_restart() {
    // Crash between the completion-marker commit and the tombstone unlink.
    let tmp = tempdir().unwrap();
    let (profile, cred) = dur_seed(tmp.path());
    fs::remove_file(&cred).unwrap();
    let mut meta = profile.load_or_init_metadata().unwrap();
    meta.profile_epoch = 2;
    meta.last_reset_operation_id = Some("op-crash".to_string());
    profile.save_metadata(&meta).unwrap();
    profile
        .save_tombstone(&ResetTombstone {
            operation_id: "op-crash".to_string(),
            target_profile_epoch: 2,
            stage: ResetStage::RecreatingUserData,
            created_at_unix_ms: now_unix_ms(),
            updated_at_unix_ms: now_unix_ms(),
            error: None,
            containment: Default::default(),
        })
        .unwrap();

    let manager = dur_manager(tmp.path());
    let status = manager
        .get_reset_status(DUR_USER, false, "op-crash")
        .await
        .unwrap();
    assert!(
        matches!(
            status,
            ResetStatus::CleanupPending {
                profile_epoch: 2,
                ..
            }
        ),
        "{status:?}"
    );
    assert!(matches!(
        manager.ensure_running(DUR_USER, false).await,
        Err(ManagerError::CleanupPending(_))
    ));
    // A different operation stays blocked by the surviving tombstone.
    assert!(matches!(
        manager.reset_profile(DUR_USER, false, "op-other", 2).await,
        Err(ManagerError::CleanupPending(_))
    ));
    assert!(profile.load_tombstone().unwrap().is_some());

    // The completed marker alone is NOT sufficient: the same operation resumes and finishes.
    let out = manager
        .reset_profile(DUR_USER, false, "op-crash", 2)
        .await
        .unwrap();
    assert_eq!(
        out,
        ResetOutcome::Completed {
            operation_id: "op-crash".to_string(),
            new_profile_epoch: 2,
        }
    );
    assert!(profile.load_tombstone().unwrap().is_none());
    assert_eq!(profile.load_or_init_metadata().unwrap().profile_epoch, 2);
    let status = manager
        .get_reset_status(DUR_USER, false, "op-crash")
        .await
        .unwrap();
    assert!(
        matches!(
            status,
            ResetStatus::Completed {
                profile_epoch: 2,
                ..
            }
        ),
        "{status:?}"
    );
    dur_assert_can_restart(&manager).await;

    // Marker without tombstone stays an idempotent Completed.
    let again = manager
        .reset_profile(DUR_USER, false, "op-crash", 2)
        .await
        .unwrap();
    assert!(matches!(
        again,
        ResetOutcome::Completed {
            new_profile_epoch: 2,
            ..
        }
    ));
}

#[cfg(target_os = "linux")]
mod prior_tree {
    use super::*;
    use dam_hopper_server::browser_host::process::{
        live_members, ContainmentIdentity, LAUNCH_TOKEN_ENV,
    };
    use nix::sys::signal::{killpg, Signal};
    use nix::unistd::Pid;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    /// A real process tree: a shell leader of its own group plus two sleeping descendants.
    /// The leader is reaped by a background thread, so a dead tree leaves no zombie that a
    /// `kill -0` on the group would still see.
    pub struct FakeTree {
        pub pid: u32,
        pub pgid: i32,
        waiter: Option<std::thread::JoinHandle<()>>,
    }

    impl FakeTree {
        pub async fn spawn(token: Option<&str>) -> Self {
            let mut cmd = Command::new("sh");
            cmd.arg("-c")
                .arg("sleep 300 & sleep 300 & wait")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0);
            if let Some(token) = token {
                cmd.env(LAUNCH_TOKEN_ENV, token);
            }
            let mut child = cmd.spawn().expect("spawn fake tree");
            let pid = child.id();
            let waiter = std::thread::spawn(move || {
                let _ = child.wait();
            });
            let tree = Self {
                pid,
                pgid: pid as i32,
                waiter: Some(waiter),
            };
            for _ in 0..100 {
                if live_members(tree.pgid).unwrap() >= 3 {
                    return tree;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            panic!("fake tree did not start");
        }

        pub fn alive(&self) -> bool {
            live_members(self.pgid).unwrap() > 0
        }

        pub fn identity(&self, token: Option<&str>) -> ContainmentIdentity {
            ContainmentIdentity::capture(self.pid, Some(self.pgid), token.map(str::to_string))
        }

        pub fn kill(mut self) {
            let _ = killpg(Pid::from_raw(self.pgid), Signal::SIGKILL);
            if let Some(waiter) = self.waiter.take() {
                let _ = waiter.join();
            }
        }
    }

    /// Fake browser: records each launch, records whether the watched group was already gone,
    /// publishes a loopback DevToolsActivePort and stays alive.
    pub fn write_fake_browser(root: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let script = root.join("fake_browser.sh");
        let body = format!(
            r#"#!/bin/sh
ROOT='{root}'
echo launched >> "$ROOT/launches"
if [ -f "$ROOT/watch_pgid" ]; then
  OLD=$(cat "$ROOT/watch_pgid")
  if kill -s 0 -- "-$OLD" 2>/dev/null; then echo DIRTY > "$ROOT/verdict"; else echo CLEAN > "$ROOT/verdict"; fi
fi
for a in "$@"; do case "$a" in --user-data-dir=*) UD="${{a#--user-data-dir=}}";; esac; done
printf '1\n/devtools/browser/e90e79e7-5782-4281-b83a-1dc27f852305\n' > "$UD/DevToolsActivePort"
exec sleep 300
"#,
            root = root.display()
        );
        fs::write(&script, body).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    pub fn manager_with_exec(root: &Path, exec: &Path, settle_ms: u64) -> BrowserHostManager {
        let config = BrowserHostConfig {
            enabled: true,
            executable_path: Some(exec.to_path_buf()),
            ..Default::default()
        };
        let manager =
            BrowserHostManager::new(config, Some(root.to_path_buf()), CancellationToken::new());
        manager
            ._prior_tree_settle_ms
            .store(settle_ms, Ordering::SeqCst);
        manager
    }

    pub fn persist_identity(profile: &ManagedProfile, identity: ContainmentIdentity) {
        let mut meta = profile.load_or_init_metadata().unwrap();
        meta.containment = identity;
        profile.save_metadata(&meta).unwrap();
    }

    pub fn launches(root: &Path) -> usize {
        fs::read_to_string(root.join("launches"))
            .map(|s| s.lines().count())
            .unwrap_or(0)
    }
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn test_restart_relaunches_only_after_verified_prior_tree_is_proven_absent() {
    use prior_tree::*;
    let tmp = tempdir().unwrap();
    let work = tempdir().unwrap();
    let (profile, _cred) = dur_seed(tmp.path());
    let exec = write_fake_browser(work.path());

    let token = uuid_token("owned");
    let tree = FakeTree::spawn(Some(&token)).await;
    persist_identity(&profile, tree.identity(Some(&token)));
    fs::write(work.path().join("watch_pgid"), tree.pgid.to_string()).unwrap();

    let manager = manager_with_exec(tmp.path(), &exec, 200);
    // The fake browser has no CDP endpoint, so the launch itself fails after the prior tree was
    // handled; what matters is the order.
    let res = manager.ensure_running(DUR_USER, false).await;
    assert!(
        !matches!(res, Err(ManagerError::CleanupPending(_))),
        "a verified-owned prior tree is terminated, not an ambiguity: {res:?}"
    );
    assert!(!tree.alive(), "verified prior tree must be gone");
    assert_eq!(
        launches(work.path()),
        1,
        "launched exactly once, after the proof"
    );
    assert_eq!(
        fs::read_to_string(work.path().join("verdict"))
            .unwrap()
            .trim(),
        "CLEAN",
        "the replacement must never start while the old tree is alive"
    );
    // The new launch's identity was persisted before it was used.
    let meta = profile.load_or_init_metadata().unwrap();
    assert!(meta.containment.pid.is_some() && meta.containment.pgid.is_some());
    assert!(meta.containment.start_ticks.is_some() && meta.containment.boot_id.is_some());
    assert!(meta.containment.launch_token.is_some());
    assert_ne!(
        meta.containment.launch_token.as_deref(),
        Some(token.as_str())
    );
    tree.kill();
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn test_restart_with_unverifiable_prior_tree_is_cleanup_pending_and_never_signals() {
    use dam_hopper_server::browser_host::process::ContainmentIdentity;
    use prior_tree::*;
    let tmp = tempdir().unwrap();
    let work = tempdir().unwrap();
    let (profile, cred) = dur_seed(tmp.path());
    let exec = write_fake_browser(work.path());

    // Legacy identity: bare pid/pgid, no start time, token or boot id. A live group answers to
    // that number, but nothing proves it is the prior browser.
    let tree = FakeTree::spawn(None).await;
    let legacy = ContainmentIdentity {
        pid: Some(tree.pid),
        pgid: Some(tree.pgid),
        ..Default::default()
    };
    persist_identity(&profile, legacy.clone());

    let manager = manager_with_exec(tmp.path(), &exec, 200);
    let res = manager.ensure_running(DUR_USER, false).await;
    assert!(
        matches!(res, Err(ManagerError::CleanupPending(_))),
        "{res:?}"
    );
    assert_eq!(launches(work.path()), 0, "no launch on ambiguous ownership");
    assert!(tree.alive(), "an unverified group must never be signalled");
    assert_eq!(profile.load_or_init_metadata().unwrap().containment, legacy);

    // Reset must not delete credentials under an unproven tree either.
    let out = manager
        .reset_profile(DUR_USER, false, "op-amb", 1)
        .await
        .unwrap();
    assert!(
        matches!(out, ResetOutcome::CleanupPending { .. }),
        "{out:?}"
    );
    assert!(
        cred.exists(),
        "credentials must survive an unproven prior tree"
    );
    assert!(tree.alive());

    // Once the group is really gone the same operation completes.
    tree.kill();
    let out = manager
        .reset_profile(DUR_USER, false, "op-amb", 2)
        .await
        .unwrap();
    assert!(
        matches!(
            out,
            ResetOutcome::Completed {
                new_profile_epoch: 2,
                ..
            }
        ),
        "{out:?}"
    );
    assert!(!cred.exists());
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn test_reused_pid_is_never_killed_and_does_not_block_restart() {
    use prior_tree::*;
    let tmp = tempdir().unwrap();
    let work = tempdir().unwrap();
    let (profile, _cred) = dur_seed(tmp.path());
    let exec = write_fake_browser(work.path());

    // The recorded pid now belongs to an unrelated live group with a different start time.
    let tree = FakeTree::spawn(None).await;
    let mut stale = tree.identity(None);
    stale.start_ticks = stale.start_ticks.map(|t| t + 1_000_000);
    persist_identity(&profile, stale);

    let manager = manager_with_exec(tmp.path(), &exec, 200);
    let res = manager.ensure_running(DUR_USER, false).await;
    assert!(
        !matches!(res, Err(ManagerError::CleanupPending(_))),
        "{res:?}"
    );
    assert_eq!(
        launches(work.path()),
        1,
        "a reused pid proves the old tree absent"
    );
    assert!(tree.alive(), "an unrelated process must never be signalled");
    tree.kill();
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn test_reset_after_crash_terminates_verified_prior_tree_before_credential_deletion() {
    use prior_tree::*;
    let tmp = tempdir().unwrap();
    let work = tempdir().unwrap();
    let (profile, cred) = dur_seed(tmp.path());
    let exec = write_fake_browser(work.path());

    let token = uuid_token("reset");
    let tree = FakeTree::spawn(Some(&token)).await;
    persist_identity(&profile, tree.identity(Some(&token)));

    let manager = manager_with_exec(tmp.path(), &exec, 200);
    let out = manager
        .reset_profile(DUR_USER, false, "op-live", 1)
        .await
        .unwrap();
    assert!(
        matches!(
            out,
            ResetOutcome::Completed {
                new_profile_epoch: 2,
                ..
            }
        ),
        "{out:?}"
    );
    assert!(
        !tree.alive(),
        "every descendant must be absent before credentials are deleted"
    );
    assert!(!cred.exists());
    assert!(profile
        .load_or_init_metadata()
        .unwrap()
        .containment
        .is_empty());
    tree.kill();
}

#[cfg(target_os = "linux")]
fn uuid_token(label: &str) -> String {
    format!("{label}-{}", now_unix_ms())
}

/// Metadata initialization is a write, so it only happens under the profile flock: capability
/// probing and instance lookup of a never-initialized profile are read-only, an initializer
/// without the lock is refused, and a delayed initializer can never replace the launch
/// identity another holder persisted.
#[tokio::test]
async fn test_first_use_metadata_initialization_happens_only_under_the_flock() {
    use dam_hopper_server::browser_host::process::ContainmentIdentity;

    let tmp = tempdir().unwrap();
    let manager_a = dur_manager(tmp.path());
    let manager_b = dur_manager(tmp.path());
    let profile = ManagedProfile::new(tmp.path(), "first_use", false).unwrap();

    let _ = manager_a.capabilities("first_use", false).await;
    let _ = manager_b.capabilities("first_use", false).await;
    manager_a.stop_instance("first_use", false).await.unwrap();
    assert!(
        !profile.metadata_file().exists(),
        "capability probing and instance lookup must not write metadata"
    );

    // Holder A owns the flock and persists its launch intent.
    let lock = profile.try_lock().unwrap();
    let racer = ManagedProfile::new(tmp.path(), "first_use", false).unwrap();
    assert!(matches!(
        racer.load_or_init_metadata(),
        Err(ProfileError::LockBusy(_))
    ));
    assert!(
        !profile.metadata_file().exists(),
        "an initializer without the lock must not write defaults"
    );
    let mut meta = profile.load_or_init_metadata_locked(&lock).unwrap();
    meta.profile_epoch = 7;
    meta.containment = ContainmentIdentity::launch_intent("launch-token-a".to_string());
    profile.save_metadata(&meta).unwrap();

    let other = ManagedProfile::new(tmp.path(), "someone_else", false).unwrap();
    assert!(
        other.load_or_init_metadata_locked(&lock).is_err(),
        "a lock of another profile is no proof of ownership"
    );
    assert_eq!(
        racer.load_or_init_metadata().unwrap().containment,
        meta.containment,
        "the persisted launch identity is returned, never overwritten"
    );
    drop(lock);
    assert_eq!(profile.load_or_init_metadata().unwrap().profile_epoch, 7);
}

/// Racing first-use initializers (some retrying on a busy lock) converge on the one record a
/// lock holder persisted; none of them can restore the defaults over it.
#[test]
fn test_concurrent_first_use_initializers_never_overwrite_persisted_identity() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(9));
    let mut handles = Vec::new();
    for _ in 0..8 {
        let root = root.clone();
        let barrier = barrier.clone();
        handles.push(std::thread::spawn(move || {
            let profile = ManagedProfile::new(&root, "racing", false).unwrap();
            barrier.wait();
            loop {
                match profile.load_or_init_metadata() {
                    Ok(meta) => return meta.profile_epoch,
                    Err(ProfileError::LockBusy(_)) => std::thread::yield_now(),
                    Err(err) => panic!("unexpected initializer error: {err}"),
                }
            }
        }));
    }
    let holder = ManagedProfile::new(&root, "racing", false).unwrap();
    barrier.wait();
    let lock = loop {
        match holder.try_lock() {
            Ok(lock) => break lock,
            Err(ProfileError::LockBusy(_)) => std::thread::yield_now(),
            Err(err) => panic!("unexpected lock error: {err}"),
        }
    };
    let mut meta = holder.load_or_init_metadata_locked(&lock).unwrap();
    meta.profile_epoch = 5;
    holder.save_metadata(&meta).unwrap();
    drop(lock);

    for handle in handles {
        let seen = handle.join().unwrap();
        assert!(seen == 1 || seen == 5, "unexpected epoch {seen}");
    }
    assert_eq!(holder.load_or_init_metadata().unwrap().profile_epoch, 5);
}
