use crate::advisor::error::AdvisorError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const MAX_POLICY_BYTES: u64 = 16 * 1024; // 16 KiB
pub const ENABLED_BACKENDS: &[&str] = &["claude", "codex", "pi", "omp"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyRouteTargetDto {
    pub backend: String,
    pub model: String,
    pub effort: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyAdvisorDto {
    pub primary: PolicyRouteTargetDto,
    pub backup: PolicyRouteTargetDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PolicyUpdateParamsDto {
    pub expected_revision: String,
    pub advisor: PolicyAdvisorDto,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyWaitDto {
    pub mode: String,
    pub warn_after_ms: u64,
    pub warn_every_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyHistoryDto {
    pub retention_days: u32,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDocumentV2Dto {
    pub version: u32,
    pub advisor: PolicyAdvisorDto,
    pub wait: PolicyWaitDto,
    pub history: PolicyHistoryDto,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyReadCurrentResultDto {
    pub status: String,
    pub scope: String,
    pub temporal: String,
    pub observed_at: u64,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<PolicyDocumentV2Dto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_code: Option<String>,
}

pub fn check_credentials(val: &serde_json::Value) -> bool {
    match val {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                let lower = k.to_lowercase();
                if lower.contains("api_key")
                    || lower.contains("apikey")
                    || lower.contains("token")
                    || lower.contains("secret")
                    || lower.contains("password")
                    || lower.contains("passwd")
                    || lower.contains("authorization")
                    || lower.contains("cookie")
                    || lower.contains("credential")
                {
                    return true;
                }
                if check_credentials(v) {
                    return true;
                }
            }
            false
        }
        serde_json::Value::Array(arr) => arr.iter().any(check_credentials),
        _ => false,
    }
}

pub fn is_valid_revision(rev: &str) -> bool {
    rev.len() == 64
        && rev
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub fn is_valid_effort_for_backend(backend: &str, effort: &str) -> bool {
    match backend {
        "codex" => matches!(effort, "low" | "medium" | "high" | "xhigh"),
        "claude" => matches!(effort, "low" | "medium" | "high" | "xhigh" | "max"),
        "omp" | "pi" => matches!(
            effort,
            "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
        ),
        _ => false,
    }
}

pub fn validate_route_target(
    route: &PolicyRouteTargetDto,
) -> Result<(String, String, String), (&'static str, &'static str)> {
    let backend = route.backend.trim();
    let model = route.model.trim();
    let effort = route.effort.trim();

    if backend.is_empty() || model.is_empty() || effort.is_empty() {
        return Err(("invalid", "ROUTE_SCHEMA_INVALID"));
    }
    if !ENABLED_BACKENDS.contains(&backend) {
        return Err(("unsupported", "ROUTE_ENTRY_INVALID"));
    }
    if model.len() > 256 || model.chars().any(|c| c.is_control()) {
        return Err(("invalid", "ROUTE_ENTRY_INVALID"));
    }
    if effort.len() > 64 || effort.chars().any(|c| c.is_control()) {
        return Err(("invalid", "ROUTE_ENTRY_INVALID"));
    }
    if backend == "omp" || backend == "pi" {
        let parts: Vec<&str> = model.splitn(2, '/').collect();
        if parts.len() != 2 || parts[0].trim().is_empty() || parts[1].trim().is_empty() {
            return Err(("invalid", "ROUTE_ENTRY_INVALID"));
        }
    }
    if !is_valid_effort_for_backend(backend, effort) {
        return Err(("invalid", "ROUTE_ENTRY_INVALID"));
    }
    Ok((backend.to_string(), model.to_string(), effort.to_string()))
}

pub fn validate_policy_value(
    val: &serde_json::Value,
) -> Result<PolicyDocumentV2Dto, (String, String)> {
    if check_credentials(val) {
        return Err(("invalid".to_string(), "ROUTE_CREDENTIAL_FIELD".to_string()));
    }

    if val.get("hosts").is_some() {
        return Err((
            "migration_required".to_string(),
            "ROUTE_SCHEMA_HOSTS_V1".to_string(),
        ));
    }

    let version = val.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    if version == 1 {
        return Err((
            "migration_required".to_string(),
            "V1_MIGRATION_REQUIRED".to_string(),
        ));
    }

    if version != 2 {
        return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string()));
    }

    let advisor = match val.get("advisor") {
        Some(a) if a.is_object() => a,
        _ => return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string())),
    };

    let parse_route =
        |v: Option<&serde_json::Value>| -> Result<PolicyRouteTargetDto, (String, String)> {
            let obj =
                v.ok_or_else(|| ("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string()))?;
            let route = PolicyRouteTargetDto {
                backend: obj
                    .get("backend")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
                model: obj
                    .get("model")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
                effort: obj
                    .get("effort")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string(),
            };

            let (backend, model, effort) = validate_route_target(&route)
                .map_err(|(status, code)| (status.to_string(), code.to_string()))?;

            Ok(PolicyRouteTargetDto {
                backend,
                model,
                effort,
            })
        };

    let primary = parse_route(advisor.get("primary"))?;
    let backup = parse_route(advisor.get("backup"))?;

    if primary.backend == backup.backend
        && primary.model == backup.model
        && primary.effort == backup.effort
    {
        return Err(("invalid".to_string(), "ROUTE_BACKUP_IDENTICAL".to_string()));
    }

    let wait_obj = match val.get("wait") {
        Some(w) if w.is_object() => w,
        _ => return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string())),
    };

    let wait_mode = wait_obj.get("mode").and_then(|s| s.as_str()).unwrap_or("");
    let warn_after_ms = wait_obj
        .get("warn_after_ms")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    let warn_every_ms = wait_obj
        .get("warn_every_ms")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);

    if wait_mode != "until_terminal"
        || !(1_000..=3_600_000).contains(&warn_after_ms)
        || !(1_000..=3_600_000).contains(&warn_every_ms)
    {
        return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string()));
    }

    let history_obj = match val.get("history") {
        Some(h) if h.is_object() => h,
        _ => return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string())),
    };

    let retention_days = history_obj
        .get("retention_days")
        .and_then(|n| n.as_u64())
        .unwrap_or(0) as u32;
    let max_bytes = history_obj
        .get("max_bytes")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);

    if !(1..=365).contains(&retention_days) || !(1_048_576..=1_073_741_824).contains(&max_bytes) {
        return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string()));
    }

    Ok(PolicyDocumentV2Dto {
        version: 2,
        advisor: PolicyAdvisorDto { primary, backup },
        wait: PolicyWaitDto {
            mode: wait_mode.to_string(),
            warn_after_ms,
            warn_every_ms,
        },
        history: PolicyHistoryDto {
            retention_days,
            max_bytes,
        },
    })
}

