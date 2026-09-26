#![cfg(target_os = "linux")]

//! Integration tests for safe staging, deployment lock, and pending candidate persistence.

mod common;

use common::release_fixtures::create_test_manifest_and_archive;
use dam_hopper_server::linux_release::*;
use sha2::{Digest, Sha256};
use std::fs;
use tempfile::tempdir;

fn configure_test_service_user(layout: &Layout, role: TargetRole) {
    let mut config = HostConfig::new(role, vec![]).expect("valid test host config");
    config.service_user = Some("nobody".to_string());
    save_host_config(&layout.host_config_path(), &config).expect("save test host config");
}

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

    let res = stage_release_bundle(&layout, bundle_dir.path(), None, &[], false, false, false);
    assert!(matches!(res, Err(ReleaseError::MissingRole)));
}

#[test]
fn test_staging_fresh_install_success() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    configure_test_service_user(&layout, TargetRole::Server);
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
        false,
    )
    .expect("staging success");

    assert_eq!(pending.tag, manifest.release.tag);
    assert_eq!(pending.role, TargetRole::Server);

    // Verify release directory was populated
    let role_dir = layout.release_role_dir(&manifest.release.tag, "server");
    assert!(role_dir.join("bin/dam-hopper-server").exists());
    assert!(!role_dir.join("bin/dam-hopper-web").exists());
    let persisted_manifest = fs::read(role_dir.join("release-manifest.json")).unwrap();
    assert_eq!(
        persisted_manifest,
        serde_json::to_vec_pretty(&manifest).unwrap()
    );

    // Verify pending.json was durably written
    let loaded_pending = load_pending_state(&layout.pending_state_path())
        .unwrap()
        .expect("loaded pending state");
    assert_eq!(loaded_pending, pending);

    // Verify candidate units are isolated to this transaction.
    let pending_units = std::path::PathBuf::from(pending.pending_units_path.as_deref().unwrap());
    assert!(pending_units.join("dam-hopper-api.service").exists());
    let api_unit_path = pending_units.join("dam-hopper-api.service");
    let api_content = fs::read_to_string(&api_unit_path).unwrap();
    let parsed_api = ParsedUnit::parse(&api_content).expect("parse staged API unit");
    let expected_api_exec = format!(
        "{}/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801",
        role_dir.display()
    );
    assert_eq!(
        parsed_api.get_all_values("Service", "ExecStart"),
        vec![expected_api_exec.as_str()]
    );
    assert!(api_content.contains("/var/lib/dam-hopper/dam-hopper.toml"));
    assert!(!api_content.contains("/etc/dam-hopper/dam-hopper.toml"));
    assert!(!api_content.contains('@'));
    assert!(!pending_units.join("dam-hopper-web.service").exists());
    assert!(pending_units
        .join("dam-hopper-idle-suspend-helper.service")
        .exists());
    let helper_hash = hex::encode(Sha256::digest(
        fs::read(pending_units.join("dam-hopper-idle-suspend-helper.service")).unwrap(),
    ));
    let loaded_manager_state = load_or_init_manager_state(&layout.manager_state_path()).unwrap();
    let loaded_candidate = loaded_manager_state
        .pending
        .as_ref()
        .expect("loaded candidate");
    assert_eq!(
        loaded_candidate.helper_unit_sha256.as_deref(),
        Some(helper_hash.as_str())
    );
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
    configure_test_service_user(&layout, TargetRole::Server);
    let bundle_dir = tempdir().unwrap();
    prepare_bundle(bundle_dir.path());

    stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &[],
        false,
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
        false,
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
        false,
    );
    assert!(matches!(res, Err(ReleaseError::InvalidBundle { .. })));
}

#[test]
fn test_staging_reinstall_overwrites_active_destination() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let bundle_dir = tempdir().unwrap();
    configure_test_service_user(&layout, TargetRole::Server);
    let (_manifest, _) = prepare_bundle(bundle_dir.path());

    let pending = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &[],
        false,
        false,
        false,
    )
    .unwrap();

    let mut state = load_or_init_manager_state(&layout.manager_state_path()).unwrap();
    state.active = Some(ReleaseRecord {
        tag: pending.tag.clone(),
        version: "0.2.0".into(),
        role: TargetRole::Server,
        release_path: pending.release_path.clone(),
        manifest_sha256: pending.manifest_sha256.clone(),
        archive_sha256: pending.archive_sha256.clone(),
        installed_at: pending.staged_at.clone(),
        committed_at: "now".into(),
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
        helper_unit_sha256: None,
        runner_unit_sha256: None,
        runner_tmpfiles_sha256: None,
        plugin_owner_user: None,
        plugin_owner_uid: None,
        plugin_admin_config_sha256: None,
        plugin_runtime_node_version: None,
        plugin_runtime_node_sha256: None,
        plugin_platform_enabled: None,
    });
    save_manager_state(&layout.manager_state_path(), &mut state).unwrap();

    let res_no_reinstall = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &[],
        false,
        false,
        false,
    );
    assert!(
        matches!(res_no_reinstall, Err(ReleaseError::InvalidBundle { ref reason, .. }) if reason.contains("cannot overwrite"))
    );

    let res_reinstall = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &[],
        false,
        false,
        true,
    );
    assert!(res_reinstall.is_ok());
}

