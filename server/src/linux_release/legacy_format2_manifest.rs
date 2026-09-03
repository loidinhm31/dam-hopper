//! Read-only parser and validator for the format-2 install marker manifest.

use super::error::ReleaseError;
use std::collections::BTreeMap;

/// Parsed metadata from the format-2 install marker manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyFormat2Manifest {
    pub format: u32,
    pub nonce: String,
    pub binary_sha256: String,
    pub unit_sha256: String,
}

/// Parse and validate the exact 4-line format-2 manifest.
pub fn parse_format2_manifest(content: &str) -> Result<LegacyFormat2Manifest, ReleaseError> {
    let lines: Vec<&str> = content.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.len() != 4 {
        if content.contains("format=1") || content.contains("web.sha256") {
            return Err(ReleaseError::UnsupportedFormat1Migration(
                "format 1 manifests are unsupported for automatic migration".into(),
            ));
        }
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("expected exactly 4 manifest lines, got {}", lines.len()),
        });
    }

    let mut map = BTreeMap::new();
    for line in lines {
        let (k, v) = line.split_once('=').ok_or_else(|| ReleaseError::LegacyMigrationRejected {
            reason: format!("malformed manifest line '{line}'"),
        })?;
        if k.contains(|c: char| !c.is_ascii_alphanumeric() && c != '_') || v.contains(char::is_whitespace) {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("invalid key/value syntax in manifest line '{line}'"),
            });
        }
        if map.insert(k, v).is_some() {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("duplicate key '{k}' in manifest"),
            });
        }
    }

    let format_str = map.get("format").copied().ok_or_else(|| ReleaseError::LegacyMigrationRejected {
        reason: "missing 'format' key in manifest".into(),
    })?;
    if format_str == "1" {
        return Err(ReleaseError::UnsupportedFormat1Migration(
            "format 1 installs are unsupported for automatic migration".into(),
        ));
    }
    if format_str != "2" {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("unsupported format version '{format_str}'"),
        });
    }

    let nonce = map.get("nonce").copied().ok_or_else(|| ReleaseError::LegacyMigrationRejected {
        reason: "missing 'nonce' key in manifest".into(),
    })?;
    if nonce.len() != 32 || !nonce.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "nonce must be 32 lowercase hex characters".into(),
        });
    }

    let binary_sha256 = map.get("binary_sha256").copied().ok_or_else(|| ReleaseError::LegacyMigrationRejected {
        reason: "missing 'binary_sha256' key in manifest".into(),
    })?;
    if binary_sha256.len() != 64 || !binary_sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "binary_sha256 must be 64 lowercase hex characters".into(),
        });
    }

    let unit_sha256 = map.get("unit_sha256").copied().ok_or_else(|| ReleaseError::LegacyMigrationRejected {
        reason: "missing 'unit_sha256' key in manifest".into(),
    })?;
    if unit_sha256.len() != 64 || !unit_sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "unit_sha256 must be 64 lowercase hex characters".into(),
        });
    }

    Ok(LegacyFormat2Manifest {
        format: 2,
        nonce: nonce.to_string(),
        binary_sha256: binary_sha256.to_string(),
        unit_sha256: unit_sha256.to_string(),
    })
}