pub fn read_current_policy(home_override: Option<&Path>) -> PolicyReadCurrentResultDto {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let home_path = match home_override {
        Some(h) => h.to_path_buf(),
        None => match std::env::var("HOME") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val),
            _ => {
                return PolicyReadCurrentResultDto {
                    status: "not_configured".to_string(),
                    scope: "account".to_string(),
                    temporal: "current".to_string(),
                    observed_at: now,
                    revision: "not_configured".to_string(),
                    policy: None,
                    issue_code: None,
                };
            }
        },
    };

    if !home_path.is_absolute() {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision: "unreadable".to_string(),
            policy: None,
            issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
        };
    }

    let home_meta = match std::fs::symlink_metadata(&home_path) {
        Ok(meta) => meta,
        Err(_) => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision: "unreadable".to_string(),
                policy: None,
                issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
            };
        }
    };
    if home_meta.file_type().is_symlink() || !home_meta.is_dir() {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision: "unreadable".to_string(),
            policy: None,
            issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
        };
    }

    let evcrate_dir = home_path.join(".evcrate");
    let evcrate_meta = match std::fs::symlink_metadata(&evcrate_dir) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return PolicyReadCurrentResultDto {
                status: "not_configured".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision: "missing".to_string(),
                policy: None,
                issue_code: Some("POLICY_FILE_MISSING".to_string()),
            };
        }
        Err(_) => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision: "unreadable".to_string(),
                policy: None,
                issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
            };
        }
    };

    if evcrate_meta.file_type().is_symlink() || !evcrate_meta.is_dir() {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision: "unreadable".to_string(),
            policy: None,
            issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
        };
    }

    let candidate = evcrate_dir.join("advisor-routing.json");
    let meta = match std::fs::symlink_metadata(&candidate) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return PolicyReadCurrentResultDto {
                status: "not_configured".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision: "missing".to_string(),
                policy: None,
                issue_code: Some("POLICY_FILE_MISSING".to_string()),
            };
        }
        Err(_) => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision: "unreadable".to_string(),
                policy: None,
                issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
            };
        }
    };

    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_POLICY_BYTES {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision: "unreadable".to_string(),
            policy: None,
            issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
        };
    }

    let bytes = match std::fs::read(&candidate) {
        Ok(b) if b.len() as u64 <= MAX_POLICY_BYTES => b,
        _ => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision: "unreadable".to_string(),
                policy: None,
                issue_code: Some("POLICY_FILE_UNSAFE".to_string()),
            };
        }
    };

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let revision = format!("{:x}", hasher.finalize());

    let parsed: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision,
                policy: None,
                issue_code: Some("INVALID_JSON".to_string()),
            };
        }
    };

    match validate_policy_value(&parsed) {
        Ok(doc) => PolicyReadCurrentResultDto {
            status: "ready".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: Some(doc),
            issue_code: None,
        },
        Err((status, issue_code)) => PolicyReadCurrentResultDto {
            status,
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some(issue_code),
        },
    }
}

