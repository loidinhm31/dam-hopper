use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;

use serde::{Deserialize, Serialize};

use crate::idle_suspend::event::{validate_canonical_uuid_v4, ProducerIdentity};
use crate::idle_suspend::protocol::{SuspendOutcome, HELPER_PROTOCOL_VERSION};

/// Schema version for privileged helper audit records (evolved to v2).
pub const HELPER_AUDIT_SCHEMA_VERSION: u32 = 2;

/// Default schema version for legacy records without explicit version.
pub const fn default_audit_schema_version() -> u32 {
    1
}

/// Maximum line length for an emitted helper audit JSON line (16 KiB).
pub const MAX_HELPER_AUDIT_LINE_BYTES: usize = 16 * 1024;

/// Bounded capacity for the root helper audit log to prevent disk exhaustion.
pub const DEFAULT_HELPER_AUDIT_MAX_RECORDS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperAuditRecordType {
    /// Helper accepted the request and will attempt execution.
    AcceptedIntent,
    /// Helper finished execution with a terminal outcome.
    ExecutionCompleted,
    /// Helper rejected the request before attempting execution.
    ExecutionRejected,
    /// Request rejected during auth, decoding, validation, or deduplication.
    RequestRejected,
    /// Result of a capability probe.
    CapabilityResult,
    /// Result of a preflight check before intent persistence.
    PreflightResult,
    /// Result of programming the RTC wakealarm.
    RtcProgrammingResult,
    /// Dispatched immediately before invoking host suspend backend.
    SuspendInvoked,
}

/// Closed set of reason codes for helper audits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperReasonCode {
    PeerAuthenticationFailed,
    InvalidFrame,
    ProtocolInvalid,
    DuplicateRequest,
    InhibitorPresent,
    CapabilityUnsupported,
    RtcBusy,
    PreflightFailed,
    AuditWriteFailed,
    RtcProgrammingFailed,
    SuspendFailed,
    SuspendReturned,
    RejectedFleetActive,
}

impl HelperReasonCode {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::PeerAuthenticationFailed => "peerAuthenticationFailed",
            Self::InvalidFrame => "invalidFrame",
            Self::ProtocolInvalid => "protocolInvalid",
            Self::DuplicateRequest => "duplicateRequest",
            Self::InhibitorPresent => "inhibitorPresent",
            Self::CapabilityUnsupported => "capabilityUnsupported",
            Self::RtcBusy => "rtcBusy",
            Self::PreflightFailed => "preflightFailed",
            Self::AuditWriteFailed => "auditWriteFailed",
            Self::RtcProgrammingFailed => "rtcProgrammingFailed",
            Self::SuspendFailed => "suspendFailed",
            Self::SuspendReturned => "suspendReturned",
            Self::RejectedFleetActive => "rejectedFleetActive",
        }
    }
}

/// Closed set of outcome codes for helper audits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperOutcomeCode {
    ResumedSuccessfully,
    RejectedFleetActive,
    BlockedByInhibitor,
    UnsupportedCapability,
    ExecutionFailed,
    Success,
    Failed,
}

impl HelperOutcomeCode {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::ResumedSuccessfully => "resumedSuccessfully",
            Self::RejectedFleetActive => "rejectedFleetActive",
            Self::BlockedByInhibitor => "blockedByInhibitor",
            Self::UnsupportedCapability => "unsupportedCapability",
            Self::ExecutionFailed => "executionFailed",
            Self::Success => "success",
            Self::Failed => "failed",
        }
    }
}

