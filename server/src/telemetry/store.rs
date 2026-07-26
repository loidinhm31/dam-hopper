use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use rusqlite::{params, Connection, Transaction};
use thiserror::Error;

use super::{
    types::{
        AgentUsageEvent, CaptureQuality, CommandEvent, CommandOutcome, CorrelationQuality,
        ShellKind, TerminalRunEnd, TerminalRunEvent, TokenCounterSemantic,
    },
    TelemetryCmd,
};

const BUSY_TIMEOUT_MS: u64 = 5_000;

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
        connection.execute_batch(include_str!("migrations/001_initial.sql"))?;
        ensure_token_rollup_availability_columns(&connection)?;
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
                TelemetryCmd::TerminalRun(event) => upsert_terminal_run(&transaction, &event)?,
                TelemetryCmd::TerminalRunEnded(event) => finish_terminal_run(&transaction, &event)?,
                TelemetryCmd::Command(event) => insert_command(&transaction, &event)?,
                TelemetryCmd::AgentUsage(event) => {
                    if !insert_agent_usage(&transaction, &event)? {
                        transaction.execute(
                            "INSERT INTO telemetry_health(name, value, updated_at_utc_ms) VALUES ('collector_duplicates', 1, ?1) ON CONFLICT(name) DO UPDATE SET value = value + 1, updated_at_utc_ms = excluded.updated_at_utc_ms",
                            params![event.occurred_at_utc_ms],
                        )?;
                    }
                }
                TelemetryCmd::Purge {
                    now_utc_ms,
                    detail_retention_days,
                    aggregate_retention_days,
                } => {
                    rollup_and_purge(
                        &transaction,
                        now_utc_ms,
                        detail_retention_days,
                        aggregate_retention_days,
                    )?;
                }
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
        connection.execute(
            "INSERT INTO telemetry_health(name, value, updated_at_utc_ms) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET value = value + excluded.value, updated_at_utc_ms = excluded.updated_at_utc_ms",
            params![name, amount as i64, now_utc_ms],
        )?;
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

    /// Delete all data, or an exact detail range plus UTC-aligned rollup days.
    /// The API validates range alignment before calling this method.
    pub fn delete_range(
        &self,
        from_utc_ms: Option<i64>,
        to_utc_ms: Option<i64>,
    ) -> Result<(), TelemetryStoreError> {
        let mut connection = self.writer.lock().expect("telemetry writer lock poisoned");
        let transaction = connection.transaction()?;
        match (from_utc_ms, to_utc_ms) {
            (Some(from), Some(to)) => {
                transaction.execute("DELETE FROM agent_usage_events WHERE occurred_at_utc_ms >= ?1 AND occurred_at_utc_ms < ?2", params![from, to])?;
                transaction.execute("DELETE FROM command_events WHERE occurred_at_utc_ms >= ?1 AND occurred_at_utc_ms < ?2", params![from, to])?;
                transaction.execute("DELETE FROM daily_usage_rollups WHERE utc_day >= strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch') AND utc_day < strftime('%Y-%m-%d', ?2 / 1000, 'unixepoch')", params![from, to])?;
                transaction.execute("DELETE FROM terminal_runs WHERE ended_at_utc_ms IS NOT NULL AND ended_at_utc_ms >= ?1 AND ended_at_utc_ms < ?2 AND NOT EXISTS (SELECT 1 FROM command_events c WHERE c.run_id = terminal_runs.run_id)", params![from, to])?;
            }
            (None, None) => transaction.execute_batch("DELETE FROM agent_usage_events; DELETE FROM agent_runs; DELETE FROM command_events; DELETE FROM terminal_runs; DELETE FROM daily_usage_rollups; DELETE FROM telemetry_health;")?,
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

fn ensure_token_rollup_availability_columns(
    connection: &Connection,
) -> Result<(), rusqlite::Error> {
    for column in [
        "input_tokens_count",
        "cached_input_tokens_count",
        "output_tokens_count",
        "reasoning_tokens_count",
    ] {
        let exists = connection
            .prepare("SELECT 1 FROM pragma_table_info('daily_usage_rollups') WHERE name = ?1")?
            .exists([column])?;
        if !exists {
            connection.execute_batch(&format!(
                "ALTER TABLE daily_usage_rollups ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"
            ))?;
        }
    }
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<(), std::io::Error> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "telemetry DB path has no parent",
        )
    })?;
    let created = !parent.exists();
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // The configured parent can be shared (for example `/tmp`); never change
        // permissions on a directory we did not create for telemetry.
        if created {
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}

