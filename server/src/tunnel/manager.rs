use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot, Notify, RwLock};
use tokio::time::Instant;
use uuid::Uuid;

use crate::pty::EventSink;

use super::{
    driver::{TunnelDriver, TunnelDriverEvent},
    error::TunnelError,
    installer::TunnelInstaller,
    session::{TunnelSession, TunnelStatus},
};

const REMINDER_DELAY: Duration = Duration::from_secs(3 * 60 * 60);

struct TunnelHandle {
    stop_tx: Option<oneshot::Sender<()>>,
    // Dropping the handle cancels the watcher even if the driver keeps its
    // event channel open during shutdown.
    _cancel_watcher: oneshot::Sender<()>,
}

/// Resets the `installing` flag on drop — ensures cleanup even on task panic.
struct InstallGuard(Arc<AtomicBool>);
impl Drop for InstallGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct TunnelStartGuard {
    count: Arc<AtomicUsize>,
    completed: Arc<Notify>,
}

impl Drop for TunnelStartGuard {
    fn drop(&mut self) {
        self.count.fetch_sub(1, Ordering::AcqRel);
        self.completed.notify_waiters();
    }
}

#[derive(Clone)]
pub struct TunnelSessionManager {
    sessions: Arc<RwLock<HashMap<Uuid, TunnelSession>>>,
    handles: Arc<RwLock<HashMap<Uuid, TunnelHandle>>>,
    /// Stop requests that won the race while a Starting driver had not yet
    /// returned its handle. The creator consumes the marker and terminates
    /// the returned driver instead of publishing an orphaned session.
    pending_stops: Arc<RwLock<HashSet<Uuid>>>,
    lifecycle_gate: Arc<tokio::sync::Mutex<()>>,
    in_flight_starts: Arc<AtomicUsize>,
    starts_completed: Arc<Notify>,
    disposing: Arc<AtomicBool>,
    sink: Arc<dyn EventSink>,
    driver: Arc<dyn TunnelDriver>,
    installing: Arc<AtomicBool>,
}

