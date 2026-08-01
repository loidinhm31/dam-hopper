use serde::Serialize;

use crate::telemetry::{
    privacy::HmacDigest, AgentLineageQuality, AgentRole, AgentTokenQuality, CodexModel,
    CorrelationQuality,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionListResponse {
    pub(super) range: SessionRange,
    pub(super) sessions: Vec<SessionSummaryDto>,
    pub(super) next_cursor: Option<String>,
    pub(super) paused: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionDetailResponse {
    pub(super) session: SessionSummaryDto,
    pub(super) nodes: Vec<SessionNodeDto>,
    pub(super) truncated: bool,
    pub(super) max_nodes: usize,
    pub(super) max_depth: u16,
    pub(super) paused: bool,
}

#[derive(Serialize)]
pub(super) struct SessionRange {
    pub(super) from: i64,
    pub(super) to: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionSummaryDto {
    pub(super) id: HmacDigest,
    pub(super) started_at_utc_ms: i64,
    pub(super) ended_at_utc_ms: i64,
    pub(super) root_model: Option<CodexModel>,
    pub(super) child_count: u32,
    pub(super) tokens: SessionTokens,
    pub(super) main_token_share: Option<f64>,
    pub(super) delegation_state: DelegationState,
    pub(super) coverage: SessionCoverage,
    pub(super) terminals: Vec<TerminalReference>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionNodeDto {
    pub(super) id: HmacDigest,
    pub(super) parent_id: Option<HmacDigest>,
    pub(super) role: AgentRole,
    pub(super) depth: u16,
    pub(super) model: Option<CodexModel>,
    pub(super) started_at_utc_ms: i64,
    pub(super) ended_at_utc_ms: Option<i64>,
    pub(super) tokens: SessionTokens,
    pub(super) coverage: SessionCoverage,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum DelegationState {
    Delegated,
    NotDelegated,
    Partial,
    LineageUnavailable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionCoverage {
    pub(super) lineage: AgentLineageQuality,
    pub(super) tokens: AgentTokenQuality,
    pub(super) correlation: CorrelationQuality,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionTokens {
    pub(super) input_tokens: Option<u64>,
    pub(super) cached_input_tokens: Option<u64>,
    pub(super) output_tokens: Option<u64>,
    pub(super) reasoning_tokens: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TerminalReference {
    pub(super) id: HmacDigest,
    pub(super) label: String,
    pub(super) project: Option<String>,
    pub(super) started_at_utc_ms: i64,
    pub(super) first_seen_at_utc_ms: i64,
    pub(super) last_seen_at_utc_ms: i64,
}
