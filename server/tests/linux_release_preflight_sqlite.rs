//! Tests for daemon SQLite database path resolution, candidate inspection,
//! path normalization, and process holder protection during migration.

use dam_hopper_server::linux_release::activate_preflight::resolve_configured_sqlite_paths;
use dam_hopper_server::linux_release::error::ReleaseError;
use dam_hopper_server::linux_release::layout::Layout;
use dam_hopper_server::linux_release::process_holders::verify_no_foreign_sqlite_holders_in;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use tempfile::TempDir;

fn setup_layout(temp: &TempDir) -> Layout {
    let layout = Layout::with_root(temp.path().to_path_buf());
    fs::create_dir_all(layout.api_state_dir()).expect("create api_state_dir");
    fs::create_dir_all(layout.api_etc_dir()).expect("create api_etc_dir");
    layout
}

#[test]
fn test_preflight_sqlite_both_absent() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");

    let expected_canonical_default = layout.api_config_dir().join("sessions.db");
    let expected_legacy_fallback = layout.api_etc_dir().join("sessions.db");

    assert_eq!(
        candidates,
        vec![expected_canonical_default.clone(), expected_legacy_fallback.clone()]
    );

    // Preflight must be strictly read-only: no files created
    assert!(!expected_canonical_default.exists());
    assert!(!expected_legacy_fallback.exists());
    assert!(!layout.api_daemon_config_path().exists());
    assert!(!layout.legacy_api_daemon_config_path().exists());
}

#[test]
fn test_preflight_sqlite_canonical_only() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    let canonical_path = layout.api_daemon_config_path();
    fs::write(
        &canonical_path,
        b"[server]\nsession_db_path = \"/var/custom/prod.sqlite\"\n",
    )
    .expect("write canonical config");

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");

    assert_eq!(
        candidates,
        vec![
            PathBuf::from("/var/custom/prod.sqlite"),
            layout.api_etc_dir().join("sessions.db")
        ]
    );
}

#[test]
fn test_preflight_sqlite_legacy_only_relative() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    let legacy_path = layout.legacy_api_daemon_config_path();
    fs::write(
        &legacy_path,
        b"[server]\nsession_db_path = \"state/sessions.db\"\n",
    )
    .expect("write legacy config");

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");

    // Relative path resolves to API HOME / working directory (/var/lib/dam-hopper)
    let expected_relative = layout.api_state_dir().join("state/sessions.db");
    assert_eq!(
        candidates,
        vec![expected_relative, layout.api_etc_dir().join("sessions.db")]
    );
}

#[test]
fn test_preflight_sqlite_both_present_different_paths() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    fs::write(
        layout.api_daemon_config_path(),
        b"[server]\nsession_db_path = \"/var/db/canonical.sqlite\"\n",
    )
    .expect("write canonical config");

    fs::write(
        layout.legacy_api_daemon_config_path(),
        b"[server]\nsession_db_path = \"/var/db/legacy.sqlite\"\n",
    )
    .expect("write legacy config");

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");

    assert_eq!(
        candidates,
        vec![
            PathBuf::from("/var/db/canonical.sqlite"),
            PathBuf::from("/var/db/legacy.sqlite"),
            layout.api_etc_dir().join("sessions.db")
        ]
    );
}

#[test]
fn test_preflight_sqlite_both_present_same_path_dedup() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    // Both specify the default tilde path
    fs::write(
        layout.api_daemon_config_path(),
        b"[server]\nsession_db_path = \"~/.config/dam-hopper/sessions.db\"\n",
    )
    .expect("write canonical config");

    fs::write(
        layout.legacy_api_daemon_config_path(),
        b"[server]\nsession_db_path = \"~/.config/dam-hopper/sessions.db\"\n",
    )
    .expect("write legacy config");

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");

    let expected_default = layout.api_config_dir().join("sessions.db");
    let expected_legacy = layout.api_etc_dir().join("sessions.db");

    assert_eq!(candidates, vec![expected_default, expected_legacy]);
}

#[test]
fn test_preflight_sqlite_tilde_and_tilde_user_semantics() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    // 1. Tilde alone resolves to api_state_dir
    fs::write(
        layout.api_daemon_config_path(),
        b"[server]\nsession_db_path = \"~\"\n",
    )
    .expect("write canonical config");

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");
    assert_eq!(candidates[0], layout.api_state_dir());

    // 2. Unsupported ~user syntax is rejected
    fs::write(
        layout.api_daemon_config_path(),
        b"[server]\nsession_db_path = \"~dam-hopper/db.sqlite\"\n",
    )
    .expect("write canonical config");

    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::Config(msg) => {
            assert!(
                msg.contains("~user expansion is not supported"),
                "unexpected error message: {msg}"
            );
        }
        other => panic!("expected ReleaseError::Config, got {other:?}"),
    }
}

