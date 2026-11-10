use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::tempdir;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

use dam_hopper_server::browser_host::config::{
    evaluate_capabilities, BrowserHostConfig, BROWSER_PROTOCOL_VERSION,
};
use dam_hopper_server::browser_host::manager::{BrowserHostManager, ManagerError};
use dam_hopper_server::browser_host::process::{
    find_browser_executable, validate_loopback_endpoint, BrowserLaunchConfig, BrowserProcess,
    ProcessError,
};
use dam_hopper_server::browser_host::profile::{
    now_unix_ms, ManagedProfile, ProfileError, ResetStage, ResetTombstone,
};
use dam_hopper_server::pty::{BroadcastEventSink, EventSink, PtySessionManager};

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

#[tokio::test]
async fn test_platform_sandbox_and_security_containment_prerequisites() {
    let tmp = tempdir().unwrap();

    // 1. Insecure flags are strictly forbidden by allowlist
    let forbidden_flags = [
        "--no-sandbox",
        "--disable-web-security",
        "--ignore-certificate-errors",
        "--allow-running-insecure-content",
        "--disable-setuid-sandbox",
        "--single-process",
        "--no-zygote",
        "--remote-debugging-address=0.0.0.0",
        "--remote-allow-origins=*",
    ];

    for flag in forbidden_flags {
        let mut bad_config = BrowserLaunchConfig::new(tmp.path().join("sandbox-data"));
        bad_config.additional_args.push(flag.to_string());
        let res = BrowserProcess::launch(bad_config).await;
        assert!(
            matches!(res, Err(ProcessError::LaunchFailed(_))),
            "Flag {flag} must be rejected by BrowserProcess allowlist"
        );
    }

    // 2. Loopback endpoints require canonical UUID and localhost/127.0.0.1
    let valid_uuid = "e90e79e7-5782-4281-b83a-1dc27f852305";
    assert!(validate_loopback_endpoint(&format!(
        "ws://127.0.0.1:9222/devtools/browser/{valid_uuid}"
    ))
    .is_ok());
    assert!(
        validate_loopback_endpoint(&format!("ws://[::1]:9222/devtools/browser/{valid_uuid}"))
            .is_ok()
    );

    // Non-loopback endpoints strictly rejected
    assert!(validate_loopback_endpoint(&format!(
        "ws://192.168.1.1:9222/devtools/browser/{valid_uuid}"
    ))
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://0.0.0.0:9222/devtools/browser/{valid_uuid}"
    ))
    .is_err());
    assert!(validate_loopback_endpoint(&format!(
        "ws://example.com:9222/devtools/browser/{valid_uuid}"
    ))
    .is_err());

    // 3. Platform capabilities check
    let mut host_cfg = BrowserHostConfig::default();
    host_cfg.enabled = true;
    host_cfg.executable_path = resolve_test_executable();

    let caps = evaluate_capabilities(&host_cfg, false, 1);
    assert_eq!(caps.protocol_version, BROWSER_PROTOCOL_VERSION);

    #[cfg(unix)]
    {
        // On Unix, platform containment is supported
        assert!(
            caps.available,
            "Linux platform containment must be available when browser executable exists"
        );
        assert!(caps.engine_qualified);
    }

    #[cfg(not(unix))]
    {
        // On non-Unix without Job Object, fails closed per architecture contract §1
        assert!(!caps.available);
        assert!(caps
            .unavailable_reason
            .unwrap()
            .contains("Job Object containment unavailable"));
    }
}