/// A structured immutable audit entry recorded by the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperAuditRecord {
    #[serde(default = "default_audit_schema_version")]
    pub audit_schema_version: u32,
    pub record_type: HelperAuditRecordType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub protocol_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wake_after_seconds: Option<u64>,
    pub peer_pid: u32,
    pub peer_uid: u32,
    pub timestamp_epoch_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_instance_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_sequence: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<SuspendOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome_code: Option<HelperOutcomeCode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<HelperReasonCode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl HelperAuditRecord {
    pub fn new_intent(
        request_id: impl Into<String>,
        wake_after_seconds: u64,
        peer_pid: u32,
        peer_uid: u32,
    ) -> Self {
        let req_id = request_id.into();
        let now = current_epoch_ms();
        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::AcceptedIntent,
            request_id: Some(req_id),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: Some(wake_after_seconds),
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: None,
            reason_code: None,
            detail: None,
        }
    }

    pub fn new_completed(
        request_id: impl Into<String>,
        wake_after_seconds: u64,
        peer_pid: u32,
        peer_uid: u32,
        outcome: SuspendOutcome,
    ) -> Self {
        let req_id = request_id.into();
        let now = current_epoch_ms();
        let (outcome_code, reason_code) = match &outcome {
            SuspendOutcome::ResumedSuccessfully { .. } => {
                (Some(HelperOutcomeCode::ResumedSuccessfully), None)
            }
            SuspendOutcome::RejectedFleetActive { .. } => (
                Some(HelperOutcomeCode::RejectedFleetActive),
                Some(HelperReasonCode::RejectedFleetActive),
            ),
            SuspendOutcome::BlockedByInhibitor { .. } => (
                Some(HelperOutcomeCode::BlockedByInhibitor),
                Some(HelperReasonCode::InhibitorPresent),
            ),
            SuspendOutcome::UnsupportedCapability { .. } => (
                Some(HelperOutcomeCode::UnsupportedCapability),
                Some(HelperReasonCode::CapabilityUnsupported),
            ),
            SuspendOutcome::ExecutionFailed { error, .. } => {
                let reason = if error.contains("already programmed") || error.contains("busy") {
                    HelperReasonCode::RtcBusy
                } else if error.contains("RTC") || error.contains("wakealarm") {
                    HelperReasonCode::RtcProgrammingFailed
                } else {
                    HelperReasonCode::SuspendFailed
                };
                (Some(HelperOutcomeCode::ExecutionFailed), Some(reason))
            }
        };

        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::ExecutionCompleted,
            request_id: Some(req_id),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: Some(wake_after_seconds),
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: Some(outcome),
            outcome_code,
            reason_code,
            detail: None,
        }
    }

    pub fn new_rejected(
        request_id: impl Into<String>,
        peer_pid: u32,
        peer_uid: u32,
        detail: impl Into<String>,
    ) -> Self {
        let req_id = request_id.into();
        let d = detail.into();
        let now = current_epoch_ms();
        let reason_code = if d.contains("Peer authentication") {
            Some(HelperReasonCode::PeerAuthenticationFailed)
        } else if d.contains("Frame decode") || d.contains("Frame validation") {
            Some(HelperReasonCode::InvalidFrame)
        } else if d.contains("Deduplication") {
            Some(HelperReasonCode::DuplicateRequest)
        } else {
            Some(HelperReasonCode::ProtocolInvalid)
        };

        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::ExecutionRejected,
            request_id: Some(req_id),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: None,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: Some(HelperOutcomeCode::Failed),
            reason_code,
            detail: Some(d),
        }
    }

    pub fn new_request_rejected(
        peer_pid: u32,
        peer_uid: u32,
        reason_code: HelperReasonCode,
        request_id: Option<String>,
        detail: Option<String>,
    ) -> Self {
        let now = current_epoch_ms();
        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::RequestRejected,
            request_id,
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: None,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: Some(HelperOutcomeCode::Failed),
            reason_code: Some(reason_code),
            detail,
        }
    }

    pub fn new_capability_result(
        supported: bool,
        peer_pid: u32,
        peer_uid: u32,
        reason_code: Option<HelperReasonCode>,
        detail: Option<String>,
    ) -> Self {
        let now = current_epoch_ms();
        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::CapabilityResult,
            request_id: None,
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: None,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: Some(if supported {
                HelperOutcomeCode::Success
            } else {
                HelperOutcomeCode::Failed
            }),
            reason_code,
            detail,
        }
    }

    pub fn new_preflight_result(
        passed: bool,
        request_id: impl Into<String>,
        peer_pid: u32,
        peer_uid: u32,
        reason_code: Option<HelperReasonCode>,
        detail: Option<String>,
    ) -> Self {
        let now = current_epoch_ms();
        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::PreflightResult,
            request_id: Some(request_id.into()),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: None,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: Some(if passed {
                HelperOutcomeCode::Success
            } else {
                HelperOutcomeCode::Failed
            }),
            reason_code: if passed { None } else { reason_code },
            detail,
        }
    }

    pub fn new_rtc_result(
        success: bool,
        request_id: impl Into<String>,
        wake_after_seconds: Option<u64>,
        peer_pid: u32,
        peer_uid: u32,
        reason_code: Option<HelperReasonCode>,
        detail: Option<String>,
    ) -> Self {
        let now = current_epoch_ms();
        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::RtcProgrammingResult,
            request_id: Some(request_id.into()),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: Some(if success {
                HelperOutcomeCode::Success
            } else {
                HelperOutcomeCode::Failed
            }),
            reason_code: if success {
                None
            } else {
                reason_code.or(Some(HelperReasonCode::RtcProgrammingFailed))
            },
            detail,
        }
    }

    pub fn new_suspend_invoked(
        request_id: impl Into<String>,
        wake_after_seconds: Option<u64>,
        peer_pid: u32,
        peer_uid: u32,
    ) -> Self {
        let now = current_epoch_ms();
        Self {
            audit_schema_version: HELPER_AUDIT_SCHEMA_VERSION,
            record_type: HelperAuditRecordType::SuspendInvoked,
            request_id: Some(request_id.into()),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: now,
            timestamp_ms: Some(now),
            boot_id: None,
            producer_instance_id: None,
            producer_sequence: None,
            correlation_id: None,
            outcome: None,
            outcome_code: None,
            reason_code: None,
            detail: None,
        }
    }

    pub fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }

    pub fn is_indefinite_sleep(&self) -> bool {
        self.wake_after_seconds == Some(0)
    }
}

