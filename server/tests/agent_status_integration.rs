use std::path::Path;
use tempfile::tempdir;

use dam_hopper_server::agent_status::{
    check_extension_status, install_extension, uninstall_extension,
    IntegrationError, ManagedExtensionStatus, EXTENSION_SUBPATH, MANAGED_ADAPTER_VERSION,
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
