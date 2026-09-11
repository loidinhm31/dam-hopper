use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::pty::activity::{ProcessIdentity, TerminalIdentity};

pub(crate) mod process;
mod netlink;
mod tcp_info;
pub(crate) mod tcp;

// ---------------------------------------------------------------------------
// Limits and bounds
// ---------------------------------------------------------------------------

/// Maximum number of managed terminal roots that can be qualified in a single pass.
pub(crate) const MAX_MANAGED_ROOTS_LIMIT: usize = 256;

/// Maximum number of numeric process directories scanned in /proc before scanLimit.
pub(crate) const MAX_SCANNED_PROCESSES_LIMIT: usize = 8192;

/// Maximum number of relevant processes (matched agents + descendants) retained/observed.
pub(crate) const MAX_RELEVANT_PROCESSES_LIMIT: usize = 1024;

/// Maximum number of file descriptors enumerated per relevant process before scanLimit.
pub(crate) const MAX_PROCESS_FDS_LIMIT: usize = 4096;

/// Maximum number of unique owned sockets enumerated across all relevant processes.
pub(crate) const MAX_OWNED_SOCKETS_LIMIT: usize = 8192;

/// Maximum command line bytes read per process candidate (16 KiB).
pub(crate) const MAX_CMDLINE_BYTES_LIMIT: usize = 16 * 1024;

/// Maximum safe executable identity string length (256 UTF-8 bytes).
pub(crate) const MAX_SAFE_EXECUTABLE_IDENTITY_BYTES: usize = 256;

// ---------------------------------------------------------------------------
// Network namespace and socket ownership types
// ---------------------------------------------------------------------------

/// Network namespace identity represented by its filesystem (device, inode).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct NetworkNamespaceIdentity {
    pub(crate) device: u64,
    pub(crate) inode: u64,
}

impl NetworkNamespaceIdentity {
    /// Read the network namespace identity of the current observing thread.
    #[cfg(target_os = "linux")]
    pub(crate) fn current_thread() -> Result<Self, ActivityUnavailable> {
        use std::os::unix::fs::MetadataExt;
        let thread_path = std::path::Path::new("/proc/thread-self/ns/net");
        let path = if thread_path.exists() {
            thread_path
        } else {
            std::path::Path::new("/proc/self/ns/net")
        };
        let meta = std::fs::metadata(path).map_err(|e| {
            tracing::debug!("Failed to read thread netns metadata {}: {e}", path.display());
            ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)
        })?;
        Ok(Self {
            device: meta.dev(),
            inode: meta.ino(),
        })
    }

    #[cfg(not(target_os = "linux"))]
    pub(crate) fn current_thread() -> Result<Self, ActivityUnavailable> {
        Err(ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess))
    }
}

/// Deduplicated owned socket inode with representative owner information.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct OwnedSocketInode {
    pub(crate) inode: u64,
    pub(crate) representative_owner: ProcessIdentity,
    pub(crate) has_additional_owners: bool,
}

/// Set of all sockets owned by attributable relevant processes in the observed namespace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct OwnedSocketSet {
    pub(crate) namespace: NetworkNamespaceIdentity,
    /// Sorted and unique by inode; length <= 8192.
    pub(crate) inodes: Vec<OwnedSocketInode>,
}

impl OwnedSocketSet {
    pub(crate) fn empty(namespace: NetworkNamespaceIdentity) -> Self {
        Self {
            namespace,
            inodes: Vec::new(),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.inodes.is_empty()
    }

    pub(crate) fn len(&self) -> usize {
        self.inodes.len()
    }
}

// ---------------------------------------------------------------------------
// Terminal monitoring evidence
// ---------------------------------------------------------------------------

/// Bounded evidence of a terminal root or surviving detached lineage being monitored.
#[derive(Clone)]
pub(crate) struct MonitoredTerminalEvidence {
    pub(crate) terminal: TerminalIdentity,
    pub(crate) output_sequence: Arc<AtomicU64>,
    pub(crate) sample_start_sequence: u64,
}

impl std::fmt::Debug for MonitoredTerminalEvidence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MonitoredTerminalEvidence")
            .field("terminal", &self.terminal)
            .field("sample_start_sequence", &self.sample_start_sequence)
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Process change classification
// ---------------------------------------------------------------------------

/// Qualitative activity delta determined during process discovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessChange {
    /// First successful sample after startup, invalidation, or recovery.
    BaselineEstablished,
    /// Exact same relevant processes, images, and attributions.
    Unchanged,
    /// Relevant creation, validated exit, image change, or match transition.
    Activity,
}

