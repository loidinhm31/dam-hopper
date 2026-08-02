use std::collections::BTreeMap;

use rusqlite::{params, params_from_iter, types::Value};
use serde::Serialize;

use super::{
    store::{TelemetryStore, TelemetryStoreError},
    types::{
        AgentLineageQuality, AgentRole, AgentRunSummary, AgentTokenQuality, CodexModel,
        CorrelationQuality, SafeIdentifier, TokenCounterSemantic, UsageQuery,
    },
};

const MAX_AGENT_RUN_PAGE: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRunCursor {
    pub ended_at_utc_ms: i64,
    pub run_id: super::privacy::HmacDigest,
}

#[derive(Clone, Debug, Default)]
pub struct AgentRunListQuery {
    pub from_utc_ms: i64,
    pub to_utc_ms: i64,
    pub model: Option<CodexModel>,
    pub terminal: Option<super::privacy::HmacDigest>,
    pub cursor: Option<AgentRunCursor>,
    pub limit: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentTerminalAssociation {
    pub root_run_id: super::privacy::HmacDigest,
    pub terminal_id: super::privacy::HmacDigest,
    pub project: Option<SafeIdentifier>,
    pub started_at_utc_ms: i64,
    pub first_seen_at_utc_ms: i64,
    pub last_seen_at_utc_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRunTreeNode {
    pub summary: AgentRunSummary,
    pub depth: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRootAggregate {
    pub root_run_id: super::privacy::HmacDigest,
    pub child_count: u32,
    pub lineage_quality: AgentLineageQuality,
    pub token_quality: AgentTokenQuality,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub response_count: u64,
    pub duration_ms_sum: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentExecutorAggregate {
    pub model: Option<CodexModel>,
    pub response_count: u64,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub duration_ms_sum: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAggregate {
    pub command_count: u64,
    pub succeeded_count: u64,
    pub failed_count: u64,
    pub interrupted_count: u64,
    pub unknown_count: u64,
    pub duration_ms_sum: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenAggregate {
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub response_count: u64,
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationCoverage {
    pub exact: u64,
    pub approximate: u64,
    pub unattributed: u64,
}

/// One privacy-safe UTC bucket. The bucket contains only aggregate counts and
/// nullable token totals; it can never identify an individual command or turn.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTimeBucket {
    pub start_utc_ms: i64,
    pub terminal: UsageAggregate,
    pub codex: Option<TokenAggregate>,
}

/// Aggregate for a low-cardinality, allowlisted dimension such as project or
/// command category. The value is a configured project name or classifier
/// category, never an executable or command argument.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDimensionAggregate {
    pub name: String,
    pub terminal: UsageAggregate,
}

/// Detail-window-only metrics. Daily rollups intentionally omit fingerprints
/// and duration distributions, so these fields are absent for mixed/history
/// ranges instead of being guessed from totals.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailUsageMetrics {
    pub duration_p50_ms: Option<u64>,
    pub duration_p95_ms: Option<u64>,
    pub repeated_command_count: u64,
}

pub fn list_agent_run_summaries(
    store: &TelemetryStore,
    limit: usize,
) -> Result<Vec<AgentRunSummary>, TelemetryStoreError> {
    let limit = limit.clamp(1, MAX_AGENT_RUN_PAGE) as i64;
    let connection = store.open_read()?;
    let mut statement = connection.prepare(
        "SELECT r.run_id, r.root_run_id, r.parent_run_id, r.provider, r.role, r.model, r.source_version, r.started_at_utc_ms, r.ended_at_utc_ms, r.status, r.correlation_quality, r.lineage_quality, r.token_quality, r.counter_semantic, r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_tokens, r.response_count, r.duration_ms_sum, (SELECT count(*) FROM agent_run_terminals t WHERE t.run_id = r.run_id), r.updated_at_utc_ms
         FROM agent_runs r INDEXED BY idx_agent_runs_ended_run
         WHERE r.root_run_id IS NOT NULL
         ORDER BY r.ended_at_utc_ms DESC, r.run_id DESC LIMIT ?1",
    )?;
    let rows = statement.query_map([limit], agent_run_from_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

/// Return completed root summaries in stable cursor order. The caller requests
/// one extra row to determine whether another page exists.
pub fn list_agent_run_roots(
    store: &TelemetryStore,
    query: &AgentRunListQuery,
) -> Result<Vec<AgentRunSummary>, TelemetryStoreError> {
    let limit = query
        .limit
        .saturating_add(1)
        .clamp(1, MAX_AGENT_RUN_PAGE + 1) as i64;
    let connection = store.open_read()?;
    let mut sql = String::from(
        "SELECT r.run_id, r.root_run_id, r.parent_run_id, r.provider, r.role, r.model, r.source_version, r.started_at_utc_ms, r.ended_at_utc_ms, r.status, r.correlation_quality, r.lineage_quality, r.token_quality, r.counter_semantic, r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_tokens, r.response_count, r.duration_ms_sum, (SELECT count(*) FROM agent_run_terminals t WHERE t.run_id = r.run_id), r.updated_at_utc_ms
         FROM agent_runs r INDEXED BY idx_agent_runs_parent_ended
         WHERE r.run_id = r.root_run_id AND r.parent_run_id IS NULL
           AND r.ended_at_utc_ms IS NOT NULL
           AND r.started_at_utc_ms < ? AND r.ended_at_utc_ms >= ?",
    );
    let mut values: Vec<Value> = vec![query.to_utc_ms.into(), query.from_utc_ms.into()];
    if let Some(model) = &query.model {
        sql.push_str(" AND (r.model = ? OR EXISTS (SELECT 1 FROM agent_usage_events e WHERE e.conversation_fingerprint = r.run_id AND e.model = ?))");
        let model = String::from(model.clone());
        values.push(model.clone().into());
        values.push(model.into());
    }
    if let Some(terminal) = &query.terminal {
        sql.push_str(" AND EXISTS (SELECT 1 FROM agent_runs n JOIN agent_run_terminals t ON t.run_id = n.run_id WHERE n.root_run_id = r.run_id AND t.terminal_fingerprint = ?)");
        values.push(String::from(terminal.clone()).into());
    }
    if let Some(cursor) = &query.cursor {
        sql.push_str(" AND (r.ended_at_utc_ms < ? OR (r.ended_at_utc_ms = ? AND r.run_id < ?))");
        values.push(cursor.ended_at_utc_ms.into());
        values.push(cursor.ended_at_utc_ms.into());
        values.push(String::from(cursor.run_id.clone()).into());
    }
    sql.push_str(" ORDER BY r.ended_at_utc_ms DESC, r.run_id DESC LIMIT ?");
    values.push(limit.into());
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), agent_run_from_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

/// Load every node for the selected roots with one bounded query.
pub fn agent_run_nodes_for_roots(
    store: &TelemetryStore,
    root_ids: &[super::privacy::HmacDigest],
    max_nodes: usize,
) -> Result<Vec<AgentRunSummary>, TelemetryStoreError> {
    if root_ids.is_empty() || max_nodes == 0 {
        return Ok(Vec::new());
    }
    let connection = store.open_read()?;
    let placeholders = std::iter::repeat_n("?", root_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT r.run_id, r.root_run_id, r.parent_run_id, r.provider, r.role, r.model, r.source_version, r.started_at_utc_ms, r.ended_at_utc_ms, r.status, r.correlation_quality, r.lineage_quality, r.token_quality, r.counter_semantic, r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_tokens, r.response_count, r.duration_ms_sum, (SELECT count(*) FROM agent_run_terminals t WHERE t.run_id = r.run_id), r.updated_at_utc_ms
         FROM agent_runs r WHERE r.root_run_id IN ({placeholders})
         ORDER BY r.root_run_id, r.started_at_utc_ms, r.run_id LIMIT ?"
    );
    let mut values = root_ids
        .iter()
        .cloned()
        .map(String::from)
        .map(Value::from)
        .collect::<Vec<_>>();
    values.push((max_nodes.min(i64::MAX as usize) as i64).into());
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), agent_run_from_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

/// Aggregate descendants for a page of roots with one grouped query.
pub fn agent_root_aggregates(
    store: &TelemetryStore,
    root_ids: &[super::privacy::HmacDigest],
) -> Result<Vec<AgentRootAggregate>, TelemetryStoreError> {
    if root_ids.is_empty() {
        return Ok(Vec::new());
    }
    let connection = store.open_read()?;
    let placeholders = std::iter::repeat_n("?", root_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT root_run_id, max(count(*) - 1, 0),
            CASE WHEN sum(lineage_quality = 'lineage_unavailable') > 0 THEN 'lineage_unavailable'
                 WHEN sum(lineage_quality = 'partial') > 0 THEN 'partial' ELSE 'exact' END,
            CASE WHEN sum(token_quality = 'token_data_unavailable') > 0 THEN 'token_data_unavailable'
                 WHEN sum(token_quality = 'partial') > 0 THEN 'partial' ELSE 'exact' END,
            CASE WHEN count(input_tokens) > 0 THEN sum(input_tokens) END,
            CASE WHEN count(cached_input_tokens) > 0 THEN sum(cached_input_tokens) END,
            CASE WHEN count(output_tokens) > 0 THEN sum(output_tokens) END,
            CASE WHEN count(reasoning_tokens) > 0 THEN sum(reasoning_tokens) END,
            coalesce(sum(response_count), 0),
            CASE WHEN count(duration_ms_sum) > 0 THEN sum(duration_ms_sum) END
         FROM agent_runs INDEXED BY idx_agent_runs_root_aggregate
         WHERE root_run_id IN ({placeholders}) GROUP BY root_run_id"
    );
    let values = root_ids
        .iter()
        .cloned()
        .map(String::from)
        .map(Value::from)
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        let lineage_quality = match row.get::<_, String>(2)?.as_str() {
            "exact" => AgentLineageQuality::Exact,
            "partial" => AgentLineageQuality::Partial,
            "lineage_unavailable" => AgentLineageQuality::LineageUnavailable,
            _ => return Err(rusqlite::Error::InvalidQuery),
        };
        let token_quality = match row.get::<_, String>(3)?.as_str() {
            "exact" => AgentTokenQuality::Exact,
            "partial" => AgentTokenQuality::Partial,
            "token_data_unavailable" => AgentTokenQuality::TokenDataUnavailable,
            _ => return Err(rusqlite::Error::InvalidQuery),
        };
        Ok(AgentRootAggregate {
            root_run_id: row
                .get::<_, String>(0)?
                .try_into()
                .map_err(|_| rusqlite::Error::InvalidQuery)?,
            child_count: row.get::<_, i64>(1)? as u32,
            lineage_quality,
            token_quality,
            input_tokens: row.get::<_, Option<i64>>(4)?.map(|value| value as u64),
            cached_input_tokens: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
            output_tokens: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
            reasoning_tokens: row.get::<_, Option<i64>>(7)?.map(|value| value as u64),
            response_count: row.get::<_, i64>(8)? as u64,
            duration_ms_sum: row.get::<_, Option<i64>>(9)?.map(|value| value as u64),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn agent_executor_aggregates(
    store: &TelemetryStore,
    root_id: &super::privacy::HmacDigest,
) -> Result<Vec<AgentExecutorAggregate>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut statement = connection.prepare(
        "SELECT model, count(*), sum(input_tokens), sum(cached_input_tokens), sum(output_tokens), sum(reasoning_tokens), sum(duration_ms)
         FROM agent_usage_events WHERE conversation_fingerprint = ?1 GROUP BY model ORDER BY model",
    )?;
    let rows = statement.query_map([String::from(root_id.clone())], |row| {
        let model = row
            .get::<_, Option<String>>(0)?
            .map(|value| CodexModel::new(value).map_err(|_| rusqlite::Error::InvalidQuery))
            .transpose()?;
        Ok(AgentExecutorAggregate {
            model,
            response_count: row.get::<_, i64>(1)? as u64,
            input_tokens: row.get::<_, Option<i64>>(2)?.map(|value| value as u64),
            cached_input_tokens: row.get::<_, Option<i64>>(3)?.map(|value| value as u64),
            output_tokens: row.get::<_, Option<i64>>(4)?.map(|value| value as u64),
            reasoning_tokens: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
            duration_ms_sum: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

/// Load the observed model breakdown for a bounded page of conversation roots
/// in one query. Raw usage events are the source of truth here because a root
/// summary deliberately has no single model after a model switch.
pub fn agent_executor_aggregates_for_roots(
    store: &TelemetryStore,
    root_ids: &[super::privacy::HmacDigest],
) -> Result<Vec<(super::privacy::HmacDigest, AgentExecutorAggregate)>, TelemetryStoreError> {
    if root_ids.is_empty() {
        return Ok(Vec::new());
    }
    let connection = store.open_read()?;
    let placeholders = std::iter::repeat_n("?", root_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT conversation_fingerprint, model, count(*), sum(input_tokens), sum(cached_input_tokens), sum(output_tokens), sum(reasoning_tokens), sum(duration_ms)
         FROM agent_usage_events WHERE conversation_fingerprint IN ({placeholders})
         GROUP BY conversation_fingerprint, model ORDER BY conversation_fingerprint, model"
    );
    let values = root_ids
        .iter()
        .cloned()
        .map(String::from)
        .map(Value::from)
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        let root_id = row
            .get::<_, String>(0)?
            .try_into()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let model = row
            .get::<_, Option<String>>(1)?
            .map(|value| CodexModel::new(value).map_err(|_| rusqlite::Error::InvalidQuery))
            .transpose()?;
        Ok((
            root_id,
            AgentExecutorAggregate {
                model,
                response_count: row.get::<_, i64>(2)? as u64,
                input_tokens: row.get::<_, Option<i64>>(3)?.map(|value| value as u64),
                cached_input_tokens: row.get::<_, Option<i64>>(4)?.map(|value| value as u64),
                output_tokens: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                reasoning_tokens: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
                duration_ms_sum: row.get::<_, Option<i64>>(7)?.map(|value| value as u64),
            },
        ))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn agent_run_tree(
    store: &TelemetryStore,
    root_id: &super::privacy::HmacDigest,
    max_depth: u16,
    max_nodes: usize,
) -> Result<Vec<AgentRunTreeNode>, TelemetryStoreError> {
    use rusqlite::OptionalExtension;

    if max_nodes == 0 {
        return Ok(Vec::new());
    }
    let connection = store.open_read()?;
    let root = connection
        .query_row(
            "SELECT r.run_id, r.root_run_id, r.parent_run_id, r.provider, r.role, r.model, r.source_version, r.started_at_utc_ms, r.ended_at_utc_ms, r.status, r.correlation_quality, r.lineage_quality, r.token_quality, r.counter_semantic, r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_tokens, r.response_count, r.duration_ms_sum, (SELECT count(*) FROM agent_run_terminals t WHERE t.run_id = r.run_id), r.updated_at_utc_ms
             FROM agent_runs r
             WHERE r.run_id = ?1 AND r.root_run_id = ?1 AND r.parent_run_id IS NULL",
            [String::from(root_id.clone())],
            agent_run_from_row,
        )
        .optional()?;
    let Some(root) = root else {
        return Ok(Vec::new());
    };

    // Breadth-first frontier queries keep both returned rows and database work
    // bounded. The extra node/depth are probes used to report truncation.
    let probe_limit = max_nodes.saturating_add(1);
    let mut frontier = vec![String::from(root.run_id.clone())];
    let mut nodes = vec![AgentRunTreeNode {
        summary: root,
        depth: 0,
    }];
    for depth in 1..=max_depth.saturating_add(1) {
        let remaining = probe_limit.saturating_sub(nodes.len());
        if remaining == 0 || frontier.is_empty() {
            break;
        }
        let placeholders = std::iter::repeat_n("?", frontier.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT c.run_id, c.root_run_id, c.parent_run_id, c.provider, c.role, c.model, c.source_version, c.started_at_utc_ms, c.ended_at_utc_ms, c.status, c.correlation_quality, c.lineage_quality, c.token_quality, c.counter_semantic, c.input_tokens, c.cached_input_tokens, c.output_tokens, c.reasoning_tokens, c.response_count, c.duration_ms_sum, (SELECT count(*) FROM agent_run_terminals t WHERE t.run_id = c.run_id), c.updated_at_utc_ms
             FROM agent_runs c
             WHERE c.root_run_id = ? AND c.parent_run_id IN ({placeholders})
             ORDER BY c.started_at_utc_ms, c.run_id LIMIT ?"
        );
        let mut values = Vec::with_capacity(frontier.len() + 2);
        values.push(Value::from(String::from(root_id.clone())));
        values.extend(frontier.into_iter().map(Value::from));
        values.push(Value::from(remaining.min(i64::MAX as usize) as i64));
        let mut statement = connection.prepare(&sql)?;
        let summaries = statement
            .query_map(params_from_iter(values.iter()), agent_run_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        frontier = summaries
            .iter()
            .map(|summary| String::from(summary.run_id.clone()))
            .collect();
        nodes.extend(
            summaries
                .into_iter()
                .map(|summary| AgentRunTreeNode { summary, depth }),
        );
    }
    Ok(nodes)
}

/// Resolve safe terminal labels without exposing the raw terminal UUID. This
/// uses two bounded reads and HMAC matching in memory; it never reverses or
/// serializes the persisted association fingerprint.
pub fn agent_terminal_associations(
    store: &TelemetryStore,
    root_ids: &[super::privacy::HmacDigest],
) -> Result<Vec<AgentTerminalAssociation>, TelemetryStoreError> {
    if root_ids.is_empty() {
        return Ok(Vec::new());
    }
    let connection = store.open_read()?;
    let placeholders = std::iter::repeat_n("?", root_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT n.root_run_id, t.terminal_fingerprint, tr.project,
                coalesce(tr.started_at_utc_ms, min(t.first_seen_at_utc_ms)),
                min(t.first_seen_at_utc_ms), max(t.last_seen_at_utc_ms)
         FROM agent_run_terminals t INDEXED BY idx_agent_run_terminals_run_bounds
         JOIN agent_runs n ON n.run_id = t.run_id
         LEFT JOIN terminal_runs tr ON tr.terminal_fingerprint = t.terminal_fingerprint
         WHERE n.root_run_id IN ({placeholders})
         GROUP BY n.root_run_id, t.terminal_fingerprint, tr.project, tr.started_at_utc_ms
         ORDER BY n.root_run_id, min(t.first_seen_at_utc_ms), t.terminal_fingerprint"
    );
    let values = root_ids
        .iter()
        .cloned()
        .map(String::from)
        .map(Value::from)
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        let root_run_id = row
            .get::<_, String>(0)?
            .try_into()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        let terminal_id = row
            .get::<_, String>(1)?
            .try_into()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        Ok(AgentTerminalAssociation {
            root_run_id,
            terminal_id,
            project: row
                .get::<_, Option<String>>(2)?
                .map(SafeIdentifier::new)
                .transpose()
                .map_err(|_| rusqlite::Error::InvalidQuery)?,
            started_at_utc_ms: row.get(3)?,
            first_seen_at_utc_ms: row.get(4)?,
            last_seen_at_utc_ms: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn agent_run_summary(
    store: &TelemetryStore,
    run_id: &super::privacy::HmacDigest,
) -> Result<Option<AgentRunSummary>, TelemetryStoreError> {
    use rusqlite::OptionalExtension;

    let connection = store.open_read()?;
    connection
        .query_row(
            "SELECT r.run_id, r.root_run_id, r.parent_run_id, r.provider, r.role, r.model, r.source_version, r.started_at_utc_ms, r.ended_at_utc_ms, r.status, r.correlation_quality, r.lineage_quality, r.token_quality, r.counter_semantic, r.input_tokens, r.cached_input_tokens, r.output_tokens, r.reasoning_tokens, (SELECT count(*) FROM agent_run_terminals t WHERE t.run_id = r.run_id), r.updated_at_utc_ms
             FROM agent_runs r WHERE r.run_id = ?1 AND r.root_run_id IS NOT NULL",
            [String::from(run_id.clone())],
            agent_run_from_row,
        )
        .optional()
        .map_err(TelemetryStoreError::Sqlite)
}

fn agent_run_from_row(row: &rusqlite::Row<'_>) -> Result<AgentRunSummary, rusqlite::Error> {
    let parse_digest = |index| -> Result<super::privacy::HmacDigest, rusqlite::Error> {
        row.get::<_, String>(index)?
            .try_into()
            .map_err(|_| rusqlite::Error::InvalidQuery)
    };
    let parent = row
        .get::<_, Option<String>>(2)?
        .map(|value| value.try_into().map_err(|_| rusqlite::Error::InvalidQuery))
        .transpose()?;
    let model = row
        .get::<_, Option<String>>(5)?
        .map(|value| CodexModel::new(value).map_err(|_| rusqlite::Error::InvalidQuery))
        .transpose()?;
    Ok(AgentRunSummary {
        run_id: parse_digest(0)?,
        root_run_id: parse_digest(1)?,
        parent_run_id: parent,
        provider: SafeIdentifier::new(row.get::<_, String>(3)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        role: match row.get::<_, String>(4)?.as_str() {
            "root" => AgentRole::Root,
            "main" => AgentRole::Main,
            "subagent" => AgentRole::Subagent,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        model,
        source_version: match row.get::<_, String>(6)?.as_str() {
            "unknown" => super::types::CodexVersion::unknown(),
            value => {
                super::types::CodexVersion::new(value).map_err(|_| rusqlite::Error::InvalidQuery)?
            }
        },
        started_at_utc_ms: row.get(7)?,
        ended_at_utc_ms: row.get(8)?,
        status: SafeIdentifier::new(row.get::<_, String>(9)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        correlation_quality: match row.get::<_, String>(10)?.as_str() {
            "exact" => CorrelationQuality::Exact,
            "approximate" => CorrelationQuality::Approximate,
            "unattributed" => CorrelationQuality::Unattributed,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        lineage_quality: match row.get::<_, String>(11)?.as_str() {
            "exact" => AgentLineageQuality::Exact,
            "partial" => AgentLineageQuality::Partial,
            "lineage_unavailable" => AgentLineageQuality::LineageUnavailable,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        token_quality: match row.get::<_, String>(12)?.as_str() {
            "exact" => AgentTokenQuality::Exact,
            "partial" => AgentTokenQuality::Partial,
            "token_data_unavailable" => AgentTokenQuality::TokenDataUnavailable,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        counter_semantic: match row.get::<_, String>(13)?.as_str() {
            "delta" => TokenCounterSemantic::Delta,
            "cumulative" => TokenCounterSemantic::Cumulative,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        input_tokens: row.get::<_, Option<i64>>(14)?.map(|value| value as u64),
        cached_input_tokens: row.get::<_, Option<i64>>(15)?.map(|value| value as u64),
        output_tokens: row.get::<_, Option<i64>>(16)?.map(|value| value as u64),
        reasoning_tokens: row.get::<_, Option<i64>>(17)?.map(|value| value as u64),
        response_count: row.get::<_, i64>(18)? as u64,
        duration_ms_sum: row.get::<_, Option<i64>>(19)?.map(|value| value as u64),
        terminal_association_count: row.get::<_, i64>(20)? as u32,
        updated_at_utc_ms: row.get(21)?,
    })
}

pub fn aggregate_token_correlation(
    store: &TelemetryStore,
    query: &UsageQuery,
) -> Result<Option<CorrelationCoverage>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut sql = String::from("SELECT count(*), coalesce(sum(correlation_quality = 'exact'), 0), coalesce(sum(correlation_quality = 'approximate'), 0), coalesce(sum(correlation_quality = 'unattributed'), 0) FROM agent_usage_events WHERE 1 = 1");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND occurred_at_utc_ms >= ?");
        values.push(Box::new(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND occurred_at_utc_ms < ?");
        values.push(Box::new(to));
    }
    if let Some(model) = &query.model {
        sql.push_str(" AND model = ?");
        values.push(Box::new(String::from(model.clone())));
    }
    connection
        .query_row(
            &sql,
            params_from_iter(values.iter().map(|value| value.as_ref())),
            |row| {
                let count = row.get::<_, i64>(0)?;
                Ok((count > 0).then_some(CorrelationCoverage {
                    exact: row.get::<_, i64>(1)? as u64,
                    approximate: row.get::<_, i64>(2)? as u64,
                    unattributed: row.get::<_, i64>(3)? as u64,
                }))
            },
        )
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn aggregate_commands(
    store: &TelemetryStore,
    query: &UsageQuery,
) -> Result<UsageAggregate, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut sql = String::from("SELECT count(*), coalesce(sum(outcome = 'succeeded'), 0), coalesce(sum(outcome = 'failed'), 0), coalesce(sum(outcome = 'interrupted'), 0), coalesce(sum(outcome = 'unknown'), 0), coalesce(sum(duration_ms), 0) FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id WHERE 1 = 1");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND c.occurred_at_utc_ms >= ?");
        values.push(Box::new(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND c.occurred_at_utc_ms < ?");
        values.push(Box::new(to));
    }
    if let Some(project) = &query.project {
        sql.push_str(" AND r.project = ?");
        values.push(Box::new(project.as_str().to_string()));
    }
    if let Some(shell) = query.shell {
        sql.push_str(" AND r.shell = ?");
        values.push(Box::new(
            match shell {
                super::types::ShellKind::Bash => "bash",
                super::types::ShellKind::Zsh => "zsh",
                super::types::ShellKind::Fish => "fish",
            }
            .to_string(),
        ));
    }
    if let Some(quality) = query.capture_quality {
        sql.push_str(" AND c.capture_quality = ?");
        values.push(Box::new(capture_quality(quality).to_string()));
    }
    if let Some(category) = &query.category {
        sql.push_str(" AND c.category = ?");
        values.push(Box::new(category.as_str().to_string()));
    }
    let aggregate = connection.query_row(
        &sql,
        params_from_iter(values.iter().map(|value| value.as_ref())),
        |row| {
            Ok(UsageAggregate {
                command_count: row.get::<_, i64>(0)? as u64,
                succeeded_count: row.get::<_, i64>(1)? as u64,
                failed_count: row.get::<_, i64>(2)? as u64,
                interrupted_count: row.get::<_, i64>(3)? as u64,
                unknown_count: row.get::<_, i64>(4)? as u64,
                duration_ms_sum: row.get::<_, i64>(5)? as u64,
            })
        },
    )?;
    Ok(aggregate)
}

pub fn aggregate_tokens(
    store: &TelemetryStore,
    query: &UsageQuery,
) -> Result<Option<TokenAggregate>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut sql = String::from("SELECT count(*), sum(input_tokens), sum(cached_input_tokens), sum(output_tokens), sum(reasoning_tokens), sum(duration_ms) FROM agent_usage_events WHERE 1 = 1");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND occurred_at_utc_ms >= ?");
        values.push(Box::new(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND occurred_at_utc_ms < ?");
        values.push(Box::new(to));
    }
    if let Some(model) = &query.model {
        sql.push_str(" AND model = ?");
        values.push(Box::new(String::from(model.clone())));
    }
    let (count, aggregate) = connection.query_row(
        &sql,
        params_from_iter(values.iter().map(|value| value.as_ref())),
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                TokenAggregate {
                    input_tokens: row.get::<_, Option<i64>>(1)?.map(|value| value as u64),
                    cached_input_tokens: row.get::<_, Option<i64>>(2)?.map(|value| value as u64),
                    output_tokens: row.get::<_, Option<i64>>(3)?.map(|value| value as u64),
                    reasoning_tokens: row.get::<_, Option<i64>>(4)?.map(|value| value as u64),
                    response_count: row.get::<_, i64>(0)? as u64,
                    duration_ms: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                },
            ))
        },
    )?;
    Ok((count > 0).then_some(aggregate))
}

/// Summarize daily rollups strictly before the supplied UTC boundary. The
/// retention worker preserves the complete boundary day as detail, so this
/// range can be combined with `aggregate_commands` without overlap.
pub fn aggregate_command_rollups(
    store: &TelemetryStore,
    query: &UsageQuery,
    boundary_utc_ms: i64,
) -> Result<UsageAggregate, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut sql = String::from("SELECT coalesce(sum(command_count), 0), coalesce(sum(succeeded_count), 0), coalesce(sum(failed_count), 0), coalesce(sum(interrupted_count), 0), coalesce(sum(unknown_count), 0), coalesce(sum(duration_ms_sum), 0) FROM daily_usage_rollups WHERE utc_day < strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(boundary_utc_ms)];
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND utc_day >= strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Box::new(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Box::new(to));
    }
    if let Some(project) = &query.project {
        sql.push_str(" AND project = ?");
        values.push(Box::new(project.as_str().to_string()));
    }
    if let Some(shell) = query.shell {
        sql.push_str(" AND shell = ?");
        values.push(Box::new(shell_name(shell).to_string()));
    }
    if let Some(category) = &query.category {
        sql.push_str(" AND category = ?");
        values.push(Box::new(category.as_str().to_string()));
    }
    connection
        .query_row(
            &sql,
            params_from_iter(values.iter().map(|value| value.as_ref())),
            usage_from_row,
        )
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn aggregate_token_rollups(
    store: &TelemetryStore,
    query: &UsageQuery,
    boundary_utc_ms: i64,
) -> Result<Option<TokenAggregate>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut sql = String::from("SELECT CASE WHEN sum(input_tokens_count) > 0 THEN sum(input_tokens_sum) END, CASE WHEN sum(cached_input_tokens_count) > 0 THEN sum(cached_input_tokens_sum) END, CASE WHEN sum(output_tokens_count) > 0 THEN sum(output_tokens_sum) END, CASE WHEN sum(reasoning_tokens_count) > 0 THEN sum(reasoning_tokens_sum) END, coalesce(sum(agent_response_count), 0), CASE WHEN sum(agent_duration_ms_sum) > 0 THEN sum(agent_duration_ms_sum) END FROM daily_usage_rollups WHERE utc_day < strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')");
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(boundary_utc_ms)];
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND utc_day >= strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Box::new(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Box::new(to));
    }
    if let Some(model) = &query.model {
        sql.push_str(" AND model = ?");
        values.push(Box::new(String::from(model.clone())));
    }
    connection
        .query_row(
            &sql,
            params_from_iter(values.iter().map(|value| value.as_ref())),
            |row| {
                let total: i64 = row.get(4)?;
                Ok((total > 0).then_some(TokenAggregate {
                    input_tokens: row.get::<_, Option<i64>>(0)?.map(|value| value as u64),
                    cached_input_tokens: row.get::<_, Option<i64>>(1)?.map(|value| value as u64),
                    output_tokens: row.get::<_, Option<i64>>(2)?.map(|value| value as u64),
                    reasoning_tokens: row.get::<_, Option<i64>>(3)?.map(|value| value as u64),
                    response_count: total as u64,
                    duration_ms: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
                }))
            },
        )
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn add_usage(left: UsageAggregate, right: UsageAggregate) -> UsageAggregate {
    UsageAggregate {
        command_count: left.command_count + right.command_count,
        succeeded_count: left.succeeded_count + right.succeeded_count,
        failed_count: left.failed_count + right.failed_count,
        interrupted_count: left.interrupted_count + right.interrupted_count,
        unknown_count: left.unknown_count + right.unknown_count,
        duration_ms_sum: left.duration_ms_sum + right.duration_ms_sum,
    }
}

pub fn add_tokens(
    left: Option<TokenAggregate>,
    right: Option<TokenAggregate>,
) -> Option<TokenAggregate> {
    match (left, right) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value),
        (Some(left), Some(right)) => Some(TokenAggregate {
            input_tokens: add_optional(left.input_tokens, right.input_tokens),
            cached_input_tokens: add_optional(left.cached_input_tokens, right.cached_input_tokens),
            output_tokens: add_optional(left.output_tokens, right.output_tokens),
            reasoning_tokens: add_optional(left.reasoning_tokens, right.reasoning_tokens),
            response_count: left.response_count.saturating_add(right.response_count),
            duration_ms: add_optional(left.duration_ms, right.duration_ms),
        }),
    }
}

pub fn aggregate_usage_series(
    store: &TelemetryStore,
    detail_query: &UsageQuery,
    rollup_query: &UsageQuery,
    boundary_utc_ms: i64,
    bucket_ms: i64,
) -> Result<Vec<UsageTimeBucket>, TelemetryStoreError> {
    let mut buckets = BTreeMap::<i64, UsageTimeBucket>::new();
    for (start, terminal) in command_series(store, detail_query, bucket_ms)? {
        buckets.entry(start).or_default().terminal = terminal;
    }
    if bucket_ms == 86_400_000 {
        for (start, terminal) in command_rollup_series(store, rollup_query, boundary_utc_ms)? {
            buckets.entry(start).or_default().terminal = terminal;
        }
    }
    for (start, codex) in token_series(store, detail_query, bucket_ms)? {
        buckets.entry(start).or_default().codex = codex;
    }
    if bucket_ms == 86_400_000 {
        for (start, codex) in token_rollup_series(store, rollup_query, boundary_utc_ms)? {
            let bucket = buckets.entry(start).or_default();
            bucket.codex = add_tokens(bucket.codex.clone(), codex);
        }
    }
    Ok(buckets
        .into_iter()
        .map(|(start_utc_ms, mut bucket)| {
            bucket.start_utc_ms = start_utc_ms;
            bucket
        })
        .collect())
}

pub fn aggregate_command_dimensions(
    store: &TelemetryStore,
    detail_query: &UsageQuery,
    rollup_query: &UsageQuery,
    boundary_utc_ms: i64,
    dimension: UsageDimension,
) -> Result<Vec<UsageDimensionAggregate>, TelemetryStoreError> {
    let mut aggregates = BTreeMap::<String, UsageAggregate>::new();
    for (name, aggregate) in command_dimensions(store, detail_query, dimension)? {
        aggregates.insert(name, aggregate);
    }
    for (name, aggregate) in
        command_rollup_dimensions(store, rollup_query, boundary_utc_ms, dimension)?
    {
        let current = aggregates.remove(&name).unwrap_or_default();
        aggregates.insert(name, add_usage(current, aggregate));
    }
    Ok(aggregates
        .into_iter()
        .map(|(name, terminal)| UsageDimensionAggregate { name, terminal })
        .collect())
}

#[derive(Clone, Copy)]
pub enum UsageDimension {
    Category,
    Project,
}

pub fn aggregate_detail_metrics(
    store: &TelemetryStore,
    query: &UsageQuery,
) -> Result<DetailUsageMetrics, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, values) = command_where(query, "c");
    let duration_count: i64 = connection.query_row(
        &format!(
            "SELECT count(*) FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id {where_clause} AND c.duration_ms IS NOT NULL"
        ),
        params_from_iter(values.iter()),
        |row| row.get(0),
    )?;
    let percentile = |percent: i64| -> Result<Option<u64>, rusqlite::Error> {
        if duration_count == 0 {
            return Ok(None);
        }
        // Nearest-rank percentile: p50 of two sorted samples selects the
        // first, while p95 selects the second. This stays deterministic
        // without retaining a histogram after detail expiration.
        let offset = ((duration_count * percent + 99) / 100).saturating_sub(1);
        let mut percentile_values = values.clone();
        percentile_values.push(Value::Integer(offset));
        connection
            .query_row(
                &format!(
                    "SELECT c.duration_ms FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id {where_clause} AND c.duration_ms IS NOT NULL ORDER BY c.duration_ms LIMIT 1 OFFSET ?"
                ),
                params_from_iter(percentile_values.iter()),
                |row| row.get::<_, i64>(0).map(|value| value as u64),
            )
            .map(Some)
    };
    let repeated_command_count: i64 = connection.query_row(
        &format!(
            "SELECT coalesce(sum(count - 1), 0) FROM (SELECT c.fingerprint, count(*) AS count FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id {where_clause} GROUP BY c.fingerprint HAVING count > 1)"
        ),
        params_from_iter(values.iter()),
        |row| row.get(0),
    )?;
    Ok(DetailUsageMetrics {
        duration_p50_ms: percentile(50)?,
        duration_p95_ms: percentile(95)?,
        repeated_command_count: repeated_command_count as u64,
    })
}

fn command_series(
    store: &TelemetryStore,
    query: &UsageQuery,
    bucket_ms: i64,
) -> Result<Vec<(i64, UsageAggregate)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, mut values) = command_where(query, "c");
    values.insert(0, Value::Integer(bucket_ms));
    values.insert(1, Value::Integer(bucket_ms));
    let sql = format!(
        "SELECT (c.occurred_at_utc_ms / ?1) * ?2, count(*), coalesce(sum(c.outcome = 'succeeded'), 0), coalesce(sum(c.outcome = 'failed'), 0), coalesce(sum(c.outcome = 'interrupted'), 0), coalesce(sum(c.outcome = 'unknown'), 0), coalesce(sum(c.duration_ms), 0) FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id {where_clause} GROUP BY 1 ORDER BY 1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get(0)?, usage_from_row_at(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn command_rollup_series(
    store: &TelemetryStore,
    query: &UsageQuery,
    boundary_utc_ms: i64,
) -> Result<Vec<(i64, UsageAggregate)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, mut values) = rollup_where(query, boundary_utc_ms);
    let sql = format!(
        "SELECT strftime('%s', utc_day) * 1000, coalesce(sum(command_count), 0), coalesce(sum(succeeded_count), 0), coalesce(sum(failed_count), 0), coalesce(sum(interrupted_count), 0), coalesce(sum(unknown_count), 0), coalesce(sum(duration_ms_sum), 0) FROM daily_usage_rollups {where_clause} GROUP BY utc_day ORDER BY utc_day"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.drain(..)), |row| {
        Ok((row.get(0)?, usage_from_row_at(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn token_series(
    store: &TelemetryStore,
    query: &UsageQuery,
    bucket_ms: i64,
) -> Result<Vec<(i64, Option<TokenAggregate>)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, mut values) = token_where(query, "a");
    values.insert(0, Value::Integer(bucket_ms));
    values.insert(1, Value::Integer(bucket_ms));
    let sql = format!(
        "SELECT (a.occurred_at_utc_ms / ?1) * ?2, count(*), sum(a.input_tokens), sum(a.cached_input_tokens), sum(a.output_tokens), sum(a.reasoning_tokens), sum(a.duration_ms) FROM agent_usage_events a {where_clause} GROUP BY 1 ORDER BY 1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get(0)?, tokens_from_row(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn token_rollup_series(
    store: &TelemetryStore,
    query: &UsageQuery,
    boundary_utc_ms: i64,
) -> Result<Vec<(i64, Option<TokenAggregate>)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, values) = token_rollup_where(query, boundary_utc_ms);
    let sql = format!(
        "SELECT strftime('%s', utc_day) * 1000, coalesce(sum(agent_response_count), 0), CASE WHEN sum(input_tokens_count) > 0 THEN sum(input_tokens_sum) END, CASE WHEN sum(cached_input_tokens_count) > 0 THEN sum(cached_input_tokens_sum) END, CASE WHEN sum(output_tokens_count) > 0 THEN sum(output_tokens_sum) END, CASE WHEN sum(reasoning_tokens_count) > 0 THEN sum(reasoning_tokens_sum) END, CASE WHEN sum(agent_duration_ms_sum) > 0 THEN sum(agent_duration_ms_sum) END FROM daily_usage_rollups {where_clause} GROUP BY utc_day ORDER BY utc_day"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get(0)?, tokens_from_row(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn add_optional(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left + right),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn command_dimensions(
    store: &TelemetryStore,
    query: &UsageQuery,
    dimension: UsageDimension,
) -> Result<Vec<(String, UsageAggregate)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, values) = command_where(query, "c");
    let key = match dimension {
        UsageDimension::Category => "c.category",
        UsageDimension::Project => "coalesce(r.project, 'unassigned')",
    };
    let sql = format!(
        "SELECT {key}, count(*), coalesce(sum(c.outcome = 'succeeded'), 0), coalesce(sum(c.outcome = 'failed'), 0), coalesce(sum(c.outcome = 'interrupted'), 0), coalesce(sum(c.outcome = 'unknown'), 0), coalesce(sum(c.duration_ms), 0) FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id {where_clause} GROUP BY 1 ORDER BY 1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get(0)?, usage_from_row_at(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn command_rollup_dimensions(
    store: &TelemetryStore,
    query: &UsageQuery,
    boundary_utc_ms: i64,
    dimension: UsageDimension,
) -> Result<Vec<(String, UsageAggregate)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, values) = rollup_where(query, boundary_utc_ms);
    let key = match dimension {
        UsageDimension::Category => "category",
        UsageDimension::Project => "CASE WHEN project = '' THEN 'unassigned' ELSE project END",
    };
    let sql = format!(
        "SELECT {key}, coalesce(sum(command_count), 0), coalesce(sum(succeeded_count), 0), coalesce(sum(failed_count), 0), coalesce(sum(interrupted_count), 0), coalesce(sum(unknown_count), 0), coalesce(sum(duration_ms_sum), 0) FROM daily_usage_rollups {where_clause} GROUP BY 1 ORDER BY 1"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get(0)?, usage_from_row_at(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn command_where(query: &UsageQuery, alias: &str) -> (String, Vec<Value>) {
    let mut sql = String::from(" WHERE 1 = 1");
    let mut values = Vec::new();
    if let Some(from) = query.from_utc_ms {
        sql.push_str(&format!(" AND {alias}.occurred_at_utc_ms >= ?"));
        values.push(Value::Integer(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(&format!(" AND {alias}.occurred_at_utc_ms < ?"));
        values.push(Value::Integer(to));
    }
    if let Some(project) = &query.project {
        sql.push_str(" AND r.project = ?");
        values.push(Value::Text(project.as_str().to_string()));
    }
    if let Some(shell) = query.shell {
        sql.push_str(" AND r.shell = ?");
        values.push(Value::Text(shell_name(shell).to_string()));
    }
    if let Some(quality) = query.capture_quality {
        sql.push_str(&format!(" AND {alias}.capture_quality = ?"));
        values.push(Value::Text(capture_quality(quality).to_string()));
    }
    if let Some(category) = &query.category {
        sql.push_str(&format!(" AND {alias}.category = ?"));
        values.push(Value::Text(category.as_str().to_string()));
    }
    (sql, values)
}

fn rollup_where(query: &UsageQuery, boundary_utc_ms: i64) -> (String, Vec<Value>) {
    let mut sql = String::from(" WHERE utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
    let mut values = vec![Value::Integer(boundary_utc_ms)];
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND utc_day >= strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Value::Integer(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Value::Integer(to));
    }
    if let Some(project) = &query.project {
        sql.push_str(" AND project = ?");
        values.push(Value::Text(project.as_str().to_string()));
    }
    if let Some(shell) = query.shell {
        sql.push_str(" AND shell = ?");
        values.push(Value::Text(shell_name(shell).to_string()));
    }
    if let Some(category) = &query.category {
        sql.push_str(" AND category = ?");
        values.push(Value::Text(category.as_str().to_string()));
    }
    (sql, values)
}

fn token_where(query: &UsageQuery, alias: &str) -> (String, Vec<Value>) {
    let mut sql = String::from(" WHERE 1 = 1");
    let mut values = Vec::new();
    if let Some(from) = query.from_utc_ms {
        sql.push_str(&format!(" AND {alias}.occurred_at_utc_ms >= ?"));
        values.push(Value::Integer(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(&format!(" AND {alias}.occurred_at_utc_ms < ?"));
        values.push(Value::Integer(to));
    }
    if let Some(model) = &query.model {
        sql.push_str(&format!(" AND {alias}.model = ?"));
        values.push(Value::Text(String::from(model.clone())));
    }
    (sql, values)
}

fn token_rollup_where(query: &UsageQuery, boundary_utc_ms: i64) -> (String, Vec<Value>) {
    let mut sql = String::from(" WHERE utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
    let mut values = vec![Value::Integer(boundary_utc_ms)];
    if let Some(from) = query.from_utc_ms {
        sql.push_str(" AND utc_day >= strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Value::Integer(from));
    }
    if let Some(to) = query.to_utc_ms {
        sql.push_str(" AND utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
        values.push(Value::Integer(to));
    }
    if let Some(model) = &query.model {
        sql.push_str(" AND model = ?");
        values.push(Value::Text(String::from(model.clone())));
    }
    (sql, values)
}

fn usage_from_row_at(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> Result<UsageAggregate, rusqlite::Error> {
    Ok(UsageAggregate {
        command_count: row.get::<_, i64>(offset)? as u64,
        succeeded_count: row.get::<_, i64>(offset + 1)? as u64,
        failed_count: row.get::<_, i64>(offset + 2)? as u64,
        interrupted_count: row.get::<_, i64>(offset + 3)? as u64,
        unknown_count: row.get::<_, i64>(offset + 4)? as u64,
        duration_ms_sum: row.get::<_, i64>(offset + 5)? as u64,
    })
}

fn tokens_from_row(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> Result<Option<TokenAggregate>, rusqlite::Error> {
    let count: i64 = row.get(offset)?;
    Ok((count > 0).then_some(TokenAggregate {
        input_tokens: row
            .get::<_, Option<i64>>(offset + 1)?
            .map(|value| value as u64),
        cached_input_tokens: row
            .get::<_, Option<i64>>(offset + 2)?
            .map(|value| value as u64),
        output_tokens: row
            .get::<_, Option<i64>>(offset + 3)?
            .map(|value| value as u64),
        reasoning_tokens: row
            .get::<_, Option<i64>>(offset + 4)?
            .map(|value| value as u64),
        response_count: count as u64,
        duration_ms: row
            .get::<_, Option<i64>>(offset + 5)?
            .map(|value| value as u64),
    }))
}

pub fn health_value(store: &TelemetryStore, name: &str) -> Result<u64, TelemetryStoreError> {
    let connection = store.open_read()?;
    connection
        .query_row(
            "SELECT value FROM telemetry_health WHERE name = ?1",
            params![name],
            |row| row.get::<_, i64>(0).map(|value| value as u64),
        )
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(0),
            other => Err(TelemetryStoreError::Sqlite(other)),
        })
}

fn capture_quality(value: super::types::CaptureQuality) -> &'static str {
    match value {
        super::types::CaptureQuality::Rich => "rich",
        super::types::CaptureQuality::Partial => "partial",
        super::types::CaptureQuality::Unavailable => "unavailable",
    }
}

fn shell_name(value: super::types::ShellKind) -> &'static str {
    match value {
        super::types::ShellKind::Bash => "bash",
        super::types::ShellKind::Zsh => "zsh",
        super::types::ShellKind::Fish => "fish",
    }
}

fn usage_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<UsageAggregate> {
    Ok(UsageAggregate {
        command_count: row.get::<_, i64>(0)? as u64,
        succeeded_count: row.get::<_, i64>(1)? as u64,
        failed_count: row.get::<_, i64>(2)? as u64,
        interrupted_count: row.get::<_, i64>(3)? as u64,
        unknown_count: row.get::<_, i64>(4)? as u64,
        duration_ms_sum: row.get::<_, i64>(5)? as u64,
    })
}
