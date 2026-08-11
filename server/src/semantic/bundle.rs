//! Server-owned bundle selection and verification.
//!
//! Workspace configuration never supplies a command, runtime, argument, or
//! bundle root. The resolver only returns a command after the release
//! manifest, target, checksum, size, and executable-mode checks pass.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub use super::bundle_manifest::BundleTarget;
use super::bundle_manifest::{
    BundleArchitecture, BundleDescriptor, BundleManifest, BundleOs, PublicBundleState,
};

pub const RELEASE_MANIFEST_SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundleCommandSpec {
    executable_relative_path: String,
    args: Vec<String>,
}

impl BundleCommandSpec {
    pub fn new(
        executable_relative_path: impl Into<String>,
        args: Vec<String>,
    ) -> Result<Self, BundleError> {
        let executable_relative_path = executable_relative_path.into();
        validate_relative_entrypoint(&executable_relative_path)?;
        if args.iter().any(|arg| arg.contains('\0')) {
            return Err(BundleError::InvalidCommandSpec);
        }
        Ok(Self {
            executable_relative_path,
            args,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedBundle {
    descriptor_id: String,
    runtime_id: String,
    language: super::protocol::SemanticLanguage,
    version: String,
    program: PathBuf,
    args: Vec<String>,
}

impl VerifiedBundle {
    pub fn descriptor_id(&self) -> &str {
        &self.descriptor_id
    }

    pub fn language(&self) -> super::protocol::SemanticLanguage {
        self.language
    }

    pub fn runtime_id(&self) -> &str {
        &self.runtime_id
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundleAvailability {
    pub descriptor_id: String,
    pub language: super::protocol::SemanticLanguage,
    pub state: PublicBundleState,
}

#[derive(Clone, Debug)]
pub struct BundleResolver {
    root: PathBuf,
    manifest: BundleManifest,
    commands: HashMap<String, BundleCommandSpec>,
    manifest_error: Option<super::bundle_manifest::BundleManifestError>,
}

impl BundleResolver {
    pub(crate) fn new(root: impl Into<PathBuf>, manifest: BundleManifest) -> Self {
        let manifest_error = manifest.validate().err();
        Self {
            root: root.into(),
            manifest,
            commands: HashMap::new(),
            manifest_error,
        }
    }

    /// Load the server-owned release inputs from their fixed bundle root.
    /// Missing inputs fail closed without probing another location.
    pub fn from_signed_manifest_files(
        root: impl Into<PathBuf>,
        public_key: &[u8; 32],
    ) -> Result<Self, BundleError> {
        let root = root.into();
        let bytes = std::fs::read(root.join("manifest.json"))
            .map_err(|_| BundleError::BundleUnavailable)?;
        let signature =
            std::fs::read(root.join("manifest.sig")).map_err(|_| BundleError::BundleUnavailable)?;
        let digest = std::fs::read_to_string(root.join("manifest.sha256"))
            .map_err(|_| BundleError::BundleUnavailable)?;
        Self::from_signed_manifest_bytes(root, &bytes, digest.trim(), &signature, public_key)
    }

    /// Parse a release manifest and require a release-detached Ed25519
    /// signature plus the signed-file SHA-256 record. TOML is accepted only
    /// for local fixtures; shipped manifests are JSON.
    pub fn from_signed_manifest_bytes(
        root: impl Into<PathBuf>,
        bytes: &[u8],
        expected_sha256: &str,
        signature: &[u8],
        public_key: &[u8; 32],
    ) -> Result<Self, BundleError> {
        let actual = hex_digest(bytes);
        if !constant_time_hex_eq(&actual, expected_sha256) {
            return Err(BundleError::ManifestDigestMismatch);
        }
        let verifying_key = VerifyingKey::from_bytes(public_key)
            .map_err(|_| BundleError::InvalidManifestSignature)?;
        let signature =
            Signature::from_slice(signature).map_err(|_| BundleError::InvalidManifestSignature)?;
        verifying_key
            .verify(bytes, &signature)
            .map_err(|_| BundleError::InvalidManifestSignature)?;
        if expected_sha256.len() != 64
            || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(BundleError::ManifestDigestMismatch);
        }
        let file: ReleaseManifestFile = match serde_json::from_slice(bytes) {
            Ok(file) => file,
            Err(_) => {
                let text = std::str::from_utf8(bytes).map_err(|_| BundleError::InvalidManifest)?;
                toml::from_str(text).map_err(|_| BundleError::InvalidManifest)?
            }
        };
        if file.schema_version != RELEASE_MANIFEST_SCHEMA_VERSION {
            return Err(BundleError::UnsupportedManifestSchema);
        }
        let manifest = BundleManifest {
            descriptors: file.descriptors,
        };
        manifest.validate().map_err(BundleError::Manifest)?;
        Ok(Self::new(root, manifest))
    }

    pub(crate) fn with_command_spec(
        mut self,
        descriptor_id: impl Into<String>,
        spec: BundleCommandSpec,
    ) -> Self {
        self.commands.insert(descriptor_id.into(), spec);
        self
    }

    pub fn descriptor_fingerprint(
        &self,
        descriptor_id: &str,
        target: BundleTarget,
    ) -> Option<String> {
        self.manifest
            .descriptors
            .iter()
            .find(|descriptor| {
                descriptor.descriptor_id == descriptor_id && descriptor.target == target
            })
            .map(|descriptor| {
                format!(
                    "{}:{}:{}:{:?}:{:?}:{}",
                    descriptor.descriptor_id,
                    descriptor.runtime_id,
                    descriptor.version,
                    descriptor.target.os,
                    descriptor.target.architecture,
                    descriptor.artifact.sha256
                )
            })
    }

    pub fn descriptor_identity(
        &self,
        descriptor_id: &str,
        target: BundleTarget,
    ) -> Option<(super::protocol::SemanticLanguage, String)> {
        self.manifest
            .descriptors
            .iter()
            .find(|descriptor| {
                descriptor.descriptor_id == descriptor_id && descriptor.target == target
            })
            .map(|descriptor| (descriptor.language, descriptor.runtime_id.clone()))
    }

    pub fn availability(&self, descriptor_id: &str, target: BundleTarget) -> BundleAvailability {
        let descriptor = self.manifest.descriptors.iter().find(|descriptor| {
            descriptor.descriptor_id == descriptor_id && descriptor.target == target
        });
        let Some(descriptor) = descriptor else {
            return BundleAvailability {
                descriptor_id: descriptor_id.to_string(),
                language: self
                    .manifest
                    .descriptors
                    .iter()
                    .find(|descriptor| descriptor.descriptor_id == descriptor_id)
                    .map(|descriptor| descriptor.language)
                    .unwrap_or(super::protocol::SemanticLanguage::Rust),
                state: PublicBundleState::BundleUnavailable,
            };
        };
        let state = if self.manifest_error.is_some() {
            PublicBundleState::BundleInvalid
        } else {
            match self.verify_descriptor(descriptor) {
                Ok(_) => PublicBundleState::Ready,
                Err(BundleErrorKind::Unavailable) => PublicBundleState::BundleUnavailable,
                Err(_) => PublicBundleState::BundleInvalid,
            }
        };
        BundleAvailability {
            descriptor_id: descriptor.descriptor_id.clone(),
            language: descriptor.language,
            state,
        }
    }

    pub fn resolve(
        &self,
        descriptor_id: &str,
        target: BundleTarget,
    ) -> Result<VerifiedBundle, BundleError> {
        if let Some(error) = &self.manifest_error {
            return Err(BundleError::Manifest(error.clone()));
        }
        let descriptor = self
            .manifest
            .descriptors
            .iter()
            .find(|descriptor| {
                descriptor.descriptor_id == descriptor_id && descriptor.target == target
            })
            .ok_or(BundleError::BundleUnavailable)?;
        self.verify_descriptor(descriptor)
            .map_err(BundleError::from)
    }

    fn verify_descriptor(
        &self,
        descriptor: &BundleDescriptor,
    ) -> Result<VerifiedBundle, BundleErrorKind> {
        let root = self
            .root
            .canonicalize()
            .map_err(|_| BundleErrorKind::Unavailable)?;
        let spec = self.commands.get(&descriptor.descriptor_id);
        let entrypoint = spec
            .map(|spec| spec.executable_relative_path.as_str())
            .unwrap_or(&descriptor.descriptor_id);
        validate_relative_entrypoint(entrypoint)
            .map_err(|_| BundleErrorKind::InvalidCommandSpec)?;
        let candidate = root.join(entrypoint);
        let program = candidate
            .canonicalize()
            .map_err(|_| BundleErrorKind::Unavailable)?;
        if !program.starts_with(&root) {
            return Err(BundleErrorKind::InvalidCommandSpec);
        }
        let metadata = std::fs::metadata(&program).map_err(|_| BundleErrorKind::Unavailable)?;
        if !metadata.is_file()
            || metadata.len() == 0
            || metadata.len() > descriptor.artifact.uncompressed_size_bytes
        {
            return Err(BundleErrorKind::SizeOrTypeMismatch);
        }
        if !is_executable(&metadata) {
            return Err(BundleErrorKind::NotExecutable);
        }
        let actual = hash_file(&program).map_err(|_| BundleErrorKind::Unavailable)?;
        if !constant_time_hex_eq(&actual, &descriptor.artifact.sha256) {
            return Err(BundleErrorKind::ChecksumMismatch);
        }
        Ok(VerifiedBundle {
            descriptor_id: descriptor.descriptor_id.clone(),
            runtime_id: descriptor.runtime_id.clone(),
            language: descriptor.language,
            version: descriptor.version.clone(),
            program,
            args: spec.map(|spec| spec.args.clone()).unwrap_or_default(),
        })
    }
}

impl BundleTarget {
    pub const fn current() -> Self {
        Self {
            os: current_os(),
            architecture: current_architecture(),
        }
    }
}

const fn current_os() -> BundleOs {
    #[cfg(target_os = "windows")]
    {
        return BundleOs::Windows;
    }
    #[cfg(target_os = "macos")]
    {
        return BundleOs::Macos;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        BundleOs::Linux
    }
}

const fn current_architecture() -> BundleArchitecture {
    #[cfg(target_arch = "aarch64")]
    {
        return BundleArchitecture::Aarch64;
    }
    BundleArchitecture::X86_64
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseManifestFile {
    schema_version: u16,
    descriptors: Vec<BundleDescriptor>,
}

fn validate_relative_entrypoint(value: &str) -> Result<(), BundleError> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || value.contains('\0')
    {
        return Err(BundleError::InvalidCommandSpec);
    }
    Ok(())
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    hex::encode(digest.finalize())
}

fn constant_time_hex_eq(left: &str, right: &str) -> bool {
    use subtle::ConstantTimeEq;
    left.as_bytes().ct_eq(right.as_bytes()).into()
}

#[cfg(unix)]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_: &std::fs::Metadata) -> bool {
    true
}

#[derive(Clone, Debug)]
enum BundleErrorKind {
    Unavailable,
    InvalidCommandSpec,
    SizeOrTypeMismatch,
    NotExecutable,
    ChecksumMismatch,
}

#[derive(Debug, Error)]
pub enum BundleError {
    #[error("bundle manifest is invalid")]
    Manifest(super::bundle_manifest::BundleManifestError),
    #[error("bundle is unavailable for this target")]
    BundleUnavailable,
    #[error("bundle manifest is invalid")]
    InvalidManifest,
    #[error("bundle manifest schema is unsupported")]
    UnsupportedManifestSchema,
    #[error("bundle manifest digest does not match the release record")]
    ManifestDigestMismatch,
    #[error("bundle manifest signature is invalid or missing")]
    InvalidManifestSignature,
    #[error("bundle command specification is invalid")]
    InvalidCommandSpec,
}

impl From<BundleErrorKind> for BundleError {
    fn from(value: BundleErrorKind) -> Self {
        match value {
            BundleErrorKind::Unavailable => Self::BundleUnavailable,
            BundleErrorKind::InvalidCommandSpec
            | BundleErrorKind::SizeOrTypeMismatch
            | BundleErrorKind::NotExecutable
            | BundleErrorKind::ChecksumMismatch => Self::InvalidCommandSpec,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::io::Write;

    use crate::semantic::bundle_manifest::BundleArtifact;

    fn descriptor(digest: &str) -> BundleDescriptor {
        BundleDescriptor {
            descriptor_id: "rust-analyzer".into(),
            runtime_id: "native".into(),
            language: super::super::protocol::SemanticLanguage::Rust,
            version: "1.0.0".into(),
            target: BundleTarget {
                os: BundleOs::Linux,
                architecture: BundleArchitecture::X86_64,
            },
            artifact: BundleArtifact {
                sha256: digest.into(),
                license_id: "MIT".into(),
                sbom_component: "rust-analyzer".into(),
                compressed_size_bytes: 1,
                uncompressed_size_bytes: 4096,
            },
        }
    }

    #[tokio::test]
    async fn resolver_requires_checksum_and_executable_mode() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("rust-analyzer");
        let mut file = std::fs::File::create(&program).unwrap();
        file.write_all(b"fixture").unwrap();
        let digest = hex_digest(b"fixture");
        let manifest = BundleManifest {
            descriptors: vec![descriptor(&digest)],
        };
        let resolver = BundleResolver::new(dir.path(), manifest);
        #[cfg(unix)]
        assert!(matches!(
            resolver.resolve("rust-analyzer", BundleTarget::current()),
            Err(BundleError::InvalidCommandSpec)
        ));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert!(resolver
                .resolve("rust-analyzer", BundleTarget::current())
                .is_ok());
        }
    }

    #[test]
    fn resolver_rejects_manifest_digest_mismatch_without_path_fallback() {
        let raw = br#"{"schema_version":1,"descriptors":[]}"#;
        assert!(matches!(
            BundleResolver::from_signed_manifest_bytes(
                tempfile::tempdir().unwrap().path(),
                raw,
                "a",
                &[],
                &[0; 32]
            ),
            Err(BundleError::ManifestDigestMismatch)
        ));
    }

    #[test]
    fn resolver_loads_fixed_signed_manifest_files_without_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let raw = br#"{
            "schema_version": 1,
            "descriptors": [{
                "descriptor_id": "rust-analyzer",
                "runtime_id": "native",
                "language": "rust",
                "version": "1.0.0",
                "target": {"os": "linux", "architecture": "x86_64"},
                "artifact": {
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "license_id": "MIT",
                    "sbom_component": "rust-analyzer",
                    "compressed_size_bytes": 1,
                    "uncompressed_size_bytes": 2
                }
            }]
        }"#;
        std::fs::write(dir.path().join("manifest.json"), raw).unwrap();
        std::fs::write(dir.path().join("manifest.sig"), [0; 64]).unwrap();
        std::fs::write(
            dir.path().join("manifest.sha256"),
            format!("{}\n", hex_digest(raw)),
        )
        .unwrap();
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        std::fs::write(
            dir.path().join("manifest.sig"),
            signing_key.sign(raw).to_bytes(),
        )
        .unwrap();
        assert!(BundleResolver::from_signed_manifest_files(
            dir.path(),
            signing_key.verifying_key().as_bytes(),
        )
        .is_ok());
        std::fs::remove_file(dir.path().join("manifest.sig")).unwrap();
        assert!(matches!(
            BundleResolver::from_signed_manifest_files(
                dir.path(),
                signing_key.verifying_key().as_bytes(),
            ),
            Err(BundleError::BundleUnavailable)
        ));
    }

    #[test]
    fn resolver_accepts_only_a_signed_current_schema_manifest() {
        let raw = br#"{
            "schema_version": 1,
            "descriptors": [{
                "descriptor_id": "rust-analyzer",
                "runtime_id": "native",
                "language": "rust",
                "version": "1.0.0",
                "target": {"os": "linux", "architecture": "x86_64"},
                "artifact": {
                    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "license_id": "MIT",
                    "sbom_component": "rust-analyzer",
                    "compressed_size_bytes": 1,
                    "uncompressed_size_bytes": 2
                }
            }]
        }"#;
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let signature = signing_key.sign(raw).to_bytes();
        let digest = hex_digest(raw);
        let resolver = BundleResolver::from_signed_manifest_bytes(
            tempfile::tempdir().unwrap().path(),
            raw,
            &digest,
            &signature,
            signing_key.verifying_key().as_bytes(),
        )
        .unwrap();
        assert!(resolver
            .descriptor_fingerprint("rust-analyzer", BundleTarget::current())
            .is_some());

        let mut tampered = raw.to_vec();
        tampered[25] = b'2';
        assert!(matches!(
            BundleResolver::from_signed_manifest_bytes(
                tempfile::tempdir().unwrap().path(),
                &tampered,
                &hex_digest(&tampered),
                &signature,
                signing_key.verifying_key().as_bytes(),
            ),
            Err(BundleError::InvalidManifestSignature)
        ));
    }
}
