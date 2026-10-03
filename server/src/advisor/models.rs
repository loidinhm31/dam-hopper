use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Semaphore;
use tokio::time::timeout;

use crate::advisor::error::AdvisorError;
use crate::advisor::policy::{check_credentials, is_valid_effort_for_backend, ENABLED_BACKENDS};
use crate::advisor::snapshots::current_time_ms;

pub const MAX_DISCOVERY_STDOUT_BYTES: usize = 5 * 1024 * 1024; // 5 MiB
pub const MAX_LINE_BYTES: usize = 1024 * 1024; // 1 MiB
pub const MAX_NORMALIZED_MODELS: usize = 500;
pub const MAX_ID_LABEL_BYTES: usize = 256;
pub const MAX_RESPONSE_BYTES: usize = 256 * 1024; // 256 KiB
pub const DISCOVERY_TIMEOUT_SECS: u64 = 5;

// Diagnostics
pub const HARNESS_NOT_FOUND: &str = "HARNESS_NOT_FOUND";
pub const HARNESS_CATALOG_EMPTY: &str = "HARNESS_CATALOG_EMPTY";
pub const HARNESS_DISCOVERY_TIMEOUT: &str = "HARNESS_DISCOVERY_TIMEOUT";
pub const HARNESS_OUTPUT_LIMIT: &str = "HARNESS_OUTPUT_LIMIT";
pub const HARNESS_OUTPUT_INVALID: &str = "HARNESS_OUTPUT_INVALID";
pub const HARNESS_DISCOVERY_FAILED: &str = "HARNESS_DISCOVERY_FAILED";
pub const HARNESS_PROTOCOL_UNSUPPORTED: &str = "HARNESS_PROTOCOL_UNSUPPORTED";
pub const HARNESS_DISCOVERY_UNSAFE: &str = "HARNESS_DISCOVERY_UNSAFE";
pub const HARNESS_CATALOG_TRUNCATED: &str = "HARNESS_CATALOG_TRUNCATED";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AdvisorBackend {
    Omp,
    Codex,
    Claude,
    Pi,
}

impl AdvisorBackend {
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "omp" => Some(Self::Omp),
            "codex" => Some(Self::Codex),
            "claude" => Some(Self::Claude),
            "pi" => Some(Self::Pi),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Omp => "omp",
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Pi => "pi",
        }
    }
}

