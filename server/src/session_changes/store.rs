use parking_lot::Mutex;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tempfile::TempDir;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::session_changes::types::*;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SessionChangesKey {
    pub terminal_id: String,
    pub terminal_incarnation: String,
    pub omp_session_id: String,
    pub root_id: String,
}

#[derive(Debug, Clone)]
pub struct BoundTerminalTarget {
    pub project_name: Option<String>,
    pub worktree_path: Option<String>,
    pub launch_cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureReservationState {
    Pending {
        capture_id: String,
        reserved_at: Instant,
    },
    Sealed,
}

#[derive(Debug, Clone)]
pub struct TrackedPathEntry {
    pub file_id: String,
    pub path: String,
    pub presence: Presence,
    pub provenance: Provenance,
    pub size_bytes: u64,
    pub sha256: Option<String>,
    pub mode: Option<u32>,
    pub kind: FileContentKind,
    pub bytes: Option<Arc<[u8]>>,
    pub reasons: Vec<CoverageReason>,
    pub reservation: CaptureReservationState,
    pub last_capture_id: Option<String>,
    pub acknowledged: bool,
}

#[derive(Debug, Clone)]
pub struct ComparisonRowMeta {
    pub row: FileRow,
    pub current_sha256: Option<String>,
    pub current_size_bytes: Option<u64>,
    pub current_mode: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct ComparisonArtifact {
    pub comparison: Comparison,
    pub rows: Vec<ComparisonRowMeta>,
}

pub struct SessionChangesRecord {
    pub baseline_id: String,
    pub omp_session_id: String,
    pub root_id: String,
    pub canonical_root: PathBuf,
    pub root_dir_file: Option<Arc<std::fs::File>>,
    pub generation: u64,
    pub created_at_ms: u64,
    pub captured_at_ms: u64,
    pub state: StatusState,
    pub tracked_paths: BTreeMap<String, TrackedPathEntry>,
    pub retained_bytes: u64,
    pub comparison: Option<ComparisonArtifact>,
    pub comparison_revision: u64,
    pub capture_generation: u64,
    pub reason: Option<ErrorCode>,
    pub recent_turn_ids: BTreeSet<String>,
    pub last_settled_turn_id: Option<String>,
    pub dirty_settled_hint: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LifecycleState {
    pub enabled: bool,
    pub generation: u64,
}

pub struct SessionChangesService {
    pub server_epoch: String,
    pub lifecycle: parking_lot::RwLock<LifecycleState>,
    pub blocking_permits: Arc<Semaphore>,
    pub allocated_storage_bytes: AtomicU64,
    pub records: Mutex<BTreeMap<SessionChangesKey, SessionChangesRecord>>,
    pub temp_dir: Mutex<Option<TempDir>>,
    pub bound_targets: Mutex<std::collections::HashMap<(String, u64), BoundTerminalTarget>>,
    #[cfg(test)]
    pub test_publication_handshake: Mutex<Option<TestPublicationHandshake>>,
}

#[cfg(test)]
#[derive(Clone)]
pub struct TestPublicationHandshake {
    pub pause_barrier: Arc<tokio::sync::Barrier>,
    pub resume_barrier: Arc<tokio::sync::Barrier>,
}

impl Default for SessionChangesService {
    fn default() -> Self {
        Self::new().expect("Creation for SessionChangesService should succeed")
    }
}

impl SessionChangesService {
    pub fn new() -> Result<Self, std::io::Error> {
        Ok(Self {
            server_epoch: Uuid::new_v4().to_string(),
            lifecycle: parking_lot::RwLock::new(LifecycleState {
                enabled: false,
                generation: 0,
            }),
            blocking_permits: Arc::new(Semaphore::new(MAX_BLOCKING_PERMITS)),
            allocated_storage_bytes: AtomicU64::new(0),
            records: Mutex::new(BTreeMap::new()),
            temp_dir: Mutex::new(None),
            bound_targets: Mutex::new(std::collections::HashMap::new()),
            #[cfg(test)]
            test_publication_handshake: Mutex::new(None),
        })
    }

    pub fn new_enabled() -> Result<Self, std::io::Error> {
        let service = Self::new()?;
        service.enable();
        Ok(service)
    }

