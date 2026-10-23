//! Bundled semantic tool profile and passive zero-child integrity verification.
//!
//! Owns the single built-in TypeScript/JavaScript tool profile descriptor tied to
//! the immutable DamHopper release root. Enforces:
//! - Absolute executable and entrypoint paths only.
//! - Zero PATH, global npm/pnpm/npx, or workspace-local package resolution.
//! - Zero environment variable overrides for executable or package resolution.
//! - Zero-child passive integrity checks (file existence, regular-file checks,
//!   rejection of symlinks, permission validation, digest verification) without spawning subprocesses.
//! - Protocol qualification is strictly separated from passive integrity readiness.
//! - Java/Rust return unsupported with no generic plugin fallback.

use super::launch::{BundledLaunchSpec, LaunchError};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Pinned SHA-256 digest of the bundled Linux x64 Node.js runtime (v24.16.0).
pub const PINNED_NODE_SHA256: &str =
    "b2959781cc5a74c357ffa02367efa8a0330cbb1c9cb347732fdfaaaca381cbcd";

/// Pinned SHA-256 digest of bundled typescript-language-server (v6.0.2 cli.mjs).
pub const PINNED_TSLS_ENTRYPOINT_SHA256: &str =
    "192638f1fa62c907fd54c0b55b12dd3dff01325a1a0ed5973907efca1c57b5eb";

/// Pinned SHA-256 digest of bundled typescript compiler (v5.9.3 tsserver.js).
pub const PINNED_TSSERVER_SHA256: &str =
    "e3ccfeec65ec5c470b8ffc5611878a31182650c7e8a062c38a719f83b523edcb";

/// Pinned SHA-256 digest of bundled tsls package.json.
pub const PINNED_PACKAGE_JSON_SHA256: &str =
    "1aebb20f4c8d8b699745853542ecce7f1e7e42c85f97843bfd8064f9efdc3f7c";

/// Default installation release root on Linux systems.
pub const DEFAULT_RELEASE_ROOT: &str = "/opt/dam-hopper";

/// Canonical tool descriptor identifier for TypeScript/JavaScript language services.
pub const TYPESCRIPT_DESCRIPTOR: &str = "typescript";
/// Canonical immutable tuple identifier for the pinned bundled toolchain.
pub const BUNDLED_TUPLE_ID: &str = "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64";


/// Supported language identifiers for the TypeScript tool profile.
pub const SUPPORTED_LANGUAGE_IDS: &[&str] = &[
    "typescript",
    "typescriptreact",
    "javascript",
    "javascriptreact",
];

/// Supported source file extensions for the TypeScript tool profile.
pub const SUPPORTED_FILE_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx"];

#[derive(Debug, Error)]
pub enum ToolProfileError {
    #[error("Tool integrity check failed: {0:?}")]
    IntegrityFailed(ToolIntegrityStatus),

    #[error("Launch specification error: {0}")]
    Launch(#[from] LaunchError),

    #[error(
        "Language '{0}' is unsupported (only TypeScript/JavaScript is supported in this release)"
    )]
    UnsupportedLanguage(String),

    #[error("IO error during tool verification: {0}")]
    Io(#[from] io::Error),
}

/// Passive integrity status resulting from non-executing filesystem and digest checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolIntegrityStatus {
    /// All required artifacts exist, are regular files with correct permissions, and digests match.
    Valid,
    /// A required tool component is missing.
    Missing { path: PathBuf, component: String },
    /// An artifact is not a regular file or is an unsafe link.
    InvalidFileType { path: PathBuf, reason: String },
    /// An executable artifact lacks execution permissions or is group/world-writable.
    PermissionDenied { path: PathBuf, reason: String },
    /// An artifact digest does not match the pinned release digest.
    DigestMismatch {
        path: PathBuf,
        expected: String,
        actual: String,
    },
}

impl ToolIntegrityStatus {
    pub fn is_valid(&self) -> bool {
        matches!(self, Self::Valid)
    }
}

/// Pinned cryptographic SHA-256 digests for all executed artifacts in the tuple.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PinnedDigests {
    pub node_sha256: String,
    pub tsls_entrypoint_sha256: Option<String>,
    pub tsserver_sha256: Option<String>,
    pub package_json_sha256: Option<String>,
}