impl std::fmt::Display for AdvisorBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdvisorModelsParamsDto {
    pub backend: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorModelOptionDto {
    pub id: String,
    pub label: String,
    pub efforts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorModelsResultDto {
    pub backend: String,
    pub source: String, // "harness" | "fallback"
    pub models: Vec<AdvisorModelOptionDto>,
    pub efforts: Vec<String>,
    pub default_effort: String,
    pub observed_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_code: Option<String>,
}

pub fn backend_effort_suggestions(backend: &str) -> Vec<String> {
    match backend {
        "codex" => vec!["low".into(), "medium".into(), "high".into(), "xhigh".into()],
        "claude" => vec![
            "low".into(),
            "medium".into(),
            "high".into(),
            "xhigh".into(),
            "max".into(),
        ],
        "omp" | "pi" => vec![
            "off".into(),
            "minimal".into(),
            "low".into(),
            "medium".into(),
            "high".into(),
            "xhigh".into(),
            "max".into(),
        ],
        _ => Vec::new(),
    }
}

pub fn fallback_catalog(backend: &str) -> (Vec<AdvisorModelOptionDto>, Vec<String>, &'static str) {
    let default_effort = "medium";
    let efforts = backend_effort_suggestions(backend);
    let models = match backend {
        "codex" => vec![AdvisorModelOptionDto {
            id: "gpt-6.1-sol".into(),
            label: "gpt-6.1-sol".into(),
            efforts: efforts.clone(),
        }],
        "claude" => vec![
            AdvisorModelOptionDto {
                id: "sonnet".into(),
                label: "sonnet".into(),
                efforts: efforts.clone(),
            },
            AdvisorModelOptionDto {
                id: "opus".into(),
                label: "opus".into(),
                efforts: efforts.clone(),
            },
            AdvisorModelOptionDto {
                id: "haiku".into(),
                label: "haiku".into(),
                efforts: efforts.clone(),
            },
        ],
        "omp" | "pi" => vec![
            AdvisorModelOptionDto {
                id: "openai/gpt-6.1-sol".into(),
                label: "openai/gpt-6.1-sol".into(),
                efforts: efforts.clone(),
            },
            AdvisorModelOptionDto {
                id: "anthropic/claude-sonnet-5-5".into(),
                label: "anthropic/claude-sonnet-5-5".into(),
                efforts: efforts.clone(),
            },
        ],
        _ => Vec::new(),
    };
    (models, efforts, default_effort)
}

fn contains_credential_substring(s: &str) -> bool {
    let lower = s.to_lowercase();
    lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("passwd")
        || lower.contains("authorization")
        || lower.contains("cookie")
        || lower.contains("credential")
}

pub fn normalize_and_filter_models(
    raw_models: Vec<AdvisorModelOptionDto>,
) -> (Vec<AdvisorModelOptionDto>, bool) {
    let mut seen = HashSet::new();
    let mut filtered = Vec::new();

    for m in raw_models {
        let id = m.id.trim();
        let label = m.label.trim();

        if id.is_empty() || label.is_empty() {
            continue;
        }
        if id.len() > MAX_ID_LABEL_BYTES || label.len() > MAX_ID_LABEL_BYTES {
            continue;
        }
        if id.chars().any(|c| c.is_ascii_control()) || label.chars().any(|c| c.is_ascii_control()) {
            continue;
        }
        if contains_credential_substring(id) || contains_credential_substring(label) {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }

        filtered.push(AdvisorModelOptionDto {
            id: id.to_string(),
            label: label.to_string(),
            efforts: m.efforts,
        });
    }

    filtered.sort_by(|a, b| a.label.cmp(&b.label).then_with(|| a.id.cmp(&b.id)));

    let mut truncated = false;
    if filtered.len() > MAX_NORMALIZED_MODELS {
        filtered.truncate(MAX_NORMALIZED_MODELS);
        truncated = true;
    }

    while filtered.len() > 1 {
        if let Ok(bytes) = serde_json::to_vec(&filtered) {
            if bytes.len() > MAX_RESPONSE_BYTES {
                filtered.pop();
                truncated = true;
                continue;
            }
        }
        break;
    }

    (filtered, truncated)
}

pub fn parse_omp_models(bytes: &[u8]) -> Result<Vec<AdvisorModelOptionDto>, String> {
    let val: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("Invalid JSON: {e}"))?;
    if check_credentials(&val) {
        return Err("Credential fields detected in output".to_string());
    }

    let default_efforts = backend_effort_suggestions("omp");

    let model_items = if let Some(arr) = val.get("models").and_then(|m| m.as_array()) {
        arr
    } else if let Some(arr) = val.as_array() {
        arr
    } else {
        return Err("Expected models array".to_string());
    };

    let mut result = Vec::new();
    for item in model_items {
        if !item.is_object() {
            continue;
        }
        let selector = item.get("selector").and_then(|s| s.as_str());
        let provider = item.get("provider").and_then(|p| p.as_str());
        let id_val = item.get("id").and_then(|i| i.as_str());

        let model_id = if let Some(s) = selector {
            if !s.is_empty() {
                s.to_string()
            } else if let (Some(p), Some(i)) = (provider, id_val) {
                format!("{p}/{i}")
            } else if let Some(i) = id_val {
                i.to_string()
            } else {
                continue;
            }
        } else if let (Some(p), Some(i)) = (provider, id_val) {
            format!("{p}/{i}")
        } else if let Some(i) = id_val {
            i.to_string()
        } else {
            continue;
        };

        let label = item
            .get("displayName")
            .or_else(|| item.get("name"))
            .or_else(|| item.get("label"))
            .and_then(|l| l.as_str())
            .unwrap_or(&model_id)
            .to_string();

        let mut efforts = Vec::new();
        if let Some(thinking_arr) = item.get("thinking").and_then(|t| t.as_array()) {
            for th in thinking_arr {
                if let Some(s) = th.as_str() {
                    if is_valid_effort_for_backend("omp", s) && !efforts.contains(&s.to_string()) {
                        efforts.push(s.to_string());
                    }
                }
            }
        }
        if efforts.is_empty() {
            efforts = default_efforts.clone();
        }

        result.push(AdvisorModelOptionDto {
            id: model_id,
            label,
            efforts,
        });
    }

    Ok(result)
}

pub fn parse_pi_models(bytes: &[u8]) -> Result<Vec<AdvisorModelOptionDto>, String> {
    let text = String::from_utf8_lossy(bytes);
    if contains_credential_substring(&text) {
        return Err("Credential patterns detected in output".to_string());
    }
    if text.contains("No models available") || text.contains("Use /login") {
        return Ok(Vec::new());
    }

    let default_efforts = backend_effort_suggestions("pi");
    let mut result = Vec::new();
    let mut header_seen = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if !header_seen {
            if lower.contains("provider") && lower.contains("model") {
                header_seen = true;
            }
            continue;
        }

        if trimmed.starts_with("---") || trimmed.starts_with("===") {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let provider = parts[0];
        let model = parts[1];
        let model_id = if model.contains('/') {
            model.to_string()
        } else {
            format!("{provider}/{model}")
        };

        let mut efforts = Vec::new();
        // Check if remaining tokens contain thinking levels
        for p in &parts[2..] {
            let cleaned = p.trim_matches(|c: char| c == ',' || c == '[' || c == ']');
            if is_valid_effort_for_backend("pi", cleaned) && !efforts.contains(&cleaned.to_string()) {
                efforts.push(cleaned.to_string());
            }
        }
        if efforts.is_empty() {
            efforts = default_efforts.clone();
        }

        result.push(AdvisorModelOptionDto {
            id: model_id.clone(),
            label: model_id,
            efforts,
        });
    }

    Ok(result)
}

pub fn parse_codex_models(bytes: &[u8]) -> Result<Vec<AdvisorModelOptionDto>, String> {
    let text = String::from_utf8_lossy(bytes);
    let mut root_val = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if check_credentials(&v) {
                return Err("Credential fields detected in output".to_string());
            }
            if v.get("result").and_then(|r| r.get("data")).is_some() || v.get("data").is_some() {
                root_val = Some(v);
                break;
            }
        }
    }

    if root_val.is_none() {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(bytes) {
            if check_credentials(&v) {
                return Err("Credential fields detected in output".to_string());
            }
            root_val = Some(v);
        }
    }

    let val = root_val.ok_or_else(|| "Could not locate codex model/list result".to_string())?;
    let default_efforts = backend_effort_suggestions("codex");

    let data_arr = val
        .get("result")
        .and_then(|r| r.get("data"))
        .or_else(|| val.get("data"))
        .and_then(|d| d.as_array())
        .ok_or_else(|| "Expected data array in codex result".to_string())?;

    let mut result = Vec::new();
    for item in data_arr {
        if item.get("isInternal").and_then(|b| b.as_bool()).unwrap_or(false)
            || item.get("hidden").and_then(|b| b.as_bool()).unwrap_or(false)
        {
            continue;
        }

        let model_id = match item.get("model").or_else(|| item.get("id")).and_then(|s| s.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };

        let label = item
            .get("displayName")
            .and_then(|s| s.as_str())
            .unwrap_or(&model_id)
            .to_string();

        let mut efforts = Vec::new();
        if let Some(re_arr) = item
            .get("supportedReasoningEfforts")
            .and_then(|e| e.as_array())
        {
            for re in re_arr {
                let effort_name = re
                    .get("reasoningEffort")
                    .and_then(|s| s.as_str())
                    .or_else(|| re.as_str());
                if let Some(en) = effort_name {
                    if is_valid_effort_for_backend("codex", en)
                        && !efforts.contains(&en.to_string())
                    {
                        efforts.push(en.to_string());
                    }
                }
            }
        }
        if efforts.is_empty() {
            efforts = default_efforts.clone();
        }

        result.push(AdvisorModelOptionDto {
            id: model_id,
            label,
            efforts,
        });
    }

    Ok(result)
}