    pub fn is_enabled(&self) -> bool {
        self.lifecycle.read().enabled
    }

    pub fn current_generation(&self) -> (bool, u64) {
        let state = *self.lifecycle.read();
        (state.enabled, state.generation)
    }

    pub fn enable(&self) -> u64 {
        let mut state = self.lifecycle.write();
        if !state.enabled {
            state.generation = state.generation.wrapping_add(1);
            state.enabled = true;
        }
        state.generation
    }

    pub fn disable_and_purge(&self) {
        // Strict lock ordering: lifecycle.write() before records.lock()
        let mut state = self.lifecycle.write();
        state.enabled = false;
        state.generation = state.generation.wrapping_add(1);
        self.records.lock().clear();
        self.allocated_storage_bytes.store(0, Ordering::SeqCst);
        *self.temp_dir.lock() = None;
    }

    pub fn release_storage_for_generation(&self, generation: u64, bytes: u64) {
        let lifecycle = self.lifecycle.read();
        if !lifecycle.enabled || lifecycle.generation != generation {
            return;
        }
        self.release_storage(bytes);
    }
    pub fn try_reserve_storage_for_generation(&self, generation: u64, bytes: u64) -> Result<(), ErrorCode> {
        let lifecycle = self.lifecycle.read();
        if !lifecycle.enabled || lifecycle.generation != generation {
            return Err(ErrorCode::TargetUnavailable);
        }
        self.try_reserve_storage(bytes)
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
        if !self.is_enabled() {
            return Status {
                version: 1,
                server_epoch: self.server_epoch.clone(),
                terminal_incarnation: key.terminal_incarnation.clone(),
                omp_session_id: key.omp_session_id.clone(),
                root_id: Some(key.root_id.clone()),
                baseline_id: None,
                origin: None,
                state: StatusState::Unavailable,
                acknowledgment: Acknowledgment::NotApplicable,
                captured_at_ms: None,
                baseline_coverage: None,
                comparison: None,
                reason: Some(ErrorCode::TrackingDisabled),
                shared_writers: true,
            };
        }

        let records = self.records.lock();
        if let Some(rec) = records.get(key) {
            let eligible_entries = rec.tracked_paths.len() as u64;
            let captured_entries = rec
                .tracked_paths
                .values()
                .filter(|e| e.presence == Presence::Present || e.presence == Presence::Absent)
                .count() as u64;

            let mut reasons = Vec::new();
            for entry in rec.tracked_paths.values() {
                for r in &entry.reasons {
                    if !reasons.contains(r) {
                        reasons.push(*r);
                    }
                }
            }

            let has_unknown = rec.tracked_paths.values().any(|e| e.presence == Presence::Unknown);
            let coverage_state = if captured_entries == eligible_entries && reasons.is_empty() && !has_unknown {
                CoverageState::Complete
            } else {
                CoverageState::Incomplete
            };

            let state = if coverage_state == CoverageState::Complete {
                StatusState::Ready
            } else {
                StatusState::Incomplete
            };

            let coverage = Coverage {
                state: coverage_state,
                inventory_complete: true,
                absence_proof_complete: true,
                provenance_entries: eligible_entries,
                eligible_entries,
                captured_entries,
                omitted_entries: None,
                raw_bytes: rec.retained_bytes,
                reasons,
            };

            Status {
                version: 1,
                server_epoch: self.server_epoch.clone(),
                terminal_incarnation: key.terminal_incarnation.clone(),
                omp_session_id: key.omp_session_id.clone(),
                root_id: Some(key.root_id.clone()),
                baseline_id: Some(rec.baseline_id.clone()),
                origin: Some(Origin::ToolObserved),
                state,
                acknowledgment: Acknowledgment::NotApplicable,
                captured_at_ms: Some(rec.captured_at_ms),
                baseline_coverage: Some(coverage),
                comparison: rec.comparison.as_ref().map(|c| c.comparison.clone()),
                reason: rec.reason,
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
                self.release_storage(rec.retained_bytes);
            }
        }
        if let Ok(inc) = terminal_incarnation.parse::<u64>() {
            self.bound_targets.lock().remove(&(terminal_id.to_string(), inc));
        }
    }
}
