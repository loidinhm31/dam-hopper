use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonCaseDto {
    pub evaluation_id: String,
    pub run_id: String,
    pub case_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateResponseStatsDto {
    pub candidate_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_identity: Option<String>,
    pub total_observations: usize,
    pub ready_count: usize,
    pub failed_count: usize,
    pub missing_count: usize,
    pub unscored_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateScoreSummaryDto {
    pub candidate_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_identity: Option<String>,
    pub provenance: String,
    pub total_scored_observations: usize,
    pub full_score_count: usize,
    pub partial_score_count: usize,
    pub average_score: Option<f64>,
    pub pass_rate: Option<f64>,
    pub dimension_averages: HashMap<String, Option<f64>>,
    pub issues: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationComparisonGroupDto {
    #[serde(alias = "groupKey")]
    pub key: String,
    pub rubric_digest: String,
    pub input_digest: String,
    pub cases: Vec<ComparisonCaseDto>,
    pub responses: Vec<CandidateResponseStatsDto>,
    pub human_scores: Vec<CandidateScoreSummaryDto>,
    pub automated_scores: Vec<CandidateScoreSummaryDto>,
}

fn round2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

fn round4(n: f64) -> f64 {
    (n * 10000.0).round() / 10000.0
}

#[derive(Default)]
struct ScoreStats {
    full: usize,
    partial: usize,
    avg_sum: f64,
    pass_count: usize,
    dim_sums: HashMap<String, (f64, usize)>,
    issues: Vec<serde_json::Value>,
}

pub fn aggregate_evaluation_groups(documents: &[serde_json::Value]) -> Vec<EvaluationComparisonGroupDto> {
    struct GroupAcc {
        rubric_digest: String,
        input_digest: String,
        cases: Vec<ComparisonCaseDto>,
        // candidate_id -> (cand_obj, obs, ready, failed, missing, unscored)
        resp_map: HashMap<String, (serde_json::Value, usize, usize, usize, usize, usize)>,
        // candidate_id -> (cand_obj, human_stats, automated_stats)
        score_map: HashMap<String, (serde_json::Value, ScoreStats, ScoreStats)>,
    }

    let mut groups: HashMap<String, GroupAcc> = HashMap::new();
    let mut group_order: Vec<String> = Vec::new();

    for doc in documents {
        let rubric_digest = doc.get("rubric_digest").and_then(|v| v.as_str()).unwrap_or("");
        let evaluation_id = doc.get("evaluation_id").and_then(|v| v.as_str()).unwrap_or("");
        let run_id = doc.get("run_id").and_then(|v| v.as_str()).unwrap_or("");

        let mut cand_by_id = HashMap::new();
        if let Some(candidates) = doc.get("candidates").and_then(|v| v.as_array()) {
            for c in candidates {
                if let Some(cid) = c.get("candidate_id").and_then(|v| v.as_str()) {
                    cand_by_id.insert(cid.to_string(), c.clone());
                }
            }
        }

        if let Some(cases) = doc.get("cases").and_then(|v| v.as_array()) {
            for cs in cases {
                let input_digest = cs.get("input_digest").and_then(|v| v.as_str()).unwrap_or("");
                let case_id = cs.get("case_id").and_then(|v| v.as_str()).unwrap_or("");
                let name = cs.get("name").and_then(|v| v.as_str()).map(str::to_string);
                let category = cs.get("category").and_then(|v| v.as_str()).map(str::to_string);

                let key = format!("{rubric_digest}:{input_digest}");
                if !groups.contains_key(&key) {
                    group_order.push(key.clone());
                    groups.insert(
                        key.clone(),
                        GroupAcc {
                            rubric_digest: rubric_digest.to_string(),
                            input_digest: input_digest.to_string(),
                            cases: Vec::new(),
                            resp_map: HashMap::new(),
                            score_map: HashMap::new(),
                        },
                    );
                }

                let g = groups.get_mut(&key).unwrap();
                g.cases.push(ComparisonCaseDto {
                    evaluation_id: evaluation_id.to_string(),
                    run_id: run_id.to_string(),
                    case_id: case_id.to_string(),
                    name,
                    category,
                });

                if let Some(observations) = cs.get("observations").and_then(|v| v.as_array()) {
                    for obs in observations {
                        let cid = obs.get("candidate_id").and_then(|v| v.as_str()).unwrap_or("");
                        let cand = cand_by_id.get(cid).cloned().unwrap_or(serde_json::Value::Null);

                        let entry = g.resp_map.entry(cid.to_string()).or_insert_with(|| {
                            (cand.clone(), 0, 0, 0, 0, 0)
                        });
                        entry.1 += 1; // obs

                        let resp_status = obs
                            .get("response")
                            .and_then(|r| r.get("status"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("");

                        match resp_status {
                            "ADVICE_READY" => entry.2 += 1,
                            "FAILED" => entry.3 += 1,
                            _ => entry.4 += 1,
                        }

                        let score_val = obs.get("score");
                        if score_val.is_none() || score_val == Some(&serde_json::Value::Null) {
                            entry.5 += 1; // unscored
                        } else if let Some(score) = score_val {
                            let s_entry = g.score_map.entry(cid.to_string()).or_insert_with(|| {
                                (cand.clone(), ScoreStats::default(), ScoreStats::default())
                            });

                            let prov = score.get("provenance").and_then(|p| p.as_str()).unwrap_or("automated");
                            let target = if prov == "human" { &mut s_entry.1 } else { &mut s_entry.2 };

                            let avg_score = score.get("average_score").and_then(|v| v.as_f64());
                            if let Some(avg) = avg_score {
                                target.full += 1;
                                target.avg_sum += avg;
                                if score.get("passed").and_then(|v| v.as_bool()).unwrap_or(false) {
                                    target.pass_count += 1;
                                }
                            } else {
                                target.partial += 1;
                            }

                            if let Some(dimensions) = score.get("dimensions").and_then(|v| v.as_array()) {
                                for d in dimensions {
                                    if let Some(dim_id) = d.get("dimension_id").and_then(|v| v.as_str()) {
                                        if let Some(dim_score) = d.get("score").and_then(|v| v.as_f64()) {
                                            let dim_stat = target
                                                .dim_sums
                                                .entry(dim_id.to_string())
                                                .or_insert((0.0, 0));
                                            dim_stat.0 += dim_score;
                                            dim_stat.1 += 1;
                                        }
                                    }
                                }
                            }

                            if let Some(issues) = score.get("issues").and_then(|v| v.as_array()) {
                                target.issues.extend(issues.iter().cloned());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result = Vec::new();
    for key in group_order {
        let g = match groups.remove(&key) {
            Some(g) => g,
            None => continue,
        };

        let mut candidate_ids: Vec<String> = g.resp_map.keys().cloned().collect();
        candidate_ids.sort();

        let mut responses = Vec::new();
        for cid in &candidate_ids {
            if let Some((cand, obs, ready, failed, missing, unscored)) = g.resp_map.get(cid) {
                let label = cand.get("label").and_then(|v| v.as_str()).map(str::to_string);
                let route = cand.get("route").cloned();
                let prompt_id = cand.get("prompt_identity").and_then(|v| v.as_str()).map(str::to_string);
                let build_id = cand.get("build_identity").and_then(|v| v.as_str()).map(str::to_string);

                responses.push(CandidateResponseStatsDto {
                    candidate_id: cid.clone(),
                    label,
                    route,
                    prompt_identity: prompt_id,
                    build_identity: build_id,
                    total_observations: *obs,
                    ready_count: *ready,
                    failed_count: *failed,
                    missing_count: *missing,
                    unscored_count: *unscored,
                });
            }
        }

        let build_score_summary = |cand: &serde_json::Value, prov: &str, s: &ScoreStats| -> CandidateScoreSummaryDto {
            let cid = cand.get("candidate_id").and_then(|v| v.as_str()).unwrap_or("");
            let label = cand.get("label").and_then(|v| v.as_str()).map(str::to_string);
            let route = cand.get("route").cloned();
            let prompt_id = cand.get("prompt_identity").and_then(|v| v.as_str()).map(str::to_string);
            let build_id = cand.get("build_identity").and_then(|v| v.as_str()).map(str::to_string);

            let total_scored = s.full + s.partial;
            let avg = if s.full > 0 {
                Some(round2(s.avg_sum / s.full as f64))
            } else {
                None
            };
            let pass_rate = if s.full > 0 {
                Some(round4(s.pass_count as f64 / s.full as f64))
            } else {
                None
            };

            let mut dim_averages = HashMap::new();
            for (dim_id, (sum, count)) in &s.dim_sums {
                let avg = if *count > 0 {
                    Some(round2(sum / *count as f64))
                } else {
                    None
                };
                dim_averages.insert(dim_id.clone(), avg);
            }

            CandidateScoreSummaryDto {
                candidate_id: cid.to_string(),
                label,
                route,
                prompt_identity: prompt_id,
                build_identity: build_id,
                provenance: prov.to_string(),
                total_scored_observations: total_scored,
                full_score_count: s.full,
                partial_score_count: s.partial,
                average_score: avg,
                pass_rate,
                dimension_averages: dim_averages,
                issues: s.issues.clone(),
            }
        };

        let mut human_scores = Vec::new();
        let mut automated_scores = Vec::new();

        let mut score_cids: Vec<String> = g.score_map.keys().cloned().collect();
        score_cids.sort();

        for cid in &score_cids {
            if let Some((cand, human, automated)) = g.score_map.get(cid) {
                if human.full + human.partial > 0 {
                    human_scores.push(build_score_summary(cand, "human", human));
                }
                if automated.full + automated.partial > 0 {
                    automated_scores.push(build_score_summary(cand, "automated", automated));
                }
            }
        }

        result.push(EvaluationComparisonGroupDto {
            key: format!("{}:{}", g.rubric_digest, g.input_digest),
            rubric_digest: g.rubric_digest,
            input_digest: g.input_digest,
            cases: g.cases,
            responses,
            human_scores,
            automated_scores,
        });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aggregate_empty() {
        let groups = aggregate_evaluation_groups(&[]);
        assert!(groups.is_empty());
    }

    #[test]
    fn test_aggregate_single_doc() {
        let doc = serde_json::json!({
            "rubric_digest": "rubric123",
            "evaluation_id": "eval1",
            "run_id": "run1",
            "candidates": [
                {
                    "candidate_id": "c1",
                    "label": "Candidate 1",
                    "route": { "backend": "codex", "model": "gpt-5.6", "effort": "high" }
                }
            ],
            "cases": [
                {
                    "case_id": "case1",
                    "name": "Case 1",
                    "category": "cat1",
                    "input_digest": "input123",
                    "observations": [
                        {
                            "candidate_id": "c1",
                            "response": { "status": "ADVICE_READY" },
                            "score": {
                                "provenance": "automated",
                                "average_score": 0.85,
                                "passed": true,
                                "dimensions": [
                                    { "dimension_id": "d1", "score": 0.9 },
                                    { "dimension_id": "d2", "score": 0.8 }
                                ],
                                "issues": []
                            }
                        }
                    ]
                }
            ]
        });

        let groups = aggregate_evaluation_groups(&[doc]);
        assert_eq!(groups.len(), 1);
        let g = &groups[0];
        assert_eq!(g.key, "rubric123:input123");
        assert_eq!(g.rubric_digest, "rubric123");
        assert_eq!(g.input_digest, "input123");
        assert_eq!(g.cases.len(), 1);
        assert_eq!(g.cases[0].case_id, "case1");

        assert_eq!(g.responses.len(), 1);
        assert_eq!(g.responses[0].candidate_id, "c1");
        assert_eq!(g.responses[0].total_observations, 1);
        assert_eq!(g.responses[0].ready_count, 1);

        assert_eq!(g.automated_scores.len(), 1);
        let score = &g.automated_scores[0];
        assert_eq!(score.candidate_id, "c1");
        assert_eq!(score.provenance, "automated");
        assert_eq!(score.average_score, Some(0.85));
        assert_eq!(score.pass_rate, Some(1.0));
        assert_eq!(score.dimension_averages.get("d1"), Some(&Some(0.9)));
    }
}
