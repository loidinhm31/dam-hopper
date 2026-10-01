use std::path::Path;
use tempfile::tempdir;

use dam_hopper_server::agent_status::{
    check_claude_status, check_codex_status, check_extension_status,
    check_native_integration_status, install_claude, install_codex, install_extension,
    install_native_integration, uninstall_claude, uninstall_codex, uninstall_extension,
    uninstall_native_integration, AgentKind, IntegrationError, ManagedExtensionStatus,
    ManagedInstallationStatus, ManagedReadinessStatus, CLAUDE_MANAGED_EVENTS,
    CODEX_MANAGED_EVENTS, EXTENSION_SUBPATH, MANAGED_ADAPTER_VERSION, MANAGED_LAUNCHER_SUBPATH,
    MANAGED_MANIFEST_SUBPATH,
};

#[test]
fn test_install_status_uninstall_lifecycle() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    // 1. Initial status is Absent
    let report = check_extension_status(&agent_dir).expect("status check");
    assert_eq!(report.status, ManagedExtensionStatus::Absent);
    assert_eq!(report.target_path, agent_dir.join(EXTENSION_SUBPATH));
    assert!(report.version.is_none());

    // 2. Put an unrelated file in extensions directory to verify preservation
    let ext_dir = agent_dir.join("extensions");
    std::fs::create_dir_all(&ext_dir).expect("create extensions dir");
    let unrelated_file = ext_dir.join("unrelated-extension.ts");
    std::fs::write(&unrelated_file, "console.log('do not touch me');").expect("write unrelated");

    // 3. Install extension
    let install_report = install_extension(&agent_dir).expect("install");
    assert_eq!(install_report.status, ManagedExtensionStatus::Current);
    assert_eq!(install_report.version.as_deref(), Some(MANAGED_ADAPTER_VERSION));
    assert!(install_report.target_path.is_file());

    // Verify unrelated file is untouched
    assert_eq!(
        std::fs::read_to_string(&unrelated_file).expect("read unrelated"),
        "console.log('do not touch me');"
    );

    // 4. Status check confirms Current
    let status_report = check_extension_status(&agent_dir).expect("status check");
    assert_eq!(status_report.status, ManagedExtensionStatus::Current);
    assert_eq!(status_report.version.as_deref(), Some(MANAGED_ADAPTER_VERSION));

    // 5. Re-running install is idempotent
    let re_install = install_extension(&agent_dir).expect("re-install");
    assert_eq!(re_install.status, ManagedExtensionStatus::Current);

    // 6. Uninstall extension
    let uninstall_report = uninstall_extension(&agent_dir).expect("uninstall");
    assert_eq!(uninstall_report.status, ManagedExtensionStatus::Absent);
    assert!(!agent_dir.join(EXTENSION_SUBPATH).exists());

    // Verify unrelated file is still intact
    assert!(unrelated_file.is_file());
    assert_eq!(
        std::fs::read_to_string(&unrelated_file).expect("read unrelated"),
        "console.log('do not touch me');"
    );

    // 7. Status check confirms Absent again
    let final_status = check_extension_status(&agent_dir).expect("status check");
    assert_eq!(final_status.status, ManagedExtensionStatus::Absent);
}

#[test]
fn test_refuse_relative_path() {
    let rel_path = Path::new("relative/agent/path");
    let err = check_extension_status(rel_path).expect_err("should reject relative path");
    assert!(matches!(err, IntegrationError::NonAbsolutePath(_)));

    let err2 = install_extension(rel_path).expect_err("should reject relative path");
    assert!(matches!(err2, IntegrationError::NonAbsolutePath(_)));
}

