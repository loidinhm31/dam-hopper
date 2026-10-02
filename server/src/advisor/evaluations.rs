use std::collections::HashSet;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::advisor::error::AdvisorError;
use crate::advisor::evaluation_comparison::{
    aggregate_evaluation_groups, EvaluationComparisonGroupDto,
};

pub const MAX_EVALUATION_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB
pub const MAX_COMPARE_PAGE_BYTES: usize = 1024 * 1024; // 1 MiB

// ──────────────────────────────────────────────
// Evaluation DTOs
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationDescriptorDto {
    #[serde(alias = "evaluation_ref")]
    pub evaluation_ref: String,
    #[serde(alias = "source_revision")]
    pub source_revision: String,
    #[serde(alias = "source_digest")]
    pub source_digest: String,
    #[serde(alias = "evaluation_id")]
    pub evaluation_id: String,
    #[serde(alias = "run_id")]
    pub run_id: String,
    #[serde(alias = "created_at")]
    pub created_at: u64,
    #[serde(alias = "candidate_count")]
    pub candidate_count: usize,
    #[serde(alias = "case_count")]
    pub case_count: usize,
    #[serde(alias = "observation_count")]
    pub observation_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationsListParamsDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationsListResultDto {
    pub status: String, // "ready" | "not_configured"
    pub observed_at: u64,
    pub binding_revision: String,
    pub items: Vec<EvaluationDescriptorDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationsReadParamsDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(alias = "evaluation_ref")]
    pub evaluation_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "expected_revision")]
    pub expected_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationsReadResultDto {
    pub status: String, // "ready" | "changed" | "missing"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descriptor: Option<EvaluationDescriptorDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "evaluation_ref")]
    pub evaluation_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "observed_revision")]
    pub observed_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationCompareItemDto {
    #[serde(alias = "evaluation_ref")]
    pub evaluation_ref: String,
    #[serde(alias = "expected_revision")]
    pub expected_revision: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationsCompareParamsDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub items: Vec<EvaluationCompareItemDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationSourceRevisionDto {
    #[serde(alias = "evaluation_ref")]
    pub evaluation_ref: String,
    #[serde(alias = "observed_revision")]
    pub observed_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationsCompareResultDto {
    pub status: String, // "ready" | "changed" | "missing"
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_revisions: Vec<EvaluationSourceRevisionDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<EvaluationComparisonGroupDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returned_bytes: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "evaluation_ref")]
    pub evaluation_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "observed_revision")]
    pub observed_revision: Option<String>,
}

// ──────────────────────────────────────────────
// Discovery & Loading Helpers
// ──────────────────────────────────────────────

struct LoadedDoc {
    doc: serde_json::Value,
    digest: String,
}