fn restrict_storage_files(path: &Path) -> Result<(), std::io::Error> {
    restrict_file(path)?;
    for sidecar in [sidecar_path(path, "-wal"), sidecar_path(path, "-shm")] {
        if sidecar.exists() {
            restrict_file(&sidecar)?;
        }
    }
    Ok(())
}

fn sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn restrict_file(path: &Path) -> Result<(), std::io::Error> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn configure_writer(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS))?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
    )
}

fn configure_reader(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS))?;
    connection.execute_batch("PRAGMA query_only=ON; PRAGMA foreign_keys=ON;")
}

fn upsert_terminal_run(
    transaction: &Transaction<'_>,
    event: &TerminalRunEvent,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO terminal_runs(run_id, project, shell, started_at_utc_ms, ended_at_utc_ms, capture_quality)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(run_id) DO UPDATE SET ended_at_utc_ms = excluded.ended_at_utc_ms, capture_quality = excluded.capture_quality",
        params![event.run_id.0.to_string(), event.project.as_ref().map(|v| v.as_str()), shell(event.shell), event.started_at_utc_ms, event.ended_at_utc_ms, capture(event.capture_quality)],
    )?;
    Ok(())
}

fn finish_terminal_run(
    transaction: &Transaction<'_>,
    event: &TerminalRunEnd,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "UPDATE terminal_runs SET ended_at_utc_ms = ?2, capture_quality = ?3 WHERE run_id = ?1",
        params![
            event.run_id.0.to_string(),
            event.ended_at_utc_ms,
            capture(event.capture_quality)
        ],
    )?;
    Ok(())
}

fn insert_command(
    transaction: &Transaction<'_>,
    event: &CommandEvent,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "INSERT INTO command_events(run_id, sequence, occurred_at_utc_ms, duration_ms, exit_code, outcome, category, executable, argument_count, fingerprint, capture_quality)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(run_id, sequence) DO NOTHING",
        params![event.id.run_id.0.to_string(), event.id.sequence as i64, event.occurred_at_utc_ms, event.duration_ms.map(|value| value as i64), event.exit_code, outcome(event.outcome), event.category.as_str(), event.executable.as_ref().map(|value| value.as_str()), event.argument_count as i64, digest(&event.fingerprint), capture(event.capture_quality)],
    )?;
    Ok(())
}

fn insert_agent_usage(
    transaction: &Transaction<'_>,
    event: &AgentUsageEvent,
) -> Result<bool, rusqlite::Error> {
    Ok(transaction.execute(
        "INSERT INTO agent_usage_events(dedupe_id, occurred_at_utc_ms, conversation_fingerprint, model, source_version, correlation_quality, counter_semantic, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(dedupe_id) DO NOTHING",
        params![digest(&event.id), event.occurred_at_utc_ms, event.conversation_fingerprint.as_ref().map(digest), event.model.as_ref().map(|model| String::from(model.clone())), String::from(event.source_version.clone()), correlation(event.correlation_quality), counter_semantic(event.counter_semantic), event.input_tokens.map(|value| value as i64), event.cached_input_tokens.map(|value| value as i64), event.output_tokens.map(|value| value as i64), event.reasoning_tokens.map(|value| value as i64)],
    )? == 1)
}

