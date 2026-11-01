use super::capture::*;
use super::store::{SessionChangesKey, SessionChangesService};
use super::types::*;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

fn setup_test_repo() -> (tempfile::TempDir, std::path::PathBuf) {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();

    // Create .git marker
    fs::create_dir_all(root.join(".git")).unwrap();

    // Create tracked and untracked files
    fs::write(root.join("hello.txt"), "hello world\n").unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn add() {}\n").unwrap();

    (tmp, root)
}

#[tokio::test]
async fn test_register_session_lifecycle() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    let reg_req = RegisterRequest {
        version: 1,
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
    };

    let res = register_session(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        reg_req.clone(),
    )
    .await
    .unwrap();

    assert_eq!(res.omp_session_id, "session-1");
    assert_eq!(res.terminal_incarnation, "1");
    assert!(!res.baseline_id.is_empty());

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    let status = service.build_status(&key);
    assert_eq!(status.state, StatusState::Ready);
    assert_eq!(status.origin, Some(Origin::ToolObserved));
    assert_eq!(status.acknowledgment, Acknowledgment::NotApplicable);
    status.validate_invariants().unwrap();

    // Idempotent registration returns existing baseline
    let res_dup = register_session(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        reg_req,
    )
    .await
    .unwrap();
    assert_eq!(res_dup.baseline_id, res.baseline_id);
}

#[tokio::test]
async fn test_capture_paths_pre_edit_and_already_known() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    let reg_req = RegisterRequest {
        version: 1,
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        cwd_hint: None,
    };

    let reg = register_session(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        reg_req,
    )
    .await
    .unwrap();

    let cap_req = CaptureRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        baseline_id: reg.baseline_id.clone(),
        capture_id: "cap-1".into(),
        paths: vec!["hello.txt".into(), "src/absent.rs".into()],
        mode: CaptureMode::PreEdit,
    };

    let cap_res = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        cap_req,
    )
    .await
    .unwrap();

    assert_eq!(cap_res.results.len(), 2);
    assert_eq!(cap_res.results[0].path, "hello.txt");
    assert_eq!(cap_res.results[0].status, PathCaptureStatus::Captured);
    assert_eq!(cap_res.results[0].presence, Some(PathPresence::Present));

    assert_eq!(cap_res.results[1].path, "src/absent.rs");
    assert_eq!(cap_res.results[1].status, PathCaptureStatus::Captured);
    assert_eq!(cap_res.results[1].presence, Some(PathPresence::AbsentAtFirstTouch));

    // Mutate hello.txt on disk
    fs::write(root.join("hello.txt"), "mutated content\n").unwrap();

    // Subsequent capture to hello.txt reports alreadyKnown and does NOT overwrite original
    let cap_req_dup = CaptureRequest {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
        baseline_id: reg.baseline_id.clone(),
        capture_id: "cap-2".into(),
        paths: vec!["hello.txt".into()],
        mode: CaptureMode::PreEdit,
    };

    let cap_res_dup = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        cap_req_dup,
    )
    .await
    .unwrap();

    assert_eq!(cap_res_dup.results[0].status, PathCaptureStatus::AlreadyKnown);

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    let records = service.records.lock();
    let rec = records.get(&key).unwrap();
    let entry = rec.tracked_paths.get("hello.txt").unwrap();
    assert_eq!(entry.bytes.as_deref(), Some(b"hello world\n".as_slice()));
}

#[tokio::test]
async fn test_capture_unproven_sticky_unknown() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    let reg = register_session(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        RegisterRequest {
            version: 1,
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            cwd_hint: None,
        },
    )
    .await
    .unwrap();

    let cap_res = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id.clone(),
            capture_id: "cap-1".into(),
            paths: vec!["src/lib.rs".into()],
            mode: CaptureMode::Unproven,
        },
    )
    .await
    .unwrap();

    assert_eq!(cap_res.results[0].status, PathCaptureStatus::Unproven);
    assert_eq!(cap_res.results[0].presence, Some(PathPresence::Unknown));

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    let status = service.build_status(&key);
    assert_eq!(status.state, StatusState::Incomplete);
    status.validate_invariants().unwrap();
}

#[tokio::test]
async fn test_safe_probe_symlink_rejection() {
    let (_tmp, root) = setup_test_repo();

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("hello.txt"), root.join("link.txt")).unwrap();
        let probe = probe_file_safely(None, &root, "link.txt");
        match probe {
            ProbeResult::Unknown { reason } => assert_eq!(reason, CoverageReason::Symlink),
            _ => panic!("Expected symlink to be rejected"),
        }
    }
}

#[test]
fn test_boundary_2mib_file_limit() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();

    // Exactly 2 MiB
    let exact_2mib = vec![b'a'; MAX_FILE_RAW_BYTES];
    fs::write(root.join("exact_2mib.bin"), &exact_2mib).unwrap();
    match probe_file_safely(None, &root, "exact_2mib.bin") {
        ProbeResult::Present { size_bytes, .. } => assert_eq!(size_bytes, MAX_FILE_RAW_BYTES as u64),
        _ => panic!("Expected exactly 2 MiB file to be Present"),
    }

    // 2 MiB + 1 byte
    let over_2mib = vec![b'a'; MAX_FILE_RAW_BYTES + 1];
    fs::write(root.join("over_2mib.bin"), &over_2mib).unwrap();
    match probe_file_safely(None, &root, "over_2mib.bin") {
        ProbeResult::Unknown { reason } => assert_eq!(reason, CoverageReason::FileTooLarge),
        _ => panic!("Expected 2 MiB + 1 byte file to be rejected as FileTooLarge"),
    }
}

