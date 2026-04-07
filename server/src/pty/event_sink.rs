use serde_json::json;
use tokio::sync::broadcast;

/// Decouples PTY session events from transport (WebSocket, test stub, etc.)
pub trait EventSink: Send + Sync + 'static {
    fn send_terminal_data(&self, session_id: &str, data: &str);
    fn send_terminal_exit(&self, session_id: &str, exit_code: Option<i32>);
    fn send_terminal_changed(&self);
    fn broadcast(&self, event_type: &str, payload: serde_json::Value);
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
        self.send_json(json!({
            "kind": "terminal:exit",
            "id": session_id,
            "exitCode": exit_code,
        }));
    }

    fn send_terminal_changed(&self) {
        self.send_json(json!({ "kind": "terminal:changed", "payload": {} }));
    }

    fn broadcast(&self, event_type: &str, payload: serde_json::Value) {
        self.send_json(json!({ "kind": event_type, "payload": payload }));
    }
}