fn current_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Errors occurring during helper audit operations.
#[derive(Debug, thiserror::Error)]
pub enum HelperAuditError {
    #[error("Audit log I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("Audit record serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Producer identity error: {0}")]
    Identity(String),
    #[error("Audit destination parent path rejected: must be an existing directory without symlinks")]
    ParentPathRejected,
    #[error("Audit destination file rejected: must be a regular file without symlinks")]
    FileSecurityRejected,
    #[error("Serialized audit line exceeds maximum size of {0} bytes: {1} bytes")]
    LineTooLarge(usize, usize),
    #[error("Producer sequence reached maximum value (overflow)")]
    SequenceOverflow,
}

#[derive(Debug)]
struct HelperAuditState {
    next_sequence: u64,
    record_count: usize,
}

pub struct HelperAudit {
    path: PathBuf,
    max_records: usize,
    identity: ProducerIdentity,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    state: Mutex<HelperAuditState>,
}

impl std::fmt::Debug for HelperAudit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HelperAudit")
            .field("path", &self.path)
            .field("max_records", &self.max_records)
            .field("identity", &self.identity)
            .field("state", &self.state)
            .finish()
    }
}

impl HelperAudit {
    pub fn new(path: impl AsRef<Path>, max_records: usize) -> Result<Self, HelperAuditError> {
        let identity = ProducerIdentity::load()
            .map_err(|e| HelperAuditError::Identity(e.to_string()))?;
        Self::with_identity(path, max_records, identity)
    }

    pub fn with_identity(
        path: impl AsRef<Path>,
        max_records: usize,
        identity: ProducerIdentity,
    ) -> Result<Self, HelperAuditError> {
        Self::with_identity_and_clock(
            path,
            max_records,
            identity,
            Arc::new(current_epoch_ms),
        )
    }

    pub fn with_identity_and_clock(
        path: impl AsRef<Path>,
        max_records: usize,
        identity: ProducerIdentity,
        clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    ) -> Result<Self, HelperAuditError> {
        let path = path.as_ref().to_path_buf();

        #[cfg(unix)]
        {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() && parent.exists() {
                    let meta = std::fs::symlink_metadata(parent).map_err(|e| HelperAuditError::Io {
                        path: parent.to_path_buf(),
                        source: e,
                    })?;
                    if !meta.is_dir() {
                        return Err(HelperAuditError::ParentPathRejected);
                    }
                }
            }
            if path.exists() {
                let meta = std::fs::symlink_metadata(&path).map_err(|e| HelperAuditError::Io {
                    path: path.clone(),
                    source: e,
                })?;
                if !meta.file_type().is_file() {
                    return Err(HelperAuditError::FileSecurityRejected);
                }
            }
        }
        let record_count = if path.exists() {
            if let Ok(f) = File::open(&path) {
                BufReader::new(f).lines().count()
            } else {
                0
            }
        } else {
            0
        };

