//! Integration tests for safe staging, deployment lock, and pending candidate persistence.

mod common;

use common::release_fixtures::create_test_manifest_and_archive;
use dam_hopper_server::linux_release::*;
use std::fs;
use tempfile::tempdir;

fn prepare_bundle(bundle_dir: &std::path::Path) -> (ReleaseManifest, Vec<u8>) {
    let (manifest, archive_bytes) = create_test_manifest_and_archive();
    fs::create_dir_all(bundle_dir).unwrap();
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).unwrap();
    fs::write(bundle_dir.join("release-manifest.json"), manifest_bytes).unwrap();
    fs::write(bundle_dir.join(&manifest.archive.name), &archive_bytes).unwrap();
    (manifest, archive_bytes)
}

#[test]
fn test_staging_fresh_install_requires_role() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let bundle_dir = tempdir().unwrap();
    prepare_bundle(bundle_dir.path());

    let res = stage_release_bundle(&layout, bundle_dir.path(), None, &[], false, false);
    assert!(matches!(res, Err(ReleaseError::MissingRole)));
}

#[test]
fn test_staging_fresh_install_success() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let bundle_dir = tempdir().unwrap();
    let (manifest, _) = prepare_bundle(bundle_dir.path());

    let origins = vec!["http://localhost:4802".to_string()];
    let pending = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &origins,
        false,
        false,
    )
    .expect("staging success");

    assert_eq!(pending.tag, manifest.release.tag);
    assert_eq!(pending.role, TargetRole::Server);

    // Verify release directory was populated
    let role_dir = layout.release_role_dir(&manifest.release.tag, "server");
    assert!(role_dir.join("bin/dam-hopper-server").exists());
    assert!(!role_dir.join("bin/dam-hopper-web").exists());

    // Verify pending.json was durably written
    let loaded_pending = load_pending_state(&layout.pending_state_path())
        .unwrap()
        .expect("loaded pending state");
    assert_eq!(loaded_pending, pending);

    // Verify host.toml was saved
    let host_config = load_host_config(&layout.host_config_path())
        .unwrap()
        .expect("loaded host config");
    assert_eq!(host_config.role, TargetRole::Server);
    assert_eq!(host_config.allowed_web_origins, origins);
}

#[test]
fn test_staging_upgrade_role_conflict() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let bundle_dir = tempdir().unwrap();
    prepare_bundle(bundle_dir.path());

    // First install as server
    stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &[],
        false,
        false,
    )
    .unwrap();

    // Upgrade attempting to change role to web with 'install' must fail
    let res = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Web),
        &[],
        false,
        false,
    );
    assert!(matches!(
        res,
        Err(ReleaseError::RoleConflict { ref recorded, ref requested })
            if recorded == "server" && requested == "web"
    ));

    // 'role set' can change role
    let res = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Web),
        &[],
        false,
        true,
    );
    assert!(res.is_ok());
    let host_config = load_host_config(&layout.host_config_path())
        .unwrap()
        .unwrap();
    assert_eq!(host_config.role, TargetRole::Web);
}

#[test]
fn test_staging_deployment_lock_contention() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());

    let lock1 = DeploymentLock::acquire(&layout.deploy_lock_path()).expect("acquire lock 1");
    let lock2_res = DeploymentLock::acquire(&layout.deploy_lock_path());
    assert!(matches!(lock2_res, Err(ReleaseError::DeploymentLockBusy)));

    drop(lock1);
    let lock3_res = DeploymentLock::acquire(&layout.deploy_lock_path());
    assert!(lock3_res.is_ok());
}

#[test]
fn test_staging_bundle_symlink_rejection() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let bundle_dir = tempdir().unwrap();
    let target_file = bundle_dir.path().join("real-manifest.json");
    fs::write(&target_file, "{}").unwrap();

    let symlink_path = bundle_dir.path().join("release-manifest.json");
    std::os::unix::fs::symlink(&target_file, &symlink_path).unwrap();

    let res = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Both),
        &[],
        false,
        false,
    );
    assert!(matches!(res, Err(ReleaseError::InvalidBundle { .. })));
}
