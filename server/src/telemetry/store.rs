use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use rusqlite::{
    functions::{Aggregate, Context, FunctionFlags},
    params, Connection, OptionalExtension, Transaction,
};
use thiserror::Error;

use super::{
    privacy::HmacDigest,
    types::{
        CodexUsageEvent, SourceQuality, TokenCounterSemantic, TokenQuality, MAX_DURATION_MS,
        MAX_TOKEN_COMPONENT, MAX_TOKEN_TOTAL,
    },
    TelemetryCmd,
};

const BUSY_TIMEOUT_MS: u64 = 5_000;
const DAY_MS: i64 = 86_400_000;
const SCHEMA_VERSION: i64 = 1;
const MAX_DURATION_SUM_MS: u64 = i64::MAX as u64;
const MAX_TOKEN_TOTAL_I64: i64 = MAX_TOKEN_TOTAL as i64;
const BOUNDED_SUM_FUNCTION: &str = "bounded_sum_i64";
const TARGET_TABLES: [&str; 4] = [
    "codex_usage_events",
    "codex_sessions",
    "codex_daily_rollups",
    "telemetry_health",
];
const TARGET_INDEXES: [&str; 6] = [
    "idx_codex_usage_events_occurred",
    "idx_codex_usage_events_session",
    "idx_codex_sessions_ended",
    "idx_codex_sessions_started",
    "idx_codex_sessions_order",
    "idx_codex_daily_rollups_day",
];

#[derive(Default)]
struct BoundedSumState {
    total: u64,
    maximum: u64,
    seen: bool,
}

struct BoundedSum;

impl Aggregate<BoundedSumState, Option<i64>> for BoundedSum {
    fn init(&self, context: &mut Context<'_>) -> Result<BoundedSumState, rusqlite::Error> {
        let maximum = context.get::<i64>(1)?;
        if maximum <= 0 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(BoundedSumState {
            total: 0,
            maximum: maximum as u64,
            seen: false,
        })
    }

    fn step(
        &self,
        context: &mut Context<'_>,
        state: &mut BoundedSumState,
    ) -> Result<(), rusqlite::Error> {
        let Some(value) = context.get::<Option<i64>>(0)? else {
            return Ok(());
        };
        if value < 0 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        state.total = state.total.saturating_add(value as u64).min(state.maximum);
        state.seen = true;
        Ok(())
    }

    fn finalize(
        &self,
        _context: &mut Context<'_>,
        state: Option<BoundedSumState>,
    ) -> Result<Option<i64>, rusqlite::Error> {
        Ok(state
            .filter(|state| state.seen)
            .map(|state| state.total as i64))
    }
}

