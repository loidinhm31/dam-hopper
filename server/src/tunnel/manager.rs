use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::pty::EventSink;

use super::{
    driver::{DriverHandle, TunnelDriver, TunnelDriverEvent},
    error::TunnelError,
    installer::TunnelInstaller,
    session::{TunnelSession, TunnelStatus},
};

/// Resets the `installing` flag on drop — ensures cleanup even on task panic.
struct InstallGuard(Arc<AtomicBool>);
impl Drop for InstallGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone)]
pub struct TunnelSessionManager {
    sessions: Arc<RwLock<HashMap<Uuid, TunnelSession>>>,
    handles: Arc<RwLock<HashMap<Uuid, DriverHandle>>>,
    sink: Arc<dyn EventSink>,
    driver: Arc<dyn TunnelDriver>,
    installing: Arc<AtomicBool>,
}

impl TunnelSessionManager {
    pub fn new(sink: Arc<dyn EventSink>, driver: Arc<dyn TunnelDriver>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            handles: Arc::new(RwLock::new(HashMap::new())),
            sink,
            driver,
            installing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawn a background task that downloads cloudflared to `~/.dam-hopper/bin/`.
    /// Broadcasts `install:progress`, `install:done`, or `install:failed` over WS.
    /// Returns `Err(InstallInProgress)` if an install is already running.
    pub fn start_install(&self) -> Result<(), TunnelError> {
        if self.installing.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return Err(TunnelError::InstallInProgress);
        }
        let sink = self.sink.clone();
        // Guard resets the flag on drop — handles both normal completion and panics.
        let guard = InstallGuard(self.installing.clone());
        tokio::spawn(async move {
            let _guard = guard;
            let result = TunnelInstaller::install(|downloaded, total| {
                sink.broadcast("install:progress", serde_json::json!({
                    "downloaded": downloaded,
                    "total": total,
                }));
            }).await;
            match result {
                Ok(path) => sink.broadcast("install:done", serde_json::json!({
                    "path": path.to_string_lossy(),
                })),
                Err(e) => sink.broadcast("install:failed", serde_json::json!({
                    "error": e.to_string(),
                })),
            }
        });
        Ok(())
    }

    /// Returns `(installing, installed)` for the install status endpoint.
    pub async fn install_status(&self) -> (bool, bool) {
        let installing = self.installing.load(Ordering::Acquire);
        let installed = TunnelInstaller::resolve().await.is_ok();
        (installing, installed)
    }

    /// Create a new tunnel session. Returns 409-equivalent if a session for
    /// the same port is already in Starting or Ready state.
    pub async fn create(&self, port: u16, label: String) -> Result<TunnelSession, TunnelError> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().timestamp_millis();

        let session = TunnelSession {
            id,
            port,
            label: label.clone(),
            driver: self.driver.name().to_owned(),
            status: TunnelStatus::Starting,
            url: None,
            error: None,
            started_at: now,
            pid: None,
        };

        // Hold write lock across duplicate check + insert (prevents TOCTOU race).
        {
            let mut sessions = self.sessions.write().await;
            if sessions.values().any(|s| {
                s.port == port && matches!(s.status, TunnelStatus::Starting | TunnelStatus::Ready)
            }) {
                return Err(TunnelError::DuplicatePort(port));
            }
            sessions.insert(id, session.clone());
        }

        let (event_tx, event_rx) = mpsc::channel::<TunnelDriverEvent>(16);

        let handle = match self.driver.start(port, &label, event_tx).await {
            Ok(h) => h,
            Err(e) => {
                self.sessions.write().await.remove(&id);
                return Err(e);
            }
        };

        // Update pid in map + local copy before broadcast so clients receive accurate pid.
        let pid = handle.pid;
        if let Some(p) = pid {
            let mut sessions = self.sessions.write().await;
            if let Some(s) = sessions.get_mut(&id) {
                s.pid = Some(p);
            }
        }

        self.handles.write().await.insert(id, handle);

