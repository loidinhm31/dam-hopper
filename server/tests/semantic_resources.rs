#![cfg(target_os = "linux")]

use dam_hopper_server::semantic::launch::BundledLaunchSpec;
use dam_hopper_server::semantic::resources::linux::{
    ChildCgroupScope, LinuxResourceController, ResourceMode,
};
use dam_hopper_server::semantic::resources::*;
use std::time::Duration;
use tempfile::TempDir;

#[test]
fn test_resource_policy_defaults_match_phase01_spec() {
    let policy = ResourcePolicy::default();

    assert_eq!(policy.version, "1.0.0");
    assert_eq!(policy.max_header_bytes, 8192);
    assert_eq!(policy.max_frame_bytes, 4 * 1024 * 1024);
    assert_eq!(policy.max_queued_messages, 32);
    assert_eq!(policy.max_queued_bytes, 4 * 1024 * 1024);
    assert_eq!(policy.max_in_flight_requests, 8);
    assert_eq!(policy.rate_per_sec, 40);
    assert_eq!(policy.rate_burst, 80);
    assert_eq!(policy.adaptive_sync_threshold_bytes, 64 * 1024);
    assert_eq!(policy.max_document_bytes, 1024 * 1024);
    assert_eq!(policy.max_open_documents, 16);
    assert_eq!(policy.max_session_overlay_bytes, 4 * 1024 * 1024);
    assert_eq!(policy.max_global_overlay_bytes, 8 * 1024 * 1024);
    assert_eq!(policy.max_global_trees, 2);
    assert_eq!(policy.max_processes_per_tree, 8);
    assert_eq!(policy.startup_timeout_ms, 30_000);
    assert_eq!(policy.navigation_timeout_ms, 10_000);
    assert_eq!(policy.idle_timeout_ms, 60_000);
    assert_eq!(policy.v8_max_old_space_mb, 256);

    // Named constant deadlines
    assert_eq!(STARTUP_TIMEOUT, Duration::from_secs(30));
    assert_eq!(NAVIGATION_REQUEST_TIMEOUT, Duration::from_secs(10));
    assert_eq!(GRACEFUL_SHUTDOWN_TIMEOUT, Duration::from_millis(2000));
    assert_eq!(FORCE_KILL_REAP_BUDGET, Duration::from_millis(3000));
    assert_eq!(TOTAL_TEARDOWN_BUDGET, Duration::from_millis(5000));
    assert_eq!(IDLE_SHUTDOWN_TIMEOUT, Duration::from_secs(60));
    assert_eq!(SOCKET_SEND_TIMEOUT, Duration::from_secs(2));
    assert_eq!(AUTH_STORE_LOOKUP_TIMEOUT, Duration::from_secs(2));
}

#[test]
fn test_adaptive_sync_threshold_boundary() {
    // Exactly at threshold boundary: 64 KiB = 65,536 bytes
    let threshold = ADAPTIVE_SYNC_THRESHOLD_BYTES;
    assert_eq!(threshold, 65536);

    // Below threshold -> full sync (returns false for incremental)
    assert!(!ResourcePolicy::is_incremental_sync_recommended(0));
    assert!(!ResourcePolicy::is_incremental_sync_recommended(100));
    assert!(!ResourcePolicy::is_incremental_sync_recommended(
        threshold - 1
    ));

    // At or above threshold -> incremental sync
    assert!(ResourcePolicy::is_incremental_sync_recommended(threshold));
    assert!(ResourcePolicy::is_incremental_sync_recommended(
        threshold + 1
    ));
    assert!(ResourcePolicy::is_incremental_sync_recommended(1024 * 1024));
}

#[test]
fn test_document_size_validation() {
    assert!(ResourcePolicy::validate_document_size(0).is_ok());
    assert!(ResourcePolicy::validate_document_size(1024).is_ok());
    assert!(ResourcePolicy::validate_document_size(MAX_DOCUMENT_BYTES).is_ok());

    let err = ResourcePolicy::validate_document_size(MAX_DOCUMENT_BYTES + 1);
    assert!(matches!(
        err,
        Err(ResourceLimitError::DocumentTooLarge { .. })
    ));
}

#[test]
fn test_frame_size_validation() {
    assert!(ResourcePolicy::validate_frame_size(0).is_ok());
    assert!(ResourcePolicy::validate_frame_size(MAX_FRAME_BODY_BYTES).is_ok());

    let err = ResourcePolicy::validate_frame_size(MAX_FRAME_BODY_BYTES + 1);
    assert!(matches!(err, Err(ResourceLimitError::FrameTooLarge { .. })));
}

#[test]
fn test_header_size_validation() {
    assert!(ResourcePolicy::validate_header_size(0).is_ok());
    assert!(ResourcePolicy::validate_header_size(MAX_STDIO_HEADER_BYTES).is_ok());

    let err = ResourcePolicy::validate_header_size(MAX_STDIO_HEADER_BYTES + 1);
    assert!(matches!(
        err,
        Err(ResourceLimitError::HeaderTooLarge { .. })
    ));
}

#[test]
fn test_linux_cgroup_controller_portable_fallback_when_unavailable() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let non_existent = temp_dir.path().join("fake_cgroup");

    let controller = LinuxResourceController::new(&non_existent);
    let (mode, scope) = controller.prepare_child_scope("sess-123");

    assert!(scope.is_none());
    assert!(matches!(
        mode,
        ResourceMode::PortableOnly {
            degraded: true,
            v8_heap_hint_mb: 256,
            monitored_tree_limit: 8,
            ref reason,
        } if reason.contains("Hard controls unavailable")
    ));
}

#[test]
fn test_linux_cgroup_invalid_session_id_fails_closed() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let controller = LinuxResourceController::new(temp_dir.path());

    for bad_id in &["", "slash/id", "../escape", "id with spaces", "semi;colon"] {
        let (mode, scope) = controller.prepare_child_scope(bad_id);
        assert!(scope.is_none());
        assert!(matches!(
            mode,
            ResourceMode::PortableOnly {
                ref reason,
                degraded: true,
                ..
            } if reason.contains("invalid session id")
        ));
    }
}

#[test]
fn test_cgroup_scope_attach_to_launch_spec() {
    let temp_dir = TempDir::new().expect("create temp dir");
    let cgroup_dir = temp_dir.path().join("cgroup_child");
    std::fs::create_dir_all(&cgroup_dir).expect("create cgroup dir");

    // Create dummy files for launch spec
    let exe = temp_dir.path().join("node");
    std::fs::File::create(&exe).expect("create exe");
    let entry = temp_dir.path().join("cli.mjs");
    std::fs::File::create(&entry).expect("create entry");

    let mut spec = BundledLaunchSpec::new(&exe, &entry, temp_dir.path(), temp_dir.path())
        .expect("create spec");
    assert!(spec.cgroup_procs_path.is_none());

    let cgroup_scope = temp_dir.path().join("dummy_cgroup");
    std::fs::create_dir_all(&cgroup_scope).expect("create dummy cgroup");
    let scope = ChildCgroupScope::new_for_test(cgroup_scope.clone());

    scope.attach_to_launch_spec(&mut spec);
    assert_eq!(
        spec.cgroup_procs_path.as_deref(),
        Some(cgroup_scope.join("cgroup.procs").as_path())
    );
}