#[derive(Debug, Error)]
pub enum TelemetryStoreError {
    #[error("telemetry I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("telemetry SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Clone)]
pub struct TelemetryStore {
    path: Arc<PathBuf>,
    writer: Arc<Mutex<Connection>>,
}

impl TelemetryStore {
    pub fn open(path: &Path) -> Result<Self, TelemetryStoreError> {
        ensure_parent(path)?;
        let connection = Connection::open(path)?;
        configure_writer(&connection)?;
        initialize_schema(&connection)?;
        restrict_storage_files(path)?;
        Ok(Self {
            path: Arc::new(path.to_path_buf()),
            writer: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn write_batch(&self, commands: Vec<TelemetryCmd>) -> Result<(), TelemetryStoreError> {
        if commands.is_empty() {
            return Ok(());
        }
        let mut connection = self.writer.lock().expect("telemetry writer lock poisoned");
        let transaction = connection.transaction()?;
        for command in commands {
            match command {
                TelemetryCmd::CodexUsage(event) => write_codex_event(&transaction, event)?,
                TelemetryCmd::Purge {
                    now_utc_ms,
                    detail_retention_days,
                    aggregate_retention_days,
                } => rollup_and_purge(
                    &transaction,
                    now_utc_ms,
                    detail_retention_days,
                    aggregate_retention_days,
                )?,
                TelemetryCmd::Delete { completion, .. } => {
                    let _ = completion.send(Err(
                        "telemetry delete bypassed its worker barrier".to_string()
                    ));
                }
                TelemetryCmd::ApplyRetention { completion, .. } => {
                    let _ = completion.send(Err(
                        "telemetry retention bypassed its worker barrier".to_string()
                    ));
                }
                TelemetryCmd::Shutdown => {}
            }
        }
        transaction.commit()?;
        restrict_storage_files(&self.path)?;
        Ok(())
    }

    pub fn increment_health(
        &self,
        name: &str,
        amount: u64,
        now_utc_ms: i64,
    ) -> Result<(), TelemetryStoreError> {
        let connection = self.writer.lock().expect("telemetry writer lock poisoned");
        increment_health_connection(&connection, name, amount, now_utc_ms)?;
        Ok(())
    }

    pub fn checkpoint(&self) -> Result<(), TelemetryStoreError> {
        let connection = self.writer.lock().expect("telemetry writer lock poisoned");
        connection.execute_batch("PRAGMA wal_checkpoint(PASSIVE)")?;
        restrict_storage_files(&self.path)?;
        Ok(())
    }

    pub fn delete_all(&self) -> Result<(), TelemetryStoreError> {
        self.delete_range(None, None)
    }

    /// Delete all data, or an exact detail range plus the affected UTC rollup
    /// days. The worker calls this only after flushing the bounded queue.
    pub fn delete_range(
        &self,
        from_utc_ms: Option<i64>,
        to_utc_ms: Option<i64>,
    ) -> Result<(), TelemetryStoreError> {
        let mut connection = self.writer.lock().expect("telemetry writer lock poisoned");
        let transaction = connection.transaction()?;
        match (from_utc_ms, to_utc_ms) {
            (Some(from), Some(to)) => delete_range_tx(&transaction, from, to)?,
            (None, None) => transaction.execute_batch(
                "DELETE FROM codex_usage_events;
                 DELETE FROM codex_sessions;
                 DELETE FROM codex_daily_rollups;
                 DELETE FROM telemetry_health;",
            )?,
            _ => unreachable!("usage range must be fully bounded"),
        }
        transaction.commit()?;
        Ok(())
    }

    pub(crate) fn open_read(&self) -> Result<Connection, TelemetryStoreError> {
        let connection =
            Connection::open_with_flags(&*self.path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        configure_reader(&connection)?;
        Ok(connection)
    }

    pub fn path_for_tests(&self) -> &Path {
        self.path.as_ref()
    }
}

fn write_codex_event(
    transaction: &Transaction<'_>,
    event: CodexUsageEvent,
) -> Result<(), rusqlite::Error> {
    let inserted = transaction.execute(
        "INSERT INTO codex_usage_events(
             dedupe_id, occurred_at_utc_ms, session_fingerprint, model, source_version,
             source_quality, status, counter_semantic, token_quality, input_tokens,
             cached_input_tokens, output_tokens, reasoning_tokens, duration_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(dedupe_id) DO NOTHING",
        params![
            digest(&event.id),
            event.occurred_at_utc_ms,
            event.session_fingerprint.as_ref().map(digest),
            event
                .model
                .as_ref()
                .map(|value| String::from(value.clone())),
            String::from(event.source_version.clone()),
            source_quality(event.source_quality),
            event.status.as_str(),
            counter_semantic(event.counter_semantic),
            token_quality(event.token_quality),
            token_i64(event.input_tokens)?,
            token_i64(event.cached_input_tokens)?,
            token_i64(event.output_tokens)?,
            token_i64(event.reasoning_tokens)?,
            duration_i64(event.duration_ms),
        ],
    )?;
    if inserted == 0 {
        increment_health_tx(
            transaction,
            "collector_duplicates",
            event.occurred_at_utc_ms,
        )?;
        return Ok(());
    }
    if let Some(session_id) = event.session_fingerprint.as_ref() {
        apply_session_event(transaction, session_id, &event)?;
    }
    Ok(())
}

#[derive(Debug)]
struct StoredSession {
    model: Option<String>,
    source_version: String,
    source_quality: String,
    _started_at_utc_ms: i64,
    _ended_at_utc_ms: Option<i64>,
    _status: String,
    counter_semantic: String,
    token_quality: String,
    response_count: u64,
    duration_ms_sum: Option<u64>,
    tokens: [Option<i64>; 4],
    updated_at_utc_ms: i64,
}

fn apply_session_event(
    transaction: &Transaction<'_>,
    session_id: &HmacDigest,
    event: &CodexUsageEvent,
) -> Result<(), rusqlite::Error> {
    let session_id = digest(session_id);
    let model = event
        .model
        .as_ref()
        .map(|value| String::from(value.clone()));
    let incoming = [
        token_i64(event.input_tokens)?,
        token_i64(event.cached_input_tokens)?,
        token_i64(event.output_tokens)?,
        token_i64(event.reasoning_tokens)?,
    ];
    let semantic = counter_semantic(event.counter_semantic);
    let existing = transaction
        .query_row(
            "SELECT model, source_version, source_quality, started_at_utc_ms,
                    ended_at_utc_ms, status, counter_semantic, token_quality,
                    response_count, duration_ms_sum, input_tokens, cached_input_tokens,
                    output_tokens, reasoning_tokens, updated_at_utc_ms
             FROM codex_sessions WHERE session_fingerprint = ?1",
            [&session_id],
            |row| {
                Ok(StoredSession {
                    model: row.get(0)?,
                    source_version: row.get(1)?,
                    source_quality: row.get(2)?,
                    _started_at_utc_ms: row.get(3)?,
                    _ended_at_utc_ms: row.get(4)?,
                    _status: row.get(5)?,
                    counter_semantic: row.get(6)?,
                    token_quality: row.get(7)?,
                    response_count: bounded_token_from_row(row, 8, MAX_TOKEN_TOTAL_I64)?
                        .unwrap_or_default(),
                    duration_ms_sum: bounded_token_from_row(row, 9, MAX_DURATION_SUM_MS as i64)?,
                    tokens: [
                        bounded_token_from_row(row, 10, MAX_TOKEN_TOTAL_I64)?
                            .map(|value| value as i64),
                        bounded_token_from_row(row, 11, MAX_TOKEN_TOTAL_I64)?
                            .map(|value| value as i64),
                        bounded_token_from_row(row, 12, MAX_TOKEN_TOTAL_I64)?
                            .map(|value| value as i64),
                        bounded_token_from_row(row, 13, MAX_TOKEN_TOTAL_I64)?
                            .map(|value| value as i64),
                    ],
                    updated_at_utc_ms: row.get(14)?,
                })
            },
        )
        .optional()?;

    let Some(existing) = existing else {
        transaction.execute(
            "INSERT INTO codex_sessions(
                 session_fingerprint, model, source_version, source_quality,
                 started_at_utc_ms, ended_at_utc_ms, status, counter_semantic,
                 token_quality, response_count, duration_ms_sum, input_tokens,
                 cached_input_tokens, output_tokens, reasoning_tokens, updated_at_utc_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?12, ?13, ?5)",
            params![
                session_id,
                model,
                String::from(event.source_version.clone()),
                source_quality(event.source_quality),
                event.occurred_at_utc_ms,
                event.status.as_str(),
                semantic,
                token_quality(event.token_quality),
                duration_i64(event.duration_ms),
                incoming[0],
                incoming[1],
                incoming[2],
                incoming[3],
            ],
        )?;
        return Ok(());
    };

    let model_conflict = existing
        .model
        .as_ref()
        .zip(model.as_ref())
        .is_some_and(|(old, new)| old != new);
    let semantic_conflict = existing.counter_semantic != semantic;
    let stale = event.counter_semantic == TokenCounterSemantic::Cumulative
        && event.occurred_at_utc_ms < existing.updated_at_utc_ms;
    let same_time_conflict = event.counter_semantic == TokenCounterSemantic::Cumulative
        && event.occurred_at_utc_ms == existing.updated_at_utc_ms
        && incoming
            .iter()
            .zip(existing.tokens.iter())
            .any(|(new, old)| new.is_some() && new != old);
    let cumulative_regression = event.counter_semantic == TokenCounterSemantic::Cumulative
        && event.occurred_at_utc_ms >= existing.updated_at_utc_ms
        && incoming
            .iter()
            .zip(existing.tokens.iter())
            .any(|(new, old)| matches!((new, old), (Some(new), Some(old)) if new < old));
    let counter_conflict = semantic_conflict || same_time_conflict || cumulative_regression;
    let accepted = !stale && !counter_conflict;
    let tokens = if !accepted {
        existing.tokens
    } else if event.counter_semantic == TokenCounterSemantic::Cumulative {
        merge_cumulative_tokens(existing.tokens, incoming)
    } else {
        merge_delta_tokens(existing.tokens, incoming)
    };
    let quality = if model_conflict
        || counter_conflict
        || existing.token_quality != "exact"
        || event.token_quality != TokenQuality::Exact
        || tokens.iter().any(Option::is_none)
    {
        if tokens.iter().all(Option::is_none) {
            "unavailable"
        } else {
            "partial"
        }
    } else {
        "exact"
    };
    let resolved_model = if model_conflict {
        None
    } else {
        existing.model.or(model)
    };
    let duration = if accepted {
        merge_duration(existing.duration_ms_sum, event.duration_ms)
    } else {
        existing.duration_ms_sum
    };
    let source_quality = if existing.source_quality == "unverified"
        || event.source_quality == SourceQuality::Unverified
    {
        "unverified"
    } else {
        "verified"
    };
    let response_count = existing
        .response_count
        .saturating_add(accepted as u64)
        .min(MAX_TOKEN_TOTAL);
    let source_version = if event.occurred_at_utc_ms >= existing.updated_at_utc_ms {
        String::from(event.source_version.clone())
    } else {
        existing.source_version
    };
    let updated = existing.updated_at_utc_ms.max(event.occurred_at_utc_ms);
    transaction.execute(
        "UPDATE codex_sessions SET model = ?2, source_version = ?3,
             source_quality = ?4, started_at_utc_ms = min(started_at_utc_ms, ?5),
             ended_at_utc_ms = max(coalesce(ended_at_utc_ms, ?5), ?5), status = ?6,
             token_quality = ?7, input_tokens = ?8, cached_input_tokens = ?9,
             output_tokens = ?10, reasoning_tokens = ?11, response_count = ?12,
             duration_ms_sum = ?13, updated_at_utc_ms = ?14 WHERE session_fingerprint = ?1",
        params![
            session_id,
            resolved_model,
            source_version,
            source_quality,
            event.occurred_at_utc_ms,
            event.status.as_str(),
            quality,
            tokens[0],
            tokens[1],
            tokens[2],
            tokens[3],
            response_count as i64,
            duration_sum_i64(duration),
            updated,
        ],
    )?;
    if model_conflict || counter_conflict || stale {
        increment_health_tx(
            transaction,
            "codex_session_conflicts",
            event.occurred_at_utc_ms,
        )?;
    }
    Ok(())
}

fn delete_range_tx(
    transaction: &Transaction<'_>,
    from_utc_ms: i64,
    to_utc_ms: i64,
) -> Result<(), rusqlite::Error> {
    let session_ids = {
        let mut session_ids = HashSet::new();
        let mut statement = transaction.prepare(
            "SELECT DISTINCT session_fingerprint FROM codex_usage_events
             WHERE occurred_at_utc_ms >= ?1 AND occurred_at_utc_ms < ?2
               AND session_fingerprint IS NOT NULL",
        )?;
        for session_id in statement.query_map(params![from_utc_ms, to_utc_ms], |row| {
            row.get::<_, String>(0)
        })? {
            session_ids.insert(session_id?);
        }
        // A summary can outlive its detail rows after retention. Treat a
        // range that intersects that session-level aggregate as deleting the
        // aggregate too; there is no per-session day breakdown from which to
        // remove only the purged portion safely.
        let mut statement = transaction.prepare(
            "SELECT session_fingerprint FROM codex_sessions
             WHERE started_at_utc_ms < ?2
               AND coalesce(ended_at_utc_ms, started_at_utc_ms) >= ?1",
        )?;
        for session_id in statement.query_map(params![from_utc_ms, to_utc_ms], |row| {
            row.get::<_, String>(0)
        })? {
            session_ids.insert(session_id?);
        }
        session_ids
    };
    transaction.execute(
        "DELETE FROM codex_usage_events WHERE occurred_at_utc_ms >= ?1 AND occurred_at_utc_ms < ?2",
        params![from_utc_ms, to_utc_ms],
    )?;
    transaction.execute(
        "DELETE FROM codex_daily_rollups
         WHERE utc_day >= strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')
           AND utc_day < strftime('%Y-%m-%d', ?2 / 1000, 'unixepoch')",
        params![from_utc_ms, to_utc_ms],
    )?;
    for session_id in session_ids {
        transaction.execute(
            "DELETE FROM codex_sessions WHERE session_fingerprint = ?1",
            [session_id],
        )?;
    }
    Ok(())
}

fn rollup_and_purge(
    transaction: &Transaction<'_>,
    now_utc_ms: i64,
    detail_retention_days: u16,
    aggregate_retention_days: Option<u32>,
) -> Result<(), rusqlite::Error> {
    let raw_cutoff = now_utc_ms.saturating_sub(i64::from(detail_retention_days) * DAY_MS);
    let cutoff = raw_cutoff - raw_cutoff.rem_euclid(DAY_MS);
    let input_sum = bounded_sum_sql("input_tokens", MAX_TOKEN_TOTAL_I64);
    let cached_sum = bounded_sum_sql("cached_input_tokens", MAX_TOKEN_TOTAL_I64);
    let output_sum = bounded_sum_sql("output_tokens", MAX_TOKEN_TOTAL_I64);
    let reasoning_sum = bounded_sum_sql("reasoning_tokens", MAX_TOKEN_TOTAL_I64);
    let input_count = bounded_sum_sql("input_tokens IS NOT NULL", MAX_TOKEN_TOTAL_I64);
    let cached_count = bounded_sum_sql("cached_input_tokens IS NOT NULL", MAX_TOKEN_TOTAL_I64);
    let output_count = bounded_sum_sql("output_tokens IS NOT NULL", MAX_TOKEN_TOTAL_I64);
    let reasoning_count = bounded_sum_sql("reasoning_tokens IS NOT NULL", MAX_TOKEN_TOTAL_I64);
    let response_count = bounded_sum_sql("1", MAX_TOKEN_TOTAL_I64);
    let duration_sum = bounded_sum_sql("duration_ms", MAX_DURATION_SUM_MS as i64);
    let sql = format!(
        "INSERT INTO codex_daily_rollups(
             utc_day, model, input_tokens_sum, cached_input_tokens_sum,
             output_tokens_sum, reasoning_tokens_sum, input_tokens_count,
             cached_input_tokens_count, output_tokens_count, reasoning_tokens_count,
             response_count, duration_ms_sum, source_mask
         ) SELECT strftime('%Y-%m-%d', occurred_at_utc_ms / 1000, 'unixepoch'),
             coalesce(model, ''), coalesce({input_sum}, 0),
             coalesce({cached_sum}, 0), coalesce({output_sum}, 0),
             coalesce({reasoning_sum}, 0), coalesce({input_count}, 0),
             coalesce({cached_count}, 0), coalesce({output_count}, 0),
             coalesce({reasoning_count}, 0), coalesce({response_count}, 0),
             {duration_sum}, 0
         FROM codex_usage_events WHERE occurred_at_utc_ms < ?1
         GROUP BY 1, 2
         ON CONFLICT(utc_day, model) DO UPDATE SET
             input_tokens_sum = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.input_tokens_sum, excluded.input_tokens_sum)
                 ELSE {input_merge} END,
             cached_input_tokens_sum = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.cached_input_tokens_sum, excluded.cached_input_tokens_sum)
                 ELSE {cached_merge} END,
             output_tokens_sum = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.output_tokens_sum, excluded.output_tokens_sum)
                 ELSE {output_merge} END,
             reasoning_tokens_sum = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.reasoning_tokens_sum, excluded.reasoning_tokens_sum)
                 ELSE {reasoning_merge} END,
             input_tokens_count = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.input_tokens_count, excluded.input_tokens_count)
                 ELSE {input_count_merge} END,
             cached_input_tokens_count = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.cached_input_tokens_count, excluded.cached_input_tokens_count)
                 ELSE {cached_count_merge} END,
             output_tokens_count = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.output_tokens_count, excluded.output_tokens_count)
                 ELSE {output_count_merge} END,
             reasoning_tokens_count = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.reasoning_tokens_count, excluded.reasoning_tokens_count)
                 ELSE {reasoning_count_merge} END,
             response_count = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0
                 THEN max(codex_daily_rollups.response_count, excluded.response_count)
                 ELSE {response_merge} END,
             duration_ms_sum = CASE WHEN (codex_daily_rollups.source_mask & 1) != 0 THEN CASE
                 WHEN codex_daily_rollups.duration_ms_sum IS NULL AND excluded.duration_ms_sum IS NULL THEN NULL
                 WHEN codex_daily_rollups.duration_ms_sum IS NULL THEN excluded.duration_ms_sum
                 WHEN excluded.duration_ms_sum IS NULL THEN codex_daily_rollups.duration_ms_sum
                 ELSE max(codex_daily_rollups.duration_ms_sum, excluded.duration_ms_sum) END
             ELSE CASE
                 WHEN duration_ms_sum IS NULL AND excluded.duration_ms_sum IS NULL THEN NULL
                 WHEN duration_ms_sum IS NULL THEN excluded.duration_ms_sum
                 WHEN excluded.duration_ms_sum IS NULL THEN duration_ms_sum
                 WHEN duration_ms_sum >= 9223372036854775807 - excluded.duration_ms_sum
                      THEN 9223372036854775807
                 ELSE duration_ms_sum + excluded.duration_ms_sum END END,
             source_mask = codex_daily_rollups.source_mask | excluded.source_mask",
        input_merge = safe_add_sql("codex_daily_rollups.input_tokens_sum", "excluded.input_tokens_sum"),
        cached_merge = safe_add_sql(
            "codex_daily_rollups.cached_input_tokens_sum",
            "excluded.cached_input_tokens_sum",
        ),
        output_merge = safe_add_sql(
            "codex_daily_rollups.output_tokens_sum",
            "excluded.output_tokens_sum",
        ),
        reasoning_merge = safe_add_sql(
            "codex_daily_rollups.reasoning_tokens_sum",
            "excluded.reasoning_tokens_sum",
        ),
        input_count_merge = safe_add_sql(
            "codex_daily_rollups.input_tokens_count",
            "excluded.input_tokens_count",
        ),
        cached_count_merge = safe_add_sql(
            "codex_daily_rollups.cached_input_tokens_count",
            "excluded.cached_input_tokens_count",
        ),
        output_count_merge = safe_add_sql(
            "codex_daily_rollups.output_tokens_count",
            "excluded.output_tokens_count",
        ),
        reasoning_count_merge = safe_add_sql(
            "codex_daily_rollups.reasoning_tokens_count",
            "excluded.reasoning_tokens_count",
        ),
        response_merge = safe_add_sql(
            "codex_daily_rollups.response_count",
            "excluded.response_count",
        ),
    );
    transaction.execute(&sql, [cutoff])?;
    if let Some(days) = aggregate_retention_days {
        let aggregate_cutoff = now_utc_ms.saturating_sub(i64::from(days) * DAY_MS);
        transaction.execute(
            "DELETE FROM codex_daily_rollups WHERE utc_day < strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')",
            [aggregate_cutoff],
        )?;
    }
    loop {
        let deleted = transaction.execute(
            "DELETE FROM codex_usage_events WHERE rowid IN
             (SELECT rowid FROM codex_usage_events WHERE occurred_at_utc_ms < ?1 LIMIT 10000)",
            [cutoff],
        )?;
        if deleted < 10_000 {
            break;
        }
    }
    transaction.execute(
        "DELETE FROM codex_sessions WHERE ended_at_utc_ms IS NOT NULL AND ended_at_utc_ms < ?1
         AND NOT EXISTS (SELECT 1 FROM codex_usage_events e
                         WHERE e.session_fingerprint = codex_sessions.session_fingerprint)",
        [cutoff],
    )?;
    Ok(())
}

