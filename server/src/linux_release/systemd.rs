//! Systemd command adapter executing direct binaries without shell interpretation.

use super::error::ReleaseError;
use std::path::Path;
use std::process::Command;
pub use super::systemd_backup::{
    backup_unit_files, install_unit_file, remove_unit_file, restore_unit_files,
};


/// Run `systemd-analyze verify` against the given unit file paths.
pub fn systemd_analyze_verify<P: AsRef<Path>>(
    unit_paths: &[P],
    root: Option<&Path>,
) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemd-analyze");
    if let Some(r) = root {
        cmd.arg(format!("--root={}", r.display()));
    }
    cmd.arg("verify");
    for path in unit_paths {
        cmd.arg(path.as_ref());
    }

    execute_cmd(cmd, "systemd-analyze verify")
}

/// Run `systemd-sysusers` to provision system identity from a configuration file.
pub fn systemd_sysusers(config_path: &Path, root: Option<&Path>) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemd-sysusers");
    if let Some(r) = root {
        cmd.arg(format!("--root={}", r.display()));
    }
    cmd.arg(config_path);

    execute_cmd(cmd, "systemd-sysusers")
}

/// Run `systemctl daemon-reload` to reload unit definitions.
pub fn systemctl_daemon_reload() -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.arg("daemon-reload");
    execute_cmd(cmd, "systemctl daemon-reload")
}

/// Enable a systemd service unit.
pub fn systemctl_enable(unit_name: &str) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["enable", unit_name]);
    execute_cmd(cmd, "systemctl enable")
}

/// Disable a systemd service unit.
pub fn systemctl_disable(unit_name: &str) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["disable", unit_name]);
    let output = cmd.output().map_err(|e| ReleaseError::Io {
        action: "execute systemctl disable",
        details: e.to_string(),
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // Idempotent: if unit file does not exist, consider it already disabled
        if stderr.contains("does not exist") || stderr.contains("not loaded") || stderr.contains("No such file") {
            return Ok(());
        }
        return Err(ReleaseError::SystemdCommandFailed {
            command: "systemctl disable".to_string(),
            exit_code: output.status.code(),
            stderr,
        });
    }

    Ok(())
}

/// Disable a systemd service unit only if it is currently enabled.
pub fn disable_if_enabled(unit_name: &str) -> Result<(), ReleaseError> {
    if systemctl_is_enabled(unit_name)? {
        systemctl_disable(unit_name)?;
    }
    Ok(())
}

/// Start a systemd service unit.
pub fn systemctl_start(unit_name: &str) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["start", unit_name]);
    execute_cmd(cmd, "systemctl start")
}

/// Stop a systemd service unit.
pub fn systemctl_stop(unit_name: &str) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["stop", unit_name]);
    execute_cmd(cmd, "systemctl stop")
}

/// Restart a systemd service unit.
pub fn systemctl_restart(unit_name: &str) -> Result<(), ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["restart", unit_name]);
    execute_cmd(cmd, "systemctl restart")
}

/// Check if a systemd unit is active (`systemctl is-active <unit>`).
pub fn systemctl_is_active(unit_name: &str) -> Result<bool, ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["is-active", unit_name]);
    let output = cmd.output().map_err(|e| ReleaseError::Io {
        action: "execute systemctl is-active",
        details: e.to_string(),
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(output.status.success() && stdout == "active")
}

/// Check if a systemd unit is enabled (`systemctl is-enabled <unit>`).
pub fn systemctl_is_enabled(unit_name: &str) -> Result<bool, ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["is-enabled", unit_name]);
    let output = cmd.output().map_err(|e| ReleaseError::Io {
        action: "execute systemctl is-enabled",
        details: e.to_string(),
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(output.status.success() && stdout == "enabled")
}

/// Query a single property of a unit (`systemctl show <unit> --property=<prop> --value`).
pub fn systemctl_show_property(unit_name: &str, property: &str) -> Result<String, ReleaseError> {
    let mut cmd = Command::new("systemctl");
    cmd.args(["show", unit_name, &format!("--property={property}"), "--value"]);
    let output = cmd.output().map_err(|e| ReleaseError::Io {
        action: "execute systemctl show",
        details: e.to_string(),
    })?;

    if !output.status.success() {
        return Err(ReleaseError::SystemdCommandFailed {
            command: format!("systemctl show {unit_name} --property={property}"),
            exit_code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn execute_cmd(mut cmd: Command, label: &'static str) -> Result<(), ReleaseError> {
    let output = cmd.output().map_err(|e| ReleaseError::Io {
        action: label,
        details: e.to_string(),
    })?;

    if !output.status.success() {
        return Err(ReleaseError::SystemdCommandFailed {
            command: label.to_string(),
            exit_code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(())
}
