use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_AUDIT_RECORDS: usize = 10_000;
const MAX_ACTOR_LEN: usize = 128;

#[derive(Debug, Error)]
pub enum AuditError {
    #[error("Audit log I/O failed: {0}")]
    Io(String),
    #[error("Actor identifier invalid or exceeds maximum length")]
    InvalidActor,
    #[error("Audit store unavailable")]
    Unavailable,
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
        let trimmed_actor = actor.trim();
        if trimmed_actor.is_empty() || trimmed_actor.len() > MAX_ACTOR_LEN {
            return Err(AuditError::InvalidActor);
        }

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Ok(Self {
            version: 1,
            timestamp_ms: now_ms,
            actor: trimmed_actor.to_string(),
            before_quiet_period_seconds: before_quiet,
            before_wake_after_seconds: before_wake,
            requested_quiet_period_seconds: requested_quiet,
            requested_wake_after_seconds: requested_wake,
            transaction_id,
            result,
        })
    }
}

#[derive(Clone)]
pub struct IdleSuspendTimingAudit {
    path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl IdleSuspendTimingAudit {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn record_event(&self, record: &TimingAuditRecord) -> Result<(), AuditError> {
        let _guard = self.lock.lock();
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AuditError::Io(format!("Cannot create audit dir: {e}")))?;
        }

        let mut options = OpenOptions::new();
        options.create(true).append(true).write(true);

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }

        let mut file = options
            .open(&*self.path)
            .map_err(|e| AuditError::Io(format!("Cannot open audit log: {e}")))?;

        let line = serde_json::to_string(record)
            .map_err(|e| AuditError::Io(format!("Cannot serialize audit record: {e}")))?;
        writeln!(file, "{}", line)
            .map_err(|e| AuditError::Io(format!("Cannot write audit record: {e}")))?;

        file.sync_data()
            .map_err(|e| AuditError::Io(format!("Cannot sync audit record: {e}")))?;

        Ok(())
    }

    pub fn read_recent_records(&self, limit: usize) -> Result<Vec<TimingAuditRecord>, AuditError> {
        let _guard = self.lock.lock();

        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&*self.path)
            .map_err(|e| AuditError::Io(format!("Cannot read audit log: {e}")))?;

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
}
