use std::collections::HashSet;

use serde_json::{json, Value};

use super::input::{MouseButton, MAX_INSERT_TEXT_BYTES};
use super::protocol::MAX_WS_MESSAGE_BYTES;
use super::raw_session_targets::GEOMETRY_METHODS;
const MAX_DEVTOOLS_JSON_NODES: usize = 8_192;
const MAX_DEVTOOLS_JSON_DEPTH: usize = 128;
const MAX_CDP_KEY_IDENTIFIER_BYTES: usize = 64;
// Per-token admission charge includes Value nodes, ordered-map storage, and allocator slack.
// This is a conservative accounting estimate, not an allocator-enforced per-message ceiling.
const DEVTOOLS_JSON_NODE_RESERVATION_BYTES: usize = 1_024;


const DISALLOWED_TARGET_METHODS: &[&str] = &[
    "Target.createTarget",
    "Target.closeTarget",
    "Target.activateTarget",
    "Target.exposeDevToolsProtocol",
    "Target.disposeBrowserContext",
    "Target.createBrowserContext",
    "Target.getTargets",
    "Target.sendMessageToTarget",
    "Page.setDownloadBehavior",
    "Target.detachFromTarget",
    "Target.getTargetInfo",
    "Target.getBrowserContexts",
    "Target.setDiscoverTargets",
    "Target.setAutoAttach",
    "Target.setRemoteLocations",
    "Network.getAllCookies",
    "Network.getCookies",
    "Network.setCookie",
    "Network.setCookies",
    "Network.deleteCookies",
    "Network.clearBrowserCache",
    "Network.clearBrowserCookies",
];

// Bounded nonlocal-effect inventory (Phase 01 source/upstream review; not deployed-engine proof):
// | Surface | Scope/effect | Policy/evidence/test |
// | Browser.*; listed Target context/discovery/query/detach/tunnel methods | browser/context state or cross-target metadata | deny; filter methods + mock peer |
// | Target.attachToTarget/autoAttachRelated | allow only native root target ID; returned child commands stay denied until Phase 04 | target-ID unit tests |
// | Page.setDownloadBehavior | client download-path override | deny regardless of params; varied-param unit + mock peer |
// | ServiceWorker.* | context worker lifecycle and registration/version/script/client metadata | deny/suppress; command/event unit + mock peer |
// | BackgroundService.* | storage-partition history/recording and worker metadata (upstream handler evidence) | deny/suppress; command/event unit + mock peer |
// | Storage.* | origin/profile storage and metadata | deny/suppress; method/event unit |
// | listed Network cookie/cache methods | browser/profile cookie or cache state | deny; method unit + mock peer |
// | geometry methods | server-owned viewport | deny; existing geometry regressions |
// Unlisted target-local methods remain forwarded; Phase 03 control authority is not implemented
// here. No exception without deployed-version evidence, enforceable target scope, result/event
// treatment, and a regression mapping.
fn disallowed_nonlocal_method(method: &str) -> bool {
    method.starts_with("Browser.")
        || method.starts_with("ServiceWorker.")
        || method.starts_with("BackgroundService.")
        || method.starts_with("Storage.")
        || DISALLOWED_TARGET_METHODS.contains(&method)
        || GEOMETRY_METHODS.contains(&method)
}

const MAX_TRACKED_FOREIGN_TARGETS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientMessageVerdict {
    Forward(String),
    Reject(Option<String>),
}