fn increment_health_connection(
    connection: &Connection,
    name: &str,
    amount: u64,
    now_utc_ms: i64,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO telemetry_health(name, value, updated_at_utc_ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET value = CASE
             WHEN value >= 9223372036854775807 - excluded.value
             THEN 9223372036854775807
             ELSE value + excluded.value END,
         updated_at_utc_ms = excluded.updated_at_utc_ms",
        params![name, amount.min(i64::MAX as u64) as i64, now_utc_ms],
    )?;
    Ok(())
}

fn increment_health_tx(
    transaction: &Transaction<'_>,
    name: &str,
    now_utc_ms: i64,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO telemetry_health(name, value, updated_at_utc_ms) VALUES (?1, 1, ?2)
         ON CONFLICT(name) DO UPDATE SET value = CASE
             WHEN value >= 9223372036854775807 THEN 9223372036854775807
             ELSE value + 1 END,
         updated_at_utc_ms = excluded.updated_at_utc_ms",
        params![name, now_utc_ms],
    )?;
    Ok(())
}

fn merge_delta_tokens(existing: [Option<i64>; 4], incoming: [Option<i64>; 4]) -> [Option<i64>; 4] {
    std::array::from_fn(|index| match (existing[index], incoming[index]) {
        (Some(old), Some(new)) => Some(old.saturating_add(new).min(MAX_TOKEN_TOTAL_I64)),
        (value @ Some(_), None) | (None, value @ Some(_)) => value,
        (None, None) => None,
    })
}

