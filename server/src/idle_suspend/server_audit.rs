use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::idle_suspend::protocol::SuspendOutcome;

pub const MAX_AUDIT_RECORDS: usize = 10_000;
pub const MAX_ACTOR_LEN: usize = 128;
pub const MAX_REQUEST_ID_LEN: usize = 64;

#[derive(Debug, Error)]
pub enum AuditError {
    #[error("Audit log I/O failed: {0}")]
    Io(String),
    #[error("Actor identifier invalid or exceeds maximum length")]
    InvalidActor,
    #[error("Request identifier invalid or exceeds maximum length")]
    InvalidRequestId,
    #[error("Audit store unavailable")]
    Unavailable,
}

pub fn validate_actor(actor: &str) -> Result<String, AuditError> {
    let trimmed = actor.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_ACTOR_LEN {
        return Err(AuditError::InvalidActor);
    }
    Ok(trimmed.to_string())
}

pub fn validate_request_id(request_id: &str) -> Result<String, AuditError> {
    let trimmed = request_id.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_REQUEST_ID_LEN {
        return Err(AuditError::InvalidRequestId);
    }
    Ok(trimmed.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimingAuditResult {
    Admitted,
    Committed,
    PersistenceFailed,
    RejectedHandoffInProgress,
    RejectedDisabled,
    RejectedInvalidInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingAuditRecord {
    pub version: u32,
    pub timestamp_ms: u64,
    pub actor: String,
    pub before_quiet_period_seconds: u64,
    pub before_wake_after_seconds: u64,
    pub requested_quiet_period_seconds: u64,
    pub requested_wake_after_seconds: u64,
    pub transaction_id: String,
    pub result: TimingAuditResult,
}

impl TimingAuditRecord {
    pub fn new(
        actor: String,
        before_quiet: u64,
        before_wake: u64,
        requested_quiet: u64,
        requested_wake: u64,
        transaction_id: String,
        result: TimingAuditResult,
    ) -> Result<Self, AuditError> {
        let valid_actor = validate_actor(&actor)?;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Ok(Self {
            version: 1,
            timestamp_ms: now_ms,
            actor: valid_actor,
            before_quiet_period_seconds: before_quiet,
            before_wake_after_seconds: before_wake,
            requested_quiet_period_seconds: requested_quiet,
            requested_wake_after_seconds: requested_wake,
            transaction_id,
            result,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManualAuditResult {
    Attempted,
    Accepted,
    RejectedConfirmationRequired,
    RejectedConflict,
    RejectedHandoffInProgress,
    RejectedCapability,
    RejectedShuttingDown,
    RejectedValidation,
    TerminalOutcome(SuspendOutcome),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualAuditRecord {
    pub version: u32,
    pub timestamp_ms: u64,
    pub actor: String,
    pub request_id: String,
    pub wake_after_seconds: u64,
    pub requested_force: bool,
    pub effective_force: bool,
    pub generation: u64,
    pub live_count: usize,
    pub creating_count: usize,
    pub restart_pending_count: usize,
    pub result: ManualAuditResult,
}

impl ManualAuditRecord {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        actor: String,
        request_id: String,
        wake_after_seconds: u64,
        requested_force: bool,
        effective_force: bool,
        generation: u64,
        live_count: usize,
        creating_count: usize,
        restart_pending_count: usize,
        result: ManualAuditResult,
    ) -> Result<Self, AuditError> {
        let valid_actor = validate_actor(&actor)?;
        let valid_req_id = validate_request_id(&request_id)?;
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Ok(Self {
            version: 1,
            timestamp_ms: now_ms,
            actor: valid_actor,
            request_id: valid_req_id,
            wake_after_seconds,
            requested_force,
            effective_force,
            generation,
            live_count,
            creating_count,
            restart_pending_count,
            result,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ServerAuditRecord {
    Timing(TimingAuditRecord),
    Manual(ManualAuditRecord),
}

impl ServerAuditRecord {
    pub fn actor(&self) -> &str {
        match self {
            Self::Timing(t) => &t.actor,
            Self::Manual(m) => &m.actor,
        }
    }

    pub fn timestamp_ms(&self) -> u64 {
        match self {
            Self::Timing(t) => t.timestamp_ms,
            Self::Manual(m) => m.timestamp_ms,
        }
    }
}

impl From<TimingAuditRecord> for ServerAuditRecord {
    fn from(r: TimingAuditRecord) -> Self {
        ServerAuditRecord::Timing(r)
    }
}

impl From<&TimingAuditRecord> for ServerAuditRecord {
    fn from(r: &TimingAuditRecord) -> Self {
        ServerAuditRecord::Timing(r.clone())
    }
}

impl From<ManualAuditRecord> for ServerAuditRecord {
    fn from(r: ManualAuditRecord) -> Self {
        ServerAuditRecord::Manual(r)
    }
}

impl From<&ManualAuditRecord> for ServerAuditRecord {
    fn from(r: &ManualAuditRecord) -> Self {
        ServerAuditRecord::Manual(r.clone())
    }
}

#[derive(Clone)]
pub struct IdleSuspendServerAudit {
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl IdleSuspendServerAudit {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
    fn open_verified(&self, write: bool) -> Result<File, AuditError> {
        let mut options = OpenOptions::new();
        options.read(true);
        if write {
            options.write(true).append(true);
        }
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
        let file = options
            .open(&*self.path)
            .map_err(|e| AuditError::Io(format!("Cannot open pre-provisioned audit log: {e}")))?;
        let metadata = file
            .metadata()
            .map_err(|e| AuditError::Io(format!("Cannot stat pre-provisioned audit log: {e}")))?;
        let expected_uid = unsafe { libc::geteuid() };
        let expected_gid = unsafe { libc::getegid() };
        if !metadata.file_type().is_file()
            || metadata.uid() != expected_uid
            || metadata.gid() != expected_gid
            || metadata.mode() & 0o7777 != 0o600
        {
            return Err(AuditError::Unavailable);
        }
        Ok(file)
    }

    fn record_raw<T: Serialize>(&self, item: &T) -> Result<(), AuditError> {
        let _guard = self.lock.lock();
        let mut file = self.open_verified(true)?;
        let line = serde_json::to_string(item)
            .map_err(|e| AuditError::Io(format!("Cannot serialize audit record: {e}")))?;
        writeln!(file, "{}", line)
            .map_err(|e| AuditError::Io(format!("Cannot write audit record: {e}")))?;
        file.sync_data()
            .map_err(|e| AuditError::Io(format!("Cannot sync audit record: {e}")))?;
        Ok(())
    }
    fn read_verified_content(&self) -> Result<String, AuditError> {
        let mut file = self.open_verified(false)?;
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| AuditError::Io(format!("Cannot read audit log: {e}")))?;
        Ok(content)
    }

    pub fn record_timing_event(&self, record: &TimingAuditRecord) -> Result<(), AuditError> {
        self.record_raw(record)
    }

    pub fn record_manual_event(&self, record: &ManualAuditRecord) -> Result<(), AuditError> {
        self.record_raw(record)
    }

    pub fn record_event(&self, record: impl Into<ServerAuditRecord>) -> Result<(), AuditError> {
        let rec = record.into();
        self.record_raw(&rec)
    }

    pub fn read_recent_records(&self, limit: usize) -> Result<Vec<ServerAuditRecord>, AuditError> {
        let _guard = self.lock.lock();
        let content = self.read_verified_content()?;

        let mut records = Vec::new();
        for line in content.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<ServerAuditRecord>(line) {
                records.push(record);
                if records.len() >= limit || records.len() >= MAX_AUDIT_RECORDS {
                    break;
                }
            }
        }

        Ok(records)
    }

    pub fn read_recent_timing_records(&self, limit: usize) -> Result<Vec<TimingAuditRecord>, AuditError> {
        let _guard = self.lock.lock();


        let content = self.read_verified_content()?;
        let mut records = Vec::new();
        for line in content.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<TimingAuditRecord>(line) {
                records.push(record);
                if records.len() >= limit || records.len() >= MAX_AUDIT_RECORDS {
                    break;
                }
            }
        }

        Ok(records)
    }

    pub fn read_recent_manual_records(&self, limit: usize) -> Result<Vec<ManualAuditRecord>, AuditError> {
        let _guard = self.lock.lock();

        let content = self.read_verified_content()?;

        let mut records = Vec::new();
        for line in content.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<ManualAuditRecord>(line) {
                records.push(record);
                if records.len() >= limit || records.len() >= MAX_AUDIT_RECORDS {
                    break;
                }
            }
        }

        Ok(records)
    }
}

pub type IdleSuspendTimingAudit = IdleSuspendServerAudit;
