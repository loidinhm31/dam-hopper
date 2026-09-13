use std::collections::{BTreeMap, BTreeSet};

use super::model::{
    CorrelatedRecordRefV1, CorrelationChainV1, CorrelationsV1, ProjectedHelperAudit,
    ProjectedServerAudit, ProjectedServerEvent, RestartBoundaryV1, SequenceGapV1,
};

fn record_sort_key<'a>(
    r: &'a CorrelatedRecordRefV1,
) -> (u64, &'a str, u64, &'a str, usize) {
    (
        r.timestamp_ms,
        r.producer_instance_id.as_deref().unwrap_or(""),
        r.producer_sequence.unwrap_or(0),
        r.source.as_str(),
        r.source_offset,
    )
}

pub fn analyze_correlations(
    server_events: &[ProjectedServerEvent],
    server_audits: &[ProjectedServerAudit],
    helper_audits: &[ProjectedHelperAudit],
) -> CorrelationsV1 {
    let mut all_records: Vec<CorrelatedRecordRefV1> = Vec::new();

    // 1. Ingest server events
    for (idx, ev) in server_events.iter().enumerate() {
        all_records.push(CorrelatedRecordRefV1 {
            source: "serverEvents".to_string(),
            source_offset: idx + 1,
            timestamp_ms: ev.timestamp_ms,
            producer_instance_id: Some(ev.producer_instance_id.clone()),
            producer_sequence: Some(ev.producer_sequence),
            event_type_or_record_type: ev.event_type.clone(),
            correlation_id: ev.correlation_id.clone(),
        });
    }

    // 2. Ingest server audits
    for (idx, audit) in server_audits.iter().enumerate() {
        all_records.push(CorrelatedRecordRefV1 {
            source: "serverAudit".to_string(),
            source_offset: idx + 1,
            timestamp_ms: audit.timestamp_ms,
            producer_instance_id: None,
            producer_sequence: None,
            event_type_or_record_type: audit.action.clone(),
            correlation_id: audit.correlation_id.clone(),
        });
    }

    // 3. Ingest helper audits
    for (idx, helper) in helper_audits.iter().enumerate() {
        all_records.push(CorrelatedRecordRefV1 {
            source: "helperAudit".to_string(),
            source_offset: idx + 1,
            timestamp_ms: helper.timestamp_ms,
            producer_instance_id: helper.producer_instance_id.clone(),
            producer_sequence: helper.producer_sequence,
            event_type_or_record_type: helper.record_type.clone(),
            correlation_id: helper.request_id.clone(),
        });
    }

    // Sort deterministically
    all_records.sort_by(|a, b| record_sort_key(a).cmp(&record_sort_key(b)));

    // 4. Detect sequence gaps per (bootId, producerInstanceId)
    let mut sequence_gaps: Vec<SequenceGapV1> = Vec::new();
    let mut last_seq_by_producer: BTreeMap<(Option<String>, String), u64> = BTreeMap::new();

    for ev in server_events {
        let key = (Some(ev.boot_id.clone()), ev.producer_instance_id.clone());
        if let Some(&prev_seq) = last_seq_by_producer.get(&key) {
            if ev.producer_sequence == prev_seq {
                sequence_gaps.push(SequenceGapV1 {
                    producer_instance_id: ev.producer_instance_id.clone(),
                    boot_id: Some(ev.boot_id.clone()),
                    expected_sequence: prev_seq + 1,
                    actual_sequence: ev.producer_sequence,
                    gap_size: 0,
                });
            } else if ev.producer_sequence > prev_seq + 1 {
                sequence_gaps.push(SequenceGapV1 {
                    producer_instance_id: ev.producer_instance_id.clone(),
                    boot_id: Some(ev.boot_id.clone()),
                    expected_sequence: prev_seq + 1,
                    actual_sequence: ev.producer_sequence,
                    gap_size: ev.producer_sequence - prev_seq - 1,
                });
            }
        }
        last_seq_by_producer.insert(key, ev.producer_sequence);
    }

    for helper in helper_audits {
        if let (Some(ref prod_id), Some(seq)) = (&helper.producer_instance_id, helper.producer_sequence) {
            let key = (helper.boot_id.clone(), prod_id.clone());
            if let Some(&prev_seq) = last_seq_by_producer.get(&key) {
                if seq == prev_seq {
                    sequence_gaps.push(SequenceGapV1 {
                        producer_instance_id: prod_id.clone(),
                        boot_id: helper.boot_id.clone(),
                        expected_sequence: prev_seq + 1,
                        actual_sequence: seq,
                        gap_size: 0,
                    });
                } else if seq > prev_seq + 1 {
                    sequence_gaps.push(SequenceGapV1 {
                        producer_instance_id: prod_id.clone(),
                        boot_id: helper.boot_id.clone(),
                        expected_sequence: prev_seq + 1,
                        actual_sequence: seq,
                        gap_size: seq - prev_seq - 1,
                    });
                }
            }
            last_seq_by_producer.insert(key, seq);
        }
    }

    // 5. Detect restart boundaries
    let mut restart_boundaries: Vec<RestartBoundaryV1> = Vec::new();
    let mut active_attempts: BTreeSet<String> = BTreeSet::new();
    let mut known_producer_instances: BTreeSet<String> = BTreeSet::new();

    for record in &all_records {
        if record.event_type_or_record_type == "coordinatorStarted" {
            if let Some(ref prod_id) = record.producer_instance_id {
                if !known_producer_instances.is_empty() && !known_producer_instances.contains(prod_id) {
                    // A new coordinator started with different producer_instance_id!
                    let unclosed: Vec<String> = active_attempts.iter().cloned().collect();
                    restart_boundaries.push(RestartBoundaryV1 {
                        timestamp_ms: record.timestamp_ms,
                        producer_instance_id: prod_id.clone(),
                        boot_id: server_events.iter().find(|ev| &ev.producer_instance_id == prod_id).map(|ev| ev.boot_id.clone()),
                        unclosed_attempt_ids: unclosed,
                    });
                    active_attempts.clear();
                }
                known_producer_instances.insert(prod_id.clone());
            }
        }

        if let Some(ref corr_id) = record.correlation_id {
            if record.event_type_or_record_type == "attemptStarted" {
                active_attempts.insert(corr_id.clone());
            } else if is_terminal_event(&record.event_type_or_record_type) {
                active_attempts.remove(corr_id);
            }
        }
    }

    // 6. Group into correlation chains and orphans
    let mut records_by_correlation: BTreeMap<String, Vec<CorrelatedRecordRefV1>> = BTreeMap::new();
    let mut orphans: Vec<CorrelatedRecordRefV1> = Vec::new();

    for record in all_records {
        if let Some(ref corr_id) = record.correlation_id {
            records_by_correlation
                .entry(corr_id.clone())
                .or_default()
                .push(record);
        }
    }

    let mut chains: Vec<CorrelationChainV1> = Vec::new();

    for (corr_id, mut recs) in records_by_correlation {
        recs.sort_by(|a, b| record_sort_key(a).cmp(&record_sort_key(b)));

        let has_attempt_started = recs
            .iter()
            .any(|r| r.event_type_or_record_type == "attemptStarted");

        // If records have correlation_id but no attemptStarted was ever seen,
        // and there's only 1 record or only helper records without coordinator attempt,
        // classify as orphans if it doesn't represent a coherent attempt chain
        if !has_attempt_started {
            orphans.extend(recs);
            continue;
        }

        let started_at_ms = recs
            .iter()
            .find(|r| r.event_type_or_record_type == "attemptStarted")
            .map(|r| r.timestamp_ms)
            .or_else(|| recs.first().map(|r| r.timestamp_ms));

        let mut terminal_reason_code: Option<String> = None;
        let mut outcome_code: Option<String> = None;
        let mut ended_at_ms: Option<u64> = None;
        let mut is_open = true;

        for r in &recs {
            if is_terminal_event(&r.event_type_or_record_type) {
                is_open = false;
                ended_at_ms = Some(r.timestamp_ms);
            }
            if r.event_type_or_record_type == "terminalRejected"
                || r.event_type_or_record_type == "armCancelled"
            {
                terminal_reason_code = extract_reason_code_for_record(server_events, r);
            }
            if r.event_type_or_record_type == "helperOutcomeReceived"
                || r.event_type_or_record_type == "reconciliationCompleted"
                || r.event_type_or_record_type == "executionCompleted"
                || r.event_type_or_record_type == "executionRejected"
            {
                outcome_code = extract_outcome_code_for_record(server_events, helper_audits, r);
            }
        }

        let mode = recs
            .iter()
            .find_map(|r| {
                if r.source == "serverEvents" {
                    server_events
                        .get(r.source_offset - 1)
                        .and_then(|ev| ev.mode.clone())
                } else {
                    None
                }
            });

        chains.push(CorrelationChainV1 {
            correlation_id: corr_id,
            mode,
            started_at_ms,
            ended_at_ms,
            terminal_reason_code,
            outcome_code,
            is_open,
            record_count: recs.len(),
            records: recs,
        });
    }

    // Sort chains by started_at_ms
    chains.sort_by_key(|c| c.started_at_ms.unwrap_or(0));

    CorrelationsV1 {
        chains,
        orphans,
        sequence_gaps,
        restart_boundaries,
    }
}

