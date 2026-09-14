//! Integration tests for valid release manifest fixtures, round-trip parsing,
//! and role projections.

use dam_hopper_server::linux_release::*;

pub fn create_valid_manifest() -> ReleaseManifest {
    let version = "0.2.0".to_string();
    let tag = "v0.2.0".to_string();
    let sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string();

    ReleaseManifest {
        schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
        release: ReleaseMeta {
            tag: tag.clone(),
            version: version.clone(),
            commit_sha: "0123456789abcdef0123456789abcdef01234567".to_string(),
        },
        profile: ProfileMeta {
            id: PROFILE_ID.to_string(),
            os_id: PROFILE_OS_ID.to_string(),
            os_version: PROFILE_OS_VERSION.to_string(),
            arch: PROFILE_ARCH.to_string(),
            target: PROFILE_TARGET.to_string(),
            glibc_min: PROFILE_GLIBC_MIN.to_string(),
            systemd_min: PROFILE_SYSTEMD_MIN,
        },
        archive: ArchiveMeta {
            name: expected_archive_name(&tag),
            size: 15_000_000,
            sha256: sha.clone(),
        },
        components: ComponentsMeta {
            cli: ComponentVersion {
                version: version.clone(),
            },
            api: ComponentVersion {
                version: version.clone(),
            },
            web_host: ComponentVersion {
                version: version.clone(),
            },
            web_assets: ComponentVersion {
                version: version.clone(),
            },
        },
        inventory: vec![
            InventoryEntry {
                path: "bin/dam-hopper-manager".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Common],
                mode: 0o755,
                size: Some(10_000_000),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "bin/dam-hopper-server".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Server],
                mode: 0o755,
                size: Some(25_000_000),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "bin/dam-hopper-idle-suspend-helper".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Server],
                mode: 0o755,
                size: Some(5_000_000),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "bin/dam-hopper-web".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Web],
                mode: 0o755,
                size: Some(8_000_000),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "systemd/dam-hopper-api.service".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Server],
                mode: 0o644,
                size: Some(512),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "systemd/dam-hopper-idle-suspend-helper.service".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Server],
                mode: 0o644,
                size: Some(512),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "systemd/dam-hopper-web.service".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Web],
                mode: 0o644,
                size: Some(512),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "systemd/dam-hopper-recovery.service".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Common],
                mode: 0o644,
                size: Some(512),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "sysusers.d/dam-hopper-web.conf".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Web],
                mode: 0o644,
                size: Some(128),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "web".to_string(),
                kind: EntryKind::Dir,
                roles: vec![ReleaseRole::Web],
                mode: 0o755,
                size: None,
                sha256: None,
            },
            InventoryEntry {
                path: "web/index.html".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Web],
                mode: 0o644,
                size: Some(2048),
                sha256: Some(sha.clone()),
            },
            InventoryEntry {
                path: "LICENSE".to_string(),
                kind: EntryKind::File,
                roles: vec![ReleaseRole::Common],
                mode: 0o644,
                size: Some(1024),
                sha256: Some(sha),
            },
        ],
        services: ServicesMeta {
            api: ApiServiceContract {
                unit_name: API_SERVICE_UNIT.to_string(),
                identity: None,
                bind_host: API_SERVICE_BIND_HOST.to_string(),
                port: API_SERVICE_PORT,
                health_path: API_SERVICE_HEALTH_PATH.to_string(),
            },
            web: WebServiceContract {
                unit_name: WEB_SERVICE_UNIT.to_string(),
                identity: WEB_SERVICE_IDENTITY.to_string(),
                bind_host: WEB_SERVICE_BIND_HOST.to_string(),
                port: WEB_SERVICE_PORT,
                health_path: WEB_SERVICE_HEALTH_PATH.to_string(),
            },
        },
        rollback: RollbackMeta {
            previous_release_compatible: ROLLBACK_PREVIOUS_COMPATIBLE,
            state_compatibility: ROLLBACK_STATE_COMPATIBILITY.to_string(),
        },
    }
}

#[test]
fn test_valid_manifest_roundtrip() {
    let manifest = create_valid_manifest();
    let json_bytes = serde_json::to_vec(&manifest).expect("serialize manifest");
    let parsed = ReleaseManifest::parse_and_validate(&json_bytes).expect("parse and validate");
    assert_eq!(manifest, parsed);
}