fn rollup_and_purge(
    transaction: &Transaction<'_>,
    now_utc_ms: i64,
    retention_days: u16,
    aggregate_retention_days: Option<u32>,
) -> Result<(), rusqlite::Error> {
    // Retain the whole UTC boundary day in detail. This avoids making a daily
    // rollup that contains only part of a day, which would otherwise make a
    // detail/rollup aggregate query either double-count or leave a gap.
    let raw_cutoff = now_utc_ms.saturating_sub(i64::from(retention_days) * 86_400_000);
    let cutoff = raw_cutoff - raw_cutoff.rem_euclid(86_400_000);
    transaction.execute(
        "INSERT INTO daily_usage_rollups(utc_day, project, shell, category, model, command_count, succeeded_count, failed_count, interrupted_count, unknown_count, duration_ms_sum)
         SELECT strftime('%Y-%m-%d', c.occurred_at_utc_ms / 1000, 'unixepoch'), coalesce(r.project, ''), r.shell, c.category, '', count(*),
                sum(c.outcome = 'succeeded'), sum(c.outcome = 'failed'), sum(c.outcome = 'interrupted'), sum(c.outcome = 'unknown'), coalesce(sum(c.duration_ms), 0)
         FROM command_events c JOIN terminal_runs r ON r.run_id = c.run_id
         WHERE c.occurred_at_utc_ms < ?1 GROUP BY 1, 2, 3, 4
         ON CONFLICT(utc_day, project, shell, category, model) DO UPDATE SET
           command_count = command_count + excluded.command_count, succeeded_count = succeeded_count + excluded.succeeded_count,
           failed_count = failed_count + excluded.failed_count, interrupted_count = interrupted_count + excluded.interrupted_count,
           unknown_count = unknown_count + excluded.unknown_count, duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum",
        params![cutoff],
    )?;
    transaction.execute(
        "INSERT INTO daily_usage_rollups(utc_day, project, shell, category, model, input_tokens_sum, cached_input_tokens_sum, output_tokens_sum, reasoning_tokens_sum, input_tokens_count, cached_input_tokens_count, output_tokens_count, reasoning_tokens_count)
         SELECT strftime('%Y-%m-%d', occurred_at_utc_ms / 1000, 'unixepoch'), '', '', '', coalesce(model, ''),
                coalesce(sum(input_tokens), 0), coalesce(sum(cached_input_tokens), 0), coalesce(sum(output_tokens), 0), coalesce(sum(reasoning_tokens), 0),
                sum(input_tokens IS NOT NULL), sum(cached_input_tokens IS NOT NULL), sum(output_tokens IS NOT NULL), sum(reasoning_tokens IS NOT NULL)
         FROM agent_usage_events WHERE occurred_at_utc_ms < ?1 GROUP BY 1, 5
         ON CONFLICT(utc_day, project, shell, category, model) DO UPDATE SET
           input_tokens_sum = input_tokens_sum + excluded.input_tokens_sum,
           cached_input_tokens_sum = cached_input_tokens_sum + excluded.cached_input_tokens_sum,
           output_tokens_sum = output_tokens_sum + excluded.output_tokens_sum,
           reasoning_tokens_sum = reasoning_tokens_sum + excluded.reasoning_tokens_sum,
           input_tokens_count = input_tokens_count + excluded.input_tokens_count,
           cached_input_tokens_count = cached_input_tokens_count + excluded.cached_input_tokens_count,
           output_tokens_count = output_tokens_count + excluded.output_tokens_count,
           reasoning_tokens_count = reasoning_tokens_count + excluded.reasoning_tokens_count",
        params![cutoff],
    )?;
    if let Some(days) = aggregate_retention_days {
        let aggregate_cutoff = now_utc_ms.saturating_sub(i64::from(days) * 86_400_000);
        transaction.execute(
            "DELETE FROM daily_usage_rollups WHERE utc_day < strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')",
            params![aggregate_cutoff],
        )?;
    }
    loop {
        let deleted = transaction.execute("DELETE FROM command_events WHERE rowid IN (SELECT rowid FROM command_events WHERE occurred_at_utc_ms < ?1 LIMIT 10000)", params![cutoff])?;
        if deleted < 10_000 {
            break;
        }
    }
    transaction.execute(
        "DELETE FROM agent_usage_events WHERE occurred_at_utc_ms < ?1",
        params![cutoff],
    )?;
    transaction.execute("DELETE FROM terminal_runs WHERE ended_at_utc_ms IS NOT NULL AND ended_at_utc_ms < ?1 AND NOT EXISTS (SELECT 1 FROM command_events c WHERE c.run_id = terminal_runs.run_id)", params![cutoff])?;
    Ok(())
}