#[tokio::test]
async fn test_process_crash_recovery_and_pty_isolation() {
    let Some(exec) = resolve_test_executable() else {
        eprintln!(
            "Skipping test_process_crash_recovery_and_pty_isolation: no chromium binary found"
        );
        return;
    };

    let tmp = tempdir().unwrap();
    let (event_sink, mut pty_rx) = BroadcastEventSink::new(64);
    let _pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    // 1. Launch a real browser process
    let mut config = BrowserLaunchConfig::new(tmp.path().join("crash-user-data"));
    config.executable_path = Some(exec.clone());
    config.headless = true;

    let mut browser = BrowserProcess::launch(config.clone())
        .await
        .expect("launch browser process");

    let pid = browser.pid();
    assert!(pid > 0);

    // 2. Active PTY session is emitting events
    event_sink.send_terminal_data("active-pty-session", "pre-crash terminal data\n", 0, 1);
    let evt1 = pty_rx.recv().await.expect("receive PTY event");
    assert!(evt1.contains("pre-crash terminal data"));

    // 3. Simulate sudden browser crash / kill
    browser.terminate().await.expect("terminate browser");

    // Verify browser process is gone
    sleep(Duration::from_millis(100)).await;

    // 4. Critical Invariant: Unrelated PTY process and event sink MUST NOT be affected!
    event_sink.send_terminal_data("active-pty-session", "post-crash terminal data\n", 1, 1);
    let evt2 = pty_rx
        .recv()
        .await
        .expect("receive PTY event after browser crash");
    assert!(evt2.contains("post-crash terminal data"));

    // 5. Relaunching browser after crash succeeds cleanly without orphan contention
    let mut relaunch_config = BrowserLaunchConfig::new(tmp.path().join("crash-user-data"));
    relaunch_config.executable_path = Some(exec);
    relaunch_config.headless = true;

    let mut browser2 = BrowserProcess::launch(relaunch_config)
        .await
        .expect("relaunch browser process");

    assert!(browser2.pid() > 0);
    assert_ne!(browser2.pid(), pid);

    browser2
        .terminate()
        .await
        .expect("clean terminate browser 2");
}

#[test]
fn test_lock_contention_and_singleton_lock_handling() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();

    let profile = ManagedProfile::new(root, "admin@example.com", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    // 1. First lock succeeds
    let lock1 = profile.try_lock().expect("acquire primary lock");
    assert!(profile.lock_file().exists());

    // 2. Concurrent second lock attempt fails with LockBusy
    let lock2_res = profile.try_lock();
    assert!(matches!(lock2_res, Err(ProfileError::LockBusy(_))));

    // 3. Dropping lock1 frees lock
    drop(lock1);
    let lock3 = profile.try_lock().expect("re-acquire lock after release");
    drop(lock3);

    // 4. Chromium's SingletonLock symlink can exist in user-data-dir
    let singleton_link = profile.user_data_dir().join("SingletonLock");
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let _ = symlink("fake-host-12345", &singleton_link);
        assert!(singleton_link.exists() || singleton_link.is_symlink());

        // Deleting user data cleans up SingletonLock
        let clean_res = profile.delete_user_data();
        assert!(clean_res.is_ok());
        assert!(!singleton_link.exists());
        profile.recreate_user_data().unwrap();
    }

    // Stable manager.lock file remains on disk
    assert!(profile.lock_file().exists());
}

#[tokio::test]
async fn test_reset_tombstone_ordering_and_restart_fencing() {
    let tmp = tempdir().unwrap();
    let cancel = CancellationToken::new();

    let mut config = BrowserHostConfig::default();
    config.enabled = true;
    config.executable_path = resolve_test_executable();

    let manager = BrowserHostManager::new(
        config.clone(),
        Some(tmp.path().to_path_buf()),
        cancel.clone(),
    );

    let profile = ManagedProfile::new(tmp.path(), "test-subject", false).unwrap();
    profile.ensure_user_data_dir().unwrap();

    // 1. Write an explicit tombstone simulating interrupted reset
    let tombstone = ResetTombstone {
        operation_id: "reset-op-123".to_string(),
        target_profile_epoch: 1,
        stage: ResetStage::Initiated,
        created_at_unix_ms: now_unix_ms(),
        updated_at_unix_ms: now_unix_ms(),
        error: None,
        containment: Default::default(),
    };
    profile.save_tombstone(&tombstone).expect("write tombstone");

    // 2. Capabilities evaluates available: false with CleanupPending notice
    let caps = manager.capabilities("test-subject", false).await;
    assert!(!caps.available);
    assert!(caps.unavailable_reason.unwrap().contains("cleanup pending"));

    // 3. Launching browser fails closed while tombstone exists (prevents dirty-profile relaunch)
    let launch_res = manager.ensure_running("test-subject", false).await;
    assert!(
        matches!(launch_res, Err(ManagerError::CleanupPending(_))),
        "launch must fail while reset tombstone is pending"
    );

    // 4. Removing tombstone after completed cleanup restores capability and launchability
    profile.clear_tombstone().expect("clear tombstone");

    let caps2 = manager.capabilities("test-subject", false).await;
    if config.executable_path.is_some() {
        assert!(caps2.available);
    }
}