pub fn parse_claude_models(bytes: &[u8]) -> Result<Vec<AdvisorModelOptionDto>, String> {
    let text = String::from_utf8_lossy(bytes);
    let mut models_val = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if check_credentials(&v) {
                return Err("Credential fields detected in output".to_string());
            }
            if let Some(m) = v
                .get("response")
                .and_then(|r| r.get("response"))
                .and_then(|r2| r2.get("models"))
                .or_else(|| v.get("response").and_then(|r| r.get("models")))
                .or_else(|| v.get("models"))
            {
                models_val = Some(m.clone());
                break;
            }
        }
    }

    if models_val.is_none() {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(bytes) {
            if check_credentials(&v) {
                return Err("Credential fields detected in output".to_string());
            }
            if let Some(m) = v
                .get("response")
                .and_then(|r| r.get("response"))
                .and_then(|r2| r2.get("models"))
                .or_else(|| v.get("response").and_then(|r| r.get("models")))
                .or_else(|| v.get("models"))
            {
                models_val = Some(m.clone());
            }
        }
    }

    let models_arr = models_val
        .and_then(|v| v.as_array().cloned())
        .ok_or_else(|| "Could not locate claude models array".to_string())?;

    let default_efforts = backend_effort_suggestions("claude");
    let mut result = Vec::new();

    for item in models_arr {
        let model_id = match item.get("value").or_else(|| item.get("id")).and_then(|s| s.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };

        let label = item
            .get("displayName")
            .and_then(|s| s.as_str())
            .unwrap_or(&model_id)
            .to_string();

        let mut efforts = Vec::new();
        if let Some(eff_arr) = item.get("supportedEffortLevels").and_then(|e| e.as_array()) {
            for eff in eff_arr {
                if let Some(s) = eff.as_str() {
                    if is_valid_effort_for_backend("claude", s)
                        && !efforts.contains(&s.to_string())
                    {
                        efforts.push(s.to_string());
                    }
                }
            }
        }
        if efforts.is_empty() {
            efforts = default_efforts.clone();
        }

        result.push(AdvisorModelOptionDto {
            id: model_id,
            label,
            efforts,
        });
    }

    Ok(result)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandOutput {
    pub stdout: Vec<u8>,
    pub truncated: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum HarnessRunError {
    #[error("harness binary not found")]
    NotFound,
    #[error("discovery timed out")]
    Timeout,
    #[error("output limit exceeded")]
    OutputLimit,
    #[error("execution failed: {0}")]
    Execution(String),
    #[error("execution unsafe: {0}")]
    Unsafe(String),
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait HarnessCommandRunner: Send + Sync {
    fn run_backend<'a>(
        &'a self,
        backend: AdvisorBackend,
        home: Option<&'a Path>,
    ) -> BoxFuture<'a, Result<CommandOutput, HarnessRunError>>;
}

#[derive(Debug, Default, Clone)]
pub struct ProductionHarnessCommandRunner;

impl ProductionHarnessCommandRunner {
    async fn read_bounded_stdout<R: tokio::io::AsyncRead + Unpin>(
        reader: &mut R,
        max_bytes: usize,
    ) -> Result<(Vec<u8>, bool), HarnessRunError> {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 8192];
        let mut truncated = false;

        loop {
            let n = reader
                .read(&mut chunk)
                .await
                .map_err(|e| HarnessRunError::Execution(format!("stdout read failed: {e}")))?;
            if n == 0 {
                break;
            }
            if buffer.len() + n > max_bytes {
                let allowed = max_bytes.saturating_sub(buffer.len());
                buffer.extend_from_slice(&chunk[..allowed]);
                truncated = true;
                break;
            } else {
                buffer.extend_from_slice(&chunk[..n]);
            }
        }

        Ok((buffer, truncated))
    }
}

