use serde_json::json;
use tokio::sync::broadcast;

/// Decouples PTY session events from transport (WebSocket, test stub, etc.)
pub trait EventSink: Send + Sync + 'static {
    fn send_terminal_data(&self, session_id: &str, data: &str);
    fn send_terminal_exit(&self, session_id: &str, exit_code: Option<i32>);
    fn send_terminal_changed(&self);
    fn broadcast(&self, event_type: &str, payload: serde_json::Value);

    /// Enhanced terminal exit with restart metadata.
    /// Optional fields are skipped if None (backward-compatible JSON).
    fn send_terminal_exit_enhanced(
        &self,
        session_id: &str,
        exit_code: Option<i32>,
        will_restart: bool,
        restart_in_ms: Option<u64>,
        restart_count: Option<u32>,
    );

    /// New event: process restarted successfully.
    fn send_process_restarted(
        &self,
        session_id: &str,
        restart_count: u32,
        previous_exit_code: Option<i32>,
    );
}

// ---------------------------------------------------------------------------
// Noop — used in unit tests and phases before WebSocket is wired
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn send_terminal_data(&self, _id: &str, _data: &str) {}
    fn send_terminal_exit(&self, _id: &str, _exit_code: Option<i32>) {}
    fn send_terminal_changed(&self) {}
    fn broadcast(&self, _event_type: &str, _payload: serde_json::Value) {}

    fn send_terminal_exit_enhanced(
        &self,
        _id: &str,
        _exit_code: Option<i32>,
        _will_restart: bool,
        _restart_in_ms: Option<u64>,
        _restart_count: Option<u32>,
    ) {}

    fn send_process_restarted(
        &self,
        _id: &str,
        _restart_count: u32,
        _previous_exit_code: Option<i32>,
    ) {}
}

// ---------------------------------------------------------------------------
// Broadcast — wraps tokio broadcast::Sender<String> (JSON-encoded messages)
// Phase 05 will plug the WebSocket receiver into this sender.
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct BroadcastEventSink {
    tx: broadcast::Sender<String>,
}

impl BroadcastEventSink {
    pub fn new(capacity: usize) -> (Self, broadcast::Receiver<String>) {
        let (tx, rx) = broadcast::channel(capacity);
        (Self { tx }, rx)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    fn send_json(&self, msg: serde_json::Value) {
        // Ignore send errors — no active receivers is fine
        let _ = self.tx.send(msg.to_string());
    }
}

impl EventSink for BroadcastEventSink {
    fn send_terminal_data(&self, session_id: &str, data: &str) {
        self.send_json(json!({
            "kind": "terminal:output",
            "id": session_id,
            "data": data,
        }));
    }

    fn send_terminal_exit(&self, session_id: &str, exit_code: Option<i32>) {
        // Thin wrapper: calls enhanced with no restart metadata
        self.send_terminal_exit_enhanced(session_id, exit_code, false, None, None);
    }

    fn send_terminal_changed(&self) {
        self.send_json(json!({ "kind": "terminal:changed", "payload": {} }));
    }

    fn broadcast(&self, event_type: &str, payload: serde_json::Value) {
        self.send_json(json!({ "kind": event_type, "payload": payload }));
    }

    fn send_terminal_exit_enhanced(
        &self,
        session_id: &str,
        exit_code: Option<i32>,
        will_restart: bool,
        restart_in_ms: Option<u64>,
        restart_count: Option<u32>,
    ) {
        let mut payload = json!({
            "kind": "terminal:exit",
            "id": session_id,
            "exitCode": exit_code,
            "willRestart": will_restart,
        });

        // Add optional fields if present
        if let Some(ms) = restart_in_ms {
            payload["restartIn"] = json!(ms);
        }
        if let Some(count) = restart_count {
            payload["restartCount"] = json!(count);
        }

        self.send_json(payload);
    }

    fn send_process_restarted(
        &self,
        session_id: &str,
        restart_count: u32,
        previous_exit_code: Option<i32>,
    ) {
        self.send_json(json!({
            "kind": "process:restarted",
            "id": session_id,
            "restartCount": restart_count,
            "previousExitCode": previous_exit_code,
        }));

        // Also fire terminal:changed for dashboard/sidebar refresh
        self.send_terminal_changed();
    }
}