fn merge_cumulative_tokens(
    existing: [Option<i64>; 4],
    incoming: [Option<i64>; 4],
) -> [Option<i64>; 4] {
    std::array::from_fn(|index| {
        incoming[index]
            .map(|value| value.min(MAX_TOKEN_TOTAL_I64))
            .or(existing[index])
    })
}

fn merge_duration(existing: Option<u64>, incoming: Option<u64>) -> Option<u64> {
    match (existing, incoming) {
        (Some(old), Some(new)) => Some(
            old.min(MAX_DURATION_SUM_MS)
                .saturating_add(new.min(MAX_DURATION_MS))
                .min(MAX_DURATION_SUM_MS),
        ),
        (Some(value), None) | (None, Some(value)) => Some(value.min(MAX_DURATION_SUM_MS)),
        (None, None) => None,
    }
}

fn duration_i64(value: Option<u64>) -> Option<i64> {
    value.map(|value| value.min(MAX_DURATION_MS) as i64)
}

fn duration_sum_i64(value: Option<u64>) -> Option<i64> {
    value.map(|value| value.min(MAX_DURATION_SUM_MS) as i64)
}

fn token_i64(value: Option<u64>) -> Result<Option<i64>, rusqlite::Error> {
    value
        .map(|value| {
            if value > MAX_TOKEN_COMPONENT {
                return Err(rusqlite::Error::InvalidQuery);
            }
            i64::try_from(value).map_err(|_| rusqlite::Error::InvalidQuery)
        })
        .transpose()
}

