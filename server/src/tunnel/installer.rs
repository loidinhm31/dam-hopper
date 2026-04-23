use std::path::PathBuf;
use std::env::consts::{ARCH, OS};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::error::TunnelError;

const CF_BIN_NAME: &str = "cloudflared";
const CF_RELEASES_BASE: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download";

pub struct TunnelInstaller;

impl TunnelInstaller {
    /// Returns path to a usable cloudflared binary or `TunnelError::BinaryMissing`.
    /// Search order: PATH → ~/.dam-hopper/bin/cloudflared
    pub async fn resolve() -> Result<PathBuf, TunnelError> {
        if let Some(p) = find_in_path() {
            return Ok(p);
        }
        if let Some(p) = local_bin_path() {
            if tokio::fs::metadata(&p).await.is_ok() {
                return Ok(p);
            }
        }
        Err(TunnelError::BinaryMissing)
    }

    /// Download cloudflared to `~/.dam-hopper/bin/cloudflared` atomically.
    /// Linux x86_64 and arm64 only. Other platforms return `BinaryMissingHint`.
    /// `on_progress(downloaded, total)` — total is 0 when Content-Length absent.
    pub async fn install(
        on_progress: impl Fn(u64, u64) + Send,
    ) -> Result<PathBuf, TunnelError> {
        let asset = asset_filename().ok_or_else(platform_hint)?;
        let url = format!("{CF_RELEASES_BASE}/{asset}");

        let dest = local_bin_path()
            .ok_or_else(|| TunnelError::InstallFailed("cannot resolve home dir".into()))?;

        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let tmp = dest.with_extension("download");

        download_file(&url, &tmp, on_progress).await?;

        #[cfg(unix)]
        {
            let perms = std::fs::Permissions::from_mode(0o755);
            tokio::fs::set_permissions(&tmp, perms).await?;
        }

        tokio::fs::rename(&tmp, &dest).await?;
        Ok(dest)
    }
}

/// Path to the locally managed cloudflared binary.
pub fn local_bin_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".dam-hopper").join("bin").join(CF_BIN_NAME))
}

/// Search PATH for the cloudflared binary.
/// Note: `is_file()` is a sync syscall; acceptable for PATH scan (typically <20 dirs).
fn find_in_path() -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(CF_BIN_NAME);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Returns the asset filename for the current platform (Linux only).
fn asset_filename() -> Option<&'static str> {
    match (OS, ARCH) {
        ("linux", "x86_64") => Some("cloudflared-linux-amd64"),
        ("linux", "aarch64") => Some("cloudflared-linux-arm64"),
        _ => None,
    }
}

/// Returns the appropriate hint error for unsupported platforms.
fn platform_hint() -> TunnelError {
    match OS {
        "macos" => TunnelError::BinaryMissingHint("brew install cloudflared".into()),
        "windows" => TunnelError::BinaryMissingHint(
            "download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/".into(),
        ),
        _ => TunnelError::InstallFailed(format!("unsupported platform: {OS}/{ARCH}")),
    }
}

async fn download_file(
    url: &str,
    dest: &PathBuf,
    on_progress: impl Fn(u64, u64) + Send,
) -> Result<(), TunnelError> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let response = reqwest::get(url)
        .await
        .map_err(|e| TunnelError::InstallFailed(e.to_string()))?;

    if !response.status().is_success() {
        return Err(TunnelError::InstallFailed(format!(
            "download failed: HTTP {}",
            response.status()
        )));
    }

    // total is 0 when Content-Length is absent; callers should handle 0 as "unknown".
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(TunnelError::Io)?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| TunnelError::InstallFailed(e.to_string()))?;
        file.write_all(&chunk).await.map_err(TunnelError::Io)?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }

    file.flush().await.map_err(TunnelError::Io)?;
    Ok(())
}