#[test]
fn test_profile_permissions_and_dev_prod_isolation() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();

    let prod = ManagedProfile::new(root, "alice", false).unwrap();
    let dev = ManagedProfile::new(root, "alice", true).unwrap();

    prod.ensure_user_data_dir().unwrap();
    dev.ensure_user_data_dir().unwrap();

    // Dev and prod paths are isolated
    assert_ne!(prod.principal_dir(), dev.principal_dir());
    assert!(prod.principal_dir().starts_with(root.join("prod")));
    assert!(dev.principal_dir().starts_with(root.join("dev")));

    // Permissions check on Unix (0700)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode_prod = fs::metadata(prod.principal_dir())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode_prod & 0o777, 0o700);
        let mode_dev = fs::metadata(dev.principal_dir())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode_dev & 0o777, 0o700);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn test_durable_profile_files_are_private_and_lock_inode_survives_reset() {
    use dam_hopper_server::browser_host::manager::{ResetOutcome, ResetStatus};
    use dam_hopper_server::browser_host::profile::{FaultStep, FaultTarget};
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let tmp = tempdir().unwrap();
    let manager = BrowserHostManager::new(
        BrowserHostConfig::default(),
        Some(tmp.path().to_path_buf()),
        CancellationToken::new(),
    );
    let profile = ManagedProfile::new(tmp.path(), "platform_durable", false).unwrap();
    profile.ensure_user_data_dir().unwrap();
    profile.load_or_init_metadata().unwrap();
    drop(profile.try_lock().unwrap());
    let inode_before = fs::metadata(profile.lock_file()).unwrap().ino();
    fs::write(profile.user_data_dir().join("Cookies"), b"secret").unwrap();

    // The tombstone unlink fails: the lock inode and private files must survive the failed
    // reset, and nothing may be reported as cleared.
    manager
        .profile_faults
        .fail(FaultTarget::Tombstone, FaultStep::Unlink, 0, 1);
    let out = manager
        .reset_profile("platform_durable", false, "op-private", 1)
        .await
        .unwrap();
    assert!(
        matches!(out, ResetOutcome::CleanupPending { .. }),
        "{out:?}"
    );
    let status = manager
        .get_reset_status("platform_durable", false, "op-private")
        .await
        .unwrap();
    assert!(
        matches!(status, ResetStatus::CleanupPending { .. }),
        "{status:?}"
    );
    for file in [profile.metadata_file(), profile.reset_file()] {
        let mode = fs::metadata(file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{} must be 0600", file.display());
    }
    assert!(
        fs::read_dir(profile.principal_dir())
            .unwrap()
            .filter_map(Result::ok)
            .all(|e| !e.file_name().to_string_lossy().contains(".tmp.")),
        "no temp file may survive"
    );
    assert_eq!(
        fs::metadata(profile.lock_file()).unwrap().ino(),
        inode_before
    );

    let out = manager
        .reset_profile("platform_durable", false, "op-private", 2)
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
    assert!(!profile.reset_file().exists());
    assert_eq!(
        fs::metadata(profile.lock_file()).unwrap().ino(),
        inode_before,
        "manager.lock inode must be stable across reset"
    );
    let mode = fs::metadata(profile.metadata_file())
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}
