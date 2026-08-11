use serde_json::{Map, Value};

pub const MAX_RELAY_BYTES: usize = 64 * 1024;
pub const MAX_NONCE_LENGTH: usize = 128;
pub const MAX_REQUEST_ID_LENGTH: usize = 128;
pub const MAX_URL_LENGTH: usize = 2_048;
pub const MAX_TEXT_LENGTH: usize = 512;
pub const MAX_PAYLOAD_BYTES: usize = 60 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct RelayMessage {
    pub label: String,
    pub generation: u64,
    pub nonce: String,
    pub request_id: String,
    pub kind: String,
    pub origin: String,
    pub payload: Value,
}

pub fn parse_relay(raw: &str) -> Result<RelayMessage, &'static str> {
    if raw.len() > MAX_RELAY_BYTES || raw.contains('\0') {
        return Err("message_too_large");
    }
    let value: Value = serde_json::from_str(raw).map_err(|_| "invalid_json")?;
    let object = value.as_object().ok_or("invalid_envelope")?;
    require_exact_keys(
        object,
        &[
            "label",
            "generation",
            "nonce",
            "requestId",
            "kind",
            "origin",
            "payload",
        ],
    )?;
    let label = bounded_string(object.get("label"), 128).ok_or("invalid_label")?;
    let generation = object
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or("invalid_generation")?;
    let nonce = bounded_string(object.get("nonce"), MAX_NONCE_LENGTH).ok_or("invalid_nonce")?;
    let request_id = bounded_string(object.get("requestId"), MAX_REQUEST_ID_LENGTH)
        .ok_or("invalid_request_id")?;
    let kind = bounded_string(object.get("kind"), 64).ok_or("invalid_kind")?;
    let origin = bounded_string(object.get("origin"), MAX_URL_LENGTH).ok_or("invalid_origin")?;
    let payload = object.get("payload").cloned().ok_or("missing_payload")?;
    if !serde_json::to_vec(&payload)
        .map(|bytes| bytes.len() <= MAX_PAYLOAD_BYTES)
        .unwrap_or(false)
    {
        return Err("payload_too_large");
    }
    if kind != "browser-bridge-event" {
        return Err("invalid_kind");
    }
    validate_bridge_event(&payload, &nonce, &request_id)?;
    Ok(RelayMessage {
        label,
        generation,
        nonce,
        request_id,
        kind,
        origin,
        payload,
    })
}

fn validate_bridge_event(value: &Value, nonce: &str, request_id: &str) -> Result<(), &'static str> {
    let object = value.as_object().ok_or("invalid_event")?;
    let version = object.get("version").and_then(Value::as_u64);
    if version != Some(1)
        || object.get("nonce").and_then(Value::as_str) != Some(nonce)
        || object.get("requestId").and_then(Value::as_str) != Some(request_id)
    {
        return Err("event_envelope_mismatch");
    }
    let event_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or("invalid_event_type")?;
    match event_type {
        "dam-hopper:bridge-ready" => {
            let keys = if object.contains_key("capabilities") {
                ["version", "type", "nonce", "requestId", "capabilities"].as_slice()
            } else {
                ["version", "type", "nonce", "requestId"].as_slice()
            };
            require_exact_keys(object, keys)?;
            if let Some(capabilities) = object.get("capabilities") {
                let capabilities = capabilities.as_array().ok_or("invalid_capabilities")?;
                if capabilities.len() > 2
                    || capabilities.iter().any(|capability| {
                        !matches!(capability.as_str(), Some("navigation") | Some("console"))
                    })
                {
                    return Err("invalid_capabilities");
                }
            }
        }
        "dam-hopper:navigation" => {
            require_exact_keys(object, &["version", "type", "nonce", "requestId", "url"])?;
            bounded_string(object.get("url"), MAX_URL_LENGTH).ok_or("invalid_url")?;
        }
        "dam-hopper:console" => {
            require_exact_keys(
                object,
                &["version", "type", "nonce", "requestId", "level", "message"],
            )?;
            if !matches!(
                object.get("level").and_then(Value::as_str),
                Some("debug") | Some("log") | Some("info") | Some("warn") | Some("error")
            ) {
                return Err("invalid_console_level");
            }
            bounded_string(object.get("message"), MAX_TEXT_LENGTH).ok_or("invalid_message")?;
        }
        "dam-hopper:error" => {
            require_exact_keys(
                object,
                &["version", "type", "nonce", "requestId", "code", "message"],
            )?;
            if !matches!(
                object.get("code").and_then(Value::as_str),
                Some("invalid_message")
                    | Some("invalid_nonce")
                    | Some("picker_unavailable")
                    | Some("picker_failed")
            ) {
                return Err("invalid_error_code");
            }
            bounded_string(object.get("message"), MAX_TEXT_LENGTH).ok_or("invalid_message")?;
        }
        "dam-hopper:selection" => {
            require_exact_keys(
                object,
                &["version", "type", "nonce", "requestId", "selection"],
            )?;
            validate_selection(object.get("selection").ok_or("missing_selection")?)?;
        }
        _ => return Err("invalid_event_type"),
    }
    Ok(())
}

