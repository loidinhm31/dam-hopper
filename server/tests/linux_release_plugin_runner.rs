//! Unit tests for Linux release plugin runner integration, account verification, and unit policy.

use dam_hopper_server::linux_release::{
    load_or_init_manager_state, probe_runner_health, render_runner_unit, save_manager_state,
    validate_runner_unit_policy, verify_plugin_owner_account, ParsedUnit, ReleaseError,
    UnitRenderContext, MANAGER_STATE_SCHEMA_VERSION, WEB_SERVICE_IDENTITY,
};
use tempfile::tempdir;

#[test]
fn test_verify_plugin_owner_account_rejects_empty_and_root() {
    // Empty user rejected
    let err_empty = verify_plugin_owner_account("", Some("dam-hopper")).unwrap_err();
    assert!(matches!(err_empty, ReleaseError::Config(msg) if msg.contains("cannot be empty")));

    let err_spaces = verify_plugin_owner_account("   ", Some("dam-hopper")).unwrap_err();
    assert!(matches!(err_spaces, ReleaseError::Config(msg) if msg.contains("cannot be empty")));

    // Root rejected
    let err_root = verify_plugin_owner_account("root", Some("dam-hopper")).unwrap_err();
    assert!(matches!(err_root, ReleaseError::Config(msg) if msg.contains("cannot be root")));
}

#[test]
fn test_verify_plugin_owner_account_rejects_api_and_web_identities() {
    let err_web = verify_plugin_owner_account(WEB_SERVICE_IDENTITY, Some("dam-hopper")).unwrap_err();
    assert!(matches!(err_web, ReleaseError::Config(msg) if msg.contains("cannot be the web service user")));

    let err_api = verify_plugin_owner_account("dam-hopper", Some("dam-hopper")).unwrap_err();
    assert!(matches!(err_api, ReleaseError::Config(msg) if msg.contains("cannot be the API service user")));
}

#[test]
fn test_verify_plugin_owner_account_rejects_nonexistent() {
    let non_existent = "nonexistent_user_987654321_abc";
    let err = verify_plugin_owner_account(non_existent, Some("dam-hopper")).unwrap_err();
    assert!(matches!(err, ReleaseError::Config(msg) if msg.contains("does not exist")));
}

#[test]
fn test_verify_plugin_owner_account_accepts_current_non_root_user() {
    let current_user = std::env::var("USER").unwrap_or_default();
    if current_user != "root" && !current_user.is_empty() {
        let result = verify_plugin_owner_account(&current_user, Some("nonexistent_api_user"));
        assert!(result.is_ok(), "Current user should pass validation: {:?}", result);
        let user_info = result.unwrap();
        assert_ne!(user_info.uid, 0);
        assert_ne!(user_info.gid, 0);
        assert!(!user_info.home.is_empty());
    }
}

#[test]
fn test_runner_unit_render_and_policy() {
    let root = tempdir().unwrap();
    let release_root = root.path().join("opt/dam-hopper/releases/v0.1.0/server");
    let public_cfg = root.path().join("etc/dam-hopper/public.json");
    std::fs::create_dir_all(&release_root).unwrap();

    let ctx = UnitRenderContext::new(
        release_root.clone(),
        "0.1.0".to_string(),
        public_cfg,
        vec!["http://localhost:5173".to_string()],
    )
    .unwrap()
    .with_plugin_runner_identity(
        "test-owner".to_string(),
        "test-owner-group".to_string(),
        "/home/test-owner".to_string(),
        1001,
        Some(format!("{}/bin/node", release_root.display())),
        Some(format!("{}/plugins", release_root.display())),
    )
    .unwrap();

    let template = include_str!("../../deploy/systemd/dam-hopper-plugin-runner.service.in");
    let rendered = render_runner_unit(template, &ctx).expect("render runner unit");
    assert!(rendered.contains("User=test-owner"));
    assert!(rendered.contains("Group=test-owner-group"));
    assert!(rendered.contains("WorkingDirectory=/home/test-owner"));
    assert!(rendered.contains("--expected-api-uid 1001"));

    let parsed = ParsedUnit::parse(&rendered).unwrap();
    assert!(validate_runner_unit_policy(&parsed, &ctx).is_ok());
}