#[test]
fn test_staging_helper_unit_and_pidfile_content() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    configure_test_service_user(&layout, TargetRole::Server);
    let bundle_dir = tempdir().unwrap();
    prepare_bundle(bundle_dir.path());

    let pending = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Server),
        &[],
        false,
        false,
        false,
    )
    .expect("staging success");

    let pending_units = std::path::PathBuf::from(pending.pending_units_path.as_deref().unwrap());

    // 1. Verify helper unit content & hardening directives
    let helper_unit_path = pending_units.join("dam-hopper-idle-suspend-helper.service");
    assert!(helper_unit_path.exists());
    let helper_content = fs::read_to_string(&helper_unit_path).unwrap();
    assert!(helper_content.contains("User=root"));
    assert!(helper_content.contains("Group=nobody"));
    assert!(helper_content.contains("ExecStart="));
    assert!(helper_content.contains("dam-hopper-idle-suspend-helper"));
    assert!(helper_content.contains("--socket /run/dam-hopper/idle-suspend.sock"));
    assert!(helper_content.contains("--audit-file /var/log/dam-hopper/idle-suspend-helper.jsonl"));
    assert!(helper_content.contains("--enrolled-pid-file /run/dam-hopper/server.pid"));
    assert!(helper_content.contains("ProtectSystem=strict"));
    assert!(helper_content.contains("ProtectHome=yes"));
    assert!(helper_content.contains("PrivateTmp=yes"));
    assert!(helper_content.contains("NoNewPrivileges=yes"));
    assert!(helper_content.contains("CapabilityBoundingSet=CAP_WAKE_ALARM"));
    assert!(helper_content.contains("Restart=on-failure"));
    assert!(helper_content.contains("RestartSec=5s"));
    assert!(
        !helper_content.contains('@'),
        "no unresolved template tokens"
    );

    // 2. Verify API unit PIDFile and lifecycle hooks
    let api_unit_path = pending_units.join("dam-hopper-api.service");
    assert!(api_unit_path.exists());
    let api_content = fs::read_to_string(&api_unit_path).unwrap();
    assert!(api_content.contains("PIDFile=/run/dam-hopper/server.pid"));
    assert!(api_content.contains("ExecStopPost=/usr/bin/rm -f /run/dam-hopper/server.pid"));
    let parsed_api = ParsedUnit::parse(&api_content).expect("parse staged API unit");
    assert_eq!(parsed_api.get_all_values("Service", "ExecStart").len(), 1);
    assert!(api_content.contains("/var/lib/dam-hopper/dam-hopper.toml"));
    assert!(!api_content.contains("/etc/dam-hopper/dam-hopper.toml"));
    assert!(!api_content.contains('@'));
}

#[test]
fn test_staging_helper_unit_role_isolation() {
    let root = tempdir().unwrap();
    let layout = Layout::with_root(root.path());
    let bundle_dir = tempdir().unwrap();
    prepare_bundle(bundle_dir.path());

    // Web role should NEVER stage helper service or API service
    let pending_web = stage_release_bundle(
        &layout,
        bundle_dir.path(),
        Some(TargetRole::Web),
        &[],
        false,
        false,
        false,
    )
    .expect("staging web success");
    let web_units = std::path::PathBuf::from(pending_web.pending_units_path.as_deref().unwrap());
    assert!(!web_units
        .join("dam-hopper-idle-suspend-helper.service")
        .exists());
    assert!(!web_units.join("dam-hopper-api.service").exists());
    assert!(web_units.join("dam-hopper-web.service").exists());
    assert!(web_units.join("dam-hopper-recovery.service").exists());

    // Both role MUST stage helper service, API service, and Web service
    let root_both = tempdir().unwrap();
    let layout_both = Layout::with_root(root_both.path());
    configure_test_service_user(&layout_both, TargetRole::Both);
    let bundle_both = tempdir().unwrap();
    prepare_bundle(bundle_both.path());
    let pending_both = stage_release_bundle(
        &layout_both,
        bundle_both.path(),
        Some(TargetRole::Both),
        &[],
        false,
        false,
        false,
    )
    .expect("staging both success");
    let both_units = std::path::PathBuf::from(pending_both.pending_units_path.as_deref().unwrap());
    assert!(both_units
        .join("dam-hopper-idle-suspend-helper.service")
        .exists());
    assert!(both_units.join("dam-hopper-api.service").exists());
    assert!(both_units.join("dam-hopper-web.service").exists());
    assert!(both_units.join("dam-hopper-recovery.service").exists());
}

#[test]
fn test_helper_unit_lifecycle_constants_and_status() {
    assert_eq!(
        HELPER_SERVICE_UNIT,
        "dam-hopper-idle-suspend-helper.service"
    );
    assert!(ALL_SERVICE_UNITS.contains(&HELPER_SERVICE_UNIT));

    let statuses = collect_all_services_status();
    let helper_status = statuses
        .iter()
        .find(|s| s.unit_name == HELPER_SERVICE_UNIT)
        .expect("helper service status present in collect_all_services_status");
    assert_eq!(helper_status.role, "server");
}
