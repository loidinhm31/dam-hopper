use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::pty::EventSink;
use crate::tunnel::TunnelSessionManager;

use super::session::{DetectedPort, PortState};

/// Maximum number of ports tracked at once to prevent unbounded memory growth.
const MAX_TRACKED_PORTS: usize = 100;

/// In-memory registry of ports detected in active PTY sessions.
///
/// `Clone` is cheap — backed by `Arc`.
#[derive(Clone)]
pub struct PortForwardManager {
    ports: Arc<RwLock<HashMap<u16, DetectedPort>>>,
    sink: Arc<dyn EventSink>,
    tunnel_manager: Option<TunnelSessionManager>,
}

impl PortForwardManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            ports: Arc::new(RwLock::new(HashMap::new())),
            sink,
            tunnel_manager: None,
        }
    }

    pub fn with_tunnel_manager(mut self, tunnel_manager: TunnelSessionManager) -> Self {
        self.tunnel_manager = Some(tunnel_manager);
        self
    }

    /// Called when stdout regex fires: inserts Provisional entry and broadcasts
    /// `port:discovered`. No-op if the port is already tracked.
    pub async fn report_stdout_hit(
        &self,
        port: u16,
        session_id: String,
        project: Option<String>,
    ) {
        // ... (rest of method unchanged)
        // Capture broadcast payload while holding the write lock, then release
        // before broadcasting (I/O) to avoid blocking readers.
        let maybe_payload = {
            let mut ports = self.ports.write().await;
            if ports.contains_key(&port) {
                return;
            }
            if ports.len() >= MAX_TRACKED_PORTS {
                tracing::warn!(port, "Port tracking limit ({MAX_TRACKED_PORTS}) reached — ignoring");
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
            ports.remove(&port).map(|entry| {
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
        ports.get(&port).map(|e| e.state == PortState::Listening).unwrap_or(false)
    }
}