impl Default for PinnedDigests {
    fn default() -> Self {
        Self {
            node_sha256: PINNED_NODE_SHA256.to_string(),
            tsls_entrypoint_sha256: Some(PINNED_TSLS_ENTRYPOINT_SHA256.to_string()),
            tsserver_sha256: Some(PINNED_TSSERVER_SHA256.to_string()),
            package_json_sha256: Some(PINNED_PACKAGE_JSON_SHA256.to_string()),
        }
    }
}

/// Immutable bundled tool profile descriptor for TypeScript and JavaScript semantics.
#[derive(Clone, Debug)]
pub struct SemanticToolProfile {
    release_root: PathBuf,
    node_path: PathBuf,
    tsls_entrypoint: PathBuf,
    tsserver_path: PathBuf,
    package_json_path: PathBuf,
    expected_digests: PinnedDigests,
}

impl SemanticToolProfile {
    /// Create a tool profile bound to a specific release root directory using default pinned digests.
    pub fn from_release_root(root: impl AsRef<Path>) -> Self {
        Self::from_release_root_with_digests(root, PinnedDigests::default())
    }

    /// Create a tool profile bound to a specific release root directory with explicit expected digests.
    pub fn from_release_root_with_digests(root: impl AsRef<Path>, digests: PinnedDigests) -> Self {
        let root = root.as_ref().to_path_buf();
        let engine_dir = root.join("lib").join("semantic-engine");
        let tsls_dir = engine_dir.join("tsls");

        Self {
            node_path: engine_dir.join("node"),
            tsls_entrypoint: tsls_dir
                .join("node_modules")
                .join("typescript-language-server")
                .join("lib")
                .join("cli.mjs"),
            tsserver_path: tsls_dir
                .join("node_modules")
                .join("typescript")
                .join("lib")
                .join("tsserver.js"),
            package_json_path: tsls_dir.join("package.json"),
            release_root: root,
            expected_digests: digests,
        }
    }

