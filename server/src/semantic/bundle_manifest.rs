use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

use super::protocol::{validate_opaque_id, SemanticLanguage};

pub const MAX_BUNDLE_DESCRIPTORS: usize = 32;
pub const MAX_COMPRESSED_ARTIFACT_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_UNCOMPRESSED_ARTIFACT_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Release-only bundle metadata. It must never be serialized to browser DTOs.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BundleManifest {
    pub descriptors: Vec<BundleDescriptor>,
}

impl BundleManifest {
    pub fn validate(&self) -> Result<(), BundleManifestError> {
        if self.descriptors.is_empty() {
            return Err(BundleManifestError::EmptyManifest);
        }
        if self.descriptors.len() > MAX_BUNDLE_DESCRIPTORS {
            return Err(BundleManifestError::TooManyDescriptors);
        }
        let mut descriptor_ids = HashSet::with_capacity(self.descriptors.len());
        let mut payload_trees = HashMap::new();
        for descriptor in &self.descriptors {
            if !descriptor_ids.insert((&descriptor.descriptor_id, descriptor.target)) {
                return Err(BundleManifestError::DuplicateDescriptor);
            }
            descriptor.validate()?;
            if let Some(existing) = payload_trees.insert(
                descriptor.target,
                descriptor.artifact.payload_tree_sha256.as_str(),
            ) {
                if existing != descriptor.artifact.payload_tree_sha256 {
                    return Err(BundleManifestError::InconsistentPayloadTree);
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct BundleDescriptor {
    pub descriptor_id: String,
    pub runtime_id: String,
    pub language: SemanticLanguage,
    pub version: String,
    pub target: BundleTarget,
    pub artifact: BundleArtifact,
}

impl BundleDescriptor {
    fn validate(&self) -> Result<(), BundleManifestError> {
        if validate_opaque_id(&self.descriptor_id, "descriptor_id").is_err() {
            return Err(BundleManifestError::InvalidMetadata);
        }
        for value in [&self.descriptor_id, &self.runtime_id, &self.version] {
            if value.trim().is_empty()
                || value.len() > 256
                || validate_opaque_id(value, "bundle_metadata").is_err()
            {
                return Err(BundleManifestError::InvalidMetadata);
            }
        }
        self.artifact.validate()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct BundleTarget {
    pub os: BundleOs,
    pub architecture: BundleArchitecture,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BundleOs {
    Linux,
    Macos,
    Windows,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum BundleArchitecture {
    X86_64,
    Aarch64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct BundleArtifact {
    pub sha256: String,
    pub license_id: String,
    pub sbom_component: String,
    pub compressed_size_bytes: u64,
    pub uncompressed_size_bytes: u64,
    pub payload_tree_sha256: String,
}

impl BundleArtifact {
    fn validate(&self) -> Result<(), BundleManifestError> {
        if !is_sha256(&self.sha256) || !is_sha256(&self.payload_tree_sha256) {
            return Err(BundleManifestError::InvalidChecksum);
        }
        if self.license_id.trim().is_empty()
            || self.sbom_component.trim().is_empty()
            || self.compressed_size_bytes == 0
            || self.uncompressed_size_bytes < self.compressed_size_bytes
        {
            return Err(BundleManifestError::InvalidArtifactMetadata);
        }
        if self.compressed_size_bytes > MAX_COMPRESSED_ARTIFACT_BYTES
            || self.uncompressed_size_bytes > MAX_UNCOMPRESSED_ARTIFACT_BYTES
        {
            return Err(BundleManifestError::ArtifactTooLarge);
        }
        Ok(())
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Browser-visible degradation deliberately omits target paths, checksums, and versions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicBundleAvailability {
    pub descriptor_id: String,
    pub language: SemanticLanguage,
    pub state: PublicBundleState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PublicBundleState {
    Ready,
    BundleUnavailable,
    BundleInvalid,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum BundleManifestError {
    #[error("bundle manifest has no descriptors")]
    EmptyManifest,
    #[error("bundle descriptor metadata is invalid")]
    InvalidMetadata,
    #[error("bundle manifest has too many descriptors")]
    TooManyDescriptors,
    #[error("bundle manifest contains a duplicate descriptor")]
    DuplicateDescriptor,
    #[error("bundle checksum must be a SHA-256 hex digest")]
    InvalidChecksum,
    #[error("bundle artifact metadata is invalid")]
    InvalidArtifactMetadata,
    #[error("bundle artifact exceeds its size budget")]
    ArtifactTooLarge,
    #[error("bundle descriptors for one target must share a payload tree checksum")]
    InconsistentPayloadTree,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_descriptor(id: &str) -> BundleDescriptor {
        BundleDescriptor {
            descriptor_id: id.into(),
            runtime_id: "native".into(),
            language: SemanticLanguage::Rust,
            version: "1.0.0".into(),
            target: BundleTarget {
                os: BundleOs::Linux,
                architecture: BundleArchitecture::X86_64,
            },
            artifact: BundleArtifact {
                sha256: "a".repeat(64),
                license_id: "MIT".into(),
                sbom_component: "rust-analyzer".into(),
                compressed_size_bytes: 1,
                uncompressed_size_bytes: 2,
                payload_tree_sha256: "b".repeat(64),
            },
        }
    }

    #[test]
    fn manifest_rejects_invalid_checksums_and_never_serializes_them_publicly() {
        let manifest = BundleManifest {
            descriptors: vec![BundleDescriptor {
                descriptor_id: "rust-analyzer".into(),
                runtime_id: "native".into(),
                language: SemanticLanguage::Rust,
                version: "1.0.0".into(),
                target: BundleTarget {
                    os: BundleOs::Linux,
                    architecture: BundleArchitecture::X86_64,
                },
                artifact: BundleArtifact {
                    sha256: "not-a-checksum".into(),
                    license_id: "MIT".into(),
                    sbom_component: "rust-analyzer".into(),
                    compressed_size_bytes: 1,
                    uncompressed_size_bytes: 2,
                    payload_tree_sha256: "b".repeat(64),
                },
            }],
        };
        assert_eq!(
            manifest.validate(),
            Err(BundleManifestError::InvalidChecksum)
        );
        let public = serde_json::to_string(&PublicBundleAvailability {
            descriptor_id: "rust-analyzer".into(),
            language: SemanticLanguage::Rust,
            state: PublicBundleState::BundleInvalid,
        })
        .unwrap();
        assert!(!public.contains("sha256"));
    }

    #[test]
    fn manifest_rejects_duplicates_counts_and_oversized_artifacts() {
        let duplicate = BundleManifest {
            descriptors: vec![valid_descriptor("rust"), valid_descriptor("rust")],
        };
        assert_eq!(
            duplicate.validate(),
            Err(BundleManifestError::DuplicateDescriptor)
        );
        let mut alternate_target = valid_descriptor("rust");
        alternate_target.target.architecture = BundleArchitecture::Aarch64;
        assert!(BundleManifest {
            descriptors: vec![valid_descriptor("rust"), alternate_target],
        }
        .validate()
        .is_ok());
        let too_many = BundleManifest {
            descriptors: (0..=MAX_BUNDLE_DESCRIPTORS)
                .map(|index| valid_descriptor(&format!("rust-{index}")))
                .collect(),
        };
        assert_eq!(
            too_many.validate(),
            Err(BundleManifestError::TooManyDescriptors)
        );
        let mut oversized = valid_descriptor("rust");
        oversized.artifact.compressed_size_bytes = MAX_COMPRESSED_ARTIFACT_BYTES + 1;
        oversized.artifact.uncompressed_size_bytes = MAX_COMPRESSED_ARTIFACT_BYTES + 1;
        assert_eq!(
            BundleManifest {
                descriptors: vec![oversized],
            }
            .validate(),
            Err(BundleManifestError::ArtifactTooLarge)
        );
        let invalid_id = BundleManifest {
            descriptors: vec![valid_descriptor("../rust")],
        };
        assert_eq!(
            invalid_id.validate(),
            Err(BundleManifestError::InvalidMetadata)
        );
    }
}
