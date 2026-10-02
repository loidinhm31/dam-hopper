use std::collections::{HashMap, HashSet};
use crate::advisor::types::*;

pub fn nearest_rank_percentile(values: &[f64], p: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    let rank = ((p * n as f64).ceil() as usize).max(1);
    let index = (rank - 1).min(n - 1);
    Some(sorted[index])
}

pub fn round6(n: f64) -> f64 {
    (n * 1e6).round() / 1e6
}

pub fn filter_records<'a>(
    records: &'a [NormalizedHistoryRecord],
    filters: Option<&HistoryMetricFiltersDto>,
) -> Vec<&'a NormalizedHistoryRecord> {
    let Some(f) = filters else {
        return records.iter().collect();
    };

    records
        .iter()
        .filter(|r| {
            if let Some(statuses) = &f.statuses {
                if !statuses.is_empty() && !statuses.iter().any(|s| s == &r.status) {
                    return false;
                }
            }
            if let Some(outcome_states) = &f.outcome_states {
                if !outcome_states.is_empty()
                    && !outcome_states.iter().any(|s| s == &r.outcome_state)
                {
                    return false;
                }
            }
            if let Some(outcome_results) = &f.outcome_results {
                if !outcome_results.is_empty() {
                    match &r.outcome_result {
                        Some(res) => {
                            if !outcome_results.iter().any(|o| o == res) {
                                return false;
                            }
                        }
                        None => return false,
                    }
                }
            }
            if let Some(backends) = &f.backends {
                if !backends.is_empty() && !backends.iter().any(|b| b == &r.route.backend) {
                    return false;
                }
            }
            if let Some(models) = &f.models {
                if !models.is_empty() && !models.iter().any(|m| m == &r.route.model) {
                    return false;
                }
            }
            if let Some(efforts) = &f.efforts {
                if !efforts.is_empty() && !efforts.iter().any(|e| e == &r.route.effort) {
                    return false;
                }
            }
            if let Some(prompts) = &f.prompt_identities {
                if !prompts.is_empty() && !prompts.iter().any(|p| p == &r.prompt_identity) {
                    return false;
                }
            }
            if let Some(builds) = &f.build_identities {
                if !builds.is_empty() && !builds.iter().any(|b| b == &r.build_identity) {
                    return false;
                }
            }
            if let Some(from) = f.started_at_from {
                if r.started_at < from {
                    return false;
                }
            }
            if let Some(to) = f.started_at_to {
                if r.started_at > to {
                    return false;
                }
            }
            true
        })
        .collect()
}

