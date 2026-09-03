mod common;

use common::format2_fixtures::create_format2_fixture;
use dam_hopper_server::linux_release::legacy_format2::{
    import_legacy_format2_release, LegacyFormat2Evidence, LegacyFormat2Manifest,
    LEGACY_FORMAT2_TAG, LEGACY_FORMAT2_UNIT,
};
use dam_hopper_server::linux_release::migration::{
    commit_migration_cleanup, create_migration_workspace, execute_migration_exchange,
    rollback_migration_exchange,
};
use dam_hopper_server::linux_release::state_record::MigrationRecord;
use std::fs;
use std::path::Path;
use std::os::unix::fs::PermissionsExt;

#[test]
fn test_import_and_atomic_exchange_lifecycle() {
    let f = create_format2_fixture();
    let tx_id = "tx-integration-test";

    // 1. Create migration workspace on same device
    let mig_root = create_migration_workspace(&f.layout, tx_id).unwrap();
    assert!(mig_root.exists());
    assert!(mig_root.join(".migration-transaction").exists());

    // 2. Import legacy release into candidate releases directory
    let evidence = LegacyFormat2Evidence {
        root_path: f.layout.opt_dir.clone(),
        binary_path: f.layout.opt_dir.join("bin").join("dam-hopper-server"),
        binary_sha256: f.binary_hash.clone(),
        unit_path: f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT),
        unit_sha256: f.unit_hash.clone(),
        unit_content: fs::read_to_string(f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT)).unwrap(),
        wants_link_path: f.layout.systemd_unit_dir.join("multi-user.target.wants").join(LEGACY_FORMAT2_UNIT),
        manifest: LegacyFormat2Manifest {
            format: 2,
            nonce: f.nonce.clone(),
            binary_sha256: f.binary_hash.clone(),
            unit_sha256: f.unit_hash.clone(),
        },
        pid: 0,
        uid: 0,
        gid: 0,
        api_version: "0.1.0".into(),
        device_id: 0,
    };

    let imported_record = import_legacy_format2_release(
        &evidence,
        &mig_root.join("releases").join(LEGACY_FORMAT2_TAG),
    )
    .unwrap();
    assert_eq!(imported_record.tag, LEGACY_FORMAT2_TAG);
    assert_eq!(imported_record.api_unit_sha256, Some(f.unit_hash.clone()));

    // Create a mock candidate in the workspace
    let cand_dir = mig_root.join("releases").join("v1.0.0").join("server");
    fs::create_dir_all(&cand_dir).unwrap();
    fs::write(cand_dir.join("marker.txt"), "candidate").unwrap();

    // 3. Atomic root exchange
    let mut mig_record = MigrationRecord {
        legacy_root: f.layout.opt_dir.display().to_string(),
        migration_root: mig_root.display().to_string(),
        legacy_binary_sha256: f.binary_hash.clone(),
        legacy_unit_sha256: f.unit_hash.clone(),
        exchanged: false,
        old_unit_backup_path: f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT).display().to_string(),
        old_wants_link_path: f.layout.systemd_unit_dir.join("multi-user.target.wants").join(LEGACY_FORMAT2_UNIT).display().to_string(),
    };

    execute_migration_exchange(&f.layout, &mut mig_record).unwrap();
    assert!(mig_record.exchanged);

    // Canonical opt_dir now has candidate releases directory!
    assert!(f.layout.opt_dir.join("releases").join("v1.0.0").join("server").join("marker.txt").exists());
    // And mig_root now has the old format-2 binary!
    assert!(Path::new(&mig_record.migration_root).join("bin").join("dam-hopper-server").exists());

    // 4. Commit cleanup removes old exchanged root
    commit_migration_cleanup(&f.layout, &mig_record).unwrap();
    assert!(!Path::new(&mig_record.migration_root).exists());
    assert!(!f.layout.opt_dir.join(".migration-transaction").exists());
}

