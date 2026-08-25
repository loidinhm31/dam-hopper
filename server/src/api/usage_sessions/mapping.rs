use crate::telemetry::{
    queries::{AgentExecutorAggregate, AgentRootAggregate, MAX_SESSION_MODELS},
    AgentRunSummary,
};

use super::dto::{ExecutorModelDto, SessionSummaryDto, SessionTokens};

pub(super) fn summary_dto(
    root: &AgentRunSummary,
    aggregate: &AgentRootAggregate,
    models: Vec<ExecutorModelDto>,
) -> SessionSummaryDto {
    SessionSummaryDto {
        id: root.run_id.clone(),
        started_at_utc_ms: root.started_at_utc_ms,
        ended_at_utc_ms: root.ended_at_utc_ms,
        model: root.model.clone(),
        tokens: tokens_from_aggregate(aggregate),
        models,
    }
}

pub(super) fn executor_model_dtos(
    aggregates: Vec<AgentExecutorAggregate>,
) -> Vec<ExecutorModelDto> {
    aggregates
        .into_iter()
        .take(MAX_SESSION_MODELS)
        .map(|aggregate| ExecutorModelDto {
            model: aggregate.model,
            response_count: aggregate.response_count,
            tokens: SessionTokens {
                input_tokens: aggregate.input_tokens,
                cached_input_tokens: aggregate.cached_input_tokens,
                output_tokens: aggregate.output_tokens,
                reasoning_tokens: aggregate.reasoning_tokens,
                response_count: aggregate.response_count,
                duration_ms: aggregate.duration_ms_sum,
            },
        })
        .collect()
}

fn tokens_from_aggregate(aggregate: &AgentRootAggregate) -> SessionTokens {
    SessionTokens {
        input_tokens: aggregate.input_tokens,
        cached_input_tokens: aggregate.cached_input_tokens,
        output_tokens: aggregate.output_tokens,
        reasoning_tokens: aggregate.reasoning_tokens,
        response_count: aggregate.response_count,
        duration_ms: aggregate.duration_ms_sum,
    }
}
