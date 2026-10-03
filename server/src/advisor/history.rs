use std::path::{Path, PathBuf};
use crate::advisor::evaluations::*;
use crate::advisor::policy::*;
use tokio::sync::Mutex;
use sha2::{Digest, Sha256};

use crate::advisor::error::AdvisorError;
use crate::advisor::history_scan::{
    read_bounded_file, scan_history_records, MAX_EXECUTION_HISTORY_BYTES,
    MAX_OUTCOME_HISTORY_BYTES,
};
use crate::advisor::metrics::calculate_summary_metrics;
use crate::advisor::snapshots::{
    current_time_ms, paginate_entries, SnapshotCache,
};
use crate::advisor::status::inspect_history_root;
use crate::advisor::types::*;

pub struct AdvisorService {
    home_dir: Option<PathBuf>,
    cache: Mutex<SnapshotCache>,
    policy_lock: std::sync::Arc<Mutex<()>>,
    model_service: std::sync::Arc<crate::advisor::models::HarnessModelService>,
}

impl AdvisorService {
    pub fn new(home_dir: Option<PathBuf>) -> Self {
        Self {
            home_dir: home_dir.clone(),
            cache: Mutex::new(SnapshotCache::new(Vec::new())),
            policy_lock: std::sync::Arc::new(Mutex::new(())),
            model_service: std::sync::Arc::new(crate::advisor::models::HarnessModelService::new(
                home_dir,
            )),
        }
    }

    pub fn with_secret(home_dir: Option<PathBuf>, secret: Vec<u8>) -> Self {
        Self {
            home_dir: home_dir.clone(),
            cache: Mutex::new(SnapshotCache::new(secret)),
            policy_lock: std::sync::Arc::new(Mutex::new(())),
            model_service: std::sync::Arc::new(crate::advisor::models::HarnessModelService::new(
                home_dir,
            )),
        }
    }

    pub fn with_model_runner(
        home_dir: Option<PathBuf>,
        runner: std::sync::Arc<dyn crate::advisor::models::HarnessCommandRunner>,
    ) -> Self {
        Self {
            home_dir: home_dir.clone(),
            cache: Mutex::new(SnapshotCache::new(Vec::new())),
            policy_lock: std::sync::Arc::new(Mutex::new(())),
            model_service: std::sync::Arc::new(
                crate::advisor::models::HarnessModelService::with_runner(home_dir, runner),
            ),
        }
    }

    pub async fn discover_models(
        &self,
        backend: &str,
    ) -> Result<crate::advisor::models::AdvisorModelsResultDto, AdvisorError> {
        self.model_service.discover_models(backend).await
    }

    pub fn status(&self, enabled: bool) -> AdvisorStatusDto {
        inspect_history_root(enabled, self.home_dir.as_deref())
    }

    pub fn read_current_policy(&self) -> PolicyReadCurrentResultDto {
        crate::advisor::policy::read_current_policy(self.home_dir.as_deref())
    }

