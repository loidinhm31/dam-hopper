use std::os::unix::fs::PermissionsExt;
use tempfile::tempdir;

use dam_hopper_server::linux_release::diagnostics::output::{write_diagnostic_bundle_to_dir, OutputError};

#[test]
fn test_fault_matrix_secure_directory_and_atomic_0600_output() {
    let tmp = tempdir().unwrap();
    let dest_dir = tmp.path().join("secure_diagnostics");
    let euid = unsafe { libc::geteuid() };

    let bundle_bytes = br#"{"bundleSchemaVersion":1,"test":"atomic_output"}"#;

    let path = write_diagnostic_bundle_to_dir(
        &dest_dir,
        "fault-matrix-bundle-id",
        1726243200000,
        bundle_bytes,
        euid,
    )
    .expect("write bundle successfully");

    assert!(path.exists());
    let file_meta = std::fs::metadata(&path).unwrap();
    assert_eq!(file_meta.permissions().mode() & 0o777, 0o600);

    let dir_meta = std::fs::metadata(&dest_dir).unwrap();
    assert_eq!(dir_meta.permissions().mode() & 0o777, 0o700);

    let symlink_dir = tmp.path().join("symlink_to_secure");
    std::os::unix::fs::symlink(&dest_dir, &symlink_dir).unwrap();

    let err = write_diagnostic_bundle_to_dir(
        &symlink_dir,
        "test-id",
        1726243200000,
        bundle_bytes,
        euid,
    )
    .unwrap_err();

    match err {
        OutputError::InvalidDirectorySecurity(msg) => {
            assert!(msg.contains("must not be a symlink"));
        }
        other => panic!("expected InvalidDirectorySecurity, got {:?}", other),
    }
}
