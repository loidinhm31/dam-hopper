//! Fatal run aborts and bounded recovery of the screencast producer.
//!
//! A run whose native ACK obligations can no longer be accounted for (ingress lag or loss, an
//! ACK that failed or never answered, a lost actor, an oversize frame) is *ambiguous*: it is
//! retired, its dedicated Page session is detached, and ACKs are never replayed across runs.
//! While visible viewer demand survives, a supervisor (`recovery_supervisor`) starts a fresh
//! run (new `producerRun`, fresh Page session, new audio source) through the same start path
//! the capture-tier switch uses. Attempts are bounded with backoff; after exhaustion the
//! stream is reported `unavailable` and nothing is retried until new demand arrives.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex as SyncMutex;
use tokio::sync::watch;
use uuid::Uuid;

use super::{CdpError, ScreencastProducer};

/// Un-answered ACKs one run may have outstanding; Chromium itself keeps only a couple of frames
/// in flight, so reaching this bound means ACK responses are not coming back.
pub(super) const MAX_ACKS_IN_FLIGHT: usize = 8;

/// Bounds of the recovery supervisor.
#[derive(Debug, Clone, Copy)]
pub struct RecoveryPolicy {
    /// Consecutive failures (aborted runs plus failed starts) tolerated before `unavailable`.
    pub max_attempts: u32,
    /// Delay before the second attempt; doubles per further failure up to `max_backoff`.
    pub base_backoff: Duration,
    pub max_backoff: Duration,
    /// How long one ACK response may take before the run is declared ambiguous.
    pub ack_timeout: Duration,
    /// A run that lived this long resets the consecutive-failure count.
    pub stable_run: Duration,
}

impl Default for RecoveryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            base_backoff: Duration::from_millis(250),
            max_backoff: Duration::from_secs(4),
            ack_timeout: Duration::from_secs(10),
            stable_run: Duration::from_secs(10),
        }
    }
}

impl RecoveryPolicy {
    /// First recovery is immediate; later ones back off exponentially.
    pub(super) fn backoff(&self, failures: u32) -> Duration {
        if failures <= 1 {
            return Duration::ZERO;
        }
        let shift = (failures - 2).min(16);
        self.base_backoff
            .saturating_mul(1u32 << shift)
            .min(self.max_backoff)
    }
}

/// Why a run was aborted; every cause leaves native ACK obligations unaccounted for.
#[derive(Debug)]
pub(super) enum AbortCause {
    IngressLagged(u64),
    IngressClosed,
    ActorLost,
    OversizeFrame,
    AckBacklog,
    AckEnqueue(CdpError),
    AckFailed(CdpError),
    /// A newer native screencast session appeared under the current run (unplanned restart).
    NativeSessionChanged,
    /// A native stop got no definite answer (timeout, lost transport, unreadable response).
    NativeStopAmbiguous,
    AckTimedOut,
}

impl std::fmt::Display for AbortCause {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::IngressLagged(n) => write!(f, "ingress lagged by {n} frames"),
            Self::IngressClosed => write!(f, "ingress closed"),
            Self::ActorLost => write!(f, "CDP actor lost"),
            Self::OversizeFrame => write!(f, "oversize frame"),
            Self::AckBacklog => write!(f, "ACK backlog bound reached"),
            Self::AckEnqueue(e) => write!(f, "ACK could not be queued: {e}"),
            Self::AckFailed(e) => write!(f, "ACK failed: {e}"),
            Self::AckTimedOut => write!(f, "ACK response timed out"),
            Self::NativeSessionChanged => write!(f, "native screencast session changed"),
            Self::NativeStopAmbiguous => write!(f, "native stop outcome is ambiguous"),
        }
    }
}

pub(super) struct RecoveryState {
    pub(super) policy: RecoveryPolicy,
    /// A supervisor loop is running (single flight).
    pub(super) active: AtomicBool,
    /// Abort tasks own the producer before the supervisor enters its retry loop.
    pub(super) aborting: AtomicUsize,
    /// An abort asked for recovery since the running loop last looked.
    pub(super) requested: AtomicBool,
    /// Bumped by explicit stops: a pending recovery of an earlier epoch must not restart.
    pub(super) epoch: AtomicU64,
    pub(super) failures: AtomicU32,
    pub(super) unavailable: AtomicBool,
    run_started: SyncMutex<Option<(Uuid, Instant)>>,
    /// Counts Page sessions replaced after attach; consumers re-bind per-session observers.
    pub(super) page_generation: watch::Sender<u64>,
    /// Test barrier: while `true` the run loop does not take frames off its ingress receiver.
    ingress_hold: watch::Sender<bool>,
}

impl RecoveryState {
    pub(super) fn new(policy: RecoveryPolicy) -> Self {
        Self {
            policy,
            active: AtomicBool::new(false),
            aborting: AtomicUsize::new(0),
            requested: AtomicBool::new(false),
            epoch: AtomicU64::new(0),
            failures: AtomicU32::new(0),
            unavailable: AtomicBool::new(false),
            run_started: SyncMutex::new(None),
            page_generation: watch::channel(0).0,
            ingress_hold: watch::channel(false).0,
        }
    }

    pub(super) fn is_unavailable(&self) -> bool {
        self.unavailable.load(Ordering::Acquire)
    }

    /// An explicit stop (owner, privacy, session close) supersedes any pending recovery.
    pub(super) fn cancel(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        self.requested.store(false, Ordering::SeqCst);
    }

    pub(super) fn run_started(&self, run: Uuid) {
        *self.run_started.lock() = Some((run, Instant::now()));
    }

    pub(super) fn ingress_barrier(&self) -> watch::Receiver<bool> {
        self.ingress_hold.subscribe()
    }

    /// Counts one failure; a run that proved stable first forgives the earlier ones.
    pub(super) fn note_abort(&self, run: Uuid) {
        let lived = (*self.run_started.lock())
            .filter(|(started, _)| *started == run)
            .map(|(_, at)| at.elapsed());
        if lived.is_some_and(|d| d >= self.policy.stable_run) {
            self.failures.store(0, Ordering::SeqCst);
        }
        self.failures.fetch_add(1, Ordering::SeqCst);
    }
}

impl ScreencastProducer {
    /// Replaces the recovery bounds (builder; tests use short ones).
    pub fn with_recovery_policy(mut self, policy: RecoveryPolicy) -> Self {
        self.recovery = Arc::new(RecoveryState::new(policy));
        self
    }

    /// True while the producer gave up recovering a run that viewers still want.
    pub fn recovery_unavailable(&self) -> bool {
        self.recovery.is_unavailable()
    }

    /// True during abort cleanup or while a supervisor is trying to restore a run.
    pub fn recovery_pending(&self) -> bool {
        self.recovery.aborting.load(Ordering::Acquire) != 0
            || self.recovery.active.load(Ordering::Acquire)
    }

    /// Ticks every time recovery attached a replacement Page session.
    pub fn subscribe_page_sessions(&self) -> watch::Receiver<u64> {
        self.recovery.page_generation.subscribe()
    }

    /// Test barrier: parks the run loop before its next ingress read.
    pub fn hold_frame_ingress(&self) {
        self.recovery.ingress_hold.send_replace(true);
    }

    pub fn release_frame_ingress(&self) {
        self.recovery.ingress_hold.send_replace(false);
    }
}
