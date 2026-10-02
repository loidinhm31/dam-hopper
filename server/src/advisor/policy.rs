use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_POLICY_BYTES: u64 = 16 * 1024; // 16 KiB
pub const ENABLED_BACKENDS: &[&str] = &["claude", "codex", "pi", "omp"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRouteTargetDto {
    pub backend: String,
    pub model: String,
    pub effort: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyAdvisorDto {
    pub primary: PolicyRouteTargetDto,
    pub backup: PolicyRouteTargetDto,
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

fn check_credentials(val: &serde_json::Value) -> bool {
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

    let candidate = home_path.join(".evcrate").join("advisor-routing.json");
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

    if check_credentials(&parsed) {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("ROUTE_CREDENTIAL_FIELD".to_string()),
        };
    }

    if parsed.get("hosts").is_some() {
        return PolicyReadCurrentResultDto {
            status: "migration_required".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("ROUTE_SCHEMA_HOSTS_V1".to_string()),
        };
    }

    let version = parsed.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
    if version == 1 {
        return PolicyReadCurrentResultDto {
            status: "migration_required".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("V1_MIGRATION_REQUIRED".to_string()),
        };
    }

    if version != 2 {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("ROUTE_SCHEMA_INVALID".to_string()),
        };
    }

    // Inspect V2 schema
    let advisor = match parsed.get("advisor") {
        Some(a) if a.is_object() => a,
        _ => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision,
                policy: None,
                issue_code: Some("ROUTE_SCHEMA_INVALID".to_string()),
            };
        }
    };

    let parse_route = |v: Option<&serde_json::Value>| -> Result<PolicyRouteTargetDto, (String, String)> {
        let obj = v.ok_or_else(|| ("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string()))?;
        let backend = obj.get("backend").and_then(|s| s.as_str()).unwrap_or("");
        let model = obj.get("model").and_then(|s| s.as_str()).unwrap_or("");
        let effort = obj.get("effort").and_then(|s| s.as_str()).unwrap_or("");

        if backend.is_empty() || model.is_empty() || effort.is_empty() {
            return Err(("invalid".to_string(), "ROUTE_SCHEMA_INVALID".to_string()));
        }
        if !ENABLED_BACKENDS.contains(&backend) {
            return Err(("unsupported".to_string(), "ROUTE_ENTRY_INVALID".to_string()));
        }

        Ok(PolicyRouteTargetDto {
            backend: backend.to_string(),
            model: model.to_string(),
            effort: effort.to_string(),
        })
    };

    let primary = match parse_route(advisor.get("primary")) {
        Ok(p) => p,
        Err((st, code)) => {
            return PolicyReadCurrentResultDto {
                status: st,
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision,
                policy: None,
                issue_code: Some(code),
            };
        }
    };

    let backup = match parse_route(advisor.get("backup")) {
        Ok(b) => b,
        Err((st, code)) => {
            return PolicyReadCurrentResultDto {
                status: st,
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision,
                policy: None,
                issue_code: Some(code),
            };
        }
    };

    if primary.backend == backup.backend && primary.model == backup.model && primary.effort == backup.effort {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("ROUTE_BACKUP_IDENTICAL".to_string()),
        };
    }

    let wait_obj = match parsed.get("wait") {
        Some(w) if w.is_object() => w,
        _ => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision,
                policy: None,
                issue_code: Some("ROUTE_SCHEMA_INVALID".to_string()),
            };
        }
    };

    let wait_mode = wait_obj.get("mode").and_then(|s| s.as_str()).unwrap_or("");
    let warn_after_ms = wait_obj.get("warn_after_ms").and_then(|n| n.as_u64()).unwrap_or(0);
    let warn_every_ms = wait_obj.get("warn_every_ms").and_then(|n| n.as_u64()).unwrap_or(0);

    if wait_mode != "until_terminal"
        || !(1_000..=3_600_000).contains(&warn_after_ms)
        || !(1_000..=3_600_000).contains(&warn_every_ms)
    {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("ROUTE_SCHEMA_INVALID".to_string()),
        };
    }

    let history_obj = match parsed.get("history") {
        Some(h) if h.is_object() => h,
        _ => {
            return PolicyReadCurrentResultDto {
                status: "invalid".to_string(),
                scope: "account".to_string(),
                temporal: "current".to_string(),
                observed_at: now,
                revision,
                policy: None,
                issue_code: Some("ROUTE_SCHEMA_INVALID".to_string()),
            };
        }
    };

    let retention_days = history_obj.get("retention_days").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
    let max_bytes = history_obj.get("max_bytes").and_then(|n| n.as_u64()).unwrap_or(0);

    if !(1..=365).contains(&retention_days) || !(1_048_576..=1_073_741_824).contains(&max_bytes) {
        return PolicyReadCurrentResultDto {
            status: "invalid".to_string(),
            scope: "account".to_string(),
            temporal: "current".to_string(),
            observed_at: now,
            revision,
            policy: None,
            issue_code: Some("ROUTE_SCHEMA_INVALID".to_string()),
        };
    }

    let doc = PolicyDocumentV2Dto {
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
    };

    PolicyReadCurrentResultDto {
        status: "ready".to_string(),
        scope: "account".to_string(),
        temporal: "current".to_string(),
        observed_at: now,
        revision,
        policy: Some(doc),
        issue_code: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../__fixtures__/native-advisor")
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
}
