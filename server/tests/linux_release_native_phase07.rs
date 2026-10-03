#![cfg(target_os = "linux")]

//! Comprehensive validation of Phase 07: Manager state schema3 migration,
//! host config normalization, native rollback/staging plugin rejection,
//! unit policy enforcement, and Advisor history root validation.

use dam_hopper_server::advisor::status::inspect_history_root;
use dam_hopper_server::linux_release::{
    load_host_config, load_or_init_manager_state, render_api_unit, render_helper_unit,
    validate_api_unit_policy, validate_helper_unit_policy, Layout, ParsedUnit, ReleaseError,
    TargetRole, UnitRenderContext, ALL_SERVICE_UNITS, API_SERVICE_HOME,
    API_SERVICE_UNIT, HELPER_SERVICE_UNIT, MANAGER_STATE_SCHEMA_VERSION,
    RECOVERY_SERVICE_UNIT, WEB_SERVICE_UNIT,
};
use tempfile::tempdir;

#[test]
fn test_managed_service_units_exclude_runner() {
    assert_eq!(ALL_SERVICE_UNITS.len(), 4);
    assert!(ALL_SERVICE_UNITS.contains(&API_SERVICE_UNIT));
    assert!(ALL_SERVICE_UNITS.contains(&WEB_SERVICE_UNIT));
    assert!(ALL_SERVICE_UNITS.contains(&RECOVERY_SERVICE_UNIT));
    assert!(ALL_SERVICE_UNITS.contains(&HELPER_SERVICE_UNIT));
    assert!(!ALL_SERVICE_UNITS.contains(&"dam-hopper-plugin-runner.service"));
}

#[test]
fn test_manager_state_schema3_migration_from_legacy_v2() {
    let tmp = tempdir().unwrap();
    let state_path = tmp.path().join("state.json");

    let legacy_v2_json = serde_json::json!({
        "schemaVersion": 2,
        "generation": 42,
        "updatedAt": "2026-10-01T12:00:00Z",
        "active": {
            "tag": "v0.8.4",
            "version": "0.8.4",
            "role": "both",
            "releasePath": "/opt/dam-hopper/releases/v0.8.4/both",
            "manifestSha256": "1111111111111111111111111111111111111111111111111111111111111111",
            "archiveSha256": "2222222222222222222222222222222222222222222222222222222222222222",
            "installedAt": "2026-10-01T12:00:00Z",
            "committedAt": "2026-10-01T12:01:00Z",
            "apiUnitSha256": "3333333333333333333333333333333333333333333333333333333333333333",
            "webUnitSha256": "4444444444444444444444444444444444444444444444444444444444444444",
            "hostConfigSha256": "5555555555555555555555555555555555555555555555555555555555555555",
            "helperUnitSha256": "6666666666666666666666666666666666666666666666666666666666666666",
            "runnerUnitSha256": "7777777777777777777777777777777777777777777777777777777777777777",
            "runnerTmpfilesSha256": "8888888888888888888888888888888888888888888888888888888888888888",
            "pluginOwnerUser": "dam-hopper-plugin-runner",
            "pluginOwnerUid": 1002,
            "pluginAdminConfigSha256": "9999999999999999999999999999999999999999999999999999999999999999",
            "pluginRuntimeNodeVersion": "24.16.0",
            "pluginRuntimeNodeSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "pluginPlatformEnabled": true
        },
        "previous": null,
        "pending": null,
        "transaction": null,
        "latestFailure": null
    });

    std::fs::write(&state_path, serde_json::to_string_pretty(&legacy_v2_json).unwrap()).unwrap();

    // Load and auto-migrate to schema3 under lock
    let migrated = load_or_init_manager_state(&state_path).expect("migration should succeed");

    assert_eq!(migrated.schema_version, MANAGER_STATE_SCHEMA_VERSION);
    assert_eq!(migrated.schema_version, 3);
    assert_eq!(migrated.generation, 43); // Bumped once

    let active = migrated.active.as_ref().expect("active release should be present");
    assert_eq!(active.tag, "v0.8.4");
    assert_eq!(active.api_unit_sha256.as_deref(), Some("3333333333333333333333333333333333333333333333333333333333333333"));
    assert_eq!(active.web_unit_sha256.as_deref(), Some("4444444444444444444444444444444444444444444444444444444444444444"));
    assert_eq!(active.helper_unit_sha256.as_deref(), Some("6666666666666666666666666666666666666666666666666666666666666666"));

    // Verify backup file was created
    let backup_path = tmp.path().join("state.v2.bak");
    assert!(backup_path.exists(), "backup file state.v2.bak must exist");
    let backup_content = std::fs::read_to_string(&backup_path).unwrap();
    assert!(backup_content.contains("runnerUnitSha256"));
    assert!(backup_content.contains("\"schemaVersion\": 2"));

    // Verify persisted state on disk is valid schema 3 without runner fields
    let persisted_content = std::fs::read_to_string(&state_path).unwrap();
    assert!(!persisted_content.contains("runnerUnitSha256"));
    assert!(!persisted_content.contains("pluginOwnerUser"));
    assert!(persisted_content.contains("\"schemaVersion\": 3"));
}