fn bounded_sum_sql(expression: &str, maximum: i64) -> String {
    format!("bounded_sum_i64({expression}, {maximum})")
}

fn bounded_token_from_row(
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

fn safe_add_sql(left: &str, right: &str) -> String {
    format!(
        "CASE WHEN {left} >= {maximum} - {right}
              THEN {maximum}
              ELSE {left} + {right} END",
        maximum = MAX_TOKEN_TOTAL_I64,
    )
}

fn digest(value: &HmacDigest) -> String {
    String::from(value.clone())
}

fn source_quality(value: SourceQuality) -> &'static str {
    match value {
        SourceQuality::Verified => "verified",
        SourceQuality::Unverified => "unverified",
    }
}

fn token_quality(value: TokenQuality) -> &'static str {
    match value {
        TokenQuality::Exact => "exact",
        TokenQuality::Partial => "partial",
        TokenQuality::Unavailable => "unavailable",
    }
}

fn counter_semantic(value: TokenCounterSemantic) -> &'static str {
    match value {
        TokenCounterSemantic::Delta => "delta",
        TokenCounterSemantic::Cumulative => "cumulative",
    }
}

fn configure_writer(connection: &Connection) -> Result<(), rusqlite::Error> {
    register_bounded_sum(connection)?;
    connection.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS))?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )?;
    Ok(())
}

