//! Run abort path, ACK observation and the single-flight recovery supervisor.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tokio::sync::OwnedSemaphorePermit;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};
use uuid::Uuid;

use super::recovery::{AbortCause, RecoveryState};
use super::{PendingAck, ScreencastProducer, ScreencastState};

struct AbortOwnership(Arc<RecoveryState>);

impl Drop for AbortOwnership {
    fn drop(&mut self) {
        self.0.aborting.fetch_sub(1, Ordering::AcqRel);
    }
}

impl ScreencastProducer {
    /// Watches one admitted ACK. The attempt itself is already queued; this only observes the
    /// answer. Any failure aborts the run the ACK belonged to (never a different run).
    pub(super) fn watch_ack(
        &self,
        run: Uuid,
        pending: PendingAck,
        permit: OwnedSemaphorePermit,
        cancel: CancellationToken,
    ) {
        let this = self.clone_handle();
        let ack_timeout = self.recovery.policy.ack_timeout;
        tokio::spawn(async move {
            let _permit = permit;
            let outcome = tokio::select! {
                _ = cancel.cancelled() => None,
                res = timeout(ack_timeout, pending.wait()) => Some(res),
            };
            let ledger = &this.ledger;
            match outcome {
                None => {
                    ledger.acks_abandoned.fetch_add(1, Ordering::Relaxed);
                }
                Some(Ok(Ok(()))) => {
                    ledger.acks_completed.fetch_add(1, Ordering::Relaxed);
                }
                Some(Ok(Err(e))) => {
                    ledger.acks_failed.fetch_add(1, Ordering::Relaxed);
                    this.fail_run(run, AbortCause::AckFailed(e));
                }
                Some(Err(_)) => {
                    ledger.acks_failed.fetch_add(1, Ordering::Relaxed);
                    this.fail_run(run, AbortCause::AckTimedOut);
                }
            }
        });
    }

    /// Declares `run` ambiguous. Idempotent: only the run that is still current is retired.
    pub(super) fn fail_run(&self, run: Uuid, cause: AbortCause) {
        let this = self.clone_handle();
        self.recovery.aborting.fetch_add(1, Ordering::AcqRel);
        let ownership = AbortOwnership(self.recovery.clone());
        tokio::spawn(async move {
            let _ownership = ownership;
            this.recover_after_abort(run, cause).await;
        });
    }

    async fn recover_after_abort(self: Arc<Self>, run: Uuid, cause: AbortCause) {
        let epoch = self.recovery.epoch.load(Ordering::SeqCst);
        {
            let _operation = self.lifecycle_operation.lock().await;
            let mut state = self.state.write().await;
            // Compare-and-set on the run identity under the lifecycle owner: a stale failure
            // (planned stop, tier switch, earlier abort) neither retires nor recovers anything.
            if *self.current_run.read().await != Some(run) {
                return;
            }
            warn!(producer_run = %run, cause = %cause, "screencast run aborted; native ACK obligations are ambiguous");
            self.ledger.runs_aborted.fetch_add(1, Ordering::Relaxed);
            if let AbortCause::IngressLagged(_) = cause {
                self.ledger.ingress_lagged.fetch_add(1, Ordering::Relaxed);
            }
            // A replacement run must not inherit the old run's pointer authority.
            // Downscaled runs remain untrusted until a full-scale frame revalidates
            // native geometry.
            self.geometry_trusted.store(false, Ordering::Release);
            if let Some(context) = &self.selection_context {
                let mut gap = crate::browser_host::selection::begin_page_observation_gap(
                    &self.browser_session_id,
                );
                gap.invalidate(context).await;
                *self.selection_gap.lock().await = Some(gap);
            }
            let input = crate::api::browser_host::get_or_create_input_manager(
                &self.browser_session_id,
            )
            .await;
            if let Err(err) = input.suspend_for_recovery().await {
                // The old native identity is still needed to resolve held input.
                // Never detach it or advertise a successful replacement on failure.
                error!(error = %err, "cannot retire held input during recovery");
                self.retire_locked(&mut state).await;
                self.declare_unavailable(1);
                return;
            }
            self.recovery.note_abort(run);
            self.retire_locked(&mut state).await;
            drop(state);
            self.discard_page_session().await;
        }
        self.supervise_recovery(epoch).await;
    }