#[test]
fn test_refuse_symlink_and_nonregular() {
    let tmp = tempdir().expect("tempdir");
    let base = tmp.path().canonicalize().expect("canonicalize");

    // 1. Agent dir itself is a symlink
    let real_agent_dir = base.join("real_agent");
    std::fs::create_dir_all(&real_agent_dir).expect("create real agent");
    let symlink_agent_dir = base.join("symlink_agent");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&real_agent_dir, &symlink_agent_dir).expect("symlink");

    #[cfg(unix)]
    {
        let err = check_extension_status(&symlink_agent_dir).expect_err("should reject symlink dir");
        assert!(matches!(err, IntegrationError::SymlinkNotAllowed(_)));
    }

    // 2. Extensions directory is a symlink
    let agent_dir_2 = base.join("agent_2");
    std::fs::create_dir_all(&agent_dir_2).expect("create agent_2");
    let real_ext = base.join("real_ext");
    std::fs::create_dir_all(&real_ext).expect("create real_ext");
    let symlink_ext = agent_dir_2.join("extensions");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&real_ext, &symlink_ext).expect("symlink ext");

    #[cfg(unix)]
    {
        let err = install_extension(&agent_dir_2).expect_err("should reject symlink extensions dir");
        assert!(matches!(err, IntegrationError::SymlinkNotAllowed(_)));
    }

    // 3. Target path is a directory (not regular file)
    let agent_dir_3 = base.join("agent_3");
    let target_as_dir = agent_dir_3.join(EXTENSION_SUBPATH);
    std::fs::create_dir_all(&target_as_dir).expect("create target as dir");
    let err = check_extension_status(&agent_dir_3).expect_err("should reject directory target");
    assert!(matches!(err, IntegrationError::NotRegularFile(_)));
}

#[test]
fn test_refuse_overwrite_or_delete_modified() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    // Install cleanly
    install_extension(&agent_dir).expect("clean install");
    let target_path = agent_dir.join(EXTENSION_SUBPATH);

    // Tamper with the file (e.g. user made custom modifications)
    let mut content = std::fs::read_to_string(&target_path).expect("read");
    content.push_str("\n// Custom user modification\n");
    std::fs::write(&target_path, content).expect("write modified");

    // Status is now Modified
    let report = check_extension_status(&agent_dir).expect("status");
    assert_eq!(report.status, ManagedExtensionStatus::Modified);

    // Install refuses to overwrite modified file
    let install_err = install_extension(&agent_dir).expect_err("should refuse overwrite");
    assert!(matches!(install_err, IntegrationError::RefusingOverwriteModified(_)));

    // Uninstall refuses to delete modified file
    let uninstall_err = uninstall_extension(&agent_dir).expect_err("should refuse delete");
    assert!(matches!(uninstall_err, IntegrationError::RefusingDeleteModified(_)));
}

#[test]
fn test_upgrade_from_outdated() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");
    let ext_dir = agent_dir.join("extensions");
    std::fs::create_dir_all(&ext_dir).expect("create ext dir");

    let old_body = "// old adapter body content";
    let mut hasher = sha2::Sha256::default();
    use sha2::Digest;
    hasher.update(old_body.as_bytes());
    let old_hash = hex::encode(hasher.finalize());

    let old_file_content = format!(
        "// @generated by dam-hopper-server integration omp\n// dam-hopper-managed-version: 0.9.0\n// dam-hopper-content-sha256: {old_hash}\n\n{old_body}"
    );

    let target_path = agent_dir.join(EXTENSION_SUBPATH);
    std::fs::write(&target_path, old_file_content).expect("write old file");

    // Status is Outdated
    let status = check_extension_status(&agent_dir).expect("status");
    assert_eq!(status.status, ManagedExtensionStatus::Outdated);
    assert_eq!(status.version.as_deref(), Some("0.9.0"));

    // Install upgrades cleanly
    let upgraded = install_extension(&agent_dir).expect("upgrade install");
    assert_eq!(upgraded.status, ManagedExtensionStatus::Current);
    assert_eq!(upgraded.version.as_deref(), Some(MANAGED_ADAPTER_VERSION));

    // Status is now Current
    let final_status = check_extension_status(&agent_dir).expect("status after upgrade");
    assert_eq!(final_status.status, ManagedExtensionStatus::Current);
}