    /// Discover the active tool profile from the current executable location or default release root.
    ///
    /// Never inspects environment variables or custom configuration flags to resolve tool paths.
    pub fn discover() -> Self {
        // Priority 1: Relative to current executable (/path/to/bin/dam-hopper-server -> /path/to)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(bin_dir) = exe.parent() {
                if let Some(prefix) = bin_dir.parent() {
                    let candidate = Self::from_release_root(prefix);
                    if candidate.node_path.exists() {
                        return candidate;
                    }
                }
            }
        }

        // Priority 2: Canonical release root
        Self::from_release_root(DEFAULT_RELEASE_ROOT)
    }

    pub fn release_root(&self) -> &Path {
        &self.release_root
    }

    pub fn node_path(&self) -> &Path {
        &self.node_path
    }

    pub fn tsls_entrypoint(&self) -> &Path {
        &self.tsls_entrypoint
    }

    pub fn tsserver_path(&self) -> &Path {
        &self.tsserver_path
    }

    pub fn package_json_path(&self) -> &Path {
        &self.package_json_path
    }
    /// Canonical tuple identifier for this bundled toolchain.
    pub fn tuple_id(&self) -> &'static str {
        BUNDLED_TUPLE_ID
    }


    /// Perform a passive, zero-child integrity check of the bundled toolchain.
    ///
    /// This method guarantees:
    /// - Zero subprocesses or child processes spawned (`node`, `npm`, etc. are NEVER invoked).
    /// - Verifies existence and regular-file status of all required artifacts.
    /// - Strictly rejects any symlinks in the release payload.
    /// - Verifies execute permissions on the Node binary.
    /// - Verifies that no artifact is group- or world-writable (mode & 0o022 == 0).
    /// - Validates SHA-256 digests against expected pinned digests.
    pub fn verify_integrity(&self) -> ToolIntegrityStatus {
        // 1. Release root directory check
        if !self.release_root.is_dir() {
            return ToolIntegrityStatus::Missing {
                path: self.release_root.clone(),
                component: "release_root".to_string(),
            };
        }

        // 2. Node binary checks
        match self.check_regular_file(&self.node_path, "node_binary") {
            Ok(()) => {}
            Err(status) => return status,
        }

        #[cfg(unix)]
        if let Ok(meta) = self.node_path.metadata() {
            if meta.permissions().mode() & 0o111 == 0 {
                return ToolIntegrityStatus::PermissionDenied {
                    path: self.node_path.clone(),
                    reason: "Node binary lacks executable permission (mode 0755 expected)"
                        .to_string(),
                };
            }
        }

        // 3. TSLS entrypoint checks
        match self.check_regular_file(&self.tsls_entrypoint, "tsls_entrypoint") {
            Ok(()) => {}
            Err(status) => return status,
        }

        // 4. tsserver.js checks
        match self.check_regular_file(&self.tsserver_path, "tsserver_entrypoint") {
            Ok(()) => {}
            Err(status) => return status,
        }

        // 5. package.json check
        match self.check_regular_file(&self.package_json_path, "package_json") {
            Ok(()) => {}
            Err(status) => return status,
        }

        // 6. Cryptographic digest verification
        if let Err(status) = self.verify_digest(&self.node_path, &self.expected_digests.node_sha256)
        {
            return status;
        }

        if let Some(expected) = &self.expected_digests.tsls_entrypoint_sha256 {
            if let Err(status) = self.verify_digest(&self.tsls_entrypoint, expected) {
                return status;
            }
        }

        if let Some(expected) = &self.expected_digests.tsserver_sha256 {
            if let Err(status) = self.verify_digest(&self.tsserver_path, expected) {
                return status;
            }
        }

        if let Some(expected) = &self.expected_digests.package_json_sha256 {
            if let Err(status) = self.verify_digest(&self.package_json_path, expected) {
                return status;
            }
        }

        ToolIntegrityStatus::Valid
    }

    /// Check that a path exists, is a regular file, is NOT a symlink, and is not group/world-writable.
    fn check_regular_file(&self, path: &Path, component: &str) -> Result<(), ToolIntegrityStatus> {
        let symlink_meta = match std::fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(_) => {
                return Err(ToolIntegrityStatus::Missing {
                    path: path.to_path_buf(),
                    component: component.to_string(),
                });
            }
        };

        // Strict: no symlinks permitted in immutable release engine payload
        if symlink_meta.file_type().is_symlink() {
            return Err(ToolIntegrityStatus::InvalidFileType {
                path: path.to_path_buf(),
                reason: "Symlinks are prohibited in immutable release payload".to_string(),
            });
        }

        if !symlink_meta.is_file() {
            return Err(ToolIntegrityStatus::InvalidFileType {
                path: path.to_path_buf(),
                reason: "Expected regular file, found directory or special file".to_string(),
            });
        }

        #[cfg(unix)]
        {
            let mode = symlink_meta.permissions().mode();
            if mode & 0o022 != 0 {
                return Err(ToolIntegrityStatus::PermissionDenied {
                    path: path.to_path_buf(),
                    reason: format!(
                        "File has unsafe group- or world-writable permissions ({mode:#o})"
                    ),
                });
            }
        }

        Ok(())
    }

    fn verify_digest(&self, path: &Path, expected: &str) -> Result<(), ToolIntegrityStatus> {
        match compute_file_sha256(path) {
            Ok(actual) => {
                if !actual.eq_ignore_ascii_case(expected) {
                    Err(ToolIntegrityStatus::DigestMismatch {
                        path: path.to_path_buf(),
                        expected: expected.to_string(),
                        actual,
                    })
                } else {
                    Ok(())
                }
            }
            Err(err) => Err(ToolIntegrityStatus::InvalidFileType {
                path: path.to_path_buf(),
                reason: format!("Failed to read file for digest verification: {err}"),
            }),
        }
    }

    /// Build a verified `BundledLaunchSpec` ready for execution.
    pub fn create_launch_spec(
        &self,
        cwd: impl AsRef<Path>,
        home_dir: impl AsRef<Path>,
    ) -> Result<BundledLaunchSpec, ToolProfileError> {
        let status = self.verify_integrity();
        if !status.is_valid() {
            return Err(ToolProfileError::IntegrityFailed(status));
        }

        let spec = BundledLaunchSpec::new(&self.node_path, &self.tsls_entrypoint, cwd, home_dir)?
            .with_tsserver_path(&self.tsserver_path);

        Ok(spec)
    }

    /// Check if a language ID is supported by this tool profile.
    pub fn is_language_supported(language_id: &str) -> bool {
        SUPPORTED_LANGUAGE_IDS.contains(&language_id)
    }

    /// Check if a file path is supported by this tool profile based on extension.
    pub fn is_file_supported(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            SUPPORTED_FILE_EXTENSIONS.contains(&ext)
        } else {
            false
        }
    }
}

/// Computes SHA-256 hex digest of a regular file using 64 KiB buffer.
pub fn compute_file_sha256(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hex::encode(hasher.finalize()))
}
