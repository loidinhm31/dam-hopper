//! Centralized resource policy, finite initial limits, and adaptive sync thresholds.
//!
//! Enforces Phase 01 proven candidates centrally:
//! - Frame, header, document, overlay, and queue budgets.
//! - Process and tree concurrency admission caps.
//! - Rate limits (40 msg/s, burst 80).
//! - Adaptive sync threshold (64 KiB UTF-8 byte boundary).
//! - Deadlines and two-phase teardown budgets.
//! - Linux hard cgroup candidate parameters (768 MiB memory, 50% CPU, 64 tasks).

use serde::Serialize;
use std::time::Duration;
use thiserror::Error;

/// Active resource policy version identifier.
pub const RESOURCE_POLICY_VERSION: &str = "1.0.0";

// --- Protocol & Framing Limits ---
/// Maximum allowed stdio framing header size (8 KiB).
pub const MAX_STDIO_HEADER_BYTES: usize = 8 * 1024;
/// Maximum allowed frame/message body size (4 MiB).
pub const MAX_FRAME_BODY_BYTES: usize = 4 * 1024 * 1024;
/// Maximum inbound/outbound queue message count per direction/session (32).
pub const MAX_QUEUED_MESSAGES: usize = 32;
/// Maximum inbound/outbound queue byte budget per direction/session (4 MiB).
pub const MAX_QUEUED_BYTES: usize = 4 * 1024 * 1024;
/// Maximum concurrent in-flight navigation requests per session (8).
pub const MAX_IN_FLIGHT_REQUESTS: usize = 8;

// --- Rate Limiting ---
/// Sustainable message rate per second per session.
pub const MESSAGE_RATE_PER_SEC: u32 = 40;
/// Maximum token bucket burst capacity for messages per session.
pub const MESSAGE_RATE_BURST: u32 = 80;

// --- Models & Sync Thresholds ---
/// Adaptive sync UTF-8 byte threshold (64 KiB frozen final policy).
/// Below this threshold, full text edits are sent; at or above, ranged incremental edits are used.
pub const ADAPTIVE_SYNC_THRESHOLD_BYTES: usize = 64 * 1024;
/// Maximum document size in UTF-8 bytes (1 MiB).
pub const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;
/// Maximum open documents concurrently tracked per semantic session (16).
pub const MAX_OPEN_DOCUMENTS_PER_SESSION: usize = 16;
/// Maximum unsaved overlay text budget per session (4 MiB).
pub const MAX_SESSION_OVERLAY_BYTES: usize = 4 * 1024 * 1024;
/// Maximum global unsaved overlay text budget across all active sessions (8 MiB).
pub const MAX_GLOBAL_OVERLAY_BYTES: usize = 8 * 1024 * 1024;

// --- Tree Concurrency & Lifecycle ---
/// Global maximum number of concurrently running semantic child trees (2).
pub const MAX_GLOBAL_SEMANTIC_TREES: usize = 2;
/// Maximum semantic trees per authenticated client connection (1).
pub const MAX_TREES_PER_CONNECTION: usize = 1;
/// Maximum observed processes per semantic tree before triggering termination (8).
pub const MAX_PROCESSES_PER_TREE: usize = 8;

// --- Timeouts & Deadlines ---
/// Child startup and initialization deadline (30s).
pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
/// Individual navigation request deadline (10s).
pub const NAVIGATION_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// Graceful RPC shutdown timeout (2s).
pub const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(2000);
/// Signal escalation (SIGTERM -> SIGKILL) force-kill and reap budget (3s).
pub const FORCE_KILL_REAP_BUDGET: Duration = Duration::from_millis(3000);
/// Total teardown budget (5s = 2s graceful + 3s forced reap).
pub const TOTAL_TEARDOWN_BUDGET: Duration = Duration::from_millis(5000);
/// Idle session shutdown timeout with zero open models and zero pending requests (60s).
pub const IDLE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(60);
/// Socket send timeout (2s).
pub const SOCKET_SEND_TIMEOUT: Duration = Duration::from_secs(2);
/// Auth store live lookup timeout (2s).
pub const AUTH_STORE_LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);

// --- Restart Backoff Policy ---
/// Maximum permitted automatic child restarts within the restart window (2).
pub const MAX_RESTARTS_PER_WINDOW: usize = 2;
/// Time window for tracking restart frequency (5 minutes).
pub const RESTART_WINDOW: Duration = Duration::from_secs(300);
/// Backoff delay before first restart attempt (1s).
pub const RESTART_BACKOFF_STAGE1: Duration = Duration::from_secs(1);
/// Backoff delay before second restart attempt (3s).
pub const RESTART_BACKOFF_STAGE2: Duration = Duration::from_secs(3);

// --- Stderr & Memory Hints ---
/// Retained circular sanitized stderr summary buffer size per session (64 KiB).
pub const MAX_RETAINED_STDERR_BYTES: usize = 64 * 1024;
/// V8 old space heap constraint hint passed to Node.js (--max-old-space-size=256).
pub const V8_MAX_OLD_SPACE_MB: usize = 256;