#[test]
fn test_atomic_exchange_rollback_restores_original_root() {
    let f = create_format2_fixture();
    let tx_id = "tx-rollback-test";

    let mig_root = create_migration_workspace(&f.layout, tx_id).unwrap();
    let cand_dir = mig_root.join("releases").join("v1.0.0").join("server");
    fs::create_dir_all(&cand_dir).unwrap();

    let mut mig_record = MigrationRecord {
        legacy_root: f.layout.opt_dir.display().to_string(),
        migration_root: mig_root.display().to_string(),
        legacy_binary_sha256: f.binary_hash.clone(),
        legacy_unit_sha256: f.unit_hash.clone(),
        exchanged: false,
        old_unit_backup_path: f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT).display().to_string(),
        old_wants_link_path: f.layout.systemd_unit_dir.join("multi-user.target.wants").join(LEGACY_FORMAT2_UNIT).display().to_string(),
    };

    execute_migration_exchange(&f.layout, &mut mig_record).unwrap();
    assert!(f.layout.opt_dir.join("releases").exists());

    // Rollback
    rollback_migration_exchange(&f.layout, &mig_record).unwrap();

    // Canonical opt_dir is back to the exact format-2 root!
    assert!(!f.layout.opt_dir.join("releases").exists());
    assert!(f.layout.opt_dir.join(".systemd-fresh-install").join("manifest").exists());
    assert!(f.layout.opt_dir.join("bin").join("dam-hopper-server").exists());
}

#[test]
fn test_retention_allows_imported_format2_and_prunes_when_unreferenced() {
    let f = create_format2_fixture();
    let mut state = dam_hopper_server::linux_release::load_or_init_manager_state(&f.layout.manager_state_path()).unwrap();

    // Create imported-format-2 release tree
    let imported_dir = f.layout.releases_dir().join(LEGACY_FORMAT2_TAG);
    let srv_bin = imported_dir.join("server").join("bin");
    let srv_unit = imported_dir.join("server").join("systemd");
    fs::create_dir_all(&srv_bin).unwrap();
    fs::create_dir_all(&srv_unit).unwrap();
    let bin_path = srv_bin.join("dam-hopper-server");
    fs::write(&bin_path, b"imported-bin").unwrap();
    fs::set_permissions(&bin_path, fs::Permissions::from_mode(0o755)).unwrap();
    let unit_path = srv_unit.join(LEGACY_FORMAT2_UNIT);
    fs::write(&unit_path, b"[Unit]\nDescription=legacy\n").unwrap();
    fs::set_permissions(&unit_path, fs::Permissions::from_mode(0o644)).unwrap();

    // 1. When referenced as previous, apply_retention preserves it
    state.previous = Some(dam_hopper_server::linux_release::ReleaseRecord {
        tag: LEGACY_FORMAT2_TAG.to_string(),
        version: "imported".to_string(),
        role: dam_hopper_server::linux_release::TargetRole::Server,
        release_path: imported_dir.display().to_string(),
        manifest_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        archive_sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
        installed_at: "2026-09-04T00:00:00Z".into(),
        committed_at: "2026-09-04T00:00:00Z".into(),
        api_unit_sha256: None,
        web_unit_sha256: None,
        host_config_sha256: None,
    });
    dam_hopper_server::linux_release::save_manager_state(&f.layout.manager_state_path(), &mut state).unwrap();

    let pruned = dam_hopper_server::linux_release::apply_retention(&f.layout, &state).unwrap();
    assert_eq!(pruned, 0);
    assert!(imported_dir.exists());

    // 2. When unreferenced, apply_retention safely prunes it without aborting on tag validation
    state.previous = None;
    dam_hopper_server::linux_release::save_manager_state(&f.layout.manager_state_path(), &mut state).unwrap();

    let pruned_unref = dam_hopper_server::linux_release::apply_retention(&f.layout, &state).unwrap();
    assert_eq!(pruned_unref, 1);
    assert!(!imported_dir.exists());
}
