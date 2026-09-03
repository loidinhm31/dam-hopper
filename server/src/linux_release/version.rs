//! Strict SemVer, tag, and checksum verification for release metadata.

use super::error::ReleaseError;
use semver::Version;

/// Validate a release version string against strict SemVer without prerelease or build metadata.
pub fn validate_version(raw: &str) -> Result<Version, ReleaseError> {
    let parsed = Version::parse(raw).map_err(|e| ReleaseError::InvalidVersion(e.to_string()))?;
    if !parsed.pre.is_empty() || !parsed.build.is_empty() {
        return Err(ReleaseError::InvalidVersion(format!(
            "prerelease and build metadata are rejected for stable releases: '{raw}'"
        )));
    }
    Ok(parsed)
}

/// Validate that the git release tag exactly matches `v<version>`.
pub fn validate_release_tag(tag: &str, expected_version: &str) -> Result<(), ReleaseError> {
    let expected_tag = format!("v{expected_version}");
    if tag != expected_tag {
        return Err(ReleaseError::InvalidTag {
            tag: tag.to_string(),
            version: expected_version.to_string(),
        });
    }
    Ok(())
}

/// Validate that a commit SHA is a 40-character lowercase hexadecimal string.
pub fn validate_commit_sha(sha: &str) -> Result<(), ReleaseError> {
    if sha.len() != 40
        || !sha
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(ReleaseError::InvalidCommitSha);
    }
    Ok(())
}

/// Validate that a SHA-256 digest is a 64-character lowercase hexadecimal string.
pub fn validate_sha256_hex(digest: &str) -> Result<(), ReleaseError> {
    if digest.len() != 64
        || !digest
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(ReleaseError::InvalidArchiveSha256);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_version() {
        assert!(validate_version("1.2.3").is_ok());
        assert!(validate_version("0.1.0").is_ok());
    }

    #[test]
    fn test_reject_prerelease_and_build() {
        assert!(validate_version("1.2.3-alpha").is_err());
        assert!(validate_version("1.2.3+build42").is_err());
        assert!(validate_version("1.2.3-rc.1+2026").is_err());
    }

    #[test]
    fn test_tag_match() {
        assert!(validate_release_tag("v1.2.3", "1.2.3").is_ok());
        assert!(validate_release_tag("1.2.3", "1.2.3").is_err());
        assert!(validate_release_tag("v1.2.4", "1.2.3").is_err());
    }

    #[test]
    fn test_commit_sha() {
        assert!(validate_commit_sha("0123456789abcdef0123456789abcdef01234567").is_ok());
        assert!(validate_commit_sha("0123456789ABCDEF0123456789ABCDEF01234567").is_err());
        assert!(validate_commit_sha("short").is_err());
    }

    #[test]
    fn test_sha256() {
        let valid = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        assert!(validate_sha256_hex(valid).is_ok());
        assert!(validate_sha256_hex(&valid.to_uppercase()).is_err());
        assert!(validate_sha256_hex("short").is_err());
    }
}
