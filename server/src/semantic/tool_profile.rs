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
/// Pinned SHA-256 digest of bundled typescript compiler shim (v5.9.3 tsserver.js).
pub const PINNED_TSSERVER_SHA256: &str =
    "e3ccfeec65ec5c470b8ffc5611878a31182650c7e8a062c38a719f83b523edcb";
/// Pinned SHA-256 digest of bundled tsls/package.json.
pub const PINNED_PACKAGE_JSON_SHA256: &str =
    "1aebb20f4c8d8b699745853542ecce7f1e7e42c85f97843bfd8064f9efdc3f7c";
/// Pinned SHA-256 digest of bundled tsls/pnpm-lock.yaml.
pub const PINNED_LOCKFILE_SHA256: &str =
    "003c24ed03f9491035a8f2a3a956d7e83f10def028b028987bdc5d618c2fdcbd";
/// Pinned SHA-256 digest of bundled tsls/LICENSES.txt.
pub const PINNED_LICENSES_SHA256: &str =
    "d0e2824ee948e8505d22d5997789516a762373f66c6f34da5d22e07bee059b66";
/// Pinned SHA-256 digest of bundled typescript-language-server/package.json.
pub const PINNED_TSLS_PACKAGE_JSON_SHA256: &str =
    "76115ed65ae7fe2f0112d784b523cc89a0751bf9cfad673c37d85a4634bdf699";
/// Pinned SHA-256 digest of bundled typescript-language-server/LICENSE.
pub const PINNED_TSLS_LICENSE_SHA256: &str =
    "899d21038f87dd6243dd33b7ee82a078e639d4325a427c01e64d8116315b9680";
/// Pinned SHA-256 digest of bundled typescript/package.json.
pub const PINNED_TS_PACKAGE_JSON_SHA256: &str =
    "822ef7ca6452205657b6288b066481ecf508bfbf43455d715cf7d3ec457561e6";
/// Pinned SHA-256 digest of bundled typescript/lib/_tsserver.js (actual executed server implementation).
pub const PINNED_TSSERVER_IMPL_SHA256: &str =
    "0efcc88cdf0593cc1dcc8b6afd605c7bed9eca6f648c70c8f0df8695114bf6d7";
/// Pinned SHA-256 digest of bundled typescript/lib/typescript.js (transitively required compiler core).
pub const PINNED_TYPESCRIPT_JS_SHA256: &str =
    "3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";
/// Pinned SHA-256 digest of bundled typescript/lib/typingsInstaller.js.
pub const PINNED_TYPINGS_INSTALLER_SHA256: &str =
    "2d48a038523ea7c626fa2796a30fa5fdc07612ea5fab83544423009d7683a213";
/// Pinned SHA-256 digest of bundled typescript/lib/_typingsInstaller.js.
pub const PINNED_TYPINGS_INSTALLER_IMPL_SHA256: &str =
    "62a69c574365f1c81633b86b3214f9df860aad08843028dd5244b00aa7f1e190";
/// Pinned SHA-256 digest of bundled typescript/lib/watchGuard.js.
pub const PINNED_WATCH_GUARD_SHA256: &str =
    "471200d4bc555ef8d8429358bdca2a68ea7c9bfff6c853b5b048d2512fe4092a";
/// Pinned SHA-256 digest of bundled typescript/lib/typesMap.json.
pub const PINNED_TYPES_MAP_SHA256: &str =
    "4143fb8b1c5d4421dfa19a4b80ddf2da375fc0835a349c3b18519fda5955e1d9";
/// Pinned SHA-256 digest of bundled typescript/lib/lib.d.ts.
pub const PINNED_LIB_D_TS_SHA256: &str =
    "a7297ff837fcdf174a9524925966429eb8e5feecc2cc55cc06574e6b092c1eaa";
/// Pinned SHA-256 digest of bundled typescript/lib/lib.es5.d.ts.
pub const PINNED_LIB_ES5_D_TS_SHA256: &str =
    "c430d44666289dae81f30fa7b2edebf186ecc91a2d4c71266ea6ae76388792e1";
/// Pinned SHA-256 digest of bundled typescript/LICENSE.txt.
pub const PINNED_TS_LICENSE_SHA256: &str =
    "a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47";