// ---------------------------------------------------------------------------
// Process evidence and failure context
// ---------------------------------------------------------------------------

/// Process identity paired with optional safe executable identity for authenticated warning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct BlockingProcessEvidence {
    pub(crate) process: ProcessIdentity,
    pub(crate) safe_executable_identity: Option<String>,
}

/// Bounded context attached to activity unavailability for diagnostic warning projection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FailureContext {
    /// Directly implicated processes; len <= 1024.
    pub(crate) processes: Vec<BlockingProcessEvidence>,
    /// Implicated owned sockets; len <= 8192 (Phase 04 populates).
    pub(crate) implicated_owned_inodes: Vec<OwnedSocketInode>,
}

impl FailureContext {
    pub(crate) fn single_process(
        process: ProcessIdentity,
        safe_executable_identity: Option<String>,
    ) -> Self {
        Self {
            processes: vec![BlockingProcessEvidence {
                process,
                safe_executable_identity,
            }],
            implicated_owned_inodes: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Closed unavailability reason enum
// ---------------------------------------------------------------------------

/// Explicit closed reason codes for measurement unavailability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ActivityUnavailableReason {
    ProcAccess,
    ScanLimit,
    ScanTimeout,
    SocketDiagnostics,
    UnsupportedTransport,
    NamespaceMismatch,
    StaleObservation,
    IdentityUncertain,
    CounterOverflow,
    Reconciling,
}

impl std::fmt::Display for ActivityUnavailableReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProcAccess => write!(f, "procAccess"),
            Self::ScanLimit => write!(f, "scanLimit"),
            Self::ScanTimeout => write!(f, "scanTimeout"),
            Self::SocketDiagnostics => write!(f, "socketDiagnostics"),
            Self::UnsupportedTransport => write!(f, "unsupportedTransport"),
            Self::NamespaceMismatch => write!(f, "namespaceMismatch"),
            Self::StaleObservation => write!(f, "staleObservation"),
            Self::IdentityUncertain => write!(f, "identityUncertain"),
            Self::CounterOverflow => write!(f, "counterOverflow"),
            Self::Reconciling => write!(f, "reconciling"),
        }
    }
}

/// Error returned when activity observation cannot be qualified.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("Activity measurement unavailable: {reason}")]
pub(crate) struct ActivityUnavailable {
    pub(crate) reason: ActivityUnavailableReason,
    pub(crate) retryable_close_race: bool,
    pub(crate) context: FailureContext,
}

impl ActivityUnavailable {
    pub(crate) fn new(reason: ActivityUnavailableReason) -> Self {
        Self {
            reason,
            retryable_close_race: false,
            context: FailureContext::default(),
        }
    }

    pub(crate) fn with_context(reason: ActivityUnavailableReason, context: FailureContext) -> Self {
        Self {
            reason,
            retryable_close_race: false,
            context,
        }
    }

    pub(crate) fn retryable(reason: ActivityUnavailableReason) -> Self {
        Self {
            reason,
            retryable_close_race: true,
            context: FailureContext::default(),
        }
    }

    pub(crate) fn retryable_with_context(
        reason: ActivityUnavailableReason,
        context: FailureContext,
    ) -> Self {
        Self {
            reason,
            retryable_close_race: true,
            context,
        }
    }
}

// ---------------------------------------------------------------------------
// Process sample result
// ---------------------------------------------------------------------------

/// Qualified outcome of a complete process discovery pass.
#[derive(Clone, Debug)]
pub(crate) struct ProcessSample {
    pub(crate) recognized_agent_count: usize,
    /// Deduplicated monitored terminals; sorted by session_id then incarnation.
    pub(crate) monitored_terminals: Vec<MonitoredTerminalEvidence>,
    pub(crate) owned_sockets: OwnedSocketSet,
    /// Current relevant processes; sorted by (pid, start_ticks); len <= 1024.
    pub(crate) process_evidence: Vec<BlockingProcessEvidence>,
    pub(crate) change: ProcessChange,
}

impl ProcessSample {
    pub(crate) fn monitored_terminal_count(&self) -> usize {
        self.monitored_terminals.len()
    }
}
