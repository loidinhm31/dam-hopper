use std::collections::HashSet;

use serde_json::{json, Value};

use super::protocol::MAX_WS_MESSAGE_BYTES;
use super::raw_session_targets::GEOMETRY_METHODS;
const MAX_DEVTOOLS_JSON_NODES: usize = 8_192;
const MAX_DEVTOOLS_JSON_DEPTH: usize = 128;
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
    if devtools_json_memory_bound(raw).is_none() {
        return ClientMessageVerdict::Reject(None);
    }
    let Ok(val) = serde_json::from_str::<Value>(raw) else {
        return ClientMessageVerdict::Reject(None);
    };
    let Some(obj) = val.as_object() else {
        return ClientMessageVerdict::Reject(None);
    };
    let id = obj.get("id");
    let id_is_correlatable = id.is_some_and(|id| id.as_u64().is_some_and(|n| n <= u32::MAX as u64));
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
        return ClientMessageVerdict::Reject(None);
    }
    let valid_keys = obj
        .keys()
        .all(|key| matches!(key.as_str(), "id" | "method" | "params" | "sessionId"));
    if !id_is_correlatable || !valid_method || !valid_params || !valid_keys {
        return reject_cdp_message(
            id.filter(|_| id_is_correlatable),
            session_id,
            -32600,
            "Invalid CDP command envelope",
        );
    }

    let method = obj["method"].as_str().expect("validated above");
    let target_param = val.pointer("/params/targetId").and_then(Value::as_str);
    let disallowed = disallowed_nonlocal_method(method)
        // No positive child-session ownership validator exists before Phase 04.
        || obj.contains_key("sessionId")
        || (matches!(method, "Target.attachToTarget" | "Target.autoAttachRelated")
            && target_param != Some(native_target_id));
    if disallowed {
        return reject_cdp_message(
            id,
            session_id,
            -32601,
            "Command disallowed in target-scoped DevTools",
        );
    }
    ClientMessageVerdict::Forward(val.to_string())
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

fn reject_cdp_message(
    id: Option<&Value>,
    session_id: Option<&Value>,
    code: i64,
    message: &str,
) -> ClientMessageVerdict {
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
    ClientMessageVerdict::Reject(reply)
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
}