// --- Linux Hard Controls Candidates ---
/// Optional Linux cgroup v2 memory ceiling (768 MiB).
pub const LINUX_CGROUP_MEMORY_MAX_BYTES: u64 = 768 * 1024 * 1024;
/// Optional Linux cgroup v2 CPU quota in microseconds (50 ms).
pub const LINUX_CGROUP_CPU_QUOTA_US: u64 = 50_000;
/// Optional Linux cgroup v2 CPU period in microseconds (100 ms => 50% CPU limit).
pub const LINUX_CGROUP_CPU_PERIOD_US: u64 = 100_000;
/// Optional Linux cgroup v2 maximum task (thread/process) ceiling (64 tasks).
/// Set to 64 to safely accommodate Node libuv worker threads and V8 compiler threads.
pub const LINUX_CGROUP_PIDS_MAX: u64 = 64;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ResourceLimitError {
    #[error("Header length {bytes} exceeds maximum allowed {max} bytes")]
    HeaderTooLarge { bytes: usize, max: usize },

    #[error("Frame body length {bytes} exceeds maximum allowed {max} bytes")]
    FrameTooLarge { bytes: usize, max: usize },

    #[error("Document size {bytes} exceeds maximum allowed {max} bytes")]
    DocumentTooLarge { bytes: usize, max: usize },

    #[error("Open documents count {count} exceeds maximum allowed {max}")]
    TooManyDocuments { count: usize, max: usize },

    #[error("Session overlay bytes {bytes} exceeds maximum allowed {max} bytes")]
    SessionOverlayExceeded { bytes: usize, max: usize },

    #[error("Global overlay bytes {bytes} exceeds maximum allowed {max} bytes")]
    GlobalOverlayExceeded { bytes: usize, max: usize },

    #[error("In-flight request count {count} exceeds maximum allowed {max}")]
    InFlightQueueFull { count: usize, max: usize },
}

/// Centralized runtime configuration and admission limits for semantic sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePolicy {
    pub version: String,
    pub max_header_bytes: usize,
    pub max_frame_bytes: usize,
    pub max_queued_messages: usize,
    pub max_queued_bytes: usize,
    pub max_in_flight_requests: usize,
    pub rate_per_sec: u32,
    pub rate_burst: u32,
    pub adaptive_sync_threshold_bytes: usize,
    pub max_document_bytes: usize,
    pub max_open_documents: usize,
    pub max_session_overlay_bytes: usize,
    pub max_global_overlay_bytes: usize,
    pub max_global_trees: usize,
    pub max_processes_per_tree: usize,
    pub startup_timeout_ms: u64,
    pub navigation_timeout_ms: u64,
    pub idle_timeout_ms: u64,
    pub v8_max_old_space_mb: usize,
}

impl Default for ResourcePolicy {
    fn default() -> Self {
        Self {
            version: RESOURCE_POLICY_VERSION.to_string(),
            max_header_bytes: MAX_STDIO_HEADER_BYTES,
            max_frame_bytes: MAX_FRAME_BODY_BYTES,
            max_queued_messages: MAX_QUEUED_MESSAGES,
            max_queued_bytes: MAX_QUEUED_BYTES,
            max_in_flight_requests: MAX_IN_FLIGHT_REQUESTS,
            rate_per_sec: MESSAGE_RATE_PER_SEC,
            rate_burst: MESSAGE_RATE_BURST,
            adaptive_sync_threshold_bytes: ADAPTIVE_SYNC_THRESHOLD_BYTES,
            max_document_bytes: MAX_DOCUMENT_BYTES,
            max_open_documents: MAX_OPEN_DOCUMENTS_PER_SESSION,
            max_session_overlay_bytes: MAX_SESSION_OVERLAY_BYTES,
            max_global_overlay_bytes: MAX_GLOBAL_OVERLAY_BYTES,
            max_global_trees: MAX_GLOBAL_SEMANTIC_TREES,
            max_processes_per_tree: MAX_PROCESSES_PER_TREE,
            startup_timeout_ms: STARTUP_TIMEOUT.as_millis() as u64,
            navigation_timeout_ms: NAVIGATION_REQUEST_TIMEOUT.as_millis() as u64,
            idle_timeout_ms: IDLE_SHUTDOWN_TIMEOUT.as_millis() as u64,
            v8_max_old_space_mb: V8_MAX_OLD_SPACE_MB,
        }
    }
}

impl ResourcePolicy {
    /// Determines whether incremental or full sync should be used based on post-edit UTF-8 byte length.
    pub fn is_incremental_sync_recommended(post_edit_utf8_bytes: usize) -> bool {
        post_edit_utf8_bytes >= ADAPTIVE_SYNC_THRESHOLD_BYTES
    }

    /// Validate that a document size does not exceed the per-document limit.
    pub fn validate_document_size(bytes: usize) -> Result<(), ResourceLimitError> {
        if bytes > MAX_DOCUMENT_BYTES {
            Err(ResourceLimitError::DocumentTooLarge {
                bytes,
                max: MAX_DOCUMENT_BYTES,
            })
        } else {
            Ok(())
        }
    }

    /// Validate that a frame body size does not exceed the maximum allowed size.
    pub fn validate_frame_size(bytes: usize) -> Result<(), ResourceLimitError> {
        if bytes > MAX_FRAME_BODY_BYTES {
            Err(ResourceLimitError::FrameTooLarge {
                bytes,
                max: MAX_FRAME_BODY_BYTES,
            })
        } else {
            Ok(())
        }
    }

    /// Validate that a stdio header size does not exceed the maximum allowed size.
    pub fn validate_header_size(bytes: usize) -> Result<(), ResourceLimitError> {
        if bytes > MAX_STDIO_HEADER_BYTES {
            Err(ResourceLimitError::HeaderTooLarge {
                bytes,
                max: MAX_STDIO_HEADER_BYTES,
            })
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
pub mod linux;