    pub async fn update_policy(
        &self,
        params: PolicyUpdateParamsDto,
    ) -> Result<PolicyReadCurrentResultDto, AdvisorError> {
        let lock_arc = self.policy_lock.clone();
        let guard = lock_arc.lock_owned().await;
        let home_dir = self.home_dir.clone();

        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            crate::advisor::policy::update_current_policy(home_dir.as_deref(), params)
        })
        .await
        .map_err(|e| AdvisorError::Internal(e.to_string()))?
    }
    pub fn list_evaluations(
        &self,
        project_root: Option<&Path>,
        params: EvaluationsListParamsDto,
    ) -> EvaluationsListResultDto {
        crate::advisor::evaluations::list_evaluations(self.home_dir.as_deref(), project_root, params)
    }

    pub fn read_evaluation(
        &self,
        project_root: Option<&Path>,
        params: EvaluationsReadParamsDto,
    ) -> EvaluationsReadResultDto {
        crate::advisor::evaluations::read_evaluation(self.home_dir.as_deref(), project_root, params)
    }

    pub fn compare_evaluations(
        &self,
        project_root: Option<&Path>,
        params: EvaluationsCompareParamsDto,
    ) -> Result<EvaluationsCompareResultDto, AdvisorError> {
        crate::advisor::evaluations::compare_evaluations(self.home_dir.as_deref(), project_root, params)
    }

    pub async fn clear_snapshots(&self) {
        self.cache.lock().await.clear_all();
    }

    pub async fn refresh(
        &self,
        user_subject: &str,
        target_project_id: Option<&str>,
    ) -> Result<HistoryRefreshResultDto, AdvisorError> {
        let status = self.status(true);
        if !status.available {
            let error_msg = status
                .source_error
                .unwrap_or_else(|| "History root is unavailable".to_string());
            return Ok(HistoryRefreshResultDto {
                state: "unavailable".to_string(),
                snapshot_id: None,
                observed_at: current_time_ms(),
                scan: HistoryScanSummaryDto {
                    status: "incomplete".to_string(),
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
                },
                stale_reason: Some(error_msg),
                inventory: None,
            });
        }

        let history_root = PathBuf::from(
            status
                .path
                .ok_or_else(|| AdvisorError::Unavailable("Missing history path".to_string()))?,
        );

        let target_id = target_project_id.map(str::to_string);
        let output = tokio::task::spawn_blocking(move || {
            scan_history_records(&history_root, target_id.as_deref())
        })
        .await
        .map_err(|e| AdvisorError::Internal(e.to_string()))?;

        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let now = current_time_ms();

        let snapshot = HistorySnapshot {
            snapshot_id: snapshot_id.clone(),
            owner_subject: user_subject.to_string(),
            state: "fresh".to_string(),
            observed_at: now,
            last_accessed_at: now,
            scan: output.scan.clone(),
            rows: output.rows,
            raw_records: output.raw_records,
            normalized_records: output.normalized_records,
            inventory: output.inventory.clone(),
        };

        self.cache.lock().await.store_snapshot(snapshot);

        Ok(HistoryRefreshResultDto {
            state: "fresh".to_string(),
            snapshot_id: Some(snapshot_id),
            observed_at: now,
            scan: output.scan,
            stale_reason: None,
            inventory: Some(output.inventory),
        })
    }

    pub async fn summary(
        &self,
        user_subject: &str,
        params: HistorySummaryParamsDto,
    ) -> Result<HistorySummaryResultDto, AdvisorError> {
        let mut cache = self.cache.lock().await;
        let snapshot = cache.get_snapshot(&params.snapshot_id, user_subject)?;

        let candidate_records: Vec<NormalizedHistoryRecord> = snapshot
            .normalized_records
            .iter()
            .filter(|r| {
                if let Some(target_pid) = &params.query.project_id {
                    let pid_matches = r.project_id.eq_ignore_ascii_case(target_pid);
                    let label_matches = snapshot
                        .inventory
                        .entries
                        .iter()
                        .any(|e| {
                            e.project_id.eq_ignore_ascii_case(&r.project_id)
                                && e.label
                                    .as_deref()
                                    .map(|l| l.eq_ignore_ascii_case(target_pid))
                                    .unwrap_or(false)
                        });
                    if !pid_matches && !label_matches {
                        return false;
                    }
                }
                if let Some(target_tid) = &params.query.task_run_id {
                    if !r.task_run_id.eq_ignore_ascii_case(target_tid) {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect();

        let metrics = calculate_summary_metrics(
            &candidate_records,
            params.query.filters.as_ref(),
            &snapshot.scan,
        );

        Ok(HistorySummaryResultDto {
            state: snapshot.state.clone(),
            snapshot_id: snapshot.snapshot_id.clone(),
            metrics,
            inventory: snapshot.inventory.clone(),
        })
    }

    pub async fn page(
        &self,
        user_subject: &str,
        params: HistoryPageParamsDto,
    ) -> Result<HistoryPageResultDto, AdvisorError> {
        if params.sort != "started_at_desc" {
            return Err(AdvisorError::InvalidInput(
                "sort must be 'started_at_desc'".to_string(),
            ));
        }

        let mut cache = self.cache.lock().await;
        let secret = cache.secret().to_vec();
        let snapshot = cache.get_snapshot(&params.snapshot_id, user_subject)?;

        paginate_entries(
            &secret,
            snapshot,
            &params.query,
            params.cursor.as_deref(),
            params.limit,
        )
    }

    pub async fn detail(
        &self,
        user_subject: &str,
        params: HistoryDetailParamsDto,
    ) -> Result<HistoryDetailResultDto, AdvisorError> {
        let mut cache = self.cache.lock().await;
        let snapshot = cache.get_snapshot(&params.snapshot_id, user_subject)?;

        let captured = snapshot
            .raw_records
            .get(&params.record_ref)
            .ok_or_else(|| AdvisorError::RecordNotFound(params.record_ref.clone()))?
            .clone();

        let snapshot_id = snapshot.snapshot_id.clone();
        let record_ref = params.record_ref.clone();

        tokio::task::spawn_blocking(move || {
            // 1. Reread execution.json
            let exec_read = match read_bounded_file(&captured.exec_path, MAX_EXECUTION_HISTORY_BYTES) {
                Some(r) => r,
                None => {
                    let meta = std::fs::symlink_metadata(&captured.exec_path);
                    return match meta {
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                            Ok(HistoryDetailResultDto {
                                status: "missing".to_string(),
                                snapshot_id,
                                record_ref,
                                detail_revision: None,
                                observed_revision: None,
                                execution: None,
                                outcome: None,
                            })
                        }
                        _ => Ok(HistoryDetailResultDto {
                            status: "changed".to_string(),
                            snapshot_id,
                            record_ref,
                            detail_revision: None,
                            observed_revision: Some("unreadable".to_string()),
                            execution: None,
                            outcome: None,
                        }),
                    };
                }
            };

            if exec_read.dev != captured.exec_dev
                || exec_read.ino != captured.exec_ino
                || exec_read.size != captured.exec_size
                || exec_read.hash != captured.exec_fingerprint
            {
                return Ok(HistoryDetailResultDto {
                    status: "changed".to_string(),
                    snapshot_id,
                    record_ref,
                    detail_revision: None,
                    observed_revision: Some(exec_read.hash),
                    execution: None,
                    outcome: None,
                });
            }

            // 2. Reread outcome.json
            let out_read = read_bounded_file(&captured.out_path, MAX_OUTCOME_HISTORY_BYTES);
            if captured.has_outcome {
                let Some(out) = out_read.as_ref() else {
                    return Ok(HistoryDetailResultDto {
                        status: "changed".to_string(),
                        snapshot_id,
                        record_ref,
                        detail_revision: None,
                        observed_revision: Some("outcome_missing".to_string()),
                        execution: None,
                        outcome: None,
                    });
                };

                if Some(out.dev) != captured.out_dev
                    || Some(out.ino) != captured.out_ino
                    || out.size != captured.out_size
                    || Some(&out.hash) != captured.out_fingerprint.as_ref()
                {
                    return Ok(HistoryDetailResultDto {
                        status: "changed".to_string(),
                        snapshot_id,
                        record_ref,
                        detail_revision: None,
                        observed_revision: Some(out.hash.clone()),
                        execution: None,
                        outcome: None,
                    });
                }
            } else {
                let out_stat = std::fs::symlink_metadata(&captured.out_path).ok();
                if out_stat.is_some() || out_read.is_some() {
                    return Ok(HistoryDetailResultDto {
                        status: "changed".to_string(),
                        snapshot_id,
                        record_ref,
                        detail_revision: None,
                        observed_revision: Some(
                            out_read.map(|r| r.hash).unwrap_or_else(|| "unreadable".to_string()),
                        ),
                        execution: None,
                        outcome: None,
                    });
                }
            }

            // 3. Parse JSON
            let exec_data: serde_json::Value = match serde_json::from_slice(&exec_read.bytes) {
                Ok(v) => v,
                Err(_) => {
                    return Ok(HistoryDetailResultDto {
                        status: "changed".to_string(),
                        snapshot_id,
                        record_ref,
                        detail_revision: None,
                        observed_revision: Some("invalid_json".to_string()),
                        execution: None,
                        outcome: None,
                    });
                }
            };

            let mut out_data: Option<serde_json::Value> = None;
            if let Some(r) = out_read.as_ref() {
                match serde_json::from_slice(&r.bytes) {
                    Ok(v) => out_data = Some(v),
                    Err(_) => {
                        return Ok(HistoryDetailResultDto {
                            status: "changed".to_string(),
                            snapshot_id,
                            record_ref,
                            detail_revision: None,
                            observed_revision: Some("invalid_outcome_json".to_string()),
                            execution: None,
                            outcome: None,
                        });
                    }
                }
            }

            // 4. Detail revision
            let mut hasher = Sha256::new();
            hasher.update(format!(
                "{}:{}",
                captured.exec_fingerprint,
                captured.out_fingerprint.as_deref().unwrap_or("no-outcome")
            ));
            let detail_revision = format!("{:x}", hasher.finalize());

            // 5. Sanitize display
            let sanitized_exec = sanitize_value_for_display(exec_data);
            let sanitized_out = out_data.map(sanitize_value_for_display);

            Ok(HistoryDetailResultDto {
                status: "ready".to_string(),
                snapshot_id,
                record_ref,
                detail_revision: Some(detail_revision),
                observed_revision: None,
                execution: Some(sanitized_exec),
                outcome: sanitized_out,
            })
        })
        .await
        .map_err(|e| AdvisorError::Internal(e.to_string()))?
    }
}

pub fn sanitize_text_for_display(text: &str) -> String {
    let mut out = String::with_capacity(text.len());

    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\u{1b}' && i + 1 < chars.len() && chars[i + 1] == '[' {
            let mut in_escape = true;
            i += 2;
            while i < chars.len() && in_escape {
                let ec = chars[i];
                if ec.is_ascii_alphabetic() {
                    in_escape = false;
                }
                i += 1;
            }
            continue;
        }

        if (c < ' ' && c != '\t' && c != '\n' && c != '\r') || c == '\u{7f}' {
            i += 1;
            continue;
        }

        out.push(c);
        i += 1;
    }
    out
}

pub fn sanitize_value_for_display(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => serde_json::Value::String(sanitize_text_for_display(&s)),
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(sanitize_value_for_display).collect())
        }
        serde_json::Value::Object(map) => {
            let mut sanitized = serde_json::Map::with_capacity(map.len());
            for (k, v) in map {
                sanitized.insert(k, sanitize_value_for_display(v));
            }
            serde_json::Value::Object(sanitized)
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_home() -> PathBuf {
        // The fixtures are in __fixtures__/native-advisor/advisor-history
        // To simulate $HOME/.evcrate/advisor-history, create a temp dir with a symlink or copy
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let fixture_history = manifest_dir.join("../__fixtures__/native-advisor/advisor-history");

        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();

        let target_dir = dot_evcrate.join("advisor-history");
        copy_dir_all(&fixture_history, &target_dir);
        tmp.keep()
    }

    fn copy_dir_all(src: &Path, dst: &Path) {
        std::fs::create_dir_all(dst).unwrap();
        for entry in std::fs::read_dir(src).unwrap().flatten() {
            let ty = entry.file_type().unwrap();
            if ty.is_dir() {
                copy_dir_all(&entry.path(), &dst.join(entry.file_name()));
            } else {
                std::fs::copy(entry.path(), dst.join(entry.file_name())).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn test_advisor_service_refresh_summary_page_detail() {
        let home = fixture_home();
        let service = AdvisorService::new(Some(home));

        let status = service.status(true);
        assert!(status.available);

        // 1. Refresh
        let refresh_res = service.refresh("admin_user", None).await.unwrap();
        assert_eq!(refresh_res.state, "fresh");
        let snapshot_id = refresh_res.snapshot_id.expect("has snapshot_id");
        assert_eq!(refresh_res.scan.accepted_records, 3);

        // 2. Summary
        let summary_res = service
            .summary(
                "admin_user",
                HistorySummaryParamsDto {
                    snapshot_id: snapshot_id.clone(),
                    query: HistoryQueryDto::default(),
                },
            )
            .await
            .unwrap();
        assert_eq!(summary_res.metrics.total_consultations, 3);
        assert_eq!(summary_res.metrics.advice_ready_count, 2);
        assert_eq!(summary_res.metrics.resolved_count, 1);
        assert_eq!(summary_res.metrics.missing_outcome_count, 1);

        // 3. Page
        let page_res = service
            .page(
                "admin_user",
                HistoryPageParamsDto {
                    snapshot_id: snapshot_id.clone(),
                    query: HistoryQueryDto::default(),
                    sort: "started_at_desc".to_string(),
                    cursor: None,
                    limit: Some(2),
                },
            )
            .await
            .unwrap();
        assert_eq!(page_res.entries.len(), 2);
        assert!(page_res.next_cursor.is_some());

        // Fetch page 2 using cursor
        let page2_res = service
            .page(
                "admin_user",
                HistoryPageParamsDto {
                    snapshot_id: snapshot_id.clone(),
                    query: HistoryQueryDto::default(),
                    sort: "started_at_desc".to_string(),
                    cursor: page_res.next_cursor,
                    limit: Some(2),
                },
            )
            .await
            .unwrap();
        assert_eq!(page2_res.entries.len(), 1);
        assert!(page2_res.next_cursor.is_none());

        // 4. Detail
        let valid_row = page2_res
            .entries
            .iter()
            .find(|r| r.outcome_state == "valid")
            .expect("valid row found");
        let detail_res = service
            .detail(
                "admin_user",
                HistoryDetailParamsDto {
                    snapshot_id: snapshot_id.clone(),
                    record_ref: valid_row.record_ref.clone(),
                },
            )
            .await
            .unwrap();
        assert_eq!(detail_res.status, "ready");
        assert!(detail_res.detail_revision.is_some());
        let rev = detail_res.detail_revision.unwrap();
        assert_eq!(rev.len(), 64);
        assert!(detail_res.execution.is_some());
        assert!(detail_res.outcome.is_some());
    }
}