#[test]
fn test_cli_integration_subcommand() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    let server_bin = env!("CARGO_BIN_EXE_dam-hopper-server");

    // 1. Initial status via CLI
    let status_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "omp",
            "status",
            "--agent-dir",
            agent_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec status");

    assert!(status_out.status.success());
    let status_json: serde_json::Value =
        serde_json::from_slice(&status_out.stdout).expect("parse status json");
    assert_eq!(status_json["status"], "absent");

    // 2. Install via CLI
    let install_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "omp",
            "install",
            "--agent-dir",
            agent_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec install");

    assert!(install_out.status.success());
    let install_json: serde_json::Value =
        serde_json::from_slice(&install_out.stdout).expect("parse install json");
    assert_eq!(install_json["status"], "current");
    assert_eq!(install_json["version"], MANAGED_ADAPTER_VERSION);

    // Verify file exists
    assert!(agent_dir.join(EXTENSION_SUBPATH).is_file());

    // 3. Status via CLI shows current
    let status_current = std::process::Command::new(server_bin)
        .args([
            "integration",
            "omp",
            "status",
            "--agent-dir",
            agent_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec status current");

    assert!(status_current.status.success());
    let current_json: serde_json::Value =
        serde_json::from_slice(&status_current.stdout).expect("parse current json");
    assert_eq!(current_json["status"], "current");

    // 4. Uninstall via CLI
    let uninstall_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "omp",
            "uninstall",
            "--agent-dir",
            agent_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec uninstall");

    assert!(uninstall_out.status.success());
    let uninstall_json: serde_json::Value =
        serde_json::from_slice(&uninstall_out.stdout).expect("parse uninstall json");
    assert_eq!(uninstall_json["status"], "absent");
    assert!(!agent_dir.join(EXTENSION_SUBPATH).exists());
}

#[test]
fn test_codex_hooks_json_lifecycle() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    // Pre-populate hooks.json with user-defined hooks
    let hooks_json_path = agent_dir.join("hooks.json");
    let initial_user_json = serde_json::json!({
        "hooks": {
            "SessionStart": [
                {
                    "hooks": [
                        { "type": "command", "command": "/usr/local/bin/user-session-hook" }
                    ]
                }
            ],
            "CustomUserEvent": [
                {
                    "hooks": [
                        { "type": "command", "command": "/usr/local/bin/custom-event-hook" }
                    ]
                }
            ]
        }
    });
    std::fs::write(&hooks_json_path, serde_json::to_string_pretty(&initial_user_json).unwrap())
        .expect("write initial user hooks.json");

    // 1. Initial status is Absent
    let report = check_codex_status(&agent_dir).expect("status check");
    assert_eq!(report.status, ManagedInstallationStatus::Absent);
    assert_eq!(report.readiness, ManagedReadinessStatus::Unverified);

    // 2. Install Codex hooks
    let install_report = install_codex(&agent_dir).expect("install codex");
    assert_eq!(install_report.status, ManagedInstallationStatus::Current);
    assert_eq!(install_report.readiness, ManagedReadinessStatus::TrustRequired);
    assert!(install_report.launcher_path.is_file());
    assert!(install_report.manifest_path.is_file());

    // Check launcher permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::metadata(&install_report.launcher_path).unwrap().permissions();
        assert_eq!(perms.mode() & 0o111, 0o111, "launcher should be executable");
    }

    // Verify hooks.json contents: all 11 managed events present AND user hook preserved
    let installed_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&hooks_json_path).unwrap()).unwrap();
    let hooks_map = installed_json.get("hooks").unwrap().as_object().unwrap();

    assert!(hooks_map.contains_key("CustomUserEvent"), "custom user event must be preserved");
    let session_start_arr = hooks_map.get("SessionStart").unwrap().as_array().unwrap();
    assert!(
        session_start_arr.iter().any(|group| {
            group.get("hooks")
                .and_then(|h| h.as_array())
                .map(|arr| arr.iter().any(|entry| entry.get("command").and_then(|c| c.as_str()) == Some("/usr/local/bin/user-session-hook")))
                .unwrap_or(false)
        }),
        "user session start hook must be preserved"
    );

    for event in CODEX_MANAGED_EVENTS {
        assert!(hooks_map.contains_key(*event), "event {event} must be registered");
    }

    // 3. Status confirms Current
    let status_current = check_codex_status(&agent_dir).expect("status current");
    assert_eq!(status_current.status, ManagedInstallationStatus::Current);
    assert_eq!(status_current.readiness, ManagedReadinessStatus::TrustRequired);

    // 4. Idempotency: re-running install does not duplicate entries
    let reinstall_report = install_codex(&agent_dir).expect("reinstall codex");
    assert_eq!(reinstall_report.status, ManagedInstallationStatus::Current);
    let re_installed_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&hooks_json_path).unwrap()).unwrap();
    let re_session_start_arr = re_installed_json["hooks"]["SessionStart"].as_array().unwrap();
    let managed_count = re_session_start_arr
        .iter()
        .filter(|group| {
            group.get("hooks")
                .and_then(|h| h.as_array())
                .map(|arr| arr.iter().any(|entry| entry.get("command").and_then(|c| c.as_str()) == Some(install_report.launcher_path.to_str().unwrap())))
                .unwrap_or(false)
        })
        .count();
    assert_eq!(managed_count, 1, "managed command must not be duplicated");

    // 5. Uninstall Codex hooks
    let uninstall_report = uninstall_codex(&agent_dir).expect("uninstall codex");
    assert_eq!(uninstall_report.status, ManagedInstallationStatus::Absent);
    assert!(!install_report.launcher_path.exists(), "launcher must be deleted");
    assert!(!install_report.manifest_path.exists(), "manifest must be deleted");

    // hooks.json must STILL exist because user hooks were present
    assert!(hooks_json_path.is_file(), "hooks.json with user hooks must remain");
    let after_uninstall_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&hooks_json_path).unwrap()).unwrap();
    let after_hooks = after_uninstall_json.get("hooks").unwrap().as_object().unwrap();
    assert!(after_hooks.contains_key("CustomUserEvent"), "user hook must remain");
    let remaining_session_start = after_hooks.get("SessionStart").unwrap().as_array().unwrap();
    assert_eq!(remaining_session_start.len(), 1);
    assert_eq!(remaining_session_start[0]["hooks"][0]["command"], "/usr/local/bin/user-session-hook");

    // Managed events that only had dam-hopper should be cleaned up
    assert!(!after_hooks.contains_key("PreToolUse"));
    assert!(!after_hooks.contains_key("PostToolUse"));
}

