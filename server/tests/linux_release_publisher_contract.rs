#![cfg(target_os = "linux")]

//! Integration tests for Linux release publisher contract, manifest validation,
//! archive integrity, and manager validation CLI command.

use chrono::{Duration, SecondsFormat, Utc};
use clap::Parser;
use dam_hopper_server::linux_release::*;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output};
use tempfile::tempdir;

#[path = "common/release_fixtures.rs"]
mod release_fixtures;
use release_fixtures::{build_archive, create_test_manifest_and_archive};

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
    assert_eq!(validated.services.web.identity, "dam-hopper-web");

    // 2. Validate manifest alone without archive
    let manifest_only =
        validate_manifest_and_archive(&manifest_path, None).expect("manifest alone should succeed");
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
    // Server must NOT include web binary or web assets
    assert!(!server_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-web"));
    assert!(!server_entries.iter().any(|e| e.path == "web/index.html"));

    // Web must include manager, web binary, web service unit, sysusers, web assets, license
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
    assert!(web_entries.iter().any(|e| e.path == "web/index.html"));
    assert!(web_entries.iter().any(|e| e.path == "LICENSE"));
    // Web must NOT include server binary or api service unit
    assert!(!web_entries
        .iter()
        .any(|e| e.path == "bin/dam-hopper-server"));
    assert!(!web_entries
        .iter()
        .any(|e| e.path == "systemd/dam-hopper-api.service"));

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
    assert!(matches!(
        err,
        ReleaseError::Io { .. } | ReleaseError::ArchiveEntryInvalid { .. }
    ));
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
    let err = ReleaseManifest::parse_and_validate(&json).expect_err(".env file should be rejected");
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

    for b in [
        "dam-hopper",
        "dam-hopper-server",
        "dam-hopper-idle-suspend-helper",
        "dam-hopper-web",
    ] {
        let p = bin_dir.join(b);
        fs::write(&p, b"#!/bin/sh\necho 0.1.0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fs::write(
        web_dir.join("index.html"),
        b"<!doctype html><html>DamHopper</html>",
    )
    .unwrap();

    let status = std::process::Command::new("deploy/release/build-release-archive.sh")
        .args([
            "--version",
            "v0.1.0",
            "--target-dir",
            bin_dir.to_str().unwrap(),
            "--web-dist",
            web_dir.to_str().unwrap(),
            "--output-dir",
            out_dir.to_str().unwrap(),
            "--source-date-epoch",
            "1700000000",
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
            "--archive",
            archive_path.to_str().unwrap(),
            "--tag",
            "v0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
            "--output-dir",
            out_dir.to_str().unwrap(),
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
    assert_eq!(manifest.services.web.identity, "dam-hopper-web");
}

fn sha256_file(path: &Path) -> String {
    hex::encode(Sha256::digest(fs::read(path).expect("read file for digest")))
}
fn sha256_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn build_rollback_archive(archive_bytes: &[u8], manager_content: &[u8]) -> Vec<u8> {
    let decoder = flate2::read::GzDecoder::new(archive_bytes);
    let mut archive = tar::Archive::new(decoder);
    let mut entries = Vec::new();
    for entry in archive.entries().expect("read archive entries") {
        let mut entry = entry.expect("read archive entry");
        let path = entry
            .path()
            .expect("read archive path")
            .to_str()
            .expect("archive path is UTF-8")
            .to_string();
        let is_dir = entry.header().entry_type().is_dir();
        let mode = entry.header().mode().expect("read archive mode");
        let mut content = Vec::new();
        entry
            .read_to_end(&mut content)
            .expect("read archive content");
        if path == "bin/dam-hopper-manager" {
            content = manager_content.to_vec();
        }
        entries.push((path, is_dir, content, mode));
    }
    entries.reverse();
    let references = entries
        .iter()
        .map(|(path, is_dir, content, mode)| (path.as_str(), *is_dir, content.as_slice(), *mode))
        .collect::<Vec<_>>();
    build_archive(&references)
}


fn run_migration_gate(asset_dir: &Path, evidence_path: &Path) -> Output {
    Command::new("node")
        .args([
            "deploy/release/check-release-assets.mjs",
            "--tag",
            "v0.2.0",
            "--dir",
            asset_dir.to_str().expect("asset path is UTF-8"),
            "--migration-evidence",
            evidence_path.to_str().expect("evidence path is UTF-8"),
            "--require-migration-gate",
        ])
        .current_dir("..")
        .output()
        .expect("run migration gate")
}

fn run_remote_asset_gate(assets_json_path: &Path) -> Output {
    Command::new("node")
        .args([
            "deploy/release/check-release-assets.mjs",
            "--tag",
            "v0.2.0",
            "--assets-json",
            assets_json_path.to_str().expect("asset metadata path is UTF-8"),
        ])
        .current_dir("..")
        .output()
        .expect("run remote asset gate")
}
fn run_remote_asset_gate_with_dir(asset_dir: &Path, assets_json_path: &Path) -> Output {
    Command::new("node")
        .args([
            "deploy/release/check-release-assets.mjs",
            "--tag",
            "v0.2.0",
            "--dir",
            asset_dir.to_str().expect("asset path is UTF-8"),
            "--assets-json",
            assets_json_path.to_str().expect("asset metadata path is UTF-8"),
        ])
        .current_dir("..")
        .output()
        .expect("run remote asset gate with local directory")
}

fn run_remote_selector_gate(args: &[&str]) -> Output {
    Command::new("node")
        .args(["deploy/release/check-release-assets.mjs"])
        .args(args)
        .env_remove("GITHUB_REPOSITORY")
        .current_dir("..")
        .output()
        .expect("run remote selector gate")
}

fn run_remote_api_asset_gate(
    args: &[&str],
    gh_dir: &Path,
    fixture_path: &Path,
) -> Output {
    let mut path_entries = vec![gh_dir.to_path_buf()];
    if let Some(path) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&path));
    }
    let path = std::env::join_paths(path_entries).expect("join fake gh PATH");
    Command::new("node")
        .args(["deploy/release/check-release-assets.mjs"])
        .args(args)
        .env_remove("GITHUB_REPOSITORY")
        .env("PATH", path)
        .env("GH_FIXTURE", fixture_path)
        .current_dir("..")
        .output()
        .expect("run remote API asset gate")
}