impl HarnessCommandRunner for ProductionHarnessCommandRunner {
    fn run_backend<'a>(
        &'a self,
        backend: AdvisorBackend,
        home: Option<&'a Path>,
    ) -> BoxFuture<'a, Result<CommandOutput, HarnessRunError>> {
        Box::pin(async move {
            let temp_dir = tempfile::TempDir::new()
                .map_err(|e| HarnessRunError::Execution(format!("tempdir failed: {e}")))?;
            let cwd = temp_dir.path().to_path_buf();

            let run_op = async {
                match backend {
                    AdvisorBackend::Omp => {
                        let mut cmd = tokio::process::Command::new("omp");
                        cmd.args(["models", "ls", "--json", "--no-extensions"])
                            .current_dir(&cwd)
                            .stdin(Stdio::null())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::null())
                            .env("LC_ALL", "C")
                            .env("LANG", "C")
                            .env("NO_COLOR", "1")
                            .kill_on_drop(true);

                        if let Some(h) = home {
                            cmd.env("HOME", h);
                        }

                        let mut child = match cmd.spawn() {
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                                return Err(HarnessRunError::NotFound);
                            }
                            Err(e) => {
                                return Err(HarnessRunError::Execution(format!("spawn failed: {e}")));
                            }
                            Ok(c) => c,
                        };

                        let mut stdout = child
                            .stdout
                            .take()
                            .ok_or_else(|| HarnessRunError::Execution("missing stdout".into()))?;

                        let (bytes, truncated) =
                            Self::read_bounded_stdout(&mut stdout, MAX_DISCOVERY_STDOUT_BYTES).await?;
                        drop(stdout);
                        let status = child.wait().await.map_err(|e| {
                            HarnessRunError::Execution(format!("child wait failed: {e}"))
                        })?;

                        if !status.success() && bytes.is_empty() {
                            return Err(HarnessRunError::Execution(format!("exit code {status}")));
                        }

                        Ok(CommandOutput {
                            stdout: bytes,
                            truncated,
                        })
                    }

                    AdvisorBackend::Pi => {
                        let mut cmd = tokio::process::Command::new("pi");
                        cmd.args(["--offline", "--list-models", "--no-extensions"])
                            .current_dir(&cwd)
                            .stdin(Stdio::null())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::null())
                            .env("LC_ALL", "C")
                            .env("LANG", "C")
                            .env("NO_COLOR", "1")
                            .kill_on_drop(true);

                        if let Some(h) = home {
                            cmd.env("HOME", h);
                        }

                        let mut child = match cmd.spawn() {
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                                return Err(HarnessRunError::NotFound);
                            }
                            Err(e) => {
                                return Err(HarnessRunError::Execution(format!("spawn failed: {e}")));
                            }
                            Ok(c) => c,
                        };

                        let mut stdout = child
                            .stdout
                            .take()
                            .ok_or_else(|| HarnessRunError::Execution("missing stdout".into()))?;

                        let (bytes, truncated) =
                            Self::read_bounded_stdout(&mut stdout, MAX_DISCOVERY_STDOUT_BYTES).await?;
                        drop(stdout);
                        let status = child.wait().await.map_err(|e| {
                            HarnessRunError::Execution(format!("child wait failed: {e}"))
                        })?;

                        if !status.success() && bytes.is_empty() {
                            return Err(HarnessRunError::Execution(format!("exit code {status}")));
                        }

                        Ok(CommandOutput {
                            stdout: bytes,
                            truncated,
                        })
                    }

                    AdvisorBackend::Codex => {
                        let mut cmd = tokio::process::Command::new("codex");
                        cmd.args(["app-server", "--listen", "stdio://"])
                            .current_dir(&cwd)
                            .stdin(Stdio::piped())
                            .stdout(Stdio::piped())
                            .stderr(Stdio::null())
                            .env("LC_ALL", "C")
                            .env("LANG", "C")
                            .env("NO_COLOR", "1")
                            .env("CODEX_HOME", &cwd)
                            .kill_on_drop(true);

                        if let Some(h) = home {
                            cmd.env("HOME", h);
                        }

                        let mut child = match cmd.spawn() {
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                                return Err(HarnessRunError::NotFound);
                            }
                            Err(e) => {
                                return Err(HarnessRunError::Execution(format!("spawn failed: {e}")));
                            }
                            Ok(c) => c,
                        };

                        let mut stdin = child
                            .stdin
                            .take()
                            .ok_or_else(|| HarnessRunError::Execution("missing stdin".into()))?;
                        let stdout = child
                            .stdout
                            .take()
                            .ok_or_else(|| HarnessRunError::Execution("missing stdout".into()))?;

                        let mut reader = BufReader::new(stdout);

                        // 1. Send initialize
                        let init_req = "{\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"dam_hopper_advisor_models\",\"title\":\"Advisor model discovery\",\"version\":\"0.1.0\"}}}\n";
                        stdin
                            .write_all(init_req.as_bytes())
                            .await
                            .map_err(|e| HarnessRunError::Execution(format!("write init failed: {e}")))?;
                        stdin.flush().await.map_err(|e| {
                            HarnessRunError::Execution(format!("flush init failed: {e}"))
                        })?;

                        // Read response to initialize
                        let mut line = String::new();
                        loop {
                            line.clear();
                            let n = reader.read_line(&mut line).await.map_err(|e| {
                                HarnessRunError::Execution(format!("read line failed: {e}"))
                            })?;
                            if n == 0 {
                                return Err(HarnessRunError::Execution("unexpected EOF on codex init".into()));
                            }
                            if line.contains("\"id\":1") || line.contains("\"id\": 1") {
                                break;
                            }
                        }

                        // 2. Send initialized notification & model/list request
                        let notif = "{\"method\":\"initialized\",\"params\":{}}\n";
                        let list_req = "{\"id\":2,\"method\":\"model/list\",\"params\":{\"limit\":100,\"includeHidden\":false}}\n";
                        stdin
                            .write_all(notif.as_bytes())
                            .await
                            .map_err(|e| HarnessRunError::Execution(format!("write notif failed: {e}")))?;
                        stdin
                            .write_all(list_req.as_bytes())
                            .await
                            .map_err(|e| HarnessRunError::Execution(format!("write list failed: {e}")))?;
                        stdin.flush().await.map_err(|e| {
                            HarnessRunError::Execution(format!("flush list failed: {e}"))
                        })?;

                        // 3. Read response to model/list
                        let result_line = loop {
                            line.clear();
                            let n = reader.read_line(&mut line).await.map_err(|e| {
                                HarnessRunError::Execution(format!("read line failed: {e}"))
                            })?;
                            if n == 0 {
                                return Err(HarnessRunError::Execution("unexpected EOF on codex list".into()));
                            }
                            if line.contains("\"id\":2") || line.contains("\"id\": 2") {
                                break line.clone();
                            }
                        };

                        drop(stdin);
                        let _ = child.kill().await;

                        Ok(CommandOutput {
                            stdout: result_line.into_bytes(),
                            truncated: false,
                        })
                    }

                    AdvisorBackend::Claude => {
                        let mut cmd = tokio::process::Command::new("claude");
                        cmd.args([
                            "--input-format",
                            "stream-json",
                            "--output-format",
                            "stream-json",
                            "--verbose",
                            "--setting-sources=",
                            "--settings",
                            "{\"disableAllHooks\":true}",
                            "--strict-mcp-config",
                            "--mcp-config",
                            "{\"mcpServers\":{}}",
                            "--tools",
                            "",
                            "--disable-slash-commands",
                            "--no-session-persistence",
                        ])
                        .current_dir(&cwd)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::null())
                        .env("LC_ALL", "C")
                        .env("LANG", "C")
                        .env("NO_COLOR", "1")
                        .kill_on_drop(true);

                        if let Some(h) = home {
                            cmd.env("HOME", h);
                        }

                        let mut child = match cmd.spawn() {
                            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                                return Err(HarnessRunError::NotFound);
                            }
                            Err(e) => {
                                return Err(HarnessRunError::Execution(format!("spawn failed: {e}")));
                            }
                            Ok(c) => c,
                        };

                        let mut stdin = child
                            .stdin
                            .take()
                            .ok_or_else(|| HarnessRunError::Execution("missing stdin".into()))?;
                        let stdout = child
                            .stdout
                            .take()
                            .ok_or_else(|| HarnessRunError::Execution("missing stdout".into()))?;

                        let mut reader = BufReader::new(stdout);

                        let init_req = "{\"type\":\"control_request\",\"request_id\":\"advisor-models-init\",\"request\":{\"subtype\":\"initialize\",\"hooks\":{}}}\n";
                        stdin
                            .write_all(init_req.as_bytes())
                            .await
                            .map_err(|e| HarnessRunError::Execution(format!("write init failed: {e}")))?;
                        stdin.flush().await.map_err(|e| {
                            HarnessRunError::Execution(format!("flush init failed: {e}"))
                        })?;

                        let mut line = String::new();
                        let mut result_line = String::new();
                        loop {
                            line.clear();
                            let n = reader.read_line(&mut line).await.map_err(|e| {
                                HarnessRunError::Execution(format!("read line failed: {e}"))
                            })?;
                            if n == 0 {
                                break;
                            }
                            if line.contains("advisor-models-init") && line.contains("control_response") {
                                result_line = line.clone();
                                break;
                            }
                        }

                        drop(stdin);
                        let _ = child.kill().await;

                        if result_line.is_empty() {
                            return Err(HarnessRunError::Execution("claude init response not found".into()));
                        }

                        Ok(CommandOutput {
                            stdout: result_line.into_bytes(),
                            truncated: false,
                        })
                    }
                }
            };

            match timeout(Duration::from_secs(DISCOVERY_TIMEOUT_SECS), run_op).await {
                Ok(res) => res,
                Err(_) => Err(HarnessRunError::Timeout),
            }
        })
    }
}