#[test]
fn test_manager_state_migration_fails_closed_on_unfinished_transaction() {
    let tmp = tempdir().unwrap();
    let state_path = tmp.path().join("state.json");

    let live_tx_json = serde_json::json!({
        "schemaVersion": 2,
        "generation": 10,
        "updatedAt": "2026-10-01T12:00:00Z",
        "active": null,
        "previous": null,
        "pending": null,
        "transaction": {
            "txId": "550e8400-e29b-41d4-a716-446655440000",
            "targetTag": "v0.8.4",
            "phase": "STAGED",
            "startedAt": "2026-10-01T12:00:00Z",
            "previousTag": null
        },
        "latestFailure": null
    });

    std::fs::write(&state_path, serde_json::to_string_pretty(&live_tx_json).unwrap()).unwrap();

    let err = load_or_init_manager_state(&state_path).unwrap_err();
    assert!(matches!(err, ReleaseError::Config(msg) if msg.contains("unfinished live transaction")));

    // Ensure state file was NOT mutated
    let raw = std::fs::read_to_string(&state_path).unwrap();
    assert!(raw.contains("\"schemaVersion\": 2"));
    assert!(!tmp.path().join("state.v2.bak").exists());
}

#[test]
fn test_manager_state_migration_fails_closed_on_unknown_top_level_field() {
    let tmp = tempdir().unwrap();
    let state_path = tmp.path().join("state.json");

    let unknown_field_json = serde_json::json!({
        "schemaVersion": 2,
        "generation": 1,
        "updatedAt": "2026-10-01T12:00:00Z",
        "unknownPayload": { "foo": "bar" },
        "active": null,
        "previous": null,
        "pending": null,
        "transaction": null,
        "latestFailure": null
    });

    std::fs::write(&state_path, serde_json::to_string_pretty(&unknown_field_json).unwrap()).unwrap();

    let err = load_or_init_manager_state(&state_path).unwrap_err();
    assert!(matches!(err, ReleaseError::Config(msg) if msg.contains("unknown top-level field")));
    assert!(!tmp.path().join("state.v2.bak").exists());
}

#[test]
fn test_host_config_normalization_removes_obsolete_plugin_fields() {
    let tmp = tempdir().unwrap();
    let config_path = tmp.path().join("host.toml");

    let legacy_toml = r#"
role = "both"
allowed_web_origins = ["http://localhost:5173"]
service_user = "dam-hopper"
plugin_owner_user = "dam-hopper-plugin-runner"
plugin_admin_subjects = ["admin@example.com"]
"#;
    std::fs::write(&config_path, legacy_toml).unwrap();

    let loaded = load_host_config(&config_path)
        .expect("should load without error")
        .expect("should be present");

    assert_eq!(loaded.role, TargetRole::Both);
    assert_eq!(loaded.allowed_web_origins, vec!["http://localhost:5173"]);
    assert_eq!(loaded.service_user.as_deref(), Some("dam-hopper"));

    // Check that host.toml was rewritten without plugin_owner_user or plugin_admin_subjects
    let rewritten = std::fs::read_to_string(&config_path).unwrap();
    assert!(!rewritten.contains("plugin_owner_user"));
    assert!(!rewritten.contains("plugin_admin_subjects"));
    assert!(rewritten.contains("role = \"both\""));
    assert!(rewritten.contains("service_user = \"dam-hopper\""));
}

#[test]
fn test_native_api_and_helper_unit_policy() {
    let tmp = tempdir().unwrap();
    let release_root = tmp.path().join("opt/dam-hopper/releases/v0.8.5/both");
    let public_cfg = tmp.path().join("etc/dam-hopper/public.json");
    std::fs::create_dir_all(&release_root).unwrap();

    let mut ctx = UnitRenderContext::new(
        release_root.clone(),
        "0.8.5".to_string(),
        public_cfg,
        vec!["http://localhost:5173".to_string()],
    )
    .unwrap();
    ctx.api_user = "dam-hopper".to_string();
    ctx.api_group = "dam-hopper".to_string();
    ctx.api_home = API_SERVICE_HOME.to_string();
    ctx.api_uid = "1001".to_string();

    let api_in = include_str!("../../deploy/systemd/dam-hopper-api.service.in");
    let rendered_api = render_api_unit(api_in, &ctx).expect("rendered API unit must pass policy");
    let parsed_api = ParsedUnit::parse(&rendered_api).unwrap();
    assert!(validate_api_unit_policy(&parsed_api, &ctx).is_ok());

    // Policy violation if SupplementaryGroups declared in native runtime
    let bad_api_template = rendered_api.replace("[Service]\n", "[Service]\nSupplementaryGroups=dam-hopper-plugins\n");
    let bad_parsed = ParsedUnit::parse(&bad_api_template).unwrap();
    assert!(matches!(
        validate_api_unit_policy(&bad_parsed, &ctx),
        Err(ReleaseError::UnitPolicyViolation { reason, .. }) if reason.contains("SupplementaryGroups")
    ));

    // Helper unit policy verification
    let helper_in = include_str!("../../deploy/systemd/dam-hopper-idle-suspend-helper.service.in");
    let rendered_helper = render_helper_unit(helper_in, &ctx).expect("rendered helper unit must pass policy");
    let parsed_helper = ParsedUnit::parse(&rendered_helper).unwrap();
    assert!(validate_helper_unit_policy(&parsed_helper, &ctx).is_ok());
}