/// Stateful CDP `Input.*` effect classification (Phase 03 R2 inventory).
///
/// Inventory of CDP Input methods:
/// - `Input.dispatchKeyEvent`: `keyDown`, `rawKeyDown`, `keyUp` enter shared hold ledger; `char` is non-held.
/// - `Input.dispatchMouseEvent`: `mousePressed` / `mouseReleased` (non-`none` button) enter shared hold ledger;
///   `mouseMoved` / `mouseWheel` / `none` button update pointer/modifiers without adding a hold.
/// - `Input.insertText`: bounded non-held target-local text insertion.
/// - `Input.dispatchTouchEvent`, `Input.emulateTouchFromMouseEvent`, `Input.dispatchDragEvent`,
///   `Input.setInterceptDrags`, `Input.cancelDragging`, `Input.synthesizeTapGesture`,
///   `Input.synthesizeScrollGesture`, `Input.synthesizePinchGesture`, `Input.imeSetComposition`,
///   `Input.imeCancelComposition`, `Input.setIgnoreInputEvents`, and any unknown `Input.*`:
///   explicitly denied unless managed start/update/end/cancel lifecycle is proven on captured identity.
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
        input_effect: Option<CdpInputEffect>,
    },
    Reject(Option<String>),
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
        // Explicitly deny touch, drag, gesture, IME composition, sticky input ignore, and any unknown Input.*
        _ => Err("Unsupported stateful Input command disallowed in target-scoped DevTools"),
    }
}
/// Returns the pre-parse admission charge. An allocation-free scan caps depth and token count;
/// the charge budgets 4x wire bytes for source/decoded strings/canonical output plus 1 KiB per
/// token for Value nodes and container storage. WebSocket max message/frame sizes are 4 MiB; they
/// do not bound aggregate transport memory.
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
                    && !matches!(bytes[index], b' ' | b'\n' | b'\r' | b'\t' | b',' | b':' | b'{' | b'}' | b'[' | b']' | b'"')
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
    if raw.is_empty() || raw.starts_with('/') || raw.ends_with('/') || raw.contains('\\')
        || raw.contains("..") || raw.contains('?') || raw.contains('#')
    {
        return Err("invalid devtools asset path");
    }
    if !raw.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-')) {
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

/// Validates one bounded CDP command envelope. Forward a canonical JSON value so duplicate
/// keys cannot be interpreted differently by the filter and Chromium.
pub fn inspect_devtools_client_message(raw: &str, native_target_id: &str) -> ClientMessageVerdict {
    match classify_devtools_client_message(raw, native_target_id) {
        ClassifiedDevToolsMessage::Forward { json, .. } => ClientMessageVerdict::Forward(json),
        ClassifiedDevToolsMessage::Reject(reply) => ClientMessageVerdict::Reject(reply),
    }
}

/// Validates and classifies one bounded CDP command envelope, including stateful `Input.*`
/// inventory checks.
pub fn classify_devtools_client_message(
    raw: &str,
    native_target_id: &str,
) -> ClassifiedDevToolsMessage {
    if devtools_json_memory_bound(raw).is_none() {
        return ClassifiedDevToolsMessage::Reject(None);
    }
    let Ok(val) = serde_json::from_str::<Value>(raw) else {
        return ClassifiedDevToolsMessage::Reject(None);
    };
    let Some(obj) = val.as_object() else {
        return ClassifiedDevToolsMessage::Reject(None);
    };
    let id = obj.get("id");
    let call_id = id.and_then(Value::as_u64).filter(|&n| n <= u32::MAX as u64);
    let valid_method = obj
        .get("method")
        .and_then(Value::as_str)
        .is_some_and(is_valid_cdp_method);
    let valid_params = obj.get("params").is_none_or(Value::is_object);
    let session_id = obj.get("sessionId").filter(|session| {
        session
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 256)
    });
    let valid_session = obj.get("sessionId").is_none() || session_id.is_some();
    if !valid_session {
        return ClassifiedDevToolsMessage::Reject(None);
    }
    let valid_keys = obj
        .keys()
        .all(|key| matches!(key.as_str(), "id" | "method" | "params" | "sessionId"));
    if call_id.is_none() || !valid_method || !valid_params || !valid_keys {
        return reject_classified(
            id.filter(|_| call_id.is_some()),
            session_id,
            -32600,
            "Invalid CDP command envelope",
        );
    }

    let call_id = call_id.expect("validated above");
    let method = obj["method"].as_str().expect("validated above");
    let target_param = val.pointer("/params/targetId").and_then(Value::as_str);
    let disallowed = disallowed_nonlocal_method(method)
        // No positive child-session ownership validator exists before Phase 04.
        || obj.contains_key("sessionId")
        || (matches!(method, "Target.attachToTarget" | "Target.autoAttachRelated")
            && target_param != Some(native_target_id));
    if disallowed {
        return reject_classified(
            id,
            session_id,
            -32601,
            "Command disallowed in target-scoped DevTools",
        );
    }
    let input_effect = if method.starts_with("Input.") {
        let params_obj = obj.get("params").and_then(Value::as_object);
        match classify_cdp_input_method(method, params_obj) {
            Ok(effect) => Some(effect),
            Err(reason) => {
                return reject_classified(id, session_id, -32601, reason);
            }
        }
    } else {
        None
    };
    ClassifiedDevToolsMessage::Forward {
        json: val.to_string(),
        call_id,
        input_effect,
    }
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