fn configure_reader(connection: &Connection) -> Result<(), rusqlite::Error> {
    register_bounded_sum(connection)?;
    connection.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS))?;
    connection.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;")?;
    Ok(())
}

fn register_bounded_sum(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.create_aggregate_function(
        BOUNDED_SUM_FUNCTION,
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        BoundedSum,
    )
}

fn ensure_parent(path: &Path) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn restrict_storage_files(path: &Path) -> Result<(), std::io::Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for candidate in [
            path.to_path_buf(),
            PathBuf::from(format!("{}-wal", path.display())),
            PathBuf::from(format!("{}-shm", path.display())),
        ] {
            if candidate.exists() {
                fs::set_permissions(candidate, fs::Permissions::from_mode(0o600))?;
            }
        }
    }
    Ok(())
}

fn initialize_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == SCHEMA_VERSION && schema_is_current(connection)? {
        return Ok(());
    }

    reset_schema(connection)
}

fn reset_schema(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let objects = {
        let mut statement = connection.prepare(
            "SELECT type, name FROM sqlite_master
             WHERE type IN ('table', 'view', 'trigger', 'index')
               AND name NOT LIKE 'sqlite_%'",
        )?;
        let objects = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        objects
    };

    let result = (|| {
        let transaction = connection.unchecked_transaction()?;
        for (kind, name) in objects {
            let quoted_name = quote_identifier(&name);
            let statement = match kind.as_str() {
                "table" => format!("DROP TABLE IF EXISTS {quoted_name}"),
                "view" => format!("DROP VIEW IF EXISTS {quoted_name}"),
                "trigger" => format!("DROP TRIGGER IF EXISTS {quoted_name}"),
                "index" => format!("DROP INDEX IF EXISTS {quoted_name}"),
                _ => continue,
            };
            transaction.execute_batch(&statement)?;
        }
        transaction.execute_batch(include_str!("schema.sql"))?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()
    })();
    let restore_result = connection.execute_batch("PRAGMA foreign_keys = ON;");

    match (result, restore_result) {
        (Err(error), _) => Err(error),
        (Ok(()), Err(error)) => Err(error),
        (Ok(()), Ok(())) => Ok(()),
    }
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn schema_is_current(connection: &Connection) -> Result<bool, rusqlite::Error> {
    let has_tables = has_target_tables(connection)?;
    let has_extra_objects = has_non_target_objects(connection)?;
    if !has_tables || has_extra_objects {
        return Ok(false);
    }

    for name in TARGET_TABLES {
        if !schema_object_matches(connection, "table", name)? {
            return Ok(false);
        }
    }
    for name in TARGET_INDEXES {
        if !schema_object_matches(connection, "index", name)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn schema_object_matches(
    connection: &Connection,
    kind: &str,
    name: &str,
) -> Result<bool, rusqlite::Error> {
    let actual = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2",
            params![kind, name],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(actual) = actual else {
        return Ok(false);
    };
    let Some(expected) = expected_schema_statement(kind, name) else {
        return Ok(false);
    };
    Ok(normalize_schema_sql(&actual) == normalize_schema_sql(expected))
}

fn expected_schema_statement(kind: &str, name: &str) -> Option<&'static str> {
    let prefix = format!("create {kind} {name}");
    include_str!("schema.sql")
        .split(';')
        .find(|statement| normalize_schema_sql(statement).starts_with(&prefix))
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.to_ascii_lowercase()
        .replace("if not exists", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_target_tables(connection: &Connection) -> Result<bool, rusqlite::Error> {
    let mut statement = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")?;
    Ok(TARGET_TABLES
        .iter()
        .all(|name| statement.exists([name]).unwrap_or(false)))
}

fn has_non_target_objects(connection: &Connection) -> Result<bool, rusqlite::Error> {
    let mut statement = connection.prepare(
        "SELECT type, name FROM sqlite_master
         WHERE type IN ('table', 'view', 'trigger', 'index')
           AND name NOT LIKE 'sqlite_%'",
    )?;
    let objects = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(objects.iter().any(|(_, name)| {
        !TARGET_TABLES.contains(&name.as_str()) && !TARGET_INDEXES.contains(&name.as_str())
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{
        privacy::TelemetryHmacKey, CodexModel, CodexVersion, SafeIdentifier, SourceQuality,
        TokenCounterSemantic, TokenQuality, UsageQuery, MAX_TOKEN_COMPONENT, MAX_TOKEN_TOTAL,
    };

    fn event(temp: &tempfile::TempDir, suffix: &str, timestamp: i64) -> CodexUsageEvent {
        let key = TelemetryHmacKey::load_or_create_for_tests(temp.path().join("key"));
        CodexUsageEvent {
            schema_version: crate::telemetry::TELEMETRY_SCHEMA_VERSION,
            id: key.digest(b"event", &[suffix.as_bytes()]),
            occurred_at_utc_ms: timestamp,
            session_fingerprint: Some(key.digest(b"session", &[b"session"])),
            model: Some(CodexModel::new("gpt-5.6").unwrap()),
            source_version: CodexVersion::new("0.145.0").unwrap(),
            source_quality: SourceQuality::Verified,
            status: SafeIdentifier::new("completed").unwrap(),
            counter_semantic: TokenCounterSemantic::Delta,
            duration_ms: Some(5),
            token_quality: TokenQuality::Exact,
            input_tokens: Some(10),
            cached_input_tokens: Some(2),
            output_tokens: Some(3),
            reasoning_tokens: Some(1),
        }
    }

    trait TestKey {
        fn load_or_create_for_tests(path: PathBuf) -> Self;
    }

    impl TestKey for TelemetryHmacKey {
        fn load_or_create_for_tests(path: PathBuf) -> Self {
            super::super::privacy::load_or_create_hmac_key(&path).unwrap()
        }
    }

    #[test]
    fn fresh_database_has_only_codex_tables_and_private_storage() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let connection = store.open_read().unwrap();
        let tables = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            tables,
            vec![
                "codex_daily_rollups",
                "codex_sessions",
                "codex_usage_events",
                "telemetry_health"
            ]
        );
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
    }

    #[test]
    fn writes_dedupes_and_preserves_unavailable_tokens() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let mut first = event(&temp, "first", 1_000);
        first.token_quality = TokenQuality::Unavailable;
        first.input_tokens = None;
        first.cached_input_tokens = None;
        first.output_tokens = None;
        first.reasoning_tokens = None;
        store
            .write_batch(vec![TelemetryCmd::CodexUsage(first.clone())])
            .unwrap();
        store
            .write_batch(vec![TelemetryCmd::CodexUsage(first)])
            .unwrap();
        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row("SELECT token_quality FROM codex_usage_events", [], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "unavailable"
        );
        assert_eq!(
            crate::telemetry::queries::health_value(&store, "collector_duplicates").unwrap(),
            1
        );
    }

    #[test]
    fn session_response_count_saturates_at_the_schema_bound() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        store
            .write_batch(vec![TelemetryCmd::CodexUsage(event(
                &temp,
                "response-bound-first",
                1_000,
            ))])
            .unwrap();
        {
            let connection = store.writer.lock().unwrap();
            connection
                .execute(
                    "UPDATE codex_sessions SET response_count = ?1",
                    [MAX_TOKEN_TOTAL as i64],
                )
                .unwrap();
        }

        store
            .write_batch(vec![TelemetryCmd::CodexUsage(event(
                &temp,
                "response-bound-second",
                1_001,
            ))])
            .unwrap();
        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT response_count FROM codex_sessions", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            MAX_TOKEN_TOTAL as i64
        );
    }

    #[test]
    fn aggregate_queries_preserve_totals_above_single_component_bound() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let mut first = event(&temp, "aggregate-first", DAY_MS + 1);
        first.input_tokens = Some(MAX_TOKEN_COMPONENT);
        let mut second = event(&temp, "aggregate-second", DAY_MS + 2);
        second.input_tokens = Some(MAX_TOKEN_COMPONENT);
        store
            .write_batch(vec![
                TelemetryCmd::CodexUsage(first.clone()),
                TelemetryCmd::CodexUsage(second),
            ])
            .unwrap();

        let query = UsageQuery::default();
        let expected = Some(MAX_TOKEN_COMPONENT * 2);
        assert_eq!(
            crate::telemetry::queries::aggregate_tokens(&store, &query)
                .unwrap()
                .unwrap()
                .input_tokens,
            expected
        );
        assert_eq!(
            crate::telemetry::queries::agent_executor_aggregates(
                &store,
                first.session_fingerprint.as_ref().unwrap(),
            )
            .unwrap()[0]
                .input_tokens,
            expected
        );

        store
            .write_batch(vec![TelemetryCmd::Purge {
                now_utc_ms: DAY_MS * 3,
                detail_retention_days: 1,
                aggregate_retention_days: None,
            }])
            .unwrap();
        assert_eq!(
            crate::telemetry::queries::aggregate_token_rollups(&store, &query, DAY_MS * 3)
                .unwrap()
                .unwrap()
                .input_tokens,
            expected
        );
    }

    #[test]
    fn executor_aggregates_saturate_sqlite_sum_overflow() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let key = TelemetryHmacKey::load_or_create_for_tests(temp.path().join("overflow-key"));
        let session_id = String::from(key.digest(b"session", &[b"overflow-session"]));
        let first_id = String::from(key.digest(b"event", &[b"overflow-first"]));
        let second_id = String::from(key.digest(b"event", &[b"overflow-second"]));
        let connection = store.writer.lock().unwrap();
        connection
            .execute_batch("PRAGMA ignore_check_constraints = ON;")
            .unwrap();
        for event_id in [&first_id, &second_id] {
            connection
                .execute(
                    "INSERT INTO codex_usage_events(
                         dedupe_id, occurred_at_utc_ms, session_fingerprint, model,
                         source_version, source_quality, status, counter_semantic,
                         token_quality, input_tokens
                     ) VALUES (?1, ?2, ?3, 'gpt-5.6', '0.145.0', 'verified',
                               'completed', 'delta', 'exact', ?4)",
                    rusqlite::params![event_id, 1_i64, session_id, i64::MAX],
                )
                .unwrap();
        }
        drop(connection);

        let aggregate = crate::telemetry::queries::agent_executor_aggregates(
            &store,
            &session_id.try_into().unwrap(),
        )
        .unwrap();
        assert_eq!(aggregate[0].input_tokens, Some(MAX_TOKEN_TOTAL));
    }

    #[test]
    fn aggregate_sum_preserves_integer_precision_above_f64_exact_range() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let key = TelemetryHmacKey::load_or_create_for_tests(temp.path().join("precision-key"));
        let session_id = String::from(key.digest(b"session", &[b"precision-session"]));
        let first_id = String::from(key.digest(b"event", &[b"precision-first"]));
        let second_id = String::from(key.digest(b"event", &[b"precision-second"]));
        let first_value = 9_007_199_254_740_992_i64;
        let connection = store.writer.lock().unwrap();
        connection
            .execute_batch("PRAGMA ignore_check_constraints = ON;")
            .unwrap();
        for (event_id, value) in [(&first_id, first_value), (&second_id, 1)] {
            connection
                .execute(
                    "INSERT INTO codex_usage_events(
                         dedupe_id, occurred_at_utc_ms, session_fingerprint, model,
                         source_version, source_quality, status, counter_semantic,
                         token_quality, input_tokens
                     ) VALUES (?1, ?2, ?3, 'gpt-5.6', '0.145.0', 'verified',
                               'completed', 'delta', 'exact', ?4)",
                    rusqlite::params![event_id, 1_i64, session_id, value],
                )
                .unwrap();
        }
        drop(connection);

        let aggregate = crate::telemetry::queries::agent_executor_aggregates(
            &store,
            &session_id.try_into().unwrap(),
        )
        .unwrap();
        assert_eq!(aggregate[0].input_tokens, Some(first_value as u64 + 1));
    }

    #[test]
    fn retention_rolls_up_before_detail_purge() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        store
            .write_batch(vec![TelemetryCmd::CodexUsage(event(&temp, "retention", 1))])
            .unwrap();
        store
            .write_batch(vec![TelemetryCmd::Purge {
                now_utc_ms: DAY_MS * 3,
                detail_retention_days: 1,
                aggregate_retention_days: None,
            }])
            .unwrap();
        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    &format!(
                        "SELECT bounded_sum_i64(response_count, {MAX_TOKEN_TOTAL})
                         FROM codex_daily_rollups"
                    ),
                    [],
                    |row| row.get::<_, Option<i64>>(0)
                )
                .unwrap(),
            Some(1)
        );
    }

    #[test]
    fn range_delete_removes_purged_session_summary() {
        let temp = tempfile::tempdir().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        store
            .write_batch(vec![
                TelemetryCmd::CodexUsage(event(&temp, "historical", DAY_MS)),
                TelemetryCmd::CodexUsage(event(&temp, "recent", DAY_MS * 3)),
            ])
            .unwrap();
        store
            .write_batch(vec![TelemetryCmd::Purge {
                now_utc_ms: DAY_MS * 4,
                detail_retention_days: 1,
                aggregate_retention_days: None,
            }])
            .unwrap();

        // The selected day has no detail row anymore, but the session summary
        // still spans it. A privacy delete must remove that aggregate rather
        // than leave purged facts queryable.
        store.delete_range(Some(DAY_MS), Some(DAY_MS * 2)).unwrap();
        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM codex_sessions", [], |row| row
                    .get::<_, i64>(0),)
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    &format!(
                        "SELECT bounded_sum_i64(response_count, {MAX_TOKEN_TOTAL})
                         FROM codex_daily_rollups"
                    ),
                    [],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .unwrap(),
            None
        );
    }

    #[test]
    fn legacy_database_is_reset_to_fresh_codex_schema() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("legacy.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute("CREATE TABLE legacy_usage_events(value TEXT NOT NULL)", [])
            .unwrap();
        connection
            .execute(
                "INSERT INTO legacy_usage_events(value) VALUES ('discard-me')",
                [],
            )
            .unwrap();
        connection
            .pragma_update(None, "user_version", 6_i64)
            .unwrap();
        drop(connection);

        let store = TelemetryStore::open(&path).unwrap();
        let connection = store.open_read().unwrap();
        let tables = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            tables,
            vec![
                "codex_daily_rollups",
                "codex_sessions",
                "codex_usage_events",
                "telemetry_health"
            ]
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert_eq!(
            store
                .writer
                .lock()
                .unwrap()
                .pragma_query_value(None, "foreign_keys", |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn malformed_current_schema_is_reset_to_fresh_codex_schema() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("malformed.db");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(include_str!("schema.sql"))
            .unwrap();
        connection
            .execute_batch(
                "DROP TABLE codex_usage_events;
                 CREATE TABLE codex_usage_events(
                     dedupe_id TEXT,
                     occurred_at_utc_ms INTEGER,
                     session_fingerprint TEXT
                 );
                 CREATE INDEX idx_codex_usage_events_occurred
                     ON codex_usage_events(occurred_at_utc_ms);
                 CREATE INDEX idx_codex_usage_events_session
                     ON codex_usage_events(session_fingerprint, occurred_at_utc_ms);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);

        let store = TelemetryStore::open(&path).unwrap();
        let connection = store.open_read().unwrap();
        let columns = connection
            .prepare("PRAGMA table_info(codex_usage_events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.contains(&"source_version".to_string()));
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn reopens_current_schema_without_resetting_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("telemetry.db");
        let store = TelemetryStore::open(&path).unwrap();
        store
            .write_batch(vec![TelemetryCmd::CodexUsage(event(
                &temp,
                "survive-reopen",
                1_000,
            ))])
            .unwrap();
        assert_eq!(
            store
                .open_read()
                .unwrap()
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drop(store);

        let reopened = TelemetryStore::open(&path).unwrap();
        assert_eq!(
            reopened
                .open_read()
                .unwrap()
                .query_row("SELECT count(*) FROM codex_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn target_primary_keys_reject_null_values() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("target-constraints.db");
        let store = TelemetryStore::open(&path).unwrap();
        let connection = Connection::open(store.path_for_tests()).unwrap();
        assert!(connection
            .execute(
                "INSERT INTO codex_usage_events(dedupe_id) VALUES (NULL)",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO codex_sessions(session_fingerprint) VALUES (NULL)",
                [],
            )
            .is_err());
        assert!(connection
            .execute("INSERT INTO telemetry_health(name) VALUES (NULL)", [])
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO codex_usage_events(
                     dedupe_id, occurred_at_utc_ms, source_version, source_quality,
                     status, counter_semantic, token_quality, input_tokens
                 ) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                           1000, '0.145.0', 'verified', 'completed', 'delta', 'partial',
                           1000000000001)",
                [],
            )
            .is_err());
    }
}
