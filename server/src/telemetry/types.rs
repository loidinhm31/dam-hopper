use std::{collections::HashMap, sync::Mutex};

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

    /// A bounded sentinel for records that omit a usable source version. It
    /// carries no upstream value and keeps storage compatible with the
    /// existing non-null column.
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

/// Ephemeral proof that a Codex descendant inherited a DamHopper-owned OTLP
/// marker from its terminal shell. The marker is never persisted and expires
/// so stale/replayed events degrade to unattributed.
#[derive(Default)]
pub struct CodexCorrelationRegistry {
    markers: Mutex<HashMap<SafeIdentifier, CodexCorrelationEntry>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CodexCorrelationEntry {
    terminal_run_id: TerminalRunId,
    expires_at_utc_ms: i64,
}

const CODEX_MARKER_TTL_MS: i64 = 24 * 60 * 60 * 1_000;
const MAX_CODEX_MARKERS: usize = 512;

impl CodexCorrelationRegistry {
    pub fn register(
        &self,
        marker: SafeIdentifier,
        terminal_run_id: TerminalRunId,
        now_utc_ms: i64,
    ) {
        let mut markers = self
            .markers
            .lock()
            .expect("codex correlation lock poisoned");
        markers.retain(|_, entry| entry.expires_at_utc_ms > now_utc_ms);
        if markers.len() >= MAX_CODEX_MARKERS && !markers.contains_key(&marker) {
            if let Some(oldest) = markers
                .iter()
                .min_by_key(|(_, entry)| entry.expires_at_utc_ms)
                .map(|(marker, _)| marker.clone())
            {
                markers.remove(&oldest);
            }
        }
        markers.insert(
            marker,
            CodexCorrelationEntry {
                terminal_run_id,
                expires_at_utc_ms: now_utc_ms.saturating_add(CODEX_MARKER_TTL_MS),
            },
        );
    }

    pub fn resolve(&self, marker: &SafeIdentifier, now_utc_ms: i64) -> Option<TerminalRunId> {
        let mut markers = self
            .markers
            .lock()
            .expect("codex correlation lock poisoned");
        markers.retain(|_, entry| entry.expires_at_utc_ms > now_utc_ms);
        markers.get(marker).map(|entry| entry.terminal_run_id)
    }

    pub fn unregister(&self, marker: &SafeIdentifier, terminal_run_id: TerminalRunId) {
        let mut markers = self
            .markers
            .lock()
            .expect("codex correlation lock poisoned");
        if markers
            .get(marker)
            .is_some_and(|entry| entry.terminal_run_id == terminal_run_id)
        {
            markers.remove(marker);
        }
    }

    #[cfg(test)]
    pub fn active_len(&self, now_utc_ms: i64) -> usize {
        let mut markers = self
            .markers
            .lock()
            .expect("codex correlation lock poisoned");
        markers.retain(|_, entry| entry.expires_at_utc_ms > now_utc_ms);
        markers.len()
    }

    #[cfg(test)]
    pub fn active_run_ids(&self, now_utc_ms: i64) -> Vec<TerminalRunId> {
        let mut markers = self
            .markers
            .lock()
            .expect("codex correlation lock poisoned");
        markers.retain(|_, entry| entry.expires_at_utc_ms > now_utc_ms);
        markers.values().map(|entry| entry.terminal_run_id).collect()
    }
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
pub struct TerminalRunEnd {
    pub run_id: TerminalRunId,
    pub ended_at_utc_ms: i64,
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
    /// Resolved only from an active, process-local opaque marker. Phase 04
    /// decides how compact session summaries persist this association.
    pub terminal_run_id: Option<TerminalRunId>,
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
    pub capture_quality: Option<CaptureQuality>,
    pub category: Option<SafeIdentifier>,
    /// Current collection supports the Codex provider only. Kept as a bounded
    /// identifier so future providers do not turn query filters into raw input.
    pub agent: Option<SafeIdentifier>,
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
        for model in [
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.5",
            "gpt-5.4",
            "provider/model:v2",
        ] {
            assert!(super::CodexModel::new(model).is_ok(), "model: {model}");
        }
        assert!(super::CodexModel::new("").is_err());
        assert!(super::CodexModel::new("contains secret").is_err());
        assert!(super::CodexModel::new("https://intranet").is_err());
        assert!(super::CodexModel::new("/etc/passwd").is_err());
        assert!(super::CodexModel::new("x".repeat(65)).is_err());
        assert!(super::CodexVersion::new("0.145.0").is_ok());
        assert!(super::CodexVersion::new("https://intranet").is_err());
    }

    #[test]
    fn correlation_registry_resolves_owner_and_expires_marker() {
        let registry = super::CodexCorrelationRegistry::default();
        let marker = SafeIdentifier::new("marker-safe").unwrap();
        let run_id = super::TerminalRunId(uuid::Uuid::new_v4());
        registry.register(marker.clone(), run_id, 1);

        assert_eq!(registry.resolve(&marker, 1), Some(run_id));
        assert_eq!(
            registry.resolve(&marker, 1 + super::CODEX_MARKER_TTL_MS),
            None
        );
    }
}