    async fn supervise_recovery(self: Arc<Self>, epoch: u64) {
        let rec = &self.recovery;
        if rec.epoch.load(Ordering::SeqCst) != epoch {
            return;
        }
        rec.requested.store(true, Ordering::SeqCst);
        if rec.active.swap(true, Ordering::SeqCst) {
            return; // the running loop observes `requested`
        }
        loop {
            rec.requested.store(false, Ordering::SeqCst);
            self.recovery_attempts(epoch).await;
            rec.active.store(false, Ordering::SeqCst);
            if !(rec.requested.load(Ordering::SeqCst) && !rec.active.swap(true, Ordering::SeqCst)) {
                break;
            }
        }
    }

    /// Bounded attempts to bring a run back while demand survives.
    async fn recovery_attempts(&self, epoch: u64) {
        let rec = &self.recovery;
        loop {
            let failures = rec.failures.load(Ordering::SeqCst);
            let delay = rec.policy.backoff(failures);
            if !delay.is_zero() {
                tokio::time::sleep(delay).await;
            }
            self.check_viewer_expiry().await;
            let _operation = self.lifecycle_operation.lock().await;
            let state = self.state.read().await;
            if rec.epoch.load(Ordering::SeqCst) != epoch {
                return; // explicit stop superseded this recovery
            }
            if *state != ScreencastState::Stopped {
                return; // a demand-driven start already brought a run back
            }
            if self.visible_viewer_count().await == 0 {
                debug!("recovery idle: no visible viewer demand, not restarting");
                return;
            }
            // A superseded supervisor must not publish unavailable for a stopped
            // or already-replaced run.
            if failures > rec.policy.max_attempts {
                self.declare_unavailable(failures);
                return;
            }
            self.ledger.recovery_attempts.fetch_add(1, Ordering::Relaxed);
            drop(state);
            let opened = self.open_fresh_page_session_locked().await;
            let mut state = self.state.write().await;
            if rec.epoch.load(Ordering::SeqCst) != epoch
                || *state != ScreencastState::Stopped
                || self.visible_viewer_count().await == 0
            {
                return;
            }
            let started = match opened {
                Ok(_) => self.start_run_locked(&mut state).await.map(|_| ()),
                Err(e) => Err(e),
            };
            match started {
                Ok(()) => {
                    let input = crate::api::browser_host::get_or_create_input_manager(
                        &self.browser_session_id,
                    )
                    .await;
                    input.resume_after_recovery().await;
                    self.ledger.recoveries_succeeded.fetch_add(1, Ordering::Relaxed);
                    return;
                }
                Err(e) => {
                    warn!(error = %e, "screencast recovery attempt failed");
                    rec.failures.fetch_add(1, Ordering::SeqCst);
                    drop(state);
                    self.discard_page_session().await;
                }
            }
        }
    }

    fn declare_unavailable(&self, failures: u32) {
        error!(failures, "screencast recovery exhausted; stream unavailable until new demand");
        self.ledger.recoveries_exhausted.fetch_add(1, Ordering::Relaxed);
        // The revision must bracket publication, not follow it: readers must not
        // cache a changed status under the previous revision.
        let _mutation = self.begin_quality_mutation();
        self.recovery.unavailable.store(true, Ordering::Release);
    }

    /// Called when a run starts: new demand after exhaustion recovers visibly.
    pub(super) fn note_run_started(&self, run: Uuid) {
        self.recovery.run_started(run);
        let _mutation = self.begin_quality_mutation();
        self.recovery.unavailable.store(false, Ordering::Release);
    }
}