/// Pinned SHA-256 digest of bundled typescript/ThirdPartyNoticeText.txt.
pub const PINNED_TS_THIRD_PARTY_NOTICE_SHA256: &str =
    "1af3c68039c57e539422da82a4faada506ce6d0ea6f90e0b699d02dbcdb7a90c";

/// Complete transitive executed payload manifest `(relative_path_under_semantic_engine, component_id, sha256)`.
pub const PINNED_TRANSITIVE_PAYLOAD_DIGESTS: &[(&str, &str, &str)] = &[
    ("node", "node_binary", PINNED_NODE_SHA256),
    (
        "tsls/package.json",
        "package_json",
        PINNED_PACKAGE_JSON_SHA256,
    ),
    (
        "tsls/pnpm-lock.yaml",
        "pnpm_lockfile",
        PINNED_LOCKFILE_SHA256,
    ),
    (
        "tsls/LICENSES.txt",
        "bundle_licenses",
        PINNED_LICENSES_SHA256,
    ),
    (
        "tsls/node_modules/typescript-language-server/package.json",
        "tsls_package_json",
        PINNED_TSLS_PACKAGE_JSON_SHA256,
    ),
    (
        "tsls/node_modules/typescript-language-server/lib/cli.mjs",
        "tsls_entrypoint",
        PINNED_TSLS_ENTRYPOINT_SHA256,
    ),
    (
        "tsls/node_modules/typescript-language-server/LICENSE",
        "tsls_license",
        PINNED_TSLS_LICENSE_SHA256,
    ),
    (
        "tsls/node_modules/typescript/package.json",
        "typescript_package_json",
        PINNED_TS_PACKAGE_JSON_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/tsserver.js",
        "tsserver_entrypoint",
        PINNED_TSSERVER_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/_tsserver.js",
        "tsserver_impl",
        PINNED_TSSERVER_IMPL_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/typescript.js",
        "typescript_core",
        PINNED_TYPESCRIPT_JS_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/typingsInstaller.js",
        "typings_installer",
        PINNED_TYPINGS_INSTALLER_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/_typingsInstaller.js",
        "typings_installer_impl",
        PINNED_TYPINGS_INSTALLER_IMPL_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/watchGuard.js",
        "watch_guard",
        PINNED_WATCH_GUARD_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/typesMap.json",
        "types_map",
        PINNED_TYPES_MAP_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/lib.d.ts",
        "typescript_lib_d_ts",
        PINNED_LIB_D_TS_SHA256,
    ),
    (
        "tsls/node_modules/typescript/lib/lib.es5.d.ts",
        "typescript_lib_es5_d_ts",
        PINNED_LIB_ES5_D_TS_SHA256,
    ),
    (
        "tsls/node_modules/typescript/LICENSE.txt",
        "typescript_license",
        PINNED_TS_LICENSE_SHA256,
    ),
    (
        "tsls/node_modules/typescript/ThirdPartyNoticeText.txt",
        "typescript_third_party_notices",
        PINNED_TS_THIRD_PARTY_NOTICE_SHA256,
    ),
];
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
    /// Integrity has not been verified yet (cached diagnostic state prior to first verification).
    Unverified,
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
    enforce_transitive_payload: bool,
}

