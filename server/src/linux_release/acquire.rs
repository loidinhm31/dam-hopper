//! Immutable release bundle acquisition from GitHub with SHA-256 integrity checks.

use super::acquire_client::{build_http_client, fetch_bytes, fetch_json};
use super::attestation::verify_file_attestation;
use super::cli::FetchArgs;
use super::constants::{expected_archive_name, MAX_MANIFEST_BYTES};
use super::error::ReleaseError;
use super::manifest::ReleaseManifest;
use super::version::{validate_release_tag, validate_version};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;

const MAX_ARCHIVE_BYTES: usize = 500 * 1024 * 1024; // 500 MiB
const GITHUB_REPO: &str = "loidinhm31/dam-hopper";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcquisitionRecord {
    pub tag: String,
    pub repository: String,
    pub manifest_sha256: String,
    pub archive_sha256: String,
    pub fetched_at: String,
    pub attestation_verified: bool,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    #[allow(dead_code)]
    size: u64,
}

pub async fn acquire_release(args: &FetchArgs) -> Result<AcquisitionRecord, ReleaseError> {
    let client = build_http_client()?;
    let tag = resolve_tag(&client, args).await?;

    let version_str = tag
        .strip_prefix('v')
        .ok_or_else(|| ReleaseError::InvalidTag {
            tag: tag.clone(),
            version: "".to_string(),
        })?;
    validate_version(version_str)?;
    validate_release_tag(&tag, version_str)?;

    let release_url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag}");
    let release: GitHubRelease = fetch_json(&client, &release_url).await?;

    if release.draft || release.prerelease {
        return Err(ReleaseError::AcquisitionFailed(format!(
            "refusing draft or prerelease tag: {tag}"
        )));
    }

    let manifest_name = "release-manifest.json";
    let archive_name = expected_archive_name(&tag);

    let manifest_asset = release
        .assets
        .iter()
        .find(|a| a.name == manifest_name)
        .ok_or_else(|| {
            ReleaseError::AcquisitionFailed(format!("release {tag} missing asset {manifest_name}"))
        })?;

    let archive_asset = release
        .assets
        .iter()
        .find(|a| a.name == archive_name)
        .ok_or_else(|| {
            ReleaseError::AcquisitionFailed(format!("release {tag} missing asset {archive_name}"))
        })?;

    // Download manifest
    let manifest_bytes = fetch_bytes(
        &client,
        &manifest_asset.browser_download_url,
        MAX_MANIFEST_BYTES,
    )
    .await?;
    let manifest = ReleaseManifest::parse_and_validate(&manifest_bytes)?;

    if manifest.release.tag != tag {
        return Err(ReleaseError::AcquisitionFailed(format!(
            "manifest tag '{}' does not match release tag '{tag}'",
            manifest.release.tag
        )));
    }

    // Download archive
    let archive_bytes = fetch_bytes(
        &client,
        &archive_asset.browser_download_url,
        MAX_ARCHIVE_BYTES,
    )
    .await?;
    let archive_sha256 = hex::encode(Sha256::digest(&archive_bytes));

    if archive_sha256 != manifest.archive.sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: archive_name.clone(),
            expected: manifest.archive.sha256.clone(),
            got: archive_sha256,
        });
    }

    // Write assets to output directory
    fs::create_dir_all(&args.output).map_err(|e| ReleaseError::Io {
        action: "create output directory",
        details: e.to_string(),
    })?;

    let manifest_path = args.output.join(manifest_name);
    let archive_path = args.output.join(&archive_name);

    fs::write(&manifest_path, &manifest_bytes).map_err(|e| ReleaseError::Io {
        action: "write release manifest",
        details: e.to_string(),
    })?;
    fs::write(&archive_path, &archive_bytes).map_err(|e| ReleaseError::Io {
        action: "write release archive",
        details: e.to_string(),
    })?;

    let manifest_sha256 = hex::encode(Sha256::digest(&manifest_bytes));

    let mut attestation_verified = false;
    if args.verify_attestation {
        verify_file_attestation(&manifest_path, Some(GITHUB_REPO))?;
        verify_file_attestation(&archive_path, Some(GITHUB_REPO))?;
        attestation_verified = true;
    }

    let record = AcquisitionRecord {
        tag,
        repository: GITHUB_REPO.to_string(),
        manifest_sha256,
        archive_sha256: manifest.archive.sha256,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        attestation_verified,
    };

    let record_json = serde_json::to_string_pretty(&record).map_err(|e| {
        ReleaseError::Config(format!("failed to serialize acquisition record: {e}"))
    })?;
    fs::write(args.output.join("acquisition.json"), record_json).map_err(|e| ReleaseError::Io {
        action: "write acquisition record",
        details: e.to_string(),
    })?;

    Ok(record)
}

async fn resolve_tag(client: &reqwest::Client, args: &FetchArgs) -> Result<String, ReleaseError> {
    if let Some(tag) = &args.version {
        return Ok(tag.clone());
    }
    if args.latest {
        let latest_url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
        let release: GitHubRelease = fetch_json(client, &latest_url).await?;
        if release.draft || release.prerelease {
            return Err(ReleaseError::AcquisitionFailed(
                "latest release is marked as draft or prerelease".to_string(),
            ));
        }
        return Ok(release.tag_name);
    }
    Err(ReleaseError::AcquisitionFailed(
        "must specify either --version vX.Y.Z or --latest".to_string(),
    ))
}
