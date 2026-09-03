//! Read-only validation for legacy format-2 systemd unit contract.

use super::error::ReleaseError;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

/// Validate legacy format-2 systemd unit contract and return its contents.
pub fn validate_format2_unit(
    unit_file: &Path,
    expected_sha256: &str,
    require_root: bool,
) -> Result<String, ReleaseError> {
    let unit_meta = fs::symlink_metadata(unit_file).map_err(|e| ReleaseError::Io {
        action: "stat format-2 unit file",
        details: e.to_string(),
    })?;
    if unit_meta.file_type().is_symlink()
        || !unit_meta.is_file()
        || (unit_meta.mode() & 0o777) != 0o644
        || (require_root && unit_meta.uid() != 0)
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 unit file must be a 0644 regular file".into(),
        });
    }

    let unit_bytes = fs::read(unit_file).map_err(|e| ReleaseError::Io {
        action: "read format-2 unit file",
        details: e.to_string(),
    })?;
    let computed_unit_hash = hex::encode(Sha256::digest(&unit_bytes));
    if computed_unit_hash != expected_sha256 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("unit hash mismatch: expected {expected_sha256}, got {computed_unit_hash}"),
        });
    }

    let unit_str = String::from_utf8(unit_bytes).map_err(|e| ReleaseError::LegacyMigrationRejected {
        reason: format!("unit file contains invalid UTF-8: {e}"),
    })?;

    let env_files: Vec<&str> = unit_str
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with("EnvironmentFile="))
        .collect();
    if env_files.len() != 2
        || env_files[0] != "EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env"
        || env_files[1] != "EnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env"
    {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "unit EnvironmentFile ordering or assignments invalid".into(),
        });
    }

    let required_lines = [
        "User=loidinh",
        "Group=loidinh",
        "WorkingDirectory=/home/loidinh",
        "Environment=HOME=/home/loidinh",
        "Environment=XDG_CONFIG_HOME=/home/loidinh/.config",
        "Environment=RUST_ENV=production",
        "ExecStart=/opt/dam-hopper/bin/dam-hopper-server --config /home/loidinh/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801",
        "Restart=on-failure",
        "KillSignal=SIGTERM",
        "UMask=0077",
        "NoNewPrivileges=false",
        "StandardOutput=journal",
        "StandardError=journal",
    ];
    for req in required_lines {
        if !unit_str.lines().any(|l| l.trim() == req) {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("missing required unit directive '{req}'"),
            });
        }
    }

    for forbidden in ["--no-auth", "DAM_HOPPER_NO_AUTH=", "DAM_HOPPER_WEB_DIR="] {
        if unit_str.contains(forbidden) {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("unit contains forbidden directive '{forbidden}'"),
            });
        }
    }

    let drop_in = unit_file.with_extension("service.d");
    if drop_in.exists() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 unit drop-in directory exists".into(),
        });
    }

    Ok(unit_str)
}
