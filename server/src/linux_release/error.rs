//! Typed errors for release manifest parsing and contract validation.

/// Errors encountered during release manifest decoding and validation.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ReleaseError {
    #[error("manifest exceeds maximum size limit of {0} bytes")]
    PayloadTooLarge(usize),

    #[error("manifest JSON deserialization failed: {0}")]
    JsonDeserialization(String),

    #[error("invalid schema version: expected {expected}, got {got}")]
    InvalidSchemaVersion { expected: u32, got: u32 },

    #[error("invalid release version: {0}")]
    InvalidVersion(String),

    #[error("invalid release tag '{tag}': must match 'v{version}' without prerelease or build metadata")]
    InvalidTag { tag: String, version: String },

    #[error("component version mismatch for {component}: expected {expected}, got {got}")]
    ComponentVersionMismatch {
        component: &'static str,
        expected: String,
        got: String,
    },

    #[error("commit SHA must be a 40-character lowercase hexadecimal string")]
    InvalidCommitSha,

    #[error("profile field '{field}' mismatch: expected '{expected}', got '{got}'")]
    ProfileMismatch {
        field: &'static str,
        expected: String,
        got: String,
    },

    #[error("systemd minimum version mismatch: expected at least {expected}, got {got}")]
    SystemdVersionTooLow { expected: u32, got: u32 },

    #[error("archive name mismatch: expected '{expected}', got '{got}'")]
    ArchiveNameMismatch { expected: String, got: String },

    #[error("archive SHA-256 digest must be a 64-character lowercase hexadecimal string")]
    InvalidArchiveSha256,

    #[error("archive size must be greater than zero")]
    InvalidArchiveSize,

    #[error("service contract mismatch for {service}.{field}: expected '{expected}', got '{got}'")]
    ServiceContractMismatch {
        service: &'static str,
        field: &'static str,
        expected: String,
        got: String,
    },

    #[error("service port mismatch for {service}: expected {expected}, got {got}")]
    ServicePortMismatch {
        service: &'static str,
        expected: u16,
        got: u16,
    },

    #[error("rollback contract mismatch for '{field}': expected '{expected}', got '{got}'")]
    RollbackMismatch {
        field: &'static str,
        expected: String,
        got: String,
    },

    #[error("inventory exceeds maximum entry limit of {0}")]
    InventoryTooLarge(usize),

    #[error("inventory path violates normalization rules: '{0}'")]
    InvalidInventoryPath(String),

    #[error("inventory contains duplicate path: '{0}'")]
    DuplicateInventoryPath(String),

    #[error("inventory file '{path}' contains invalid SHA-256 digest")]
    InvalidFileSha256 { path: String },

    #[error("inventory entry '{path}' has invalid mode {mode:#o}: expected octal permission")]
    InvalidMode { path: String, mode: u32 },

    #[error("inventory entry '{path}' has empty role list")]
    EmptyRoles { path: String },

    #[error("inventory file '{path}' must specify byte size and sha256")]
    MissingFileMetadata { path: String },

    #[error("inventory directory '{path}' must not specify size or sha256")]
    UnexpectedDirectoryMetadata { path: String },

    #[error("required inventory path '{path}' is missing")]
    MissingRequiredPath { path: &'static str },

    #[error("required inventory path '{path}' has incorrect role or mode")]
    InvalidRequiredPath { path: &'static str },

    #[error("disallowed runtime/configuration file detected in release inventory: '{path}'")]
    DisallowedRuntimeFile { path: String },
}
