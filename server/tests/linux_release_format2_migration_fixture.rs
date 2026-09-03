mod common;

use common::format2_fixtures::create_format2_fixture;
use dam_hopper_server::linux_release::legacy_format2::{
    inspect_format2_root, is_legacy_format2_root, validate_format2_unit, LEGACY_FORMAT2_UNIT,
};

#[test]
fn test_exact_format2_verification_succeeds() {
    let f = create_format2_fixture();
    assert!(is_legacy_format2_root(&f.layout.opt_dir));

    let manifest = inspect_format2_root(&f.layout.opt_dir, false).unwrap();
    assert_eq!(manifest.format, 2);
    assert_eq!(manifest.nonce, f.nonce);
    assert_eq!(manifest.binary_sha256, f.binary_hash);
    assert_eq!(manifest.unit_sha256, f.unit_hash);

    let unit_path = f.layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    let unit_content = validate_format2_unit(&unit_path, &manifest.unit_sha256, false).unwrap();
    assert!(unit_content.contains("ExecStart="));
    assert!(unit_content.contains("User=loidinh"));
    assert!(unit_content.contains("Group=loidinh"));
    assert!(unit_content.contains("Restart=on-failure"));
}
