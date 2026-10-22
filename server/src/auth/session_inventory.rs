//! Bounded keyset pagination and untrusted client metadata for login sessions.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};

use super::model::AuthSession;

pub const SESSION_PAGE_SIZE: usize = 50;
pub const SESSION_FETCH_LIMIT: usize = SESSION_PAGE_SIZE + 1;
pub const MAX_USER_AGENT_BYTES: usize = 512;

/// Millisecond precision matches both BSON dates and SQLite storage. IDs break ties.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionCursor {
    pub issued_at_ms: i64,
    pub id: String,
}

impl SessionCursor {
    pub fn from_session(session: &AuthSession) -> Self {
        Self {
            issued_at_ms: session.issued_at.timestamp_millis(),
            id: session.id.clone(),
        }
    }

    pub fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&(self.issued_at_ms, &self.id))
                .expect("session cursor contains only a timestamp and string"),
        )
    }

    pub fn decode(value: &str) -> Result<Self, &'static str> {
        if value.is_empty() || value.len() > 512 {
            return Err("Invalid session cursor");
        }
        let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| "Invalid session cursor")?;
        let (issued_at_ms, id): (i64, String) =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid session cursor")?;
        if DateTime::<Utc>::from_timestamp_millis(issued_at_ms).is_none()
            || id.is_empty()
            || id.len() > 256
            || id.chars().any(char::is_control)
        {
            return Err("Invalid session cursor");
        }
        Ok(Self { issued_at_ms, id })
    }
}

/// A hint, not device identity. Invalid text is ignored; never split a UTF-8 code point.
pub fn normalize_user_agent(value: Option<&str>) -> Option<String> {
    let value = value.filter(|value| !value.is_empty() && !value.chars().any(char::is_control))?;
    let mut end = value.len().min(MAX_USER_AGENT_BYTES);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    Some(value[..end].to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_is_optional_text_with_utf8_byte_bound() {
        assert_eq!(normalize_user_agent(None), None);
        assert_eq!(normalize_user_agent(Some("")), None);
        assert_eq!(normalize_user_agent(Some("bad\nclient")), None);
        assert_eq!(normalize_user_agent(Some("Browser")), Some("Browser".into()));
        let value = format!("{}界", "a".repeat(511));
        assert_eq!(normalize_user_agent(Some(&value)), Some("a".repeat(511)));
        assert_eq!(normalize_user_agent(Some(&"界".repeat(200))).unwrap().len(), 510);
    }

    #[test]
    fn cursor_rejects_unbounded_or_invalid_values() {
        let cursor = SessionCursor { issued_at_ms: 1_800_000_000_123, id: "session-tie".into() };
        assert_eq!(SessionCursor::decode(&cursor.encode()), Ok(cursor));
        for value in ["".to_string(), "!bad".into(), "a".repeat(513),
            URL_SAFE_NO_PAD.encode(br#"[0,""]"#),
            URL_SAFE_NO_PAD.encode(br#"[9223372036854775807,"id"]"#)] {
            assert!(SessionCursor::decode(&value).is_err());
        }
    }
}
