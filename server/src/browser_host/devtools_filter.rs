use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use super::input::{MouseButton, MAX_INSERT_TEXT_BYTES};
use super::protocol::MAX_WS_MESSAGE_BYTES;
use super::raw_session_targets::GEOMETRY_METHODS;

const MAX_DEVTOOLS_JSON_NODES: usize = 8_192;
const MAX_DEVTOOLS_JSON_DEPTH: usize = 128;
const MAX_CDP_KEY_IDENTIFIER_BYTES: usize = 64;
const MAX_ID_BYTES: usize = 256;
// Per-token admission charge includes Value nodes, ordered-map storage, and allocator slack.
// This is a conservative accounting estimate, not an allocator-enforced per-message ceiling.
const DEVTOOLS_JSON_NODE_RESERVATION_BYTES: usize = 1_024;

const MAX_TRACKED_TARGETS: usize = 256;
const MAX_OWNED_SESSIONS: usize = 128;
const MAX_PENDING_ATTACHES: usize = 32;
const MAX_PENDING_REQUESTS: usize = 512;
const MAX_PENDING_INTERNAL_DETACHES: usize = 64;
const MAX_QUARANTINED_EVENT_BYTES: usize = 64 * 1024;
pub(crate) const CLIENT_CALL_ID_MAX: u64 = 1_000_000_000;
pub(crate) const INTERNAL_FILTER_ID_BASE: u64 = 1_500_000_000;

const DISALLOWED_EXACT_METHODS: &[&str] = &[
    "Page.setDownloadBehavior",
    "Network.getAllCookies",
    "Network.getCookies",
    "Network.setCookie",
    "Network.setCookies",
    "Network.deleteCookies",
    "Network.clearBrowserCache",
    "Network.clearBrowserCookies",
];

// Bounded nonlocal-effect inventory (Phase 01 source/upstream review + Phase 04 target/session isolation):
// | Surface | Scope/effect | Policy/evidence/test |
// | Browser.*; disallowed Target.* context/discovery/related/lifecycle/tunnel | browser/context state or cross-target metadata | deny on root & child; suppress upstream |
// | Target.setAutoAttach | child auto-attach | require flatten=true + root/owned parent; enforce filter to iframe+worker only |
// | Target.getTargetInfo / Target.attachToTarget / Target.detachFromTarget | target info/session lifecycle | allow ONLY positively Owned targets/sessions; correlate & verify responses |
// | Page.setDownloadBehavior | client download-path override | deny regardless of params/session |
// | ServiceWorker.* | context worker lifecycle & registration/version/script/client metadata | deny all commands & suppress all events/results unconditionally |
// | BackgroundService.* | storage-partition history/recording and worker metadata | deny all commands & suppress all events |
// | Storage.* | origin/profile storage and metadata | deny all commands & suppress all events |
// | listed Network cookie/cache methods | browser/profile cookie or cache state | deny on root & child |
// | geometry methods | server-owned viewport | deny on root & child |
fn disallowed_nonlocal_method(method: &str) -> bool {
    method.starts_with("Browser.")
        || method.starts_with("ServiceWorker.")
        || method.starts_with("BackgroundService.")
        || method.starts_with("Storage.")
        || DISALLOWED_EXACT_METHODS.contains(&method)
        || GEOMETRY_METHODS.contains(&method)
}