pub struct FakeHarnessCommandRunner {
    pub omp_result: parking_lot::Mutex<Option<Result<CommandOutput, HarnessRunError>>>,
    pub pi_result: parking_lot::Mutex<Option<Result<CommandOutput, HarnessRunError>>>,
    pub codex_result: parking_lot::Mutex<Option<Result<CommandOutput, HarnessRunError>>>,
    pub claude_result: parking_lot::Mutex<Option<Result<CommandOutput, HarnessRunError>>>,
}

impl FakeHarnessCommandRunner {
    pub fn new() -> Self {
        Self {
            omp_result: parking_lot::Mutex::new(None),
            pi_result: parking_lot::Mutex::new(None),
            codex_result: parking_lot::Mutex::new(None),
            claude_result: parking_lot::Mutex::new(None),
        }
    }

    pub fn set_result(&self, backend: AdvisorBackend, res: Result<CommandOutput, HarnessRunError>) {
        match backend {
            AdvisorBackend::Omp => *self.omp_result.lock() = Some(res),
            AdvisorBackend::Pi => *self.pi_result.lock() = Some(res),
            AdvisorBackend::Codex => *self.codex_result.lock() = Some(res),
            AdvisorBackend::Claude => *self.claude_result.lock() = Some(res),
        }
    }
}

