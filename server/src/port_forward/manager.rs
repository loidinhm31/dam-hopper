use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;

use crate::persistence::SessionStore;
use crate::port_forward::detector::port_is_safe;
use crate::pty::EventSink;
use crate::tunnel::TunnelSessionManager;

use super::session::{DetectedPort, DetectedVia, PortState};

/// Maximum number of ports tracked at once to prevent unbounded memory growth.
const MAX_TRACKED_PORTS: usize = 100;
const SEEDED_PORT_GRACE: Duration = Duration::from_secs(10);

/// In-memory registry of ports detected in active PTY sessions.
///
/// `Clone` is cheap — backed by `Arc`.
#[derive(Clone)]
pub struct PortForwardManager {
    ports: Arc<RwLock<HashMap<u16, DetectedPort>>>,
    sink: Arc<dyn EventSink>,
    tunnel_manager: Option<TunnelSessionManager>,
    session_store: Option<Arc<SessionStore>>,
}

impl PortForwardManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            ports: Arc::new(RwLock::new(HashMap::new())),
            sink,
            tunnel_manager: None,
            session_store: None,
        }
    }

    pub fn with_tunnel_manager(mut self, tunnel_manager: TunnelSessionManager) -> Self {
        self.tunnel_manager = Some(tunnel_manager);
        self
    }

    pub fn with_session_store(mut self, session_store: Option<Arc<SessionStore>>) -> Self {
        self.session_store = session_store;
        self
    }

    /// Called when stdout regex fires: inserts Provisional entry and broadcasts
    /// `port:discovered`. No-op if the port is already tracked.
    pub async fn report_stdout_hit(&self, port: u16, session_id: String, project: Option<String>) {
        // ... (rest of method unchanged)
        // Capture broadcast payload while holding the write lock, then release
        // before broadcasting (I/O) to avoid blocking readers.
        let maybe_payload = {
            let mut ports = self.ports.write().await;
            if ports.contains_key(&port) {
                return;
            }
            if ports.len() >= MAX_TRACKED_PORTS {
                tracing::warn!(
                    port,
                    "Port tracking limit ({MAX_TRACKED_PORTS}) reached — ignoring"
                );
                return;
            }
            let entry = DetectedPort::new_provisional(port, session_id.clone(), project.clone());
            let payload = serde_json::json!({
                "port": entry.port,
                "session_id": &session_id,
                "project": &project,
                "detected_via": "stdout_regex",
                "state": "provisional",
            });
            ports.insert(port, entry);
            Some(payload)
        }; // write lock released

        if let Some(store) = &self.session_store {
            if let Err(error) = store.save_detected_port(&session_id, port, project.as_deref()) {
                tracing::warn!(
                    port,
                    session_id,
                    %error,
                    "Failed to persist detected port"
                );
            }
        }

        if let Some(payload) = maybe_payload {
            self.sink.broadcast("port:discovered", payload);
        }
    }

    /// Called by proc poller: upgrades Provisional → Listening.
    /// Broadcasts `port:discovered` again with updated state if it was previously provisional.
    pub async fn confirm_listen(&self, port: u16) {
        let maybe_payload = {
            let mut ports = self.ports.write().await;
            if let Some(entry) = ports.get_mut(&port) {
                if entry.state == PortState::Provisional {
                    entry.state = PortState::Listening;
                    entry.detected_via = DetectedVia::ProcNet;
                    entry.provisional_until = None;
                    let payload = serde_json::json!({
                        "port": entry.port,
                        "session_id": &entry.session_id,
                        "project": &entry.project,
                        "detected_via": "proc_net",
                        "state": "listening",
                    });
                    Some(payload)
                } else {
                    None
                }
            } else {
                None
            }
        }; // write lock released

        if let Some(payload) = maybe_payload {
            self.sink.broadcast("port:discovered", payload);
        }
    }

    /// Called by proc poller when a port disappears from /proc/net/tcp.
    /// Broadcasts `port:lost` and removes the entry from the map.
    pub async fn report_lost(&self, port: u16) {
        let maybe_payload = {
            let mut ports = self.ports.write().await;
            if ports
                .get(&port)
                .map(|entry| entry.state == PortState::Provisional && entry.is_in_grace())
                .unwrap_or(false)
            {
                return;
            }
            ports.remove(&port).map(|entry| {
                if let Some(store) = &self.session_store {
                    if let Err(error) = store.delete_detected_port(&entry.session_id, entry.port) {
                        tracing::warn!(
                            port = entry.port,
                            session_id = %entry.session_id,
                            %error,
                            "Failed to delete lost detected port"
                        );
                    }
                }
                serde_json::json!({
                    "port": entry.port,
                    "session_id": entry.session_id,
                })
            })
        }; // write lock released

        if let Some(payload) = maybe_payload {
            self.sink.broadcast("port:lost", payload);

            // Auto-cleanup tunnel if it exists for this port
            if let Some(tm) = &self.tunnel_manager {
                tm.stop_by_port(port).await;
            }
        }
    }

    /// Returns a snapshot of all currently tracked ports.
    pub async fn list(&self) -> Vec<DetectedPort> {
        let ports = self.ports.read().await;
        ports.values().cloned().collect()
    }

    /// Returns `true` if the port is tracked and in Listening state.
    pub async fn is_listening(&self, port: u16) -> bool {
        let ports = self.ports.read().await;
        ports
            .get(&port)
            .map(|e| e.state == PortState::Listening)
            .unwrap_or(false)
    }

    pub async fn seed_persisted_candidates(&self, live_session_ids: &[String]) -> usize {
        let Some(store) = &self.session_store else {
            return 0;
        };
        let live = live_session_ids
            .iter()
            .collect::<std::collections::HashSet<_>>();
        let persisted = match store.load_detected_ports() {
            Ok(ports) => ports,
            Err(error) => {
                tracing::warn!(%error, "Failed to load persisted detected ports");
                return 0;
            }
        };

        let mut seeded = 0;
        let mut ports = self.ports.write().await;
        for entry in persisted {
            if seeded >= MAX_TRACKED_PORTS || ports.len() >= MAX_TRACKED_PORTS {
                break;
            }
            if !live.contains(&entry.session_id) || !port_is_safe(entry.port) {
                if let Err(error) = store.delete_detected_port(&entry.session_id, entry.port) {
                    tracing::warn!(
                        port = entry.port,
                        session_id = %entry.session_id,
                        %error,
                        "Failed to prune stale persisted port"
                    );
                }
                continue;
            }
            ports.entry(entry.port).or_insert_with(|| {
                seeded += 1;
                DetectedPort::new_seeded_provisional(
                    entry.port,
                    entry.session_id,
                    entry.project,
                    SEEDED_PORT_GRACE,
                )
            });
        }
        seeded
    }

    pub async fn remove_session_ports(&self, session_id: &str) {
        let removed = {
            let mut ports = self.ports.write().await;
            let matching = ports
                .iter()
                .filter_map(|(port, entry)| (entry.session_id == session_id).then_some(*port))
                .collect::<Vec<_>>();
            for port in &matching {
                ports.remove(port);
            }
            matching
        };

        if let Some(store) = &self.session_store {
            if let Err(error) = store.delete_detected_ports_for_session(session_id) {
                tracing::warn!(
                    session_id,
                    %error,
                    "Failed to delete persisted ports for removed session"
                );
            }
        }

        for port in removed {
            self.sink.broadcast(
                "port:lost",
                serde_json::json!({
                    "port": port,
                    "session_id": session_id,
                }),
            );
            if let Some(tm) = &self.tunnel_manager {
                tm.stop_by_port(port).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::event_sink::NoopEventSink;
    use std::time::Instant;
    use tempfile::NamedTempFile;

    fn manager_with_store() -> (PortForwardManager, Arc<SessionStore>, NamedTempFile) {
        let temp = NamedTempFile::new().unwrap();
        let store = Arc::new(SessionStore::open(temp.path()).unwrap());
        let manager = PortForwardManager::new(Arc::new(NoopEventSink))
            .with_session_store(Some(store.clone()));
        (manager, store, temp)
    }

    #[tokio::test]
    async fn stdout_hits_are_persisted_and_lost_ports_are_deleted() {
        let (manager, store, _temp) = manager_with_store();

        manager
            .report_stdout_hit(5173, "session-a".to_string(), Some("web".to_string()))
            .await;
        assert_eq!(store.load_detected_ports().unwrap().len(), 1);

        manager.report_lost(5173).await;
        assert!(store.load_detected_ports().unwrap().is_empty());
    }

    #[tokio::test]
    async fn persisted_ports_seed_with_grace_then_expire() {
        let (manager, store, _temp) = manager_with_store();
        store
            .save_detected_port("session-a", 5173, Some("web"))
            .unwrap();

        let seeded = manager
            .seed_persisted_candidates(&["session-a".to_string()])
            .await;
        assert_eq!(seeded, 1);
        assert_eq!(manager.list().await.len(), 1);

        manager.report_lost(5173).await;
        assert_eq!(
            manager.list().await.len(),
            1,
            "seeded port should survive grace miss"
        );

        {
            let mut ports = manager.ports.write().await;
            ports.get_mut(&5173).unwrap().provisional_until = Some(Instant::now());
        }
        manager.report_lost(5173).await;
        assert!(manager.list().await.is_empty());
        assert!(store.load_detected_ports().unwrap().is_empty());
    }
}
