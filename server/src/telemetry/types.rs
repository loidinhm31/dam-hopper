use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::privacy::HmacDigest;

const MAX_IDENTIFIER_LEN: usize = 128;
pub const TELEMETRY_SCHEMA_VERSION: u16 = 1;

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CodexModel(String);

impl CodexModel {
    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if !matches!(value.as_str(), "gpt-5.6-sol") {
            return Err("model must be a bounded Codex model identifier".to_string());
        }
        Ok(Self(value))
    }
}

impl TryFrom<String> for CodexModel {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> { Self::new(value) }
}

impl From<CodexModel> for String {
    fn from(value: CodexModel) -> Self { value.0 }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CodexVersion(String);

impl CodexVersion {
    pub fn new(value: impl Into<String>) -> Result<Self, String> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 32
            || !value.bytes().all(|byte| byte.is_ascii_digit() || byte == b'.' || byte == b'-')
        {
            return Err("version must contain only digits, dots, and hyphens".to_string());
        }
        Ok(Self(value))
    }
}

impl TryFrom<String> for CodexVersion {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> { Self::new(value) }
}

impl From<CodexVersion> for String {
    fn from(value: CodexVersion) -> Self { value.0 }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureQuality {
    Rich,
    Partial,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CorrelationQuality {
    Exact,
    Approximate,
    Unattributed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellKind {
    Bash,
    Zsh,
    Fish,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandOutcome {
    Succeeded,
    Failed,
    Interrupted,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenCounterSemantic {
    Delta,
    Cumulative,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TerminalRunId(pub Uuid);

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CommandEventId {
    pub run_id: TerminalRunId,
    pub sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalRunEvent {
    pub schema_version: u16,
    pub run_id: TerminalRunId,
    pub project: Option<SafeIdentifier>,
    pub shell: ShellKind,
    pub started_at_utc_ms: i64,
    pub ended_at_utc_ms: Option<i64>,
    pub capture_quality: CaptureQuality,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandEvent {
    pub schema_version: u16,
    pub id: CommandEventId,
    pub occurred_at_utc_ms: i64,
    pub duration_ms: Option<u64>,
    pub exit_code: Option<i32>,
    pub outcome: CommandOutcome,
    pub category: SafeIdentifier,
    pub executable: Option<SafeIdentifier>,
    pub argument_count: u16,
    pub fingerprint: HmacDigest,
    pub capture_quality: CaptureQuality,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentUsageEvent {
    pub schema_version: u16,
    pub id: HmacDigest,
    pub occurred_at_utc_ms: i64,
    pub conversation_fingerprint: Option<HmacDigest>,
    pub model: Option<CodexModel>,
    pub source_version: CodexVersion,
    pub correlation_quality: CorrelationQuality,
    pub counter_semantic: TokenCounterSemantic,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageQuery {
    pub schema_version: u16,
    pub from_utc_ms: Option<i64>,
    pub to_utc_ms: Option<i64>,
    pub project: Option<SafeIdentifier>,
    pub shell: Option<ShellKind>,
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
        assert!(super::CodexModel::new("fixture-secret").is_err());
        assert!(super::CodexVersion::new("0.145.0").is_ok());
        assert!(super::CodexVersion::new("https://intranet").is_err());
    }
}