impl HarnessCommandRunner for FakeHarnessCommandRunner {
    fn run_backend<'a>(
        &'a self,
        backend: AdvisorBackend,
        _home: Option<&'a Path>,
    ) -> BoxFuture<'a, Result<CommandOutput, HarnessRunError>> {
        let res = match backend {
            AdvisorBackend::Omp => self.omp_result.lock().take(),
            AdvisorBackend::Pi => self.pi_result.lock().take(),
            AdvisorBackend::Codex => self.codex_result.lock().take(),
            AdvisorBackend::Claude => self.claude_result.lock().take(),
        };

        Box::pin(async move {
            res.unwrap_or_else(|| {
                Err(HarnessRunError::Execution("no fake result configured".into()))
            })
        })
    }
}

pub struct HarnessModelService {
    runner: Arc<dyn HarnessCommandRunner>,
    semaphore: Arc<Semaphore>,
    home_dir: Option<PathBuf>,
}

impl HarnessModelService {
    pub fn new(home_dir: Option<PathBuf>) -> Self {
        Self {
            runner: Arc::new(ProductionHarnessCommandRunner),
            semaphore: Arc::new(Semaphore::new(2)),
            home_dir,
        }
    }

    pub fn with_runner(home_dir: Option<PathBuf>, runner: Arc<dyn HarnessCommandRunner>) -> Self {
        Self {
            runner,
            semaphore: Arc::new(Semaphore::new(2)),
            home_dir,
        }
    }

    pub fn build_fallback(
        &self,
        backend_str: &str,
        issue_code: &str,
    ) -> AdvisorModelsResultDto {
        let (models, efforts, default_effort) = fallback_catalog(backend_str);
        AdvisorModelsResultDto {
            backend: backend_str.to_string(),
            source: "fallback".to_string(),
            models,
            efforts,
            default_effort: default_effort.to_string(),
            observed_at: current_time_ms(),
            issue_code: Some(issue_code.to_string()),
        }
    }