#[test]
fn test_preflight_sqlite_unsafe_canonical_refused() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    // Setup valid legacy config to prove unsafe canonical is fatal regardless
    fs::write(
        layout.legacy_api_daemon_config_path(),
        b"[workspace]\nname = \"default\"\n",
    )
    .expect("write legacy config");

    let canonical_path = layout.api_daemon_config_path();

    // A. Symlink canonical
    let target = temp.path().join("nowhere.toml");
    fs::write(&target, b"[workspace]\nname=\"dummy\"\n").expect("write target");
    symlink(&target, &canonical_path).expect("create symlink");

    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::OwnershipViolation { got, .. } => {
            assert!(got.contains("symbolic link"));
        }
        other => panic!("expected OwnershipViolation, got {other:?}"),
    }
    fs::remove_file(&canonical_path).expect("remove symlink");

    // B. Non-regular (directory)
    fs::create_dir(&canonical_path).expect("create dir");
    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::OwnershipViolation { got, .. } => {
            assert!(got.contains("non-regular file"));
        }
        other => panic!("expected OwnershipViolation, got {other:?}"),
    }
    fs::remove_dir(&canonical_path).expect("remove dir");

    // C. Oversized (> 64 KiB)
    let big_data = vec![b' '; 65 * 1024];
    fs::write(&canonical_path, &big_data).expect("write oversized");
    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::Config(msg) => {
            assert!(msg.contains("exceeds maximum size"));
        }
        other => panic!("expected ReleaseError::Config, got {other:?}"),
    }

    // D. Invalid UTF-8
    let bad_utf8 = vec![0xff, 0xfe, 0xfd];
    fs::write(&canonical_path, &bad_utf8).expect("write invalid utf8");
    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::Config(msg) => {
            assert!(msg.contains("not valid UTF-8"));
        }
        other => panic!("expected ReleaseError::Config, got {other:?}"),
    }

    // E. Invalid TOML
    fs::write(&canonical_path, b"[[invalid toml {{{").expect("write bad toml");
    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::Config(msg) => {
            assert!(msg.contains("failed to parse"));
        }
        other => panic!("expected ReleaseError::Config, got {other:?}"),
    }
}

#[test]
fn test_preflight_sqlite_unsafe_legacy_refused() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    // Valid canonical config
    fs::write(
        layout.api_daemon_config_path(),
        b"[workspace]\nname = \"canonical\"\n",
    )
    .expect("write canonical config");

    let legacy_path = layout.legacy_api_daemon_config_path();

    // A. Symlink legacy is fatal even though canonical is valid!
    let target = temp.path().join("target.toml");
    fs::write(&target, b"[workspace]\nname = \"target\"\n").expect("write target");
    symlink(&target, &legacy_path).expect("create symlink");

    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::OwnershipViolation { got, .. } => {
            assert!(got.contains("symbolic link"));
        }
        other => panic!("expected OwnershipViolation, got {other:?}"),
    }
    fs::remove_file(&legacy_path).expect("remove symlink");

    // B. Invalid TOML in legacy is fatal
    fs::write(&legacy_path, b"this is not toml :::").expect("write invalid legacy");
    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::Config(msg) => {
            assert!(msg.contains("failed to parse"));
        }
        other => panic!("expected ReleaseError::Config, got {other:?}"),
    }
}

#[test]
fn test_preflight_sqlite_zero_filesystem_mutation() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    let canonical_path = layout.api_daemon_config_path();
    let legacy_path = layout.legacy_api_daemon_config_path();

    fs::write(
        &canonical_path,
        b"[server]\nsession_db_path = \"/tmp/db.sqlite\"\n",
    )
    .expect("write canonical");
    fs::write(
        &legacy_path,
        b"[server]\nsession_db_path = \"/tmp/legacy.sqlite\"\n",
    )
    .expect("write legacy");

    let canonical_meta_before = fs::metadata(&canonical_path).expect("meta");
    let legacy_meta_before = fs::metadata(&legacy_path).expect("meta");

    let paths = resolve_configured_sqlite_paths(&layout).expect("resolve paths");
    assert_eq!(paths.len(), 3);

    let canonical_meta_after = fs::metadata(&canonical_path).expect("meta");
    let legacy_meta_after = fs::metadata(&legacy_path).expect("meta");

    assert_eq!(canonical_meta_before.len(), canonical_meta_after.len());
    assert_eq!(
        canonical_meta_before.modified().unwrap(),
        canonical_meta_after.modified().unwrap()
    );
    assert_eq!(legacy_meta_before.len(), legacy_meta_after.len());
    assert_eq!(
        legacy_meta_before.modified().unwrap(),
        legacy_meta_after.modified().unwrap()
    );
}

