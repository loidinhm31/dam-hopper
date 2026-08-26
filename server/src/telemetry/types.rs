use serde::{Deserialize, Serialize};

use super::privacy::HmacDigest;

const MAX_IDENTIFIER_LEN: usize = 128;
pub const TELEMETRY_SCHEMA_VERSION: u16 = 1;
/// Bound a single response duration before it reaches SQLite or any aggregate.
/// A week is generous for a response while keeping sums and retention work
/// bounded even when the source sends a malformed value.
pub const MAX_DURATION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
/// Bound each token component before it is admitted to the durable event
/// table. Values above this are malformed source data, not usable counters.
pub const MAX_TOKEN_COMPONENT: u64 = 1_000_000_000_000;
/// Bound session and daily token totals below SQLite's signed integer limit.
/// Aggregation uses saturating SQL expressions at this boundary.
pub const MAX_TOKEN_TOTAL: u64 = 9_000_000_000_000_000_000;
/// Keep event dates inside the range supported by SQLite's UTC date helpers.
pub const MAX_TIMESTAMP_UTC_MS: i64 = 4_102_444_800_000;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SafeIdentifier(String);

impl SafeIdentifier {
    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if value.is_empty()
            || value.len() > MAX_IDENTIFIER_LEN
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        {
            return Err("identifier must be 1-128 safe ASCII characters".to_string());
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SafeIdentifier {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<SafeIdentifier> for String {
    fn from(value: SafeIdentifier) -> Self {
        value.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CodexModel(String);

impl CodexModel {
    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        let bounded_chars = value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/' | b':')
        });
        let bounded_shape = value
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && value
                .bytes()
                .last()
                .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && !value.contains("://")
            && !value.contains("//")
            && !value.contains("..");
        if value.len() > 64 || !bounded_chars || !bounded_shape {
            return Err("model must be 1-64 safe ASCII identifier characters".to_string());
        }
        Ok(Self(value))
    }
}

impl TryFrom<String> for CodexModel {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<CodexModel> for String {
    fn from(value: CodexModel) -> Self {
        value.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CodexVersion(String);

impl CodexVersion {
    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 32
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.' || byte == b'-')
        {
            return Err("version must contain only digits, dots, and hyphens".to_string());
        }
        Ok(Self(value))
    }

    pub fn unknown() -> Self {
        Self("unknown".to_string())
    }
}

impl TryFrom<String> for CodexVersion {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<CodexVersion> for String {
    fn from(value: CodexVersion) -> Self {
        value.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceQuality {
    Verified,
    Unverified,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenQuality {
    Exact,
    Partial,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenCounterSemantic {
    Delta,
    Cumulative,
}

/// Normalized, persistence-safe input to the Codex usage worker. It is the
/// only event type accepted by the production telemetry queue.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodexUsageEvent {
    pub schema_version: u16,
    pub id: HmacDigest,
    pub occurred_at_utc_ms: i64,
    pub session_fingerprint: Option<HmacDigest>,
    pub model: Option<CodexModel>,
    pub source_version: CodexVersion,
    pub source_quality: SourceQuality,
    pub status: SafeIdentifier,
    pub counter_semantic: TokenCounterSemantic,
    pub duration_ms: Option<u64>,
    pub token_quality: TokenQuality,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
}

impl CodexUsageEvent {
    pub fn token_quality(&self) -> TokenQuality {
        self.token_quality
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodexSessionSummary {
    pub session_id: HmacDigest,
    pub model: Option<CodexModel>,
    pub source_version: CodexVersion,
    pub source_quality: SourceQuality,
    pub started_at_utc_ms: i64,
    pub ended_at_utc_ms: Option<i64>,
    pub status: SafeIdentifier,
    pub counter_semantic: TokenCounterSemantic,
    pub token_quality: TokenQuality,
    pub response_count: u64,
    pub duration_ms_sum: Option<u64>,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub updated_at_utc_ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTokenQuality {
    Exact,
    Partial,
    TokenDataUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Root,
    Main,
    Subagent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentRunSummary {
    pub run_id: HmacDigest,
    pub root_run_id: HmacDigest,
    pub parent_run_id: Option<HmacDigest>,
    pub provider: SafeIdentifier,
    pub role: AgentRole,
    pub model: Option<CodexModel>,
    pub source_version: CodexVersion,
    pub started_at_utc_ms: i64,
    pub ended_at_utc_ms: Option<i64>,
    pub status: SafeIdentifier,
    pub token_quality: AgentTokenQuality,
    pub counter_semantic: TokenCounterSemantic,
    pub response_count: u64,
    pub duration_ms_sum: Option<u64>,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub updated_at_utc_ms: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageQuery {
    pub schema_version: u16,
    pub from_utc_ms: Option<i64>,
    pub to_utc_ms: Option<i64>,
    pub model: Option<CodexModel>,
}

#[cfg(test)]
mod tests {
    use super::SafeIdentifier;

    #[test]
    fn safe_identifier_rejects_content_like_values() {
        assert!(SafeIdentifier::new("gpt-5.6-sol").is_ok());
        assert!(SafeIdentifier::new("https://intranet/secret").is_err());
        assert!(SafeIdentifier::new("secret\nvalue").is_err());
    }

    #[test]
    fn model_and_version_reject_content_like_values() {
        assert!(super::CodexModel::new("gpt-5.6-sol").is_ok());
        assert!(super::CodexModel::new("contains secret").is_err());
        assert!(super::CodexModel::new("/etc/passwd").is_err());
        assert!(super::CodexVersion::new("0.145.0").is_ok());
        assert!(super::CodexVersion::new("https://intranet").is_err());
    }
}