    pub async fn discover_models(
        &self,
        backend_str: &str,
    ) -> Result<AdvisorModelsResultDto, AdvisorError> {
        let trimmed_backend = backend_str.trim();
        if !ENABLED_BACKENDS.contains(&trimmed_backend) {
            return Err(AdvisorError::InvalidInput(format!(
                "Unknown advisor backend: {backend_str}"
            )));
        }

        let backend = match AdvisorBackend::from_str_opt(trimmed_backend) {
            Some(b) => b,
            None => {
                return Err(AdvisorError::InvalidInput(format!(
                    "Unknown advisor backend: {backend_str}"
                )));
            }
        };

        // Bounded semaphore with timeout
        let _permit = match timeout(
            Duration::from_secs(DISCOVERY_TIMEOUT_SECS),
            self.semaphore.acquire(),
        )
        .await
        {
            Ok(Ok(p)) => p,
            _ => return Ok(self.build_fallback(trimmed_backend, HARNESS_DISCOVERY_TIMEOUT)),
        };

        let cmd_output = match self
            .runner
            .run_backend(backend, self.home_dir.as_deref())
            .await
        {
            Ok(output) => output,
            Err(HarnessRunError::NotFound) => {
                return Ok(self.build_fallback(trimmed_backend, HARNESS_NOT_FOUND));
            }
            Err(HarnessRunError::Timeout) => {
                return Ok(self.build_fallback(trimmed_backend, HARNESS_DISCOVERY_TIMEOUT));
            }
            Err(HarnessRunError::OutputLimit) => {
                return Ok(self.build_fallback(trimmed_backend, HARNESS_OUTPUT_LIMIT));
            }
            Err(HarnessRunError::Unsafe(_)) => {
                return Ok(self.build_fallback(trimmed_backend, HARNESS_DISCOVERY_UNSAFE));
            }
            Err(HarnessRunError::Execution(_)) => {
                return Ok(self.build_fallback(trimmed_backend, HARNESS_DISCOVERY_FAILED));
            }
        };

        let raw_models = match backend {
            AdvisorBackend::Omp => parse_omp_models(&cmd_output.stdout),
            AdvisorBackend::Pi => parse_pi_models(&cmd_output.stdout),
            AdvisorBackend::Codex => parse_codex_models(&cmd_output.stdout),
            AdvisorBackend::Claude => parse_claude_models(&cmd_output.stdout),
        };

        let parsed_models = match raw_models {
            Ok(m) => m,
            Err(_) => return Ok(self.build_fallback(trimmed_backend, HARNESS_OUTPUT_INVALID)),
        };

        let (models, models_truncated) = normalize_and_filter_models(parsed_models);

        if models.is_empty() {
            return Ok(self.build_fallback(trimmed_backend, HARNESS_CATALOG_EMPTY));
        }

        let issue_code = if cmd_output.truncated || models_truncated {
            Some(HARNESS_CATALOG_TRUNCATED.to_string())
        } else {
            None
        };

        let efforts = backend_effort_suggestions(trimmed_backend);
        let default_effort = "medium".to_string();

        Ok(AdvisorModelsResultDto {
            backend: trimmed_backend.to_string(),
            source: "harness".to_string(),
            models,
            efforts,
            default_effort,
            observed_at: current_time_ms(),
            issue_code,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fallback_catalog_all_backends() {
        for b in &["omp", "codex", "claude", "pi"] {
            let (models, efforts, default_effort) = fallback_catalog(b);
            assert!(!models.is_empty(), "fallback models should not be empty for {b}");
            assert!(!efforts.is_empty(), "fallback efforts should not be empty for {b}");
            assert_eq!(default_effort, "medium");
            for m in &models {
                assert!(!m.id.is_empty());
                assert!(!m.label.is_empty());
                assert!(!m.efforts.is_empty());
            }
        }
    }

    #[test]
    fn test_parse_omp_models_json() {
        let fixture = br#"{
            "models": [
                {
                    "provider": "openai",
                    "id": "gpt-6.1-sol",
                    "selector": "openai/gpt-6.1-sol",
                    "displayName": "GPT-6.1 Sol",
                    "thinking": ["low", "medium", "high", "xhigh"]
                },
                {
                    "provider": "anthropic",
                    "id": "claude-sonnet-5-5",
                    "thinking": ["low", "medium", "max"]
                }
            ]
        }"#;

        let models = parse_omp_models(fixture).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "openai/gpt-6.1-sol");
        assert_eq!(models[0].label, "GPT-6.1 Sol");
        assert_eq!(models[0].efforts, vec!["low", "medium", "high", "xhigh"]);

        assert_eq!(models[1].id, "anthropic/claude-sonnet-5-5");
        assert_eq!(models[1].label, "anthropic/claude-sonnet-5-5");
        assert_eq!(models[1].efforts, vec!["low", "medium", "max"]);
    }

    #[test]
    fn test_parse_omp_credential_rejection() {
        let fixture = br#"{
            "models": [
                {
                    "id": "model-1",
                    "api_key": "secret-token-value"
                }
            ]
        }"#;
        let err = parse_omp_models(fixture).unwrap_err();
        assert!(err.contains("Credential"));
    }

