//! Correlation of a raw CDP connection's flattened session ids to native target ids.
//!
//! The raw gateway relays opaque CDP; to fence the managed session an `Emulation.*` command
//! really addresses, each connection tracks `Target.attachToTarget` responses and
//! `Target.attachedToTarget` / `detachedFromTarget` events (bounded, small messages only).

use std::collections::HashMap;

use serde_json::Value;

/// Bound on correlation state per raw connection; beyond it sessions are treated as unmapped
/// (fenced conservatively) rather than growing without limit.
const MAX_TRACKED_SESSIONS: usize = 256;
/// Attach responses/events are small; larger upstream frames are never parsed for correlation.
const MAX_CORRELATED_UPSTREAM_BYTES: usize = 16 * 1024;

pub(crate) const GEOMETRY_METHODS: [&str; 4] = [
    "Emulation.setDeviceMetricsOverride",
    "Emulation.clearDeviceMetricsOverride",
    "Emulation.setPageScaleFactor",
    "Emulation.setVisibleSize",
];

/// What a raw `Emulation.*` command addresses.
pub(crate) enum RawTarget {
    /// Resolved native target id.
    Native(String),
    /// A flattened session this connection never saw attach: fence every session of the
    /// principal without adopting geometry.
    Unmapped,
    /// Browser-level command without a session; the browser rejects it, nothing is mutated.
    None,
}

/// Per-connection correlation of flattened session ids to native target ids.
#[derive(Default)]
pub struct RawSessionTargets {
    /// `Some` for a page-level socket (`/cdp/ws/{target}`): sessionless commands address it.
    page_target: Option<String>,
    by_session: HashMap<String, String>,
    pending_attach: HashMap<i64, String>,
}

impl RawSessionTargets {
    pub fn new(page_target: Option<String>) -> Self {
        Self { page_target, ..Self::default() }
    }

    fn remember(&mut self, session_id: &str, target_id: &str) {
        if self.by_session.len() < MAX_TRACKED_SESSIONS || self.by_session.contains_key(session_id) {
            self.by_session.insert(session_id.to_string(), target_id.to_string());
        }
    }

    /// Records a client `Target.attachToTarget` so its response can be correlated.
    pub(crate) fn observe_client_attach(&mut self, msg: &Value) {
        let (Some(id), Some(target)) = (
            msg.get("id").and_then(Value::as_i64),
            msg.pointer("/params/targetId").and_then(Value::as_str),
        ) else {
            return;
        };
        if self.pending_attach.len() < MAX_TRACKED_SESSIONS {
            self.pending_attach.insert(id, target.to_string());
        }
    }

    /// Observes an upstream message: attach responses/events add mappings, detach removes them.
    pub fn observe_upstream(&mut self, text: &str) {
        if text.len() > MAX_CORRELATED_UPSTREAM_BYTES || !text.contains("\"sessionId\"") {
            return;
        }
        let Ok(msg) = serde_json::from_str::<Value>(text) else {
            return;
        };
        match msg.get("method").and_then(Value::as_str) {
            Some("Target.attachedToTarget") => {
                if let (Some(sid), Some(tid)) = (
                    msg.pointer("/params/sessionId").and_then(Value::as_str),
                    msg.pointer("/params/targetInfo/targetId").and_then(Value::as_str),
                ) {
                    self.remember(sid, tid);
                }
            }
            Some("Target.detachedFromTarget") => {
                if let Some(sid) = msg.pointer("/params/sessionId").and_then(Value::as_str) {
                    self.by_session.remove(sid);
                }
            }
            _ => {
                if let (Some(id), Some(sid)) = (
                    msg.get("id").and_then(Value::as_i64),
                    msg.pointer("/result/sessionId").and_then(Value::as_str),
                ) {
                    if let Some(tid) = self.pending_attach.remove(&id) {
                        self.remember(sid, &tid);
                    }
                }
            }
        }
    }

    pub(crate) fn resolve(&self, session_id: Option<&str>) -> RawTarget {
        match session_id {
            Some(sid) => self
                .by_session
                .get(sid)
                .map_or(RawTarget::Unmapped, |tid| RawTarget::Native(tid.clone())),
            None => self.page_target.clone().map_or(RawTarget::None, RawTarget::Native),
        }
    }
}