#[test]
fn test_codex_config_toml_inline_lifecycle() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    // Pre-populate config.toml with an inline [hooks] table and user comments
    let config_toml_path = agent_dir.join("config.toml");
    let initial_toml = r#"# Top-level configuration comment
[features]
hooks = true

[hooks]
# User hook description
UserPromptSubmit = [{ command = "/usr/bin/user-prompt-tracer" }]
"#;
    std::fs::write(&config_toml_path, initial_toml).expect("write initial config.toml");

    // 1. Initial status is Absent
    let report = check_codex_status(&agent_dir).expect("status check");
    assert_eq!(report.status, ManagedInstallationStatus::Absent);

    // 2. Install Codex hooks
    let install_report = install_codex(&agent_dir).expect("install codex");
    assert_eq!(install_report.status, ManagedInstallationStatus::Current);

    // hooks.json must NOT be created because config.toml already had [hooks]
    assert!(!agent_dir.join("hooks.json").exists(), "must not create duplicate hooks.json");

    // Verify config.toml preserves comments
    let updated_toml = std::fs::read_to_string(&config_toml_path).expect("read updated config.toml");
    assert!(updated_toml.contains("# Top-level configuration comment"));
    assert!(updated_toml.contains("# User hook description"));
    assert!(updated_toml.contains("/usr/bin/user-prompt-tracer"));

    // 3. Uninstall Codex hooks
    let uninstall_report = uninstall_codex(&agent_dir).expect("uninstall codex");
    assert_eq!(uninstall_report.status, ManagedInstallationStatus::Absent);

    // Verify user hook and comments are STILL in config.toml
    let cleaned_toml = std::fs::read_to_string(&config_toml_path).expect("read cleaned config.toml");
    assert!(cleaned_toml.contains("# Top-level configuration comment"));
    assert!(cleaned_toml.contains("# User hook description"));
    assert!(cleaned_toml.contains("/usr/bin/user-prompt-tracer"));
    assert!(!cleaned_toml.contains("dam-hopper-agent-status"));
}

