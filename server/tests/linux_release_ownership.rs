//! Integration tests for ownership, permission boundaries, and process port inspection.

use dam_hopper_server::linux_release::*;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use tempfile::tempdir;

#[test]
fn test_verify_path_permissions_success_and_failure() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("test.txt");
    fs::write(&file, "content").unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();

    // Matching mode passes
    assert!(verify_path_permissions(&file, 0o644, false).is_ok());

    // Mismatched mode fails
    let err = verify_path_permissions(&file, 0o755, false);
    assert!(matches!(err, Err(ReleaseError::OwnershipViolation { .. })));
}

#[test]
fn test_verify_release_ownership_recursive() {
    let root = tempdir().unwrap();
    let release_dir = root.path().join("v0.2.0/server");
    let bin_dir = release_dir.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    fs::set_permissions(&release_dir, fs::Permissions::from_mode(0o755)).unwrap();
    fs::set_permissions(&bin_dir, fs::Permissions::from_mode(0o755)).unwrap();

    let binary = bin_dir.join("dam-hopper-server");
    fs::write(&binary, "binary").unwrap();
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();

    let regular = release_dir.join("README.txt");
    fs::write(&regular, "doc").unwrap();
    fs::set_permissions(&regular, fs::Permissions::from_mode(0o644)).unwrap();

    // Correct tree passes
    assert!(verify_release_ownership(&release_dir, false).is_ok());

    // Binary with 0644 fails
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(matches!(
        verify_release_ownership(&release_dir, false),
        Err(ReleaseError::OwnershipViolation { .. })
    ));
}

#[test]
fn test_proc_net_listening_parser() {
    let mock_proc_net_tcp = r#"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:12C1 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:12C2 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 100 0 0 10 0
   2: 0100007F:0016 0100007F:1234 01 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0
"#;
    // 0x12C1 is 4801, state 0A is LISTEN -> should detect true
    assert!(process::parse_proc_net_listening(mock_proc_net_tcp, 4801));
    // 0x12C2 is 4802, state 0A is LISTEN -> should detect true
    assert!(process::parse_proc_net_listening(mock_proc_net_tcp, 4802));
    // 0x0016 is 22, but state is 01 (ESTABLISHED), not 0A -> should detect false
    assert!(!process::parse_proc_net_listening(mock_proc_net_tcp, 22));
    // 4800 is not in table -> false
    assert!(!process::parse_proc_net_listening(mock_proc_net_tcp, 4800));
}

#[test]
fn test_host_public_config_validation_and_roundtrip() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("host-config.json");

    let uuid_v4 = uuid::Uuid::new_v4().to_string();
    let config = HostPublicConfig::new(
        TargetRole::Both,
        "0.2.0".to_string(),
        uuid_v4.clone(),
        Some("http://127.0.0.1:4801".to_string()),
        vec!["http://localhost:4802".to_string()],
    )
    .expect("valid public config");

    save_host_public_config(&path, &config).expect("save should succeed");
    let loaded = load_host_public_config(&path)
        .expect("load should succeed")
        .expect("should be Some");

    assert_eq!(loaded, config);
    assert_eq!(loaded.profile_id, uuid_v4);
    assert_eq!(loaded.role, TargetRole::Both);
}

#[test]
fn test_host_public_config_invalid_profile_id() {
    // Non-UUID string fails
    let res = HostPublicConfig::new(
        TargetRole::Server,
        "0.2.0".to_string(),
        "not-a-uuid".to_string(),
        Some("http://127.0.0.1:4801".to_string()),
        vec![],
    );
    assert!(res.is_err());

    // Non-v4 UUID fails (e.g. nil UUID)
    let res = HostPublicConfig::new(
        TargetRole::Server,
        "0.2.0".to_string(),
        uuid::Uuid::nil().to_string(),
        Some("http://127.0.0.1:4801".to_string()),
        vec![],
    );
    assert!(res.is_err());
}
