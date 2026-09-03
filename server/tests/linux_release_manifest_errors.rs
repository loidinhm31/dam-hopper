//! Tests for edge cases, malformed inputs, bounds, and security invariants.

mod linux_release_manifest;
use dam_hopper_server::linux_release::*;
use linux_release_manifest::create_valid_manifest;

#[test]
fn test_reject_unknown_fields() {
    let manifest = create_valid_manifest();
    let mut val = serde_json::to_value(&manifest).unwrap();
    val.as_object_mut().unwrap().insert("extraField".to_string(), serde_json::json!("forbidden"));
    let bytes = serde_json::to_vec(&val).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::JsonDeserialization(_))));
}

#[test]
fn test_reject_payload_too_large() {
    let large_bytes = vec![b' '; MAX_MANIFEST_BYTES + 1];
    assert!(matches!(ReleaseManifest::parse_and_validate(&large_bytes), Err(ReleaseError::PayloadTooLarge(_))));
}

#[test]
fn test_reject_invalid_schema_version() {
    let mut manifest = create_valid_manifest();
    manifest.schema_version = 2;
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::InvalidSchemaVersion { expected: 1, got: 2 })));
}

#[test]
fn test_reject_version_tag_mismatch() {
    let mut manifest = create_valid_manifest();
    manifest.release.tag = "v0.2.1".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::InvalidTag { .. })));
}

#[test]
fn test_reject_prerelease_version() {
    let mut manifest = create_valid_manifest();
    manifest.release.version = "0.2.0-alpha.1".to_string();
    manifest.release.tag = "v0.2.0-alpha.1".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::InvalidVersion(_))));
}

#[test]
fn test_reject_component_version_drift() {
    let mut manifest = create_valid_manifest();
    manifest.components.api.version = "0.1.9".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::ComponentVersionMismatch { component: "api", .. })));
}

#[test]
fn test_reject_profile_drift() {
    let mut manifest = create_valid_manifest();
    manifest.profile.os_id = "ubuntu".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::ProfileMismatch { field: "osId", .. })));
}

#[test]
fn test_reject_service_identity_drift() {
    let mut manifest = create_valid_manifest();
    manifest.services.api.identity = "loidinh".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::ServiceContractMismatch { service: "api", field: "identity", .. })));
}

#[test]
fn test_reject_service_port_drift() {
    let mut manifest = create_valid_manifest();
    manifest.services.api.port = 8080;
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::ServicePortMismatch { service: "api", expected: 4801, got: 8080 })));
}

#[test]
fn test_reject_path_traversal() {
    let mut manifest = create_valid_manifest();
    manifest.inventory[0].path = "../bin/dam-hopper-manager".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::InvalidInventoryPath(_))));
}

#[test]
fn test_reject_absolute_path() {
    let mut manifest = create_valid_manifest();
    manifest.inventory[0].path = "/bin/dam-hopper-manager".to_string();
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::InvalidInventoryPath(_))));
}

#[test]
fn test_reject_disallowed_runtime_files() {
    let disallowed = [".env", "server.env", "dam-hopper.toml", "state.sqlite"];
    for bad in disallowed {
        let mut manifest = create_valid_manifest();
        manifest.inventory.push(InventoryEntry {
            path: bad.to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Common],
            mode: 0o644,
            size: Some(100),
            sha256: Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string()),
        });
        let bytes = serde_json::to_vec(&manifest).unwrap();
        assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::DisallowedRuntimeFile { .. })));
    }
}

#[test]
fn test_reject_duplicate_inventory_path() {
    let mut manifest = create_valid_manifest();
    let dup = manifest.inventory[0].clone();
    manifest.inventory.push(dup);
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::DuplicateInventoryPath(_))));
}

#[test]
fn test_reject_missing_required_path() {
    let mut manifest = create_valid_manifest();
    manifest.inventory.retain(|e| e.path != "bin/dam-hopper-manager");
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::MissingRequiredPath { path: "bin/dam-hopper-manager" })));
}

#[test]
fn test_reject_directory_with_size_or_sha() {
    let mut manifest = create_valid_manifest();
    manifest.inventory.push(InventoryEntry {
        path: "extra_dir".to_string(),
        kind: EntryKind::Dir,
        roles: vec![ReleaseRole::Common],
        mode: 0o755,
        size: Some(1024),
        sha256: None,
    });
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::UnexpectedDirectoryMetadata { .. })));
}

#[test]
fn test_reject_file_missing_size_or_sha() {
    let mut manifest = create_valid_manifest();
    manifest.inventory[0].size = None;
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(ReleaseManifest::parse_and_validate(&bytes), Err(ReleaseError::MissingFileMetadata { .. })));
}