#[test]
fn test_publisher_migration_gate_requires_homogeneous_fresh_signed_v2_evidence() {
    let temp = tempdir().expect("create temp dir");
    let assets_dir = temp.path().join("assets");
    let rollback_dir = temp.path().join("rollback");
    fs::create_dir_all(&assets_dir).expect("create asset dir");
    fs::create_dir_all(&rollback_dir).expect("create rollback dir");

    let (manifest, archive_bytes) = create_test_manifest_and_archive();
    let rollback_manager_content = b"manager binary content for v0.1.0";
    let rollback_archive_bytes =
        build_rollback_archive(&archive_bytes, rollback_manager_content);
    assert_ne!(
        sha256_bytes(&rollback_archive_bytes),
        sha256_bytes(&archive_bytes),
        "rollback archive fixture must have distinct bytes",
    );
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).expect("serialize forward manifest");
    let manifest_path = assets_dir.join("release-manifest.json");
    let archive_path = assets_dir.join(&manifest.archive.name);
    fs::write(&manifest_path, &manifest_bytes).expect("write forward manifest");
    fs::write(&archive_path, &archive_bytes).expect("write release archive");
    fs::write(assets_dir.join("dam-hopper-install.sh"), b"#!/usr/bin/env bash\nset -e\n")
        .expect("write installer");
    fs::write(
        assets_dir.join("dam-hopper-v0.2.0-linux-x86_64-systemd.spdx.json"),
        br#"{"spdxVersion":"SPDX-2.3","name":"dam-hopper"}"#,
    )
    .expect("write SBOM");

    let mut rollback_manifest = serde_json::to_value(&manifest).expect("serialize rollback base");
    rollback_manifest["release"]["tag"] = serde_json::json!("v0.1.0");
    rollback_manifest["release"]["version"] = serde_json::json!("0.1.0");
    for component in ["cli", "api", "webHost", "webAssets"] {
        rollback_manifest["components"][component]["version"] = serde_json::json!("0.1.0");
    }
    rollback_manifest["archive"]["name"] =
        serde_json::json!("dam-hopper-v0.1.0-linux-x86_64-systemd.tar.gz");
    rollback_manifest["archive"]["size"] = serde_json::json!(rollback_archive_bytes.len());
    rollback_manifest["archive"]["sha256"] =
        serde_json::json!(sha256_bytes(&rollback_archive_bytes));
    let rollback_inventory = rollback_manifest["inventory"]
        .as_array_mut()
        .expect("rollback inventory array");
    let manager_entry = rollback_inventory
        .iter_mut()
        .find(|entry| entry.get("path").and_then(|path| path.as_str()) == Some("bin/dam-hopper-manager"))
        .expect("rollback manager inventory entry");
    manager_entry["size"] = serde_json::json!(rollback_manager_content.len());
    manager_entry["sha256"] = serde_json::json!(sha256_bytes(rollback_manager_content));
    let source_manifest_path = rollback_dir.join("source-manifest.json");
    let rollback_manifest_path = rollback_dir.join("release-manifest.json");
    let rollback_archive_path = rollback_dir.join(
        rollback_manifest["archive"]["name"]
            .as_str()
            .expect("rollback archive name"),
    );
    fs::write(&rollback_archive_path, &rollback_archive_bytes).expect("write rollback archive");
    fs::write(
        &source_manifest_path,
        serde_json::to_vec(&rollback_manifest).expect("serialize source manifest"),
    )
    .expect("write source rollback manifest");
    fs::write(
        &rollback_manifest_path,
        serde_json::to_vec_pretty(&rollback_manifest).expect("serialize regenerated manifest"),
    )
    .expect("write regenerated rollback manifest");

    let rollback_validated =
        validate_manifest_and_archive(&rollback_manifest_path, Some(&rollback_archive_path))
            .expect("rollback archive must match its regenerated inventory");
    assert_eq!(rollback_validated.release.version, "0.1.0");

    let generated_at =
        (Utc::now() - Duration::hours(1)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let expires_at =
        (Utc::now() + Duration::hours(1)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let forward_digest = sha256_file(&manifest_path);
    let forward_archive_digest = sha256_file(&archive_path);
    let rollback_digest = sha256_file(&rollback_manifest_path);
    let rollback_archive_digest = sha256_file(&rollback_archive_path);
    let source_digest = sha256_file(&source_manifest_path);
    let manager_digest = manifest
        .inventory
        .iter()
        .find(|entry| entry.path == "bin/dam-hopper-manager")
        .and_then(|entry| entry.sha256.clone())
        .expect("manager inventory digest");
    let evidence_path = temp.path().join("migration-evidence.json");
    let evidence = serde_json::json!({
        "schemaVersion": 1,
        "releaseTag": "v0.2.0",
        "environment": "production",
        "generatedAt": generated_at,
        "expiresAt": expires_at,
        "managerFirst": true,
        "inventoryComplete": true,
        "managerInventory": [{
            "id": "manager-prod-01",
            "releaseTag": "v0.2.0",
            "environment": "production",
            "manifestSchemaVersion": 2,
            "stateSchemaVersion": 1,
            "attestation": {
                "provider": "github-actions-attestation",
                "subject": "dam-hopper-manager",
                "verified": true,
                "subjectSha256": manager_digest,
                "verifiedAt": generated_at
            }
        }, {
            "id": "manager-prod-02",
            "releaseTag": "v0.2.0",
            "environment": "production",
            "manifestSchemaVersion": 2,
            "stateSchemaVersion": 1,
            "attestation": {
                "provider": "github-actions-attestation",
                "subject": "dam-hopper-manager",
                "verified": true,
                "subjectSha256": manager_digest,
                "verifiedAt": generated_at
            }
        }],
        "forward": {
            "manifestPath": "assets/release-manifest.json",
            "archivePath": format!("assets/{}", manifest.archive.name),
            "releaseTag": "v0.2.0",
            "manifestSchemaVersion": 2,
            "generatedAt": generated_at,
            "generated": true,
            "signed": true,
            "manifestSha256": forward_digest,
            "archiveSha256": forward_archive_digest,
            "signature": {
                "provider": "github-actions-attestation",
                "verified": true,
                "subjectSha256": forward_digest
            }
        },
        "rollback": {
            "manifestPath": "rollback/release-manifest.json",
            "archivePath": format!("rollback/{}", rollback_manifest["archive"]["name"].as_str().unwrap()),
            "releaseTag": "v0.1.0",
            "manifestSchemaVersion": 2,
            "generatedAt": generated_at,
            "sourceManifestPath": "rollback/source-manifest.json",
            "sourceManifestSchemaVersion": 2,
            "sourceManifestSha256": source_digest,
            "regenerated": true,
            "signed": true,
            "manifestSha256": rollback_digest,
            "archiveSha256": rollback_archive_digest,
            "signature": {
                "provider": "github-actions-attestation",
                "verified": true,
                "subjectSha256": rollback_digest
            }
        },
        "active": {
            "releaseTag": "v0.1.0",
            "manifestSchemaVersion": 1
        }
    });

    fs::write(
        &evidence_path,
        serde_json::to_vec_pretty(&evidence).expect("serialize migration evidence"),
    )
    .expect("write migration evidence");
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let hidden_link = assets_dir.join(".hidden-link");
        symlink(&archive_path, &hidden_link).expect("create hidden symlink");
        let output = run_migration_gate(&assets_dir, &evidence_path);
        assert!(!output.status.success(), "hidden symlink unexpectedly passed");
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            combined.contains("not a regular file"),
            "hidden symlink error missing: {combined}"
        );
        fs::remove_file(&hidden_link).expect("remove hidden symlink");
    }

    let valid = run_migration_gate(&assets_dir, &evidence_path);
    assert!(
        valid.status.success(),
        "valid migration evidence rejected: stdout={}, stderr={}",
        String::from_utf8_lossy(&valid.stdout),
        String::from_utf8_lossy(&valid.stderr)
    );

    let oversized_evidence_path = temp.path().join("oversized-evidence.json");
    let oversized_evidence = format!("{{\"padding\":\"{}\"}}", "x".repeat(1_100_000));
    fs::write(&oversized_evidence_path, oversized_evidence).expect("write oversized evidence");
    let oversized_output = run_migration_gate(&assets_dir, &oversized_evidence_path);
    assert!(
        !oversized_output.status.success(),
        "oversized migration evidence unexpectedly passed"
    );
    let oversized_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&oversized_output.stdout),
        String::from_utf8_lossy(&oversized_output.stderr)
    );
    assert!(
        oversized_combined.contains("exceeds 1048576 bytes"),
        "oversized evidence error missing: {oversized_combined}"
    );

    fs::write(&manifest_path, vec![b' '; 1_100_000]).expect("write oversized manifest");
    let oversized_manifest_output = run_migration_gate(&assets_dir, &evidence_path);
    assert!(
        !oversized_manifest_output.status.success(),
        "oversized manifest unexpectedly passed"
    );
    let oversized_manifest_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&oversized_manifest_output.stdout),
        String::from_utf8_lossy(&oversized_manifest_output.stderr)
    );
    assert!(
        oversized_manifest_combined.contains("exceeds 1048576 bytes"),
        "oversized manifest error missing: {oversized_manifest_combined}"
    );
    fs::write(&manifest_path, &manifest_bytes).expect("restore forward manifest");

    let remote_asset_names = [
        "dam-hopper-install.sh",
        "dam-hopper-v0.2.0-linux-x86_64-systemd.tar.gz",
        "release-manifest.json",
        "dam-hopper-v0.2.0-linux-x86_64-systemd.spdx.json",
    ];
    let mut remote_assets: Vec<serde_json::Value> = remote_asset_names
        .iter()
        .map(|name| {
            let path = assets_dir.join(name);
            serde_json::json!({
                "name": name,
                "size": fs::metadata(&path).expect("remote asset metadata").len(),
                "state": "uploaded",
                "digest": format!("sha256:{}", sha256_file(&path))
            })
        })
        .collect();
    let remote_assets_path = temp.path().join("remote-assets-with-digests.json");
    fs::write(
        &remote_assets_path,
        serde_json::to_vec_pretty(&remote_assets).expect("serialize remote asset metadata"),
    )
    .expect("write remote asset metadata");
    let remote_valid = run_remote_asset_gate_with_dir(&assets_dir, &remote_assets_path);
    assert!(
        remote_valid.status.success(),
        "valid remote digest metadata rejected: {}",
        String::from_utf8_lossy(&remote_valid.stderr)
    );
    remote_assets[0]["digest"] = serde_json::json!(format!("sha256:{}", "b".repeat(64)));
    fs::write(
        &remote_assets_path,
        serde_json::to_vec_pretty(&remote_assets)
            .expect("serialize mismatched remote asset metadata"),
    )
    .expect("write mismatched remote asset metadata");
    let remote_invalid = run_remote_asset_gate_with_dir(&assets_dir, &remote_assets_path);
    assert!(!remote_invalid.status.success(), "remote digest mismatch passed");
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&remote_invalid.stdout),
        String::from_utf8_lossy(&remote_invalid.stderr)
    );
    assert!(
        combined.contains("digest") && combined.contains("differs from local"),
        "remote digest mismatch error missing: {combined}"
    );

    for (name, mut invalid, expected_error) in [
        (
            "mixed-manager",
            evidence.clone(),
            "schema version 2",
        ),
        (
            "manager-inventory-too-large",
            evidence.clone(),
            "1..1024 targets",
        ),
        (
            "manager-id-too-long",
            evidence.clone(),
            "exceeds 128 UTF-8 bytes",
        ),
        (
            "stale",
            evidence.clone(),
            "evidence is stale",
        ),
        (
            "invalid-calendar",
            evidence.clone(),
            "valid UTC",
        ),
        (
            "missing-web-directory",
            evidence.clone(),
            "missing required paths",
        ),
        (
            "utf8-path",
            evidence.clone(),
            "normalized relative path",
        ),
        (
            "unsigned-forward",
            evidence.clone(),
            "signature must be verified",
        ),
        (
            "reused-rollback",
            evidence.clone(),
            "must be distinct",
        ),
        (
            "api-identity",
            evidence.clone(),
            "services.api must contain exactly",
        ),
        (
            "wrong-environment",
            evidence.clone(),
            "must be production",
        ),
        (
            "future-evidence",
            evidence.clone(),
            "generatedAt is in the future",
        ),
        (
            "long-expiry",
            evidence.clone(),
            "maximum lifetime",
        ),
        (
            "detached-forward",
            evidence.clone(),
            "safe relative path",
        ),
        (
            "rollback-archive",
            evidence.clone(),
            "archiveSha256 does not match archive bytes",
        ),
        (
            "manager-digest",
            evidence.clone(),
            "does not match the published manager",
        ),
        (
            "schema1-forward",
            evidence.clone(),
            "schema version 2",
        ),
        (
            "malformed-nested",
            evidence.clone(),
            "must contain exactly",
        ),
    ] {
        let restore_manifest = matches!(
            name,
            "missing-web-directory"
                | "utf8-path"
                | "schema1-forward"
                | "malformed-nested"
                | "api-identity"
        );
        match name {
            "mixed-manager" => {
                invalid["managerInventory"][0]["manifestSchemaVersion"] = serde_json::json!(1);
            }
            "manager-inventory-too-large" => {
                let base_manager = invalid["managerInventory"][0].clone();
                invalid["managerInventory"] = serde_json::Value::Array(
                    (0..1025)
                        .map(|index| {
                            let mut manager = base_manager.clone();
                            manager["id"] = serde_json::json!(format!("manager-prod-{index:04}"));
                            manager
                        })
                        .collect(),
                );
            }
            "manager-id-too-long" => {
                invalid["managerInventory"][0]["id"] = serde_json::json!("x".repeat(129));
            }
            "stale" => {
                invalid["generatedAt"] = serde_json::json!(
                    (Utc::now() - Duration::hours(48))
                        .to_rfc3339_opts(SecondsFormat::Secs, true)
                );
            }
            "invalid-calendar" => {
                invalid["generatedAt"] = serde_json::json!("2026-02-31T00:00:00Z");
            }
            "missing-web-directory" => {
                let mut missing_web_manifest =
                    serde_json::to_value(&manifest).expect("serialize missing web manifest");
                missing_web_manifest["inventory"]
                    .as_array_mut()
                    .expect("manifest inventory array")
                    .retain(|entry| {
                        entry.get("path").and_then(|path| path.as_str()) != Some("web")
                    });
                fs::write(
                    &manifest_path,
                    serde_json::to_vec_pretty(&missing_web_manifest)
                        .expect("serialize missing web manifest bytes"),
                )
                .expect("write missing web manifest");
                let missing_web_digest = sha256_file(&manifest_path);
                invalid["forward"]["manifestSha256"] = serde_json::json!(missing_web_digest);
                invalid["forward"]["signature"]["subjectSha256"] =
                    serde_json::json!(missing_web_digest);
            }
            "utf8-path" => {
                let mut long_path_manifest =
                    serde_json::to_value(&manifest).expect("serialize long path manifest");
                long_path_manifest["inventory"]
                    .as_array_mut()
                    .expect("manifest inventory array")
                    .push(serde_json::json!({
                        "path": format!("web/{}", "é".repeat(126)),
                        "kind": "file",
                        "roles": ["web"],
                        "mode": 420,
                        "size": 1,
                        "sha256": "a".repeat(64)
                    }));
                fs::write(
                    &manifest_path,
                    serde_json::to_vec_pretty(&long_path_manifest)
                        .expect("serialize long path manifest bytes"),
                )
                .expect("write long path manifest");
                let long_path_digest = sha256_file(&manifest_path);
                invalid["forward"]["manifestSha256"] = serde_json::json!(long_path_digest);
                invalid["forward"]["signature"]["subjectSha256"] =
                    serde_json::json!(long_path_digest);
            }
            "unsigned-forward" => {
                invalid["forward"]["signature"]["verified"] = serde_json::json!(false);
            }
            "reused-rollback" => {
                invalid["rollback"]["manifestPath"] =
                    serde_json::json!("rollback/source-manifest.json");
                invalid["rollback"]["manifestSha256"] = serde_json::json!(source_digest);
                invalid["rollback"]["signature"]["subjectSha256"] =
                    serde_json::json!(source_digest);
            }
            "api-identity" => {
                let mut identity_manifest =
                    serde_json::to_value(&manifest).expect("serialize identity manifest");
                identity_manifest["services"]["api"]["identity"] =
                    serde_json::json!("dam-hopper");
                fs::write(
                    &manifest_path,
                    serde_json::to_vec_pretty(&identity_manifest)
                        .expect("serialize identity manifest bytes"),
                )
                .expect("write identity manifest");
                let identity_digest = sha256_file(&manifest_path);
                invalid["forward"]["manifestSha256"] = serde_json::json!(identity_digest);
                invalid["forward"]["signature"]["subjectSha256"] =
                    serde_json::json!(identity_digest);
            }
            "wrong-environment" => {
                invalid["environment"] = serde_json::json!("staging");
            }
            "future-evidence" => {
                invalid["generatedAt"] = serde_json::json!(
                    (Utc::now() + Duration::hours(1))
                        .to_rfc3339_opts(SecondsFormat::Secs, true)
                );
                invalid["expiresAt"] = serde_json::json!(
                    (Utc::now() + Duration::hours(2))
                        .to_rfc3339_opts(SecondsFormat::Secs, true)
                );
            }
            "long-expiry" => {
                invalid["expiresAt"] = serde_json::json!(
                    (Utc::now() + Duration::hours(48))
                        .to_rfc3339_opts(SecondsFormat::Secs, true)
                );
            }
            "detached-forward" => {
                invalid["forward"]["manifestPath"] =
                    serde_json::json!("assets/../assets/release-manifest.json");
            }
            "rollback-archive" => {
                invalid["rollback"]["archiveSha256"] = serde_json::json!("b".repeat(64));
            }
            "manager-digest" => {
                invalid["managerInventory"][0]["attestation"]["subjectSha256"] =
                    serde_json::json!("b".repeat(64));
            }
            "schema1-forward" => {
                let mut schema1_manifest =
                    serde_json::to_value(&manifest).expect("serialize schema1 manifest");
                schema1_manifest["schemaVersion"] = serde_json::json!(1);
                fs::write(
                    &manifest_path,
                    serde_json::to_vec_pretty(&schema1_manifest)
                        .expect("serialize schema1 manifest bytes"),
                )
                .expect("write schema1 manifest");
                let schema1_digest = sha256_file(&manifest_path);
                invalid["forward"]["manifestSha256"] = serde_json::json!(schema1_digest);
                invalid["forward"]["signature"]["subjectSha256"] =
                    serde_json::json!(schema1_digest);
            }
            "malformed-nested" => {
                let mut malformed_manifest =
                    serde_json::to_value(&manifest).expect("serialize malformed manifest");
                malformed_manifest["services"]["api"]["unexpected"] = serde_json::json!(true);
                fs::write(
                    &manifest_path,
                    serde_json::to_vec_pretty(&malformed_manifest)
                        .expect("serialize malformed manifest bytes"),
                )
                .expect("write malformed manifest");
                let malformed_digest = sha256_file(&manifest_path);
                invalid["forward"]["manifestSha256"] = serde_json::json!(malformed_digest);
                invalid["forward"]["signature"]["subjectSha256"] =
                    serde_json::json!(malformed_digest);
            }
            _ => unreachable!("scenario is table-driven"),
        }
        let scenario_path = temp.path().join(format!("{name}.json"));
        fs::write(
            &scenario_path,
            serde_json::to_vec_pretty(&invalid).expect("serialize invalid evidence"),
        )
        .expect("write invalid evidence");
        let output = run_migration_gate(&assets_dir, &scenario_path);
        assert!(!output.status.success(), "{name} evidence unexpectedly passed");
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            combined.contains(expected_error),
            "{name} error did not contain '{expected_error}': {combined}"
        );
        if restore_manifest {
            fs::write(&manifest_path, &manifest_bytes).expect("restore forward manifest");
        }
    }
}

