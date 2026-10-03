use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use sha2::{Digest, Sha256};
use crate::advisor::types::*;

pub const MAX_SCAN_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_SCAN_RECORDS: usize = 50_000;
pub const MAX_SCAN_PROJECTS: usize = 500;
pub const MAX_TASKS_PER_PROJECT: usize = 256;
pub const MAX_CONSULTATIONS_PER_TASK: usize = 256;
pub const MAX_EXECUTION_HISTORY_BYTES: u64 = 128 * 1024;
pub const MAX_OUTCOME_HISTORY_BYTES: u64 = 64 * 1024;
pub const MAX_METADATA_BYTES: u64 = 64 * 1024;
pub const MAX_DIAGNOSTICS: usize = 4096;

pub struct BoundedFileRead {
    pub bytes: Vec<u8>,
    pub size: u64,
    pub hash: String,
    pub dev: u64,
    pub ino: u64,
}

pub fn read_bounded_file(path: &Path, max_bytes: u64) -> Option<BoundedFileRead> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > max_bytes {
        return None;
    }

    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    #[cfg(unix)]
    let (dev, ino) = (meta.dev(), meta.ino());
    #[cfg(not(unix))]
    let (dev, ino) = (0, 0);

    let file = File::open(path).ok()?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(max_bytes + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > max_bytes {
        return None;
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());

    Some(BoundedFileRead {
        size: bytes.len() as u64,
        bytes,
        hash,
        dev,
        ino,
    })
}

pub fn is_valid_sha256(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn is_valid_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    parts[0].len() == 8
        && parts[0].chars().all(|c| c.is_ascii_hexdigit())
        && parts[1].len() == 4
        && parts[1].chars().all(|c| c.is_ascii_hexdigit())
        && parts[2].len() == 4
        && parts[2].chars().all(|c| c.is_ascii_hexdigit())
        && parts[3].len() == 4
        && parts[3].chars().all(|c| c.is_ascii_hexdigit())
        && parts[4].len() == 12
        && parts[4].chars().all(|c| c.is_ascii_hexdigit())
}

fn sanitize_project_label(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return None;
    }
    // Remove control characters
    let cleaned: String = trimmed.chars().filter(|c| !c.is_control()).collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

pub fn read_safe_project_label(metadata_path: &Path, project_id: &str) -> Option<String> {
    let read_result = read_bounded_file(metadata_path, MAX_METADATA_BYTES)?;
    let parsed: serde_json::Value = serde_json::from_slice(&read_result.bytes).ok()?;
    if parsed.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return None;
    }
    let projects = parsed.get("projects")?.as_object()?;
    let entry = projects.get(&project_id.to_lowercase())?;
    let name = entry.get("name")?.as_str()?;
    sanitize_project_label(name)
}

pub fn find_project_id_by_label(metadata_path: &Path, label: &str) -> Option<String> {
    let read_result = read_bounded_file(metadata_path, MAX_METADATA_BYTES)?;
    let parsed: serde_json::Value = serde_json::from_slice(&read_result.bytes).ok()?;
    if parsed.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return None;
    }
    let projects = parsed.get("projects")?.as_object()?;
    for (pid, entry) in projects {
        if is_valid_sha256(pid) {
            if let Some(name) = entry.get("name").and_then(|n| n.as_str()) {
                if let Some(clean) = sanitize_project_label(name) {
                    if clean.eq_ignore_ascii_case(label) {
                        return Some(pid.to_lowercase());
                    }
                }
            }
        }
    }
    None
}

fn record_diag(
    scan: &mut HistoryScanSummaryDto,
    code: &str,
    task_id: Option<&str>,
    consult_id: Option<&str>,
) {
    scan.invalid_records += 1;
    if scan.diagnostics.len() < MAX_DIAGNOSTICS {
        scan.diagnostics.push(HistoryDiagnosticDto {
            code: code.to_string(),
            task_run_id: task_id.map(str::to_string),
            consultation_id: consult_id.map(str::to_string),
        });
    } else {
        scan.suppressed_diagnostics += 1;
    }
}

