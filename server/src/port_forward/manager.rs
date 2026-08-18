use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, RwLock,
};
use std::time::Duration;

use crate::persistence::SessionStore;
use crate::port_forward::detector::port_is_safe;
use crate::pty::EventSink;
use crate::tunnel::TunnelSessionManager;
use uuid::Uuid;

use super::session::{DetectedPort, DetectedVia, PortState};

/// Maximum number of ports tracked at once to prevent unbounded memory growth.
const MAX_TRACKED_PORTS: usize = 100;
const SEEDED_PORT_GRACE: Duration = Duration::from_secs(10);

#[derive(Clone, Copy)]
struct OwnerlessTunnelPort {
    port: u16,
    observed_listen: bool,
}

/// In-memory registry of ports detected in active PTY sessions.
///
/// `Clone` is cheap — backed by `Arc`.
#[derive(Clone)]
pub struct PortForwardManager {
    ports: Arc<RwLock<HashMap<u16, DetectedPort>>>,
    /// Ownerless tunnel ports awaiting their first listening observation.
    /// Entries are synchronized from the tunnel manager by the proc poller.
    ownerless_tunnel_ports: Arc<RwLock<HashMap<Uuid, OwnerlessTunnelPort>>>,
    /// Concrete PTY identities that are currently allowed to report stdout.
    /// The registry is enabled by production wiring; direct unit-test managers
    /// keep the legacy open reporting behavior unless they opt in.
    active_sessions: Arc<RwLock<HashMap<String, u64>>>,
    session_validation_enabled: Arc<AtomicBool>,
    sink: Arc<dyn EventSink>,
    tunnel_manager: Option<TunnelSessionManager>,
    session_store: Option<Arc<SessionStore>>,
}