#[test]
fn test_role_projections() {
    let manifest = create_valid_manifest();

    let server_entries = manifest.project_role(TargetRole::Server);
    assert!(server_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-manager"));
    assert!(server_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-server"));
    assert!(server_entries
        .iter()
        .any(|e| e.path == "systemd/dam-hopper-api.service"));
    assert!(server_entries.iter().any(|e| e.path == "LICENSE"));
    assert!(!server_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-web"));
    assert!(!server_entries
        .iter()
        .any(|e| e.path == "systemd/dam-hopper-web.service"));
    assert!(!server_entries.iter().any(|e| e.path == "web/index.html"));

    let web_entries = manifest.project_role(TargetRole::Web);
    assert!(web_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-manager"));
    assert!(web_entries.iter().any(|e| e.path == "bin/dam-hopper-web"));
    assert!(web_entries
        .iter()
        .any(|e| e.path == "systemd/dam-hopper-web.service"));
    assert!(web_entries
        .iter()
        .any(|e| e.path == "sysusers.d/dam-hopper-web.conf"));
    assert!(web_entries.iter().any(|e| e.path == "web"));
    assert!(web_entries.iter().any(|e| e.path == "web/index.html"));
    assert!(web_entries.iter().any(|e| e.path == "LICENSE"));
    assert!(!web_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-server"));
    assert!(!web_entries
        .iter()
        .any(|e| e.path == "systemd/dam-hopper-api.service"));

    let both_entries = manifest.project_role(TargetRole::Both);
    assert_eq!(both_entries.len(), manifest.inventory.len());
}

#[test]
fn test_release_and_manager_state_versions_are_independent() {
    assert_eq!(RELEASE_MANIFEST_SCHEMA_VERSION, 2);
    assert_eq!(
        ManagerState::new().schema_version,
        MANAGER_STATE_SCHEMA_VERSION
    );
}

#[test]
fn test_installed_release_accepts_v1_manifest_with_root_identity() {
    let mut manifest = create_valid_manifest();
    manifest.schema_version = 1;
    manifest.services.api.identity = Some("root".to_string());
    let bytes = serde_json::to_vec(&manifest).unwrap();

    // Strict parser rejects v1
    assert!(matches!(
        ReleaseManifest::parse_and_validate(&bytes),
        Err(ReleaseError::InvalidSchemaVersion {
            expected: 2,
            got: 1,
        })
    ));

    // Installed-release parser accepts v1
    let parsed = ReleaseManifest::parse_and_validate_installed_release(&bytes).unwrap();
    assert_eq!(parsed.schema_version, 1);
    assert_eq!(parsed.services.api.identity.as_deref(), Some("root"));
}

#[test]
fn test_installed_release_rejects_v1_with_invalid_identity() {
    let mut manifest = create_valid_manifest();
    manifest.schema_version = 1;
    manifest.services.api.identity = Some("dam-hopper".to_string());
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(
        ReleaseManifest::parse_and_validate_installed_release(&bytes),
        Err(ReleaseError::ServiceContractMismatch {
            service: "api",
            field: "identity",
            ..
        })
    ));

    manifest.services.api.identity = None;
    let bytes = serde_json::to_vec(&manifest).unwrap();
    assert!(matches!(
        ReleaseManifest::parse_and_validate_installed_release(&bytes),
        Err(ReleaseError::ServiceContractMismatch {
            service: "api",
            field: "identity",
            ..
        })
    ));
}

#[test]
fn test_v2_manifest_serialization_omits_api_identity() {
    let manifest = create_valid_manifest();
    let json_str = serde_json::to_string(&manifest).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    assert!(v["services"]["api"].get("identity").is_none());
    assert_eq!(v["services"]["web"]["identity"], "dam-hopper-web");
}

#[test]
fn test_installed_release_rejects_unsupported_schemas() {
    for unsupported_version in [0, 3] {
        let mut manifest = create_valid_manifest();
        manifest.schema_version = unsupported_version;
        let bytes = serde_json::to_vec(&manifest).unwrap();
        assert!(matches!(
            ReleaseManifest::parse_and_validate_installed_release(&bytes),
            Err(ReleaseError::InvalidSchemaVersion {
                expected: 2,
                got,
            }) if got == unsupported_version
        ));
    }
}
