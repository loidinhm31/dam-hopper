#[path = "plugin_test_helpers.rs"]
mod plugin_test_helpers;

use plugin_test_helpers::{build_manifest_json, create_tar_gz};
use dam_hopper_server::plugins::{
    inspect_and_validate_package, normalize_package_path, PathCollisionTracker,
};
use tar::EntryType;
use tempfile::TempDir;

#[test]
fn test_path_normalization_rules() {
    assert_eq!(normalize_package_path("backend/worker.cjs").unwrap(), "backend/worker.cjs");
    assert!(normalize_package_path("").is_err());
    assert!(normalize_package_path("/absolute/path").is_err());
    assert!(normalize_package_path("foo/../bar").is_err());
    assert!(normalize_package_path("foo/./bar").is_err());
    assert!(normalize_package_path("foo//bar").is_err());
    assert!(normalize_package_path("foo\\bar").is_err());
    assert!(normalize_package_path("foo%2fbar").is_err());
    assert!(normalize_package_path("foo%5cbar").is_err());
    assert!(normalize_package_path(" foo/bar").is_err());
    assert!(normalize_package_path("foo/bar ").is_err());
    assert!(normalize_package_path("foo:bar").is_err());
}

#[test]
fn test_path_collision_tracker() {
    let mut tracker = PathCollisionTracker::new();
    assert!(tracker.check_and_insert("backend/worker.cjs").is_ok());
    assert!(tracker.check_and_insert("backend/worker.cjs").is_err()); // duplicate
    assert!(tracker.check_and_insert("backend/WORKER.cjs").is_err()); // case collision
}

#[test]
fn test_archive_adversary_symlink_rejected() {
    let temp_dir = TempDir::new().unwrap();
    let pkg_file = temp_dir.path().join("package.tar.gz");

    let (tar_gz, _) = create_tar_gz(&[
        ("manifest.json", b"{}", 0o644, EntryType::Symlink),
    ]);
    std::fs::write(&pkg_file, &tar_gz).unwrap();

    let res = inspect_and_validate_package(&pkg_file);
    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("Only regular files and directories"));
}

#[test]
fn test_archive_adversary_undeclared_entry_rejected() {
    let temp_dir = TempDir::new().unwrap();
    let pkg_file = temp_dir.path().join("package.tar.gz");

    let worker_code = b"console.log('worker');";
    let manifest_str = build_manifest_json("test-pkg", "1.0.0", &[("backend/worker.cjs", worker_code, 0o644)]);

    let (tar_gz, _) = create_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644, EntryType::Regular),
        ("backend/worker.cjs", worker_code, 0o644, EntryType::Regular),
        ("evil.js", b"evil()", 0o644, EntryType::Regular),
    ]);
    std::fs::write(&pkg_file, &tar_gz).unwrap();

    let res = inspect_and_validate_package(&pkg_file);
    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("Undeclared archive entry 'evil.js'"));
}

#[test]
fn test_archive_adversary_inventory_mismatch_rejected() {
    let temp_dir = TempDir::new().unwrap();
    let pkg_file = temp_dir.path().join("package.tar.gz");

    let worker_code = b"console.log('worker');";
    let manifest_str = build_manifest_json("test-pkg", "1.0.0", &[("backend/worker.cjs", worker_code, 0o644)]);

    // Same length, different content triggers SHA-256 mismatch
    let corrupted_worker = b"console.log('tamper');";
    let (tar_gz, _) = create_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644, EntryType::Regular),
        ("backend/worker.cjs", corrupted_worker, 0o644, EntryType::Regular),
    ]);
    std::fs::write(&pkg_file, &tar_gz).unwrap();

    let res = inspect_and_validate_package(&pkg_file);
    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("SHA-256 mismatch"));
}
