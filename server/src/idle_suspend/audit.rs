use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::idle_suspend::protocol::{SuspendOutcome, HELPER_PROTOCOL_VERSION};

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
}

/// A structured immutable audit entry recorded by the privileged helper.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperAuditRecord {
    pub record_type: HelperAuditRecordType,
    pub request_id: String,
    pub protocol_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wake_after_seconds: Option<u64>,
    pub peer_pid: u32,
    pub peer_uid: u32,
    pub timestamp_epoch_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<SuspendOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl HelperAuditRecord {
    pub fn new_intent(
        request_id: impl Into<String>,
        wake_after_seconds: u64,
        peer_pid: u32,
        peer_uid: u32,
    ) -> Self {
        Self {
            record_type: HelperAuditRecordType::AcceptedIntent,
            request_id: request_id.into(),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: Some(wake_after_seconds),
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: current_epoch_ms(),
            outcome: None,
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
        Self {
            record_type: HelperAuditRecordType::ExecutionCompleted,
            request_id: request_id.into(),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: Some(wake_after_seconds),
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: current_epoch_ms(),
            outcome: Some(outcome),
            detail: None,
        }
    }

    pub fn new_rejected(
        request_id: impl Into<String>,
        peer_pid: u32,
        peer_uid: u32,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            record_type: HelperAuditRecordType::ExecutionRejected,
            request_id: request_id.into(),
            protocol_version: HELPER_PROTOCOL_VERSION,
            wake_after_seconds: None,
            peer_pid,
            peer_uid,
            timestamp_epoch_ms: current_epoch_ms(),
            outcome: None,
            detail: Some(detail.into()),
        }
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
}

/// Thread-safe fail-closed audit log for privileged helper actions.
#[derive(Debug)]
pub struct HelperAudit {
    path: PathBuf,
    max_records: usize,
    lock: Mutex<()>,
}

impl HelperAudit {
    pub fn new(path: impl AsRef<Path>, max_records: usize) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            max_records: max_records.max(10),
            lock: Mutex::new(()),
        }
    }

    /// Helper path accessor.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Record an audit entry. Fail-closed: ensures data is synced to physical storage.
    pub fn record(&self, record: &HelperAuditRecord) -> Result<(), HelperAuditError> {
        let _guard = self.lock.lock().unwrap();

        let json_line = serde_json::to_string(record)?;

        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|e| HelperAuditError::Io {
                    path: parent.to_path_buf(),
                    source: e,
                })?;
            }
        }

        // Open with mode 0600 on Unix
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

        // Prune if over bounds
        self.prune_if_needed(&file)?;

        Ok(())
    }

    /// Read all audit records currently stored in the file.
    pub fn read_all_records(&self) -> Result<Vec<HelperAuditRecord>, HelperAuditError> {
        let _guard = self.lock.lock().unwrap();
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

    fn prune_if_needed(&self, _file: &File) -> Result<(), HelperAuditError> {
        // Read lines count
        let Ok(file) = File::open(&self.path) else {
            return Ok(());
        };
        let reader = BufReader::new(file);
        let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

        if lines.len() <= self.max_records {
            return Ok(());
        }

        // Retain only the most recent (max_records / 2) to avoid frequent rotations
        let keep_count = self.max_records / 2;
        let retained = &lines[lines.len() - keep_count..];

        let tmp_path = self.path.with_extension("tmp");
        let mut tmp_file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| HelperAuditError::Io {
                path: tmp_path.clone(),
                source: e,
            })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            let _ = std::fs::set_permissions(&tmp_path, perms);
        }

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

        Ok(())
    }
}