fn disallowed_upstream_event_domain(method: &str) -> bool {
    method.starts_with("Browser.")
        || method.starts_with("ServiceWorker.")
        || method.starts_with("BackgroundService.")
        || method.starts_with("Storage.")
        || method == "Target.receivedMessageFromTarget"
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnedTargetKind {
    RootPage,
    Iframe,
    DedicatedWorker,
}

impl OwnedTargetKind {
    pub fn as_cdp_type(self) -> &'static str {
        match self {
            Self::RootPage => "page",
            Self::Iframe => "iframe",
            Self::DedicatedWorker => "worker",
        }
    }

    pub fn from_child_cdp_type(target_type: &str) -> Option<Self> {
        match target_type {
            "iframe" => Some(Self::Iframe),
            "worker" => Some(Self::DedicatedWorker),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TargetLifecycle {
    Pending {
        target_type: OwnedTargetKind,
        parent_session_id: Option<String>,
        pending_sessions: usize,
    },
    Owned {
        target_type: OwnedTargetKind,
        parent_session_id: Option<String>,
    },
    Foreign,
    Detached,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SessionLifecycle {
    Pending {
        target_id: String,
        target_type: OwnedTargetKind,
        parent_session_id: Option<String>,
        quarantined_event: Option<String>,
    },
    Owned {
        target_id: String,
        target_type: OwnedTargetKind,
        parent_session_id: Option<String>,
    },
    Detached,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PendingRequestKind {
    General,
    GetTargetInfo { expected_target_id: String },
    AttachToTarget { expected_target_id: String },
    DetachFromTarget { target_session_id: String },
    SetAutoAttach,
}

/// Stateful CDP `Input.*` effect classification (Phase 03 R2 inventory).
#[derive(Debug, Clone, PartialEq)]
pub enum CdpInputEffect {
    KeyDown { key: String, code: String, modifiers: u32 },
    KeyUp { key: String, code: String, modifiers: u32 },
    MouseDown { button: MouseButton, x: f64, y: f64, modifiers: u32 },
    MouseUp { button: MouseButton, x: f64, y: f64, modifiers: u32 },
    PointerMove { x: f64, y: f64, modifiers: u32 },
    NonHeld,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ClassifiedDevToolsMessage {
    Forward {
        json: String,
        call_id: u64,
        session_id: Option<String>,
        input_effect: Option<CdpInputEffect>,
    },
    Reject(Option<String>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpstreamVerdict {
    Forward,
    ForwardText(String),
    Suppress {
        internal_commands: Vec<String>,
    },
    ClientReplyAndDetach {
        client_text: String,
        internal_commands: Vec<String>,
    },
    PendingAttach {
        session_id: String,
        target_id: String,
        target_type: OwnedTargetKind,
    },
    PassToInternalReply,
    CloseConnection {
        internal_commands: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingAttachSnapshot {
    pub session_id: String,
    pub target_id: String,
    pub target_type: OwnedTargetKind,
    pub parent_session_id: Option<String>,
}

fn parse_cdp_modifiers(params: &serde_json::Map<String, Value>) -> Option<u32> {
    match params.get("modifiers") {
        None => Some(0),
        Some(v) => v.as_u64().and_then(|n| u32::try_from(n).ok()),
    }
}

fn parse_cdp_mouse_button(params: &serde_json::Map<String, Value>) -> Option<MouseButton> {
    match params.get("button") {
        None => Some(MouseButton::None),
        Some(v) => match v.as_str()? {
            "none" => Some(MouseButton::None),
            "left" => Some(MouseButton::Left),
            "middle" => Some(MouseButton::Middle),
            "right" => Some(MouseButton::Right),
            "back" => Some(MouseButton::Back),
            "forward" => Some(MouseButton::Forward),
            _ => None,
        },
    }
}

fn parse_cdp_finite_f64(params: &serde_json::Map<String, Value>, field: &str) -> Option<f64> {
    params.get(field).and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn classify_cdp_input_method(
    method: &str,
    params: Option<&serde_json::Map<String, Value>>,
) -> Result<CdpInputEffect, &'static str> {
    let Some(params) = params else {
        return Err("Missing params for Input command");
    };
    match method {
        "Input.dispatchKeyEvent" => {
            let kind = params
                .get("type")
                .and_then(Value::as_str)
                .ok_or("Invalid Input.dispatchKeyEvent type")?;
            let modifiers =
                parse_cdp_modifiers(params).ok_or("Invalid Input.dispatchKeyEvent modifiers")?;
            let key = params
                .get("key")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let code = params
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if key.len() > MAX_CDP_KEY_IDENTIFIER_BYTES || code.len() > MAX_CDP_KEY_IDENTIFIER_BYTES {
                return Err("Key identifier exceeds maximum length");
            }
            if params.get("key").is_some_and(|v| !v.is_string())
                || params.get("code").is_some_and(|v| !v.is_string())
            {
                return Err("Invalid key or code field");
            }
            match kind {
                "keyDown" | "rawKeyDown" => {
                    if key.is_empty() && code.is_empty() {
                        return Err("KeyDown requires non-empty key or code");
                    }
                    Ok(CdpInputEffect::KeyDown { key, code, modifiers })
                }
                "keyUp" => {
                    if key.is_empty() && code.is_empty() {
                        return Err("KeyUp requires non-empty key or code");
                    }
                    Ok(CdpInputEffect::KeyUp { key, code, modifiers })
                }
                "char" => Ok(CdpInputEffect::NonHeld),
                _ => Err("Unsupported Input.dispatchKeyEvent type"),
            }
        }
        "Input.dispatchMouseEvent" => {
            let kind = params
                .get("type")
                .and_then(Value::as_str)
                .ok_or("Invalid Input.dispatchMouseEvent type")?;
            if let Some(pointer_type) = params.get("pointerType") {
                if pointer_type.as_str() != Some("mouse") {
                    return Err("Unsupported Input.dispatchMouseEvent pointerType");
                }
            }
            let x = parse_cdp_finite_f64(params, "x")
                .ok_or("Invalid Input.dispatchMouseEvent x")?;
            let y = parse_cdp_finite_f64(params, "y")
                .ok_or("Invalid Input.dispatchMouseEvent y")?;
            let modifiers =
                parse_cdp_modifiers(params).ok_or("Invalid Input.dispatchMouseEvent modifiers")?;
            let button = parse_cdp_mouse_button(params)
                .ok_or("Invalid Input.dispatchMouseEvent button")?;
            match kind {
                "mousePressed" => {
                    if button == MouseButton::None {
                        Ok(CdpInputEffect::PointerMove { x, y, modifiers })
                    } else {
                        Ok(CdpInputEffect::MouseDown { button, x, y, modifiers })
                    }
                }
                "mouseReleased" => {
                    if button == MouseButton::None {
                        Ok(CdpInputEffect::PointerMove { x, y, modifiers })
                    } else {
                        Ok(CdpInputEffect::MouseUp { button, x, y, modifiers })
                    }
                }
                "mouseMoved" => Ok(CdpInputEffect::PointerMove { x, y, modifiers }),
                "mouseWheel" => {
                    if params.get("deltaX").is_some_and(|v| !v.as_f64().is_some_and(f64::is_finite))
                        || params.get("deltaY").is_some_and(|v| !v.as_f64().is_some_and(f64::is_finite))
                    {
                        return Err("Invalid Input.dispatchMouseEvent wheel delta");
                    }
                    Ok(CdpInputEffect::PointerMove { x, y, modifiers })
                }
                _ => Err("Unsupported Input.dispatchMouseEvent type"),
            }
        }
        "Input.insertText" => {
            let text = params
                .get("text")
                .and_then(Value::as_str)
                .ok_or("Invalid Input.insertText text")?;
            if text.len() > MAX_INSERT_TEXT_BYTES {
                return Err("Input.insertText exceeds maximum length");
            }
            Ok(CdpInputEffect::NonHeld)
        }
        _ => Err("Unsupported stateful Input command disallowed in target-scoped DevTools"),
    }
}

/// Returns the pre-parse admission charge. An allocation-free scan caps depth and token count;
/// the charge budgets 4x wire bytes for source/decoded strings/canonical output plus 1 KiB per
/// token for Value nodes and container storage.
pub(crate) fn devtools_json_memory_bound(raw: &str) -> Option<usize> {
    if raw.len() > MAX_WS_MESSAGE_BYTES {
        return None;
    }
    let bytes = raw.as_bytes();
    let mut index = 0;
    let mut depth = 0usize;
    let mut nodes = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b' ' | b'\n' | b'\r' | b'\t' | b',' | b':' => index += 1,
            b'"' => {
                nodes += 1;
                index += 1;
                let mut closed = false;
                while index < bytes.len() {
                    match bytes[index] {
                        b'\\' => index = index.checked_add(2)?,
                        b'"' => {
                            index += 1;
                            closed = true;
                            break;
                        }
                        _ => index += 1,
                    }
                }
                if !closed {
                    return None;
                }
            }
            b'{' | b'[' => {
                nodes += 1;
                depth += 1;
                if depth > MAX_DEVTOOLS_JSON_DEPTH {
                    return None;
                }
                index += 1;
            }
            b'}' | b']' => {
                if depth == 0 {
                    return None;
                }
                depth -= 1;
                index += 1;
            }
            _ => {
                nodes += 1;
                while index < bytes.len()
                    && !matches!(
                        bytes[index],
                        b' ' | b'\n' | b'\r' | b'\t' | b',' | b':' | b'{' | b'}' | b'[' | b']' | b'"'
                    )
                {
                    index += 1;
                }
            }
        }
        if nodes > MAX_DEVTOOLS_JSON_NODES {
            return None;
        }
    }
    if depth != 0 {
        return None;
    }
    raw.len()
        .checked_mul(4)?
        .checked_add(nodes.checked_mul(DEVTOOLS_JSON_NODE_RESERVATION_BYTES)?)
}

/// Validates a relative asset path under `/api/browser/devtools/{token}/{*path}`.
pub fn validate_devtools_asset_path(raw: &str) -> Result<&str, &'static str> {
    if raw.is_empty()
        || raw.starts_with('/')
        || raw.ends_with('/')
        || raw.contains('\\')
        || raw.contains("..")
        || raw.contains('?')
        || raw.contains('#')
    {
        return Err("invalid devtools asset path");
    }
    if !raw
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-'))
    {
        return Err("invalid characters in devtools asset path");
    }
    if raw.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return Err("invalid segment in devtools asset path");
    }
    Ok(raw)
}

/// Rewrites `ws://127.0.0.1:*` in Chromium DevTools' CSP meta tag so the proxied page can
/// connect back to `/api/browser/devtools/{token}/ws` over `ws:`/`wss:` on `'self'`.
pub fn rewrite_devtools_html_csp(html: &str) -> String {
    if html.contains("'self' ws: wss: ws://127.0.0.1:*") {
        return html.to_string();
    }
    html.replace("ws://127.0.0.1:*", "'self' ws: wss: ws://127.0.0.1:*")
}

fn is_valid_cdp_method(method: &str) -> bool {
    if method.is_empty() || method.len() > 128 {
        return false;
    }
    let Some((domain, command)) = method.split_once('.') else {
        return false;
    };
    let valid_identifier = |part: &str| {
        !part.is_empty()
            && part.as_bytes()[0].is_ascii_alphabetic()
            && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    };
    valid_identifier(domain) && valid_identifier(command)
}

fn valid_cdp_id_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= MAX_ID_BYTES)
}

fn correlated_error_json(
    id: u64,
    session_id: Option<&str>,
    code: i64,
    message: &str,
) -> String {
    let mut value = json!({
        "id": id,
        "error": { "code": code, "message": message }
    });
    if let Some(sid) = session_id {
        value["sessionId"] = Value::String(sid.to_string());
    }
    value.to_string()
}

fn reject_classified(
    id: Option<&Value>,
    session_id: Option<&Value>,
    code: i64,
    message: &str,
) -> ClassifiedDevToolsMessage {
    let reply = id.and_then(Value::as_u64).map(|call_id| {
        correlated_error_json(call_id, session_id.and_then(Value::as_str), code, message)
    });
    ClassifiedDevToolsMessage::Reject(reply)
}

/// Bounded per-connection positive target, child-session, and request-correlation filter.
pub struct DevToolsSessionFilter {
    root_target_id: String,
    root_detached: bool,
    targets: HashMap<String, TargetLifecycle>,
    sessions: HashMap<String, SessionLifecycle>,
    pending_requests: HashMap<(Option<String>, u64), PendingRequestKind>,
    pending_internal_detaches: HashSet<u64>,
    retired_client_replies: Vec<String>,
    next_internal_id: u64,
}

impl DevToolsSessionFilter {
    pub fn new(root_target_id: impl Into<String>) -> Self {
        let root_target_id = root_target_id.into();
        let mut targets = HashMap::new();
        targets.insert(
            root_target_id.clone(),
            TargetLifecycle::Owned {
                target_type: OwnedTargetKind::RootPage,
                parent_session_id: None,
            },
        );
        Self {
            root_target_id,
            root_detached: false,
            targets,
            sessions: HashMap::new(),
            pending_requests: HashMap::new(),
            pending_internal_detaches: HashSet::new(),
            retired_client_replies: Vec::new(),
            next_internal_id: INTERNAL_FILTER_ID_BASE,
        }
    }

    pub fn take_retired_client_replies(&mut self) -> Vec<String> {
        std::mem::take(&mut self.retired_client_replies)
    }

    pub fn is_session_owned(&self, session_id: &str) -> bool {
        matches!(self.sessions.get(session_id), Some(SessionLifecycle::Owned { .. }))
    }

    pub fn is_session_pending(&self, session_id: &str) -> bool {
        matches!(self.sessions.get(session_id), Some(SessionLifecycle::Pending { .. }))
    }

    pub fn session_child_iframe_target_id(&self, session_id: &str) -> Option<&str> {
        match self.sessions.get(session_id) {
            Some(SessionLifecycle::Owned {
                target_id,
                target_type: OwnedTargetKind::Iframe,
                ..
            }) => Some(target_id.as_str()),
            _ => None,
        }
    }

    pub fn owned_iframe_sessions(&self) -> Vec<(String, String)> {
        self.sessions
            .iter()
            .filter_map(|(sid, state)| match state {
                SessionLifecycle::Owned {
                    target_id,
                    target_type: OwnedTargetKind::Iframe,
                    ..
                } => Some((sid.clone(), target_id.clone())),
                _ => None,
            })
            .collect()
    }

    /// Retires an owned (or pending) child session subtree and emits internal
    /// `Target.detachFromTarget` commands for every retired session.
    pub fn retire_owned_child_session(&mut self, session_id: &str) -> Result<Vec<String>, ()> {
        self.reject_pending_attach(session_id, false)
    }

    pub fn pending_attaches(&self) -> Vec<PendingAttachSnapshot> {
        self.sessions
            .iter()
            .filter_map(|(sid, state)| match state {
                SessionLifecycle::Pending {
                    target_id,
                    target_type,
                    parent_session_id,
                    ..
                } => Some(PendingAttachSnapshot {
                    session_id: sid.clone(),
                    target_id: target_id.clone(),
                    target_type: *target_type,
                    parent_session_id: parent_session_id.clone(),
                }),
                _ => None,
            })
            .collect()
    }

    pub fn has_pending_attaches(&self) -> bool {
        self.sessions
            .values()
            .any(|s| matches!(s, SessionLifecycle::Pending { .. }))
    }

    pub fn has_active_children(&self) -> bool {
        self.sessions.values().any(|s| {
            matches!(
                s,
                SessionLifecycle::Owned { .. } | SessionLifecycle::Pending { .. }
            )
        })
    }

    /// Promotes a quarantined `Pending` child session to `Owned`, returning its held
    /// `Target.attachedToTarget` event text if present.
    pub fn promote_pending_attach(&mut self, session_id: &str) -> Option<String> {
        let (target_id, target_type, parent_session_id) = match self.sessions.get(session_id)? {
            SessionLifecycle::Pending {
                target_id,
                target_type,
                parent_session_id,
                ..
            } => (target_id.clone(), *target_type, parent_session_id.clone()),
            _ => return None,
        };
        if let Some(parent_sid) = &parent_session_id {
            if !self.is_session_owned(parent_sid) {
                return None;
            }
        } else if self.root_detached {
            return None;
        }
        let quarantined = match self.sessions.get_mut(session_id)? {
            SessionLifecycle::Pending { quarantined_event, .. } => quarantined_event.take(),
            _ => return None,
        };
        self.sessions.insert(
            session_id.to_string(),
            SessionLifecycle::Owned {
                target_id: target_id.clone(),
                target_type,
                parent_session_id: parent_session_id.clone(),
            },
        );
        self.targets.insert(
            target_id,
            TargetLifecycle::Owned {
                target_type,
                parent_session_id,
            },
        );
        quarantined
    }

    /// Rejects a quarantined `Pending` child session (and any nested `Pending` children under it),
    /// returning internal `Target.detachFromTarget` commands to send upstream without resuming.
    pub fn reject_pending_attach(
        &mut self,
        session_id: &str,
        mark_foreign: bool,
    ) -> Result<Vec<String>, ()> {
        let mut queue = vec![session_id.to_string()];
        let mut to_detach = Vec::new();
        let mut seen = HashSet::new();
        while let Some(current) = queue.pop() {
            if !seen.insert(current.clone()) {
                continue;
            }
            let children: Vec<String> = self
                .sessions
                .iter()
                .filter_map(|(sid, state)| match state {
                    SessionLifecycle::Pending { parent_session_id, .. }
                    | SessionLifecycle::Owned { parent_session_id, .. }
                        if parent_session_id.as_deref() == Some(current.as_str()) =>
                    {
                        Some(sid.clone())
                    }
                    _ => None,
                })
                .collect();
            queue.extend(children);
            if let Some(state) = self.sessions.get(&current) {
                let tid = match state {
                    SessionLifecycle::Pending { target_id, .. }
                    | SessionLifecycle::Owned { target_id, .. } => Some(target_id.clone()),
                    SessionLifecycle::Detached => None,
                };
                if let Some(tid) = tid {
                    self.retire_session_entry(&current);
                    if tid != self.root_target_id {
                        let any_other_active = self.sessions.values().any(|s| match s {
                            SessionLifecycle::Owned { target_id, .. }
                            | SessionLifecycle::Pending { target_id, .. } => target_id == &tid,
                            SessionLifecycle::Detached => false,
                        });
                        if !any_other_active {
                            self.targets.insert(
                                tid,
                                if mark_foreign {
                                    TargetLifecycle::Foreign
                                } else {
                                    TargetLifecycle::Detached
                                },
                            );
                        }
                    }
                    to_detach.push(self.build_internal_detach(&current)?);
                }
            }
        }
        Ok(to_detach)
    }

    /// Retires all `Owned` and `Pending` child sessions (e.g. on `OwnershipFence` gap/overflow)
    /// without clearing `Foreign`/`Detached` tombstones.
    pub fn retire_active_children(&mut self) -> Result<Vec<String>, ()> {
        let active_sids: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|(sid, state)| match state {
                SessionLifecycle::Owned { .. } | SessionLifecycle::Pending { .. } => Some(sid.clone()),
                SessionLifecycle::Detached => None,
            })
            .collect();
        let mut commands = Vec::with_capacity(active_sids.len());
        for sid in active_sids {
            self.retire_session_entry(&sid);
            commands.push(self.build_internal_detach(&sid)?);
        }
        for (tid, state) in self.targets.iter_mut() {
            if tid != &self.root_target_id
                && matches!(
                    state,
                    TargetLifecycle::Owned { .. } | TargetLifecycle::Pending { .. }
                )
            {
                *state = TargetLifecycle::Detached;
            }
        }
        Ok(commands)
    }

    /// Validates and classifies one bounded client CDP command envelope.
    pub fn classify_client_message(&mut self, raw: &str) -> ClassifiedDevToolsMessage {
        if devtools_json_memory_bound(raw).is_none() {
            return ClassifiedDevToolsMessage::Reject(None);
        }
        let Ok(mut val) = serde_json::from_str::<Value>(raw) else {
            return ClassifiedDevToolsMessage::Reject(None);
        };
        let Some(obj) = val.as_object() else {
            return ClassifiedDevToolsMessage::Reject(None);
        };
        let id_val = obj.get("id");
        let call_id = id_val.and_then(Value::as_u64).filter(|&n| n <= CLIENT_CALL_ID_MAX);
        let valid_method = obj
            .get("method")
            .and_then(Value::as_str)
            .is_some_and(is_valid_cdp_method);
        let valid_params = obj.get("params").is_none_or(Value::is_object);
        let raw_session = obj.get("sessionId");
        let session_id_val = raw_session.filter(|s| valid_cdp_id_str(Some(s)).is_some());
        if raw_session.is_some() && session_id_val.is_none() {
            return ClassifiedDevToolsMessage::Reject(None);
        }
        let valid_keys = obj
            .keys()
            .all(|key| matches!(key.as_str(), "id" | "method" | "params" | "sessionId"));
        if call_id.is_none() || !valid_method || !valid_params || !valid_keys {
            return reject_classified(
                id_val.filter(|_| call_id.is_some()),
                session_id_val,
                -32600,
                "Invalid CDP command envelope",
            );
        }

        let call_id = call_id.expect("validated above");
        let session_id = session_id_val.and_then(Value::as_str).map(str::to_string);
        let method = obj["method"].as_str().expect("validated above").to_string();

        // Step 2: Validate every envelope's sessionId BEFORE method policy.
        if self.root_detached {
            return ClassifiedDevToolsMessage::Reject(Some(correlated_error_json(
                call_id,
                session_id.as_deref(),
                -32601,
                "Command disallowed in target-scoped DevTools",
            )));
        }
        let session_target_id = match session_id.as_deref() {
            None => self.root_target_id.clone(),
            Some(sid) => match self.sessions.get(sid) {
                Some(SessionLifecycle::Owned { target_id, .. }) => target_id.clone(),
                _ => {
                    return ClassifiedDevToolsMessage::Reject(Some(correlated_error_json(
                        call_id,
                        session_id.as_deref(),
                        -32601,
                        "Command disallowed in target-scoped DevTools",
                    )));
                }
            },
        };

        let request_key = (session_id.clone(), call_id);
        if self.pending_requests.len() >= MAX_PENDING_REQUESTS
            || self.pending_requests.contains_key(&request_key)
        {
            return ClassifiedDevToolsMessage::Reject(Some(correlated_error_json(
                call_id,
                session_id.as_deref(),
                -32600,
                "DevTools request correlation capacity or ID collision",
            )));
        }

        if disallowed_nonlocal_method(&method) {
            return ClassifiedDevToolsMessage::Reject(Some(correlated_error_json(
                call_id,
                session_id.as_deref(),
                -32601,
                "Command disallowed in target-scoped DevTools",
            )));
        }

        let pending_kind = if method.starts_with("Target.") {
            match self.validate_target_command(
                &method,
                &mut val,
                session_id.as_deref(),
                &session_target_id,
            ) {
                Ok(kind) => kind,
                Err(reason) => {
                    return ClassifiedDevToolsMessage::Reject(Some(correlated_error_json(
                        call_id,
                        session_id.as_deref(),
                        -32601,
                        reason,
                    )));
                }
            }
        } else {
            PendingRequestKind::General
        };

        let input_effect = if method.starts_with("Input.") {
            let params_obj = val.get("params").and_then(Value::as_object);
            match classify_cdp_input_method(&method, params_obj) {
                Ok(effect) => Some(effect),
                Err(reason) => {
                    return ClassifiedDevToolsMessage::Reject(Some(correlated_error_json(
                        call_id,
                        session_id.as_deref(),
                        -32601,
                        reason,
                    )));
                }
            }
        } else {
            None
        };

        self.pending_requests.insert(request_key, pending_kind);
        ClassifiedDevToolsMessage::Forward {
            json: val.to_string(),
            call_id,
            session_id,
            input_effect,
        }
    }

    fn validate_target_command(
        &self,
        method: &str,
        val: &mut Value,
        caller_session_id: Option<&str>,
        caller_target_id: &str,
    ) -> Result<PendingRequestKind, &'static str> {
        let params_obj = val.get("params").and_then(Value::as_object);
        match method {
            "Target.getTargetInfo" => {
                if let Some(params) = params_obj {
                    if !params.keys().all(|k| k == "targetId") {
                        return Err("Command disallowed in target-scoped DevTools");
                    }
                    if let Some(raw_tid) = params.get("targetId") {
                        let tid = valid_cdp_id_str(Some(raw_tid))
                            .ok_or("Command disallowed in target-scoped DevTools")?;
                        if !matches!(self.targets.get(tid), Some(TargetLifecycle::Owned { .. })) {
                            return Err("Command disallowed in target-scoped DevTools");
                        }
                        return Ok(PendingRequestKind::GetTargetInfo {
                            expected_target_id: tid.to_string(),
                        });
                    }
                }
                Ok(PendingRequestKind::GetTargetInfo {
                    expected_target_id: caller_target_id.to_string(),
                })
            }
            "Target.attachToTarget" => {
                let params = params_obj.ok_or("Command disallowed in target-scoped DevTools")?;
                if !params.keys().all(|k| matches!(k.as_str(), "targetId" | "flatten")) {
                    return Err("Command disallowed in target-scoped DevTools");
                }
                if params.get("flatten").and_then(Value::as_bool) != Some(true) {
                    return Err("Command disallowed in target-scoped DevTools");
                }
                let tid = valid_cdp_id_str(params.get("targetId"))
                    .ok_or("Command disallowed in target-scoped DevTools")?;
                if !matches!(self.targets.get(tid), Some(TargetLifecycle::Owned { .. })) {
                    return Err("Command disallowed in target-scoped DevTools");
                }
                Ok(PendingRequestKind::AttachToTarget {
                    expected_target_id: tid.to_string(),
                })
            }
            "Target.detachFromTarget" => {
                let params = params_obj.ok_or("Command disallowed in target-scoped DevTools")?;
                if !params
                    .keys()
                    .all(|k| matches!(k.as_str(), "sessionId" | "targetId"))
                {
                    return Err("Command disallowed in target-scoped DevTools");
                }
                let target_sid = valid_cdp_id_str(params.get("sessionId"))
                    .ok_or("Command disallowed in target-scoped DevTools")?;
                let Some(SessionLifecycle::Owned { target_id, .. }) =
                    self.sessions.get(target_sid)
                else {
                    return Err("Command disallowed in target-scoped DevTools");
                };
                if let Some(caller_sid) = caller_session_id {
                    if target_sid != caller_sid && !self.is_descendant_session(target_sid, caller_sid) {
                        return Err("Command disallowed in target-scoped DevTools");
                    }
                }
                if let Some(raw_tid) = params.get("targetId") {
                    let tid = valid_cdp_id_str(Some(raw_tid))
                        .ok_or("Command disallowed in target-scoped DevTools")?;
                    if tid != target_id {
                        return Err("Command disallowed in target-scoped DevTools");
                    }
                }
                Ok(PendingRequestKind::DetachFromTarget {
                    target_session_id: target_sid.to_string(),
                })
            }
            "Target.setAutoAttach" => {
                let params = params_obj.ok_or("Command disallowed in target-scoped DevTools")?;
                if !params.keys().all(|k| {
                    matches!(
                        k.as_str(),
                        "autoAttach" | "waitForDebuggerOnStart" | "flatten" | "filter"
                    )
                }) {
                    return Err("Command disallowed in target-scoped DevTools");
                }
                let auto_attach = params
                    .get("autoAttach")
                    .and_then(Value::as_bool)
                    .ok_or("Command disallowed in target-scoped DevTools")?;
                let wait_for_debugger = params
                    .get("waitForDebuggerOnStart")
                    .and_then(Value::as_bool)
                    .ok_or("Command disallowed in target-scoped DevTools")?;
                if params.get("flatten").and_then(Value::as_bool) != Some(true) {
                    return Err("Command disallowed in target-scoped DevTools");
                }
                // Never trust client-supplied Target.setAutoAttach filters: enforce server allowlist
                // for exclusive child target types only so unrelated tabs/workers are never paused.
                val["params"] = json!({
                    "autoAttach": auto_attach,
                    "waitForDebuggerOnStart": wait_for_debugger,
                    "flatten": true,
                    "filter": [
                        { "type": "iframe", "exclude": false },
                        { "type": "worker", "exclude": false },
                        { "exclude": true }
                    ]
                });
                Ok(PendingRequestKind::SetAutoAttach)
            }
            _ => Err("Command disallowed in target-scoped DevTools"),
        }
    }

    fn is_descendant_session(&self, candidate: &str, ancestor: &str) -> bool {
        let mut cursor = candidate;
        for _ in 0..=self.sessions.len() {
            match self.sessions.get(cursor) {
                Some(SessionLifecycle::Owned {
                    parent_session_id: Some(parent),
                    ..
                }) => {
                    if parent == ancestor {
                        return true;
                    }
                    cursor = parent.as_str();
                }
                _ => return false,
            }
        }
        false
    }

    /// Filters, correlates, and updates positive ownership state for one upstream CDP frame.
    pub fn process_upstream_message(&mut self, raw: &str) -> UpstreamVerdict {
        if devtools_json_memory_bound(raw).is_none() {
            return UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            };
        }
        let Ok(val) = serde_json::from_str::<Value>(raw) else {
            return UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            };
        };
        let Some(obj) = val.as_object() else {
            return UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            };
        };

        if let Some(raw_sid) = obj.get("sessionId") {
            if valid_cdp_id_str(Some(raw_sid)).is_none() {
                return UpstreamVerdict::CloseConnection {
                    internal_commands: Vec::new(),
                };
            }
        }
        let envelope_sid = obj.get("sessionId").and_then(Value::as_str);

        if let Some(id_val) = obj.get("id") {
            let Some(call_id) = id_val.as_u64() else {
                return UpstreamVerdict::CloseConnection {
                    internal_commands: Vec::new(),
                };
            };
            if obj.get("method").is_some() {
                return UpstreamVerdict::CloseConnection {
                    internal_commands: Vec::new(),
                };
            }
            return self.process_upstream_response(call_id, envelope_sid, &val);
        }

        let Some(method) = obj.get("method").and_then(Value::as_str) else {
            return UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            };
        };

        self.process_upstream_event(raw, method, envelope_sid, &val)
    }

    fn process_upstream_response(
        &mut self,
        call_id: u64,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        if call_id > CLIENT_CALL_ID_MAX {
            if self.pending_internal_detaches.remove(&call_id) {
                return UpstreamVerdict::Suppress {
                    internal_commands: Vec::new(),
                };
            }
            return UpstreamVerdict::PassToInternalReply;
        }

        let key = (envelope_sid.map(str::to_string), call_id);
        let Some(pending) = self.pending_requests.remove(&key) else {
            // Unsolicited or already-retired response: never passthrough.
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        };

        let envelope_live = match envelope_sid {
            None => !self.root_detached,
            Some(sid) => self.is_session_owned(sid),
        };
        if !envelope_live {
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        }

        match pending {
            PendingRequestKind::General | PendingRequestKind::SetAutoAttach => {
                UpstreamVerdict::Forward
            }
            PendingRequestKind::GetTargetInfo { expected_target_id } => {
                if val.get("error").is_some() {
                    return UpstreamVerdict::ForwardText(correlated_error_json(
                        call_id,
                        envelope_sid,
                        -32601,
                        "Command disallowed in target-scoped DevTools",
                    ));
                }
                let Some(info) = val.pointer("/result/targetInfo") else {
                    return UpstreamVerdict::ForwardText(correlated_error_json(
                        call_id,
                        envelope_sid,
                        -32601,
                        "Command disallowed in target-scoped DevTools",
                    ));
                };
                let actual_tid = valid_cdp_id_str(info.get("targetId"));
                let actual_type = info.get("type").and_then(Value::as_str);
                let expected_kind = match self.targets.get(&expected_target_id) {
                    Some(TargetLifecycle::Owned { target_type, .. }) => Some(*target_type),
                    _ => None,
                };
                if actual_tid == Some(expected_target_id.as_str())
                    && expected_kind.is_some_and(|k| actual_type == Some(k.as_cdp_type()))
                {
                    UpstreamVerdict::Forward
                } else {
                    UpstreamVerdict::ForwardText(correlated_error_json(
                        call_id,
                        envelope_sid,
                        -32601,
                        "Command disallowed in target-scoped DevTools",
                    ))
                }
            }
            PendingRequestKind::AttachToTarget { expected_target_id } => {
                if val.get("error").is_some() {
                    return UpstreamVerdict::ForwardText(correlated_error_json(
                        call_id,
                        envelope_sid,
                        -32601,
                        "Command disallowed in target-scoped DevTools",
                    ));
                }
                let Some(new_sid) = valid_cdp_id_str(val.pointer("/result/sessionId")) else {
                    return UpstreamVerdict::ForwardText(correlated_error_json(
                        call_id,
                        envelope_sid,
                        -32601,
                        "Command disallowed in target-scoped DevTools",
                    ));
                };
                let expected_kind = match self.targets.get(&expected_target_id) {
                    Some(TargetLifecycle::Owned { target_type, .. }) => *target_type,
                    _ => {
                        let Ok(cmd) = self.build_internal_detach(new_sid) else {
                            return UpstreamVerdict::CloseConnection {
                                internal_commands: Vec::new(),
                            };
                        };
                        return UpstreamVerdict::ClientReplyAndDetach {
                            client_text: correlated_error_json(
                                call_id,
                                envelope_sid,
                                -32601,
                                "Command disallowed in target-scoped DevTools",
                            ),
                            internal_commands: vec![cmd],
                        };
                    }
                };
                match self.sessions.get(new_sid) {
                    Some(SessionLifecycle::Owned {
                        target_id,
                        parent_session_id,
                        ..
                    }) if target_id == &expected_target_id
                        && parent_session_id.as_deref() == envelope_sid =>
                    {
                        UpstreamVerdict::Forward
                    }
                    None if self.sessions.len() < MAX_OWNED_SESSIONS => {
                        self.sessions.insert(
                            new_sid.to_string(),
                            SessionLifecycle::Owned {
                                target_id: expected_target_id,
                                target_type: expected_kind,
                                parent_session_id: envelope_sid.map(str::to_string),
                            },
                        );
                        UpstreamVerdict::Forward
                    }
                    existing => {
                        if matches!(
                            existing,
                            Some(SessionLifecycle::Pending { .. } | SessionLifecycle::Owned { .. })
                        ) {
                            self.retire_session_subtree(new_sid);
                        }
                        let Ok(cmd) = self.build_internal_detach(new_sid) else {
                            return UpstreamVerdict::CloseConnection {
                                internal_commands: Vec::new(),
                            };
                        };
                        UpstreamVerdict::ClientReplyAndDetach {
                            client_text: correlated_error_json(
                                call_id,
                                envelope_sid,
                                -32601,
                                "Command disallowed in target-scoped DevTools",
                            ),
                            internal_commands: vec![cmd],
                        }
                    }
                }
            }
            PendingRequestKind::DetachFromTarget { target_session_id } => {
                self.retire_session_subtree(&target_session_id);
                UpstreamVerdict::Forward
            }
        }
    }

    fn process_upstream_event(
        &mut self,
        raw: &str,
        method: &str,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        if disallowed_upstream_event_domain(method) {
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        }

        if method.starts_with("Target.") {
            return self.process_target_event(raw, method, envelope_sid, val);
        }

        let session_owned = match envelope_sid {
            None => !self.root_detached,
            Some(sid) => self.is_session_owned(sid),
        };
        if session_owned {
            UpstreamVerdict::Forward
        } else {
            UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            }
        }
    }

    fn process_target_event(
        &mut self,
        raw: &str,
        method: &str,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        match method {
            "Target.attachedToTarget" => self.handle_attached_to_target(raw, envelope_sid, val),
            "Target.detachedFromTarget" => self.handle_detached_from_target(envelope_sid, val),
            "Target.targetCreated" | "Target.targetInfoChanged" => {
                self.handle_target_created_or_changed(envelope_sid, val)
            }
            "Target.targetDestroyed" | "Target.targetCrashed" => {
                self.handle_target_destroyed_or_crashed(envelope_sid, val)
            }
            // Any other/unknown Target.* event is suppressed by default.
            _ => UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            },
        }
    }

    fn handle_attached_to_target(
        &mut self,
        raw: &str,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        let Some(child_sid) = valid_cdp_id_str(val.pointer("/params/sessionId")) else {
            return UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            };
        };
        if envelope_sid == Some(child_sid) {
            return UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            };
        }

        let parent_valid = match envelope_sid {
            None => !self.root_detached,
            Some(parent_sid) => matches!(
                self.sessions.get(parent_sid),
                Some(SessionLifecycle::Owned { .. } | SessionLifecycle::Pending { .. })
            ),
        };

        let Some(info) = val.pointer("/params/targetInfo") else {
            return self.suppress_and_detach_unowned(child_sid, None);
        };
        let Some(child_tid) = valid_cdp_id_str(info.get("targetId")) else {
            return self.suppress_and_detach_unowned(child_sid, None);
        };
        let child_type_str = info.get("type").and_then(Value::as_str).unwrap_or("");

        if !parent_valid {
            return self.suppress_and_detach_unowned(child_sid, Some(child_tid));
        }

        // If `Target.attachToTarget` response already arrived first and registered this session
        // as Owned for this exact targetId and kind, allow the matching event through.
        if let Some(SessionLifecycle::Owned {
            target_id,
            target_type,
            parent_session_id,
        }) = self.sessions.get(child_sid)
        {
            if target_id == child_tid
                && target_type.as_cdp_type() == child_type_str
                && parent_session_id.as_deref() == envelope_sid
            {
                return UpstreamVerdict::Forward;
            }
            let mismatched_tid = (target_id != child_tid).then_some(child_tid);
            self.retire_session_subtree(child_sid);
            return self.suppress_and_detach_unowned(child_sid, mismatched_tid);
        }
        if let Some(existing) = self.sessions.get(child_sid) {
            let mismatched_tid = match existing {
                SessionLifecycle::Pending { target_id, .. } if target_id != child_tid => {
                    Some(child_tid)
                }
                SessionLifecycle::Detached => Some(child_tid),
                _ => None,
            };
            if matches!(existing, SessionLifecycle::Pending { .. }) {
                self.retire_session_subtree(child_sid);
            }
            return self.suppress_and_detach_unowned(child_sid, mismatched_tid);
        }

        if child_tid == self.root_target_id {
            let requested_root_attach = envelope_sid.is_none()
                && child_type_str == "page"
                && self.pending_requests.values().any(|kind| {
                    matches!(
                        kind,
                        PendingRequestKind::AttachToTarget { expected_target_id }
                            if expected_target_id == &self.root_target_id
                    )
                });
            if !requested_root_attach || self.sessions.len() >= MAX_OWNED_SESSIONS {
                return self.suppress_and_detach_unowned(child_sid, None);
            }
            self.sessions.insert(
                child_sid.to_string(),
                SessionLifecycle::Owned {
                    target_id: self.root_target_id.clone(),
                    target_type: OwnedTargetKind::RootPage,
                    parent_session_id: None,
                },
            );
            return UpstreamVerdict::Forward;
        }

        let Some(kind) = OwnedTargetKind::from_child_cdp_type(child_type_str) else {
            return self.suppress_and_detach_unowned(child_sid, Some(child_tid));
        };

        if matches!(
            self.targets.get(child_tid),
            Some(TargetLifecycle::Foreign | TargetLifecycle::Detached)
        ) {
            return self.suppress_and_detach_unowned(child_sid, None);
        }
        if matches!(
            self.targets.get(child_tid),
            Some(
                TargetLifecycle::Pending { target_type: existing_kind, .. }
                    | TargetLifecycle::Owned { target_type: existing_kind, .. }
            ) if *existing_kind != kind
        ) {
            return self.suppress_and_detach_unowned(child_sid, None);
        }

        if raw.len() > MAX_QUARANTINED_EVENT_BYTES {
            return self.suppress_and_detach_unowned(child_sid, Some(child_tid));
        }

        let pending_count = self
            .sessions
            .values()
            .filter(|s| matches!(s, SessionLifecycle::Pending { .. }))
            .count();
        let new_target_needed = !self.targets.contains_key(child_tid);
        if self.sessions.len() >= MAX_OWNED_SESSIONS
            || pending_count >= MAX_PENDING_ATTACHES
            || (new_target_needed && self.targets.len() >= MAX_TRACKED_TARGETS)
        {
            return match self.build_internal_detach(child_sid) {
                Ok(cmd) => UpstreamVerdict::CloseConnection {
                    internal_commands: vec![cmd],
                },
                Err(()) => UpstreamVerdict::CloseConnection {
                    internal_commands: Vec::new(),
                },
            };
        }

        self.sessions.insert(
            child_sid.to_string(),
            SessionLifecycle::Pending {
                target_id: child_tid.to_string(),
                target_type: kind,
                parent_session_id: envelope_sid.map(str::to_string),
                quarantined_event: Some(raw.to_string()),
            },
        );
        match self.targets.get_mut(child_tid) {
            Some(TargetLifecycle::Pending {
                pending_sessions, ..
            }) => {
                *pending_sessions += 1;
            }
            Some(TargetLifecycle::Owned { .. }) => {}
            None => {
                self.targets.insert(
                    child_tid.to_string(),
                    TargetLifecycle::Pending {
                        target_type: kind,
                        parent_session_id: envelope_sid.map(str::to_string),
                        pending_sessions: 1,
                    },
                );
            }
            Some(TargetLifecycle::Foreign | TargetLifecycle::Detached) => unreachable!(),
        }

        UpstreamVerdict::PendingAttach {
            session_id: child_sid.to_string(),
            target_id: child_tid.to_string(),
            target_type: kind,
        }
    }

    fn suppress_and_detach_unowned(
        &mut self,
        child_sid: &str,
        foreign_tid: Option<&str>,
    ) -> UpstreamVerdict {
        if let Some(tid) = foreign_tid {
            if tid != self.root_target_id
                && !matches!(
                    self.targets.get(tid),
                    Some(TargetLifecycle::Owned { .. } | TargetLifecycle::Pending { .. })
                )
                && (self.targets.contains_key(tid) || self.targets.len() < MAX_TRACKED_TARGETS)
            {
                self.targets.insert(tid.to_string(), TargetLifecycle::Foreign);
            }
        }
        if !self.sessions.contains_key(child_sid) && self.sessions.len() < MAX_OWNED_SESSIONS {
            self.sessions
                .insert(child_sid.to_string(), SessionLifecycle::Detached);
        }
        match self.build_internal_detach(child_sid) {
            Ok(cmd) => UpstreamVerdict::Suppress {
                internal_commands: vec![cmd],
            },
            Err(()) => UpstreamVerdict::CloseConnection {
                internal_commands: Vec::new(),
            },
        }
    }

    fn handle_detached_from_target(
        &mut self,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        let envelope_valid = match envelope_sid {
            None => !self.root_detached,
            Some(sid) => matches!(
                self.sessions.get(sid),
                Some(SessionLifecycle::Owned { .. } | SessionLifecycle::Pending { .. })
            ),
        };
        let Some(detached_sid) = valid_cdp_id_str(val.pointer("/params/sessionId")) else {
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        };
        let was_owned = self.is_session_owned(detached_sid);
        let was_pending = matches!(
            self.sessions.get(detached_sid),
            Some(SessionLifecycle::Pending { .. })
        );
        if was_owned || was_pending {
            self.retire_session_subtree(detached_sid);
        }
        if envelope_valid && was_owned {
            UpstreamVerdict::Forward
        } else {
            UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            }
        }
    }

    fn handle_target_created_or_changed(
        &mut self,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        let envelope_owned = match envelope_sid {
            None => !self.root_detached,
            Some(sid) => self.is_session_owned(sid),
        };
        let Some(info) = val.pointer("/params/targetInfo") else {
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        };
        let Some(tid) = valid_cdp_id_str(info.get("targetId")) else {
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        };
        let target_type = info.get("type").and_then(Value::as_str);

        if let Some(TargetLifecycle::Owned { target_type: kind, .. }) = self.targets.get(tid) {
            if envelope_owned && target_type == Some(kind.as_cdp_type()) {
                return UpstreamVerdict::Forward;
            }
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        }

        // Unseen target in targetCreated / targetInfoChanged is NEVER promoted by type alone.
        if !self.targets.contains_key(tid) && self.targets.len() < MAX_TRACKED_TARGETS {
            self.targets.insert(tid.to_string(), TargetLifecycle::Foreign);
        }
        UpstreamVerdict::Suppress {
            internal_commands: Vec::new(),
        }
    }

    fn handle_target_destroyed_or_crashed(
        &mut self,
        envelope_sid: Option<&str>,
        val: &Value,
    ) -> UpstreamVerdict {
        let envelope_owned = match envelope_sid {
            None => !self.root_detached,
            Some(sid) => self.is_session_owned(sid),
        };
        let Some(tid) = valid_cdp_id_str(val.pointer("/params/targetId")) else {
            return UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            };
        };
        if tid == self.root_target_id {
            self.root_detached = true;
            self.targets
                .insert(self.root_target_id.clone(), TargetLifecycle::Detached);
            let all_sids: Vec<String> = self.sessions.keys().cloned().collect();
            for sid in all_sids {
                self.retire_session_entry(&sid);
            }
            return if envelope_owned {
                UpstreamVerdict::Forward
            } else {
                UpstreamVerdict::Suppress {
                    internal_commands: Vec::new(),
                }
            };
        }
        match self.targets.get(tid).cloned() {
            Some(TargetLifecycle::Owned { .. }) => {
                self.retire_target_sessions(tid);
                self.targets.insert(tid.to_string(), TargetLifecycle::Detached);
                if envelope_owned {
                    UpstreamVerdict::Forward
                } else {
                    UpstreamVerdict::Suppress {
                        internal_commands: Vec::new(),
                    }
                }
            }
            Some(TargetLifecycle::Pending { .. }) => {
                self.retire_target_sessions(tid);
                self.targets.insert(tid.to_string(), TargetLifecycle::Detached);
                UpstreamVerdict::Suppress {
                    internal_commands: Vec::new(),
                }
            }
            _ => UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            },
        }
    }

    fn retire_target_sessions(&mut self, tid: &str) {
        let matching: Vec<String> = self
            .sessions
            .iter()
            .filter_map(|(sid, state)| match state {
                SessionLifecycle::Owned { target_id, .. }
                | SessionLifecycle::Pending { target_id, .. }
                    if target_id == tid =>
                {
                    Some(sid.clone())
                }
                _ => None,
            })
            .collect();
        for sid in matching {
            self.retire_session_subtree(&sid);
        }
    }

    fn retire_session_subtree(&mut self, root_sid: &str) {
        let mut queue = vec![root_sid.to_string()];
        let mut seen = HashSet::new();
        while let Some(current) = queue.pop() {
            if !seen.insert(current.clone()) {
                continue;
            }
            let children: Vec<String> = self
                .sessions
                .iter()
                .filter_map(|(sid, state)| match state {
                    SessionLifecycle::Owned { parent_session_id, .. }
                    | SessionLifecycle::Pending { parent_session_id, .. }
                        if parent_session_id.as_deref() == Some(current.as_str()) =>
                    {
                        Some(sid.clone())
                    }
                    _ => None,
                })
                .collect();
            queue.extend(children);

            let prev_target = match self.sessions.get(&current) {
                Some(SessionLifecycle::Owned { target_id, .. })
                | Some(SessionLifecycle::Pending { target_id, .. }) => Some(target_id.clone()),
                _ => None,
            };
            self.retire_session_entry(&current);
            if let Some(tid) = prev_target {
                if tid != self.root_target_id {
                    let still_has_session = self.sessions.values().any(|s| match s {
                        SessionLifecycle::Owned { target_id, .. }
                        | SessionLifecycle::Pending { target_id, .. } => target_id == &tid,
                        SessionLifecycle::Detached => false,
                    });
                    if !still_has_session {
                        self.targets.insert(tid, TargetLifecycle::Detached);
                    }
                }
            }
        }
    }

    fn retire_session_entry(&mut self, sid: &str) {
        if let Some(entry) = self.sessions.get_mut(sid) {
            *entry = SessionLifecycle::Detached;
        }
        let mut drained = Vec::new();
        self.pending_requests.retain(|(req_sid, call_id), _| {
            if req_sid.as_deref() == Some(sid) {
                drained.push(*call_id);
                false
            } else {
                true
            }
        });
        for call_id in drained {
            if self.retired_client_replies.len() < MAX_PENDING_REQUESTS {
                self.retired_client_replies.push(correlated_error_json(
                    call_id,
                    Some(sid),
                    -32601,
                    "Command disallowed in target-scoped DevTools",
                ));
            }
        }
    }

    fn build_internal_detach(&mut self, session_id: &str) -> Result<String, ()> {
        if self.pending_internal_detaches.len() >= MAX_PENDING_INTERNAL_DETACHES {
            return Err(());
        }
        let cid = self.next_internal_id;
        if cid > i32::MAX as u64 {
            return Err(());
        }
        self.next_internal_id = cid + 1;
        tracing::debug!(session_id, internal_call_id = cid, "DevTools filter queueing internal Target.detachFromTarget");
        self.pending_internal_detaches.insert(cid);
        Ok(json!({
            "id": cid,
            "method": "Target.detachFromTarget",
            "params": { "sessionId": session_id }
        })
        .to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reject_code(msg: ClassifiedDevToolsMessage) -> Option<i64> {
        match msg {
            ClassifiedDevToolsMessage::Reject(Some(reply)) => {
                serde_json::from_str::<Value>(&reply).ok()?["error"]["code"].as_i64()
            }
            _ => None,
        }
    }

    #[test]
    fn json_memory_bound_caps_message_size_depth_and_token_count() {
        let mut filter = DevToolsSessionFilter::new("T1");
        let ordinary = r#"{"id":1,"method":"Runtime.enable","params":{"expression":"a\\\"b"}}"#;
        assert!(devtools_json_memory_bound(ordinary).is_some());

        let dense_values = vec!["0"; MAX_DEVTOOLS_JSON_NODES + 1].join(",");
        let dense = format!(
            r#"{{"id":1,"method":"Runtime.evaluate","params":{{"value":[{dense_values}]}}}}"#
        );
        assert_eq!(devtools_json_memory_bound(&dense), None);
        assert_eq!(
            filter.classify_client_message(&dense),
            ClassifiedDevToolsMessage::Reject(None)
        );

        let deep = format!(
            "{}0{}",
            "[".repeat(MAX_DEVTOOLS_JSON_DEPTH + 1),
            "]".repeat(MAX_DEVTOOLS_JSON_DEPTH + 1)
        );
        assert_eq!(devtools_json_memory_bound(&deep), None);
        let oversized = "x".repeat(MAX_WS_MESSAGE_BYTES + 1);
        assert_eq!(devtools_json_memory_bound(&oversized), None);
        let short_keys = (0..3_000)
            .map(|index| format!(r#""k{index}":0"#))
            .collect::<Vec<_>>()
            .join(",");
        let many_keys = format!(
            r#"{{"id":1,"method":"Runtime.evaluate","params":{{{short_keys}}}}}"#
        );
        assert!(devtools_json_memory_bound(&many_keys).is_some());
    }

    #[tokio::test]
    async fn json_memory_reservation_releases_when_parse_task_is_cancelled() {
        let bytes = devtools_json_memory_bound(r#"{"id":1,"method":"Runtime.enable"}"#).unwrap();
        let controller =
            crate::browser_host::diagnostics::MemoryAdmissionController::new(bytes);
        let task_controller = controller.clone();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let reservation = task_controller.try_reserve(bytes).unwrap();
            started_tx.send(()).unwrap();
            std::future::pending::<()>().await;
            drop(reservation);
        });
        started_rx.await.unwrap();
        assert_eq!(controller.current_reserved_bytes(), bytes);
        task.abort();
        let _ = task.await;
        assert_eq!(controller.current_reserved_bytes(), 0);
    }

    #[test]
    fn path_validation_rejects_traversal_and_allows_nested_modules() {
        assert!(validate_devtools_asset_path("devtools_app.html").is_ok());
        assert!(validate_devtools_asset_path("panels/network/network.js").is_ok());
        assert!(validate_devtools_asset_path("").is_err());
        assert!(validate_devtools_asset_path("/devtools_app.html").is_err());
        assert!(validate_devtools_asset_path("../secret").is_err());
        assert!(validate_devtools_asset_path("a\\b").is_err());
        assert!(validate_devtools_asset_path("devtools_app.html?x=1").is_err());
    }

    #[test]
    fn client_filter_blocks_nonlocal_effects_and_disallowed_target_routes() {
        let mut filter = DevToolsSessionFilter::new("T1");
        let mut next_id = 1u64;
        for method in [
            "Browser.getVersion",
            "Target.getTargets",
            "Target.sendMessageToTarget",
            "Target.createTarget",
            "Target.closeTarget",
            "Target.activateTarget",
            "Target.exposeDevToolsProtocol",
            "Target.disposeBrowserContext",
            "Target.createBrowserContext",
            "Target.getBrowserContexts",
            "Target.setDiscoverTargets",
            "Target.setRemoteLocations",
            "Target.autoAttachRelated",
            "Target.unknownFutureMethod",
            "Emulation.setDeviceMetricsOverride",
            "Emulation.clearDeviceMetricsOverride",
            "Emulation.setPageScaleFactor",
            "Emulation.setVisibleSize",
            "Page.setDownloadBehavior",
            "ServiceWorker.enable",
            "ServiceWorker.stopAllWorkers",
            "ServiceWorker.stopWorker",
            "ServiceWorker.unregister",
            "ServiceWorker.updateRegistration",
            "ServiceWorker.startWorker",
            "ServiceWorker.deliverPushMessage",
            "BackgroundService.startObserving",
            "BackgroundService.setRecording",
            "Storage.getCookies",
            "Network.setCookie",
            "Network.getAllCookies",
            "Network.getCookies",
            "Network.setCookies",
            "Network.deleteCookies",
            "Network.clearBrowserCookies",
            "Network.clearBrowserCache",
        ] {
            let msg = json!({"id": next_id, "method": method, "params": {}}).to_string();
            next_id += 1;
            assert_eq!(
                reject_code(filter.classify_client_message(&msg)),
                Some(-32601),
                "expected -32601 for {method}"
            );
        }

        // Unknown / foreign targetId in getTargetInfo / attachToTarget / detachFromTarget denied.
        for req in [
            json!({"id": 200, "method": "Target.getTargetInfo", "params": {"targetId": "FOREIGN"}}),
            json!({"id": 201, "method": "Target.attachToTarget", "params": {"targetId": "FOREIGN", "flatten": true}}),
            json!({"id": 202, "method": "Target.attachToTarget", "params": {"targetId": "T1", "flatten": false}}),
            json!({"id": 203, "method": "Target.attachToTarget", "params": {"targetId": "T1"}}),
            json!({"id": 204, "method": "Target.detachFromTarget", "params": {"sessionId": "unknown"}}),
            json!({"id": 205, "method": "Target.autoAttachRelated", "params": {"targetId": "T1", "waitForDebuggerOnStart": false}}),
            json!({"id": 206, "method": "Target.setAutoAttach", "params": {"autoAttach": true, "waitForDebuggerOnStart": false}}),
        ] {
            assert_eq!(
                reject_code(filter.classify_client_message(&req.to_string())),
                Some(-32601),
                "expected rejection for {req}"
            );
        }

        // Target.setAutoAttach rewrites client filter so foreign/service_worker/page are excluded.
        let auto_attach = json!({
            "id": 207,
            "method": "Target.setAutoAttach",
            "params": {
                "autoAttach": true,
                "waitForDebuggerOnStart": true,
                "flatten": true,
                "filter": [{"type": "service_worker", "exclude": false}, {"type": "page", "exclude": false}]
            }
        });
        let ClassifiedDevToolsMessage::Forward { json: rewritten, .. } =
            filter.classify_client_message(&auto_attach.to_string())
        else {
            panic!("expected Target.setAutoAttach forward");
        };
        let parsed: Value = serde_json::from_str(&rewritten).unwrap();
        assert_eq!(
            parsed["params"]["filter"],
            json!([
                {"type": "iframe", "exclude": false},
                {"type": "worker", "exclude": false},
                {"exclude": true}
            ])
        );

        // Unknown sessionId rejected before method policy.
        let unknown_session = json!({"id": 208, "sessionId": "unknown", "method": "Runtime.enable"});
        let ClassifiedDevToolsMessage::Reject(Some(reply)) =
            filter.classify_client_message(&unknown_session.to_string())
        else {
            panic!("expected correlated rejection");
        };
        let reply_val: Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(reply_val["id"], 208);
        assert_eq!(reply_val["sessionId"], "unknown");
        assert_eq!(reply_val["error"]["code"], -32601);

        // Malformed / oversized / invalid envelopes.
        assert_eq!(
            filter.classify_client_message(r#"[{"id":1,"method":"Runtime.enable"}]"#),
            ClassifiedDevToolsMessage::Reject(None)
        );
        assert_eq!(
            filter.classify_client_message("{"),
            ClassifiedDevToolsMessage::Reject(None)
        );
        assert_eq!(
            filter.classify_client_message(r#"{"id":1,"sessionId":"","method":"Runtime.enable"}"#),
            ClassifiedDevToolsMessage::Reject(None)
        );
    }

    #[test]
    fn upstream_suppresses_unknown_target_types_and_service_worker_metadata() {
        let mut filter = DevToolsSessionFilter::new("T1");
        // targetCreated for ANY unknown target (even type="worker" or "iframe") is suppressed!
        for ttype in ["page", "browser_ui", "browser", "iframe", "worker", "shared_worker", "service_worker", "unknown_kind"] {
            let evt = json!({
                "method": "Target.targetCreated",
                "params": { "targetInfo": { "targetId": format!("FOREIGN-{ttype}"), "type": ttype, "url": "https://b.test/" } }
            })
            .to_string();
            assert_eq!(
                filter.process_upstream_message(&evt),
                UpstreamVerdict::Suppress { internal_commands: Vec::new() },
                "must suppress unseen targetCreated for {ttype}"
            );
            // Subsequent getTargetInfo or attachToTarget for that foreign ID stays denied.
            let query = json!({"id": 1, "method": "Target.getTargetInfo", "params": {"targetId": format!("FOREIGN-{ttype}")}}).to_string();
            assert_eq!(reject_code(filter.classify_client_message(&query)), Some(-32601));
        }

        // attachedToTarget for foreign/ambiguous types (page, shared_worker, service_worker, browser, unknown)
        // must suppress AND emit internal Target.detachFromTarget without resuming!
        for (idx, ttype) in ["page", "shared_worker", "service_worker", "browser_ui", "unknown"].iter().enumerate() {
            let sid = format!("BAD-S-{idx}");
            let tid = format!("BAD-T-{idx}");
            let attach = json!({
                "method": "Target.attachedToTarget",
                "params": {
                    "sessionId": sid,
                    "targetInfo": { "targetId": tid, "type": ttype, "url": "https://b.test/sw.js" },
                    "waitingForDebugger": true
                }
            })
            .to_string();
            let UpstreamVerdict::Suppress { internal_commands } = filter.process_upstream_message(&attach) else {
                panic!("expected suppress+detach for {ttype}");
            };
            assert_eq!(internal_commands.len(), 1);
            let detach_cmd: Value = serde_json::from_str(&internal_commands[0]).unwrap();
            assert_eq!(detach_cmd["method"], "Target.detachFromTarget");
            assert_eq!(detach_cmd["params"]["sessionId"], sid);
            // Reply to internal detach is consumed silently.
            let internal_reply = json!({"id": detach_cmd["id"], "result": {}}).to_string();
            assert_eq!(
                filter.process_upstream_message(&internal_reply),
                UpstreamVerdict::Suppress { internal_commands: Vec::new() }
            );
        }

        // ServiceWorker.* events with embedded arrays and escaped names are suppressed.
        for evt in [
            json!({"method": "ServiceWorker.workerRegistrationUpdated", "params": {"registrations": [{"registrationId": "r1", "scopeURL": "https://b.test/"}]}}).to_string(),
            json!({"method": "ServiceWorker.workerVersionUpdated", "params": {"versions": [{"versionId": "v1", "scriptURL": "https://b.test/sw.js", "targetId": "B-SW", "controlledClients": ["C1"]}]}}).to_string(),
            json!({"method": "ServiceWorker.workerErrorReported", "params": {"errorMessage": {"registrationId": "r1"}}}).to_string(),
            r#"{"method":"Service\u0057orker.workerRegistrationUpdated","sessionId":"any","params":{"registrations":[]}}"#.to_string(),
            json!({"method": "Storage.cacheStorageListUpdated", "params": {"origin": "https://b.test"}}).to_string(),
            json!({"method": "BackgroundService.recordingStateChanged", "params": {"service": "backgroundFetch"}}).to_string(),
            json!({"method": "Target.receivedMessageFromTarget", "params": {"sessionId": "S1", "message": "{}"}}).to_string(),
        ] {
            assert_eq!(
                filter.process_upstream_message(&evt),
                UpstreamVerdict::Suppress { internal_commands: Vec::new() }
            );
        }
    }

    #[test]
    fn pending_quarantine_blocks_until_promoted_and_enforces_nonlocal_and_detach_on_children() {
        let mut filter = DevToolsSessionFilter::new("ROOT-T");
        let attach = json!({
            "method": "Target.attachedToTarget",
            "params": {
                "sessionId": "CHILD-S1",
                "targetInfo": { "targetId": "CHILD-T1", "type": "iframe", "url": "https://a.test/frame" },
                "waitingForDebugger": true
            }
        })
        .to_string();
        assert_eq!(
            filter.process_upstream_message(&attach),
            UpstreamVerdict::PendingAttach {
                session_id: "CHILD-S1".into(),
                target_id: "CHILD-T1".into(),
                target_type: OwnedTargetKind::Iframe,
            }
        );

        // While Pending: client commands, getTargetInfo, attachToTarget, and upstream events are blocked!
        assert_eq!(
            reject_code(filter.classify_client_message(
                &json!({"id": 1, "sessionId": "CHILD-S1", "method": "Runtime.enable"}).to_string()
            )),
            Some(-32601)
        );
        assert_eq!(
            reject_code(filter.classify_client_message(
                &json!({"id": 2, "method": "Target.getTargetInfo", "params": {"targetId": "CHILD-T1"}}).to_string()
            )),
            Some(-32601)
        );
        assert_eq!(
            filter.process_upstream_message(
                &json!({"method": "Runtime.consoleAPICalled", "sessionId": "CHILD-S1", "params": {}}).to_string()
            ),
            UpstreamVerdict::Suppress { internal_commands: Vec::new() }
        );

        // Promote Pending -> Owned.
        let held = filter.promote_pending_attach("CHILD-S1").expect("held event");
        assert!(held.contains("CHILD-T1"));

        // Owned child supports Runtime/Target.getTargetInfo/Input, but STILL blocks ServiceWorker/download/Browser!
        assert!(matches!(
            filter.classify_client_message(
                &json!({"id": 3, "sessionId": "CHILD-S1", "method": "Runtime.enable"}).to_string()
            ),
            ClassifiedDevToolsMessage::Forward { .. }
        ));
        assert_eq!(
            reject_code(filter.classify_client_message(
                &json!({"id": 4, "sessionId": "CHILD-S1", "method": "Page.setDownloadBehavior", "params": {"behavior": "allow", "downloadPath": "/tmp/x"}}).to_string()
            )),
            Some(-32601)
        );
        assert_eq!(
            reject_code(filter.classify_client_message(
                &json!({"id": 5, "sessionId": "CHILD-S1", "method": "ServiceWorker.stopAllWorkers"}).to_string()
            )),
            Some(-32601)
        );

        // Correlated getTargetInfo mismatch from upstream returns uniform error without leaking foreign data.
        assert!(matches!(
            filter.classify_client_message(
                &json!({"id": 6, "method": "Target.getTargetInfo", "params": {"targetId": "CHILD-T1"}}).to_string()
            ),
            ClassifiedDevToolsMessage::Forward { .. }
        ));
        let spoofed_reply = json!({
            "id": 6,
            "result": { "targetInfo": { "targetId": "FOREIGN-TAB", "type": "page", "url": "https://secret.test/" } }
        })
        .to_string();
        let UpstreamVerdict::ForwardText(safe_err) = filter.process_upstream_message(&spoofed_reply) else {
            panic!("expected safe correlated error");
        };
        assert!(!safe_err.contains("FOREIGN-TAB"));
        assert!(!safe_err.contains("secret.test"));
        assert_eq!(serde_json::from_str::<Value>(&safe_err).unwrap()["error"]["code"], -32601);

        // Unsolicited response ID never passes through.
        assert_eq!(
            filter.process_upstream_message(&json!({"id": 999, "result": {"targetInfos": []}}).to_string()),
            UpstreamVerdict::Suppress { internal_commands: Vec::new() }
        );

        // Detached child session & target stay permanently denied.
        let detach_evt = json!({
            "method": "Target.detachedFromTarget",
            "params": { "sessionId": "CHILD-S1", "targetId": "CHILD-T1" }
        })
        .to_string();
        assert_eq!(filter.process_upstream_message(&detach_evt), UpstreamVerdict::Forward);
        assert_eq!(
            reject_code(filter.classify_client_message(
                &json!({"id": 7, "sessionId": "CHILD-S1", "method": "Runtime.enable"}).to_string()
            )),
            Some(-32601)
        );
        assert_eq!(
            reject_code(filter.classify_client_message(
                &json!({"id": 8, "method": "Target.attachToTarget", "params": {"targetId": "CHILD-T1", "flatten": true}}).to_string()
            )),
            Some(-32601)
        );
    }

    #[test]
    fn capacity_exhaustion_rejects_or_closes_without_clearing_state() {
        let mut filter = DevToolsSessionFilter::new("ROOT-T");
        for i in 0..MAX_OWNED_SESSIONS {
            let sid = format!("S-{i}");
            let tid = format!("T-{i}");
            let attach = json!({
                "method": "Target.attachedToTarget",
                "params": {
                    "sessionId": sid,
                    "targetInfo": { "targetId": tid, "type": "worker" }
                }
            })
            .to_string();
            assert!(matches!(
                filter.process_upstream_message(&attach),
                UpstreamVerdict::PendingAttach { .. }
            ));
            assert!(filter.promote_pending_attach(&sid).is_some());
        }
        let overflow_attach = json!({
            "method": "Target.attachedToTarget",
            "params": {
                "sessionId": "S-OVERFLOW",
                "targetInfo": { "targetId": "T-OVERFLOW", "type": "worker" }
            }
        })
        .to_string();
        let UpstreamVerdict::CloseConnection { internal_commands } =
            filter.process_upstream_message(&overflow_attach)
        else {
            panic!("session capacity exhaustion must close connection");
        };
        assert_eq!(internal_commands.len(), 1);
    }

    #[test]
    fn input_inventory_classifies_supported_and_denies_unsupported_stateful_methods() {
        let mut filter = DevToolsSessionFilter::new("T1");
        let mut id = 1u64;
        for (req, expected) in [
            (
                json!({"method": "Input.dispatchKeyEvent", "params": {"type": "keyDown", "key": "a", "code": "KeyA", "modifiers": 2}}),
                CdpInputEffect::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 2 },
            ),
            (
                json!({"method": "Input.dispatchKeyEvent", "params": {"type": "rawKeyDown", "key": "Shift", "code": "ShiftLeft", "modifiers": 8, "autoRepeat": true}}),
                CdpInputEffect::KeyDown { key: "Shift".into(), code: "ShiftLeft".into(), modifiers: 8 },
            ),
            (
                json!({"method": "Input.dispatchKeyEvent", "params": {"type": "keyUp", "key": "a", "code": "KeyA", "modifiers": 0}}),
                CdpInputEffect::KeyUp { key: "a".into(), code: "KeyA".into(), modifiers: 0 },
            ),
            (
                json!({"method": "Input.dispatchKeyEvent", "params": {"type": "char", "text": "a"}}),
                CdpInputEffect::NonHeld,
            ),
            (
                json!({"method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "button": "left", "x": 120.5, "y": 240.0, "modifiers": 1}}),
                CdpInputEffect::MouseDown { button: MouseButton::Left, x: 120.5, y: 240.0, modifiers: 1 },
            ),
            (
                json!({"method": "Input.dispatchMouseEvent", "params": {"type": "mouseReleased", "button": "left", "x": 120.5, "y": 240.0, "modifiers": 0}}),
                CdpInputEffect::MouseUp { button: MouseButton::Left, x: 120.5, y: 240.0, modifiers: 0 },
            ),
            (
                json!({"method": "Input.dispatchMouseEvent", "params": {"type": "mouseMoved", "x": 50.0, "y": 60.0}}),
                CdpInputEffect::PointerMove { x: 50.0, y: 60.0, modifiers: 0 },
            ),
            (
                json!({"method": "Input.dispatchMouseEvent", "params": {"type": "mouseWheel", "x": 50.0, "y": 60.0, "deltaX": 0.0, "deltaY": -120.0}}),
                CdpInputEffect::PointerMove { x: 50.0, y: 60.0, modifiers: 0 },
            ),
            (
                json!({"method": "Input.insertText", "params": {"text": "hello"}}),
                CdpInputEffect::NonHeld,
            ),
        ] {
            let mut full = req;
            full["id"] = json!(id);
            id += 1;
            let ClassifiedDevToolsMessage::Forward { input_effect, .. } =
                filter.classify_client_message(&full.to_string())
            else {
                panic!("expected forward for {full}");
            };
            assert_eq!(input_effect, Some(expected));
        }

        for denied in [
            json!({"method": "Input.dispatchTouchEvent", "params": {"type": "touchStart", "touchPoints": []}}),
            json!({"method": "Input.emulateTouchFromMouseEvent", "params": {"type": "mousePressed", "x": 1, "y": 1, "button": "left", "timestamp": 0}}),
            json!({"method": "Input.dispatchDragEvent", "params": {"type": "dragEnter", "x": 1, "y": 1, "data": {}}}),
            json!({"method": "Input.setInterceptDrags", "params": {"enabled": true}}),
            json!({"method": "Input.cancelDragging", "params": {}}),
            json!({"method": "Input.synthesizeTapGesture", "params": {"x": 1, "y": 1}}),
            json!({"method": "Input.synthesizeScrollGesture", "params": {"x": 1, "y": 1}}),
            json!({"method": "Input.synthesizePinchGesture", "params": {"x": 1, "y": 1, "scaleFactor": 1.5}}),
            json!({"method": "Input.imeSetComposition", "params": {"text": "a", "selectionStart": 0, "selectionEnd": 1}}),
            json!({"method": "Input.imeCancelComposition", "params": {}}),
            json!({"method": "Input.setIgnoreInputEvents", "params": {"ignore": true}}),
            json!({"method": "Input.futureUnknownStatefulCommand", "params": {}}),
            json!({"method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "button": "left", "x": 1, "y": 1, "pointerType": "pen"}}),
            json!({"method": "Input.dispatchKeyEvent", "params": {"type": "keyDown"}}),
        ] {
            let mut full = denied;
            full["id"] = json!(id);
            id += 1;
            assert_eq!(reject_code(filter.classify_client_message(&full.to_string())), Some(-32601));
        }
    }

    #[test]
    fn test_attach_to_target_response_denial_and_collision_returns_correlated_error_and_retires() {
        let mut filter = DevToolsSessionFilter::new("ROOT-T1");

        // Promote CHILD-W1 via attachedToTarget
        assert_eq!(
            filter.process_upstream_message(
                &json!({
                    "method": "Target.attachedToTarget",
                    "params": {
                        "sessionId": "S-W1",
                        "targetInfo": { "targetId": "CHILD-W1", "type": "worker" }
                    }
                })
                .to_string(),
            ),
            UpstreamVerdict::PendingAttach {
                session_id: "S-W1".into(),
                target_id: "CHILD-W1".into(),
                target_type: OwnedTargetKind::DedicatedWorker,
            }
        );
        assert!(filter.promote_pending_attach("S-W1").is_some());

        // Quarantine a Pending attach S-PEND on CHILD-W2
        assert_eq!(
            filter.process_upstream_message(
                &json!({
                    "method": "Target.attachedToTarget",
                    "params": {
                        "sessionId": "S-PEND",
                        "targetInfo": { "targetId": "CHILD-W2", "type": "worker" }
                    }
                })
                .to_string(),
            ),
            UpstreamVerdict::PendingAttach {
                session_id: "S-PEND".into(),
                target_id: "CHILD-W2".into(),
                target_type: OwnedTargetKind::DedicatedWorker,
            }
        );
        assert!(filter.is_session_pending("S-PEND"));

        // Client requests Target.attachToTarget for owned CHILD-W1, but response collides with Pending S-PEND
        let ClassifiedDevToolsMessage::Forward { .. } = filter.classify_client_message(
            &json!({
                "id": 11,
                "method": "Target.attachToTarget",
                "params": { "targetId": "CHILD-W1", "flatten": true }
            })
            .to_string(),
        ) else {
            panic!("expected forward");
        };
        let verdict = filter.process_upstream_message(
            &json!({
                "id": 11,
                "result": { "sessionId": "S-PEND" }
            })
            .to_string(),
        );
        let UpstreamVerdict::ClientReplyAndDetach {
            client_text,
            internal_commands,
        } = verdict
        else {
            panic!("expected ClientReplyAndDetach on session collision, got {verdict:?}");
        };
        let reply: Value = serde_json::from_str(&client_text).unwrap();
        assert_eq!(reply["id"], 11);
        assert_eq!(reply["error"]["code"], -32601);
        assert_eq!(internal_commands.len(), 1);
        assert!(!filter.is_session_pending("S-PEND"));
        assert!(!filter.is_session_owned("S-PEND"));

        // Client requests Target.attachToTarget for owned CHILD-W1, then CHILD-W1 is detached before response
        let ClassifiedDevToolsMessage::Forward { .. } = filter.classify_client_message(
            &json!({
                "id": 12,
                "method": "Target.attachToTarget",
                "params": { "targetId": "CHILD-W1", "flatten": true }
            })
            .to_string(),
        ) else {
            panic!("expected forward");
        };
        assert_eq!(
            filter.process_upstream_message(
                &json!({
                    "method": "Target.targetDestroyed",
                    "params": { "targetId": "CHILD-W1" }
                })
                .to_string(),
            ),
            UpstreamVerdict::Forward
        );
        let verdict2 = filter.process_upstream_message(
            &json!({
                "id": 12,
                "result": { "sessionId": "S-LATE" }
            })
            .to_string(),
        );
        let UpstreamVerdict::ClientReplyAndDetach {
            client_text: c2,
            internal_commands: cmds2,
        } = verdict2
        else {
            panic!("expected ClientReplyAndDetach after target ceased owned, got {verdict2:?}");
        };
        let reply2: Value = serde_json::from_str(&c2).unwrap();
        assert_eq!(reply2["id"], 12);
        assert_eq!(reply2["error"]["code"], -32601);
        assert_eq!(cmds2.len(), 1);
    }

    #[test]
    fn test_attached_to_target_mismatch_or_pending_collision_retires_session_and_tombstones() {
        let mut filter = DevToolsSessionFilter::new("ROOT-T1");

        // Provisionally register S-ATT as Owned for CHILD-W1 via attachToTarget response
        let ClassifiedDevToolsMessage::Forward { .. } = filter.classify_client_message(
            &json!({
                "id": 5,
                "method": "Target.attachToTarget",
                "params": { "targetId": "ROOT-T1", "flatten": true }
            })
            .to_string(),
        ) else {
            panic!("expected forward");
        };
        assert_eq!(
            filter.process_upstream_message(
                &json!({ "id": 5, "result": { "sessionId": "S-COLLIDE" } }).to_string(),
            ),
            UpstreamVerdict::Forward
        );
        assert!(filter.is_session_owned("S-COLLIDE"));

        // Mismatched attachedToTarget (pointing S-COLLIDE to FOREIGN-TX) must retire S-COLLIDE and emit detach
        let v = filter.process_upstream_message(
            &json!({
                "method": "Target.attachedToTarget",
                "params": {
                    "sessionId": "S-COLLIDE",
                    "targetInfo": { "targetId": "FOREIGN-TX", "type": "page" }
                }
            })
            .to_string(),
        );
        let UpstreamVerdict::Suppress { internal_commands } = v else {
            panic!("expected suppress+detach, got {v:?}");
        };
        assert_eq!(internal_commands.len(), 1);
        assert!(!filter.is_session_owned("S-COLLIDE"));
        assert!(!filter.is_session_pending("S-COLLIDE"));

        // FOREIGN-TX was tombstoned as Foreign so a fresh attach on it is immediately suppressed
        let v2 = filter.process_upstream_message(
            &json!({
                "method": "Target.attachedToTarget",
                "params": {
                    "sessionId": "S-FRESH-FOREIGN",
                    "targetInfo": { "targetId": "FOREIGN-TX", "type": "iframe" }
                }
            })
            .to_string(),
        );
        assert!(matches!(v2, UpstreamVerdict::Suppress { ref internal_commands } if internal_commands.len() == 1));
    }

    #[test]
    fn test_retire_owned_child_session_selectively_retires_subtree() {
        let mut filter = DevToolsSessionFilter::new("ROOT-T1");
        for (sid, tid) in [("S-IF1", "IF-1"), ("S-IF2", "IF-2")] {
            let _ = filter.process_upstream_message(
                &json!({
                    "method": "Target.attachedToTarget",
                    "params": {
                        "sessionId": sid,
                        "targetInfo": { "targetId": tid, "type": "iframe" }
                    }
                })
                .to_string(),
            );
            assert!(filter.promote_pending_attach(sid).is_some());
        }
        assert_eq!(filter.owned_iframe_sessions().len(), 2);

        // Queue an in-flight request on S-IF1 before selective retirement; verify single -32601 reply & late suppression.
        let ClassifiedDevToolsMessage::Forward { .. } = filter.classify_client_message(
            &json!({
                "id": 91,
                "sessionId": "S-IF1",
                "method": "Runtime.evaluate",
                "params": { "expression": "1+1" }
            })
            .to_string(),
        ) else {
            panic!("expected forward on owned S-IF1");
        };

        let cmds = filter.retire_owned_child_session("S-IF1").unwrap();
        assert_eq!(cmds.len(), 1);
        assert!(!filter.is_session_owned("S-IF1"));
        assert!(filter.is_session_owned("S-IF2"));
        assert_eq!(filter.owned_iframe_sessions(), vec![("S-IF2".into(), "IF-2".into())]);

        let retired_replies = filter.take_retired_client_replies();
        assert_eq!(retired_replies.len(), 1);
        let err_json: Value = serde_json::from_str(&retired_replies[0]).unwrap();
        assert_eq!(err_json["id"], 91);
        assert_eq!(err_json["sessionId"], "S-IF1");
        assert_eq!(err_json["error"]["code"], -32601);
        assert!(filter.take_retired_client_replies().is_empty());

        // Late upstream reply for already-drained id 91 on S-IF1 must be suppressed.
        assert_eq!(
            filter.process_upstream_message(
                &json!({
                    "id": 91,
                    "sessionId": "S-IF1",
                    "result": { "result": { "value": 2 } }
                })
                .to_string(),
            ),
            UpstreamVerdict::Suppress {
                internal_commands: Vec::new(),
            }
        );
    }
}