        Ok(Self {
            path,
            max_records: max_records.max(10),
            identity,
            clock,
            state: Mutex::new(HelperAuditState {
                next_sequence: 1,
                record_count,
            }),
        })
    }

    /// Helper path accessor.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Producer identity accessor.
    pub fn identity(&self) -> &ProducerIdentity {
        &self.identity
    }

    /// Record an audit entry. Fail-closed: ensures data is synced to physical storage.
    pub fn record(&self, record: &HelperAuditRecord) -> Result<(), HelperAuditError> {
        let mut state = self.state.lock();

        // Allocate sequence (consumed even on error)
        let seq = state.next_sequence;
        if seq == u64::MAX {
            return Err(HelperAuditError::SequenceOverflow);
        }
        state.next_sequence = seq + 1;

        // Enrich logical record with v2 metadata
        let mut enriched = record.clone();
        enriched.audit_schema_version = HELPER_AUDIT_SCHEMA_VERSION;
        enriched.boot_id = Some(self.identity.boot_id.clone());
        enriched.producer_instance_id = Some(self.identity.producer_instance_id.clone());
        enriched.producer_sequence = Some(seq);

        let now = (self.clock)();
        if enriched.timestamp_epoch_ms == 0 {
            enriched.timestamp_epoch_ms = now;
        }
        if enriched.timestamp_ms.is_none() {
            enriched.timestamp_ms = Some(enriched.timestamp_epoch_ms);
        }

        if enriched.correlation_id.is_none() {
            if let Some(req_id) = &enriched.request_id {
                if validate_canonical_uuid_v4(req_id).is_ok() {
                    enriched.correlation_id = Some(req_id.clone());
                }
            }
        }

        let json_line = serde_json::to_string(&enriched)?;
        if json_line.len() > MAX_HELPER_AUDIT_LINE_BYTES {
            return Err(HelperAuditError::LineTooLarge(
                json_line.len(),
                MAX_HELPER_AUDIT_LINE_BYTES,
            ));
        }

        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|e| HelperAuditError::Io {
                    path: parent.to_path_buf(),
                    source: e,
                })?;
            }
        }

        // Open with mode 0600 on Unix with O_NOFOLLOW
        let mut open_options = OpenOptions::new();
        open_options.create(true).write(true).append(true);

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open_options.mode(0o600);
            open_options.custom_flags(libc::O_NOFOLLOW);
        }

        let mut file = open_options.open(&self.path).map_err(|e| HelperAuditError::Io {
            path: self.path.clone(),
            source: e,
        })?;

        writeln!(file, "{}", json_line).map_err(|e| HelperAuditError::Io {
            path: self.path.clone(),
            source: e,
        })?;

        // Fail-closed guarantee: sync metadata and contents to disk
        file.sync_all().map_err(|e| HelperAuditError::Io {
            path: self.path.clone(),
            source: e,
        })?;

        state.record_count += 1;
        if state.record_count > self.max_records {
            self.prune_if_needed(&mut state)?;
        }

        Ok(())
    }

    /// Read all audit records currently stored in the file.
    pub fn read_all_records(&self) -> Result<Vec<HelperAuditRecord>, HelperAuditError> {
        let _guard = self.state.lock();
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let file = File::open(&self.path).map_err(|e| HelperAuditError::Io {
            path: self.path.clone(),
            source: e,
        })?;
        let reader = BufReader::new(file);
        let mut records = Vec::new();

        for line in reader.lines() {
            let line = line.map_err(|e| HelperAuditError::Io {
                path: self.path.clone(),
                source: e,
            })?;
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<HelperAuditRecord>(line) {
                records.push(rec);
            }
        }

        Ok(records)
    }
    fn prune_if_needed(&self, state: &mut HelperAuditState) -> Result<(), HelperAuditError> {
        let Ok(file) = File::open(&self.path) else {
            return Ok(());
        };
        let reader = BufReader::new(file);
        let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

        if lines.len() <= self.max_records {
            state.record_count = lines.len();
            return Ok(());
        }

        // Retain only the most recent (max_records / 2) to avoid frequent rotations
        let keep_count = self.max_records / 2;
        let retained = &lines[lines.len() - keep_count..];

        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        let tmp_name = format!(
            ".audit-prune-{}-{}.tmp",
            std::process::id(),
            uuid::Uuid::new_v4()
        );
        let tmp_path = parent.join(tmp_name);

        let mut open_options = OpenOptions::new();
        open_options.write(true).create_new(true);

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            open_options.mode(0o600);
            open_options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }

        let write_res = (|| -> Result<(), HelperAuditError> {
            let mut tmp_file = open_options.open(&tmp_path).map_err(|e| HelperAuditError::Io {
                path: tmp_path.clone(),
                source: e,
            })?;

            for line in retained {
                writeln!(tmp_file, "{}", line).map_err(|e| HelperAuditError::Io {
                    path: tmp_path.clone(),
                    source: e,
                })?;
            }

            tmp_file.sync_all().map_err(|e| HelperAuditError::Io {
                path: tmp_path.clone(),
                source: e,
            })?;

            std::fs::rename(&tmp_path, &self.path).map_err(|e| HelperAuditError::Io {
                path: self.path.clone(),
                source: e,
            })?;

            #[cfg(unix)]
            {
                if let Ok(dir) = File::open(parent) {
                    let _ = dir.sync_all();
                }
            }

            Ok(())
        })();

        if write_res.is_err() {
            let _ = std::fs::remove_file(&tmp_path);
        }
        write_res?;

        state.record_count = keep_count;
        Ok(())
    }
}