fn validate_selection(value: &Value) -> Result<(), &'static str> {
    let object = value.as_object().ok_or("invalid_selection")?;
    require_exact_keys(
        object,
        &[
            "version",
            "tag",
            "role",
            "accessibleName",
            "text",
            "attributes",
            "locator",
            "bounds",
        ],
    )?;
    if object.get("version").and_then(Value::as_u64) != Some(1)
        || bounded_string(object.get("tag"), 64).is_none()
        || bounded_string(object.get("locator"), 512).is_none()
    {
        return Err("invalid_selection");
    }
    for (key, max_length) in [("role", 128_usize), ("accessibleName", 256), ("text", 512)] {
        if !object.get(key).is_some_and(|value| {
            value.is_null() || bounded_string(Some(value), max_length).is_some()
        }) {
            return Err("invalid_selection");
        }
    }
    let attributes = object
        .get("attributes")
        .and_then(Value::as_object)
        .ok_or("invalid_attributes")?;
    if attributes.len() > 12
        || attributes.iter().any(|(key, value)| {
            !matches!(
                key.as_str(),
                "id" | "class"
                    | "name"
                    | "role"
                    | "aria-label"
                    | "data-testid"
                    | "data-test"
                    | "data-cy"
            ) || bounded_string(Some(value), 128).is_none()
        })
    {
        return Err("invalid_attributes");
    }
    let bounds = object
        .get("bounds")
        .and_then(Value::as_object)
        .ok_or("invalid_bounds")?;
    require_exact_keys(bounds, &["x", "y", "width", "height"])?;
    for key in ["x", "y"] {
        if !bounded_number(bounds.get(key), -1_000_000.0, 1_000_000.0) {
            return Err("invalid_bounds");
        }
    }
    for key in ["width", "height"] {
        if !bounded_number(bounds.get(key), 0.0, 1_000_000.0) {
            return Err("invalid_bounds");
        }
    }
    Ok(())
}

fn require_exact_keys(object: &Map<String, Value>, expected: &[&str]) -> Result<(), &'static str> {
    if object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key)) {
        Ok(())
    } else {
        Err("unexpected_keys")
    }
}

fn bounded_string(value: Option<&Value>, max: usize) -> Option<String> {
    let value = value?.as_str()?;
    if value.is_empty() || value.len() > max || value.chars().any(|char| char.is_control()) {
        return None;
    }
    Some(value.to_string())
}

fn bounded_number(value: Option<&Value>, min: f64, max: f64) -> bool {
    value
        .and_then(Value::as_f64)
        .is_some_and(|value| value.is_finite() && value >= min && value <= max)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_event() -> Value {
        serde_json::json!({
            "version": 1,
            "type": "dam-hopper:bridge-ready",
            "nonce": "nonce-123",
            "requestId": "request-123",
            "capabilities": ["navigation", "console"]
        })
    }

    fn valid_message() -> String {
        serde_json::json!({
            "label": "browser-debug",
            "generation": 4,
            "nonce": "nonce-123",
            "requestId": "request-123",
            "kind": "browser-bridge-event",
            "origin": "http://localhost:3000",
            "payload": valid_event()
        })
        .to_string()
    }

    #[test]
    fn accepts_bounded_bridge_event() {
        let message = parse_relay(&valid_message()).unwrap();
        assert_eq!(message.generation, 4);
    }

    #[test]
    fn rejects_wrong_schema_size_and_nonce() {
        let mut value: Value = serde_json::from_str(&valid_message()).unwrap();
        value["extra"] = Value::Bool(true);
        assert_eq!(parse_relay(&value.to_string()), Err("unexpected_keys"));

        let mut value: Value = serde_json::from_str(&valid_message()).unwrap();
        value["payload"]["nonce"] = Value::String("other".into());
        assert_eq!(
            parse_relay(&value.to_string()),
            Err("event_envelope_mismatch")
        );

        let oversized = "x".repeat(MAX_RELAY_BYTES + 1);
        assert_eq!(parse_relay(&oversized), Err("message_too_large"));
    }

    #[test]
    fn rejects_malformed_or_privileged_events() {
        assert_eq!(parse_relay("null"), Err("invalid_envelope"));

        let mut value: Value = serde_json::from_str(&valid_message()).unwrap();
        value["kind"] = Value::String("tauri-command".into());
        assert_eq!(parse_relay(&value.to_string()), Err("invalid_kind"));

        let mut value: Value = serde_json::from_str(&valid_message()).unwrap();
        value["payload"] = serde_json::json!({
            "version": 1,
            "type": "dam-hopper:execute-shell",
            "nonce": "nonce-123",
            "requestId": "request-123",
            "command": "whoami"
        });
        assert_eq!(parse_relay(&value.to_string()), Err("invalid_event_type"));

        let mut value: Value = serde_json::from_str(&valid_message()).unwrap();
        value["payload"]["capabilities"] = serde_json::json!(["navigation", "shell"]);
        assert_eq!(parse_relay(&value.to_string()), Err("invalid_capabilities"));
    }
}