    #[test]
    fn test_parse_pi_models_table() {
        let fixture = b"Provider   Model                 Context   Max Out  Thinking\n\
                        openai     gpt-6.1-sol           128k      16k      off, low, medium, high, xhigh\n\
                        anthropic  claude-sonnet-5-5     200k      8k       low, medium, high, max\n";

        let models = parse_pi_models(fixture).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "openai/gpt-6.1-sol");
        assert_eq!(models[0].efforts, vec!["off", "low", "medium", "high", "xhigh"]);
        assert_eq!(models[1].id, "anthropic/claude-sonnet-5-5");
        assert_eq!(models[1].efforts, vec!["low", "medium", "high", "max"]);
    }

    #[test]
    fn test_parse_pi_no_login_empty() {
        let fixture = b"No models available. Use /login to log into a provider via OAuth or API key.\n";
        let models = parse_pi_models(fixture).unwrap();
        assert!(models.is_empty());
    }

    #[test]
    fn test_parse_codex_models_json() {
        let fixture = br#"{"id":2,"result":{"data":[{"model":"gpt-6.1-sol","displayName":"GPT-6.1 Sol","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"medium"},{"reasoningEffort":"high"}],"defaultReasoningEffort":"medium"},{"model":"hidden-model","isInternal":true}],"nextCursor":null}}"#;

        let models = parse_codex_models(fixture).unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-6.1-sol");
        assert_eq!(models[0].label, "GPT-6.1 Sol");
        assert_eq!(models[0].efforts, vec!["low", "medium", "high"]);
    }

    #[test]
    fn test_parse_claude_models_json() {
        let fixture = br#"{"type":"control_response","response":{"request_id":"advisor-models-init","subtype":"success","response":{"models":[{"value":"sonnet","displayName":"Claude Sonnet 3.7","supportedEffortLevels":["low","medium","high","max"]},{"value":"opus","displayName":"Claude Opus 4","supportedEffortLevels":["medium","high","max"]}]}}}"#;

        let models = parse_claude_models(fixture).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "sonnet");
        assert_eq!(models[0].label, "Claude Sonnet 3.7");
        assert_eq!(models[0].efforts, vec!["low", "medium", "high", "max"]);
        assert_eq!(models[1].id, "opus");
        assert_eq!(models[1].label, "Claude Opus 4");
        assert_eq!(models[1].efforts, vec!["medium", "high", "max"]);
    }

    #[test]
    fn test_normalize_and_filter() {
        let raw = vec![
            AdvisorModelOptionDto {
                id: "model-b".into(),
                label: "Model B".into(),
                efforts: vec!["low".into()],
            },
            AdvisorModelOptionDto {
                id: "model-a".into(),
                label: "Model A".into(),
                efforts: vec!["medium".into()],
            },
            AdvisorModelOptionDto {
                id: "model-b".into(), // Duplicate id
                label: "Model B Duplicate".into(),
                efforts: vec!["high".into()],
            },
            AdvisorModelOptionDto {
                id: "".into(), // Empty id
                label: "Empty".into(),
                efforts: vec![],
            },
            AdvisorModelOptionDto {
                id: "token_leak".into(), // Credential substring
                label: "Token".into(),
                efforts: vec![],
            },
        ];

        let (normalized, truncated) = normalize_and_filter_models(raw);
        assert!(!truncated);
        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0].id, "model-a");
        assert_eq!(normalized[1].id, "model-b");
    }

    #[tokio::test]
    async fn test_service_with_fake_runner_success() {
        let fake_runner = Arc::new(FakeHarnessCommandRunner::new());
        let service = HarnessModelService::with_runner(None, fake_runner.clone());

        // Setup OMP response
        let omp_fixture = br#"{"models":[{"id":"m1","provider":"p1","selector":"p1/m1","displayName":"M1","thinking":["medium"]}]}"#;
        fake_runner.set_result(
            AdvisorBackend::Omp,
            Ok(CommandOutput {
                stdout: omp_fixture.to_vec(),
                truncated: false,
            }),
        );

        let res = service.discover_models("omp").await.unwrap();
        assert_eq!(res.backend, "omp");
        assert_eq!(res.source, "harness");
        assert_eq!(res.models.len(), 1);
        assert_eq!(res.models[0].id, "p1/m1");
        assert_eq!(res.issue_code, None);
    }

    #[tokio::test]
    async fn test_service_with_fake_runner_fallbacks() {
        let fake_runner = Arc::new(FakeHarnessCommandRunner::new());
        let service = HarnessModelService::with_runner(None, fake_runner.clone());

        // 1. NotFound -> HARNESS_NOT_FOUND
        fake_runner.set_result(AdvisorBackend::Omp, Err(HarnessRunError::NotFound));
        let res = service.discover_models("omp").await.unwrap();
        assert_eq!(res.source, "fallback");
        assert_eq!(res.issue_code, Some(HARNESS_NOT_FOUND.to_string()));
        assert!(!res.models.is_empty());

        // 2. Timeout -> HARNESS_DISCOVERY_TIMEOUT
        fake_runner.set_result(AdvisorBackend::Codex, Err(HarnessRunError::Timeout));
        let res = service.discover_models("codex").await.unwrap();
        assert_eq!(res.source, "fallback");
        assert_eq!(res.issue_code, Some(HARNESS_DISCOVERY_TIMEOUT.to_string()));

        // 3. OutputLimit -> HARNESS_OUTPUT_LIMIT
        fake_runner.set_result(AdvisorBackend::Claude, Err(HarnessRunError::OutputLimit));
        let res = service.discover_models("claude").await.unwrap();
        assert_eq!(res.source, "fallback");
        assert_eq!(res.issue_code, Some(HARNESS_OUTPUT_LIMIT.to_string()));

        // 4. Invalid JSON -> HARNESS_OUTPUT_INVALID
        fake_runner.set_result(
            AdvisorBackend::Pi,
            Ok(CommandOutput {
                stdout: b"Invalid random garbage".to_vec(),
                truncated: false,
            }),
        );
        let res = service.discover_models("pi").await.unwrap();
        assert_eq!(res.source, "fallback");
        assert_eq!(res.issue_code, Some(HARNESS_CATALOG_EMPTY.to_string())); // No header recognized -> 0 models -> HARNESS_CATALOG_EMPTY

        // 5. Empty models list -> HARNESS_CATALOG_EMPTY
        fake_runner.set_result(
            AdvisorBackend::Omp,
            Ok(CommandOutput {
                stdout: b"{\"models\":[]}".to_vec(),
                truncated: false,
            }),
        );
        let res = service.discover_models("omp").await.unwrap();
        assert_eq!(res.source, "fallback");
        assert_eq!(res.issue_code, Some(HARNESS_CATALOG_EMPTY.to_string()));
    }

    #[tokio::test]
    async fn test_service_unknown_backend_rejected() {
        let service = HarnessModelService::new(None);
        let err = service.discover_models("unknown_harness").await.unwrap_err();
        match err {
            AdvisorError::InvalidInput(msg) => {
                assert!(msg.contains("Unknown advisor backend"));
            }
            _ => panic!("Expected InvalidInput error"),
        }
    }
}