fn is_terminal_event(event_or_record_type: &str) -> bool {
    matches!(
        event_or_record_type,
        "terminalRejected"
            | "reconciliationCompleted"
            | "armCancelled"
            | "executionCompleted"
            | "executionRejected"
    )
}

fn extract_reason_code_for_record(
    server_events: &[ProjectedServerEvent],
    r: &CorrelatedRecordRefV1,
) -> Option<String> {
    if r.source == "serverEvents" {
        if let Some(ev) = server_events.get(r.source_offset.saturating_sub(1)) {
            if let Some(code) = ev.data.get("reasonCode").and_then(|v| v.as_str()) {
                return Some(code.to_string());
            }
        }
    }
    None
}

fn extract_outcome_code_for_record(
    server_events: &[ProjectedServerEvent],
    helper_audits: &[ProjectedHelperAudit],
    r: &CorrelatedRecordRefV1,
) -> Option<String> {
    if r.source == "serverEvents" {
        if let Some(ev) = server_events.get(r.source_offset.saturating_sub(1)) {
            if let Some(code) = ev.data.get("reasonCode").and_then(|v| v.as_str()) {
                return Some(code.to_string());
            }
        }
    } else if r.source == "helperAudit" {
        if let Some(helper) = helper_audits.get(r.source_offset.saturating_sub(1)) {
            if let Some(ref code) = helper.outcome_code {
                return Some(code.clone());
            }
            if let Some(ref code) = helper.detail_code {
                return Some(code.clone());
            }
        }
    }
    None
}
