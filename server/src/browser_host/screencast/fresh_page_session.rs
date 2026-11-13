//! Replacement of the producer's dedicated Page session (and, if needed, its CDP actor).

use std::sync::atomic::Ordering;
use std::time::Duration;

use tokio::time::timeout;
use tracing::debug;

use super::{CdpError, ScreencastProducer};

const DETACH_DEADLINE: Duration = Duration::from_secs(2);
const RECONNECT_DEADLINE: Duration = Duration::from_secs(5);
const FRESH_SESSION_DEADLINE: Duration = Duration::from_secs(10);

impl ScreencastProducer {
    /// Caller holds the lifecycle lock; setup and disposal share the Page-session gate.
    pub(super) async fn open_fresh_page_session_locked(&self) -> Result<String, CdpError> {
        let _setup = self.page_setup.lock().await;
        if let Some(context) = &self.selection_context {
            let mut pending = self.selection_gap.lock().await;
            if pending.is_none() {
                let mut gap = crate::browser_host::selection::begin_page_observation_gap(
                    &self.browser_session_id,
                );
                gap.invalidate(context).await;
                *pending = Some(gap);
            }
        }
        if self.page_session_poisoned.load(Ordering::Acquire) {
            self.close_ambiguous_page_actor().await?;
        }
        self.page_session_poisoned.store(true, Ordering::Release);
        let old = self.page_session_id.write().await.take();
        if self.cdp_client.is_closed() {
            self.close_ambiguous_page_actor().await?;
        } else if let Some(sid) = old {
            if self.detach_page_session(&sid).await.is_err() {
                self.close_ambiguous_page_actor().await?;
            }
        }
        if self.cdp_client.is_closed() {
            timeout(RECONNECT_DEADLINE, self.cdp_client.reconnect())
                .await
                .map_err(|_| CdpError::CommandTimeout)??;
        }
        // The attach can succeed even if its response or a later setup command times out.
        // Keep the poison set across the entire operation, including cancellation.
        self.page_session_poisoned.store(true, Ordering::Release);
        let setup = async {
            let sid = self.attach_page_session_locked().await?;
            self.apply_stealth_and_focus(&sid).await?;
            Ok::<_, CdpError>(sid)
        };
        let result = timeout(FRESH_SESSION_DEADLINE, setup)
            .await
            .unwrap_or(Err(CdpError::CommandTimeout));
        match result {
            Ok(sid) => {
                if let Some(context) = &self.selection_context {
                    let gap = self.selection_gap.lock().await.take();
                    if let Some(gap) = gap {
                        if !gap.finish(context, &self.cdp_client, &sid).await {
                            *self.page_session_id.write().await = None;
                            self.close_ambiguous_page_actor().await?;
                            return Err(CdpError::Protocol {
                                code: -1,
                                message: "replacement Page observation could not be established".to_string(),
                            });
                        }
                    }
                }
                self.page_session_poisoned.store(false, Ordering::Release);
                self.recovery.page_generation.send_modify(|g| *g += 1);
                Ok(sid)
            }
            Err(error) => {
                *self.page_session_id.write().await = None;
                self.close_ambiguous_page_actor().await?;
                Err(error)
            }
        }
    }

    /// Forget a session only after detach succeeds or the connection is confirmed closed.
    pub(super) async fn discard_page_session(&self) {
        let _setup = self.page_setup.lock().await;
        if self.page_session_poisoned.load(Ordering::Acquire) {
            let _ = self.close_ambiguous_page_actor().await;
            return;
        }
        self.page_session_poisoned.store(true, Ordering::Release);
        let old = self.page_session_id.write().await.take();
        if self.cdp_client.is_closed() {
            let _ = self.close_ambiguous_page_actor().await;
            return;
        }
        if let Some(sid) = old {
            if self.detach_page_session(&sid).await.is_err() {
                let _ = self.close_ambiguous_page_actor().await;
                return;
            }
        }
        self.page_session_poisoned.store(false, Ordering::Release);
    }

    /// Close the entire connection when the existence of a Page session is uncertain.
    /// The poison is retained if the actor does not stop within the deadline.
    pub(super) async fn close_ambiguous_page_actor(&self) -> Result<(), CdpError> {
        self.page_session_poisoned.store(true, Ordering::Release);
        self.cdp_client.close().await;
        timeout(DETACH_DEADLINE, self.cdp_client.closed())
            .await
            .map_err(|_| CdpError::CommandTimeout)?;
        *self.page_session_id.write().await = None;
        self.page_session_poisoned.store(false, Ordering::Release);
        Ok(())
    }

    async fn detach_page_session(&self, session_id: &str) -> Result<(), CdpError> {
        let detach = self.cdp_client.send_command(
            "Target.detachFromTarget",
            Some(serde_json::json!({ "sessionId": session_id })),
            None,
        );
        match timeout(DETACH_DEADLINE, detach).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(error)) => {
                debug!(%error, "old Page session detach failed");
                Err(error)
            }
            Err(_) => {
                debug!("old Page session detach timed out");
                Err(CdpError::CommandTimeout)
            }
        }
    }
}