fn load_eval_document(file_path: &Path) -> Option<LoadedDoc> {
    let meta = std::fs::symlink_metadata(file_path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_EVALUATION_BYTES {
        return None;
    }

    let bytes = std::fs::read(file_path).ok()?;
    if bytes.len() as u64 > MAX_EVALUATION_BYTES {
        return None;
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = format!("{:x}", hasher.finalize());

    let doc: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some(LoadedDoc { doc, digest })
}

fn make_descriptor(ref_name: &str, loaded: &LoadedDoc) -> EvaluationDescriptorDto {
    let candidate_count = loaded
        .doc
        .get("candidates")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    let cases = loaded.doc.get("cases").and_then(|v| v.as_array());
    let case_count = cases.map(|a| a.len()).unwrap_or(0);

    let observation_count = cases
        .map(|cases_arr| {
            cases_arr
                .iter()
                .map(|c| {
                    c.get("observations")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0)
                })
                .sum()
        })
        .unwrap_or(0);

    let evaluation_id = loaded
        .doc
        .get("evaluation_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let run_id = loaded
        .doc
        .get("run_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let created_at = loaded
        .doc
        .get("created_at")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    EvaluationDescriptorDto {
        evaluation_ref: ref_name.to_string(),
        source_revision: loaded.digest.clone(),
        source_digest: loaded.digest.clone(),
        evaluation_id,
        run_id,
        created_at,
        candidate_count,
        case_count,
        observation_count,
    }
}

pub struct DiscoveredDescriptor {
    pub descriptor: EvaluationDescriptorDto,
    pub path: PathBuf,
}

pub fn discover_evaluations(
    home_override: Option<&Path>,
    project_root: Option<&Path>,
) -> Vec<DiscoveredDescriptor> {
    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    let home_path = match home_override {
        Some(h) => Some(h.to_path_buf()),
        None => std::env::var("HOME").ok().filter(|s| !s.trim().is_empty()).map(PathBuf::from),
    };

    if let Some(home) = home_path {
        candidate_dirs.push(home.join(".evcrate").join("advisor-evaluations"));
        candidate_dirs.push(home.join(".evcrate").join("evaluations"));
    }

    if let Some(proj) = project_root {
        candidate_dirs.push(
            proj.join("tests")
                .join("fixtures")
                .join("advisor-evaluations"),
        );
    }

    let mut seen_dirs: HashSet<PathBuf> = HashSet::new();
    let mut seen_refs: HashSet<String> = HashSet::new();
    let mut descriptors: Vec<DiscoveredDescriptor> = Vec::new();

    for dir in candidate_dirs {
        let canonical = match dunce::canonicalize(&dir) {
            Ok(c) => c,
            Err(_) => dir.clone(),
        };

        if seen_dirs.contains(&canonical) {
            continue;
        }
        seen_dirs.insert(canonical);

        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let mut file_names: Vec<String> = Vec::new();
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.ends_with(".json")
                    && !name.contains("mismatch")
                    && !name.contains("invalid")
                {
                    file_names.push(name);
                }
            }
        }
        file_names.sort();

        for name in file_names {
            let ref_name = name.strip_suffix(".json").unwrap_or(&name);
            if seen_refs.contains(ref_name) {
                continue;
            }

            let file_path = dir.join(&name);
            if let Some(loaded) = load_eval_document(&file_path) {
                seen_refs.insert(ref_name.to_string());
                let desc = make_descriptor(ref_name, &loaded);
                descriptors.push(DiscoveredDescriptor {
                    descriptor: desc,
                    path: file_path,
                });
            }
        }
    }

    descriptors
}

// ──────────────────────────────────────────────
// Domain Operations: list, read, compare
// ──────────────────────────────────────────────

pub fn list_evaluations(
    home_override: Option<&Path>,
    project_root: Option<&Path>,
    params: EvaluationsListParamsDto,
) -> EvaluationsListResultDto {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let discovered = discover_evaluations(home_override, project_root);

    if discovered.is_empty() {
        return EvaluationsListResultDto {
            status: "not_configured".to_string(),
            observed_at: now,
            binding_revision: "1".to_string(),
            items: Vec::new(),
            next_cursor: None,
        };
    }

    let limit = params.limit.unwrap_or(32).clamp(1, 100);
    let offset = params
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0);

    let all_items: Vec<EvaluationDescriptorDto> =
        discovered.into_iter().map(|d| d.descriptor).collect();

    let slice_start = offset.min(all_items.len());
    let slice_end = (offset + limit).min(all_items.len());
    let paged = all_items[slice_start..slice_end].to_vec();

    let next_offset = offset + paged.len();
    let next_cursor = if next_offset < all_items.len() {
        Some(next_offset.to_string())
    } else {
        None
    };

    EvaluationsListResultDto {
        status: "ready".to_string(),
        observed_at: now,
        binding_revision: "1".to_string(),
        items: paged,
        next_cursor,
    }
}