        let mut broadcast_session = session.clone();
        broadcast_session.pid = pid;
        self.sink.broadcast(
            "tunnel:created",
            serde_json::to_value(&broadcast_session).unwrap_or_else(|e| {
                tracing::error!("tunnel:created serialization failed: {e}");
                serde_json::Value::Null
            }),
        );

        // Spawn watcher: receives driver events → mutates session + broadcasts
        tokio::spawn(watch_events(
            id,
            event_rx,
            Arc::clone(&self.sessions),
            Arc::clone(&self.handles),
            Arc::clone(&self.sink),
        ));

        Ok(session)
    }

    /// Stop a running tunnel by id. Sends stop signal; background task reaps child.
    pub async fn stop(&self, id: Uuid) -> Result<(), TunnelError> {
        let stop_tx = {
            let mut handles = self.handles.write().await;
            handles
                .remove(&id)
                .ok_or(TunnelError::NotFound(id))?
                .stop_tx
        };

        if let Some(tx) = stop_tx {
            let _ = tx.send(());
        }

        // Mark stopped + remove — watch_events Exited branch skips broadcast if gone.
        {
            let mut sessions = self.sessions.write().await;
            sessions.remove(&id);
        }

        self.sink
            .broadcast("tunnel:stopped", serde_json::json!({ "id": id }));

        Ok(())
    }

    pub async fn list(&self) -> Vec<TunnelSession> {
        self.sessions.read().await.values().cloned().collect()
    }

    /// Stop all sessions. Called on server shutdown to reap child processes.
    pub async fn dispose_all(&self) {
        let stop_txes: Vec<_> = self
            .handles
            .write()
            .await
            .drain()
            .filter_map(|(_, h)| h.stop_tx)
            .collect();

        for tx in stop_txes {
            let _ = tx.send(());
        }

        // Allow background tasks 3s to complete graceful shutdown before exiting
        tokio::time::sleep(Duration::from_secs(3)).await;

        self.sessions.write().await.clear();
    }
}

async fn watch_events(
    id: Uuid,
    mut event_rx: mpsc::Receiver<TunnelDriverEvent>,
    sessions: Arc<RwLock<HashMap<Uuid, TunnelSession>>>,
    handles: Arc<RwLock<HashMap<Uuid, DriverHandle>>>,
    sink: Arc<dyn EventSink>,
) {
    while let Some(event) = event_rx.recv().await {
        match event {
            TunnelDriverEvent::UrlReady(url) => {
                {
                    let mut s = sessions.write().await;
                    if let Some(sess) = s.get_mut(&id) {
                        sess.status = TunnelStatus::Ready;
                        sess.url = Some(url.clone());
                    }
                }
                sink.broadcast(
                    "tunnel:ready",
                    serde_json::json!({ "id": id, "url": url }),
                );
            }
            TunnelDriverEvent::Failed(msg) => {
                {
                    let mut s = sessions.write().await;
                    if let Some(sess) = s.get_mut(&id) {
                        sess.status = TunnelStatus::Failed;
                        sess.error = Some(msg.clone());
                    }
                }
                sink.broadcast(
                    "tunnel:failed",
                    serde_json::json!({ "id": id, "error": msg }),
                );
                // Sessions are ephemeral — removed after terminal state.
                // Clients receive the event; REST list won't return failed sessions.
                break;
            }
            TunnelDriverEvent::Exited => {
                // Only broadcast tunnel:stopped if stop() hasn't already removed+broadcast it.
                let should_broadcast = {
                    let mut s = sessions.write().await;
                    if let Some(sess) = s.get_mut(&id) {
                        if matches!(sess.status, TunnelStatus::Starting | TunnelStatus::Ready) {
                            sess.status = TunnelStatus::Stopped;
                            true
                        } else {
                            false
                        }
                    } else {
                        false // already removed by stop()
                    }
                };
                if should_broadcast {
                    sink.broadcast("tunnel:stopped", serde_json::json!({ "id": id }));
                }
                break;
            }
        }
    }

    // Cleanup orphaned entries; stop() may have already removed them — that is fine.
    sessions.write().await.remove(&id);
    handles.write().await.remove(&id);
}
