use rusqlite::params_from_iter;
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