#[test]
fn test_codex_refuse_overwrite_or_delete_modified() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    // Install cleanly
    let install_report = install_codex(&agent_dir).expect("install codex");
    assert_eq!(install_report.status, ManagedInstallationStatus::Current);

    // Tamper with launcher content
    let tampered = format!("{}\n# tampered by attacker\n", std::fs::read_to_string(&install_report.launcher_path).unwrap());
    std::fs::write(&install_report.launcher_path, tampered).expect("write tampered launcher");

    // Status check should report Modified
    let status_report = check_codex_status(&agent_dir).expect("check status");
    assert_eq!(status_report.status, ManagedInstallationStatus::Modified);

    // Attempting to install or uninstall should be refused
    let err_install = install_codex(&agent_dir).expect_err("should refuse overwrite modified");
    assert!(matches!(err_install, IntegrationError::RefusingOverwriteModified(_)));

    let err_uninstall = uninstall_codex(&agent_dir).expect_err("should refuse delete modified");
    assert!(matches!(err_uninstall, IntegrationError::RefusingDeleteModified(_)));
}

#[test]
fn test_claude_settings_json_lifecycle() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    // Pre-populate settings.json with user settings and custom matchers
    let settings_path = agent_dir.join("settings.json");
    let initial_settings = serde_json::json!({
        "theme": "dark",
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "bash",
                    "hooks": [
                        { "type": "command", "command": "/usr/local/bin/bash-guard" }
                    ]
                }
            ]
        }
    });
    std::fs::write(&settings_path, serde_json::to_string_pretty(&initial_settings).unwrap())
        .expect("write initial settings.json");

    // 1. Initial status is Absent
    let report = check_claude_status(&agent_dir).expect("status check");
    assert_eq!(report.status, ManagedInstallationStatus::Absent);
    assert_eq!(report.readiness, ManagedReadinessStatus::Unverified);

    // 2. Install Claude hooks
    let install_report = install_claude(&agent_dir).expect("install claude");
    assert_eq!(install_report.status, ManagedInstallationStatus::Current);
    assert_eq!(install_report.readiness, ManagedReadinessStatus::Ready);
    assert!(install_report.launcher_path.is_file());
    assert!(install_report.manifest_path.is_file());

    // Verify settings.json contents: all 12 managed events present AND user settings preserved
    let installed_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(installed_json["theme"], "dark", "theme setting must be preserved");

    let hooks_map = installed_json.get("hooks").unwrap().as_object().unwrap();
    for event in CLAUDE_MANAGED_EVENTS {
        assert!(hooks_map.contains_key(*event), "event {event} must be registered");
    }

    // Sibling matcher for PreToolUse (bash) must be preserved
    let pre_tool_matchers = hooks_map.get("PreToolUse").unwrap().as_array().unwrap();
    assert!(
        pre_tool_matchers.iter().any(|m| m.get("matcher").and_then(|v| v.as_str()) == Some("bash")),
        "sibling bash matcher must be preserved"
    );

    // 3. Status confirms Current
    let status_current = check_claude_status(&agent_dir).expect("status current");
    assert_eq!(status_current.status, ManagedInstallationStatus::Current);

    // 4. Idempotency: re-running install does not duplicate entries
    let reinstall_report = install_claude(&agent_dir).expect("reinstall claude");
    assert_eq!(reinstall_report.status, ManagedInstallationStatus::Current);

    // 5. Uninstall Claude hooks
    let uninstall_report = uninstall_claude(&agent_dir).expect("uninstall claude");
    assert_eq!(uninstall_report.status, ManagedInstallationStatus::Absent);
    assert!(!install_report.launcher_path.exists(), "launcher must be deleted");
    assert!(!install_report.manifest_path.exists(), "manifest must be deleted");

    // settings.json must STILL exist with theme and custom matcher
    assert!(settings_path.is_file());
    let after_uninstall_json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
    assert_eq!(after_uninstall_json["theme"], "dark");
    let remaining_pre_tool = after_uninstall_json["hooks"]["PreToolUse"].as_array().unwrap();
    assert_eq!(remaining_pre_tool.len(), 1);
    assert_eq!(remaining_pre_tool[0]["matcher"], "bash");
}