fn reject_classified(
    id: Option<&Value>,
    session_id: Option<&Value>,
    code: i64,
    message: &str,
) -> ClassifiedDevToolsMessage {
    let reply = id.map(|id| {
        let mut value = json!({
            "id": id,
            "error": { "code": code, "message": message }
        });
        if let Some(session_id) = session_id {
            value["sessionId"] = session_id.clone();
        }
        value.to_string()
    });
    ClassifiedDevToolsMessage::Reject(reply)
}

/// Stateful per-socket upstream target event filter so foreign page/browser UI target IDs
/// stay suppressed across `targetCreated`, `targetInfoChanged`, and `targetDestroyed`.
#[derive(Default)]
pub struct DevToolsUpstreamFilter {
    foreign_targets: HashSet<String>,
}

impl DevToolsUpstreamFilter {
    pub fn should_forward(&mut self, raw: &str, native_target_id: &str) -> bool {
        if devtools_json_memory_bound(raw).is_none() {
            return false;
        }
        let Ok(val) = serde_json::from_str::<Value>(raw) else {
            return false;
        };
        let Some(method) = val.get("method").and_then(Value::as_str) else {
            return true;
        };
        // These domains expose browser-context worker/storage metadata and effects. No
        // deployed-version, target-scoped enforcement contract is established yet.
        if method.starts_with("ServiceWorker.")
            || method.starts_with("Storage.")
            || method.starts_with("BackgroundService.")
            || method == "Target.receivedMessageFromTarget"
        {
            return false;
        }
        if !matches!(method, "Target.targetCreated" | "Target.targetInfoChanged" | "Target.targetDestroyed") {
            return true;
        }
        if let Some(info) = val.pointer("/params/targetInfo") {
            let t = info.get("type").and_then(Value::as_str);
            let tid = info.get("targetId").and_then(Value::as_str);
            if matches!(t, Some("page" | "browser_ui")) && tid != Some(native_target_id) {
                if let Some(id) = tid {
                    if self.foreign_targets.len() >= MAX_TRACKED_FOREIGN_TARGETS {
                        self.foreign_targets.clear();
                    }
                    self.foreign_targets.insert(id.to_string());
                }
                return false;
            }
            return true;
        }
        if method == "Target.targetDestroyed" {
            if let Some(tid) = val.pointer("/params/targetId").and_then(Value::as_str) {
                if tid != native_target_id && self.foreign_targets.remove(tid) {
                    return false;
                }
            }
        }
        true
    }
}