pub fn read_evaluation(
    home_override: Option<&Path>,
    project_root: Option<&Path>,
    params: EvaluationsReadParamsDto,
) -> EvaluationsReadResultDto {
    let discovered = discover_evaluations(home_override, project_root);
    let item = discovered
        .into_iter()
        .find(|d| d.descriptor.evaluation_ref == params.evaluation_ref);

    let Some(discovered_item) = item else {
        return EvaluationsReadResultDto {
            status: "missing".to_string(),
            descriptor: None,
            document: None,
            evaluation_ref: Some(params.evaluation_ref),
            observed_revision: None,
        };
    };

    let loaded = match load_eval_document(&discovered_item.path) {
        Some(l) => l,
        None => {
            return EvaluationsReadResultDto {
                status: "missing".to_string(),
                descriptor: None,
                document: None,
                evaluation_ref: Some(params.evaluation_ref),
                observed_revision: None,
            };
        }
    };

    if let Some(expected) = &params.expected_revision {
        if &loaded.digest != expected {
            return EvaluationsReadResultDto {
                status: "changed".to_string(),
                descriptor: None,
                document: None,
                evaluation_ref: Some(params.evaluation_ref),
                observed_revision: Some(loaded.digest),
            };
        }
    }

    EvaluationsReadResultDto {
        status: "ready".to_string(),
        descriptor: Some(make_descriptor(&params.evaluation_ref, &loaded)),
        document: Some(loaded.doc),
        evaluation_ref: None,
        observed_revision: None,
    }
}

