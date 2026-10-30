use parking_lot::Mutex;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tempfile::TempDir;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::session_changes::inventory::{BaselineInventory, CapturedFile};
use crate::session_changes::types::*;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SessionChangesKey {
    pub terminal_id: String,
    pub terminal_incarnation: String,
    pub omp_session_id: String,
    pub root_id: String,
}

#[derive(Debug, Clone)]
pub struct FromNowRecord {
    pub baseline_id: String,
    pub captured_at_ms: u64,
    pub baseline_inventory: BaselineInventory,
    pub comparison_revision: u64,
}

#[derive(Debug, Clone)]
pub struct BoundTerminalTarget {
    pub project_name: Option<String>,
    pub worktree_path: Option<String>,
    pub launch_cwd: PathBuf,
}
#[derive(Debug, Clone)]
pub struct FileRowInternal {
    pub row: FileRow,
    pub original_file: Option<CapturedFile>,
    pub current_file: Option<CapturedFile>,
}

#[derive(Debug, Clone)]
pub struct ComparisonArtifact {
    pub comparison: Comparison,
    pub rows: Vec<FileRowInternal>,
}


pub struct SessionChangesRecord {
    pub registration_id: String,
    pub baseline_id: Option<String>,
    pub activation_nonce: Option<String>,
    pub activation_receipt_id: Option<String>,
    pub captured_at_ms: Option<u64>,
    pub prepared_at: Option<Instant>,
    pub prepared_ttl_ms: u64,
    pub origin: Option<Origin>,
    pub state: StatusState,
    pub acknowledgment: Acknowledgment,
    pub baseline_inventory: Option<BaselineInventory>,
    pub baseline_coverage: Option<Coverage>,
    pub comparison: Option<ComparisonArtifact>,
    pub current_revision_manifest: Option<BTreeMap<String, CapturedFile>>,
    pub comparison_revision: u64,
    pub reason: Option<ErrorCode>,
    pub original_failed: bool,
    pub active_from_now: Option<FromNowRecord>,
    pub recent_turn_ids: BTreeSet<String>,
    pub last_settled_turn_id: Option<String>,
    pub dirty_settled_hint: bool,
    pub canonical_root: PathBuf,
}

pub struct SessionChangesService {
    pub server_epoch: String,
    pub blocking_permits: Arc<Semaphore>,
    pub allocated_storage_bytes: AtomicU64,
    pub records: Mutex<BTreeMap<SessionChangesKey, SessionChangesRecord>>,
    pub temp_dir: TempDir,
    pub bound_targets: Mutex<std::collections::HashMap<(String, u64), BoundTerminalTarget>>,
}

impl Default for SessionChangesService {
    fn default() -> Self {
        Self::new().expect("TempDir creation for SessionChangesService should succeed")
    }
}

impl SessionChangesService {
    pub fn new() -> Result<Self, std::io::Error> {
        let temp_dir = tempfile::Builder::new()
            .prefix("dam-hopper-session-changes-")
            .tempdir()?;

        Ok(Self {
            server_epoch: Uuid::new_v4().to_string(),
            blocking_permits: Arc::new(Semaphore::new(MAX_BLOCKING_PERMITS)),
            allocated_storage_bytes: AtomicU64::new(0),
            records: Mutex::new(BTreeMap::new()),
            temp_dir,
            bound_targets: Mutex::new(std::collections::HashMap::new()),
        })
    }

    pub fn try_reserve_storage(&self, bytes: u64) -> Result<(), ErrorCode> {
        let max = MAX_GLOBAL_STORAGE_BYTES as u64;
        let mut curr = self.allocated_storage_bytes.load(Ordering::Relaxed);
        loop {
            if curr.saturating_add(bytes) > max {
                return Err(ErrorCode::Capacity);
            }
            match self.allocated_storage_bytes.compare_exchange_weak(
                curr,
                curr + bytes,
                Ordering::SeqCst,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(()),
                Err(actual) => curr = actual,
            }
        }
    }

    pub fn release_storage(&self, bytes: u64) {
        let mut curr = self.allocated_storage_bytes.load(Ordering::Relaxed);
        loop {
            let next = curr.saturating_sub(bytes);
            match self.allocated_storage_bytes.compare_exchange_weak(
                curr,
                next,
                Ordering::SeqCst,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(actual) => curr = actual,
            }
        }
    }

    pub fn bind_terminal_target(&self, terminal_id: &str, incarnation: u64, target: BoundTerminalTarget) {
        self.bound_targets.lock().insert((terminal_id.to_string(), incarnation), target);
    }

    pub fn get_bound_terminal_target(&self, terminal_id: &str, incarnation: u64) -> Option<BoundTerminalTarget> {
        self.bound_targets.lock().get(&(terminal_id.to_string(), incarnation)).cloned()
    }

    pub fn build_status(&self, key: &SessionChangesKey) -> Status {
        let records = self.records.lock();
        if let Some(rec) = records.get(key) {
            // Check preparation TTL expiration on access
            let state = if rec.state == StatusState::Initializing {
                if let Some(prep_time) = rec.prepared_at {
                    if prep_time.elapsed().as_millis() as u64 > rec.prepared_ttl_ms {
                        StatusState::Unavailable
                    } else {
                        rec.state
                    }
                } else {
                    rec.state
                }
            } else {
                rec.state
            };

            let reason = if state == StatusState::Unavailable && rec.reason.is_none() {
                Some(ErrorCode::RegistrationExpired)
            } else {
                rec.reason
            };

            Status {
                version: 1,
                server_epoch: self.server_epoch.clone(),
                terminal_incarnation: key.terminal_incarnation.clone(),
                omp_session_id: key.omp_session_id.clone(),
                root_id: Some(key.root_id.clone()),
                baseline_id: rec.baseline_id.clone(),
                origin: rec.origin,
                state,
                acknowledgment: rec.acknowledgment,
                captured_at_ms: rec.captured_at_ms,
                baseline_coverage: rec.baseline_coverage.clone(),
                comparison: rec.comparison.as_ref().map(|c| c.comparison.clone()),
                reason,
                shared_writers: true,
            }
        } else {
            Status {
                version: 1,
                server_epoch: self.server_epoch.clone(),
                terminal_incarnation: key.terminal_incarnation.clone(),
                omp_session_id: key.omp_session_id.clone(),
                root_id: Some(key.root_id.clone()),
                baseline_id: None,
                origin: None,
                state: StatusState::Missing,
                acknowledgment: Acknowledgment::NotApplicable,
                captured_at_ms: None,
                baseline_coverage: None,
                comparison: None,
                reason: Some(ErrorCode::BaselineMissing),
                shared_writers: true,
            }
        }
    }

    pub fn remove_terminal_records(&self, terminal_id: &str, terminal_incarnation: &str) {
        let mut records = self.records.lock();
        let keys_to_remove: Vec<_> = records
            .keys()
            .filter(|k| k.terminal_id == terminal_id && k.terminal_incarnation == terminal_incarnation)
            .cloned()
            .collect();

        for k in keys_to_remove {
            if let Some(rec) = records.remove(&k) {
                if let Some(cov) = rec.baseline_coverage {
                    self.release_storage(cov.raw_bytes);
                }
            }
        }
        if let Ok(inc) = terminal_incarnation.parse::<u64>() {
            self.bound_targets.lock().remove(&(terminal_id.to_string(), inc));
        }
    }
}