#[test]
fn test_claude_policy_disabled() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    let settings_path = agent_dir.join("settings.json");
    let initial_settings = serde_json::json!({
        "disableAllHooks": true
    });
    std::fs::write(&settings_path, serde_json::to_string_pretty(&initial_settings).unwrap())
        .expect("write settings.json");

    install_claude(&agent_dir).expect("install claude");

    let status = check_claude_status(&agent_dir).expect("status check");
    assert_eq!(status.status, ManagedInstallationStatus::Current);
    assert_eq!(status.readiness, ManagedReadinessStatus::PolicyDisabled);
    assert!(status.details.unwrap().contains("disableAllHooks"));
}

#[test]
fn test_claude_refuse_overwrite_or_delete_modified() {
    let tmp = tempdir().expect("tempdir");
    let agent_dir = tmp.path().canonicalize().expect("canonicalize");

    let install_report = install_claude(&agent_dir).expect("install claude");
    assert_eq!(install_report.status, ManagedInstallationStatus::Current);

    // Tamper with launcher
    std::fs::write(&install_report.launcher_path, "#!/bin/sh\necho tampered\n")
        .expect("write tampered launcher");

    let status = check_claude_status(&agent_dir).expect("check status");
    assert_eq!(status.status, ManagedInstallationStatus::Modified);

    let err_install = install_claude(&agent_dir).expect_err("refuse overwrite");
    assert!(matches!(err_install, IntegrationError::RefusingOverwriteModified(_)));

    let err_uninstall = uninstall_claude(&agent_dir).expect_err("refuse delete");
    assert!(matches!(err_uninstall, IntegrationError::RefusingDeleteModified(_)));
}

#[test]
fn test_cli_native_integration_subcommands() {
    let tmp = tempdir().expect("tempdir");
    let codex_dir = tmp.path().join("codex");
    let claude_dir = tmp.path().join("claude");
    std::fs::create_dir_all(&codex_dir).expect("create codex dir");
    std::fs::create_dir_all(&claude_dir).expect("create claude dir");

    let server_bin = env!("CARGO_BIN_EXE_dam-hopper-server");

    // 1. Codex CLI install, status, uninstall
    let codex_install_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "codex",
            "install",
            "--agent-dir",
            codex_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec codex install");
    assert!(codex_install_out.status.success());
    let codex_install_json: serde_json::Value =
        serde_json::from_slice(&codex_install_out.stdout).expect("parse json");
    assert_eq!(codex_install_json["status"], "current");
    assert_eq!(codex_install_json["readiness"], "trust-required");

    let codex_status_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "codex",
            "status",
            "--agent-dir",
            codex_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec codex status");
    assert!(codex_status_out.status.success());
    let codex_status_json: serde_json::Value =
        serde_json::from_slice(&codex_status_out.stdout).expect("parse json");
    assert_eq!(codex_status_json["status"], "current");

    let codex_uninstall_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "codex",
            "uninstall",
            "--agent-dir",
            codex_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec codex uninstall");
    assert!(codex_uninstall_out.status.success());
    let codex_uninstall_json: serde_json::Value =
        serde_json::from_slice(&codex_uninstall_out.stdout).expect("parse json");
    assert_eq!(codex_uninstall_json["status"], "absent");

    // 2. Claude CLI install, status, uninstall
    let claude_install_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "claude",
            "install",
            "--agent-dir",
            claude_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec claude install");
    assert!(claude_install_out.status.success());
    let claude_install_json: serde_json::Value =
        serde_json::from_slice(&claude_install_out.stdout).expect("parse json");
    assert_eq!(claude_install_json["status"], "current");

    let claude_status_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "claude",
            "status",
            "--agent-dir",
            claude_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec claude status");
    assert!(claude_status_out.status.success());
    let claude_status_json: serde_json::Value =
        serde_json::from_slice(&claude_status_out.stdout).expect("parse json");
    assert_eq!(claude_status_json["status"], "current");

    let claude_uninstall_out = std::process::Command::new(server_bin)
        .args([
            "integration",
            "claude",
            "uninstall",
            "--agent-dir",
            claude_dir.to_str().unwrap(),
            "--json",
        ])
        .output()
        .expect("exec claude uninstall");
    assert!(claude_uninstall_out.status.success());
    let claude_uninstall_json: serde_json::Value =
        serde_json::from_slice(&claude_uninstall_out.stdout).expect("parse json");
    assert_eq!(claude_uninstall_json["status"], "absent");
}

