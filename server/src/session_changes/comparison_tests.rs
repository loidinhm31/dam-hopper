use base64::Engine;
use super::capture::*;
use super::comparison::*;
use super::store::{SessionChangesKey, SessionChangesService};
use super::types::*;
use std::fs;
use std::sync::Arc;
use tempfile::tempdir;

fn setup_repo_for_comparison() -> (tempfile::TempDir, std::path::PathBuf) {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("repo");
    fs::create_dir_all(&root).unwrap();

    // Create .git marker
    fs::create_dir_all(root.join(".git")).unwrap();

    // Initial files
    fs::write(root.join("hello.txt"), "hello\nworld\n").unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/lib.rs"), "pub fn test() {}\n").unwrap();
    fs::write(root.join("untouched.txt"), "same\n").unwrap();

    (tmp, root)
}

#[tokio::test]
async fn test_comparison_flow_modified_added_deleted_reverted() {
    let (_tmp, root) = setup_repo_for_comparison();
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

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    // Pre-edit capture tracked paths
    capture_session_paths(
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
            paths: vec![
                "hello.txt".into(),
                "src/lib.rs".into(),
                "src/new.rs".into(),
                "untouched.txt".into(),
            ],
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();

    // Now edit files in repo:
    // 1. Modify hello.txt: add a line
    fs::write(root.join("hello.txt"), "hello\nbeautiful\nworld\n").unwrap();
    // 2. Add new file: src/new.rs
    fs::write(root.join("src/new.rs"), "fn new_func() {}\n").unwrap();
    // 3. Delete src/lib.rs
    fs::remove_file(root.join("src/lib.rs")).unwrap();
    // untouched.txt is unchanged

    // Run comparison scan
    let comp = run_comparison_scan(&service, &key, Some("turn-1".into()))
        .await
        .unwrap();

    assert_eq!(comp.changed_file_count, 3);
    assert_eq!(comp.comparison_revision, "1");
    assert!(comp.counts_complete);

    // List changed files
    let page = list_changed_files(&service, &key, "1", None, None).unwrap();
    assert_eq!(page.files.len(), 3);

    let hello_row = page.files.iter().find(|f| f.path == "hello.txt").unwrap();
    assert_eq!(hello_row.change, FileChangeKind::Modified);
    assert_eq!(hello_row.additions, Some(1));
    assert_eq!(hello_row.deletions, Some(0));

    let new_row = page.files.iter().find(|f| f.path == "src/new.rs").unwrap();
    assert_eq!(new_row.change, FileChangeKind::Added);
    assert_eq!(new_row.original_presence, Presence::Absent);
    assert_eq!(new_row.original_provenance, Provenance::AbsentAtFirstTouch);
    assert_eq!(new_row.additions, Some(1));

    let del_row = page.files.iter().find(|f| f.path == "src/lib.rs").unwrap();
    assert_eq!(del_row.change, FileChangeKind::Deleted);
    assert_eq!(del_row.current_presence, Presence::Absent);

    // Get detail of hello.txt
    let detail = get_file_detail(&service, &key, "1", &hello_row.file_id).await.unwrap();
    assert_eq!(detail.original.content.as_deref(), Some("hello\nworld\n"));
    assert_eq!(
        detail.current.content.as_deref(),
        Some("hello\nbeautiful\nworld\n")
    );
    assert!(detail.renderable);

    // Refresh required error on stale revision
    let stale_err = list_changed_files(&service, &key, "999", None, None);
    assert_eq!(stale_err.unwrap_err(), ErrorCode::RefreshRequired);

    // Revert hello.txt back to original bytes
    fs::write(root.join("hello.txt"), "hello\nworld\n").unwrap();

    let comp2 = run_comparison_scan(&service, &key, Some("turn-2".into()))
        .await
        .unwrap();

    // Now changed count is 2 (src/new.rs and src/lib.rs); hello.txt was omitted!
    assert_eq!(comp2.changed_file_count, 2);
    assert_eq!(comp2.comparison_revision, "2");

    let page2 = list_changed_files(&service, &key, "2", None, None).unwrap();
    assert_eq!(page2.files.len(), 2);
    assert!(page2.files.iter().all(|f| f.path != "hello.txt"));
}

#[tokio::test]
async fn test_detail_mutation_detection_and_refresh_required() {
    let (_tmp, root) = setup_repo_for_comparison();
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

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    capture_session_paths(
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

    fs::write(root.join("hello.txt"), "modified version 1\n").unwrap();

    let _comp = run_comparison_scan(&service, &key, None).await.unwrap();
    let page = list_changed_files(&service, &key, "1", None, None).unwrap();
    let file_id = page.files[0].file_id.clone();

    // Detail succeeds before mutation
    let detail1 = get_file_detail(&service, &key, "1", &file_id).await.unwrap();
    assert_eq!(detail1.current.content.as_deref(), Some("modified version 1\n"));

    // Mutate file on disk again (concurrent external write / tool write after comparison)
    fs::write(root.join("hello.txt"), "modified version 2\n").unwrap();

    // Detail returns RefreshRequired because disk content differs from snapshot
    let detail_err = get_file_detail(&service, &key, "1", &file_id).await.unwrap_err();
    assert_eq!(detail_err, ErrorCode::RefreshRequired);
}

#[tokio::test]
async fn test_binary_file_diff_handling() {
    let (_tmp, root) = setup_repo_for_comparison();
    let service = Arc::new(SessionChangesService::new_enabled().unwrap());

    fs::write(root.join("binary.bin"), [0u8, 1, 2, 3]).unwrap();

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

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    capture_session_paths(
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
            paths: vec!["binary.bin".into()],
            mode: CaptureMode::PreEdit,
        },
    )
    .await
    .unwrap();

    fs::write(root.join("binary.bin"), [0u8, 9, 8, 7]).unwrap();

    let comp = run_comparison_scan(&service, &key, None).await.unwrap();
    assert_eq!(comp.changed_file_count, 1);
    assert!(!comp.counts_complete);
    assert_eq!(comp.additions, None);
    assert_eq!(comp.deletions, None);

    let page = list_changed_files(&service, &key, "1", None, None).unwrap();
    assert_eq!(page.files[0].change, FileChangeKind::Modified);
    assert_eq!(page.files[0].original_kind, FileContentKind::Binary);
    assert_eq!(page.files[0].current_kind, FileContentKind::Binary);
    assert!(page.files[0].reasons.contains(&CoverageReason::Binary));
}

#[tokio::test]
async fn test_cursor_validation() {
    let (_tmp, root) = setup_repo_for_comparison();
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

    let key = SessionChangesKey {
        terminal_id: "term-1".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "session-1".into(),
        root_id: ".".into(),
    };

    capture_session_paths(
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

    fs::write(root.join("hello.txt"), "changed\n").unwrap();
    let _comp = run_comparison_scan(&service, &key, None).await.unwrap();

    // Invalid base64 cursor
    let bad_cursor_err = list_changed_files(&service, &key, "1", Some("not-valid-base64!!!"), None);
    assert_eq!(bad_cursor_err.unwrap_err(), ErrorCode::InvalidRequest);

    // Invalid offset string
    let bad_offset_cursor = base64::engine::general_purpose::STANDARD.encode("not-a-number");
    let bad_offset_err = list_changed_files(&service, &key, "1", Some(&bad_offset_cursor), None);
    assert_eq!(bad_offset_err.unwrap_err(), ErrorCode::InvalidRequest);
}
