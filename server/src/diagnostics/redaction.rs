use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use regex::Regex;

static SENSITIVE_VALUE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"(?i)\b(authorization|cookie)\s*:\s*[^\r\n,]+").unwrap(),
        Regex::new(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+").unwrap(),
        Regex::new(
            r#"(?i)("?[A-Za-z0-9_-]*(?:token|password|passphrase|api[_-]?key|apikey|secret|credential)[A-Za-z0-9_-]*"?\s*[:=]\s*)"?[^"\s&,;}]+"#,
        )
        .unwrap(),
    ]
});

const REDACTED: &str = "[REDACTED]";

pub fn redact_diagnostic_text(input: &str) -> String {
    SENSITIVE_VALUE_PATTERNS
        .iter()
        .fold(input.to_string(), |value, pattern| {
            pattern
                .replace_all(&value, |captures: &regex::Captures<'_>| {
                    if captures.len() > 1 {
                        format!("{}{}", &captures[1], REDACTED)
                    } else {
                        REDACTED.to_string()
                    }
                })
                .to_string()
        })
}

pub fn redact_diagnostic_fields(fields: BTreeMap<String, String>) -> BTreeMap<String, String> {
    fields
        .into_iter()
        .map(|(key, value)| {
            let redacted = if is_sensitive_key(&key) {
                REDACTED.to_string()
            } else {
                redact_diagnostic_text(&value)
            };
            (key, redacted)
        })
        .collect()
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    [
        "authorization",
        "cookie",
        "token",
        "password",
        "passphrase",
        "apikey",
        "secret",
        "credential",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_and_query_secret_values() {
        let text = "Authorization: Bearer abc.def token=plain password=hunter2";
        let redacted = redact_diagnostic_text(text);
        assert!(!redacted.contains("abc.def"));
        assert!(!redacted.contains("plain"));
        assert!(!redacted.contains("hunter2"));
        assert!(redacted.contains(REDACTED));
    }

    #[test]
    fn redacts_sensitive_field_names() {
        let fields = BTreeMap::from([
            ("api_key".to_string(), "abc123".to_string()),
            ("message".to_string(), "ok".to_string()),
        ]);
        let redacted = redact_diagnostic_fields(fields);
        assert_eq!(redacted["api_key"], REDACTED);
        assert_eq!(redacted["message"], "ok");
    }

    #[test]
    fn redacts_json_style_secrets_and_full_cookie_header() {
        let text = r#"{"apiKey":"abc123","message":"ok"} Cookie: sid=abc; theme=dark"#;
        let redacted = redact_diagnostic_text(text);
        assert!(!redacted.contains("abc123"));
        assert!(!redacted.contains("sid=abc"));
        assert!(!redacted.contains("theme=dark"));
        assert!(redacted.contains(REDACTED));
    }
}