impl TunnelSessionManager {
    pub fn new(sink: Arc<dyn EventSink>, driver: Arc<dyn TunnelDriver>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            handles: Arc::new(RwLock::new(HashMap::new())),
            pending_stops: Arc::new(RwLock::new(HashSet::new())),
            lifecycle_gate: Arc::new(tokio::sync::Mutex::new(())),
            in_flight_starts: Arc::new(AtomicUsize::new(0)),
            starts_completed: Arc::new(Notify::new()),
            disposing: Arc::new(AtomicBool::new(false)),
            sink,
            driver,
            installing: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawn a background task that downloads cloudflared to `~/.dam-hopper/bin/`.
    /// Broadcasts `install:progress`, `install:done`, or `install:failed` over WS.
    /// Returns `Err(InstallInProgress)` if an install is already running.
    pub fn start_install(&self) -> Result<(), TunnelError> {
        if self
            .installing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(TunnelError::InstallInProgress);
        }
        let sink = self.sink.clone();
        // Guard resets the flag on drop — handles both normal completion and panics.
        let guard = InstallGuard(self.installing.clone());
        tokio::spawn(async move {
            let _guard = guard;
            let result = TunnelInstaller::install(|downloaded, total| {
                sink.broadcast(
                    "install:progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": total,
                    }),
                );
            })
            .await;
            match result {
                Ok(path) => sink.broadcast(
                    "install:done",
                    serde_json::json!({
                        "path": path.to_string_lossy(),
                    }),
                ),
                Err(e) => sink.broadcast(
                    "install:failed",
                    serde_json::json!({
                        "error": e.to_string(),
                    }),
                ),
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
        let reminder_deadline = Instant::now() + REMINDER_DELAY;

        let session = TunnelSession {
            id,
            port,
            label: label.clone(),
            driver: self.driver.name().to_owned(),
            status: TunnelStatus::Starting,
            url: None,
            error: None,
            started_at: now,
            reminder_due: false,
            pid: None,
        };

        // Admission, the in-flight-start count, and the initial session insert
        // share a lifecycle gate so shutdown cannot snapshot an ID before its
        // creator has registered it for cancellation.
        let _start_guard = {
            let _lifecycle = self.lifecycle_gate.lock().await;
            if self.disposing.load(Ordering::Acquire) {
                return Err(TunnelError::CreationCancelled);
            }
            self.in_flight_starts.fetch_add(1, Ordering::AcqRel);
            let start_guard = TunnelStartGuard {
                count: Arc::clone(&self.in_flight_starts),
                completed: Arc::clone(&self.starts_completed),
            };
            let mut sessions = self.sessions.write().await;
            if sessions.values().any(|s| {
                s.port == port && matches!(s.status, TunnelStatus::Starting | TunnelStatus::Ready)
            }) {
                return Err(TunnelError::DuplicatePort(port));
            }
            sessions.insert(id, session.clone());
            start_guard
        };

        let (event_tx, event_rx) = mpsc::channel::<TunnelDriverEvent>(16);

        let handle = match self.driver.start(port, &label, event_tx).await {
            Ok(h) => h,
            Err(e) => {
                let mut pending_stops = self.pending_stops.write().await;
                pending_stops.remove(&id);
                self.sessions.write().await.remove(&id);
                return Err(e);
            }
        };

        let pid = handle.pid;
        let mut pending_stops = self.pending_stops.write().await;
        if pending_stops.remove(&id) {
            let stop_tx = handle.stop_tx;
            self.sessions.write().await.remove(&id);
            drop(pending_stops);
            if let Some(tx) = stop_tx {
                let _ = tx.send(());
            }
            return Err(TunnelError::CreationCancelled);
        }

        // Install the handle while the pending-stop marker is held. A stop
        // request can then either observe this handle or leave a marker that
        // the next creator check consumes, but never miss the Starting window.
        let (cancel_watcher, watcher_cancelled) = oneshot::channel();
        self.handles.write().await.insert(
            id,
            TunnelHandle {
                stop_tx: handle.stop_tx,
                _cancel_watcher: cancel_watcher,
            },
        );

        // Update pid in map + local copy before broadcast so clients receive accurate pid.
        if let Some(p) = pid {
            let mut sessions = self.sessions.write().await;
            if let Some(s) = sessions.get_mut(&id) {
                s.pid = Some(p);
            }
        }
        let mut broadcast_session = session.clone();
        broadcast_session.pid = pid;
        self.sink.broadcast(
            "tunnel:created",
            serde_json::to_value(&broadcast_session).unwrap_or_else(|e| {
                tracing::error!("tunnel:created serialization failed: {e}");
                serde_json::Value::Null
            }),
        );
        drop(pending_stops);

        // Spawn watcher: receives driver events → mutates session + broadcasts
        tokio::spawn(watch_events(
            id,
            event_rx,
            watcher_cancelled,
            reminder_deadline,
            Arc::clone(&self.sessions),
            Arc::clone(&self.handles),
            Arc::clone(&self.sink),
        ));

        Ok(session)
    }

    /// Stop a running tunnel by id. Sends stop signal; background task reaps child.
    pub async fn stop(&self, id: Uuid) -> Result<(), TunnelError> {
        let mut pending_stops = self.pending_stops.write().await;
        let (had_handle, stop_tx) = {
            let mut handles = self.handles.write().await;
            match handles.remove(&id) {
                Some(handle) => (true, handle.stop_tx),
                None => (false, None),
            }
        };

        let removed_session = self.sessions.write().await.remove(&id).is_some();
        if !removed_session && !had_handle {
            if pending_stops.contains(&id) {
                // Another cleanup request already removed this Starting
                // session and owns cancellation of the driver handle that is
                // still being constructed.
                return Ok(());
            }
            return Err(TunnelError::NotFound(id));
        }

        // A Starting session has no handle yet. Keep this marker until
        // create() receives the driver handle and stops it.
        if !had_handle && removed_session {
            pending_stops.insert(id);
        } else {
            pending_stops.remove(&id);
        }

        drop(pending_stops);

        if let Some(tx) = stop_tx {
            let _ = tx.send(());
        }

        if removed_session {
            self.sink
                .broadcast("tunnel:stopped", serde_json::json!({ "id": id }));
        }

        Ok(())
    }

    pub async fn list(&self) -> Vec<TunnelSession> {
        self.sessions.read().await.values().cloned().collect()
    }

    /// Stop all sessions. Called on server shutdown to reap child processes.
    pub async fn dispose_all(&self) {
        {
            let _lifecycle = self.lifecycle_gate.lock().await;
            self.disposing.store(true, Ordering::Release);
        }

        let had_in_flight_starts = self.in_flight_starts.load(Ordering::Acquire) > 0;
        let mut pending_stops = self.pending_stops.write().await;
        let handle_ids: HashSet<Uuid> = self.handles.read().await.keys().copied().collect();
        let mut sessions = self.sessions.write().await;
        for id in sessions.keys() {
            if !handle_ids.contains(id) {
                pending_stops.insert(*id);
            }
        }
        sessions.clear();
        drop(sessions);

        let mut handles = self.handles.write().await;
        let stop_txes: Vec<_> = handles.drain().filter_map(|(_, h)| h.stop_tx).collect();
        drop(handles);
        drop(pending_stops);
        let has_stoppable_sessions = !stop_txes.is_empty() || had_in_flight_starts;

        for tx in stop_txes {
            let _ = tx.send(());
        }

        // A driver may still be inside start(). Wait until its creator has
        // consumed the pending-stop marker and delivered the returned handle's
        // stop signal before allowing shutdown to finish.
        loop {
            let completed = self.starts_completed.notified();
            if self.in_flight_starts.load(Ordering::Acquire) == 0 {
                break;
            }
            completed.await;
        }
        self.pending_stops.write().await.clear();

        // Fresh servers have no child processes to reap; do not spend the
        // shutdown grace period waiting for work that was never started.
        if has_stoppable_sessions {
            tokio::time::sleep(Duration::from_secs(3)).await;
        }

        self.sessions.write().await.clear();
    }
}

async fn watch_events(
    id: Uuid,
    mut event_rx: mpsc::Receiver<TunnelDriverEvent>,
    mut cancelled: oneshot::Receiver<()>,
    reminder_deadline: Instant,
    sessions: Arc<RwLock<HashMap<Uuid, TunnelSession>>>,
    handles: Arc<RwLock<HashMap<Uuid, TunnelHandle>>>,
    sink: Arc<dyn EventSink>,
) {
    let deadline = tokio::time::sleep_until(reminder_deadline);
    tokio::pin!(deadline);
    let mut deadline_elapsed = false;
    loop {
        // Cancellation and queued terminal events win over a simultaneous
        // deadline. The timer belongs to this watcher, not a detached task.
        let event = tokio::select! {
            biased;
            // The caller dropping the handle owns registry cleanup.
            _ = &mut cancelled => return,
            event = event_rx.recv() => event,
            _ = &mut deadline, if !deadline_elapsed => {
                deadline_elapsed = true;
                None
            }
        };
        let mut active = sessions.write().await;
        let Some(session) = active.get_mut(&id) else {
            break;
        };
        match event {
            Some(TunnelDriverEvent::UrlReady(url)) => {
                session.status = TunnelStatus::Ready;
                session.url = Some(url.clone());
                sink.broadcast("tunnel:ready", serde_json::json!({ "id": id, "url": url }));
            }
            Some(TunnelDriverEvent::Failed(error)) => {
                active.remove(&id);
                sink.broadcast(
                    "tunnel:failed",
                    serde_json::json!({ "id": id, "error": error }),
                );
                break;
            }
            Some(TunnelDriverEvent::Exited) => {
                active.remove(&id);
                sink.broadcast("tunnel:stopped", serde_json::json!({ "id": id }));
                break;
            }
            None if event_rx.is_closed() && event_rx.is_empty() => {
                active.remove(&id);
                sink.broadcast("tunnel:stopped", serde_json::json!({ "id": id }));
                break;
            }
            None => {}
        }
        if session.status == TunnelStatus::Ready && !session.reminder_due && deadline_elapsed {
            session.reminder_due = true;
            // Keep transition + broadcast under the session lock: stop/dispose
            // cannot remove the session and then receive a late reminder.
            sink.broadcast("tunnel:reminder", serde_json::json!({ "id": id }));
        }
    }

    // stop()/dispose_all() may already have removed these entries.
    handles.write().await.remove(&id);
    sessions.write().await.remove(&id);
}