impl SemanticToolProfile {
    /// Create a tool profile bound to a specific release root directory using default pinned digests
    /// and enforcing the full transitive payload digest inventory.
    pub fn from_release_root(root: impl AsRef<Path>) -> Self {
        let mut profile = Self::from_release_root_with_digests(root, PinnedDigests::default());
        profile.enforce_transitive_payload = true;
        profile
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
            enforce_transitive_payload: false,
        }
    }

    /// Enable or disable full transitive payload digest verification.
    pub fn with_transitive_payload_verification(mut self, enforce: bool) -> Self {
        self.enforce_transitive_payload = enforce;
        self
    }

    /// Returns true only when this profile enforces and passes full packaged tuple verification
    /// (never true for synthetic or custom-digest test fixtures).
    pub fn is_packaged_tuple_verified(&self) -> bool {
        self.enforce_transitive_payload
            && self.expected_digests == PinnedDigests::default()
            && self.verify_packaged_tuple_integrity().is_valid()
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

        // The packaged inventory includes all four entry artifacts. Hash them once;
        // explicit custom expectations still need their own comparison.
        if self.enforce_transitive_payload {
            if let Err(status) = self.verify_transitive_payload() {
                return status;
            }
        }
        for (path, expected, pinned) in [
            (
                &self.node_path,
                Some(self.expected_digests.node_sha256.as_str()),
                PINNED_NODE_SHA256,
            ),
            (
                &self.tsls_entrypoint,
                self.expected_digests.tsls_entrypoint_sha256.as_deref(),
                PINNED_TSLS_ENTRYPOINT_SHA256,
            ),
            (
                &self.tsserver_path,
                self.expected_digests.tsserver_sha256.as_deref(),
                PINNED_TSSERVER_SHA256,
            ),
            (
                &self.package_json_path,
                self.expected_digests.package_json_sha256.as_deref(),
                PINNED_PACKAGE_JSON_SHA256,
            ),
        ] {
            if let Some(expected) = expected {
                if !self.enforce_transitive_payload || !expected.eq_ignore_ascii_case(pinned) {
                    if let Err(status) = self.verify_digest(path, expected) {
                        return status;
                    }
                }
            }
        }

        ToolIntegrityStatus::Valid
    }

    /// Unconditionally verify the release root against the full pinned packaged tuple
    /// (including all transitive executed JS files, package manifests, lockfile, and licenses).
    pub fn verify_packaged_tuple_integrity(&self) -> ToolIntegrityStatus {
        let mut strict = self.clone();
        strict.expected_digests = PinnedDigests::default();
        strict.enforce_transitive_payload = true;
        strict.verify_integrity()
    }

    fn verify_transitive_payload(&self) -> Result<(), ToolIntegrityStatus> {
        let engine_dir = self.release_root.join("lib").join("semantic-engine");
        for (rel_path, component, expected_sha) in PINNED_TRANSITIVE_PAYLOAD_DIGESTS {
            let full_path = engine_dir.join(rel_path);
            self.check_regular_file(&full_path, component)?;
            self.verify_digest(&full_path, expected_sha)?;
        }
        self.verify_directory_tree_no_symlinks_or_writable(&engine_dir)
    }

    fn verify_directory_tree_no_symlinks_or_writable(
        &self,
        dir: &Path,
    ) -> Result<(), ToolIntegrityStatus> {
        let symlink_meta =
            std::fs::symlink_metadata(dir).map_err(|_| ToolIntegrityStatus::Missing {
                path: dir.to_path_buf(),
                component: "semantic_engine_dir".to_string(),
            })?;
        if symlink_meta.file_type().is_symlink() {
            return Err(ToolIntegrityStatus::InvalidFileType {
                path: dir.to_path_buf(),
                reason: "Symlinks are prohibited in immutable release payload".to_string(),
            });
        }
        #[cfg(unix)]
        {
            let mode = symlink_meta.permissions().mode();
            if mode & 0o022 != 0 {
                return Err(ToolIntegrityStatus::PermissionDenied {
                    path: dir.to_path_buf(),
                    reason: format!(
                        "Directory has unsafe group- or world-writable permissions ({mode:#o})"
                    ),
                });
            }
        }
        let entries = std::fs::read_dir(dir).map_err(|e| ToolIntegrityStatus::InvalidFileType {
            path: dir.to_path_buf(),
            reason: format!("Failed to read directory in semantic engine payload: {e}"),
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| ToolIntegrityStatus::InvalidFileType {
                path: dir.to_path_buf(),
                reason: format!("Failed to read directory entry: {e}"),
            })?;
            let path = entry.path();
            let meta =
                std::fs::symlink_metadata(&path).map_err(|_| ToolIntegrityStatus::Missing {
                    path: path.clone(),
                    component: "semantic_engine_entry".to_string(),
                })?;
            if meta.file_type().is_symlink() {
                return Err(ToolIntegrityStatus::InvalidFileType {
                    path,
                    reason: "Symlinks are prohibited in immutable release payload".to_string(),
                });
            }
            if meta.is_dir() {
                self.verify_directory_tree_no_symlinks_or_writable(&path)?;
            } else {
                self.check_regular_file(&path, "semantic_engine_entry")?;
            }
        }
        Ok(())
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