pub fn compare_evaluations(
    home_override: Option<&Path>,
    project_root: Option<&Path>,
    params: EvaluationsCompareParamsDto,
) -> Result<EvaluationsCompareResultDto, AdvisorError> {
    if params.items.is_empty() || params.items.len() > 32 {
        return Err(AdvisorError::InvalidInput(
            "items must contain between 1 and 32 entries".to_string(),
        ));
    }

    let discovered = discover_evaluations(home_override, project_root);

    let mut source_revisions: Vec<EvaluationSourceRevisionDto> = Vec::new();
    let mut documents: Vec<serde_json::Value> = Vec::new();

    for item in &params.items {
        let found = discovered
            .iter()
            .find(|d| d.descriptor.evaluation_ref == item.evaluation_ref);

        let Some(discovered_item) = found else {
            return Ok(EvaluationsCompareResultDto {
                status: "missing".to_string(),
                source_revisions: Vec::new(),
                groups: Vec::new(),
                next_cursor: None,
                returned_bytes: None,
                evaluation_ref: Some(item.evaluation_ref.clone()),
                observed_revision: None,
            });
        };

        let loaded = match load_eval_document(&discovered_item.path) {
            Some(l) => l,
            None => {
                return Ok(EvaluationsCompareResultDto {
                    status: "missing".to_string(),
                    source_revisions: Vec::new(),
                    groups: Vec::new(),
                    next_cursor: None,
                    returned_bytes: None,
                    evaluation_ref: Some(item.evaluation_ref.clone()),
                    observed_revision: None,
                });
            }
        };

        if loaded.digest != item.expected_revision {
            return Ok(EvaluationsCompareResultDto {
                status: "changed".to_string(),
                source_revisions: Vec::new(),
                groups: Vec::new(),
                next_cursor: None,
                returned_bytes: None,
                evaluation_ref: Some(item.evaluation_ref.clone()),
                observed_revision: Some(loaded.digest),
            });
        }

        source_revisions.push(EvaluationSourceRevisionDto {
            evaluation_ref: item.evaluation_ref.clone(),
            observed_revision: loaded.digest,
        });
        documents.push(loaded.doc);
    }

    let all_groups = aggregate_evaluation_groups(&documents);

    let limit = params.limit.unwrap_or(32).clamp(1, 100);
    let offset = params
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<usize>().ok())
        .unwrap_or(0);

    let slice_start = offset.min(all_groups.len());
    let slice_end = (offset + limit).min(all_groups.len());
    let mut paged: Vec<EvaluationComparisonGroupDto> = all_groups[slice_start..slice_end].to_vec();

    while !paged.is_empty() {
        let bytes_len = serde_json::to_vec(&paged).map(|b| b.len()).unwrap_or(0);
        if bytes_len <= MAX_COMPARE_PAGE_BYTES {
            break;
        }
        paged.pop();
    }

    let next_offset = offset + paged.len();
    let next_cursor = if next_offset < all_groups.len() {
        Some(next_offset.to_string())
    } else {
        None
    };

    let returned_bytes = serde_json::to_vec(&paged).map(|b| b.len()).unwrap_or(0);

    Ok(EvaluationsCompareResultDto {
        status: "ready".to_string(),
        source_revisions,
        groups: paged,
        next_cursor,
        returned_bytes: Some(returned_bytes),
        evaluation_ref: None,
        observed_revision: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_eval_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../__fixtures__/native-advisor/advisor-evaluations")
    }

    fn setup_eval_home() -> TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        let target = dot_evcrate.join("advisor-evaluations");
        std::fs::create_dir_all(&target).unwrap();

        let src = fixture_eval_dir();
        for entry in std::fs::read_dir(src).unwrap().flatten() {
            std::fs::copy(entry.path(), target.join(entry.file_name())).unwrap();
        }
        tmp
    }

    use tempfile::TempDir;

    #[test]
    fn test_list_evaluations_skips_invalid() {
        let tmp = setup_eval_home();
        let res = list_evaluations(Some(tmp.path()), None, EvaluationsListParamsDto::default());
        assert_eq!(res.status, "ready");
        assert_eq!(res.items.len(), 2);

        let a = res.items.iter().find(|i| i.evaluation_ref == "eval-group-a").expect("eval-group-a");
        assert_eq!(a.candidate_count, 2);
        assert_eq!(a.case_count, 2);
        assert_eq!(a.observation_count, 4);

        let b = res.items.iter().find(|i| i.evaluation_ref == "eval-group-b").expect("eval-group-b");
        assert_eq!(b.case_count, 9);
    }

    #[test]
    fn test_read_evaluation_lifecycle() {
        let tmp = setup_eval_home();
        let list_res = list_evaluations(Some(tmp.path()), None, EvaluationsListParamsDto::default());
        let item_a = list_res.items.iter().find(|i| i.evaluation_ref == "eval-group-a").unwrap();

        // 1. Read with correct revision
        let read_ok = read_evaluation(
            Some(tmp.path()),
            None,
            EvaluationsReadParamsDto {
                target: None,
                evaluation_ref: "eval-group-a".to_string(),
                expected_revision: Some(item_a.source_digest.clone()),
            },
        );
        assert_eq!(read_ok.status, "ready");
        assert_eq!(
            read_ok.document.as_ref().unwrap()["evaluation_id"],
            "eval-valid-mixed-001"
        );

        // 2. Read with wrong revision -> changed
        let read_changed = read_evaluation(
            Some(tmp.path()),
            None,
            EvaluationsReadParamsDto {
                target: None,
                evaluation_ref: "eval-group-a".to_string(),
                expected_revision: Some("0".repeat(64)),
            },
        );
        assert_eq!(read_changed.status, "changed");
        assert_eq!(read_changed.observed_revision, Some(item_a.source_digest.clone()));

        // 3. Read nonexistent ref -> missing
        let read_missing = read_evaluation(
            Some(tmp.path()),
            None,
            EvaluationsReadParamsDto {
                target: None,
                evaluation_ref: "eval-nonexistent".to_string(),
                expected_revision: Some("0".repeat(64)),
            },
        );
        assert_eq!(read_missing.status, "missing");
    }

    #[test]
    fn test_compare_evaluations_groups() {
        let tmp = setup_eval_home();
        let list_res = list_evaluations(Some(tmp.path()), None, EvaluationsListParamsDto::default());
        let item_a = list_res.items.iter().find(|i| i.evaluation_ref == "eval-group-a").unwrap();
        let item_b = list_res.items.iter().find(|i| i.evaluation_ref == "eval-group-b").unwrap();

        let compare_res = compare_evaluations(
            Some(tmp.path()),
            None,
            EvaluationsCompareParamsDto {
                target: None,
                items: vec![
                    EvaluationCompareItemDto {
                        evaluation_ref: "eval-group-a".to_string(),
                        expected_revision: item_a.source_digest.clone(),
                    },
                    EvaluationCompareItemDto {
                        evaluation_ref: "eval-group-b".to_string(),
                        expected_revision: item_b.source_digest.clone(),
                    },
                ],
                cursor: None,
                limit: Some(20),
            },
        )
        .unwrap();

        assert_eq!(compare_res.status, "ready");
        assert_eq!(compare_res.source_revisions.len(), 2);
        assert!(!compare_res.groups.is_empty());
        assert!(compare_res.returned_bytes.unwrap() > 0);
    }
}
