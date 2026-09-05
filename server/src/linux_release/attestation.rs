//! Optional GitHub attestation verification via `gh` CLI.

use super::error::ReleaseError;
use std::path::Path;
use std::process::Command;

/// Canonical GitHub repository for DamHopper releases.
pub const RELEASE_REPO: &str = "loidinhm31/dam-hopper";

/// Verify a file's GitHub attestation using `gh attestation verify`.
///
/// Executes `gh` without a shell, with a clean environment, fixed repository,
/// and closed stdin.
pub fn verify_file_attestation(file_path: &Path, repo: Option<&str>) -> Result<(), ReleaseError> {
    let repository = repo.unwrap_or(RELEASE_REPO);

    let output = Command::new("gh")
        .args([
            "attestation",
            "verify",
            file_path.to_str().ok_or_else(|| {
                ReleaseError::AttestationFailed("invalid non-UTF8 file path".to_string())
            })?,
            "--repo",
            repository,
        ])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| {
            ReleaseError::AttestationFailed(format!(
                "failed to execute 'gh' CLI (is it installed?): {e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let first_line = stderr.lines().next().unwrap_or("verification failed");
        return Err(ReleaseError::AttestationFailed(format!(
            "attestation rejected for '{}': {}",
            file_path.display(),
            first_line.trim()
        )));
    }

    Ok(())
}
