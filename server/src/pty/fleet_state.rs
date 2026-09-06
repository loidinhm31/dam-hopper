use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::error::AppError;

/// Content-free snapshot of authoritative PTY fleet state.
///
/// Contains strictly monotonic generation, counts, and coordinator-relevant
/// lifecycle flags. Never copies session IDs, command strings, output,
/// environment, cwd, or browser identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyFleetSnapshot {
    /// Monotonic generation incremented on every state transition that could
    /// invalidate fleet idleness.
    pub generation: u64,
    /// Authoritative count of live, running PTY sessions.
    pub live_count: usize,
    /// Count of PTY sessions currently reserved and undergoing spawn.
    pub creating_count: usize,
    /// Count of PTY sessions that have exited restartably and are awaiting respawn.
    pub restart_pending_count: usize,
    /// True when the PTY manager is currently disposing sessions (e.g. workspace switch).
    pub disposing: bool,
    /// True when the server is performing terminal shutdown.
    pub closing: bool,
    /// True when an idle-suspend helper handoff has been accepted and is in flight.
    pub handoff_active: bool,
}

impl PtyFleetSnapshot {
    /// Quiescent is defined as zero live, creating, or restart-pending sessions,
    /// with neither disposal, shutdown, nor handoff active.
    ///
    /// Dead / tombstone sessions are excluded and never affect quiescence.
    pub fn is_quiescent(&self) -> bool {
        self.live_count == 0
            && self.creating_count == 0
            && self.restart_pending_count == 0
            && !self.disposing
            && !self.closing
            && !self.handoff_active
    }

    /// Total count of all currently active or reserved sessions.
    pub fn running_count(&self) -> usize {
        self.live_count + self.creating_count + self.restart_pending_count
    }
}

/// Receiver seam exposing the latest authoritative PTY fleet snapshot.
#[derive(Clone, Debug)]
pub struct PtyFleetWatcher {
    rx: watch::Receiver<PtyFleetSnapshot>,
}

impl PtyFleetWatcher {
    pub fn new(rx: watch::Receiver<PtyFleetSnapshot>) -> Self {
        Self { rx }
    }

    /// Read the current snapshot without marking it as seen.
    pub fn snapshot(&self) -> PtyFleetSnapshot {
        *self.rx.borrow()
    }

    /// Mark the current snapshot as seen so subsequent `changed()` calls only yield on newer snapshots.
    pub fn mark_seen(&mut self) {
        let _ = self.rx.borrow_and_update();
    }

    /// Direct borrow of the latest snapshot in the watch channel.
    pub fn borrow(&self) -> watch::Ref<'_, PtyFleetSnapshot> {
        self.rx.borrow()
    }

    /// Borrow and mark as seen.
    pub fn borrow_and_update(&mut self) -> watch::Ref<'_, PtyFleetSnapshot> {
        self.rx.borrow_and_update()
    }
    /// Wait until a newer snapshot is published.
    pub async fn changed(&mut self) -> Result<(), watch::error::RecvError> {
        self.rx.changed().await
    }
}

/// Token proving successful admission of a suspend handoff claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandoffClaim {
    pub generation: u64,
}

/// Reasons why a handoff claim cannot be admitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandoffClaimError {
    Closing,
    Disposing,
    HandoffAlreadyActive,
    NotQuiescent,
    GenerationMismatch { expected: u64, actual: u64 },
}

/// Internal authoritative state tracker for the PTY fleet.
///
/// Kept under the PTY manager's `Inner` mutex so every lifecycle mutation
/// and handoff gate check is atomic. Internal maps preserve session ID and
/// incarnation matching to reject stale callbacks.
pub struct PtyFleetState {
    live: HashMap<String, u64>,
    creating: HashMap<String, u64>,
    restart_pending: HashMap<String, u64>,
    generation: u64,
    disposing: bool,
    closing: bool,
    handoff_active: bool,
    watch_tx: watch::Sender<PtyFleetSnapshot>,
}

