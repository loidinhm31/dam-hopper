mod common;

use common::format2_fixtures::create_format2_fixture;
use dam_hopper_server::linux_release::legacy_format2::{
    inspect_format2_root, validate_format2_unit, LEGACY_FORMAT2_UNIT,
};
use dam_hopper_server::linux_release::ReleaseError;
use sha2::{Digest, Sha256};
use std::fs;

#[test]
fn test_drift_rejects_format1_manifest() {
    let f = create_format2_fixture();
    let manifest_path = f.layout.opt_dir.join(".systemd-fresh-install").join("manifest");
    let content = format!(
        "binary_sha256={}\nformat=1\nnonce={}\nunit_sha256={}\n",
        f.binary_hash, f.nonce, f.unit_hash
    );
    fs::write(manifest_path, content).unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::UnsupportedFormat1Migration(_)));
}

#[test]
fn test_drift_rejects_legacy_web_directory() {
    let f = create_format2_fixture();
    let web_dir = f.layout.opt_dir.join("web");
    fs::create_dir_all(web_dir).unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::UnsupportedFormat1Migration(_)));
}

#[test]
fn test_drift_rejects_extra_root_entries() {
    let f = create_format2_fixture();
    let extra_file = f.layout.opt_dir.join("unmanaged.txt");
    fs::write(extra_file, "extra").unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_altered_binary() {
    let f = create_format2_fixture();
    let bin_path = f.layout.opt_dir.join("bin").join("dam-hopper-server");
    fs::write(bin_path, b"modified-binary-content").unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_nonce_mismatch() {
    let f = create_format2_fixture();
    let nonce_path = f.layout.opt_dir.join(".systemd-fresh-install").join("nonce");
    fs::write(nonce_path, "00000000000000000000000000000000").unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_unit_missing_required_user() {
    let f = create_format2_fixture();
    let unit_path = f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    let content = fs::read_to_string(&unit_path).unwrap().replace("User=loidinh", "User=nobody");
    fs::write(&unit_path, &content).unwrap();
    let new_hash = hex::encode(Sha256::digest(content.as_bytes()));

    let err = validate_format2_unit(&unit_path, &new_hash, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_unit_forbidden_no_auth() {
    let f = create_format2_fixture();
    let unit_path = f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    let content = fs::read_to_string(&unit_path).unwrap() + "Environment=DAM_HOPPER_NO_AUTH=1\n";
    fs::write(&unit_path, &content).unwrap();
    let new_hash = hex::encode(Sha256::digest(content.as_bytes()));

    let err = validate_format2_unit(&unit_path, &new_hash, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_unit_drop_in() {
    let f = create_format2_fixture();
    let drop_in = f.layout.systemd_unit_dir.join("dam-hopper.service.d");
    fs::create_dir_all(drop_in).unwrap();
    let unit_path = f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);

    let err = validate_format2_unit(&unit_path, &f.unit_hash, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_extra_file_in_bin() {
    let f = create_format2_fixture();
    let extra = f.layout.opt_dir.join("bin").join("unexpected.sh");
    fs::write(extra, "echo hi").unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}

#[test]
fn test_drift_rejects_extra_file_in_marker() {
    let f = create_format2_fixture();
    let extra = f.layout.opt_dir.join(".systemd-fresh-install").join("other.txt");
    fs::write(extra, "unexpected").unwrap();

    let err = inspect_format2_root(&f.layout.opt_dir, false).unwrap_err();
    assert!(matches!(err, ReleaseError::LegacyMigrationRejected { .. }));
}
