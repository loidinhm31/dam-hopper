use serde::Serialize;

use crate::telemetry::{privacy::HmacDigest, CodexModel};

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
    pub(super) ended_at_utc_ms: Option<i64>,
    pub(super) model: Option<CodexModel>,
    pub(super) tokens: SessionTokens,
    pub(super) models: Vec<ExecutorModelDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecutorModelDto {
    pub(super) model: Option<CodexModel>,
    pub(super) response_count: u64,
    pub(super) tokens: SessionTokens,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SessionTokens {
    pub(super) input_tokens: Option<u64>,
    pub(super) cached_input_tokens: Option<u64>,
    pub(super) output_tokens: Option<u64>,
    pub(super) reasoning_tokens: Option<u64>,
    pub(super) response_count: u64,
    pub(super) duration_ms: Option<u64>,
}