#[test]
fn test_preflight_sqlite_process_holder_reaches_verification() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    let db_path = temp.path().join("db.sqlite");
    let wal_path = temp.path().join("db.sqlite-wal");
    let shm_path = temp.path().join("db.sqlite-shm");

    fs::write(&db_path, b"sqlite db").expect("write db");
    fs::write(&wal_path, b"sqlite wal").expect("write wal");
    fs::write(&shm_path, b"sqlite shm").expect("write shm");

    fs::write(
        layout.api_daemon_config_path(),
        format!("[server]\nsession_db_path = \"{}\"\n", db_path.display()),
    )
    .expect("write canonical config");

    let candidates = resolve_configured_sqlite_paths(&layout).expect("resolve paths");
    assert!(candidates.contains(&db_path));

    // Create fake /proc structure
    let fake_proc = temp.path().join("fake_proc");
    let foreign_pid_fd_dir = fake_proc.join("9999/fd");
    fs::create_dir_all(&foreign_pid_fd_dir).expect("create fake proc fd dir");

    // A. Foreign process holds main DB
    let link_fd0 = foreign_pid_fd_dir.join("0");
    symlink(&db_path, &link_fd0).expect("symlink db");

    for candidate in &candidates {
        if candidate == &db_path {
            let err = verify_no_foreign_sqlite_holders_in(&fake_proc, candidate, &[1000])
                .unwrap_err();
            match err {
                ReleaseError::ProcessInspectionFailed { reason } => {
                    assert!(reason.contains("foreign process PID 9999"));
                    assert!(reason.contains("db.sqlite"));
                }
                other => panic!("expected ProcessInspectionFailed, got {other:?}"),
            }

            // Allowed PID passes
            assert!(verify_no_foreign_sqlite_holders_in(&fake_proc, candidate, &[9999]).is_ok());
        }
    }
    fs::remove_file(&link_fd0).expect("remove link fd0");

    // B. Foreign process holds WAL file
    let link_fd1 = foreign_pid_fd_dir.join("1");
    symlink(&wal_path, &link_fd1).expect("symlink wal");

    for candidate in &candidates {
        if candidate == &db_path {
            let err = verify_no_foreign_sqlite_holders_in(&fake_proc, candidate, &[1000])
                .unwrap_err();
            match err {
                ReleaseError::ProcessInspectionFailed { reason } => {
                    assert!(reason.contains("foreign process PID 9999"));
                    assert!(reason.contains("db.sqlite-wal"));
                }
                other => panic!("expected ProcessInspectionFailed, got {other:?}"),
            }
        }
    }
    fs::remove_file(&link_fd1).expect("remove link fd1");

    // C. Foreign process holds SHM file
    let link_fd2 = foreign_pid_fd_dir.join("2");
    symlink(&shm_path, &link_fd2).expect("symlink shm");

    for candidate in &candidates {
        if candidate == &db_path {
            let err = verify_no_foreign_sqlite_holders_in(&fake_proc, candidate, &[1000])
                .unwrap_err();
            match err {
                ReleaseError::ProcessInspectionFailed { reason } => {
                    assert!(reason.contains("foreign process PID 9999"));
                    assert!(reason.contains("db.sqlite-shm"));
                }
                other => panic!("expected ProcessInspectionFailed, got {other:?}"),
            }
        }
    }
    fs::remove_file(&link_fd2).expect("remove link fd2");
}

#[test]
fn test_preflight_sqlite_non_string_session_path_fails() {
    let temp = TempDir::new().expect("temp dir");
    let layout = setup_layout(&temp);

    fs::write(
        layout.api_daemon_config_path(),
        b"[server]\nsession_db_path = 12345\n",
    )
    .expect("write bad session config");

    let err = resolve_configured_sqlite_paths(&layout).unwrap_err();
    match err {
        ReleaseError::Config(msg) => {
            assert!(
                msg.contains("field server.session_db_path must be a string"),
                "unexpected error: {msg}"
            );
        }
        other => panic!("expected ReleaseError::Config, got {other:?}"),
    }
}
