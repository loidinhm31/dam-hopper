//! Native identity of dispatched input and the lease-expiry watcher.
//!
//! A control lease's held keys/buttons must be released on the EXACT native page session the
//! input was dispatched on, whatever later happens to the producer registry, so the identity is
//! captured when input is first held and every termination path releases through it.

use std::fmt;
use std::sync::{Arc, Weak};

use tokio::sync::watch;
use tokio::time::Instant;

use super::cdp::CdpClient;
use super::input::{InputEvent, SessionInputManager};
use super::media::dispatch_input_event_to_cdp;
use super::protocol::TargetGeometry;

/// Captured native identity: the CDP connection, its flattened page session and the geometry
/// pointer fractions were projected through.
#[derive(Clone)]
pub struct NativeInputTarget {
    pub client: Arc<CdpClient>,
    pub page_session_id: String,
    pub geometry: TargetGeometry,
}

impl fmt::Debug for NativeInputTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeInputTarget")
            .field("page_session_id", &self.page_session_id)
            .finish_non_exhaustive()
    }
}

impl NativeInputTarget {
    /// Dispatches one event on this exact native identity; the error is the CDP failure text.
    pub async fn dispatch(&self, event: &InputEvent) -> Result<(), String> {
        dispatch_input_event_to_cdp(&self.client, &self.page_session_id, &self.geometry, event)
            .await
            .map_err(|err| err.to_string())
    }
}

/// Active expiry: sleeps until the lease's own deadline and ends it (releasing held native
/// input) with no incoming traffic. The watcher holds only a `Weak` manager plus the expiry
/// channel, so it ends when the manager is dropped.
pub fn spawn_expiry_watcher(
    manager: Weak<SessionInputManager>,
    mut expiry: watch::Receiver<Option<Instant>>,
) {
    tokio::spawn(async move {
        loop {
            let deadline = *expiry.borrow_and_update();
            match deadline {
                None => {
                    if expiry.changed().await.is_err() {
                        return;
                    }
                }
                Some(at) => {
                    tokio::select! {
                        changed = expiry.changed() => {
                            if changed.is_err() {
                                return;
                            }
                        }
                        _ = tokio::time::sleep_until(at) => {
                            let Some(manager) = manager.upgrade() else {
                                return;
                            };
                            if let Err(err) = manager.expire_if_due().await {
                                tracing::warn!(error = %err, "expired lease: native input release failed");
                            }
                        }
                    }
                }
            }
        }
    });
}