impl PortForwardManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            ports: Arc::new(RwLock::new(HashMap::new())),
            ownerless_tunnel_ports: Arc::new(RwLock::new(HashMap::new())),
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
            session_validation_enabled: Arc::new(AtomicBool::new(false)),
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

    /// Synchronize the loss monitor with currently registered ownerless
    /// tunnels. A tunnel must be observed listening once before a missing
    /// port is treated as a loss; this avoids stopping a tunnel while its
    /// driver is still starting.
    pub async fn sync_ownerless_tunnel_ports(&self) {
        let Some(tunnel_manager) = &self.tunnel_manager else {
            return;
        };
        let active_ports: HashMap<Uuid, u16> = tunnel_manager
            .list()
            .await
            .into_iter()
            .filter(|session| session.session_id.is_none())
            .map(|session| (session.id, session.port))
            .collect();
        let mut tracked = self.ownerless_tunnel_ports.write().unwrap();
        tracked.retain(|id, _| active_ports.contains_key(id));
        for (id, port) in active_ports {
            tracked.entry(id).or_insert(OwnerlessTunnelPort {
                port,
                observed_listen: false,
            });
        }
    }

    pub async fn ownerless_tunnel_ports(&self) -> Vec<(Uuid, u16, bool)> {
        self.ownerless_tunnel_ports
            .read()
            .unwrap()
            .iter()
            .map(|(id, state)| (*id, state.port, state.observed_listen))
            .collect()
    }

    pub async fn confirm_ownerless_tunnel_listen(&self, id: Uuid, port: u16) {
        if let Some(state) = self.ownerless_tunnel_ports.write().unwrap().get_mut(&id) {
            if state.port == port {
                state.observed_listen = true;
            }
        }
    }

    pub async fn report_ownerless_tunnel_lost(&self, id: Uuid, port: u16) {
        let tracked = self
            .ownerless_tunnel_ports
            .read()
            .unwrap()
            .get(&id)
            .is_some_and(|state| state.port == port);
        if tracked {
            self.ownerless_tunnel_ports.write().unwrap().remove(&id);
            if let Some(tunnel_manager) = &self.tunnel_manager {
                if let Err(error) = tunnel_manager.stop(id).await {
                    tracing::debug!(%error, %id, port, "Ownerless tunnel already stopped");
                }
            }
        }
    }

    /// Enables fail-closed stdout ownership checks for production PTY readers.
    pub fn enable_session_validation(&self) {
        self.session_validation_enabled
            .store(true, Ordering::Release);
    }

    /// Registers a concrete PTY incarnation as the current stdout producer.
    pub fn register_session(&self, session_id: &str, incarnation: u64) {
        let mut active_sessions = self.active_sessions.write().unwrap();
        let should_replace = active_sessions
            .get(session_id)
            .map(|current| incarnation >= *current)
            .unwrap_or(true);
        if should_replace {
            active_sessions.insert(session_id.to_string(), incarnation);
        }
    }

    /// Removes a producer only if it still owns the public session id. An old
    /// reader must not unregister a newer replacement. Port state is cleaned
    /// by concrete incarnation as well, so replacement/EOF cannot leave stale
    /// API, SQLite, or tunnel-owner entries behind.
    pub fn unregister_session(&self, session_id: &str, incarnation: u64) {
        self.unregister_session_with_runtime(session_id, incarnation, None);
    }

    /// Synchronous lifecycle callers can provide the Tokio handle captured by
    /// a PTY reader so tunnel cleanup is still scheduled off the reader thread.
    pub fn unregister_session_with_runtime(
        &self,
        session_id: &str,
        incarnation: u64,
        runtime: Option<&tokio::runtime::Handle>,
    ) {
        {
            let mut active_sessions = self.active_sessions.write().unwrap();
            if active_sessions.get(session_id).copied() == Some(incarnation) {
                active_sessions.remove(session_id);
            }
        }

        let removed = self.remove_session_ports_sync(session_id, incarnation);
        self.schedule_tunnel_cleanup(session_id, removed, runtime);
    }

    /// Called when stdout regex fires: inserts Provisional entry and broadcasts
    /// `port:discovered`. A newer owner replaces an older entry for the same
    /// numeric port so reused ports follow the concrete PTY incarnation.
    pub async fn report_stdout_hit(
        &self,
        port: u16,
        session_id: String,
        incarnation: u64,
        project: Option<String>,
    ) {
        // Hold the active-session read lock across the port-map mutation. This
        // makes replacement/removal and stale stdout reports a single ordered
        // ownership decision: an old reader cannot pass validation and then
        // insert after its identity has been replaced or removed.
        // Capture broadcast payload while holding the write lock, then release
        // before broadcasting (I/O) to avoid blocking readers.
        let _active_sessions = if self.session_validation_enabled.load(Ordering::Acquire) {
            let active_sessions = self.active_sessions.read().unwrap();
            if active_sessions.get(&session_id).copied() != Some(incarnation) {
                return;
            }
            Some(active_sessions)
        } else {
            None
        };
        let (maybe_payload, replaced_owner) = {
            let mut ports = self.ports.write().unwrap();
            if ports.get(&port).is_some_and(|entry| {
                entry.session_id == session_id && entry.incarnation == incarnation
            }) {
                return;
            }
            if ports.len() >= MAX_TRACKED_PORTS && !ports.contains_key(&port) {
                tracing::warn!(
                    port,
                    "Port tracking limit ({MAX_TRACKED_PORTS}) reached — ignoring"
                );
                return;
            }
            let entry = DetectedPort::new_provisional(
                port,
                session_id.clone(),
                incarnation,
                project.clone(),
            );
            let payload = serde_json::json!({
                "port": entry.port,
                "session_id": &session_id,
                "incarnation": incarnation,
                "project": &project,
                "detected_via": "stdout_regex",
                "state": "provisional",
            });
            let replaced_owner = ports
                .insert(port, entry)
                .map(|previous| (previous.session_id, previous.incarnation));

            if let Some(store) = &self.session_store {
                if let Some((old_session_id, old_incarnation)) = &replaced_owner {
                    if let Err(error) =
                        store.delete_detected_port(old_session_id, *old_incarnation, port)
                    {
                        tracing::warn!(
                            port,
                            session_id = %old_session_id,
                            %error,
                            "Failed to delete replaced detected port"
                        );
                    }
                }
                if let Err(error) =
                    store.save_detected_port(&session_id, incarnation, port, project.as_deref())
                {
                    tracing::warn!(
                        port,
                        session_id,
                        %error,
                        "Failed to persist detected port"
                    );
                }
            }
            (Some(payload), replaced_owner)
        }; // write lock released

        // The active-session read lock also serializes lifecycle unregister
        // with this map/persistence transaction. If a reader wins first,
        // cleanup waits until the save completes and then deletes the exact
        // incarnation; if cleanup wins first, validation cannot pass.
        drop(_active_sessions);

        if let Some(payload) = maybe_payload {
            self.sink.broadcast("port:discovered", payload);
            if let (Some(tm), Some((old_session_id, old_incarnation))) =
                (&self.tunnel_manager, replaced_owner)
            {
                tm.stop_by_port_for_owner(port, &old_session_id, old_incarnation)
                    .await;
            }
        }
    }

    /// Called by proc poller: upgrades Provisional → Listening.
    /// Broadcasts `port:discovered` again with updated state if it was previously provisional.
    pub async fn confirm_listen(&self, port: u16, incarnation: u64) {
        let maybe_payload = {
            let mut ports = self.ports.write().unwrap();
            if let Some(entry) = ports.get_mut(&port) {
                if entry.incarnation != incarnation {
                    return;
                }
                if entry.state == PortState::Provisional {
                    entry.state = PortState::Listening;
                    entry.detected_via = DetectedVia::ProcNet;
                    entry.provisional_until = None;
                    let payload = serde_json::json!({
                        "port": entry.port,
                        "session_id": &entry.session_id,
                        "incarnation": entry.incarnation,
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
    pub async fn report_lost(&self, port: u16, incarnation: u64) {
        let maybe_lost = {
            let mut ports = self.ports.write().unwrap();
            if ports
                .get(&port)
                .map(|entry| entry.incarnation != incarnation)
                .unwrap_or(true)
            {
                return;
            }
            if ports
                .get(&port)
                .map(|entry| entry.state == PortState::Provisional && entry.is_in_grace())
                .unwrap_or(false)
            {
                return;
            }
            ports.remove(&port).map(|entry| {
                if let Some(store) = &self.session_store {
                    if let Err(error) =
                        store.delete_detected_port(&entry.session_id, entry.incarnation, entry.port)
                    {
                        tracing::warn!(
                            port = entry.port,
                            session_id = %entry.session_id,
                            %error,
                            "Failed to delete lost detected port"
                        );
                    }
                }
                let owner = (entry.session_id.clone(), entry.incarnation);
                (
                    serde_json::json!({
                        "port": entry.port,
                        "session_id": &entry.session_id,
                        "incarnation": entry.incarnation,
                    }),
                    owner,
                )
            })
        }; // write lock released

        if let Some((payload, (owner_session_id, owner_incarnation))) = maybe_lost {
            self.sink.broadcast("port:lost", payload);

            // Auto-cleanup tunnel if it exists for this port
            if let Some(tm) = &self.tunnel_manager {
                tm.stop_by_port_for_owner(port, &owner_session_id, owner_incarnation)
                    .await;
                // Also clean up legacy/manual tunnels that have no PTY owner.
                tm.stop_by_port(port).await;
            }
        }
    }

    /// Returns a snapshot of all currently tracked ports.
    pub async fn list(&self) -> Vec<DetectedPort> {
        let ports = self.ports.read().unwrap();
        ports.values().cloned().collect()
    }

    /// Returns `true` if the port is tracked and in Listening state.
    pub async fn is_listening(&self, port: u16) -> bool {
        let ports = self.ports.read().unwrap();
        ports
            .get(&port)
            .map(|e| e.state == PortState::Listening)
            .unwrap_or(false)
    }

    pub async fn seed_persisted_candidates(&self, live_sessions: &[(String, u64)]) -> usize {
        let Some(store) = &self.session_store else {
            return 0;
        };
        let live = live_sessions
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
        let mut ports = self.ports.write().unwrap();
        for entry in persisted {
            if seeded >= MAX_TRACKED_PORTS || ports.len() >= MAX_TRACKED_PORTS {
                break;
            }
            if !live.contains(&(entry.session_id.clone(), entry.incarnation))
                || !port_is_safe(entry.port)
            {
                if let Err(error) =
                    store.delete_detected_port(&entry.session_id, entry.incarnation, entry.port)
                {
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
                    entry.incarnation,
                    entry.project,
                    SEEDED_PORT_GRACE,
                )
            });
        }
        seeded
    }

    fn remove_session_ports_sync(&self, session_id: &str, incarnation: u64) -> Vec<(u16, u64)> {
        let removed = {
            let mut ports = self.ports.write().unwrap();
            let matching = ports
                .iter()
                .filter_map(|(port, entry)| {
                    (entry.session_id == session_id && entry.incarnation == incarnation)
                        .then_some((*port, entry.incarnation))
                })
                .collect::<Vec<_>>();
            for (port, _) in &matching {
                ports.remove(port);
            }
            if let Some(store) = &self.session_store {
                if let Err(error) = store.delete_detected_ports_for_session(session_id, incarnation)
                {
                    tracing::warn!(
                        session_id,
                        %error,
                        "Failed to delete persisted ports for removed session"
                    );
                }
            }
            matching
        };

        for (port, entry_incarnation) in &removed {
            self.sink.broadcast(
                "port:lost",
                serde_json::json!({
                    "port": *port,
                    "session_id": session_id,
                    "incarnation": *entry_incarnation,
                }),
            );
        }

        removed
    }

    pub async fn remove_session_ports(&self, session_id: &str, incarnation: u64) {
        let removed = self.remove_session_ports_sync(session_id, incarnation);
        self.stop_removed_tunnels(session_id, &removed).await;
    }

    async fn stop_removed_tunnels(&self, session_id: &str, removed: &[(u16, u64)]) {
        if let Some(tm) = &self.tunnel_manager {
            for (port, entry_incarnation) in removed {
                tm.stop_by_port_for_owner(port.to_owned(), session_id, *entry_incarnation)
                    .await;
                tm.stop_by_port(*port).await;
            }
        }
    }

    fn schedule_tunnel_cleanup(
        &self,
        session_id: &str,
        removed: Vec<(u16, u64)>,
        runtime: Option<&tokio::runtime::Handle>,
    ) {
        let Some(tm) = self.tunnel_manager.clone() else {
            return;
        };
        let Some(handle) = runtime
            .cloned()
            .or_else(|| tokio::runtime::Handle::try_current().ok())
        else {
            return;
        };
        let session_id = session_id.to_string();
        for (port, entry_incarnation) in removed {
            let tm = tm.clone();
            let session_id = session_id.clone();
            handle.spawn(async move {
                tm.stop_by_port_for_owner(port, &session_id, entry_incarnation)
                    .await;
                tm.stop_by_port(port).await;
            });
        }
    }

    /// Returns the concrete PTY owner of a currently tracked port so tunnel
    /// sessions can be cleaned up without conflating reused public ids.
    pub async fn owner_for_port(&self, port: u16) -> Option<(String, u64)> {
        self.ports
            .read()
            .unwrap()
            .get(&port)
            .map(|entry| (entry.session_id.clone(), entry.incarnation))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::event_sink::NoopEventSink;
    use crate::tunnel::{DriverHandle, TunnelDriver, TunnelDriverEvent, TunnelError};
    use std::time::Instant;
    use tempfile::NamedTempFile;

    struct RunningTunnelDriver {
        event_senders: Arc<std::sync::Mutex<Vec<tokio::sync::mpsc::Sender<TunnelDriverEvent>>>>,
    }

    impl TunnelDriver for RunningTunnelDriver {
        fn name(&self) -> &'static str {
            "test"
        }

        fn start(
            &self,
            _port: u16,
            _label: &str,
            event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
        ) -> crate::tunnel::driver::BoxFuture<'_, Result<DriverHandle, TunnelError>> {
            self.event_senders.lock().unwrap().push(event_tx);
            Box::pin(async {
                let (stop_tx, _stop_rx) = tokio::sync::oneshot::channel();
                Ok(DriverHandle {
                    pid: None,
                    stop_tx: Some(stop_tx),
                })
            })
        }
    }

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
            .report_stdout_hit(5173, "session-a".to_string(), 1, Some("web".to_string()))
            .await;
        assert_eq!(store.load_detected_ports().unwrap().len(), 1);

        manager.report_lost(5173, 1).await;
        assert!(store.load_detected_ports().unwrap().is_empty());
    }

    #[tokio::test]
    async fn persisted_ports_seed_with_grace_then_expire() {
        let (manager, store, _temp) = manager_with_store();
        store
            .save_detected_port("session-a", 1, 5173, Some("web"))
            .unwrap();

        let seeded = manager
            .seed_persisted_candidates(&[("session-a".to_string(), 1)])
            .await;
        assert_eq!(seeded, 1);
        assert_eq!(manager.list().await.len(), 1);

        manager.report_lost(5173, 1).await;
        assert_eq!(
            manager.list().await.len(),
            1,
            "seeded port should survive grace miss"
        );

        {
            let mut ports = manager.ports.write().unwrap();
            ports.get_mut(&5173).unwrap().provisional_until = Some(Instant::now());
        }
        manager.report_lost(5173, 1).await;
        assert!(manager.list().await.is_empty());
        assert!(store.load_detected_ports().unwrap().is_empty());
    }

    #[tokio::test]
    async fn stale_loss_does_not_remove_replacement_port() {
        let (manager, store, _temp) = manager_with_store();

        manager
            .report_stdout_hit(5173, "reused".to_string(), 10, Some("old".to_string()))
            .await;
        {
            let mut ports = manager.ports.write().unwrap();
            ports.remove(&5173);
        }
        manager
            .report_stdout_hit(5173, "reused".to_string(), 11, Some("new".to_string()))
            .await;

        manager.report_lost(5173, 10).await;

        let current = manager.list().await;
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].incarnation, 11);
        let persisted = store.load_detected_ports().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].incarnation, 11);
    }

    #[tokio::test]
    async fn same_port_takeover_removes_replaced_persisted_owner() {
        let (manager, store, _temp) = manager_with_store();

        manager
            .report_stdout_hit(5173, "session-a".to_string(), 1, Some("old".to_string()))
            .await;
        manager
            .report_stdout_hit(5173, "session-b".to_string(), 2, Some("new".to_string()))
            .await;

        let current = manager.list().await;
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].session_id, "session-b");
        let persisted = store.load_detected_ports().unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].session_id, "session-b");
        assert_eq!(persisted[0].incarnation, 2);
    }

    #[tokio::test]
    async fn concurrent_port_discovery_and_loss_keep_map_and_store_consistent() {
        let (manager, store, _temp) = manager_with_store();

        for incarnation in 1..=128 {
            let discover_manager = manager.clone();
            let lost_manager = manager.clone();
            tokio::join!(
                async move {
                    discover_manager
                        .report_stdout_hit(
                            5173,
                            "race".to_string(),
                            incarnation,
                            Some("race".to_string()),
                        )
                        .await;
                },
                async move {
                    lost_manager.report_lost(5173, incarnation).await;
                },
            );

            let current = manager.list().await;
            let persisted = store.load_detected_ports().unwrap();
            assert_eq!(current.len(), persisted.len());
            if let Some(current) = current.first() {
                assert_eq!(persisted[0].session_id, current.session_id);
                assert_eq!(persisted[0].incarnation, current.incarnation);
            }
        }
    }

    #[tokio::test]
    async fn stale_stdout_is_ignored_after_replacement_or_removal() {
        let (manager, store, _temp) = manager_with_store();
        manager.enable_session_validation();

        manager.register_session("reused", 10);
        manager
            .report_stdout_hit(5173, "reused".to_string(), 10, Some("old".to_string()))
            .await;

        manager.unregister_session("reused", 10);
        assert!(manager.list().await.is_empty());
        assert!(store.load_detected_ports().unwrap().is_empty());

        manager.register_session("reused", 11);
        manager
            .report_stdout_hit(5173, "reused".to_string(), 10, Some("old".to_string()))
            .await;
        manager
            .report_stdout_hit(5173, "reused".to_string(), 11, Some("new".to_string()))
            .await;

        manager.unregister_session("reused", 10);
        let current = manager.list().await;
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].incarnation, 11);

        manager.unregister_session("reused", 11);
        manager
            .report_stdout_hit(8080, "reused".to_string(), 11, Some("new".to_string()))
            .await;

        let current = manager.list().await;
        assert!(current.is_empty());
        let persisted = store.load_detected_ports().unwrap();
        assert!(persisted.is_empty());
    }

    #[tokio::test]
    async fn lost_port_stops_ownerless_tunnel() {
        let tunnel_manager = crate::tunnel::TunnelSessionManager::new(
            Arc::new(NoopEventSink),
            Arc::new(RunningTunnelDriver {
                event_senders: Arc::new(std::sync::Mutex::new(Vec::new())),
            }),
        );
        let manager = PortForwardManager::new(Arc::new(NoopEventSink))
            .with_tunnel_manager(tunnel_manager.clone());

        tunnel_manager
            .create(5173, "manual".to_string())
            .await
            .unwrap();
        assert_eq!(tunnel_manager.list().await.len(), 1);

        // Discovery alone does not mean the port was lost; a manually-created
        // ownerless tunnel must remain usable while the process is listening.
        manager
            .report_stdout_hit(5173, "session-a".to_string(), 1, None)
            .await;
        assert_eq!(tunnel_manager.list().await.len(), 1);

        manager.report_lost(5173, 1).await;

        assert!(tunnel_manager.list().await.is_empty());
    }

    #[tokio::test]
    async fn ownerless_tunnel_loss_monitor_requires_initial_listen() {
        let tunnel_manager = crate::tunnel::TunnelSessionManager::new(
            Arc::new(NoopEventSink),
            Arc::new(RunningTunnelDriver {
                event_senders: Arc::new(std::sync::Mutex::new(Vec::new())),
            }),
        );
        let manager = PortForwardManager::new(Arc::new(NoopEventSink))
            .with_tunnel_manager(tunnel_manager.clone());

        tunnel_manager
            .create(8080, "manual".to_string())
            .await
            .unwrap();
        let tunnel_id = tunnel_manager.list().await[0].id;
        manager.sync_ownerless_tunnel_ports().await;
        assert_eq!(
            manager.ownerless_tunnel_ports().await,
            vec![(tunnel_id, 8080, false)]
        );

        // A missing port before the first listening observation is not a loss.
        manager.sync_ownerless_tunnel_ports().await;
        assert_eq!(tunnel_manager.list().await.len(), 1);

        manager
            .confirm_ownerless_tunnel_listen(tunnel_id, 8080)
            .await;
        assert_eq!(
            manager.ownerless_tunnel_ports().await,
            vec![(tunnel_id, 8080, true)]
        );
        manager.report_ownerless_tunnel_lost(tunnel_id, 8080).await;
        assert!(tunnel_manager.list().await.is_empty());
    }

    #[tokio::test]
    async fn stale_ownerless_loss_does_not_stop_same_port_replacement() {
        let tunnel_manager = crate::tunnel::TunnelSessionManager::new(
            Arc::new(NoopEventSink),
            Arc::new(RunningTunnelDriver {
                event_senders: Arc::new(std::sync::Mutex::new(Vec::new())),
            }),
        );
        let manager = PortForwardManager::new(Arc::new(NoopEventSink))
            .with_tunnel_manager(tunnel_manager.clone());

        let old = tunnel_manager
            .create(8080, "old".to_string())
            .await
            .unwrap();
        manager.sync_ownerless_tunnel_ports().await;
        manager
            .confirm_ownerless_tunnel_listen(old.id, old.port)
            .await;
        tunnel_manager.stop(old.id).await.unwrap();

        let replacement = tunnel_manager
            .create(8080, "replacement".to_string())
            .await
            .unwrap();
        manager.sync_ownerless_tunnel_ports().await;
        manager.report_ownerless_tunnel_lost(old.id, old.port).await;

        let active = tunnel_manager.list().await;
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, replacement.id);
    }
}