#[tokio::test]
async fn test_api_native_integration_endpoints() {
    let tmp = tempdir().expect("tempdir");
    let non_existent_dir = tmp.path().join("does-not-exist");

    // 1. GET status for non-existent dir returns Absent without creating directory
    let q_absent = dam_hopper_server::api::agent_status::ExtensionQuery {
        agent_dir: Some(non_existent_dir.to_str().unwrap().to_string()),
    };
    let get_res = dam_hopper_server::api::agent_status::get_native_integration_status(
        axum::extract::Path("codex".to_string()),
        axum::extract::Query(q_absent),
    )
    .await
    .expect("get native status")
    .0;

    assert_eq!(get_res.status, ManagedInstallationStatus::Absent);
    assert_eq!(get_res.agent_kind, AgentKind::Codex);
    assert!(!non_existent_dir.exists(), "GET status must not create directory");

    // 2. POST install creates dir and installs
    let install_body = dam_hopper_server::api::agent_status::ExtensionInstallBody {
        agent_dir: Some(non_existent_dir.to_str().unwrap().to_string()),
    };
    let install_res = dam_hopper_server::api::agent_status::install_native_integration_handler(
        axum::extract::Path("codex".to_string()),
        axum::Json(install_body),
    )
    .await
    .expect("install native")
    .0;

    assert_eq!(install_res.status, ManagedInstallationStatus::Current);
    assert!(non_existent_dir.is_dir(), "POST install creates directory");
    assert!(non_existent_dir.join(MANAGED_LAUNCHER_SUBPATH).is_file());

    // 3. DELETE uninstall removes native integration
    let q_uninstall = dam_hopper_server::api::agent_status::ExtensionQuery {
        agent_dir: Some(non_existent_dir.to_str().unwrap().to_string()),
    };
    let del_res = dam_hopper_server::api::agent_status::uninstall_native_integration_handler(
        axum::extract::Path("codex".to_string()),
        axum::extract::Query(q_uninstall),
    )
    .await
    .expect("uninstall native")
    .0;

    assert_eq!(del_res.status, ManagedInstallationStatus::Absent);
    assert!(!non_existent_dir.join(MANAGED_LAUNCHER_SUBPATH).exists());
}

#[test]
fn test_generic_native_integration_dispatch() {
    let tmp = tempdir().expect("tempdir");
    let codex_dir = tmp.path().join("codex");
    std::fs::create_dir_all(&codex_dir).expect("create dir");

    let status = check_native_integration_status(AgentKind::Codex, &codex_dir).expect("check status");
    assert_eq!(status.status, ManagedInstallationStatus::Absent);

    let installed = install_native_integration(AgentKind::Codex, &codex_dir).expect("install");
    assert_eq!(installed.status, ManagedInstallationStatus::Current);
    assert_eq!(installed.manifest_path, codex_dir.join(MANAGED_MANIFEST_SUBPATH));

    let uninstalled = uninstall_native_integration(AgentKind::Codex, &codex_dir).expect("uninstall");
    assert_eq!(uninstalled.status, ManagedInstallationStatus::Absent);

    // OMP kind returns ConfigurationError
    let err = check_native_integration_status(AgentKind::Omp, &codex_dir).expect_err("omp fails");
    assert!(matches!(err, IntegrationError::ConfigurationError(_)));
}