fn shell(value: ShellKind) -> &'static str {
    match value {
        ShellKind::Bash => "bash",
        ShellKind::Zsh => "zsh",
        ShellKind::Fish => "fish",
    }
}
fn capture(value: CaptureQuality) -> &'static str {
    match value {
        CaptureQuality::Rich => "rich",
        CaptureQuality::Partial => "partial",
        CaptureQuality::Unavailable => "unavailable",
    }
}
fn outcome(value: CommandOutcome) -> &'static str {
    match value {
        CommandOutcome::Succeeded => "succeeded",
        CommandOutcome::Failed => "failed",
        CommandOutcome::Interrupted => "interrupted",
        CommandOutcome::Unknown => "unknown",
    }
}
fn correlation(value: CorrelationQuality) -> &'static str {
    match value {
        CorrelationQuality::Exact => "exact",
        CorrelationQuality::Approximate => "approximate",
        CorrelationQuality::Unattributed => "unattributed",
    }
}
fn counter_semantic(value: TokenCounterSemantic) -> &'static str {
    match value {
        TokenCounterSemantic::Delta => "delta",
        TokenCounterSemantic::Cumulative => "cumulative",
    }
}
fn digest(value: &super::privacy::HmacDigest) -> String {
    String::from(value.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{normalize_command, privacy::load_or_create_hmac_key, types::*};
    use tempfile::TempDir;
    use uuid::Uuid;

    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;

    fn event(run_id: TerminalRunId, sequence: u64, timestamp: i64) -> CommandEvent {
        let temp = TempDir::new().unwrap();
        let key = load_or_create_hmac_key(&temp.path().join("key")).unwrap();
        let command = normalize_command("git status", &key);
        CommandEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: CommandEventId { run_id, sequence },
            occurred_at_utc_ms: timestamp,
            duration_ms: Some(10),
            exit_code: Some(0),
            outcome: CommandOutcome::Succeeded,
            category: command.category,
            executable: command.executable,
            argument_count: command.argument_count,
            fingerprint: command.fingerprint,
            capture_quality: CaptureQuality::Rich,
        }
    }

    #[test]
    fn stores_idempotently_and_rolls_up_before_purge() {
        let temp = TempDir::new().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let run_id = TerminalRunId(Uuid::new_v4());
        let started = TerminalRunEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            run_id,
            project: Some(SafeIdentifier::new("project").unwrap()),
            shell: ShellKind::Bash,
            started_at_utc_ms: 1,
            ended_at_utc_ms: None,
            capture_quality: CaptureQuality::Rich,
        };
        store
            .write_batch(vec![
                TelemetryCmd::TerminalRun(started),
                TelemetryCmd::Command(event(run_id, 1, 1)),
                TelemetryCmd::Command(event(run_id, 1, 1)),
                TelemetryCmd::Purge {
                    now_utc_ms: 172_800_002,
                    detail_retention_days: 1,
                    aggregate_retention_days: None,
                },
            ])
            .unwrap();
        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM command_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT command_count FROM daily_usage_rollups", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1
        );
    }

    #[test]
    fn creates_private_database_file() {
        let temp = TempDir::new().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        #[cfg(unix)]
        assert_eq!(
            std::fs::metadata(store.path_for_tests()).unwrap().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn read_only_connection_can_query_without_writer_pragmas() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("telemetry.db");
        let store = TelemetryStore::open(&path).unwrap();
        store.increment_health("fixture", 1, 1).unwrap();

        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT value FROM telemetry_health WHERE name = 'fixture'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
        assert!(connection
            .execute("DELETE FROM telemetry_health", [])
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn read_only_database_file_remains_queryable() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let path = temp.path().join("telemetry.db");
        let store = TelemetryStore::open(&path).unwrap();
        store.increment_health("fixture", 1, 1).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).unwrap();

        let connection = store.open_read().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM telemetry_health", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn concurrent_readers_do_not_block_writer_commits() {
        let temp = TempDir::new().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let reader_store = store.clone();
        let reader = std::thread::spawn(move || {
            for _ in 0..25 {
                let connection = reader_store.open_read().unwrap();
                connection
                    .query_row("SELECT count(*) FROM telemetry_health", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap();
            }
        });

        for index in 0..25 {
            store.increment_health("reader_writer", 1, index).unwrap();
        }
        reader.join().unwrap();
        assert_eq!(
            store
                .open_read()
                .unwrap()
                .query_row(
                    "SELECT value FROM telemetry_health WHERE name = 'reader_writer'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            25
        );
    }

    #[test]
    fn corrupt_database_is_rejected_without_partial_initialization() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("telemetry.db");
        fs::write(&path, b"not a sqlite database").unwrap();

        assert!(TelemetryStore::open(&path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn reopens_existing_database_and_wal_with_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let path = temp.path().join("telemetry.db");
        let store = TelemetryStore::open(&path).unwrap();
        store.increment_health("fixture", 1, 1).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let wal = sidecar_path(&path, "-wal");
        if wal.exists() {
            std::fs::set_permissions(&wal, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        let reopened = TelemetryStore::open(&path).unwrap();
        assert_eq!(
            std::fs::metadata(reopened.path_for_tests()).unwrap().mode() & 0o777,
            0o600
        );
        if wal.exists() {
            assert_eq!(std::fs::metadata(wal).unwrap().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn token_details_roll_up_without_storing_raw_fixture_content() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("telemetry.db");
        let store = TelemetryStore::open(&path).unwrap();
        let key = load_or_create_hmac_key(&temp.path().join("key")).unwrap();
        let usage = AgentUsageEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: key.digest(b"usage", &[b"fixture-secret-token"]),
            occurred_at_utc_ms: 1,
            conversation_fingerprint: None,
            model: Some(CodexModel::new("gpt-5.6-sol").unwrap()),
            source_version: CodexVersion::new("0.145.0").unwrap(),
            correlation_quality: CorrelationQuality::Unattributed,
            counter_semantic: TokenCounterSemantic::Delta,
            input_tokens: Some(2),
            cached_input_tokens: Some(3),
            output_tokens: Some(5),
            reasoning_tokens: Some(7),
        };
        store
            .write_batch(vec![
                TelemetryCmd::AgentUsage(usage),
                TelemetryCmd::Purge {
                    now_utc_ms: 172_800_002,
                    detail_retention_days: 1,
                    aggregate_retention_days: None,
                },
            ])
            .unwrap();
        store.checkpoint().unwrap();
        let connection = store.open_read().unwrap();
        assert_eq!(connection.query_row("SELECT input_tokens_sum + cached_input_tokens_sum + output_tokens_sum + reasoning_tokens_sum FROM daily_usage_rollups", [], |row| row.get::<_, i64>(0)).unwrap(), 17);
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM agent_usage_events", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(!String::from_utf8_lossy(&fs::read(path).unwrap()).contains("fixture-secret-token"));
    }

    #[test]
    fn token_rollups_preserve_component_unavailability() {
        let temp = TempDir::new().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let key = load_or_create_hmac_key(&temp.path().join("key")).unwrap();
        let usage = AgentUsageEvent {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            id: key.digest(b"usage", &[b"partial-components"]),
            occurred_at_utc_ms: 1,
            conversation_fingerprint: None,
            model: Some(CodexModel::new("gpt-5.6-sol").unwrap()),
            source_version: CodexVersion::unknown(),
            correlation_quality: CorrelationQuality::Unattributed,
            counter_semantic: TokenCounterSemantic::Delta,
            input_tokens: Some(0),
            cached_input_tokens: None,
            output_tokens: Some(5),
            reasoning_tokens: None,
        };
        store
            .write_batch(vec![
                TelemetryCmd::AgentUsage(usage),
                TelemetryCmd::Purge {
                    now_utc_ms: 172_800_002,
                    detail_retention_days: 1,
                    aggregate_retention_days: None,
                },
            ])
            .unwrap();

        let aggregate = crate::telemetry::queries::aggregate_token_rollups(
            &store,
            &UsageQuery::default(),
            172_800_002,
        )
        .unwrap()
        .unwrap();
        assert_eq!(aggregate.input_tokens, Some(0));
        assert_eq!(aggregate.cached_input_tokens, None);
        assert_eq!(aggregate.output_tokens, Some(5));
        assert_eq!(aggregate.reasoning_tokens, None);
    }

    #[test]
    fn aggregate_query_stays_under_200ms_for_100k_detail_rows() {
        use std::time::{Duration, Instant};

        let temp = TempDir::new().unwrap();
        let store = TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap();
        let run_id = Uuid::new_v4().to_string();
        let connection = store.writer.lock().unwrap();
        connection
            .execute(
                "INSERT INTO terminal_runs(run_id, project, shell, started_at_utc_ms, capture_quality) VALUES (?1, 'benchmark', 'bash', 0, 'rich')",
                [&run_id],
            )
            .unwrap();
        let transaction = connection.unchecked_transaction().unwrap();
        {
            let mut statement = transaction
                .prepare(
                    "INSERT INTO command_events(run_id, sequence, occurred_at_utc_ms, duration_ms, exit_code, outcome, category, executable, argument_count, fingerprint, capture_quality) VALUES (?1, ?2, ?2, 1, 0, 'succeeded', 'git', 'git', 1, 'benchmark', 'rich')",
                )
                .unwrap();
            for sequence in 0..100_000_i64 {
                statement
                    .execute(rusqlite::params![run_id, sequence])
                    .unwrap();
            }
        }
        transaction.commit().unwrap();
        drop(connection);

        let query = UsageQuery {
            from_utc_ms: Some(0),
            to_utc_ms: Some(100_000),
            ..UsageQuery::default()
        };
        let plan = store
            .open_read()
            .unwrap()
            .prepare("EXPLAIN QUERY PLAN SELECT count(*) FROM command_events WHERE occurred_at_utc_ms >= 0 AND occurred_at_utc_ms < 100000")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join(" ");
        assert!(
            plan.contains("idx_command_events_occurred"),
            "query plan: {plan}"
        );

        let mut durations = Vec::new();
        for _ in 0..5 {
            let started = Instant::now();
            let aggregate = crate::telemetry::queries::aggregate_commands(&store, &query).unwrap();
            assert_eq!(aggregate.command_count, 100_000);
            durations.push(started.elapsed());
        }
        durations.sort_unstable();
        assert!(
            durations[4] < Duration::from_millis(200),
            "100k aggregate query p95 took {:?}; durations: {durations:?}",
            durations[4]
        );
    }
}
