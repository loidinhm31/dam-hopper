//! Integration tests for Linux release publisher contract, manifest validation,
//! archive integrity, and manager validation CLI command.

use clap::Parser;
use dam_hopper_server::linux_release::*;
use std::fs;
use tempfile::tempdir;

#[path = "common/release_fixtures.rs"]
mod release_fixtures;
use release_fixtures::create_test_manifest_and_archive;

#[test]
fn test_publisher_contract_manifest_and_archive_valid() {
    let temp = tempdir().expect("create temp dir");
    let (manifest, archive_bytes) = create_test_manifest_and_archive();

    let manifest_path = temp.path().join("release-manifest.json");
    let archive_path = temp.path().join(&manifest.archive.name);

    let manifest_json = serde_json::to_vec_pretty(&manifest).expect("serialize manifest");
    fs::write(&manifest_path, manifest_json).expect("write manifest");
    fs::write(&archive_path, archive_bytes).expect("write archive");

    // 1. Validate manifest file and archive via core helper
    let validated = validate_manifest_and_archive(&manifest_path, Some(&archive_path))
        .expect("validation should succeed");
    assert_eq!(validated.release.tag, "v0.2.0");
    assert_eq!(validated.release.version, "0.2.0");
    assert_eq!(validated.services.api.identity, "root");
    assert_eq!(validated.services.web.identity, "dam-hopper-web");

    // 2. Validate manifest alone without archive
    let manifest_only = validate_manifest_and_archive(&manifest_path, None)
        .expect("manifest alone should succeed");
    assert_eq!(manifest_only, manifest);

    // 3. Validate CLI parsing for `dam-hopper validate`
    let cli = Cli::parse_from([
        "dam-hopper",
        "validate",
        "--manifest",
        manifest_path.to_str().unwrap(),
        "--archive",
        archive_path.to_str().unwrap(),
    ]);

    match cli.command {
        Commands::Validate(args) => {
            assert_eq!(args.manifest, manifest_path);
            assert_eq!(args.archive, Some(archive_path));
        }
        other => panic!("Expected Validate command, got: {:?}", other),
    }
}

#[test]
fn test_publisher_contract_role_projections() {
    let (manifest, _) = create_test_manifest_and_archive();

    let server_entries = manifest.project_role(TargetRole::Server);
    let web_entries = manifest.project_role(TargetRole::Web);
    let both_entries = manifest.project_role(TargetRole::Both);

    // Server must include manager, server binary, api service unit, license
    assert!(server_entries.iter().any(|e| e.path == "bin/dam-hopper-manager"));
    assert!(server_entries.iter().any(|e| e.path == "bin/dam-hopper-server"));
    assert!(server_entries.iter().any(|e| e.path == "systemd/dam-hopper-api.service"));
    assert!(server_entries.iter().any(|e| e.path == "LICENSE"));
    // Server must NOT include web binary or web assets
    assert!(!server_entries.iter().any(|e| e.path == "bin/dam-hopper-web"));
    assert!(!server_entries.iter().any(|e| e.path == "web/index.html"));

    // Web must include manager, web binary, web service unit, sysusers, web assets, license
    assert!(web_entries.iter().any(|e| e.path == "bin/dam-hopper-manager"));
    assert!(web_entries.iter().any(|e| e.path == "bin/dam-hopper-web"));
    assert!(web_entries.iter().any(|e| e.path == "systemd/dam-hopper-web.service"));
    assert!(web_entries.iter().any(|e| e.path == "sysusers.d/dam-hopper-web.conf"));
    assert!(web_entries.iter().any(|e| e.path == "web/index.html"));
    assert!(web_entries.iter().any(|e| e.path == "LICENSE"));
    // Web must NOT include server binary or api service unit
    assert!(!web_entries.iter().any(|e| e.path == "bin/dam-hopper-server"));
    assert!(!web_entries.iter().any(|e| e.path == "systemd/dam-hopper-api.service"));

    // Both must include all inventory entries
    assert_eq!(both_entries.len(), manifest.inventory.len());
}

#[test]
fn test_publisher_contract_tampered_archive_rejected() {
    let temp = tempdir().expect("create temp dir");
    let (manifest, mut archive_bytes) = create_test_manifest_and_archive();

    let manifest_path = temp.path().join("release-manifest.json");
    let archive_path = temp.path().join(&manifest.archive.name);

    let manifest_json = serde_json::to_vec_pretty(&manifest).expect("serialize manifest");
    fs::write(&manifest_path, manifest_json).expect("write manifest");

    // Tamper with archive bytes
    if let Some(byte) = archive_bytes.get_mut(50) {
        *byte ^= 0xFF;
    }
    fs::write(&archive_path, archive_bytes).expect("write corrupted archive");

    let err = validate_manifest_and_archive(&manifest_path, Some(&archive_path))
        .expect_err("corrupted archive should be rejected");
    assert!(matches!(err, ReleaseError::Io { .. } | ReleaseError::ArchiveEntryInvalid { .. }));
}