#[test]
fn test_publisher_remote_asset_gate_rejects_duplicate_names() {
    let temp = tempdir().expect("create temp dir");
    let assets_json_path = temp.path().join("remote-assets.json");
    let names = [
        "dam-hopper-install.sh",
        "dam-hopper-v0.2.0-linux-x86_64-systemd.tar.gz",
        "release-manifest.json",
        "dam-hopper-v0.2.0-linux-x86_64-systemd.spdx.json",
    ];
    let assets: Vec<serde_json::Value> = names
        .iter()
        .map(|name| {
            serde_json::json!({
                "name": name,
                "size": 1,
                "state": "uploaded",
                "digest": format!("sha256:{}", "a".repeat(64))
            })
        })
        .collect();
    fs::write(
        &assets_json_path,
        serde_json::to_vec_pretty(&assets).expect("serialize remote assets"),
    )
    .expect("write remote assets");

    let valid = run_remote_asset_gate(&assets_json_path);
    assert!(
        valid.status.success(),
        "valid remote assets rejected: {}",
        String::from_utf8_lossy(&valid.stderr)
    );
    let invalid_tag_args = [
        "--tag",
        "foo",
        "--assets-json",
        assets_json_path.to_str().expect("asset metadata path is UTF-8"),
    ];
    let invalid_tag = run_remote_selector_gate(&invalid_tag_args);
    assert!(
        !invalid_tag.status.success(),
        "invalid remote tag unexpectedly passed",
    );
    let invalid_tag_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&invalid_tag.stdout),
        String::from_utf8_lossy(&invalid_tag.stderr)
    );
    assert!(
        invalid_tag_combined.contains("Invalid release tag"),
        "invalid remote tag error missing: {invalid_tag_combined}"
    );

    let mut missing_digest = assets.clone();
    missing_digest[0].as_object_mut().unwrap().remove("digest");
    fs::write(
        &assets_json_path,
        serde_json::to_vec_pretty(&missing_digest)
            .expect("serialize missing remote digest metadata"),
    )
    .expect("write missing remote digest metadata");
    let missing_digest_output = run_remote_asset_gate(&assets_json_path);
    assert!(
        !missing_digest_output.status.success(),
        "missing remote digest unexpectedly passed"
    );
    let missing_digest_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&missing_digest_output.stdout),
        String::from_utf8_lossy(&missing_digest_output.stderr)
    );
    assert!(
        missing_digest_combined.contains("digest"),
        "missing remote digest error missing: {missing_digest_combined}"
    );

    let mut duplicate = assets;
    duplicate[1]["name"] = serde_json::json!(names[0]);
    fs::write(
        &assets_json_path,
        serde_json::to_vec_pretty(&duplicate).expect("serialize duplicate assets"),
    )
    .expect("write duplicate assets");
    let invalid = run_remote_asset_gate(&assets_json_path);
    assert!(!invalid.status.success(), "duplicate remote assets unexpectedly passed");
    let duplicate_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&invalid.stdout),
        String::from_utf8_lossy(&invalid.stderr)
    );
    assert!(
        duplicate_combined.contains("duplicate asset names"),
        "duplicate asset error missing: {duplicate_combined}"
    );
    let missing_path = temp.path().join("missing-assets.json");
    let missing = run_remote_asset_gate(&missing_path);
    assert!(!missing.status.success(), "missing asset metadata unexpectedly passed");
    let missing_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&missing.stdout),
        String::from_utf8_lossy(&missing.stderr)
    );
    assert!(
        missing_combined.contains("does not exist"),
        "missing asset metadata error missing: {missing_combined}"
    );

    let missing_repo = run_remote_selector_gate(&["--tag", "v0.2.0", "--release-id", "123"]);
    assert!(!missing_repo.status.success(), "release ID without repo unexpectedly passed");
    let missing_repo_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&missing_repo.stdout),
        String::from_utf8_lossy(&missing_repo.stderr)
    );
    assert!(
        missing_repo_combined.contains("require --repo"),
        "missing repo selector error missing: {missing_repo_combined}"
    );

    let missing_release =
        run_remote_selector_gate(&["--tag", "v0.2.0", "--repo", "owner/repository"]);
    assert!(
        !missing_release.status.success(),
        "repo without release ID unexpectedly passed"
    );
    let missing_release_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&missing_release.stdout),
        String::from_utf8_lossy(&missing_release.stderr)
    );
    assert!(
        missing_release_combined.contains("require --release-id"),
        "missing release selector error missing: {missing_release_combined}"
    );

    let selector_release_with_fixture = run_remote_selector_gate(&[
        "--tag",
        "v0.2.0",
        "--assets-json",
        assets_json_path.to_str().expect("asset metadata path is UTF-8"),
        "--release-id",
        "123",
    ]);
    assert!(
        !selector_release_with_fixture.status.success(),
        "release selector with fixture metadata unexpectedly passed"
    );
    let selector_fixture_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&selector_release_with_fixture.stdout),
        String::from_utf8_lossy(&selector_release_with_fixture.stderr)
    );
    assert!(
        selector_fixture_combined.contains("cannot be combined"),
        "fixture selector error missing: {selector_fixture_combined}"
    );

    let selector_repo_with_fixture = run_remote_selector_gate(&[
        "--tag",
        "v0.2.0",
        "--assets-json",
        assets_json_path.to_str().expect("asset metadata path is UTF-8"),
        "--repo",
        "owner/repository",
    ]);
    assert!(
        !selector_repo_with_fixture.status.success(),
        "repo selector with fixture metadata unexpectedly passed"
    );
    let selector_repo_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&selector_repo_with_fixture.stdout),
        String::from_utf8_lossy(&selector_repo_with_fixture.stderr)
    );
    assert!(
        selector_repo_combined.contains("cannot be combined"),
        "fixture repo selector error missing: {selector_repo_combined}"
    );

    let invalid_release_id = run_remote_selector_gate(&[
        "--tag",
        "v0.2.0",
        "--release-id",
        "0",
        "--repo",
        "owner/repository",
    ]);
    assert!(
        !invalid_release_id.status.success(),
        "zero release ID unexpectedly passed"
    );
    let invalid_release_id_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&invalid_release_id.stdout),
        String::from_utf8_lossy(&invalid_release_id.stderr)
    );
    assert!(
        invalid_release_id_combined.contains("positive integer"),
        "invalid release ID error missing: {invalid_release_id_combined}"
    );
}

