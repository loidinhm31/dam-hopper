use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::pty::fleet_state::PtyFleetSnapshot;

/// Sentinel value indicating that the raw output counter has saturated and is
/// no longer reliable for measuring incremental process activity.
pub const SATURATED_COUNTER_SENTINEL: u64 = u64::MAX;

/// Maximum number of live root sessions that can be safely captured without
/// exceeding bounded snapshot memory and latency guarantees.
pub const MAX_LIVE_ROOTS_LIMIT: usize = 256;

// ---------------------------------------------------------------------------
// Identity types
// ---------------------------------------------------------------------------

/// Immutable identity for an OS process rooted at a PTY child.
///
/// Pairs OS PID with the kernel boot-tick start time from `/proc/<pid>/stat`
/// to protect against PID reuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentity {
    pub pid: u32,
    pub start_ticks: u64,
}

/// Logical terminal identity discriminator.
///
/// Pairs the reusable public session ID with the monotonic incarnation
/// allocated at spawn time.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIdentity {
    pub session_id: String,
    pub incarnation: u64,
}

/// Root qualification status for a PTY child process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RootQualification {
    /// Child process identity successfully resolved with verified PID and start ticks.
    Qualified { identity: ProcessIdentity },
    /// Process ID was obtained from spawn, but start-time identity probe was uncertain or failed.
    Uncertain { pid: u32, reason: String },
    /// Process ID could not be captured from the PTY implementation.
    Unavailable { reason: String },
}

impl RootQualification {
    pub fn is_qualified(&self) -> bool {
        matches!(self, Self::Qualified { .. })
    }

    pub fn process_identity(&self) -> Option<ProcessIdentity> {
        match self {
            Self::Qualified { identity } => Some(*identity),
            _ => None,
        }
    }

    pub fn pid(&self) -> Option<u32> {
        match self {
            Self::Qualified { identity } => Some(identity.pid),
            Self::Uncertain { pid, .. } => Some(*pid),
            Self::Unavailable { .. } => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Snapshot records and observation
// ---------------------------------------------------------------------------

/// Ephemeral record of a live PTY root's identity and output counter.
#[derive(Clone)]
pub struct RootActivityRecord {
    pub terminal: TerminalIdentity,
    pub qualification: RootQualification,
    pub raw_output_sequence: Arc<AtomicU64>,
}

/// Explicit reason why an activity snapshot cannot qualify for automatic handoff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum ActivityIncompleteReason {
    /// Fleet size exceeds the bounded root scan limit.
    ScanLimitExceeded { count: usize, limit: usize },
    /// A live root process identity could not be verified.
    RootUnqualified {
        session_id: String,
        incarnation: u64,
        pid: Option<u32>,
        details: String,
    },
    /// A live root's raw output counter saturated at `u64::MAX`.
    CounterSaturated {
        session_id: String,
        incarnation: u64,
    },
    /// The manager's input revision saturated at `u64::MAX`.
    RevisionSaturated,
}

/// Bounded atomic capture of live PTY activity state.
#[derive(Clone)]
pub struct PtyActivitySnapshot {
    pub fleet: PtyFleetSnapshot,
    pub input_revision: u64,
    pub last_input_at: Option<Instant>,
    pub roots: Vec<RootActivityRecord>,
    pub captured_at: Instant,
    pub incomplete_reason: Option<ActivityIncompleteReason>,
}

impl PtyActivitySnapshot {
    /// True when all live roots are qualified, no counter or revision is saturated,
    /// and the scan limit was not exceeded.
    pub fn is_complete(&self) -> bool {
        self.incomplete_reason.is_none()
    }
}

/// Receiver seam exposing monotonic private activity invalidation.
///
/// Emits whenever nonempty terminal input is admitted or session lifecycle changes.
#[derive(Clone, Debug)]
pub struct PtyActivityWatcher {
    rx: watch::Receiver<u64>,
}

impl PtyActivityWatcher {
    pub fn new(rx: watch::Receiver<u64>) -> Self {
        Self { rx }
    }

    /// Read the current invalidation revision without marking it as seen.
    pub fn revision(&self) -> u64 {
        *self.rx.borrow()
    }

    /// Mark the current invalidation revision as seen.
    pub fn mark_seen(&mut self) {
        let _ = self.rx.borrow_and_update();
    }

    /// Direct borrow of the latest invalidation revision in the watch channel.
    pub fn borrow(&self) -> watch::Ref<'_, u64> {
        self.rx.borrow()
    }

    /// Wait until a newer invalidation revision is published.
    pub async fn changed(&mut self) -> Result<(), watch::error::RecvError> {
        self.rx.changed().await
    }
}

// ---------------------------------------------------------------------------
// Atomic counter helpers
// ---------------------------------------------------------------------------

/// Saturating increment on raw output counter. Capped at `SATURATED_COUNTER_SENTINEL`.
pub fn increment_raw_output_sequence(counter: &AtomicU64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |val| {
        if val == SATURATED_COUNTER_SENTINEL {
            Some(SATURATED_COUNTER_SENTINEL)
        } else {
            Some(val.saturating_add(1))
        }
    });
}

// ---------------------------------------------------------------------------
// /proc/<pid>/stat parsing and probing
// ---------------------------------------------------------------------------

/// Minimum parsed fields from Linux `/proc/<pid>/stat`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedProcStat {
    pub pid: u32,
    pub comm: String,
    pub state: char,
    pub ppid: u32,
    pub start_ticks: u64,
}

/// Parse Linux `/proc/<pid>/stat` content safely.
///
pub type ProcessStat = ParsedProcStat;

