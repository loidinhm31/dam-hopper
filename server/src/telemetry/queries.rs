use rusqlite::{params, params_from_iter};
use serde::Serialize;

use super::{
    store::{TelemetryStore, TelemetryStoreError},
    types::UsageQuery,
};

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
    let mut sql = String::from("SELECT count(*), sum(input_tokens), sum(cached_input_tokens), sum(output_tokens), sum(reasoning_tokens) FROM agent_usage_events WHERE 1 = 1");
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
    let mut sql = String::from("SELECT coalesce(sum(input_tokens_sum), 0), coalesce(sum(cached_input_tokens_sum), 0), coalesce(sum(output_tokens_sum), 0), coalesce(sum(reasoning_tokens_sum), 0), coalesce(sum(input_tokens_sum + cached_input_tokens_sum + output_tokens_sum + reasoning_tokens_sum), 0) FROM daily_usage_rollups WHERE utc_day < strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')");
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
                    input_tokens: Some(row.get::<_, i64>(0)? as u64),
                    cached_input_tokens: Some(row.get::<_, i64>(1)? as u64),
                    output_tokens: Some(row.get::<_, i64>(2)? as u64),
                    reasoning_tokens: Some(row.get::<_, i64>(3)? as u64),
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
        }),
    }
}

fn add_optional(left: Option<u64>, right: Option<u64>) -> Option<u64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left + right),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
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
