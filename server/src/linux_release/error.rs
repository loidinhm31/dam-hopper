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

    #[error(
        "invalid release tag '{tag}': must match 'v{version}' without prerelease or build metadata"
    )]
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

    #[error("uncompressed archive data exceeds safety limit of {limit} bytes")]
    ArchiveTooLarge { limit: u64 },

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

    #[error("unsupported operating system: expected '{expected}', got '{got}'")]
    UnsupportedOs { expected: String, got: String },

    #[error("unsupported operating system version: expected '{expected}', got '{got}'")]
    UnsupportedOsVersion { expected: String, got: String },

    #[error("unsupported architecture: expected '{expected}', got '{got}'")]
    UnsupportedArch { expected: String, got: String },

    #[error("glibc version too low: expected at least '{expected}', got '{got}'")]
    GlibcVersionTooLow { expected: String, got: String },

    #[error("systemd is not running as system manager (PID 1) on this host")]
    SystemdNotActive,

    #[error("required privilege level not met for {operation}: required EUID {expected_euid}, current EUID {actual_euid}")]
    PrivilegeRequired {
        operation: &'static str,
        expected_euid: u32,
        actual_euid: u32,
    },

    #[error(
        "operation {operation} must be run as an unprivileged user, not root (EUID {actual_euid})"
    )]
    UserPrivilegeRequired {
        operation: &'static str,
        actual_euid: u32,
    },

    #[error("invalid web origin '{origin}': {reason}")]
    InvalidWebOrigin {
        origin: String,
        reason: &'static str,
    },

    #[error("duplicate web origin '{0}'")]
    DuplicateWebOrigin(String),

    #[error(
        "missing deployment role: fresh install requires an explicit role (--role server|web|both)"
    )]
    MissingRole,

    #[error("cannot change recorded deployment role '{recorded}' with 'install --role {requested}'; use 'role set' instead")]
    RoleConflict { recorded: String, requested: String },

    #[error("deployment lock is currently held by another process")]
    DeploymentLockBusy,

    #[error("failed to acquire deployment lock: {0}")]
    DeploymentLockError(String),

    #[error("archive entry '{path}' is not a regular file or directory")]
    ArchiveEntryNotRegularFileOrDir { path: String },

    #[error("archive entry path '{0}' is invalid or attempts directory traversal")]
    ArchiveEntryTraversal(String),

    #[error("archive entry '{path}' has unexpected metadata: {reason}")]
    ArchiveEntryInvalid { path: String, reason: String },

    #[error("archive entry '{path}' digest mismatch: expected sha256 '{expected}', got '{got}'")]
    ArchiveDigestMismatch {
        path: String,
        expected: String,
        got: String,
    },

    #[error("archive does not match release inventory: {reason}")]
    ArchiveInventoryMismatch { reason: String },

    #[error("acquisition failed: {0}")]
    AcquisitionFailed(String),

    #[error("attestation verification failed: {0}")]
    AttestationFailed(String),

    #[error("invalid release bundle at '{path}': {reason}")]
    InvalidBundle { path: String, reason: String },

    #[error("template token injection in '{token}': {details}")]
    TemplateTokenInjection { token: String, details: String },

    #[error("unresolved template token in unit: '{token}'")]
    UnresolvedTemplateToken { token: String },

    #[error("unit policy violation for '{unit}': {reason}")]
    UnitPolicyViolation { unit: String, reason: String },

    #[error("systemd command '{command}' failed with exit code {exit_code:?}: {stderr}")]
    SystemdCommandFailed {
        command: String,
        exit_code: Option<i32>,
        stderr: String,
    },

    #[error("sysusers creation failed: {reason}")]
    SysusersFailed { reason: String },

    #[error("ownership or permission violation for '{path}': expected '{expected}', got '{got}'")]
    OwnershipViolation {
        path: String,
        expected: String,
        got: String,
    },

    #[error("process inspection failed: {reason}")]
    ProcessInspectionFailed { reason: String },

    #[error("legacy format 1 is unsupported for automatic migration: {0}")]
    UnsupportedFormat1Migration(String),

    #[error("legacy format-2 migration rejected: {reason}")]
    LegacyMigrationRejected { reason: String },

    #[error("atomic directory exchange failed during {action}: {details}")]
    ExchangeFailed {
        action: &'static str,
        details: String,
    },
    #[error("filesystem I/O error during {action}: {details}")]
    Io {
        action: &'static str,
        details: String,
    },
    #[error("configuration error: {0}")]
    Config(String),
}