#[cfg(unix)]
#[test]
fn test_publisher_remote_api_asset_gate_bounds_and_decodes_output() {
    let temp = tempdir().expect("create temp dir");
    let gh_dir = temp.path().join("bin");
    fs::create_dir_all(&gh_dir).expect("create fake gh directory");
    let gh_path = gh_dir.join("gh");
    fs::write(&gh_path, b"#!/bin/sh\ncat \"$GH_FIXTURE\"\n").expect("write fake gh");
    let mut permissions = fs::metadata(&gh_path)
        .expect("read fake gh metadata")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&gh_path, permissions).expect("make fake gh executable");

    let names = [
        "dam-hopper-install.sh",
        "dam-hopper-v0.2.0-linux-x86_64-systemd.tar.gz",
        "release-manifest.json",
        "dam-hopper-v0.2.0-linux-x86_64-systemd.spdx.json",
    ];
    let assets: Vec<serde_json::Value> = names
        .iter()
        .map(|name| {
            serde_json::json!({
                "name": name,
                "size": 1,
                "state": "uploaded",
                "digest": format!("sha256:{}", "a".repeat(64))
            })
        })
        .collect();
    let fixture_path = temp.path().join("gh-output.json");
    fs::write(
        &fixture_path,
        serde_json::to_vec(&assets).expect("serialize valid gh output"),
    )
    .expect("write valid gh output");
    let args = [
        "--tag",
        "v0.2.0",
        "--release-id",
        "123",
        "--repo",
        "owner/repository",
    ];
    let valid = run_remote_api_asset_gate(&args, &gh_dir, &fixture_path);
    assert!(
        valid.status.success(),
        "valid GitHub API output rejected: {}",
        String::from_utf8_lossy(&valid.stderr)
    );

    fs::write(&fixture_path, vec![b'[', 0xff, b']']).expect("write invalid UTF-8 output");
    let invalid_utf8 = run_remote_api_asset_gate(&args, &gh_dir, &fixture_path);
    let invalid_utf8_combined = format!(
        "{}{}",
        String::from_utf8_lossy(&invalid_utf8.stdout),
        String::from_utf8_lossy(&invalid_utf8.stderr)
    );
    assert!(!invalid_utf8.status.success(), "invalid UTF-8 output unexpectedly passed");
    assert!(
        invalid_utf8_combined.contains("not valid UTF-8"),
        "invalid UTF-8 error missing: {invalid_utf8_combined}"
    );

    let mut oversized = serde_json::to_vec(&assets).expect("serialize oversized gh output");
    oversized.extend(std::iter::repeat(b' ').take(1_048_576));
    fs::write(&fixture_path, oversized).expect("write oversized gh output");
    let oversized_output = run_remote_api_asset_gate(&args, &gh_dir, &fixture_path);
    assert!(
        !oversized_output.status.success(),
        "oversized GitHub API output unexpectedly passed"
    );
}