#[tokio::test]
async fn test_boundary_500_paths_limit() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    let reg = register_session(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        RegisterRequest {
            version: 1,
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            cwd_hint: None,
        },
    )
    .await
    .unwrap();

    // Capture 500 paths
    let paths: Vec<String> = (0..MAX_PATHS_PER_SESSION)
        .map(|i| format!("path_{}.txt", i))
        .collect();

    let cap_res = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id.clone(),
            capture_id: "cap-bulk".into(),
            paths,
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();

    assert_eq!(cap_res.results.len(), MAX_PATHS_PER_SESSION);

    // 501st path exceeds limit
    let cap_over = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id,
            capture_id: "cap-over".into(),
            paths: vec!["path_over_limit.txt".into()],
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();

    assert_eq!(cap_over.results.len(), 1);
    assert_eq!(cap_over.results[0].status, PathCaptureStatus::Unknown);
    assert_eq!(cap_over.results[0].reason.as_deref(), Some("pathLimit"));
}

#[tokio::test]
async fn test_boundary_32_identities_limit() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    for i in 0..MAX_RETAINED_IDENTITIES {
        let res = register_session(
            &service,
            format!("term-{}", i),
            "1".into(),
            &root,
            RegisterRequest {
                version: 1,
                omp_session_id: format!("sess-{}", i),
                root_id: ".".into(),
                cwd_hint: None,
            },
        )
        .await;
        assert!(res.is_ok(), "Session {} should register within 32 limit", i);
    }

    // 33rd registration exceeds capacity
    let res_33 = register_session(
        &service,
        "term-33".into(),
        "1".into(),
        &root,
        RegisterRequest {
            version: 1,
            omp_session_id: "sess-33".into(),
            root_id: ".".into(),
            cwd_hint: None,
        },
    )
    .await;

    assert_eq!(res_33.unwrap_err(), ErrorCode::Capacity);
}

#[test]
fn test_boundary_64mib_global_storage_reservation() {
    let service = SessionChangesService::new_enabled().unwrap();

    // Reserve exactly 64 MiB
    assert!(service.try_reserve_storage(MAX_GLOBAL_STORAGE_BYTES as u64).is_ok());

    // Next 1 byte exceeds capacity
    assert_eq!(service.try_reserve_storage(1).unwrap_err(), ErrorCode::Capacity);

    // Release 1024 bytes
    service.release_storage(1024);

    // Now reserving 1024 bytes succeeds
    assert!(service.try_reserve_storage(1024).is_ok());
    // But 1 more byte fails
    assert_eq!(service.try_reserve_storage(1).unwrap_err(), ErrorCode::Capacity);
}

#[tokio::test]
async fn test_unproven_downgrades_unacknowledged_attempt_only() {
    let (_tmp, root) = setup_test_repo();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    let reg = register_session(
        &service,
        "term-1".into(),
        "1".into(),
        &root,
        RegisterRequest {
            version: 1,
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            cwd_hint: None,
        },
    )
    .await
    .unwrap();

    // Attempt 1: successfully capture hello.txt (acknowledged)
    let cap1 = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id.clone(),
            capture_id: "cap-1".into(),
            paths: vec!["hello.txt".into()],
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();
    assert_eq!(cap1.results[0].status, PathCaptureStatus::Captured);

    // Attempt 2: capture src/lib.rs with capture_id "cap-2"
    let cap2 = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id.clone(),
            capture_id: "cap-2".into(),
            paths: vec!["src/lib.rs".into()],
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();
    assert_eq!(cap2.results[0].status, PathCaptureStatus::Captured);

    // Now simulate timeout unproven for cap-2:
    // Manually simulate unacknowledged attempt 2 timed out before tool completed
    {
        let mut records = service.records.lock();
        let rec = records.values_mut().next().unwrap();
        let entry = rec.tracked_paths.get_mut("src/lib.rs").unwrap();
        entry.acknowledged = false; // was unacknowledged
    }

    let cap_unproven = capture_session_paths(
        &service,
        "term-1".into(),
        "1".into(),
        CaptureRequest {
            version: 1,
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation: "1".into(),
            omp_session_id: "session-1".into(),
            root_id: ".".into(),
            baseline_id: reg.baseline_id.clone(),
            capture_id: "cap-2".into(),
            paths: vec!["src/lib.rs".into(), "hello.txt".into()],
            mode: CaptureMode::Unproven,
        },
    )
    .await
    .unwrap();

    // src/lib.rs from unacknowledged attempt 2 was downgraded to unproven/unknown
    assert_eq!(cap_unproven.results[0].status, PathCaptureStatus::Unproven);
    assert_eq!(cap_unproven.results[0].presence, Some(PathPresence::Unknown));

    // But hello.txt from acknowledged attempt 1 was PRESERVED!
    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };
    let records = service.records.lock();
    let rec = records.get(&key).unwrap();
    let hello_entry = rec.tracked_paths.get("hello.txt").unwrap();
    assert_eq!(hello_entry.presence, Presence::Present);
    assert_eq!(hello_entry.provenance, Provenance::Captured);
    assert!(hello_entry.acknowledged);
}

#[test]
fn test_fifo_rejection_does_not_hang() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();

    #[cfg(unix)]
    {
        use std::ffi::CString;
        let fifo_path = root.join("my_fifo");
        let c_path = CString::new(fifo_path.to_str().unwrap()).unwrap();
        unsafe {
            libc::mkfifo(c_path.as_ptr(), 0o666);
        }

        // probe_file_safely should return SpecialFile immediately without hanging
        let probe = probe_file_safely(None, &root, "my_fifo");
        match probe {
            ProbeResult::Unknown { reason } => assert_eq!(reason, CoverageReason::SpecialFile),
            _ => panic!("Expected FIFO to be rejected as SpecialFile"),
        }
    }
}