pub struct ScanOutput {
    pub scan: HistoryScanSummaryDto,
    pub rows: Vec<HistoryRowDto>,
    pub raw_records: HashMap<String, RawRecordCaptured>,
    pub normalized_records: Vec<NormalizedHistoryRecord>,
    pub inventory: ProjectInventoryDto,
}
pub fn scan_history_records(
    history_root: &Path,
    target_project_id: Option<&str>,
) -> ScanOutput {
    let mut scan = HistoryScanSummaryDto {
        status: "complete".to_string(),
        projects_discovered: 0,
        tasks_discovered: 0,
        consultations_discovered: 0,
        accepted_records: 0,
        invalid_records: 0,
        bytes_discovered: 0,
        bytes_read: 0,
        diagnostics: Vec::new(),
        suppressed_diagnostics: 0,
        limit_hit: false,
    };

    let mut rows = Vec::new();
    let mut raw_records = HashMap::new();
    let mut normalized_records = Vec::new();
    let mut project_counts: HashMap<String, usize> = HashMap::new();
    let mut project_labels: HashMap<String, Option<String>> = HashMap::new();

    let root_meta = match std::fs::symlink_metadata(history_root) {
        Ok(m) if !m.file_type().is_symlink() && m.is_dir() => m,
        _ => {
            return ScanOutput {
                scan,
                rows,
                raw_records,
                normalized_records,
                inventory: ProjectInventoryDto {
                    entries: Vec::new(),
                    total_projects: 0,
                    unfiltered_total_records: 0,
                },
            };
        }
    };
    let _ = root_meta;

    let mut eligible_project_ids = Vec::new();
    if let Some(target) = target_project_id {
        let lower = target.to_lowercase();
        if is_valid_sha256(&lower) {
            eligible_project_ids.push(lower);
        } else {
            let root_meta_path = history_root.join("project-metadata.json");
            if let Some(matched) = find_project_id_by_label(&root_meta_path, target) {
                eligible_project_ids.push(matched);
            } else {
                if let Ok(entries) = std::fs::read_dir(history_root) {
                    for entry in entries.flatten() {
                        if let Ok(name) = entry.file_name().into_string() {
                            let candidate_pid = name.to_lowercase();
                            if is_valid_sha256(&candidate_pid) {
                                let sub_meta = history_root.join(&candidate_pid).join("project-metadata.json");
                                if let Some(label) = read_safe_project_label(&sub_meta, &candidate_pid) {
                                    if label.eq_ignore_ascii_case(target) {
                                        eligible_project_ids.push(candidate_pid);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if eligible_project_ids.is_empty() {
                return ScanOutput {
                    scan,
                    rows,
                    raw_records,
                    normalized_records,
                    inventory: ProjectInventoryDto {
                        entries: Vec::new(),
                        total_projects: 0,
                        unfiltered_total_records: 0,
                    },
                };
            }
        }
    } else {
        if let Ok(entries) = std::fs::read_dir(history_root) {
            for entry in entries.flatten() {
                if let Ok(name) = entry.file_name().into_string() {
                    let lower = name.to_lowercase();
                    if is_valid_sha256(&lower) {
                        eligible_project_ids.push(lower);
                    }
                }
            }
        }
        eligible_project_ids.sort();
        if eligible_project_ids.len() > MAX_SCAN_PROJECTS {
            scan.limit_hit = true;
            scan.status = "incomplete".to_string();
            eligible_project_ids.truncate(MAX_SCAN_PROJECTS);
        }
    }

    let root_meta_path = history_root.join("project-metadata.json");

    'project_loop: for proj_id in &eligible_project_ids {
        let proj_dir = history_root.join(proj_id);
        let p_meta = match std::fs::symlink_metadata(&proj_dir) {
            Ok(m) if !m.file_type().is_symlink() && m.is_dir() => m,
            _ => continue,
        };
        let _ = p_meta;

        scan.projects_discovered += 1;
        project_counts.insert(proj_id.clone(), 0);

        let proj_meta_path = proj_dir.join("project-metadata.json");
        let label = read_safe_project_label(&proj_meta_path, proj_id)
            .or_else(|| read_safe_project_label(&root_meta_path, proj_id));
        project_labels.insert(proj_id.clone(), label);

        let mut eligible_tasks = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&proj_dir) {
            for entry in entries.flatten() {
                if let Ok(name) = entry.file_name().into_string() {
                    if is_valid_uuid(&name) {
                        eligible_tasks.push(name);
                    }
                }
            }
        }
        eligible_tasks.sort();
        if eligible_tasks.len() > MAX_TASKS_PER_PROJECT {
            scan.limit_hit = true;
            scan.status = "incomplete".to_string();
            eligible_tasks.truncate(MAX_TASKS_PER_PROJECT);
        }

        for t_name in eligible_tasks {
            let t_path = proj_dir.join(&t_name);
            let t_meta = match std::fs::symlink_metadata(&t_path) {
                Ok(m) if !m.file_type().is_symlink() && m.is_dir() => m,
                _ => continue,
            };
            let _ = t_meta;

            scan.tasks_discovered += 1;
            let mut eligible_consultations = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&t_path) {
                for entry in entries.flatten() {
                    if let Ok(name) = entry.file_name().into_string() {
                        if is_valid_uuid(&name) {
                            eligible_consultations.push(name);
                        }
                    }
                }
            }
            eligible_consultations.sort();
            if eligible_consultations.len() > MAX_CONSULTATIONS_PER_TASK {
                scan.limit_hit = true;
                scan.status = "incomplete".to_string();
                eligible_consultations.truncate(MAX_CONSULTATIONS_PER_TASK);
            }

            for c_name in eligible_consultations {
                let c_path = t_path.join(&c_name);
                let c_meta = match std::fs::symlink_metadata(&c_path) {
                    Ok(m) if !m.file_type().is_symlink() && m.is_dir() => m,
                    _ => continue,
                };
                let _ = c_meta;

                scan.consultations_discovered += 1;
                let exec_path = c_path.join("execution.json");
                let out_path = c_path.join("outcome.json");

                let exec_read = match read_bounded_file(&exec_path, MAX_EXECUTION_HISTORY_BYTES) {
                    Some(r) => r,
                    None => {
                        record_diag(&mut scan, "EXECUTION_UNREADABLE", Some(&t_name), Some(&c_name));
                        continue;
                    }
                };

                scan.bytes_read += exec_read.size;
                scan.bytes_discovered += exec_read.size;

                let exec_data: serde_json::Value = match serde_json::from_slice(&exec_read.bytes) {
                    Ok(v) => v,
                    Err(_) => {
                        record_diag(&mut scan, "EXECUTION_INVALID_JSON", Some(&t_name), Some(&c_name));
                        continue;
                    }
                };

                let exec_proj_id = exec_data.get("project_id").and_then(|v| v.as_str()).unwrap_or("");
                let exec_task_id = exec_data.get("task_run_id").and_then(|v| v.as_str()).unwrap_or("");
                let exec_consult_id = exec_data.get("consultation_id").and_then(|v| v.as_str()).unwrap_or("");

                if !exec_proj_id.eq_ignore_ascii_case(proj_id)
                    || !exec_task_id.eq_ignore_ascii_case(&t_name)
                    || !exec_consult_id.eq_ignore_ascii_case(&c_name)
                {
                    record_diag(&mut scan, "EXECUTION_ID_MISMATCH", Some(&t_name), Some(&c_name));
                    continue;
                }

                let mut out_read: Option<BoundedFileRead> = None;
                let mut out_data: Option<serde_json::Value> = None;
                let mut out_invalid = false;

                if let Ok(out_meta) = std::fs::symlink_metadata(&out_path) {
                    scan.bytes_discovered += out_meta.len();
                    if let Some(r) = read_bounded_file(&out_path, MAX_OUTCOME_HISTORY_BYTES) {
                        scan.bytes_read += r.size;
                        match serde_json::from_slice::<serde_json::Value>(&r.bytes) {
                            Ok(v) => {
                                let out_proj_id = v.get("project_id").and_then(|p| p.as_str()).unwrap_or("");
                                let out_task_id = v.get("task_run_id").and_then(|p| p.as_str()).unwrap_or("");
                                let out_consult_id = v.get("consultation_id").and_then(|p| p.as_str()).unwrap_or("");

                                if !out_proj_id.eq_ignore_ascii_case(proj_id)
                                    || !out_task_id.eq_ignore_ascii_case(&t_name)
                                    || !out_consult_id.eq_ignore_ascii_case(&c_name)
                                {
                                    record_diag(&mut scan, "OUTCOME_ID_MISMATCH", Some(&t_name), Some(&c_name));
                                    out_invalid = true;
                                } else {
                                    out_data = Some(v);
                                }
                            }
                            Err(_) => {
                                record_diag(&mut scan, "OUTCOME_INVALID_JSON", Some(&t_name), Some(&c_name));
                                out_invalid = true;
                            }
                        }
                        out_read = Some(r);
                    }
                }

                if scan.bytes_read > MAX_SCAN_BYTES {
                    scan.limit_hit = true;
                    scan.status = "incomplete".to_string();
                    break 'project_loop;
                }

                if scan.accepted_records >= MAX_SCAN_RECORDS {
                    scan.limit_hit = true;
                    scan.status = "incomplete".to_string();
                    break 'project_loop;
                }

                let checkpoint_digest = exec_data
                    .get("checkpoint_digest")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let mut ref_hasher = Sha256::new();
                ref_hasher.update(format!("{}:{}:{}", proj_id, t_name.to_lowercase(), c_name.to_lowercase()));
                let full_ref = format!("{:x}", ref_hasher.finalize());
                let record_ref = full_ref[..32].to_string();

                let status = exec_data
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("started")
                    .to_string();

                let route_val = exec_data.get("route");
                let route = HistoryRouteDto {
                    backend: route_val.and_then(|r| r.get("backend")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    model: route_val.and_then(|r| r.get("model")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    effort: route_val.and_then(|r| r.get("effort")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
                };

                let prompt_identity = exec_data
                    .get("prompt_identity")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let build_identity = exec_data
                    .get("build_identity")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let started_at = exec_data
                    .get("started_at")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);

                let completed_at = exec_data
                    .get("completed_at")
                    .and_then(|v| v.as_u64());

                let receipt_elapsed_ms = exec_data
                    .get("receipt")
                    .and_then(|r| r.get("elapsed_ms"))
                    .and_then(|v| v.as_u64());

                let outcome_state = if out_invalid {
                    "invalid".to_string()
                } else if out_data.is_some() {
                    "valid".to_string()
                } else {
                    "missing".to_string()
                };

                let outcome_result = if outcome_state == "valid" {
                    out_data.as_ref().and_then(|o| {
                        o.get("outcome")
                            .or_else(|| o.get("result"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                    })
                } else {
                    None
                };

                let attempts = exec_data
                    .get("attempts")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                let error_val = exec_data.get("error").cloned();

                let has_outcome = out_read.is_some() && out_data.is_some();
                let exec_fingerprint = exec_read.hash.clone();
                let out_fingerprint = out_read.as_ref().map(|r| r.hash.clone());
                let exec_dev = exec_read.dev;
                let exec_ino = exec_read.ino;
                let exec_size = exec_read.size;
                let (out_dev, out_ino, out_size) = match &out_read {
                    Some(r) => (Some(r.dev), Some(r.ino), r.size),
                    None => (None, None, 0),
                };

                rows.push(HistoryRowDto {
                    record_ref: record_ref.clone(),
                    project_id: proj_id.clone(),
                    task_run_id: t_name.to_lowercase(),
                    consultation_id: c_name.to_lowercase(),
                    status: status.clone(),
                    route: route.clone(),
                    checkpoint_digest: checkpoint_digest.clone(),
                    prompt_identity: prompt_identity.clone(),
                    build_identity: build_identity.clone(),
                    started_at,
                    completed_at,
                    receipt_elapsed_ms,
                    outcome_state: outcome_state.clone(),
                    outcome_result: outcome_result.clone(),
                });

                normalized_records.push(NormalizedHistoryRecord {
                    project_id: proj_id.clone(),
                    task_run_id: t_name.to_lowercase(),
                    consultation_id: c_name.to_lowercase(),
                    status,
                    checkpoint_digest,
                    route,
                    prompt_identity,
                    build_identity,
                    attempts,
                    started_at,
                    completed_at,
                    receipt_elapsed_ms,
                    error: error_val,
                    outcome_state,
                    outcome_result,
                    source_relative_path: format!("{proj_id}/{t_name}/{c_name}"),
                });

                raw_records.insert(
                    record_ref,
                    RawRecordCaptured {
                        record_ref: full_ref[..32].to_string(),
                        project_id: proj_id.clone(),
                        task_run_id: t_name.to_lowercase(),
                        consultation_id: c_name.to_lowercase(),
                        exec_path,
                        out_path,
                        has_outcome,
                        exec_fingerprint,
                        out_fingerprint,
                        exec_dev,
                        exec_ino,
                        exec_size,
                        out_dev,
                        out_ino,
                        out_size,
                    },
                );

                scan.accepted_records += 1;
                *project_counts.entry(proj_id.clone()).or_insert(0) += 1;
            }
        }
    }

    if !scan.limit_hit {
        scan.status = if scan.invalid_records > 0 {
            "complete_with_errors".to_string()
        } else {
            "complete".to_string()
        };
    }

    let mut inventory_entries = Vec::new();
    for pid in &eligible_project_ids {
        if let Some(&count) = project_counts.get(pid) {
            inventory_entries.push(ProjectInventoryItemDto {
                project_id: pid.clone(),
                label: project_labels.get(pid).cloned().flatten(),
                count,
            });
        }
    }

    let total_projects = inventory_entries.len();
    let unfiltered_total_records = scan.accepted_records;

    ScanOutput {
        scan,
        rows,
        raw_records,
        normalized_records,
        inventory: ProjectInventoryDto {
            entries: inventory_entries,
            total_projects,
            unfiltered_total_records,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../__fixtures__/native-advisor/advisor-history")
    }

    #[test]
    fn test_scan_synthetic_fixtures() {
        let root = fixture_root();
        let output = scan_history_records(&root, None);

        assert_eq!(output.scan.status, "complete_with_errors");
        assert_eq!(output.scan.projects_discovered, 2);
        assert_eq!(output.scan.accepted_records, 3);
        assert_eq!(output.scan.invalid_records, 2);
        assert_eq!(output.inventory.total_projects, 2);
        assert_eq!(output.inventory.unfiltered_total_records, 3);

        let diag_codes: Vec<&str> = output
            .scan
            .diagnostics
            .iter()
            .map(|d| d.code.as_str())
            .collect();
        assert!(diag_codes.contains(&"EXECUTION_INVALID_JSON"));
        assert!(diag_codes.contains(&"OUTCOME_INVALID_JSON"));

        let alpha = output
            .inventory
            .entries
            .iter()
            .find(|e| e.label.as_deref() == Some("Project Alpha"))
            .expect("Project Alpha found");
        assert_eq!(alpha.count, 2);

        let beta = output
            .inventory
            .entries
            .iter()
            .find(|e| e.label.as_deref() == Some("Project Beta"))
            .expect("Project Beta found");
        assert_eq!(beta.count, 1);

        assert_eq!(output.rows.len(), 3);
        let states: Vec<&str> = output.rows.iter().map(|r| r.outcome_state.as_str()).collect();
        assert!(states.contains(&"valid"));
        assert!(states.contains(&"missing"));
        assert!(states.contains(&"invalid"));
    }

    #[test]
    fn test_scan_target_project_scope() {
        let root = fixture_root();
        let target = "fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998";
        let output = scan_history_records(&root, Some(target));

        assert_eq!(output.scan.projects_discovered, 1);
        assert_eq!(output.scan.accepted_records, 2);
        assert_eq!(output.inventory.total_projects, 1);
        assert_eq!(output.rows.len(), 2);
    }
}