#[test]
fn test_publisher_contract_disallowed_files_rejected() {
    let (mut manifest, _) = create_test_manifest_and_archive();

    // Inject a prohibited runtime configuration file into manifest
    manifest.inventory.push(InventoryEntry {
        path: ".env".to_string(),
        kind: EntryKind::File,
        roles: vec![ReleaseRole::Common],
        mode: 0o600,
        size: Some(10),
        sha256: Some("a".repeat(64)),
    });

    let json = serde_json::to_vec(&manifest).unwrap();
    let err = ReleaseManifest::parse_and_validate(&json)
        .expect_err(".env file should be rejected");
    assert!(matches!(err, ReleaseError::DisallowedRuntimeFile { .. }));
}

#[test]
fn test_publisher_contract_missing_required_asset_rejected() {
    let (mut manifest, _) = create_test_manifest_and_archive();

    // Remove LICENSE
    manifest.inventory.retain(|e| e.path != "LICENSE");

    let json = serde_json::to_vec(&manifest).unwrap();
    let err = ReleaseManifest::parse_and_validate(&json)
        .expect_err("missing required LICENSE asset should be rejected");
    assert!(matches!(err, ReleaseError::MissingRequiredPath { .. }));
}

#[test]
fn test_publisher_privilege_rules() {
    let temp = tempdir().expect("temp dir");
    let manifest_path = temp.path().join("release-manifest.json");

    let validate_cmd = Commands::Validate(ValidateArgs {
        manifest: manifest_path,
        archive: None,
    });

    // Validate is unprivileged: should succeed under EUID 0 or EUID 1000
    assert!(verify_privileges(&validate_cmd, 0).is_ok());
    assert!(verify_privileges(&validate_cmd, 1000).is_ok());
}

#[test]
fn test_publisher_end_to_end_scripts_and_manager_validation() {
    let temp = tempdir().expect("temp dir");
    let bin_dir = temp.path().join("bin");
    let web_dir = temp.path().join("web");
    let out_dir = temp.path().join("release");
    fs::create_dir_all(&bin_dir).unwrap();
    fs::create_dir_all(&web_dir).unwrap();

    for b in ["dam-hopper", "dam-hopper-server", "dam-hopper-web"] {
        let p = bin_dir.join(b);
        fs::write(&p, b"#!/bin/sh\necho 0.1.0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fs::write(web_dir.join("index.html"), b"<!doctype html><html>DamHopper</html>").unwrap();

    let status = std::process::Command::new("deploy/release/build-release-archive.sh")
        .args([
            "--version", "v0.1.0",
            "--target-dir", bin_dir.to_str().unwrap(),
            "--web-dist", web_dir.to_str().unwrap(),
            "--output-dir", out_dir.to_str().unwrap(),
            "--source-date-epoch", "1700000000",
        ])
        .current_dir("..")
        .status()
        .expect("run build-release-archive.sh");
    assert!(status.success(), "build-release-archive.sh failed");

    let archive_path = out_dir.join(expected_archive_name("v0.1.0"));
    assert!(archive_path.exists(), "archive was not created");

    let status = std::process::Command::new("node")
        .args([
            "deploy/release/generate-release-manifest.mjs",
            "--archive", archive_path.to_str().unwrap(),
            "--tag", "v0.1.0",
            "--commit", "0123456789abcdef0123456789abcdef01234567",
            "--output-dir", out_dir.to_str().unwrap(),
        ])
        .current_dir("..")
        .status()
        .expect("run generate-release-manifest.mjs");
    assert!(status.success(), "generate-release-manifest.mjs failed");

    let manifest_path = out_dir.join("release-manifest.json");
    assert!(manifest_path.exists(), "manifest was not created");

    // Validate with manager validate_manifest_and_archive
    let manifest = validate_manifest_and_archive(&manifest_path, Some(&archive_path))
        .expect("manager validation of generated archive must succeed");
    assert_eq!(manifest.release.tag, "v0.1.0");
    assert_eq!(manifest.release.version, "0.1.0");
    assert_eq!(manifest.services.api.identity, "root");
    assert_eq!(manifest.services.web.identity, "dam-hopper-web");
}