#[test]
fn test_runner_unit_policy_rejects_missing_hardening() {
    let root = tempdir().unwrap();
    let release_root = root.path().join("opt/dam-hopper/releases/v0.1.0/server");
    let public_cfg = root.path().join("etc/dam-hopper/public.json");

    let ctx = UnitRenderContext::new(
        release_root,
        "0.1.0".to_string(),
        public_cfg,
        vec![],
    )
    .unwrap();

    // Template missing NoNewPrivileges
    let bad_template = r#"
[Unit]
Description=Bad Runner

[Service]
Type=simple
User=dam-hopper-plugin-runner
Group=dam-hopper-plugins
WorkingDirectory=/var/lib/dam-hopper-plugin-runner
RuntimeDirectory=dam-hopper
RuntimeDirectoryMode=0750
Restart=on-failure
RestartSec=3s
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=15s
UMask=0027
MemoryMax=1G
TasksMax=64
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictRealtime=true
RestrictSUIDSGID=true
SyslogIdentifier=dam-hopper-plugin-runner
ExecStart=/opt/dam-hopper/bin/dam-hopper-plugin-runner --socket-path /run/dam-hopper/plugin-runner.sock --registry-dir /var/lib/dam-hopper-plugin-runner/plugins --node-bin /bin/node

[Install]
WantedBy=multi-user.target
"#;

    let parsed = ParsedUnit::parse(bad_template).unwrap();
    let err = validate_runner_unit_policy(&parsed, &ctx).unwrap_err();
    assert!(matches!(err, ReleaseError::UnitPolicyViolation { reason, .. } if reason.contains("NoNewPrivileges")));
}

#[test]
fn test_manager_state_schema_migration_preserves_plugin_fields() {
    let root = tempdir().unwrap();
    let state_path = root.path().join("state.json");

    // Write a legacy v1 manager state
    let legacy_json = r#"{
  "schemaVersion": 1,
  "generation": 1,
  "updatedAt": "2026-09-22T00:00:00Z",
  "active": {
    "tag": "v0.1.0",
    "version": "0.1.0",
    "role": "server",
    "releasePath": "/opt/dam-hopper/releases/v0.1.0/server",
    "manifestSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "archiveSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "installedAt": "2026-09-22T00:00:00Z",
    "committedAt": "2026-09-22T00:00:00Z"
  }
}"#;
    std::fs::write(&state_path, legacy_json).unwrap();

    let mut state = load_or_init_manager_state(&state_path).expect("load legacy state");
    // Should be automatically migrated to schema version 2 in memory
    assert_eq!(state.schema_version, MANAGER_STATE_SCHEMA_VERSION);
    let active = state.active.as_mut().unwrap();
    assert_eq!(active.tag, "v0.1.0");
    assert_eq!(active.plugin_owner_user, None);
    assert_eq!(active.plugin_platform_enabled, None);

    // Now set plugin fields and save
    active.plugin_owner_user = Some("advisor-owner".to_string());
    active.plugin_owner_uid = Some(1005);
    active.plugin_platform_enabled = Some(true);
    save_manager_state(&state_path, &mut state).expect("save migrated state");

    // Reload and verify
    let reloaded = load_or_init_manager_state(&state_path).expect("reload state");
    assert_eq!(reloaded.schema_version, MANAGER_STATE_SCHEMA_VERSION);
    let reloaded_active = reloaded.active.unwrap();
    assert_eq!(reloaded_active.plugin_owner_user.as_deref(), Some("advisor-owner"));
    assert_eq!(reloaded_active.plugin_owner_uid, Some(1005));
    assert_eq!(reloaded_active.plugin_platform_enabled, Some(true));
}

#[tokio::test]
async fn test_probe_runner_health_transient_when_socket_missing() {
    let root = tempdir().unwrap();
    let missing_sock = root.path().join("nonexistent.sock");
    let outcome = probe_runner_health(&missing_sock, Some(1000)).await;
    assert!(matches!(outcome, dam_hopper_server::linux_release::HttpProbeOutcome::Transient(_)));
}