impl PtyFleetState {
    /// Initialize a new fleet state and its corresponding public watcher.
    pub fn new() -> (Self, PtyFleetWatcher) {
        let initial_snapshot = PtyFleetSnapshot {
            generation: 1,
            live_count: 0,
            creating_count: 0,
            restart_pending_count: 0,
            disposing: false,
            closing: false,
            handoff_active: false,
        };
        let (watch_tx, watch_rx) = watch::channel(initial_snapshot);
        let state = Self {
            live: HashMap::new(),
            creating: HashMap::new(),
            restart_pending: HashMap::new(),
            generation: 1,
            disposing: false,
            closing: false,
            handoff_active: false,
            watch_tx,
        };
        (state, PtyFleetWatcher::new(watch_rx))
    }

    /// Get current snapshot.
    pub fn snapshot(&self) -> PtyFleetSnapshot {
        PtyFleetSnapshot {
            generation: self.generation,
            live_count: self.live.len(),
            creating_count: self.creating.len(),
            restart_pending_count: self.restart_pending.len(),
            disposing: self.disposing,
            closing: self.closing,
            handoff_active: self.handoff_active,
        }
    }

    /// Current monotonic generation.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Check if fleet is currently quiescent.
    pub fn is_quiescent(&self) -> bool {
        self.snapshot().is_quiescent()
    }

    /// Check if handoff is in flight.
    pub fn is_handoff_active(&self) -> bool {
        self.handoff_active
    }

    /// Check if manager is disposing sessions.
    pub fn is_disposing(&self) -> bool {
        self.disposing
    }

    /// Check if manager is closing for server shutdown.
    pub fn is_closing(&self) -> bool {
        self.closing
    }

    fn publish(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        let snapshot = self.snapshot();
        let _ = self.watch_tx.send(snapshot);
    }

    /// Reserve `creating` state before releasing the lock for slow PTY spawn.
    ///
    /// Rejects with `IdleSuspendHandoffInProgress` if a suspend handoff is in flight,
    /// or `Unavailable` if shutting down.
    pub fn begin_create(&mut self, id: &str, incarnation: u64) -> Result<(), AppError> {
        if self.handoff_active {
            return Err(AppError::IdleSuspendHandoffInProgress(
                "Cannot create terminal while host suspend is in progress".into(),
            ));
        }
        if self.closing {
            return Err(AppError::Unavailable(
                "PTY manager is shutting down".into(),
            ));
        }

        // Clean any stale reservations or prior records for this id.
        self.creating.remove(id);
        self.restart_pending.remove(id);
        self.creating.insert(id.to_string(), incarnation);
        self.publish();
        Ok(())
    }

    /// Transition a session from `creating` to `live` upon successful spawn.
    ///
    /// If the incarnation does not match the active `creating` reservation,
    /// this call is a no-op (stale completion).
    pub fn publish_live(&mut self, id: &str, incarnation: u64) {
        if self.creating.get(id).copied() == Some(incarnation) {
            self.creating.remove(id);
            self.live.insert(id.to_string(), incarnation);
            self.publish();
        } else if !self.live.contains_key(id) && !self.creating.contains_key(id) {
            // If it wasn't in creating (e.g. restored session without create reservation),
            // publish it directly as live.
            self.live.insert(id.to_string(), incarnation);
            self.publish();
        }
    }

    /// Cancel a `creating` reservation if spawn fails or was aborted.
    ///
    /// Stale reservation tokens are safely ignored.
    pub fn cancel_create(&mut self, id: &str, incarnation: u64) {
        if self.creating.get(id).copied() == Some(incarnation) {
            self.creating.remove(id);
            self.publish();
        }
    }

    /// Atomically transition an exiting session from `live` to `restart_pending`.
    ///
    /// Crucial invariant: never emits an empty or quiescent fleet observation
    /// between live exit and restart supervisor scheduling.
    pub fn transition_live_to_restart_pending(&mut self, id: &str, incarnation: u64) {
        if self.live.get(id).copied() == Some(incarnation) {
            self.live.remove(id);
            self.restart_pending.insert(id.to_string(), incarnation);
            self.publish();
        }
    }

    /// Remove a session from `live` when it exits without restart.
    pub fn remove_live(&mut self, id: &str, incarnation: u64) {
        if self.live.get(id).copied() == Some(incarnation) {
            self.live.remove(id);
            self.publish();
        }
    }