pub fn calculate_summary_metrics(
    records: &[NormalizedHistoryRecord],
    filters: Option<&HistoryMetricFiltersDto>,
    scan: &HistoryScanSummaryDto,
) -> HistorySummaryMetricsDto {
    let filtered = filter_records(records, filters);

    let total_consultations = filtered.len();
    let mut advice_ready_count = 0;
    let mut failed_count = 0;
    let mut started_count = 0;
    let mut resolved_count = 0;
    let mut unresolved_count = 0;
    let mut regressed_count = 0;
    let mut unknown_count = 0;
    let mut missing_outcome_count = 0;
    let mut valid_outcome_count = 0;
    let mut invalid_outcome_count = 0;

    let mut latencies: Vec<f64> = Vec::new();
    let mut route_distribution: HashMap<String, usize> = HashMap::new();
    let mut projects_set = HashSet::new();
    let mut tasks_set = HashSet::new();

    for r in &filtered {
        projects_set.insert(&r.project_id);
        tasks_set.insert((&r.project_id, &r.task_run_id));

        match r.status.as_str() {
            "ADVICE_READY" => advice_ready_count += 1,
            "FAILED" => failed_count += 1,
            "started" => started_count += 1,
            _ => {}
        }

        match r.outcome_state.as_str() {
            "missing" => missing_outcome_count += 1,
            "valid" => valid_outcome_count += 1,
            "invalid" => invalid_outcome_count += 1,
            _ => {}
        }

        match r.outcome_result.as_deref() {
            Some("resolved") => resolved_count += 1,
            Some("unresolved") => unresolved_count += 1,
            Some("regressed") => regressed_count += 1,
            Some("unknown") => unknown_count += 1,
            _ => {}
        }

        if r.status != "started" {
            if let Some(elapsed) = r.receipt_elapsed_ms {
                latencies.push(elapsed as f64);
            }
        }

        let route_key = if r.route.backend.is_empty() && r.route.model.is_empty() {
            "unknown".to_string()
        } else {
            format!("{}:{}", r.route.backend, r.route.model)
        };
        *route_distribution.entry(route_key).or_insert(0) += 1;
    }

    let completed_consultations = advice_ready_count + failed_count;

    let avg_latency_ms = if latencies.is_empty() {
        None
    } else {
        let sum: f64 = latencies.iter().sum();
        Some(round6(sum / latencies.len() as f64))
    };

    let p95_latency_ms = nearest_rank_percentile(&latencies, 0.95);

    let counts_val = serde_json::json!({
        "projects": projects_set.len(),
        "tasks": tasks_set.len(),
        "consultations": total_consultations,
        "terminal": completed_consultations,
        "statuses": {
            "started": started_count,
            "ADVICE_READY": advice_ready_count,
            "FAILED": failed_count,
        },
        "outcome_states": {
            "missing": missing_outcome_count,
            "valid": valid_outcome_count,
            "invalid": invalid_outcome_count,
        },
        "outcome_results": {
            "resolved": resolved_count,
            "unresolved": unresolved_count,
            "regressed": regressed_count,
            "unknown": unknown_count,
        }
    });

    let term_d = completed_consultations;
    let delivery_val = if term_d > 0 {
        Some(round6(advice_ready_count as f64 / term_d as f64))
    } else {
        None
    };

    let cov_n = filtered
        .iter()
        .filter(|r| r.status == "ADVICE_READY" && r.outcome_state == "valid")
        .count();
    let coverage_val = if advice_ready_count > 0 {
        Some(round6(cov_n as f64 / advice_ready_count as f64))
    } else {
        None
    };

    let res_d = resolved_count + unresolved_count + regressed_count;
    let resolution_val = if res_d > 0 {
        Some(round6(resolved_count as f64 / res_d as f64))
    } else {
        None
    };

    let metrics_payload = serde_json::json!({
        "delivery": {
            "numerator": advice_ready_count,
            "denominator": term_d,
            "value": delivery_val,
            "excluded": total_consultations.saturating_sub(term_d)
        },
        "outcome_coverage": {
            "numerator": cov_n,
            "denominator": advice_ready_count,
            "value": coverage_val,
            "excluded": total_consultations.saturating_sub(advice_ready_count)
        },
        "resolution": {
            "numerator": resolved_count,
            "denominator": res_d,
            "value": resolution_val,
            "excluded": total_consultations.saturating_sub(res_d)
        },
        "latency": {
            "unit": "milliseconds",
            "sample_count": latencies.len(),
            "mean": avg_latency_ms,
            "p95": p95_latency_ms,
            "excluded": total_consultations.saturating_sub(latencies.len())
        },
        "route_groups": []
    });

    HistorySummaryMetricsDto {
        metric_definition_version: 1,
        total_consultations,
        completed_consultations,
        advice_ready_count,
        failed_count,
        resolved_count,
        unresolved_count,
        regressed_count,
        missing_outcome_count,
        avg_latency_ms,
        p95_latency_ms,
        route_distribution,
        counts: Some(counts_val),
        scan: Some(scan.clone()),
        metrics: Some(metrics_payload),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_nearest_rank_percentile() {
        assert_eq!(nearest_rank_percentile(&[], 0.5), None);
        let single = vec![42.0];
        assert_eq!(nearest_rank_percentile(&single, 0.5), Some(42.0));
        assert_eq!(nearest_rank_percentile(&single, 0.95), Some(42.0));

        let vals = vec![10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0];
        assert_eq!(nearest_rank_percentile(&vals, 0.5), Some(50.0));
        assert_eq!(nearest_rank_percentile(&vals, 0.95), Some(100.0));
    }

    #[test]
    fn test_round6() {
        assert_eq!(round6(1.123456789), 1.123457);
        assert_eq!(round6(2.0), 2.0);
    }

    #[test]
    fn test_filter_and_calculate_metrics() {
        let rec1 = NormalizedHistoryRecord {
            project_id: "p1".to_string(),
            task_run_id: "t1".to_string(),
            consultation_id: "c1".to_string(),
            status: "ADVICE_READY".to_string(),
            checkpoint_digest: "d1".to_string(),
            route: HistoryRouteDto {
                backend: "codex".to_string(),
                model: "gpt-5.6".to_string(),
                effort: "high".to_string(),
            },
            prompt_identity: "p1".to_string(),
            build_identity: "b1".to_string(),
            attempts: vec![],
            started_at: 1000,
            completed_at: Some(2000),
            receipt_elapsed_ms: Some(1000),
            error: None,
            outcome_state: "valid".to_string(),
            outcome_result: Some("resolved".to_string()),
            source_relative_path: "p1/t1/c1".to_string(),
        };

        let rec2 = NormalizedHistoryRecord {
            project_id: "p1".to_string(),
            task_run_id: "t1".to_string(),
            consultation_id: "c2".to_string(),
            status: "FAILED".to_string(),
            checkpoint_digest: "d2".to_string(),
            route: HistoryRouteDto {
                backend: "codex".to_string(),
                model: "gpt-5.6".to_string(),
                effort: "high".to_string(),
            },
            prompt_identity: "p1".to_string(),
            build_identity: "b1".to_string(),
            attempts: vec![],
            started_at: 2000,
            completed_at: Some(2500),
            receipt_elapsed_ms: Some(500),
            error: None,
            outcome_state: "missing".to_string(),
            outcome_result: None,
            source_relative_path: "p1/t1/c2".to_string(),
        };

        let rec3 = NormalizedHistoryRecord {
            project_id: "p2".to_string(),
            task_run_id: "t2".to_string(),
            consultation_id: "c3".to_string(),
            status: "started".to_string(),
            checkpoint_digest: "d3".to_string(),
            route: HistoryRouteDto {
                backend: "omp".to_string(),
                model: "gpt-5.6".to_string(),
                effort: "low".to_string(),
            },
            prompt_identity: "p2".to_string(),
            build_identity: "b2".to_string(),
            attempts: vec![],
            started_at: 3000,
            completed_at: None,
            receipt_elapsed_ms: None,
            error: None,
            outcome_state: "missing".to_string(),
            outcome_result: None,
            source_relative_path: "p2/t2/c3".to_string(),
        };

        let records = vec![rec1, rec2, rec3];
        let scan = HistoryScanSummaryDto {
            status: "complete".to_string(),
            projects_discovered: 2,
            tasks_discovered: 2,
            consultations_discovered: 3,
            accepted_records: 3,
            invalid_records: 0,
            bytes_discovered: 100,
            bytes_read: 100,
            diagnostics: vec![],
            suppressed_diagnostics: 0,
            limit_hit: false,
        };

        let summary = calculate_summary_metrics(&records, None, &scan);
        assert_eq!(summary.total_consultations, 3);
        assert_eq!(summary.completed_consultations, 2);
        assert_eq!(summary.advice_ready_count, 1);
        assert_eq!(summary.failed_count, 1);
        assert_eq!(summary.resolved_count, 1);
        assert_eq!(summary.missing_outcome_count, 2);
        assert_eq!(summary.avg_latency_ms, Some(750.0)); // (1000 + 500) / 2

        // Filtering by backend "codex"
        let filters = HistoryMetricFiltersDto {
            backends: Some(vec!["codex".to_string()]),
            ..Default::default()
        };
        let filtered_summary = calculate_summary_metrics(&records, Some(&filters), &scan);
        assert_eq!(filtered_summary.total_consultations, 2);
        assert_eq!(filtered_summary.completed_consultations, 2);
    }
}