/// Read and parse /proc/<pid>/stat from a specified procfs directory.
pub fn read_process_stat(proc_dir: &Path, pid: u32) -> Result<ParsedProcStat, String> {
    let stat_path = proc_dir.join(pid.to_string()).join("stat");
    let contents = std::fs::read_to_string(&stat_path)
        .map_err(|e| format!("Failed to read {}: {e}", stat_path.display()))?;
    parse_proc_stat(&contents)
}

/// Handles arbitrary command names in parentheses containing spaces or nested parentheses.
pub fn parse_proc_stat(contents: &str) -> Result<ParsedProcStat, String> {
    let trimmed = contents.trim();
    let first_open = trimmed
        .find('(')
        .ok_or_else(|| "Missing opening parenthesis for comm in proc stat".to_string())?;
    let last_close = trimmed
        .rfind(')')
        .ok_or_else(|| "Missing closing parenthesis for comm in proc stat".to_string())?;

    if first_open >= last_close {
        return Err("Malformed parenthesis placement for comm in proc stat".to_string());
    }

    let pid_str = trimmed[..first_open].trim();
    let pid: u32 = pid_str
        .parse()
        .map_err(|e| format!("Invalid PID '{pid_str}' in proc stat: {e}"))?;

    let comm = trimmed[first_open + 1..last_close].to_string();

    let after_close = trimmed[last_close + 1..].trim();
    let tokens: Vec<&str> = after_close.split_whitespace().collect();

    // After ')':
    // Field 3: state (char) -> tokens[0]
    // Field 4: ppid (int) -> tokens[1]
    // ...
    // Field 22: starttime (unsigned long long) -> tokens[19]
    if tokens.len() <= 19 {
        return Err(format!(
            "Insufficient fields after comm in proc stat (expected >= 20, got {})",
            tokens.len()
        ));
    }

    let state = tokens[0]
        .chars()
        .next()
        .ok_or_else(|| "Empty state field in proc stat".to_string())?;

    let ppid: u32 = tokens[1]
        .parse()
        .map_err(|e| format!("Invalid PPID '{}' in proc stat: {e}", tokens[1]))?;

    let start_ticks: u64 = tokens[19]
        .parse()
        .map_err(|e| format!("Invalid starttime '{}' in proc stat: {e}", tokens[19]))?;

    Ok(ParsedProcStat {
        pid,
        comm,
        state,
        ppid,
        start_ticks,
    })
}

/// Probe process start-time identity from a custom procfs directory (for testing or production).
pub fn probe_process_identity_from_procfs(
    proc_dir: &Path,
    pid: u32,
) -> Result<ProcessIdentity, String> {
    let stat_path = proc_dir.join(pid.to_string()).join("stat");
    let contents = std::fs::read_to_string(&stat_path)
        .map_err(|e| format!("Failed to read {}: {e}", stat_path.display()))?;
    let parsed = parse_proc_stat(&contents)?;
    if parsed.pid != pid {
        return Err(format!(
            "PID mismatch in {}: expected {pid}, got {}",
            stat_path.display(),
            parsed.pid
        ));
    }
    Ok(ProcessIdentity {
        pid: parsed.pid,
        start_ticks: parsed.start_ticks,
    })
}

/// Probe process start-time identity on Linux.
#[cfg(target_os = "linux")]
pub fn probe_process_identity(pid: u32) -> Result<ProcessIdentity, String> {
    probe_process_identity_from_procfs(Path::new("/proc"), pid)
}

/// Fallback for non-Linux platforms where `/proc/<pid>/stat` is unavailable.
#[cfg(not(target_os = "linux"))]
pub fn probe_process_identity(_pid: u32) -> Result<ProcessIdentity, String> {
    Err("Platform does not support /proc/<pid>/stat probing".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_proc_stat_standard() {
        let sample = "1234 (bash) S 1000 1234 1000 34827 1234 4194304 100 200 0 0 10 20 0 0 20 0 1 0 54321 12449464320 196852";
        let parsed = parse_proc_stat(sample).expect("should parse");
        assert_eq!(parsed.pid, 1234);
        assert_eq!(parsed.comm, "bash");
        assert_eq!(parsed.state, 'S');
        assert_eq!(parsed.ppid, 1000);
        assert_eq!(parsed.start_ticks, 54321);
    }

    #[test]
    fn test_parse_proc_stat_with_spaces_and_parentheses() {
        let sample = "9999 (my process (nested) name) R 1 9999 1 0 0 0 0 0 0 0 1 2 3 4 20 0 2 0 987654321 100 200";
        let parsed = parse_proc_stat(sample).expect("should parse with spaces and parentheses");
        assert_eq!(parsed.pid, 9999);
        assert_eq!(parsed.comm, "my process (nested) name");
        assert_eq!(parsed.state, 'R');
        assert_eq!(parsed.ppid, 1);
        assert_eq!(parsed.start_ticks, 987654321);
    }

    #[test]
    fn test_parse_proc_stat_invalid() {
        assert!(parse_proc_stat("invalid stat data").is_err());
        assert!(parse_proc_stat("1234 no_parens").is_err());
        assert!(parse_proc_stat("abc (name) S 1 2 3").is_err());
        assert!(parse_proc_stat("1234 (name) S").is_err()); // Too few fields
    }

    #[test]
    fn test_increment_raw_output_sequence_saturating() {
        let counter = AtomicU64::new(0);
        increment_raw_output_sequence(&counter);
        assert_eq!(counter.load(Ordering::Relaxed), 1);

        counter.store(SATURATED_COUNTER_SENTINEL - 1, Ordering::Relaxed);
        increment_raw_output_sequence(&counter);
        assert_eq!(counter.load(Ordering::Relaxed), SATURATED_COUNTER_SENTINEL);

        // Saturates, never wraps
        increment_raw_output_sequence(&counter);
        assert_eq!(counter.load(Ordering::Relaxed), SATURATED_COUNTER_SENTINEL);
    }
}
