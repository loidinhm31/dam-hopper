use std::collections::HashSet;

use serde_json::{json, Value};

use super::raw_session_targets::GEOMETRY_METHODS;

const DISALLOWED_TARGET_METHODS: &[&str] = &[
    "Target.createTarget",
    "Target.closeTarget",
    "Target.activateTarget",
    "Target.exposeDevToolsProtocol",
    "Target.disposeBrowserContext",
    "Target.createBrowserContext",
    "Target.getTargets",
    "Target.sendMessageToTarget",
];

const MAX_TRACKED_FOREIGN_TARGETS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientMessageVerdict {
    Forward,
    Reject(Option<String>),
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

/// Inspects an incoming CDP command from `devtools_app.html`, rejecting batch arrays,
/// browser-wide, cross-target, and viewport-geometry-mutating commands with JSON-RPC `-32601`.
pub fn inspect_devtools_client_message(raw: &str, native_target_id: &str) -> ClientMessageVerdict {
    let Ok(val) = serde_json::from_str::<Value>(raw) else {
        return ClientMessageVerdict::Forward;
    };
    if val.is_array() {
        return ClientMessageVerdict::Reject(Some(
            json!({"id": Value::Null, "error": {"code": -32601, "message": "Batch commands disallowed in target-scoped DevTools"}}).to_string(),
        ));
    }
    let Some(method) = val.get("method").and_then(Value::as_str) else {
        return ClientMessageVerdict::Forward;
    };
    let target_param = val.pointer("/params/targetId").and_then(Value::as_str);
    let disallowed = method.starts_with("Browser.")
        || DISALLOWED_TARGET_METHODS.contains(&method)
        || GEOMETRY_METHODS.contains(&method)
        || (matches!(method, "Target.attachToTarget" | "Target.autoAttachRelated")
            && target_param != Some(native_target_id));
    if !disallowed {
        return ClientMessageVerdict::Forward;
    }
    let reply = val.get("id").filter(|id| !id.is_null()).map(|id| {
        json!({
            "id": id,
            "error": { "code": -32601, "message": "Command disallowed in target-scoped DevTools" }
        })
        .to_string()
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
        if !raw.contains("\"Target.target") {
            return true;
        }
        let Ok(val) = serde_json::from_str::<Value>(raw) else {
            return true;
        };
        let Some(method) = val.get("method").and_then(Value::as_str) else {
            return true;
        };
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
    fn client_filter_blocks_geometry_browser_batch_and_foreign_targets() {
        for method in [
            "Browser.getVersion", "Target.getTargets", "Target.sendMessageToTarget",
            "Target.createTarget", "Target.closeTarget", "Emulation.setDeviceMetricsOverride",
            "Emulation.clearDeviceMetricsOverride", "Emulation.setPageScaleFactor", "Emulation.setVisibleSize",
        ] {
            let msg = json!({"id": 7, "method": method, "params": {}}).to_string();
            let ClientMessageVerdict::Reject(Some(err)) = inspect_devtools_client_message(&msg, "T1") else {
                panic!("expected rejection for {method}");
            };
            assert_eq!(serde_json::from_str::<Value>(&err).unwrap()["error"]["code"], -32601);
        }
        let batch = json!([{"id": 1, "method": "Runtime.enable"}]).to_string();
        assert!(matches!(inspect_devtools_client_message(&batch, "T1"), ClientMessageVerdict::Reject(Some(_))));
        let foreign = json!({"id": 8, "method": "Target.autoAttachRelated", "params": {"targetId": "T2"}}).to_string();
        assert!(matches!(inspect_devtools_client_message(&foreign, "T1"), ClientMessageVerdict::Reject(Some(_))));
        let own = json!({"id": 9, "method": "Target.attachToTarget", "params": {"targetId": "T1"}}).to_string();
        assert_eq!(inspect_devtools_client_message(&own, "T1"), ClientMessageVerdict::Forward);
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
    }
}