pub fn update_current_policy(
    home_override: Option<&Path>,
    params: PolicyUpdateParamsDto,
) -> Result<PolicyReadCurrentResultDto, AdvisorError> {
    if !is_valid_revision(&params.expected_revision) {
        return Err(AdvisorError::PolicyValidation {
            code: "ROUTE_SCHEMA_INVALID".to_string(),
            message: "expectedRevision must be a 64-character lowercase hexadecimal string"
                .to_string(),
        });
    }

    let (pri_b, pri_m, pri_e) =
        validate_route_target(&params.advisor.primary).map_err(|(_, code)| {
            AdvisorError::PolicyValidation {
                code: code.to_string(),
                message: format!("Invalid primary route: {code}"),
            }
        })?;

    let (bak_b, bak_m, bak_e) =
        validate_route_target(&params.advisor.backup).map_err(|(_, code)| {
            AdvisorError::PolicyValidation {
                code: code.to_string(),
                message: format!("Invalid backup route: {code}"),
            }
        })?;

    if pri_b == bak_b && pri_m == bak_m && pri_e == bak_e {
        return Err(AdvisorError::PolicyValidation {
            code: "ROUTE_BACKUP_IDENTICAL".to_string(),
            message: "Primary and backup routes cannot be identical".to_string(),
        });
    }

    let home_path = match home_override {
        Some(h) => h.to_path_buf(),
        None => match std::env::var("HOME") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val),
            _ => {
                return Err(AdvisorError::PolicyNotEditable(
                    "HOME is not configured".to_string(),
                ));
            }
        },
    };

    if !home_path.is_absolute() {
        return Err(AdvisorError::PolicyFileUnsafe);
    }

    let home_meta = match std::fs::symlink_metadata(&home_path) {
        Ok(m) => m,
        Err(_) => return Err(AdvisorError::PolicyFileUnsafe),
    };
    if home_meta.file_type().is_symlink() || !home_meta.is_dir() {
        return Err(AdvisorError::PolicyFileUnsafe);
    }

    let evcrate_dir = home_path.join(".evcrate");
    let evcrate_meta = match std::fs::symlink_metadata(&evcrate_dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AdvisorError::PolicyNotEditable(
                "Policy file missing".to_string(),
            ));
        }
        Err(_) => return Err(AdvisorError::PolicyFileUnsafe),
    };
    if evcrate_meta.file_type().is_symlink() || !evcrate_meta.is_dir() {
        return Err(AdvisorError::PolicyFileUnsafe);
    }

    let policy_path = evcrate_dir.join("advisor-routing.json");
    let file_meta = match std::fs::symlink_metadata(&policy_path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AdvisorError::PolicyNotEditable(
                "Policy file missing".to_string(),
            ));
        }
        Err(_) => return Err(AdvisorError::PolicyFileUnsafe),
    };
    if file_meta.file_type().is_symlink()
        || !file_meta.is_file()
        || file_meta.len() > MAX_POLICY_BYTES
    {
        return Err(AdvisorError::PolicyFileUnsafe);
    }

    let current_bytes = crate::fs::secure_path::read_regular_file_bounded(
        &evcrate_dir,
        Path::new("advisor-routing.json"),
        MAX_POLICY_BYTES,
    )
    .map_err(|e| match e {
        crate::fs::FsError::NotFound => {
            AdvisorError::PolicyNotEditable("Policy file missing".to_string())
        }
        _ => AdvisorError::PolicyFileUnsafe,
    })?;

    let mut hasher = Sha256::new();
    hasher.update(&current_bytes);
    let current_revision = format!("{:x}", hasher.finalize());

    if current_revision != params.expected_revision {
        return Err(AdvisorError::PolicyRevisionConflict);
    }

    let mut current_json: serde_json::Value =
        serde_json::from_slice(&current_bytes).map_err(|_| {
            AdvisorError::PolicyNotEditable("Policy file contains invalid JSON".to_string())
        })?;

    match validate_policy_value(&current_json) {
        Ok(_) => {}
        Err((_, code)) => {
            return Err(AdvisorError::PolicyNotEditable(format!(
                "Policy status is not ready: {code}"
            )));
        }
    }

    let advisor_obj = match current_json
        .get_mut("advisor")
        .and_then(|v| v.as_object_mut())
    {
        Some(obj) => obj,
        None => {
            return Err(AdvisorError::PolicyNotEditable(
                "Missing advisor object".to_string(),
            ));
        }
    };

    advisor_obj.insert(
        "primary".to_string(),
        serde_json::json!({
            "backend": pri_b,
            "model": pri_m,
            "effort": pri_e,
        }),
    );
    advisor_obj.insert(
        "backup".to_string(),
        serde_json::json!({
            "backend": bak_b,
            "model": bak_m,
            "effort": bak_e,
        }),
    );

    let new_doc = validate_policy_value(&current_json).map_err(|(_, code)| {
        AdvisorError::PolicyValidation {
            code,
            message: "Mutated policy failed validation".to_string(),
        }
    })?;

    let mut new_bytes =
        serde_json::to_vec_pretty(&current_json).map_err(|_| AdvisorError::PolicyWriteFailed)?;
    new_bytes.push(b'\n');

    if new_bytes.len() as u64 > MAX_POLICY_BYTES {
        return Err(AdvisorError::PolicyWriteFailed);
    }

    crate::fs::secure_path::replace_regular_file_if_bytes_match(
        &evcrate_dir,
        Path::new("advisor-routing.json"),
        &current_bytes,
        &new_bytes,
        true,
    )
    .map_err(|e| match e {
        crate::fs::FsError::Conflict => AdvisorError::PolicyRevisionConflict,
        _ => AdvisorError::PolicyWriteFailed,
    })?;

    let mut new_hasher = Sha256::new();
    new_hasher.update(&new_bytes);
    let new_revision = format!("{:x}", new_hasher.finalize());

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(PolicyReadCurrentResultDto {
        status: "ready".to_string(),
        scope: "account".to_string(),
        temporal: "current".to_string(),
        observed_at: now,
        revision: new_revision,
        policy: Some(new_doc),
        issue_code: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../__fixtures__/native-advisor")
    }

    #[test]
    fn test_policy_v2_ready() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let res = read_current_policy(Some(tmp.path()));
        assert_eq!(res.status, "ready");
        assert_eq!(res.scope, "account");
        assert_eq!(res.temporal, "current");
        assert_eq!(res.revision.len(), 64);
        assert_eq!(res.issue_code, None);
        let pol = res.policy.expect("policy is present");
        assert_eq!(pol.version, 2);
        assert_eq!(pol.advisor.primary.backend, "codex");
        assert_eq!(pol.advisor.backup.backend, "omp");
    }

    #[test]
    fn test_policy_v1_migration_required() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing-v1.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let res = read_current_policy(Some(tmp.path()));
        assert_eq!(res.status, "migration_required");
        assert_eq!(res.issue_code, Some("V1_MIGRATION_REQUIRED".to_string()));
        assert!(res.policy.is_none());
    }

    #[test]
    fn test_policy_invalid_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing-invalid.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let res = read_current_policy(Some(tmp.path()));
        assert!(res.status == "invalid" || res.status == "unsupported");
        assert!(res.issue_code.is_some());
    }

    #[test]
    fn test_policy_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let res = read_current_policy(Some(tmp.path()));
        assert_eq!(res.status, "not_configured");
        assert_eq!(res.issue_code, Some("POLICY_FILE_MISSING".to_string()));
    }

    #[test]
    fn test_policy_credential_rejection() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::write(
            dot_evcrate.join("advisor-routing.json"),
            r#"{"version":2,"advisor":{"primary":{"backend":"codex","model":"gpt","effort":"high"},"backup":{"backend":"omp","model":"gpt","effort":"low"}},"apiKey":"secret"}"#,
        )
        .unwrap();

        let res = read_current_policy(Some(tmp.path()));
        assert_eq!(res.status, "invalid");
        assert_eq!(res.issue_code, Some("ROUTE_CREDENTIAL_FIELD".to_string()));
    }

    #[test]
    fn test_policy_existing_route_uses_update_validation_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        let invalid = r#"{
  "version": 2,
  "advisor": {
    "primary": { "backend": "codex", "model": "gpt", "effort": "max" },
    "backup": { "backend": "omp", "model": "missing-provider-prefix", "effort": "low" }
  },
  "wait": { "mode": "until_terminal", "warn_after_ms": 10000, "warn_every_ms": 5000 },
  "history": { "retention_days": 30, "max_bytes": 10485760 }
}"#;
        std::fs::write(dot_evcrate.join("advisor-routing.json"), invalid).unwrap();

        let res = read_current_policy(Some(tmp.path()));
        assert_eq!(res.status, "invalid");
        assert_eq!(res.issue_code, Some("ROUTE_ENTRY_INVALID".to_string()));
        assert!(res.policy.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn test_policy_read_rejects_symlinked_evcrate_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            outside.join("advisor-routing.json"),
        )
        .unwrap();
        std::os::unix::fs::symlink(&outside, tmp.path().join(".evcrate")).unwrap();

        let res = read_current_policy(Some(tmp.path()));
        assert_eq!(res.status, "invalid");
        assert_eq!(res.issue_code, Some("POLICY_FILE_UNSAFE".to_string()));
        assert!(res.policy.is_none());
    }

    #[test]
    fn test_update_policy_success_and_preservation() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        let initial_json = r#"{
  "version": 2,
  "advisor": {
    "primary": { "backend": "codex", "model": "gpt-orig", "effort": "medium" },
    "backup": { "backend": "omp", "model": "openai/gpt-backup", "effort": "low" }
  },
  "wait": {
    "mode": "until_terminal",
    "warn_after_ms": 10000,
    "warn_every_ms": 5000
  },
  "history": {
    "retention_days": 30,
    "max_bytes": 10485760
  },
  "custom_meta": { "preserved": true }
}
"#;
        std::fs::write(dot_evcrate.join("advisor-routing.json"), initial_json).unwrap();

        let initial = read_current_policy(Some(tmp.path()));
        assert_eq!(initial.status, "ready");
        let old_rev = initial.revision;

        let params = PolicyUpdateParamsDto {
            expected_revision: old_rev.clone(),
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "custom-codex-v2".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "openai/custom-omp-v2".to_string(),
                    effort: "medium".to_string(),
                },
            },
        };

        let updated = update_current_policy(Some(tmp.path()), params).unwrap();
        assert_eq!(updated.status, "ready");
        assert_ne!(updated.revision, old_rev);
        let pol = updated.policy.unwrap();
        assert_eq!(pol.advisor.primary.model, "custom-codex-v2");
        assert_eq!(pol.advisor.primary.effort, "high");
        assert_eq!(pol.advisor.backup.model, "openai/custom-omp-v2");
        assert_eq!(pol.advisor.backup.effort, "medium");

        // Verify file on disk preserved custom_meta and wait/history keys
        let disk_bytes = std::fs::read(dot_evcrate.join("advisor-routing.json")).unwrap();
        let disk_val: serde_json::Value = serde_json::from_slice(&disk_bytes).unwrap();
        assert_eq!(disk_val["custom_meta"]["preserved"], true);
        assert_eq!(disk_val["wait"]["warn_after_ms"], 10000);
        assert_eq!(disk_val["history"]["retention_days"], 30);
    }

    #[test]
    fn test_update_policy_identical_routes_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let initial = read_current_policy(Some(tmp.path()));
        let old_rev = initial.revision;

        let params = PolicyUpdateParamsDto {
            expected_revision: old_rev,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "same-model".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "same-model".to_string(),
                    effort: "high".to_string(),
                },
            },
        };

        let err = update_current_policy(Some(tmp.path()), params).unwrap_err();
        match err {
            AdvisorError::PolicyValidation { code, .. } => {
                assert_eq!(code, "ROUTE_BACKUP_IDENTICAL");
            }
            other => panic!("Expected PolicyValidation, got {:?}", other),
        }
    }

    #[test]
    fn test_update_policy_same_model_diff_effort_succeeds() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let initial = read_current_policy(Some(tmp.path()));
        let old_rev = initial.revision;

        let params = PolicyUpdateParamsDto {
            expected_revision: old_rev,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "same-model".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "same-model".to_string(),
                    effort: "low".to_string(),
                },
            },
        };

        let res = update_current_policy(Some(tmp.path()), params).unwrap();
        assert_eq!(res.status, "ready");
    }

    #[test]
    fn test_update_policy_revision_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let stale_rev =
            "0000000000000000000000000000000000000000000000000000000000000000".to_string();
        let params = PolicyUpdateParamsDto {
            expected_revision: stale_rev,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "m1".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "openai/m2".to_string(),
                    effort: "low".to_string(),
                },
            },
        };

        let err = update_current_policy(Some(tmp.path()), params).unwrap_err();
        match err {
            AdvisorError::PolicyRevisionConflict => {}
            other => panic!("Expected PolicyRevisionConflict, got {:?}", other),
        }
    }

    #[test]
    fn test_update_policy_invalid_effort_or_backend() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let initial = read_current_policy(Some(tmp.path()));
        let rev = initial.revision;

        // 1. Invalid backend
        let params_bad_backend = PolicyUpdateParamsDto {
            expected_revision: rev.clone(),
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "unknown_backend".to_string(),
                    model: "m1".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "openai/m2".to_string(),
                    effort: "low".to_string(),
                },
            },
        };
        let err = update_current_policy(Some(tmp.path()), params_bad_backend).unwrap_err();
        match err {
            AdvisorError::PolicyValidation { code, .. } => assert_eq!(code, "ROUTE_ENTRY_INVALID"),
            other => panic!("Expected PolicyValidation, got {:?}", other),
        }

        // 2. Invalid effort for codex (e.g. "max" is claude/omp/pi, not codex)
        let params_bad_effort = PolicyUpdateParamsDto {
            expected_revision: rev.clone(),
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "m1".to_string(),
                    effort: "max".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "openai/m2".to_string(),
                    effort: "low".to_string(),
                },
            },
        };
        let err = update_current_policy(Some(tmp.path()), params_bad_effort).unwrap_err();
        match err {
            AdvisorError::PolicyValidation { code, .. } => assert_eq!(code, "ROUTE_ENTRY_INVALID"),
            other => panic!("Expected PolicyValidation, got {:?}", other),
        }

        // 3. OMP missing provider prefix
        let params_missing_provider = PolicyUpdateParamsDto {
            expected_revision: rev,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "m1".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "bare-model-no-provider".to_string(),
                    effort: "low".to_string(),
                },
            },
        };
        let err = update_current_policy(Some(tmp.path()), params_missing_provider).unwrap_err();
        match err {
            AdvisorError::PolicyValidation { code, .. } => assert_eq!(code, "ROUTE_ENTRY_INVALID"),
            other => panic!("Expected PolicyValidation, got {:?}", other),
        }
    }

    #[test]
    fn test_update_policy_non_ready_policy_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing-v1.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let initial = read_current_policy(Some(tmp.path()));
        assert_eq!(initial.status, "migration_required");

        let params = PolicyUpdateParamsDto {
            expected_revision: initial.revision,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "m1".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "openai/m2".to_string(),
                    effort: "low".to_string(),
                },
            },
        };

        let err = update_current_policy(Some(tmp.path()), params).unwrap_err();
        match err {
            AdvisorError::PolicyNotEditable(_) => {}
            other => panic!("Expected PolicyNotEditable, got {:?}", other),
        }
    }

    #[test]
    fn test_update_policy_byte_size_boundary() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();

        // File on disk > 16 KiB (16384 bytes)
        let huge_padding = "a".repeat(16385);
        let huge_json = format!(
            r#"{{"version":2,"advisor":{{"primary":{{"backend":"codex","model":"gpt","effort":"high"}},"backup":{{"backend":"omp","model":"gpt","effort":"low"}}}},"padding":"{}"}}"#,
            huge_padding
        );
        std::fs::write(dot_evcrate.join("advisor-routing.json"), huge_json).unwrap();

        let read_res = read_current_policy(Some(tmp.path()));
        assert_eq!(read_res.status, "invalid");
        assert_eq!(read_res.issue_code, Some("POLICY_FILE_UNSAFE".to_string()));

        let valid_rev = "a".repeat(64);
        let params = PolicyUpdateParamsDto {
            expected_revision: valid_rev,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "codex".to_string(),
                    model: "m1".to_string(),
                    effort: "high".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "omp".to_string(),
                    model: "openai/m2".to_string(),
                    effort: "low".to_string(),
                },
            },
        };
        let update_err = update_current_policy(Some(tmp.path()), params).unwrap_err();
        assert!(matches!(update_err, AdvisorError::PolicyFileUnsafe));
    }

    #[test]
    fn test_update_policy_credential_recursion() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();

        // Nested secret in array inside custom meta
        let credential_json = r#"{
            "version": 2,
            "advisor": {
                "primary": { "backend": "codex", "model": "gpt", "effort": "high" },
                "backup": { "backend": "omp", "model": "gpt", "effort": "low" }
            },
            "metadata": [
                { "nested": { "auth_token": "secret-token-123" } }
            ]
        }"#;
        std::fs::write(dot_evcrate.join("advisor-routing.json"), credential_json).unwrap();

        let read_res = read_current_policy(Some(tmp.path()));
        assert_eq!(read_res.status, "invalid");
        assert_eq!(
            read_res.issue_code,
            Some("ROUTE_CREDENTIAL_FIELD".to_string())
        );
    }

    #[test]
    fn test_update_policy_symlink_and_non_regular_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();

        // Symlink policy file
        let real_file = outside.join("real.json");
        std::fs::copy(fixture_root().join("advisor-routing.json"), &real_file).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&real_file, dot_evcrate.join("advisor-routing.json"))
                .unwrap();

            let initial = read_current_policy(Some(tmp.path()));
            assert_eq!(initial.status, "invalid");
            assert_eq!(initial.issue_code, Some("POLICY_FILE_UNSAFE".to_string()));

            let valid_rev = "b".repeat(64);
            let params = PolicyUpdateParamsDto {
                expected_revision: valid_rev,
                advisor: PolicyAdvisorDto {
                    primary: PolicyRouteTargetDto {
                        backend: "codex".to_string(),
                        model: "m1".to_string(),
                        effort: "high".to_string(),
                    },
                    backup: PolicyRouteTargetDto {
                        backend: "omp".to_string(),
                        model: "openai/m2".to_string(),
                        effort: "low".to_string(),
                    },
                },
            };
            let err = update_current_policy(Some(tmp.path()), params).unwrap_err();
            assert!(matches!(err, AdvisorError::PolicyFileUnsafe));
        }

        // Directory target
        let tmp2 = tempfile::tempdir().unwrap();
        let dot_evcrate2 = tmp2.path().join(".evcrate");
        std::fs::create_dir_all(dot_evcrate2.join("advisor-routing.json")).unwrap();
        let initial2 = read_current_policy(Some(tmp2.path()));
        assert_eq!(initial2.status, "invalid");
    }

    #[test]
    fn test_update_policy_temp_cleanup() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        std::fs::copy(
            fixture_root().join("advisor-routing.json"),
            dot_evcrate.join("advisor-routing.json"),
        )
        .unwrap();

        let initial = read_current_policy(Some(tmp.path()));
        let rev = initial.revision;

        let params = PolicyUpdateParamsDto {
            expected_revision: rev,
            advisor: PolicyAdvisorDto {
                primary: PolicyRouteTargetDto {
                    backend: "claude".to_string(),
                    model: "sonnet".to_string(),
                    effort: "medium".to_string(),
                },
                backup: PolicyRouteTargetDto {
                    backend: "pi".to_string(),
                    model: "openai/gpt-6.1-sol".to_string(),
                    effort: "low".to_string(),
                },
            },
        };

        let res = update_current_policy(Some(tmp.path()), params).unwrap();
        assert_eq!(res.status, "ready");

        // Ensure no .dam-hopper-* temp files exist in .evcrate
        for entry in std::fs::read_dir(&dot_evcrate).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(
                !name.starts_with(".dam-hopper-"),
                "found leftover temp file: {name}"
            );
        }
    }
}
