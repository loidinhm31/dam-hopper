//! Server-owned bundle selection and verification.
//!
//! Workspace configuration never supplies a command, runtime, argument, or
//! bundle root. The resolver only returns a command after the release
//! manifest, target, checksum, size, and executable-mode checks pass.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, OnceLock};

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub use super::bundle_manifest::BundleTarget;
use super::bundle_manifest::{
    BundleArchitecture, BundleDescriptor, BundleManifest, BundleOs, PublicBundleState,
};

pub const RELEASE_MANIFEST_SCHEMA_VERSION: u16 = 2;
const PAYLOAD_DIR: &str = "payload";
const MAX_PAYLOAD_FILES: usize = 100_000;
const MAX_PAYLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_SIGNATURE_BYTES: usize = 4096;
const MAX_DIGEST_BYTES: usize = 256;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundleCommandSpec {
    executable_relative_path: String,
    args: Vec<String>,
    typescript_server_path: Option<String>,
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
            typescript_server_path: None,
        })
    }

    pub(crate) fn with_typescript_server_path(mut self, path: impl Into<String>) -> Self {
        self.typescript_server_path = Some(path.into());
        self
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
    typescript_server_path: Option<PathBuf>,
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

    pub(crate) fn typescript_server_path(&self) -> Option<&Path> {
        self.typescript_server_path.as_deref()
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
    /// Immutable bundles are verified once; subsequent availability checks are O(1).
    payload_tree_cache: Arc<OnceLock<Result<String, BundleErrorKind>>>,
}

impl BundleResolver {
    pub(crate) fn new(root: impl Into<PathBuf>, manifest: BundleManifest) -> Self {
        let manifest_error = manifest.validate().err();
        Self {
            root: root.into(),
            manifest,
            commands: HashMap::new(),
            manifest_error,
            payload_tree_cache: Arc::new(OnceLock::new()),
        }
    }

    /// Load the server-owned release inputs from their fixed bundle root.
    /// Missing inputs fail closed without probing another location.
    pub fn from_signed_manifest_files(
        root: impl Into<PathBuf>,
        public_key: &[u8; 32],
    ) -> Result<Self, BundleError> {
        let root = root.into();
        let bytes = read_bounded_file(&root.join("manifest.json"), MAX_MANIFEST_BYTES)?;
        let signature = read_bounded_file(&root.join("manifest.sig"), MAX_SIGNATURE_BYTES)?;
        let digest = String::from_utf8(read_bounded_file(
            &root.join("manifest.sha256"),
            MAX_DIGEST_BYTES,
        )?)
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
        let file: ReleaseManifestFile =
            serde_json::from_slice(bytes).map_err(|_| BundleError::InvalidManifest)?;
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

    /// Build an isolated resolver for integration fixtures; production startup
    /// always uses signed release manifest inputs instead.
    #[doc(hidden)]
    pub fn for_test(root: impl Into<PathBuf>, manifest: BundleManifest) -> Self {
        Self::new(root, manifest)
    }

    /// Attach a fixed fixture command without widening workspace configuration.
    #[doc(hidden)]
    pub fn with_test_command_spec(
        self,
        descriptor_id: impl Into<String>,
        spec: BundleCommandSpec,
    ) -> Self {
        self.with_command_spec(descriptor_id, spec)
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
            match self.verify_descriptor(descriptor, false) {
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
        // Availability is cached for cheap handshakes; a spawn must always
        // rehash the complete payload so post-startup tampering is rejected.
        self.verify_descriptor(descriptor, true)
            .map_err(BundleError::from)
    }

    fn verify_descriptor(
        &self,
        descriptor: &BundleDescriptor,
        fresh_payload_verification: bool,
    ) -> Result<VerifiedBundle, BundleErrorKind> {
        let root = self
            .root
            .canonicalize()
            .map_err(|_| BundleErrorKind::Unavailable)?;
        self.verify_payload_tree(
            &root,
            &descriptor.artifact.payload_tree_sha256,
            fresh_payload_verification,
        )?;
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
        let args = spec
            .map(|spec| resolve_fixed_args(&root, &spec.args))
            .transpose()?
            .unwrap_or_default();
        let typescript_server_path = spec
            .and_then(|spec| spec.typescript_server_path.as_deref())
            .map(|path| resolve_fixed_path(&root, path))
            .transpose()?;
        Ok(VerifiedBundle {
            descriptor_id: descriptor.descriptor_id.clone(),
            runtime_id: descriptor.runtime_id.clone(),
            language: descriptor.language,
            version: descriptor.version.clone(),
            program,
            args,
            typescript_server_path,
        })
    }

    fn verify_payload_tree(
        &self,
        root: &Path,
        expected_sha256: &str,
        fresh: bool,
    ) -> Result<(), BundleErrorKind> {
        let payload_root = root.join(PAYLOAD_DIR);
        let actual = if fresh {
            hash_payload_tree(&payload_root)?
        } else {
            self.payload_tree_cache
                .get_or_init(|| hash_payload_tree(&payload_root))
                .clone()?
        };
        if constant_time_hex_eq(&actual, expected_sha256) {
            Ok(())
        } else {
            Err(BundleErrorKind::PayloadTreeMismatch)
        }
    }
}

impl BundleTarget {
    pub const fn current() -> Option<Self> {
        match (current_os(), current_architecture()) {
            (Some(os), Some(architecture)) => Some(Self { os, architecture }),
            _ => None,
        }
    }
}

#[cfg(target_os = "linux")]
const fn current_os() -> Option<BundleOs> {
    Some(BundleOs::Linux)
}

#[cfg(not(target_os = "linux"))]
const fn current_os() -> Option<BundleOs> {
    None
}

#[cfg(target_arch = "x86_64")]
const fn current_architecture() -> Option<BundleArchitecture> {
    Some(BundleArchitecture::X86_64)
}

#[cfg(not(target_arch = "x86_64"))]
const fn current_architecture() -> Option<BundleArchitecture> {
    None
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseManifestFile {
    schema_version: u16,
    descriptors: Vec<BundleDescriptor>,
}

fn read_bounded_file(path: &Path, limit: usize) -> Result<Vec<u8>, BundleError> {
    let file = std::fs::File::open(path).map_err(|_| BundleError::BundleUnavailable)?;
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| BundleError::BundleUnavailable)?;
    if bytes.len() > limit {
        return Err(BundleError::BundleUnavailable);
    }
    Ok(bytes)
}

fn resolve_fixed_args(root: &Path, args: &[String]) -> Result<Vec<String>, BundleErrorKind> {
    args.iter()
        .map(|arg| {
            if !arg.starts_with("payload/") {
                return Ok(arg.clone());
            }
            resolve_fixed_path(root, arg).and_then(|path| {
                path.into_os_string()
                    .into_string()
                    .map_err(|_| BundleErrorKind::InvalidCommandSpec)
            })
        })
        .collect()
}

fn resolve_fixed_path(root: &Path, value: &str) -> Result<PathBuf, BundleErrorKind> {
    validate_relative_entrypoint(value).map_err(|_| BundleErrorKind::InvalidCommandSpec)?;
    let path = root
        .join(value)
        .canonicalize()
        .map_err(|_| BundleErrorKind::Unavailable)?;
    let metadata = std::fs::metadata(&path).map_err(|_| BundleErrorKind::Unavailable)?;
    if !path.starts_with(root) || !metadata.is_file() {
        return Err(BundleErrorKind::InvalidCommandSpec);
    }
    Ok(path)
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

pub(crate) fn hash_payload_tree(payload_root: &Path) -> Result<String, BundleErrorKind> {
    let metadata =
        std::fs::symlink_metadata(payload_root).map_err(|_| BundleErrorKind::Unavailable)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(BundleErrorKind::PayloadTreeMismatch);
    }
    let mut files = Vec::new();
    collect_payload_files(payload_root, payload_root, &mut files)?;
    if files.is_empty() || files.len() > MAX_PAYLOAD_FILES {
        return Err(BundleErrorKind::PayloadTreeMismatch);
    }
    let payload_bytes = files.iter().try_fold(0u64, |total, path| {
        let size = std::fs::metadata(path)
            .map_err(|_| BundleErrorKind::Unavailable)?
            .len();
        total
            .checked_add(size)
            .filter(|size| *size <= MAX_PAYLOAD_BYTES)
            .ok_or(BundleErrorKind::PayloadTreeMismatch)
    })?;
    if payload_bytes > MAX_PAYLOAD_BYTES {
        return Err(BundleErrorKind::PayloadTreeMismatch);
    }
    files.sort();
    let mut digest = Sha256::new();
    for path in files {
        let relative = path
            .strip_prefix(payload_root)
            .map_err(|_| BundleErrorKind::PayloadTreeMismatch)?;
        let relative = relative
            .to_str()
            .ok_or(BundleErrorKind::PayloadTreeMismatch)?;
        let file_digest = hash_file(&path).map_err(|_| BundleErrorKind::Unavailable)?;
        digest.update(relative.as_bytes());
        digest.update([0]);
        digest.update(file_digest.as_bytes());
        digest.update([b'\n']);
    }
    Ok(hex::encode(digest.finalize()))
}

fn collect_payload_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), BundleErrorKind> {
    for entry in std::fs::read_dir(current).map_err(|_| BundleErrorKind::Unavailable)? {
        let entry = entry.map_err(|_| BundleErrorKind::Unavailable)?;
        let path = entry.path();
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| BundleErrorKind::Unavailable)?;
        if metadata.file_type().is_symlink() {
            return Err(BundleErrorKind::PayloadTreeMismatch);
        }
        if metadata.is_dir() {
            collect_payload_files(root, &path, files)?;
        } else if metadata.is_file() {
            if !path.starts_with(root) {
                return Err(BundleErrorKind::PayloadTreeMismatch);
            }
            files.push(path);
        } else {
            return Err(BundleErrorKind::PayloadTreeMismatch);
        }
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

#[cfg(all(unix, target_os = "linux", target_arch = "x86_64"))]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(all(unix, target_os = "linux", target_arch = "x86_64")))]
fn is_executable(_: &std::fs::Metadata) -> bool {
    true
}

#[derive(Clone, Debug)]
pub(crate) enum BundleErrorKind {
    Unavailable,
    InvalidCommandSpec,
    SizeOrTypeMismatch,
    NotExecutable,
    ChecksumMismatch,
    PayloadTreeMismatch,
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
            | BundleErrorKind::ChecksumMismatch
            | BundleErrorKind::PayloadTreeMismatch => Self::InvalidCommandSpec,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::io::Write;

    use crate::semantic::bundle_manifest::BundleArtifact;

    fn descriptor(digest: &str, payload_tree_sha256: String) -> BundleDescriptor {
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
                payload_tree_sha256,
            },
        }
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[tokio::test]
    async fn resolver_requires_checksum_and_executable_mode() {
        let dir = tempfile::tempdir().unwrap();
        let payload = dir.path().join(PAYLOAD_DIR);
        std::fs::create_dir(&payload).unwrap();
        let program = payload.join("rust-analyzer");
        let mut file = std::fs::File::create(&program).unwrap();
        file.write_all(b"fixture").unwrap();
        let digest = hex_digest(b"fixture");
        let payload_tree_sha256 = hash_payload_tree(&payload).unwrap();
        let manifest = BundleManifest {
            descriptors: vec![descriptor(&digest, payload_tree_sha256)],
        };
        let resolver = BundleResolver::new(dir.path(), manifest).with_command_spec(
            "rust-analyzer",
            BundleCommandSpec::new("payload/rust-analyzer", vec![]).unwrap(),
        );
        assert!(matches!(
            resolver.resolve(
                "rust-analyzer",
                BundleTarget::current().expect("supported test target")
            ),
            Err(BundleError::InvalidCommandSpec)
        ));
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
            assert!(resolver
                .resolve(
                    "rust-analyzer",
                    BundleTarget::current().expect("supported test target")
                )
                .is_ok());
            std::fs::write(&program, b"tampered").unwrap();
            assert!(matches!(
                resolver.resolve(
                    "rust-analyzer",
                    BundleTarget::current().expect("supported test target")
                ),
                Err(BundleError::InvalidCommandSpec)
            ));
        }
    }

    #[test]
    fn resolver_rejects_manifest_digest_mismatch_without_path_fallback() {
        let raw = br#"{"schema_version":2,"descriptors":[]}"#;
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
            "schema_version": 2,
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
                    "uncompressed_size_bytes": 2,
                    "payload_tree_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[test]
    fn resolver_accepts_only_a_signed_current_schema_manifest() {
        let raw = br#"{
            "schema_version": 2,
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
                    "uncompressed_size_bytes": 2,
                    "payload_tree_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
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
            .descriptor_fingerprint(
                "rust-analyzer",
                BundleTarget::current().expect("supported test target"),
            )
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

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[test]
    fn resolve_rechecks_non_entrypoint_payload_after_cached_availability() {
        let dir = tempfile::tempdir().unwrap();
        let payload = dir.path().join(PAYLOAD_DIR);
        std::fs::create_dir_all(payload.join("nested")).unwrap();
        let program = payload.join("rust-analyzer");
        std::fs::write(&program, b"fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let dependency = payload.join("nested/dependency");
        std::fs::write(&dependency, b"safe").unwrap();
        let tree = hash_payload_tree(&payload).unwrap();
        let digest = hash_file(&program).unwrap();
        let resolver = BundleResolver::new(
            dir.path(),
            BundleManifest {
                descriptors: vec![descriptor(&digest, tree)],
            },
        )
        .with_command_spec(
            "rust-analyzer",
            BundleCommandSpec::new("payload/rust-analyzer", vec![]).unwrap(),
        );
        let target = BundleTarget::current().expect("supported test target");
        assert_eq!(
            resolver.availability("rust-analyzer", target).state,
            PublicBundleState::Ready
        );
        std::fs::write(dependency, b"tampered").unwrap();
        assert!(matches!(
            resolver.resolve("rust-analyzer", target),
            Err(BundleError::InvalidCommandSpec)
        ));
    }
}