    /// Atomically transition a session from `restart_pending` to `creating`
    /// when the supervisor loop begins respawning.
    ///
    /// Rejects if a suspend handoff is currently in flight.
    pub fn transition_restart_pending_to_creating(
        &mut self,
        id: &str,
        source_incarnation: u64,
        replacement_incarnation: u64,
    ) -> Result<(), AppError> {
        if self.handoff_active {
            return Err(AppError::IdleSuspendHandoffInProgress(
                "Cannot restart terminal while host suspend is in progress".into(),
            ));
        }
        if self.closing {
            return Err(AppError::Unavailable(
                "PTY manager is shutting down".into(),
            ));
        }

        if self.restart_pending.get(id).copied() == Some(source_incarnation) {
            self.restart_pending.remove(id);
            self.creating.insert(id.to_string(), replacement_incarnation);
            self.publish();
        } else {
            // If source wasn't found in restart_pending (e.g. already cancelled),
            // still ensure creating is registered if this replacement is valid.
            self.creating.insert(id.to_string(), replacement_incarnation);
            self.publish();
        }
        Ok(())
    }

    /// Cancel a `restart_pending` reservation (e.g. killed during backoff,
    /// generation changed, or supervisor dropped command).
    pub fn cancel_restart_pending(&mut self, id: &str, incarnation: u64) {
        if self.restart_pending.get(id).copied() == Some(incarnation) {
            self.restart_pending.remove(id);
            self.publish();
        }
    }

    /// Remove any reservation or live entry for the given ID (on manual kill or remove).
    pub fn remove_all_for_id(&mut self, id: &str) {
        let had_live = self.live.remove(id).is_some();
        let had_creating = self.creating.remove(id).is_some();
        let had_restart = self.restart_pending.remove(id).is_some();
        if had_live || had_creating || had_restart {
            self.publish();
        }
    }

    /// Set disposal state (e.g. during workspace switch or cleanup).
    pub fn mark_disposing(&mut self, disposing: bool) {
        if self.disposing != disposing {
            self.disposing = disposing;
            if disposing {
                self.live.clear();
                self.creating.clear();
                self.restart_pending.clear();
            }
            self.publish();
        }
    }

    /// Mark closing for server shutdown.
    pub fn mark_closing(&mut self, closing: bool) {
        if self.closing != closing {
            self.closing = closing;
            self.publish();
        }
    }

    fn check_claim_common(&self, expected_generation: u64) -> Result<(), HandoffClaimError> {
        if self.closing {
            return Err(HandoffClaimError::Closing);
        }
        if self.disposing {
            return Err(HandoffClaimError::Disposing);
        }
        if self.handoff_active {
            return Err(HandoffClaimError::HandoffAlreadyActive);
        }
        if self.generation != expected_generation {
            return Err(HandoffClaimError::GenerationMismatch {
                expected: expected_generation,
                actual: self.generation,
            });
        }
        Ok(())
    }

    /// Attempt to claim handoff admission for idle suspend.
    ///
    /// Atomic check: must be quiescent, generation must match expected,
    /// and neither closing, disposing, nor handoff active.
    pub fn try_claim_handoff(&mut self, expected_generation: u64) -> Result<HandoffClaim, HandoffClaimError> {
        self.check_claim_common(expected_generation)?;
        if !self.is_quiescent() {
            return Err(HandoffClaimError::NotQuiescent);
        }

        self.handoff_active = true;
        self.publish();
        Ok(HandoffClaim {
            generation: self.generation,
        })
    }

    /// Attempt to claim forced handoff admission for manual force sleep.
    ///
    /// Atomic check: generation must match expected, and neither closing, disposing,
    /// nor handoff active. Bypasses only the quiescence predicate.
    pub fn try_claim_forced_handoff(&mut self, expected_generation: u64) -> Result<HandoffClaim, HandoffClaimError> {
        self.check_claim_common(expected_generation)?;

        self.handoff_active = true;
        self.publish();
        Ok(HandoffClaim {
            generation: self.generation,
        })
    }

    /// Release handoff admission gate (upon completion, resume, or enqueue failure).
    pub fn release_handoff(&mut self) {
        if self.handoff_active {
            self.handoff_active = false;
            self.publish();
        }
    }
}