pub fn should_forward_devtools_upstream_message(raw: &str, native_target_id: &str) -> bool {
    DevToolsUpstreamFilter::default().should_forward(raw, native_target_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_memory_bound_caps_message_size_depth_and_token_count() {
        let ordinary = r#"{"id":1,"method":"Runtime.enable","params":{"expression":"a\\\"b"}}"#;
        assert!(devtools_json_memory_bound(ordinary).is_some());

        let dense_values = vec!["0"; MAX_DEVTOOLS_JSON_NODES + 1].join(",");
        let dense = format!(
            r#"{{"id":1,"method":"Runtime.evaluate","params":{{"value":[{dense_values}]}}}}"#
        );
        assert_eq!(devtools_json_memory_bound(&dense), None);
        assert_eq!(inspect_devtools_client_message(&dense, "T1"), ClientMessageVerdict::Reject(None));

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

        let nested_value = format!("{}0{}", "[".repeat(64), "]".repeat(64));
        let nested = [
            r#"{"id":1,"method":"Runtime.evaluate","params":{"value":"#,
            &nested_value,
            "}}",
        ]
        .concat();
        assert!(devtools_json_memory_bound(&nested).is_some());

        let controller = crate::browser_host::diagnostics::MemoryAdmissionController::new(
            devtools_json_memory_bound(ordinary).unwrap(),
        );
        let reservation = controller
            .try_reserve(devtools_json_memory_bound(ordinary).unwrap())
            .unwrap();
        assert_eq!(
            controller.current_reserved_bytes(),
            devtools_json_memory_bound(ordinary).unwrap()
        );
        assert!(controller.try_reserve(1).is_err());
        drop(reservation);
        assert_eq!(controller.current_reserved_bytes(), 0);
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
    fn client_filter_blocks_nonlocal_effects_and_foreign_targets() {
        for method in [
            "Browser.getVersion",
            "Target.getTargets",
            "Target.sendMessageToTarget",
            "Target.createTarget",
            "Target.closeTarget",
            "Emulation.setDeviceMetricsOverride",
            "Emulation.clearDeviceMetricsOverride",
            "Emulation.setPageScaleFactor",
            "Emulation.setVisibleSize",
            "Target.detachFromTarget",
            "Target.getTargetInfo",
            "Target.getBrowserContexts",
            "Target.setDiscoverTargets",
            "Target.setAutoAttach",
            "Target.setRemoteLocations",
            "Page.setDownloadBehavior",
            "ServiceWorker.enable",
            "ServiceWorker.stopAllWorkers",
            "ServiceWorker.unregister",
            "ServiceWorker.updateRegistration",
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
            let msg = json!({"id": 7, "method": method, "params": {}}).to_string();
            let ClientMessageVerdict::Reject(Some(err)) = inspect_devtools_client_message(&msg, "T1") else {
                panic!("expected rejection for {method}");
            };
            assert_eq!(serde_json::from_str::<Value>(&err).unwrap()["error"]["code"], -32601);
        }
        for params in [
            json!({"behavior": "allow", "downloadPath": "/tmp/first"}),
            json!({"behavior": "deny"}),
            json!({"behavior": "default"}),
        ] {
            let request = json!({"id": 70, "method": "Page.setDownloadBehavior", "params": params}).to_string();
            assert!(matches!(inspect_devtools_client_message(&request, "T1"), ClientMessageVerdict::Reject(Some(_))));
        }
        for (method, params) in [
            ("Network.getCookies", json!({"urls": ["https://foreign.test/"]})),
            ("Network.setCookies", json!({"cookies": [{"name": "a", "value": "b"}]})),
            ("BackgroundService.setRecording", json!({"service": "backgroundFetch", "shouldRecord": true})),
        ] {
            let request = json!({"id": 71, "method": method, "params": params}).to_string();
            assert!(matches!(inspect_devtools_client_message(&request, "T1"), ClientMessageVerdict::Reject(Some(_))));
        }
        let batch = json!([{"id": 1, "method": "Runtime.enable"}]).to_string();
        assert_eq!(inspect_devtools_client_message(&batch, "T1"), ClientMessageVerdict::Reject(None));
        let foreign = json!({"id": 8, "method": "Target.autoAttachRelated", "params": {"targetId": "T2"}}).to_string();
        assert!(matches!(inspect_devtools_client_message(&foreign, "T1"), ClientMessageVerdict::Reject(Some(_))));
        let own = json!({"id": 9, "method": "Target.attachToTarget", "params": {"targetId": "T1"}}).to_string();
        let ClientMessageVerdict::Forward(canonical) = inspect_devtools_client_message(&own, "T1") else {
            panic!("expected root-target attach to remain usable");
        };
        assert_eq!(serde_json::from_str::<Value>(&canonical).unwrap(), serde_json::from_str::<Value>(&own).unwrap());
        let child = json!({"id": 10, "sessionId": "unknown", "method": "Runtime.enable"}).to_string();
        let ClientMessageVerdict::Reject(Some(child_err)) =
            inspect_devtools_client_message(&child, "T1")
        else {
            panic!("expected correlated child-session rejection");
        };
        let child_reply: Value = serde_json::from_str(&child_err).unwrap();
        assert_eq!(child_reply["id"], 10);
        assert_eq!(child_reply["sessionId"], "unknown");
        assert_eq!(child_reply["error"]["code"], -32601);
        let child_invalid =
            r#"{"id":13,"sessionId":"child-session","method":"Runtime.evaluate","params":[]}"#;
        let ClientMessageVerdict::Reject(Some(child_invalid_err)) =
            inspect_devtools_client_message(child_invalid, "T1")
        else {
            panic!("expected correlated invalid child envelope");
        };
        let child_invalid_reply: Value = serde_json::from_str(&child_invalid_err).unwrap();
        assert_eq!(child_invalid_reply["sessionId"], "child-session");
        assert_eq!(child_invalid_reply["error"]["code"], -32600);
        let root_rejected =
            inspect_devtools_client_message(r#"{"id":14,"method":"Page.setDownloadBehavior"}"#, "T1");
        let ClientMessageVerdict::Reject(Some(root_error)) = root_rejected else {
            panic!("expected root rejection");
        };
        let root_reply: Value = serde_json::from_str(&root_error).unwrap();
        assert!(root_reply.get("sessionId").is_none());
        let too_long_session = "x".repeat(257);
        for session_id in ["", too_long_session.as_str()] {
            let request = json!({"id": 15, "sessionId": session_id, "method": "Runtime.enable"});
            assert_eq!(
                inspect_devtools_client_message(&request.to_string(), "T1"),
                ClientMessageVerdict::Reject(None)
            );
        }
        let non_string_session = r#"{"id":16,"sessionId":17,"method":"Runtime.enable"}"#;
        assert_eq!(
            inspect_devtools_client_message(non_string_session, "T1"),
            ClientMessageVerdict::Reject(None)
        );
        let max_session = "x".repeat(256);
        let invalid_id_with_session =
            r#"{"id":null,"sessionId":"child-session","method":"Runtime.enable"}"#;
        assert_eq!(
            inspect_devtools_client_message(invalid_id_with_session, "T1"),
            ClientMessageVerdict::Reject(None)
        );
        let max_session_request =
            json!({"id": 17, "sessionId": max_session, "method": "Runtime.enable"}).to_string();
        let ClientMessageVerdict::Reject(Some(max_session_error)) =
            inspect_devtools_client_message(&max_session_request, "T1")
        else {
            panic!("256-byte session ID should remain correlatable");
        };
        let max_session_reply: Value = serde_json::from_str(&max_session_error).unwrap();
        assert_eq!(max_session_reply["sessionId"].as_str().unwrap().len(), 256);
        let invalid = inspect_devtools_client_message(r#"{"id":11,"method":"Runtime.evaluate","params":[]}"#, "T1");
        let ClientMessageVerdict::Reject(Some(err)) = invalid else { panic!("expected correlated error") };
        let err: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(err["id"], 11);
        assert_eq!(err["error"]["code"], -32600);
        for malformed in [
            "{",
            r#"{"method":"Runtime.enable"}"#,
            r#"{"id":null,"method":"Runtime.enable"}"#,
            r#"{"id":"12","method":"Runtime.enable"}"#,
            r#"{"id":4294967296,"method":"Runtime.enable"}"#,
        ] {
            assert_eq!(inspect_devtools_client_message(malformed, "T1"), ClientMessageVerdict::Reject(None));
        }
        for malformed in [
            r#"{"id":1,"method":"Runtime.evaluate()"}"#,
            r#"{"id":2,"method":"Runtime.enable","extra":true}"#,
        ] {
            let ClientMessageVerdict::Reject(Some(err)) = inspect_devtools_client_message(malformed, "T1") else {
                panic!("correlatable invalid envelope must return an error");
            };
            let err: Value = serde_json::from_str(&err).unwrap();
            assert_eq!(err["error"]["code"], -32600);
        }
        let allowed = json!({"id": 12, "method": "Runtime.enable", "params": {}}).to_string();
        assert!(matches!(inspect_devtools_client_message(&allowed, "T1"), ClientMessageVerdict::Forward(_)));
        let duplicate = r#"{"id":1,"id":2,"method":"Runtime.enable"}"#;
        let ClientMessageVerdict::Forward(canonical) = inspect_devtools_client_message(duplicate, "T1") else {
            panic!("expected canonical forwarding");
        };
        assert_eq!(canonical, r#"{"id":2,"method":"Runtime.enable"}"#);
    }

    #[test]
    fn upstream_filter_drops_foreign_page_created_and_destroyed() {
        let mut filter = DevToolsUpstreamFilter::default();
        let created = json!({"method": "Target.targetCreated", "params": {"targetInfo": {"targetId": "OTHER", "type": "page"}}}).to_string();
        let destroyed = json!({"method": "Target.targetDestroyed", "params": {"targetId": "OTHER"}}).to_string();
        let worker = json!({"method": "Target.targetCreated", "params": {"targetInfo": {"targetId": "W1", "type": "worker"}}}).to_string();
        assert!(!filter.should_forward(&created, "T1"));
        assert!(!filter.should_forward(&destroyed, "T1"));
        assert!(filter.should_forward(&worker, "T1"));
        for event in [
            json!({"method": "ServiceWorker.workerRegistrationUpdated", "params": {"registrations": [{"scopeURL": "https://a.test/"}]}}),
            json!({"method": "ServiceWorker.workerVersionUpdated", "params": {"versions": [{"scriptURL": "https://a.test/sw.js"}]}}),
            json!({"method": "Storage.cacheStorageListUpdated", "params": {"origin": "https://a.test"}}),
            json!({"method": "BackgroundService.recordingStateChanged", "params": {"service": "backgroundFetch", "isRecording": true}}),
            json!({"method": "Target.receivedMessageFromTarget", "params": {"sessionId": "child", "message": "{}"}}),
        ] {
            assert!(!filter.should_forward(&event.to_string(), "T1"));
        }
        assert!(!filter.should_forward(
            r#"{"method":"Service\u0057orker.workerRegistrationUpdated","sessionId":"child","params":{"registrations":[]}}"#,
            "T1",
        ));
        assert!(!filter.should_forward(
            r#"{"method":"BackgroundService\u002erecordingStateChanged","params":{"service":"backgroundFetch","isRecording":true}}"#,
            "T1",
        ));
        assert!(!filter.should_forward("{malformed", "T1"));
    }

    #[test]
    fn input_inventory_classifies_supported_and_denies_unsupported_stateful_methods() {
        for (req, expected) in [
            (
                json!({"id": 1, "method": "Input.dispatchKeyEvent", "params": {"type": "keyDown", "key": "a", "code": "KeyA", "modifiers": 2}}),
                CdpInputEffect::KeyDown { key: "a".into(), code: "KeyA".into(), modifiers: 2 },
            ),
            (
                json!({"id": 2, "method": "Input.dispatchKeyEvent", "params": {"type": "rawKeyDown", "key": "Shift", "code": "ShiftLeft", "modifiers": 8, "autoRepeat": true}}),
                CdpInputEffect::KeyDown { key: "Shift".into(), code: "ShiftLeft".into(), modifiers: 8 },
            ),
            (
                json!({"id": 3, "method": "Input.dispatchKeyEvent", "params": {"type": "keyUp", "key": "a", "code": "KeyA", "modifiers": 0}}),
                CdpInputEffect::KeyUp { key: "a".into(), code: "KeyA".into(), modifiers: 0 },
            ),
            (
                json!({"id": 4, "method": "Input.dispatchKeyEvent", "params": {"type": "char", "text": "a"}}),
                CdpInputEffect::NonHeld,
            ),
            (
                json!({"id": 5, "method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "button": "left", "x": 120.5, "y": 240.0, "modifiers": 1}}),
                CdpInputEffect::MouseDown { button: MouseButton::Left, x: 120.5, y: 240.0, modifiers: 1 },
            ),
            (
                json!({"id": 6, "method": "Input.dispatchMouseEvent", "params": {"type": "mouseReleased", "button": "left", "x": 120.5, "y": 240.0, "modifiers": 0}}),
                CdpInputEffect::MouseUp { button: MouseButton::Left, x: 120.5, y: 240.0, modifiers: 0 },
            ),
            (
                json!({"id": 7, "method": "Input.dispatchMouseEvent", "params": {"type": "mouseMoved", "x": 50.0, "y": 60.0}}),
                CdpInputEffect::PointerMove { x: 50.0, y: 60.0, modifiers: 0 },
            ),
            (
                json!({"id": 8, "method": "Input.dispatchMouseEvent", "params": {"type": "mouseWheel", "x": 50.0, "y": 60.0, "deltaX": 0.0, "deltaY": -120.0}}),
                CdpInputEffect::PointerMove { x: 50.0, y: 60.0, modifiers: 0 },
            ),
            (
                json!({"id": 9, "method": "Input.insertText", "params": {"text": "hello"}}),
                CdpInputEffect::NonHeld,
            ),
        ] {
            let ClassifiedDevToolsMessage::Forward { input_effect, .. } =
                classify_devtools_client_message(&req.to_string(), "T1")
            else {
                panic!("expected forward for {req}");
            };
            assert_eq!(input_effect, Some(expected));
        }

        for denied in [
            json!({"id": 20, "method": "Input.dispatchTouchEvent", "params": {"type": "touchStart", "touchPoints": []}}),
            json!({"id": 21, "method": "Input.emulateTouchFromMouseEvent", "params": {"type": "mousePressed", "x": 1, "y": 1, "button": "left", "timestamp": 0}}),
            json!({"id": 22, "method": "Input.dispatchDragEvent", "params": {"type": "dragEnter", "x": 1, "y": 1, "data": {}}}),
            json!({"id": 23, "method": "Input.setInterceptDrags", "params": {"enabled": true}}),
            json!({"id": 24, "method": "Input.cancelDragging", "params": {}}),
            json!({"id": 25, "method": "Input.synthesizeTapGesture", "params": {"x": 1, "y": 1}}),
            json!({"id": 26, "method": "Input.synthesizeScrollGesture", "params": {"x": 1, "y": 1}}),
            json!({"id": 27, "method": "Input.synthesizePinchGesture", "params": {"x": 1, "y": 1, "scaleFactor": 1.5}}),
            json!({"id": 28, "method": "Input.imeSetComposition", "params": {"text": "a", "selectionStart": 0, "selectionEnd": 1}}),
            json!({"id": 29, "method": "Input.imeCancelComposition", "params": {}}),
            json!({"id": 30, "method": "Input.setIgnoreInputEvents", "params": {"ignore": true}}),
            json!({"id": 31, "method": "Input.futureUnknownStatefulCommand", "params": {}}),
            json!({"id": 32, "method": "Input.dispatchMouseEvent", "params": {"type": "mousePressed", "button": "left", "x": 1, "y": 1, "pointerType": "pen"}}),
            json!({"id": 33, "method": "Input.dispatchKeyEvent", "params": {"type": "keyDown"}}),
        ] {
            let ClassifiedDevToolsMessage::Reject(Some(reply)) =
                classify_devtools_client_message(&denied.to_string(), "T1")
            else {
                panic!("expected correlated rejection for {denied}");
            };
            let v: Value = serde_json::from_str(&reply).unwrap();
            assert_eq!(v["error"]["code"], -32601);
        }
    }
}
