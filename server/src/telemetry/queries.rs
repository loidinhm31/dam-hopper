use std::collections::BTreeMap;

use rusqlite::{params, params_from_iter, types::Value, OptionalExtension};
use serde::Serialize;

use super::{
    privacy::HmacDigest,
    store::{TelemetryStore, TelemetryStoreError},
    types::{
        AgentRole, AgentRunSummary, AgentTokenQuality, CodexModel, CodexVersion, SafeIdentifier,
        TokenCounterSemantic, UsageQuery, MAX_TOKEN_TOTAL,
    },
};

const MAX_AGENT_RUN_PAGE: usize = 100;
pub const MAX_SESSION_MODELS: usize = 32;
const DAY_MS: i64 = 86_400_000;
const MAX_TOKEN_TOTAL_I64: i64 = MAX_TOKEN_TOTAL as i64;
const MAX_DURATION_SUM_I64: i64 = i64::MAX;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRunCursor {
    pub ended_at_utc_ms: i64,
    pub run_id: HmacDigest,
}

#[derive(Clone, Debug, Default)]
pub struct AgentRunListQuery {
    pub from_utc_ms: i64,
    pub to_utc_ms: i64,
    pub model: Option<CodexModel>,
    pub cursor: Option<AgentRunCursor>,
    pub limit: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentRootAggregate {
    pub root_run_id: HmacDigest,
    pub child_count: u32,
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
pub struct UsageTimeBucket {
    pub start_utc_ms: i64,
    pub codex: Option<TokenAggregate>,
}

const SESSION_COLUMNS: &str = "session_fingerprint, model, source_version, source_quality,
    started_at_utc_ms, ended_at_utc_ms, status, counter_semantic, token_quality,
    response_count, duration_ms_sum, input_tokens, cached_input_tokens, output_tokens,
    reasoning_tokens, updated_at_utc_ms";

pub fn list_agent_run_roots(
    store: &TelemetryStore,
    query: &AgentRunListQuery,
) -> Result<Vec<AgentRunSummary>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let mut sql = format!(
        "SELECT {SESSION_COLUMNS} FROM codex_sessions
         WHERE started_at_utc_ms < ?1 AND coalesce(ended_at_utc_ms, started_at_utc_ms) >= ?2"
    );
    let mut values = vec![
        Value::Integer(query.to_utc_ms),
        Value::Integer(query.from_utc_ms),
    ];
    if let Some(model) = &query.model {
        sql.push_str(" AND model = ?");
        values.push(Value::Text(String::from(model.clone())));
    }
    if let Some(cursor) = &query.cursor {
        sql.push_str(" AND (coalesce(ended_at_utc_ms, started_at_utc_ms) < ? OR (coalesce(ended_at_utc_ms, started_at_utc_ms) = ? AND session_fingerprint < ?))");
        values.push(Value::Integer(cursor.ended_at_utc_ms));
        values.push(Value::Integer(cursor.ended_at_utc_ms));
        values.push(Value::Text(String::from(cursor.run_id.clone())));
    }
    sql.push_str(" ORDER BY coalesce(ended_at_utc_ms, started_at_utc_ms) DESC, session_fingerprint DESC LIMIT ?");
    values.push(Value::Integer(
        query
            .limit
            .saturating_add(1)
            .clamp(1, MAX_AGENT_RUN_PAGE + 1) as i64,
    ));
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), session_from_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn agent_root_aggregates(
    store: &TelemetryStore,
    root_ids: &[HmacDigest],
) -> Result<Vec<AgentRootAggregate>, TelemetryStoreError> {
    let mut result = Vec::new();
    for root_id in root_ids {
        let Some(summary) = agent_run_summary(store, root_id)? else {
            continue;
        };
        result.push(AgentRootAggregate {
            root_run_id: root_id.clone(),
            child_count: 0,
            token_quality: summary.token_quality,
            input_tokens: summary.input_tokens,
            cached_input_tokens: summary.cached_input_tokens,
            output_tokens: summary.output_tokens,
            reasoning_tokens: summary.reasoning_tokens,
            response_count: summary.response_count,
            duration_ms_sum: summary.duration_ms_sum,
        });
    }
    Ok(result)
}

pub fn agent_executor_aggregates(
    store: &TelemetryStore,
    root_id: &HmacDigest,
) -> Result<Vec<AgentExecutorAggregate>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let input_sum = bounded_sum_sql("input_tokens", MAX_TOKEN_TOTAL_I64);
    let cached_sum = bounded_sum_sql("cached_input_tokens", MAX_TOKEN_TOTAL_I64);
    let output_sum = bounded_sum_sql("output_tokens", MAX_TOKEN_TOTAL_I64);
    let reasoning_sum = bounded_sum_sql("reasoning_tokens", MAX_TOKEN_TOTAL_I64);
    let duration_sum = bounded_sum_sql("duration_ms", MAX_DURATION_SUM_I64);
    let sql = format!(
        "SELECT model, count(*), {input_sum}, {cached_sum},
                {output_sum}, {reasoning_sum}, {duration_sum}
         FROM codex_usage_events WHERE session_fingerprint = ?1 GROUP BY model
         ORDER BY model LIMIT {MAX_SESSION_MODELS}"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map([String::from(root_id.clone())], executor_from_row)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn agent_executor_aggregates_for_roots(
    store: &TelemetryStore,
    root_ids: &[HmacDigest],
) -> Result<Vec<(HmacDigest, AgentExecutorAggregate)>, TelemetryStoreError> {
    if root_ids.is_empty() {
        return Ok(Vec::new());
    }
    let connection = store.open_read()?;
    let placeholders = question_marks(root_ids.len());
    let input_sum = bounded_sum_sql("input_tokens", MAX_TOKEN_TOTAL_I64);
    let cached_sum = bounded_sum_sql("cached_input_tokens", MAX_TOKEN_TOTAL_I64);
    let output_sum = bounded_sum_sql("output_tokens", MAX_TOKEN_TOTAL_I64);
    let reasoning_sum = bounded_sum_sql("reasoning_tokens", MAX_TOKEN_TOTAL_I64);
    let duration_sum = bounded_sum_sql("duration_ms", MAX_DURATION_SUM_I64);
    let sql = format!(
        "SELECT session_fingerprint, model, response_count, input_tokens_sum,
                cached_input_tokens_sum, output_tokens_sum, reasoning_tokens_sum, duration_ms_sum
         FROM (
             SELECT session_fingerprint, model, count(*) AS response_count,
                    {input_sum} AS input_tokens_sum,
                    {cached_sum} AS cached_input_tokens_sum,
                    {output_sum} AS output_tokens_sum,
                    {reasoning_sum} AS reasoning_tokens_sum,
                    {duration_sum} AS duration_ms_sum,
                    row_number() OVER (
                        PARTITION BY session_fingerprint ORDER BY model
                    ) AS model_rank
             FROM codex_usage_events
             WHERE session_fingerprint IN ({placeholders})
             GROUP BY session_fingerprint, model
         )
         WHERE model_rank <= {MAX_SESSION_MODELS}
         ORDER BY session_fingerprint, model"
    );
    let values = root_ids
        .iter()
        .cloned()
        .map(String::from)
        .map(Value::Text)
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        let id = parse_digest(row.get::<_, String>(0)?)?;
        Ok((id, executor_from_row_offset(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn agent_run_summary(
    store: &TelemetryStore,
    run_id: &HmacDigest,
) -> Result<Option<AgentRunSummary>, TelemetryStoreError> {
    let connection = store.open_read()?;
    connection
        .query_row(
            &format!("SELECT {SESSION_COLUMNS} FROM codex_sessions WHERE session_fingerprint = ?1"),
            [String::from(run_id.clone())],
            session_from_row,
        )
        .optional()
        .map_err(TelemetryStoreError::Sqlite)
}

pub fn aggregate_tokens(
    store: &TelemetryStore,
    query: &UsageQuery,
) -> Result<Option<TokenAggregate>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, values) = event_where(query, "e");
    let input_sum = bounded_sum_sql("e.input_tokens", MAX_TOKEN_TOTAL_I64);
    let cached_sum = bounded_sum_sql("e.cached_input_tokens", MAX_TOKEN_TOTAL_I64);
    let output_sum = bounded_sum_sql("e.output_tokens", MAX_TOKEN_TOTAL_I64);
    let reasoning_sum = bounded_sum_sql("e.reasoning_tokens", MAX_TOKEN_TOTAL_I64);
    let duration_sum = bounded_sum_sql("e.duration_ms", MAX_DURATION_SUM_I64);
    let sql = format!(
        "SELECT count(*), {input_sum}, {cached_sum},
                {output_sum}, {reasoning_sum}, {duration_sum}
         FROM codex_usage_events e {where_clause}"
    );
    let row = connection.query_row(&sql, params_from_iter(values.iter()), |row| {
        Ok(TokenAggregate {
            input_tokens: bounded_value_from_row(row, 1, MAX_TOKEN_TOTAL_I64)?,
            cached_input_tokens: bounded_value_from_row(row, 2, MAX_TOKEN_TOTAL_I64)?,
            output_tokens: bounded_value_from_row(row, 3, MAX_TOKEN_TOTAL_I64)?,
            reasoning_tokens: bounded_value_from_row(row, 4, MAX_TOKEN_TOTAL_I64)?,
            response_count: bounded_value_from_row(row, 0, MAX_TOKEN_TOTAL_I64)?
                .unwrap_or_default(),
            duration_ms: bounded_value_from_row(row, 5, MAX_DURATION_SUM_I64)?,
        })
    })?;
    Ok((row.response_count > 0).then_some(row))
}

pub fn aggregate_token_rollups(
    store: &TelemetryStore,
    query: &UsageQuery,
    boundary_utc_ms: i64,
) -> Result<Option<TokenAggregate>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, values) = rollup_where(query, boundary_utc_ms);
    let input_sum = format!(
        "CASE WHEN bounded_sum_i64(input_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("input_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let cached_sum = format!(
        "CASE WHEN bounded_sum_i64(cached_input_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("cached_input_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let output_sum = format!(
        "CASE WHEN bounded_sum_i64(output_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("output_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let reasoning_sum = format!(
        "CASE WHEN bounded_sum_i64(reasoning_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("reasoning_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let response_sum = bounded_sum_sql("response_count", MAX_TOKEN_TOTAL_I64);
    let duration_sum = format!(
        "CASE WHEN count(duration_ms_sum) > 0 THEN {} END",
        bounded_sum_sql("duration_ms_sum", MAX_DURATION_SUM_I64)
    );
    let sql = format!(
        "SELECT {input_sum}, {cached_sum}, {output_sum}, {reasoning_sum},
                coalesce({response_sum}, 0), {duration_sum}
         FROM codex_daily_rollups {where_clause}"
    );
    let aggregate = connection.query_row(&sql, params_from_iter(values.iter()), |row| {
        Ok(TokenAggregate {
            input_tokens: bounded_value_from_row(row, 0, MAX_TOKEN_TOTAL_I64)?,
            cached_input_tokens: bounded_value_from_row(row, 1, MAX_TOKEN_TOTAL_I64)?,
            output_tokens: bounded_value_from_row(row, 2, MAX_TOKEN_TOTAL_I64)?,
            reasoning_tokens: bounded_value_from_row(row, 3, MAX_TOKEN_TOTAL_I64)?,
            response_count: bounded_value_from_row(row, 4, MAX_TOKEN_TOTAL_I64)?
                .unwrap_or_default(),
            duration_ms: bounded_value_from_row(row, 5, MAX_DURATION_SUM_I64)?,
        })
    })?;
    Ok((aggregate.response_count > 0).then_some(aggregate))
}

pub fn add_tokens(
    left: Option<TokenAggregate>,
    right: Option<TokenAggregate>,
) -> Option<TokenAggregate> {
    match (left, right) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value),
        (Some(left), Some(right)) => Some(TokenAggregate {
            input_tokens: add_bounded(left.input_tokens, right.input_tokens, MAX_TOKEN_TOTAL),
            cached_input_tokens: add_bounded(
                left.cached_input_tokens,
                right.cached_input_tokens,
                MAX_TOKEN_TOTAL,
            ),
            output_tokens: add_bounded(left.output_tokens, right.output_tokens, MAX_TOKEN_TOTAL),
            reasoning_tokens: add_bounded(
                left.reasoning_tokens,
                right.reasoning_tokens,
                MAX_TOKEN_TOTAL,
            ),
            response_count: left
                .response_count
                .saturating_add(right.response_count)
                .min(MAX_TOKEN_TOTAL),
            duration_ms: add_bounded(
                left.duration_ms,
                right.duration_ms,
                MAX_DURATION_SUM_I64 as u64,
            ),
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
    for (start, tokens) in token_series(store, detail_query, bucket_ms)? {
        buckets.entry(start).or_default().codex = tokens;
    }
    if bucket_ms == DAY_MS {
        for (start, tokens) in token_rollup_series(store, rollup_query, boundary_utc_ms)? {
            let bucket = buckets.entry(start).or_default();
            bucket.codex = add_tokens(bucket.codex.clone(), tokens);
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

fn token_series(
    store: &TelemetryStore,
    query: &UsageQuery,
    bucket_ms: i64,
) -> Result<Vec<(i64, Option<TokenAggregate>)>, TelemetryStoreError> {
    let connection = store.open_read()?;
    let (where_clause, mut values) = event_where(query, "e");
    values.insert(0, Value::Integer(bucket_ms));
    let input_sum = bounded_sum_sql("e.input_tokens", MAX_TOKEN_TOTAL_I64);
    let cached_sum = bounded_sum_sql("e.cached_input_tokens", MAX_TOKEN_TOTAL_I64);
    let output_sum = bounded_sum_sql("e.output_tokens", MAX_TOKEN_TOTAL_I64);
    let reasoning_sum = bounded_sum_sql("e.reasoning_tokens", MAX_TOKEN_TOTAL_I64);
    let duration_sum = bounded_sum_sql("e.duration_ms", MAX_DURATION_SUM_I64);
    let sql = format!(
        "SELECT (e.occurred_at_utc_ms / ?1) * ?1, count(*), {input_sum},
                {cached_sum}, {output_sum}, {reasoning_sum}, {duration_sum}
         FROM codex_usage_events e {where_clause}
         GROUP BY 1 ORDER BY 1"
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
    let (where_clause, values) = rollup_where(query, boundary_utc_ms);
    let input_sum = format!(
        "CASE WHEN bounded_sum_i64(input_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("input_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let cached_sum = format!(
        "CASE WHEN bounded_sum_i64(cached_input_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("cached_input_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let output_sum = format!(
        "CASE WHEN bounded_sum_i64(output_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("output_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let reasoning_sum = format!(
        "CASE WHEN bounded_sum_i64(reasoning_tokens_count, {MAX_TOKEN_TOTAL_I64}) > 0 THEN {} END",
        bounded_sum_sql("reasoning_tokens_sum", MAX_TOKEN_TOTAL_I64)
    );
    let response_sum = bounded_sum_sql("response_count", MAX_TOKEN_TOTAL_I64);
    let duration_sum = format!(
        "CASE WHEN count(duration_ms_sum) > 0 THEN {} END",
        bounded_sum_sql("duration_ms_sum", MAX_DURATION_SUM_I64)
    );
    let sql = format!(
        "SELECT strftime('%s', utc_day) * 1000, coalesce({response_sum}, 0),
                {input_sum}, {cached_sum}, {output_sum}, {reasoning_sum}, {duration_sum}
         FROM codex_daily_rollups {where_clause} GROUP BY utc_day ORDER BY utc_day"
    );
    let mut statement = connection.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get(0)?, tokens_from_row(row, 1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(TelemetryStoreError::Sqlite)
}

fn event_where(query: &UsageQuery, alias: &str) -> (String, Vec<Value>) {
    let mut sql = String::from("WHERE 1 = 1");
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

fn rollup_where(query: &UsageQuery, boundary_utc_ms: i64) -> (String, Vec<Value>) {
    let mut sql = String::from("WHERE utc_day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch')");
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

fn session_from_row(row: &rusqlite::Row<'_>) -> Result<AgentRunSummary, rusqlite::Error> {
    let run_id = parse_digest(row.get::<_, String>(0)?)?;
    let model = row
        .get::<_, Option<String>>(1)?
        .map(|value| CodexModel::new(value).map_err(|_| rusqlite::Error::InvalidQuery))
        .transpose()?;
    let source_version =
        CodexVersion::new(row.get::<_, String>(2)?).unwrap_or_else(|_| CodexVersion::unknown());
    Ok(AgentRunSummary {
        root_run_id: run_id.clone(),
        run_id,
        parent_run_id: None,
        provider: SafeIdentifier::new("codex").expect("static provider is safe"),
        role: AgentRole::Root,
        model,
        source_version,
        started_at_utc_ms: row.get(4)?,
        ended_at_utc_ms: row.get(5)?,
        status: SafeIdentifier::new(row.get::<_, String>(6)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        token_quality: match row.get::<_, String>(8)?.as_str() {
            "exact" => AgentTokenQuality::Exact,
            "partial" => AgentTokenQuality::Partial,
            "unavailable" => AgentTokenQuality::TokenDataUnavailable,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        counter_semantic: match row.get::<_, String>(7)?.as_str() {
            "delta" => TokenCounterSemantic::Delta,
            "cumulative" => TokenCounterSemantic::Cumulative,
            _ => return Err(rusqlite::Error::InvalidQuery),
        },
        response_count: bounded_value_from_row(row, 9, MAX_TOKEN_TOTAL_I64)?.unwrap_or_default(),
        duration_ms_sum: bounded_value_from_row(row, 10, MAX_DURATION_SUM_I64)?,
        input_tokens: bounded_value_from_row(row, 11, MAX_TOKEN_TOTAL_I64)?,
        cached_input_tokens: bounded_value_from_row(row, 12, MAX_TOKEN_TOTAL_I64)?,
        output_tokens: bounded_value_from_row(row, 13, MAX_TOKEN_TOTAL_I64)?,
        reasoning_tokens: bounded_value_from_row(row, 14, MAX_TOKEN_TOTAL_I64)?,
        updated_at_utc_ms: row.get(15)?,
    })
}

fn executor_from_row(row: &rusqlite::Row<'_>) -> Result<AgentExecutorAggregate, rusqlite::Error> {
    executor_from_row_offset(row, 0)
}

fn executor_from_row_offset(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> Result<AgentExecutorAggregate, rusqlite::Error> {
    let model = row
        .get::<_, Option<String>>(offset)?
        .map(|value| CodexModel::new(value).map_err(|_| rusqlite::Error::InvalidQuery))
        .transpose()?;
    Ok(AgentExecutorAggregate {
        model,
        response_count: bounded_value_from_row(row, offset + 1, MAX_TOKEN_TOTAL_I64)?
            .unwrap_or_default(),
        input_tokens: bounded_value_from_row(row, offset + 2, MAX_TOKEN_TOTAL_I64)?,
        cached_input_tokens: bounded_value_from_row(row, offset + 3, MAX_TOKEN_TOTAL_I64)?,
        output_tokens: bounded_value_from_row(row, offset + 4, MAX_TOKEN_TOTAL_I64)?,
        reasoning_tokens: bounded_value_from_row(row, offset + 5, MAX_TOKEN_TOTAL_I64)?,
        duration_ms_sum: bounded_value_from_row(row, offset + 6, MAX_DURATION_SUM_I64)?,
    })
}

fn tokens_from_row(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> Result<Option<TokenAggregate>, rusqlite::Error> {
    let count = bounded_value_from_row(row, offset, MAX_TOKEN_TOTAL_I64)?.unwrap_or_default();
    Ok((count > 0).then_some(TokenAggregate {
        input_tokens: bounded_value_from_row(row, offset + 1, MAX_TOKEN_TOTAL_I64)?,
        cached_input_tokens: bounded_value_from_row(row, offset + 2, MAX_TOKEN_TOTAL_I64)?,
        output_tokens: bounded_value_from_row(row, offset + 3, MAX_TOKEN_TOTAL_I64)?,
        reasoning_tokens: bounded_value_from_row(row, offset + 4, MAX_TOKEN_TOTAL_I64)?,
        response_count: count,
        duration_ms: bounded_value_from_row(row, offset + 5, MAX_DURATION_SUM_I64)?,
    }))
}

fn bounded_sum_sql(expression: &str, maximum: i64) -> String {
    format!("bounded_sum_i64({expression}, {maximum})")
}

fn add_bounded(left: Option<u64>, right: Option<u64>, maximum: u64) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.saturating_add(right).min(maximum)),
        (Some(value), None) | (None, Some(value)) => Some(value.min(maximum)),
        (None, None) => None,
    }
}

fn bounded_value_from_row(
    row: &rusqlite::Row<'_>,
    index: usize,
    maximum: i64,
) -> Result<Option<u64>, rusqlite::Error> {
    row.get::<_, Option<i64>>(index)?.map_or(Ok(None), |value| {
        if value < 0 || value > maximum {
            Err(rusqlite::Error::InvalidQuery)
        } else {
            Ok(Some(value as u64))
        }
    })
}

fn question_marks(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(",")
}

fn parse_digest(value: String) -> Result<HmacDigest, rusqlite::Error> {
    value.try_into().map_err(|_| rusqlite::Error::InvalidQuery)
}

pub fn health_value(store: &TelemetryStore, name: &str) -> Result<u64, TelemetryStoreError> {
    let connection = store.open_read()?;
    connection
        .query_row(
            "SELECT value FROM telemetry_health WHERE name = ?1",
            params![name],
            |row| row.get::<_, i64>(0).map(|value| value.max(0) as u64),
        )
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(0),
            other => Err(TelemetryStoreError::Sqlite(other)),
        })
}