#[test]
fn test_advisor_history_directory_validation_rejects_symlink() {
    let tmp = tempdir().unwrap();
    let dot_evcrate = tmp.path().join(".evcrate");
    std::fs::create_dir_all(&dot_evcrate).unwrap();

    // 1. Real directory succeeds
    let real_dir = dot_evcrate.join("advisor-history");
    std::fs::create_dir(&real_dir).unwrap();
    let status = inspect_history_root(true, Some(tmp.path()));
    assert!(status.enabled);
    assert!(status.available);
    assert_eq!(status.path.as_deref(), Some(real_dir.to_str().unwrap()));
    assert!(status.source_error.is_none());

    // 2. Symlink is rejected
    std::fs::remove_dir(&real_dir).unwrap();
    let target_dir = tmp.path().join("external-history");
    std::fs::create_dir(&target_dir).unwrap();

    #[cfg(unix)]
    std::os::unix::fs::symlink(&target_dir, &real_dir).unwrap();

    let symlink_status = inspect_history_root(true, Some(tmp.path()));
    assert!(symlink_status.enabled);
    assert!(!symlink_status.available);
    assert_eq!(
        symlink_status.source_error.as_deref(),
        Some("History root must be a real directory; symlink rejected")
    );
}

#[test]
fn test_legacy_manifest_inspection_and_native_manifest_validation() {
    // Legacy manifest with runner component and service
    let legacy_manifest_json = serde_json::json!({
        "schemaVersion": 2,
        "release": {
            "tag": "v0.8.4",
            "version": "0.8.4",
            "commitSha": "0123456789abcdef0123456789abcdef01234567"
        },
        "profile": {
            "id": "linux-x86_64-systemd",
            "osId": "linux",
            "osVersion": "any",
            "arch": "x86_64",
            "target": "x86_64-unknown-linux-gnu",
            "glibcMin": "2.39",
            "systemdMin": 245
        },
        "archive": {
            "name": "dam-hopper-v0.8.4-linux-x86_64-systemd.tar.gz",
            "size": 123456,
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "components": {
            "cli": { "version": "0.8.4" },
            "api": { "version": "0.8.4" },
            "webHost": { "version": "0.8.4" },
            "webAssets": { "version": "0.8.4" },
            "runner": { "version": "0.8.4" }
        },
        "inventory": [
            { "path": "bin/dam-hopper-manager", "kind": "file", "roles": ["common"], "mode": 493, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "bin/dam-hopper-server", "kind": "file", "roles": ["server"], "mode": 493, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "bin/dam-hopper-idle-suspend-helper", "kind": "file", "roles": ["server"], "mode": 493, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "bin/dam-hopper-web", "kind": "file", "roles": ["web"], "mode": 493, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-api.service", "kind": "file", "roles": ["server"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-idle-suspend-helper.service", "kind": "file", "roles": ["server"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-recovery.service", "kind": "file", "roles": ["common"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-web.service", "kind": "file", "roles": ["web"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "sysusers.d/dam-hopper-web.conf", "kind": "file", "roles": ["web"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "web", "kind": "dir", "roles": ["web"], "mode": 493 },
            { "path": "web/index.html", "kind": "file", "roles": ["web"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "LICENSE", "kind": "file", "roles": ["common"], "mode": 420, "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
        ],
        "services": {
            "api": {
                "unitName": "dam-hopper-api.service",
                "bindHost": "0.0.0.0",
                "port": 4801,
                "healthPath": "/api/health"
            },
            "web": {
                "unitName": "dam-hopper-web.service",
                "identity": "dam-hopper-web",
                "bindHost": "0.0.0.0",
                "port": 4802,
                "healthPath": "/__dam-hopper/health"
            },
            "runner": {
                "unitName": "dam-hopper-plugin-runner.service",
                "socketPath": "/run/dam-hopper/plugin-runner.sock"
            }
        },
        "rollback": {
            "previousReleaseCompatible": true,
            "stateCompatibility": "n-1"
        }
    });

    let legacy_bytes = serde_json::to_vec(&legacy_manifest_json).unwrap();
    // Legacy reader parses and inspects installed release without failure
    let parsed_legacy = dam_hopper_server::linux_release::ReleaseManifest::parse_and_validate_installed_release(&legacy_bytes)
        .expect("installed release manifest inspection must succeed for legacy bundles");
    assert!(parsed_legacy.components.runner.is_some());
    assert!(parsed_legacy.services.runner.is_some());

    // Native manifest (without runner) parses with standard parse_and_validate
    let mut native_manifest_json = legacy_manifest_json.clone();
    native_manifest_json.get_mut("components").unwrap().as_object_mut().unwrap().remove("runner");
    native_manifest_json.get_mut("services").unwrap().as_object_mut().unwrap().remove("runner");
    let native_bytes = serde_json::to_vec(&native_manifest_json).unwrap();
    let parsed_native = dam_hopper_server::linux_release::ReleaseManifest::parse_and_validate(&native_bytes)
        .expect("native manifest parsing must succeed");
    assert!(parsed_native.components.runner.is_none());
    assert!(parsed_native.services.runner.is_none());
}

#[test]
fn test_staging_rejects_plugin_bearing_candidate_bundle() {
    let tmp = tempdir().unwrap();
    let bundle_dir = tmp.path().join("bundle");
    std::fs::create_dir_all(&bundle_dir).unwrap();

    let plugin_manifest = serde_json::json!({
        "schemaVersion": 2,
        "release": {
            "tag": "v0.8.4",
            "version": "0.8.4",
            "commitSha": "0123456789abcdef0123456789abcdef01234567"
        },
        "profile": {
            "id": "linux-x86_64-systemd",
            "osId": "linux",
            "osVersion": "any",
            "arch": "x86_64",
            "target": "x86_64-unknown-linux-gnu",
            "glibcMin": "2.39",
            "systemdMin": 245
        },
        "archive": {
            "name": "dam-hopper-v0.8.4-linux-x86_64-systemd.tar.gz",
            "size": 10,
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        "components": {
            "cli": { "version": "0.8.4" },
            "api": { "version": "0.8.4" },
            "webHost": { "version": "0.8.4" },
            "webAssets": { "version": "0.8.4" },
            "runner": { "version": "0.8.4" }
        },
        "inventory": [
            { "path": "bin/dam-hopper-manager", "kind": "file", "roles": ["common"], "mode": 493, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "bin/dam-hopper-server", "kind": "file", "roles": ["server"], "mode": 493, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "bin/dam-hopper-idle-suspend-helper", "kind": "file", "roles": ["server"], "mode": 493, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "bin/dam-hopper-web", "kind": "file", "roles": ["web"], "mode": 493, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-api.service", "kind": "file", "roles": ["server"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-idle-suspend-helper.service", "kind": "file", "roles": ["server"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-recovery.service", "kind": "file", "roles": ["common"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "systemd/dam-hopper-web.service", "kind": "file", "roles": ["web"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "sysusers.d/dam-hopper-web.conf", "kind": "file", "roles": ["web"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "web", "kind": "dir", "roles": ["web"], "mode": 493 },
            { "path": "web/index.html", "kind": "file", "roles": ["web"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
            { "path": "LICENSE", "kind": "file", "roles": ["common"], "mode": 420, "size": 10, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
        ],
        "services": {
            "api": {
                "unitName": "dam-hopper-api.service",
                "bindHost": "0.0.0.0",
                "port": 4801,
                "healthPath": "/api/health"
            },
            "web": {
                "unitName": "dam-hopper-web.service",
                "identity": "dam-hopper-web",
                "bindHost": "0.0.0.0",
                "port": 4802,
                "healthPath": "/__dam-hopper/health"
            }
        },
        "rollback": {
            "previousReleaseCompatible": true,
            "stateCompatibility": "n-1"
        }
    });

    std::fs::write(
        bundle_dir.join("release-manifest.json"),
        serde_json::to_vec(&plugin_manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(bundle_dir.join("dam-hopper-v0.8.4-linux-x86_64-systemd.tar.gz"), b"fake_tar_gz").unwrap();

    let layout = Layout::with_root(tmp.path().join("root"));
    let stage_err = dam_hopper_server::linux_release::stage_release_bundle_with_options(
        &layout,
        &bundle_dir,
        Some(TargetRole::Both),
        &[],
        false,
        false,
        false,
    )
    .unwrap_err();

    assert!(matches!(
        stage_err,
        ReleaseError::InvalidBundle { reason, .. } if reason.contains("staging plugin-bearing release candidate is rejected")
    ));
}
