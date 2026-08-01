use std::collections::HashMap;

use crate::telemetry::{
    queries::{AgentRootAggregate, AgentRunTreeNode, AgentTerminalAssociation},
    AgentLineageQuality, AgentRunSummary,
};

use super::dto::{
    DelegationState, SessionCoverage, SessionNodeDto, SessionSummaryDto, SessionTokens,
    TerminalReference,
};

pub(super) fn summary_dto(
    root: &AgentRunSummary,
    aggregate: &AgentRootAggregate,
    terminals: Vec<TerminalReference>,
) -> SessionSummaryDto {
    let main_total = token_total(&tokens_from_node(root));
    let tokens = tokens_from_aggregate(aggregate);
    let total = token_total(&tokens);
    SessionSummaryDto {
        id: root.run_id.clone(),
        started_at_utc_ms: root.started_at_utc_ms,
        ended_at_utc_ms: root.ended_at_utc_ms.unwrap_or(root.started_at_utc_ms),
        root_model: root.model.clone(),
        child_count: aggregate.child_count,
        tokens,
        main_token_share: match (main_total, total) {
            (Some(main), Some(total)) if total > 0 => Some(main as f64 / total as f64),
            _ => None,
        },
        delegation_state: delegation_state(aggregate.lineage_quality, aggregate.child_count),
        coverage: SessionCoverage {
            lineage: aggregate.lineage_quality,
            tokens: aggregate.token_quality,
            correlation: root.correlation_quality,
        },
        terminals,
    }
}

pub(super) fn group_terminals(
    associations: Vec<AgentTerminalAssociation>,
) -> HashMap<String, Vec<TerminalReference>> {
    let mut grouped = HashMap::<String, Vec<TerminalReference>>::new();
    for association in associations {
        let run_id = String::from(association.root_run_id.clone());
        let terminals = grouped.entry(run_id).or_default();
        if !terminals
            .iter()
            .any(|item| item.id == association.terminal_id)
        {
            terminals.push(terminal_reference(association));
        }
    }
    grouped
}

pub(super) fn node_dtos(nodes: &[AgentRunTreeNode]) -> Vec<SessionNodeDto> {
    nodes
        .iter()
        .map(|tree_node| {
            let node = &tree_node.summary;
            SessionNodeDto {
                id: node.run_id.clone(),
                parent_id: node.parent_run_id.clone(),
                role: node.role,
                depth: tree_node.depth,
                model: node.model.clone(),
                started_at_utc_ms: node.started_at_utc_ms,
                ended_at_utc_ms: node.ended_at_utc_ms,
                tokens: tokens_from_node(node),
                coverage: SessionCoverage {
                    lineage: node.lineage_quality,
                    tokens: node.token_quality,
                    correlation: node.correlation_quality,
                },
            }
        })
        .collect()
}

fn tokens_from_node(node: &AgentRunSummary) -> SessionTokens {
    SessionTokens {
        input_tokens: node.input_tokens,
        cached_input_tokens: node.cached_input_tokens,
        output_tokens: node.output_tokens,
        reasoning_tokens: node.reasoning_tokens,
    }
}

fn tokens_from_aggregate(aggregate: &AgentRootAggregate) -> SessionTokens {
    SessionTokens {
        input_tokens: aggregate.input_tokens,
        cached_input_tokens: aggregate.cached_input_tokens,
        output_tokens: aggregate.output_tokens,
        reasoning_tokens: aggregate.reasoning_tokens,
    }
}

fn token_total(tokens: &SessionTokens) -> Option<u64> {
    let values = [
        tokens.input_tokens,
        tokens.cached_input_tokens,
        tokens.output_tokens,
        tokens.reasoning_tokens,
    ];
    values.iter().any(Option::is_some).then(|| {
        values
            .into_iter()
            .flatten()
            .fold(0_u64, u64::saturating_add)
    })
}

fn delegation_state(lineage: AgentLineageQuality, child_count: u32) -> DelegationState {
    match lineage {
        AgentLineageQuality::LineageUnavailable => DelegationState::LineageUnavailable,
        AgentLineageQuality::Partial => DelegationState::Partial,
        AgentLineageQuality::Exact if child_count > 0 => DelegationState::Delegated,
        AgentLineageQuality::Exact => DelegationState::NotDelegated,
    }
}

fn terminal_reference(association: AgentTerminalAssociation) -> TerminalReference {
    let id = String::from(association.terminal_id.clone());
    let project = association.project.clone().map(String::from);
    let label = format!(
        "{} · {} · {}",
        project.as_deref().unwrap_or("Unknown project"),
        association.started_at_utc_ms,
        &id[..8]
    );
    TerminalReference {
        id: association.terminal_id,
        label,
        project,
        started_at_utc_ms: association.started_at_utc_ms,
        first_seen_at_utc_ms: association.first_seen_at_utc_ms,
        last_seen_at_utc_ms: association.last_seen_at_utc_ms,
    }
}
